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
import type { ExecutionTask } from "agent-execution-engine/engine";
import type { TransportManager } from "../execution/transport/transport-manager.js";
import { ExecutionLogsStore } from "./execution-logs-store.js";
import { ExecutionWorkerPool } from "./execution-worker-pool.js";
import { broadcastExecutionUpdate } from "./websocket.js";
import { GitCli } from "../execution/worktree/git-cli.js";
import { createExecutorForAgent } from "../execution/executors/executor-factory.js";
import type { AgentType } from "@sudocode-ai/types/agents";

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
  private projectId: string;
  private templateEngine: PromptTemplateEngine;
  private lifecycleService: ExecutionLifecycleService;
  private repoPath: string;
  private transportManager?: TransportManager;
  private logsStore: ExecutionLogsStore;
  private workerPool?: ExecutionWorkerPool;

  /**
   * Create a new ExecutionService
   *
   * @param db - Database instance
   * @param projectId - Project ID for WebSocket broadcasts
   * @param repoPath - Path to the git repository
   * @param lifecycleService - Optional execution lifecycle service (creates one if not provided)
   * @param transportManager - Optional transport manager for SSE streaming
   * @param logsStore - Optional execution logs store (creates one if not provided)
   * @param workerPool - Optional worker pool for isolated execution processes
   */
  constructor(
    db: Database.Database,
    projectId: string,
    repoPath: string,
    lifecycleService?: ExecutionLifecycleService,
    transportManager?: TransportManager,
    logsStore?: ExecutionLogsStore,
    workerPool?: ExecutionWorkerPool
  ) {
    this.db = db;
    this.projectId = projectId;
    this.repoPath = repoPath;
    this.templateEngine = new PromptTemplateEngine();
    this.lifecycleService =
      lifecycleService || new ExecutionLifecycleService(db, repoPath);
    this.transportManager = transportManager;
    this.logsStore = logsStore || new ExecutionLogsStore(db);
    this.workerPool = workerPool;
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

    // 6. Get current branch as default base branch
    let currentBranch = "main"; // Fallback default
    try {
      const gitCli = new GitCli();
      currentBranch = await gitCli.getCurrentBranch(this.repoPath);
      // If detached HEAD, try to use 'main' as fallback
      if (currentBranch === "(detached)") {
        currentBranch = "main";
      }
    } catch (error) {
      console.warn(
        "Failed to get current branch, using 'main' as fallback:",
        error
      );
    }

    // 7. Get default config
    const defaultConfig: ExecutionConfig = {
      mode: "worktree",
      model: "claude-sonnet-4",
      baseBranch: currentBranch,
      checkpointInterval: 1,
      continueOnStepFailure: false,
      captureFileChanges: true,
      captureToolCalls: true,
      ...options?.config,
    };

    // 8. Validate
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
   * @param agentType - Type of agent to use (defaults to 'claude-code')
   * @returns Created execution record
   */
  async createExecution(
    issueId: string,
    config: ExecutionConfig,
    prompt: string,
    agentType: AgentType = "claude-code"
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
        agentType: agentType,
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
        agent_type: agentType,
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

    // 3. Start execution (use worker pool if available, otherwise fall back to in-process)
    if (this.workerPool) {
      // Worker pool handles all execution logic in isolated process
      const dbPath = this.db.name as string;
      await this.workerPool.startExecution(execution, this.repoPath, dbPath);

      // Broadcast execution creation
      broadcastExecutionUpdate(
        this.projectId,
        execution.id,
        "created",
        execution,
        execution.issue_id || undefined
      );

      return execution;
    }

    // 4. In-process execution with executor wrapper (fallback when no worker pool)
    const wrapper = createExecutorForAgent(
      agentType,
      { workDir: this.repoPath }, // Agent-specific config (minimal for now)
      {
        workDir: this.repoPath,
        lifecycleService: this.lifecycleService,
        logsStore: this.logsStore,
        projectId: this.projectId,
        db: this.db,
        transportManager: this.transportManager,
      }
    );

    // Build execution task
    const task: ExecutionTask = {
      id: execution.id,
      type: "issue",
      entityId: issueId,
      prompt: prompt,
      workDir: workDir,
      config: {
        timeout: config.timeout,
      },
      metadata: {
        model: config.model || "claude-sonnet-4",
        captureFileChanges: config.captureFileChanges ?? true,
        captureToolCalls: config.captureToolCalls ?? true,
        issueId,
        executionId: execution.id,
      },
      priority: 0,
      dependencies: [],
      createdAt: new Date(),
    };

    // Execute with full lifecycle management (non-blocking)
    wrapper.executeWithLifecycle(execution.id, task, workDir).catch((error) => {
      console.error(
        `[ExecutionService] Execution ${execution.id} failed:`,
        error
      );
      // Error is already handled by wrapper (status updated, broadcasts sent)
    });

    // Broadcast execution creation
    broadcastExecutionUpdate(
      this.projectId,
      execution.id,
      "created",
      execution,
      execution.issue_id || undefined
    );

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
    // Default to 'claude-code' if agent_type is null (for backwards compatibility)
    const agentType = (prevExecution.agent_type || "claude-code") as AgentType;

    const newExecutionId = randomUUID();
    const newExecution = createExecution(this.db, {
      id: newExecutionId,
      issue_id: prevExecution.issue_id,
      agent_type: agentType, // Use same agent as previous execution
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

    // 5. Use executor wrapper with session resumption
    const wrapper = createExecutorForAgent(
      agentType,
      { workDir: this.repoPath },
      {
        workDir: this.repoPath,
        lifecycleService: this.lifecycleService,
        logsStore: this.logsStore,
        projectId: this.projectId,
        db: this.db,
        transportManager: this.transportManager,
      }
    );

    // Extract session ID (use previous execution ID as session ID)
    const sessionId = prevExecution.id;

    // Parse config to get model and other settings
    const parsedConfig = prevExecution.config
      ? JSON.parse(prevExecution.config)
      : {};

    // Build execution task for follow-up
    const task: ExecutionTask = {
      id: newExecution.id,
      type: "issue",
      entityId: prevExecution.issue_id,
      prompt: followUpPrompt,
      workDir: prevExecution.worktree_path,
      config: {
        timeout: parsedConfig.timeout,
      },
      metadata: {
        model: parsedConfig.model || "claude-sonnet-4",
        captureFileChanges: parsedConfig.captureFileChanges ?? true,
        captureToolCalls: parsedConfig.captureToolCalls ?? true,
        issueId: prevExecution.issue_id,
        executionId: newExecution.id,
        followUpOf: executionId,
      },
      priority: 0,
      dependencies: [],
      createdAt: new Date(),
    };

    // Resume with session ID (non-blocking)
    wrapper
      .resumeWithLifecycle(
        newExecution.id,
        sessionId,
        task,
        prevExecution.worktree_path
      )
      .catch((error) => {
        console.error(
          `[ExecutionService] Follow-up execution ${newExecution.id} failed:`,
          error
        );
        // Error is already handled by wrapper (status updated, broadcasts sent)
      });

    // Broadcast execution creation
    broadcastExecutionUpdate(
      this.projectId,
      newExecution.id,
      "created",
      newExecution,
      newExecution.issue_id || undefined
    );

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

    // Use worker pool cancellation if available
    if (this.workerPool && this.workerPool.hasWorker(executionId)) {
      await this.workerPool.cancelExecution(executionId);
      return; // Worker pool handles DB updates and broadcasts
    }

    // For in-process executions using ClaudeExecutorWrapper:
    // The wrapper manages its own lifecycle and cancellation.
    // We update the database status, which the wrapper may check,
    // or we rely on process termination to stop execution.
    // TODO: Add cancellation registry in ClaudeExecutorWrapper for direct process control

    // Update status in database
    updateExecution(this.db, executionId, {
      status: "stopped",
      completed_at: new Date().toISOString(),
    });

    // Broadcast status change
    const updated = getExecution(this.db, executionId);
    if (updated) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        updated,
        updated.issue_id || undefined
      );
    }
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
    // Shutdown worker pool if available
    if (this.workerPool) {
      await this.workerPool.shutdown();
    }

    // For in-process executions using ClaudeExecutorWrapper:
    // The wrapper manages its own lifecycle. Processes will be terminated
    // when the Node.js process exits.
    // TODO: Add active execution tracking to ClaudeExecutorWrapper for graceful shutdown
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

  /**
   * Check if there are any active executions
   *
   * @returns true if there are active worker pool executions
   */
  hasActiveExecutions(): boolean {
    // Check worker pool for active executions
    if (this.workerPool) {
      return this.workerPool.getActiveWorkerCount() > 0;
    }

    // For in-process executions, we don't track them anymore
    // Query the database for running executions as a fallback
    const runningExecutions = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM executions WHERE status = 'running'"
      )
      .get() as { count: number };

    return runningExecutions.count > 0;
  }
}
