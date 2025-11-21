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
import {
  SimpleProcessManager,
  SimpleExecutionEngine,
  ResilientExecutor,
  LinearOrchestrator,
  type WorkflowDefinition,
} from "agent-execution-engine";
import { createAgUiSystem } from "../execution/output/ag-ui-integration.js";
import type { AgUiEventAdapter } from "../execution/output/ag-ui-adapter.js";
import type { TransportManager } from "../execution/transport/transport-manager.js";
import { ExecutionLogsStore } from "./execution-logs-store.js";
import { DirectRunnerAdapter } from "../execution/adapters/direct-runner-adapter.js";
import type { IAgentExecutor } from "agent-execution-engine/agents";
import { ClaudeCodeExecutor } from "agent-execution-engine/agents";
import type { ExecutionTask } from "agent-execution-engine/engine";

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
  executorMode?: "legacy" | "direct-runner";
  agentType?: "claude-code";
  agentProfile?: string;
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

  // ============================================================================
  // Private Methods - Executor Factory (Phase 2)
  // ============================================================================

  /**
   * Create agent executor based on executor mode
   *
   * @param config - Execution configuration
   * @param workDir - Working directory for execution
   * @returns Executor instance
   */
  private createExecutor(
    config: ExecutionConfig,
    workDir: string
  ): IAgentExecutor {
    // Always use direct-runner (legacy removed)
    return this.createDirectRunnerExecutor(config, workDir);
  }

  /**
   * Create direct runner executor (ClaudeCodeExecutor)
   *
   * Phase 2 only supports Claude Code. Cursor/Copilot in Phase 3.
   *
   * @param config - Execution configuration
   * @param workDir - Working directory
   * @returns ClaudeCodeExecutor instance
   */
  private createDirectRunnerExecutor(
    config: ExecutionConfig,
    workDir: string
  ): IAgentExecutor {
    const agentType = config.agentType || "claude-code";

    if (agentType !== "claude-code") {
      throw new Error(
        `Unsupported agent type in Phase 2: ${agentType}. Only claude-code is supported.`
      );
    }

    // Create ClaudeCodeExecutor with config
    const executor = new ClaudeCodeExecutor({
      workDir,
      print: true,
      outputFormat: "stream-json",
      verbose: true,
      dangerouslySkipPermissions: true,
      ...(config.model && { model: config.model }),
    });

    return executor;
  }

  /**
   * Execute task using direct runner adapter
   *
   * Creates DirectRunnerAdapter, executes task, and handles lifecycle events.
   *
   * @param execution - Execution record
   * @param prompt - Rendered prompt
   * @param config - Execution configuration
   * @param workDir - Working directory
   */
  private async executeWithDirectRunner(
    execution: Execution,
    prompt: string,
    config: ExecutionConfig,
    workDir: string
  ): Promise<void> {
    try {
      // 1. Create executor
      const executor = this.createExecutor(config, workDir);

      // 2. Create AG-UI adapter for event streaming (if transport available)
      let agUiAdapter: AgUiEventAdapter | undefined;
      if (this.transportManager) {
        const agUiSystem = createAgUiSystem(execution.id);
        agUiAdapter = agUiSystem.adapter;
        this.transportManager.connectAdapter(agUiAdapter, execution.id);

        // Emit RUN_STARTED
        agUiAdapter.emitRunStarted({
          executionId: execution.id,
          mode: "direct-runner",
        });
      }

      // 3. Create DirectRunnerAdapter
      const adapter = new DirectRunnerAdapter(
        executor,
        agUiAdapter,
        this.logsStore
      );

      // 4. Create execution task
      const task: ExecutionTask = {
        id: execution.id,
        type: "issue",
        prompt,
        workDir,
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          timeout: config.timeout,
        },
      };

      // 5. Update status to running
      updateExecution(this.db, execution.id, {
        status: "running",
      });

      // 6. Execute and stream
      await adapter.executeAndStream(task, execution.id, workDir);

      // 7. Update execution status to completed
      updateExecution(this.db, execution.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      // 8. Emit RUN_FINISHED
      if (agUiAdapter) {
        agUiAdapter.emitRunFinished({ status: "completed" });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("[ExecutionService] Direct runner execution failed:", {
        executionId: execution.id,
        error: errorMessage,
        stack: errorStack,
      });

      // Update execution status to failed
      updateExecution(this.db, execution.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      });

      throw error;
    }
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

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
        agentType: config.agentType || "claude-code",
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
        agent_type: config.agentType || "claude-code",
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

    // 3. Execute with direct runner (uses agent-execution-engine)
    await this.executeWithDirectRunner(execution, prompt, config, workDir);
    return execution;
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
    const processManager = new SimpleProcessManager();

    let engine = new SimpleExecutionEngine(processManager, {
      maxConcurrent: 1,
      defaultProcessConfig: {
        executablePath: "claude",
        args: [
          "--print",
          "--output-format",
          "stream-json",
          "--verbose",
          "--dangerously-skip-permissions",
        ],
      },
    });

    let executor = new ResilientExecutor(engine);

    // 7. Create AG-UI system (processor + adapter) if transport manager is available
    let agUiAdapter: AgUiEventAdapter | undefined;
    if (this.transportManager) {
      const agUiSystem = createAgUiSystem(newExecution.id);
      agUiAdapter = agUiSystem.adapter;
      this.transportManager.connectAdapter(agUiAdapter, newExecution.id);

      // Connect processor to execution engine for real-time output parsing
      // Buffer for incomplete lines (stream-json can split mid-line)
      let lineBuffer = "";

      engine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 1,
        defaultProcessConfig: {
          executablePath: "claude",
          args: [
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
          ],
        },
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
