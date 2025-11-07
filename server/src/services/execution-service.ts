/**
 * Execution Service
 *
 * High-level service for managing issue-to-execution transformations.
 * Coordinates between template rendering, worktree management, and workflow execution.
 *
 * @module services/execution-service
 */

import type Database from "better-sqlite3";
import type { Execution } from "@sudocode-ai/types";
import { PromptTemplateEngine } from "./prompt-template-engine.js";
import { ExecutionLifecycleService } from "./execution-lifecycle.js";
import {
  createExecution,
  getExecution,
  updateExecution,
} from "./executions.js";
import { getDefaultTemplate, getTemplateById } from "./prompt-templates.js";
import { randomUUID } from "crypto";
import { SimpleProcessManager } from "../execution/process/simple-manager.js";
import { SimpleExecutionEngine } from "../execution/engine/simple-engine.js";
import { ResilientExecutor } from "../execution/resilience/resilient-executor.js";
import { LinearOrchestrator } from "../execution/workflow/linear-orchestrator.js";
import type { WorkflowDefinition } from "../execution/workflow/types.js";
import { createAgUiSystem } from "../execution/output/ag-ui-integration.js";
import type { AgUiEventAdapter } from "../execution/output/ag-ui-adapter.js";
import type { TransportManager } from "../execution/transport/transport-manager.js";
import { ExecutionLogsStore } from "./execution-logs-store.js";

/**
 * Configuration for creating an execution
 */
export interface ExecutionConfig {
  mode?: "worktree" | "local";
  model?: string;
  timeout?: number;
  baseBranch?: string;
  branchName?: string;
  checkpointInterval?: number;
  continueOnStepFailure?: boolean;
  captureFileChanges?: boolean;
  captureToolCalls?: boolean;
}

/**
 * Template variable context for rendering
 */
export interface TemplateContext {
  issueId: string;
  title: string;
  description: string;
  relatedSpecs?: Array<{ id: string; title: string }>;
  feedback?: Array<{ issueId: string; content: string }>;
}

/**
 * Result from prepareExecution - preview before starting
 */
export interface ExecutionPrepareResult {
  renderedPrompt: string;
  issue: {
    id: string;
    title: string;
    content: string;
  };
  relatedSpecs: Array<{ id: string; title: string }>;
  defaultConfig: ExecutionConfig;
  warnings?: string[];
  errors?: string[];
}

/**
 * ExecutionService
 *
 * Manages the full lifecycle of issue-based executions:
 * - Preparing execution with template rendering
 * - Creating and starting executions with worktree isolation
 * - Creating follow-up executions that reuse worktrees
 * - Canceling and cleaning up executions
 */
export class ExecutionService {
  private db: Database.Database;
  private templateEngine: PromptTemplateEngine;
  private lifecycleService: ExecutionLifecycleService;
  private repoPath: string;
  private transportManager?: TransportManager;
  private logsStore: ExecutionLogsStore;
  private activeOrchestrators = new Map<string, LinearOrchestrator>();

  /**
   * Create a new ExecutionService
   *
   * @param db - Database instance
   * @param repoPath - Path to the git repository
   * @param lifecycleService - Optional execution lifecycle service (creates one if not provided)
   * @param transportManager - Optional transport manager for SSE streaming
   * @param logsStore - Optional execution logs store (creates one if not provided)
   */
  constructor(
    db: Database.Database,
    repoPath: string,
    lifecycleService?: ExecutionLifecycleService,
    transportManager?: TransportManager,
    logsStore?: ExecutionLogsStore
  ) {
    this.db = db;
    this.repoPath = repoPath;
    this.templateEngine = new PromptTemplateEngine();
    this.lifecycleService =
      lifecycleService || new ExecutionLifecycleService(db, repoPath);
    this.transportManager = transportManager;
    this.logsStore = logsStore || new ExecutionLogsStore(db);
  }

  /**
   * Prepare execution - load issue, render template, return preview
   *
   * This method loads the issue and related context, renders the template,
   * and returns a preview for the user to review before starting execution.
   *
   * @param issueId - ID of issue to prepare execution for
   * @param options - Optional template and config overrides
   * @returns Execution prepare result with rendered prompt and context
   */
  async prepareExecution(
    issueId: string,
    options?: {
      templateId?: string;
      config?: Partial<ExecutionConfig>;
    }
  ): Promise<ExecutionPrepareResult> {
    // 1. Load issue
    const issue = this.db
      .prepare("SELECT * FROM issues WHERE id = ?")
      .get(issueId) as
      | { id: string; title: string; content: string }
      | undefined;

    if (!issue) {
      throw new Error(`Issue ${issueId} not found`);
    }

    // 2. Load related specs (via implements/references relationships)
    const relatedSpecs = this.db
      .prepare(
        `
      SELECT DISTINCT s.id, s.title
      FROM specs s
      JOIN relationships r ON r.to_id = s.id AND r.to_type = 'spec'
      WHERE r.from_id = ? AND r.from_type = 'issue'
        AND r.relationship_type IN ('implements', 'references')
      ORDER BY s.title
    `
      )
      .all(issueId) as Array<{ id: string; title: string }>;

    // 3. Build context for template rendering
    const context: TemplateContext = {
      issueId: issue.id,
      title: issue.title,
      description: issue.content,
      relatedSpecs:
        relatedSpecs.length > 0
          ? relatedSpecs.map((s) => ({
              id: s.id,
              title: s.title,
            }))
          : undefined,
    };

    // 4. Get template (use custom template if provided, otherwise default)
    let template: string;
    if (options?.templateId) {
      const customTemplate = getTemplateById(this.db, options.templateId);
      if (!customTemplate) {
        throw new Error(`Template ${options.templateId} not found`);
      }
      template = customTemplate.template;
    } else {
      const defaultTemplate = getDefaultTemplate(this.db, "issue");
      if (!defaultTemplate) {
        throw new Error("Default issue template not found");
      }
      template = defaultTemplate.template;
    }

    // 5. Render template
    const renderedPrompt = this.templateEngine.render(template, context);

    // 6. Get default config
    const defaultConfig: ExecutionConfig = {
      mode: "worktree",
      model: "claude-sonnet-4",
      baseBranch: "main",
      checkpointInterval: 1,
      continueOnStepFailure: false,
      captureFileChanges: true,
      captureToolCalls: true,
      ...options?.config,
    };

    // 7. Validate
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!renderedPrompt.trim()) {
      errors.push("Rendered prompt is empty");
    }

    return {
      renderedPrompt,
      issue: {
        id: issue.id,
        title: issue.title,
        content: issue.content,
      },
      relatedSpecs,
      defaultConfig,
      warnings,
      errors,
    };
  }

  /**
   * Create and start execution
   *
   * Creates an execution record, sets up worktree (if needed), and starts
   * workflow execution. Returns the execution record immediately while
   * workflow runs in the background.
   *
   * @param issueId - ID of issue to execute
   * @param config - Execution configuration
   * @param prompt - Rendered prompt to execute
   * @returns Created execution record
   */
  async createExecution(
    issueId: string,
    config: ExecutionConfig,
    prompt: string
  ): Promise<Execution> {
    // 1. Validate
    if (!prompt.trim()) {
      throw new Error("Prompt cannot be empty");
    }

    const issue = this.db
      .prepare("SELECT * FROM issues WHERE id = ?")
      .get(issueId) as { id: string; title: string } | undefined;

    if (!issue) {
      throw new Error(`Issue ${issueId} not found`);
    }

    // 2. Determine execution mode and create execution with worktree
    const mode = config.mode || "worktree";
    let execution: Execution;
    let workDir: string;

    if (mode === "worktree") {
      // Create execution with isolated worktree
      const result = await this.lifecycleService.createExecutionWithWorktree({
        issueId,
        issueTitle: issue.title,
        agentType: "claude-code",
        targetBranch: config.baseBranch || "main",
        repoPath: this.repoPath,
        mode: mode,
        prompt: prompt,
        config: JSON.stringify(config),
      });

      execution = result.execution;
      workDir = result.worktreePath;
    } else {
      // Local mode - create execution without worktree
      const executionId = randomUUID();
      execution = createExecution(this.db, {
        id: executionId,
        issue_id: issueId,
        agent_type: "claude-code",
        mode: mode,
        prompt: prompt,
        config: JSON.stringify(config),
        target_branch: config.baseBranch || "main",
        branch_name: config.baseBranch || "main",
      });
      workDir = this.repoPath;
    }

    // Initialize empty logs for this execution
    try {
      this.logsStore.initializeLogs(execution.id);
    } catch (error) {
      console.error(
        "[ExecutionService] Failed to initialize logs (non-critical):",
        {
          executionId: execution.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Don't fail execution creation - logs are nice-to-have
    }

    // 3. Build WorkflowDefinition
    const workflow: WorkflowDefinition = {
      id: `workflow-${execution.id}`,
      steps: [
        {
          id: "execute-issue",
          taskType: "issue",
          prompt,
          taskConfig: {
            model: config.model || "claude-sonnet-4",
            timeout: config.timeout,
            captureFileChanges: config.captureFileChanges ?? true,
            captureToolCalls: config.captureToolCalls ?? true,
          },
        },
      ],
      config: {
        checkpointInterval: config.checkpointInterval ?? 1,
        continueOnStepFailure: config.continueOnStepFailure ?? false,
        timeout: config.timeout,
      },
      metadata: {
        workDir,
        issueId,
        executionId: execution.id,
      },
    };

    // 4. Create execution engine stack
    const processManager = new SimpleProcessManager({
      executablePath: "claude",
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
      ],
    });

    let engine = new SimpleExecutionEngine(processManager, {
      maxConcurrent: 1, // One task at a time for issue execution
    });

    let executor = new ResilientExecutor(engine);

    // 5. Create AG-UI system (processor + adapter) if transport manager is available
    let agUiAdapter: AgUiEventAdapter | undefined;
    if (this.transportManager) {
      const agUiSystem = createAgUiSystem(execution.id);
      agUiAdapter = agUiSystem.adapter;

      // Connect adapter to transport for SSE streaming
      this.transportManager.connectAdapter(agUiAdapter, execution.id);

      // Register session handler to capture session_id and store in database
      agUiSystem.processor.onSession((sessionId: string) => {
        console.log(
          `[ExecutionService] Session ID detected: ${sessionId} for execution ${execution.id}`
        );
        try {
          updateExecution(this.db, execution.id, {
            session_id: sessionId,
          });
        } catch (error) {
          console.error(
            "[ExecutionService] Failed to update session_id (non-critical):",
            {
              executionId: execution.id,
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      });

      // Connect processor to execution engine for real-time output parsing
      // Buffer for incomplete lines (stream-json can split mid-line)
      let lineBuffer = "";

      engine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 1,
        // TODO: Factor out this logic for DRY principles.
        onOutput: (data, type) => {
          if (type === "stdout") {
            // Append new data to buffer
            lineBuffer += data.toString();

            // Process complete lines (ending with \n)
            let newlineIndex;
            while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
              const line = lineBuffer.slice(0, newlineIndex);
              lineBuffer = lineBuffer.slice(newlineIndex + 1);

              if (line.trim()) {
                // 1. Persist raw log immediately (before processing)
                try {
                  this.logsStore.appendRawLog(execution.id, line);
                } catch (err) {
                  console.error(
                    "[ExecutionService] Failed to persist raw log (non-critical):",
                    {
                      executionId: execution.id,
                      error: err instanceof Error ? err.message : String(err),
                    }
                  );
                  // Don't crash execution - logs are nice-to-have
                }

                // 2. Process through AG-UI pipeline for live clients
                agUiSystem.processor.processLine(line).catch((err) => {
                  console.error(
                    "[ExecutionService] Error processing output line:",
                    {
                      error: err instanceof Error ? err.message : String(err),
                      line: line.slice(0, 100), // Log first 100 chars for debugging
                    }
                  );
                });
              }
            }
          }
        },
      });
      executor = new ResilientExecutor(engine);
    }

    // 6. Create LinearOrchestrator
    const orchestrator = new LinearOrchestrator(
      executor,
      undefined, // No storage/checkpointing for now
      agUiAdapter,
      this.lifecycleService
    );

    // 7. Register event handlers to update execution status in database
    orchestrator.onWorkflowStart(() => {
      try {
        updateExecution(this.db, execution.id, {
          status: "running",
        });
      } catch (error) {
        console.error(
          "[ExecutionService] Failed to update execution status to running",
          {
            executionId: execution.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    });

    orchestrator.onWorkflowComplete(() => {
      console.log("[ExecutionService] Workflow completed successfully", {
        executionId: execution.id,
      });
      try {
        updateExecution(this.db, execution.id, {
          status: "completed",
          completed_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error(
          "[ExecutionService] Failed to update execution status to completed",
          {
            executionId: execution.id,
            error: error instanceof Error ? error.message : String(error),
            note: "Execution may have been deleted (e.g., due to CASCADE DELETE from issue deletion)",
          }
        );
      }
      // Remove orchestrator from active map
      this.activeOrchestrators.delete(execution.id);
    });

    orchestrator.onWorkflowFailed((_executionId, error) => {
      console.error("[ExecutionService] Workflow failed", {
        executionId: execution.id,
        error: error.message,
        stack: error.stack,
      });
      try {
        updateExecution(this.db, execution.id, {
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error.message,
        });
      } catch (updateError) {
        console.error(
          "[ExecutionService] Failed to update execution status to failed",
          {
            executionId: execution.id,
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
            note: "Execution may have been deleted (e.g., due to CASCADE DELETE from issue deletion)",
          }
        );
      }
      // Remove orchestrator from active map
      this.activeOrchestrators.delete(execution.id);
    });

    // 8. Start workflow execution (non-blocking)
    orchestrator.startWorkflow(workflow, workDir, {
      checkpointInterval: config.checkpointInterval,
      executionId: execution.id,
    });

    // 9. Store orchestrator for later cancellation
    this.activeOrchestrators.set(execution.id, orchestrator);

    return execution;
  }

  /**
   * Resume a previous Claude Code session
   *
   * Creates a new execution that resumes a previous Claude Code session using
   * the --resume flag. This preserves the full conversational context from the
   * original session, allowing the user to continue where they left off.
   *
   * @param executionId - ID of execution whose session to resume
   * @param prompt - New prompt to send in the resumed session
   * @returns Created execution record with parent_execution_id set
   */
  async resumeSession(
    executionId: string,
    prompt: string
  ): Promise<Execution> {
    // 1. Get previous execution
    const prevExecution = getExecution(this.db, executionId);
    if (!prevExecution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // 2. Verify execution has a session_id
    if (!prevExecution.session_id) {
      throw new Error(
        `Cannot resume: execution ${executionId} has no session_id. ` +
          `Session resumption requires a Claude Code session ID.`
      );
    }

    // 3. Verify execution has an issue_id
    if (!prevExecution.issue_id) {
      throw new Error(
        `Cannot resume: execution ${executionId} has no issue_id`
      );
    }

    // 4. Check if worktree still exists, recreate if needed
    if (prevExecution.worktree_path && this.lifecycleService) {
      const fs = await import("fs");
      const worktreeExists = fs.existsSync(prevExecution.worktree_path);

      if (!worktreeExists) {
        console.log(
          `Recreating worktree for resumed execution: ${prevExecution.worktree_path}`
        );

        // Recreate the worktree using the same path and branch
        const worktreeManager = (this.lifecycleService as any).worktreeManager;
        await worktreeManager.createWorktree({
          repoPath: this.repoPath,
          branchName: prevExecution.branch_name,
          worktreePath: prevExecution.worktree_path,
          baseBranch: prevExecution.target_branch,
          createBranch: false, // Branch already exists, just recreate worktree
        });
      }
    }

    // 5. Create new execution record with parent_execution_id
    const newExecutionId = randomUUID();
    const newExecution = createExecution(this.db, {
      id: newExecutionId,
      issue_id: prevExecution.issue_id,
      agent_type: "claude-code",
      target_branch: prevExecution.target_branch,
      branch_name: prevExecution.branch_name,
      worktree_path: prevExecution.worktree_path,
      config: prevExecution.config || undefined,
      mode: prevExecution.mode || undefined,
      prompt: prompt,
    });

    // 6. Set parent_execution_id to track the relationship
    updateExecution(this.db, newExecution.id, {
      // Store parent relationship for execution chain tracking
    });

    // Update to set parent_execution_id (updateExecution doesn't support it yet, so we'll do it directly)
    const stmt = this.db.prepare(`
      UPDATE executions
      SET parent_execution_id = ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(executionId, new Date().toISOString(), newExecution.id);

    // Initialize empty logs for this execution
    try {
      this.logsStore.initializeLogs(newExecution.id);
    } catch (error) {
      console.error(
        "[ExecutionService] Failed to initialize logs (non-critical):",
        {
          executionId: newExecution.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // 7. Build WorkflowDefinition with resume configuration
    const workflow: WorkflowDefinition = {
      id: `workflow-${newExecution.id}`,
      steps: [
        {
          id: "resume-session",
          taskType: "issue",
          prompt: prompt,
          taskConfig: {
            model: prevExecution.model || "claude-sonnet-4",
            captureFileChanges: true,
            captureToolCalls: true,
            // Pass session_id for resume
            resumeSessionId: prevExecution.session_id,
          },
        },
      ],
      config: {
        checkpointInterval: 1,
        continueOnStepFailure: false,
      },
      metadata: {
        workDir: prevExecution.worktree_path || this.repoPath,
        issueId: prevExecution.issue_id,
        executionId: newExecution.id,
        resumedFrom: executionId,
        originalSessionId: prevExecution.session_id,
      },
    };

    // 8. Create execution engine stack with --resume flag
    const processManager = new SimpleProcessManager({
      executablePath: "claude",
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--resume",
        prevExecution.session_id, // Pass session_id to Claude Code
      ],
    });

    let engine = new SimpleExecutionEngine(processManager, {
      maxConcurrent: 1,
    });

    let executor = new ResilientExecutor(engine);

    // 9. Create AG-UI system (processor + adapter) if transport manager is available
    let agUiAdapter: AgUiEventAdapter | undefined;
    if (this.transportManager) {
      const agUiSystem = createAgUiSystem(newExecution.id);
      agUiAdapter = agUiSystem.adapter;
      this.transportManager.connectAdapter(agUiAdapter, newExecution.id);

      // Register session handler to capture session_id (might be different after resume)
      agUiSystem.processor.onSession((sessionId: string) => {
        console.log(
          `[ExecutionService] Session ID detected: ${sessionId} for resumed execution ${newExecution.id}`
        );
        try {
          updateExecution(this.db, newExecution.id, {
            session_id: sessionId,
          });
        } catch (error) {
          console.error(
            "[ExecutionService] Failed to update session_id (non-critical):",
            {
              executionId: newExecution.id,
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      });

      // Connect processor to execution engine for real-time output parsing
      let lineBuffer = "";

      engine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 1,
        onOutput: (data, type) => {
          if (type === "stdout") {
            lineBuffer += data.toString();

            let newlineIndex;
            while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
              const line = lineBuffer.slice(0, newlineIndex);
              lineBuffer = lineBuffer.slice(newlineIndex + 1);

              if (line.trim()) {
                // 1. Persist raw log
                try {
                  this.logsStore.appendRawLog(newExecution.id, line);
                } catch (err) {
                  console.error(
                    "[ExecutionService] Failed to persist raw log (non-critical):",
                    {
                      executionId: newExecution.id,
                      error: err instanceof Error ? err.message : String(err),
                    }
                  );
                }

                // 2. Process through AG-UI pipeline
                agUiSystem.processor.processLine(line).catch((err) => {
                  console.error(
                    "[ExecutionService] Error processing output line:",
                    {
                      error: err instanceof Error ? err.message : String(err),
                      line: line.slice(0, 100),
                    }
                  );
                });
              }
            }
          }
        },
      });
      executor = new ResilientExecutor(engine);
    }

    // 10. Create LinearOrchestrator
    const orchestrator = new LinearOrchestrator(
      executor,
      undefined,
      agUiAdapter,
      this.lifecycleService
    );

    // 11. Register event handlers
    orchestrator.onWorkflowStart(() => {
      try {
        updateExecution(this.db, newExecution.id, {
          status: "running",
        });
      } catch (error) {
        console.error(
          "[ExecutionService] Failed to update resumed execution status to running",
          {
            executionId: newExecution.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    });

    orchestrator.onWorkflowComplete(() => {
      try {
        updateExecution(this.db, newExecution.id, {
          status: "completed",
          completed_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error(
          "[ExecutionService] Failed to update resumed execution status to completed",
          {
            executionId: newExecution.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
      this.activeOrchestrators.delete(newExecution.id);
    });

    orchestrator.onWorkflowFailed((_execId, error) => {
      try {
        updateExecution(this.db, newExecution.id, {
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error.message,
        });
      } catch (updateError) {
        console.error(
          "[ExecutionService] Failed to update resumed execution status to failed",
          {
            executionId: newExecution.id,
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
          }
        );
      }
      this.activeOrchestrators.delete(newExecution.id);
    });

    // 12. Start workflow execution (non-blocking)
    orchestrator.startWorkflow(
      workflow,
      prevExecution.worktree_path || this.repoPath,
      {
        checkpointInterval: 1,
        executionId: newExecution.id,
      }
    );

    // 13. Store orchestrator for later cancellation
    this.activeOrchestrators.set(newExecution.id, orchestrator);

    return newExecution;
  }

  /**
   * Create follow-up execution - reuse worktree from previous execution
   *
   * Creates a new execution that reuses the worktree from a previous execution,
   * appending feedback or additional context to the prompt.
   *
   * @param executionId - ID of previous execution to follow up on
   * @param feedback - Additional feedback/context to append to prompt
   * @returns Created follow-up execution record
   */
  async createFollowUp(
    executionId: string,
    feedback: string
  ): Promise<Execution> {
    // 1. Get previous execution
    const prevExecution = getExecution(this.db, executionId);
    if (!prevExecution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (!prevExecution.worktree_path) {
      throw new Error(
        `Cannot create follow-up: execution ${executionId} has no worktree`
      );
    }

    // Check if worktree still exists on filesystem, recreate if needed
    if (this.lifecycleService) {
      const fs = await import("fs");
      const worktreeExists = fs.existsSync(prevExecution.worktree_path);

      if (!worktreeExists) {
        console.log(
          `Recreating worktree for follow-up execution: ${prevExecution.worktree_path}`
        );

        // Recreate the worktree using the same path and branch
        const worktreeManager = (this.lifecycleService as any).worktreeManager;
        await worktreeManager.createWorktree({
          repoPath: this.repoPath,
          branchName: prevExecution.branch_name,
          worktreePath: prevExecution.worktree_path,
          baseBranch: prevExecution.target_branch,
          createBranch: false, // Branch already exists, just recreate worktree
        });
      }
    }

    // 2. Validate that previous execution has an issue_id
    if (!prevExecution.issue_id) {
      throw new Error("Previous execution must have an issue_id for follow-up");
    }

    // 3. Prepare execution to get rendered prompt
    const prepareResult = await this.prepareExecution(prevExecution.issue_id);

    // 4. Append feedback to prompt
    const followUpPrompt = `${prepareResult.renderedPrompt}

## Follow-up Feedback
${feedback}

Please continue working on this issue, taking into account the feedback above.`;

    // 5. Create new execution record that references previous execution
    const newExecutionId = randomUUID();
    const newExecution = createExecution(this.db, {
      id: newExecutionId,
      issue_id: prevExecution.issue_id,
      agent_type: "claude-code",
      target_branch: prevExecution.target_branch,
      branch_name: prevExecution.branch_name,
      // TODO: Handle case where worktree has been deleted.
      worktree_path: prevExecution.worktree_path, // Reuse same worktree
      config: prevExecution.config || undefined, // Preserve config (including cleanupMode) from previous execution
    });

    // Initialize empty logs for this execution
    try {
      this.logsStore.initializeLogs(newExecution.id);
    } catch (error) {
      console.error(
        "[ExecutionService] Failed to initialize logs (non-critical):",
        {
          executionId: newExecution.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Don't fail execution creation - logs are nice-to-have
    }

    // 5. Build WorkflowDefinition
    const workflow: WorkflowDefinition = {
      id: `workflow-${newExecution.id}`,
      steps: [
        {
          id: "execute-followup",
          taskType: "issue",
          prompt: followUpPrompt,
          taskConfig: {
            model: "claude-sonnet-4",
            captureFileChanges: true,
            captureToolCalls: true,
          },
        },
      ],
      config: {
        checkpointInterval: 1,
        continueOnStepFailure: false,
      },
      metadata: {
        workDir: prevExecution.worktree_path,
        issueId: prevExecution.issue_id,
        executionId: newExecution.id,
        followUpOf: executionId,
      },
    };

    // 6. Create execution engine stack
    const processManager = new SimpleProcessManager({
      executablePath: "claude",
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
      ],
    });

    let engine = new SimpleExecutionEngine(processManager, {
      maxConcurrent: 1,
    });

    let executor = new ResilientExecutor(engine);

    // 7. Create AG-UI system (processor + adapter) if transport manager is available
    let agUiAdapter: AgUiEventAdapter | undefined;
    if (this.transportManager) {
      const agUiSystem = createAgUiSystem(newExecution.id);
      agUiAdapter = agUiSystem.adapter;
      this.transportManager.connectAdapter(agUiAdapter, newExecution.id);

      // Register session handler to capture session_id and store in database
      agUiSystem.processor.onSession((sessionId: string) => {
        console.log(
          `[ExecutionService] Session ID detected: ${sessionId} for follow-up execution ${newExecution.id}`
        );
        try {
          updateExecution(this.db, newExecution.id, {
            session_id: sessionId,
          });
        } catch (error) {
          console.error(
            "[ExecutionService] Failed to update session_id (non-critical):",
            {
              executionId: newExecution.id,
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      });

      // Connect processor to execution engine for real-time output parsing
      // Buffer for incomplete lines (stream-json can split mid-line)
      let lineBuffer = "";

      engine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 1,
        // TODO: Factor out this logic for DRY principles.
        onOutput: (data, type) => {
          if (type === "stdout") {
            // Append new data to buffer
            lineBuffer += data.toString();

            // Process complete lines (ending with \n)
            let newlineIndex;
            while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
              const line = lineBuffer.slice(0, newlineIndex);
              lineBuffer = lineBuffer.slice(newlineIndex + 1);

              if (line.trim()) {
                // 1. Persist raw log immediately (before processing)
                try {
                  this.logsStore.appendRawLog(newExecution.id, line);
                } catch (err) {
                  console.error(
                    "[ExecutionService] Failed to persist raw log (non-critical):",
                    {
                      executionId: newExecution.id,
                      error: err instanceof Error ? err.message : String(err),
                    }
                  );
                  // Don't crash execution - logs are nice-to-have
                }

                // 2. Process through AG-UI pipeline for live clients
                agUiSystem.processor.processLine(line).catch((err) => {
                  console.error(
                    "[ExecutionService] Error processing output line:",
                    {
                      error: err instanceof Error ? err.message : String(err),
                      line: line.slice(0, 100), // Log first 100 chars for debugging
                    }
                  );
                });
              }
            }
          }
        },
      });
      executor = new ResilientExecutor(engine);
    }

    // 8. Create LinearOrchestrator
    const orchestrator = new LinearOrchestrator(
      executor,
      undefined,
      agUiAdapter,
      this.lifecycleService
    );

    // 9. Register event handlers
    orchestrator.onWorkflowStart(() => {
      try {
        updateExecution(this.db, newExecution.id, {
          status: "running",
        });
      } catch (error) {
        console.error(
          "[ExecutionService] Failed to update follow-up execution status to running",
          {
            executionId: newExecution.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    });

    orchestrator.onWorkflowComplete(() => {
      try {
        updateExecution(this.db, newExecution.id, {
          status: "completed",
          completed_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error(
          "[ExecutionService] Failed to update follow-up execution status to completed",
          {
            executionId: newExecution.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
      this.activeOrchestrators.delete(newExecution.id);
    });

    orchestrator.onWorkflowFailed((_execId, error) => {
      try {
        updateExecution(this.db, newExecution.id, {
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error.message,
        });
      } catch (updateError) {
        console.error(
          "[ExecutionService] Failed to update follow-up execution status to failed",
          {
            executionId: newExecution.id,
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
          }
        );
      }
      this.activeOrchestrators.delete(newExecution.id);
    });

    // 10. Start workflow execution (non-blocking)
    orchestrator.startWorkflow(workflow, prevExecution.worktree_path, {
      checkpointInterval: 1,
      executionId: newExecution.id,
    });

    // 11. Store orchestrator for later cancellation
    this.activeOrchestrators.set(newExecution.id, orchestrator);

    return newExecution;
  }

  /**
   * Cancel a running execution
   *
   * Stops the workflow execution and marks the execution as cancelled.
   * Optionally cleans up the worktree based on config.
   *
   * @param executionId - ID of execution to cancel
   */
  async cancelExecution(executionId: string): Promise<void> {
    const execution = getExecution(this.db, executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status !== "running") {
      throw new Error(`Cannot cancel execution in ${execution.status} state`);
    }

    // Get orchestrator from active map
    const orchestrator = this.activeOrchestrators.get(executionId);
    if (orchestrator) {
      // Cancel via orchestrator
      await orchestrator.cancelWorkflow(executionId);
      // Remove from active map
      this.activeOrchestrators.delete(executionId);
    }

    // Update status in database (orchestrator.cancelWorkflow doesn't emit events for DB update)
    updateExecution(this.db, executionId, {
      status: "stopped",
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Clean up execution resources
   *
   * Removes the worktree and associated files. This is called automatically
   * on workflow completion, or can be called manually.
   *
   * @param executionId - ID of execution to clean up
   */
  async cleanupExecution(executionId: string): Promise<void> {
    await this.lifecycleService.cleanupExecution(executionId);
  }

  /**
   * Check if worktree exists in filesystem for an execution
   *
   * @param executionId - ID of execution to check
   * @returns true if worktree exists, false otherwise
   */
  async worktreeExists(executionId: string): Promise<boolean> {
    const execution = getExecution(this.db, executionId);
    if (!execution || !execution.worktree_path) {
      return false;
    }

    const fs = await import("fs");
    return fs.existsSync(execution.worktree_path);
  }

  /**
   * Delete worktree for an execution
   *
   * Manually deletes the worktree for a specific execution, regardless of
   * cleanupMode configuration. This allows users to manually cleanup worktrees
   * when they're configured for manual cleanup.
   *
   * @param executionId - ID of execution whose worktree to delete
   * @throws Error if execution not found, has no worktree, or worktree doesn't exist
   */
  async deleteWorktree(executionId: string): Promise<void> {
    const execution = getExecution(this.db, executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (!execution.worktree_path) {
      throw new Error(`Execution ${executionId} has no worktree to delete`);
    }

    // Check if worktree exists in the filesystem
    const fs = await import("fs");
    const worktreeExists = fs.existsSync(execution.worktree_path);

    if (!worktreeExists) {
      throw new Error(
        `Worktree does not exist in filesystem: ${execution.worktree_path}`
      );
    }

    // TODO: Cancel any running execution.

    // Get worktree manager from lifecycle service
    const worktreeManager = (this.lifecycleService as any).worktreeManager;

    // Clean up the worktree
    await worktreeManager.cleanupWorktree(
      execution.worktree_path,
      this.repoPath
    );
  }

  /**
   * Shutdown execution service - cancel all active executions
   *
   * This is called during server shutdown to gracefully terminate
   * all running executions before the server exits.
   */
  async shutdown(): Promise<void> {
    const cancelPromises: Promise<void>[] = [];

    // Cancel all active orchestrators
    for (const [
      executionId,
      orchestrator,
    ] of this.activeOrchestrators.entries()) {
      cancelPromises.push(
        orchestrator.cancelWorkflow(executionId).catch((error) => {
          console.error("[ExecutionService] Error canceling execution", {
            executionId,
            error: error.message,
          });
        })
      );
    }

    // Wait for all cancellations to complete (with timeout)
    await Promise.race([
      Promise.all(cancelPromises),
      new Promise((resolve) => setTimeout(resolve, 5000)), // 5 second timeout
    ]);
  }

  /**
   * List all executions for an issue
   *
   * Returns all executions associated with a specific issue,
   * ordered by creation time (most recent first).
   *
   * @param issueId - ID of issue to list executions for
   * @returns Array of executions for the issue
   */
  listExecutions(issueId: string): Execution[] {
    const executions = this.db
      .prepare(
        `
      SELECT * FROM executions
      WHERE issue_id = ?
      ORDER BY created_at DESC
    `
      )
      .all(issueId) as Execution[];

    return executions;
  }

  /**
   * Get a single execution by ID
   *
   * @param executionId - ID of execution to retrieve
   * @returns Execution or null if not found
   */
  getExecution(executionId: string): Execution | null {
    return getExecution(this.db, executionId);
  }
}
