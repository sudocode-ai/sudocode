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
import { ExecutionLifecycleService } from "./execution-lifecycle.js";
import {
  createExecution,
  getExecution,
  updateExecution,
} from "./executions.js";
import { randomUUID } from "crypto";
import type { ExecutionTask } from "agent-execution-engine/engine";
import type { TransportManager } from "../execution/transport/transport-manager.js";
import { ExecutionLogsStore } from "./execution-logs-store.js";
import { ExecutionWorkerPool } from "./execution-worker-pool.js";
import { broadcastExecutionUpdate } from "./websocket.js";
import { createExecutorForAgent } from "../execution/executors/executor-factory.js";
import type { AgentType } from "@sudocode-ai/types/agents";
import { PromptResolver } from "./prompt-resolver.js";

/**
 * Configuration for creating an execution
 */
export interface ExecutionConfig {
  mode?: "worktree" | "local";
  model?: string;
  timeout?: number;
  baseBranch?: string;
  createBaseBranch?: boolean;
  branchName?: string;
  checkpointInterval?: number;
  continueOnStepFailure?: boolean;
  captureFileChanges?: boolean;
  captureToolCalls?: boolean;
}

/**
 * ExecutionService
 *
 * Manages the full lifecycle of issue-based executions:
 * - Creating and starting executions with worktree isolation
 * - Creating follow-up executions that reuse worktrees
 * - Canceling and cleaning up executions
 */
export class ExecutionService {
  private db: Database.Database;
  private projectId: string;
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
    this.lifecycleService =
      lifecycleService || new ExecutionLifecycleService(db, repoPath);
    this.transportManager = transportManager;
    this.logsStore = logsStore || new ExecutionLogsStore(db);
    this.workerPool = workerPool;
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

    // 2. Resolve prompt references before creating execution
    const resolver = new PromptResolver(this.db);
    const { resolvedPrompt, errors } = await resolver.resolve(prompt);
    if (errors.length > 0) {
      console.warn(`[ExecutionService] Prompt resolution warnings:`, errors);
    }

    // 3. Determine execution mode and create execution with worktree
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
        // TODO: Separate original prompt from resolved prompt (?)
        prompt: resolvedPrompt, // Store resolved prompt
        config: JSON.stringify(config),
        createTargetBranch: config.createBaseBranch || false,
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
        prompt: resolvedPrompt, // Store resolved prompt
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

    // Build execution task (prompt already resolved above)
    const task: ExecutionTask = {
      id: execution.id,
      type: "issue",
      entityId: issueId,
      prompt: resolvedPrompt,
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
   * Create follow-up execution
   *
   * For worktree-based executions: reuses the worktree and resumes the session.
   * For local/non-worktree executions: creates a new execution with feedback context.
   *
   * @param executionId - ID of previous execution to follow up on
   * @param feedback - Additional feedback/context to append to prompt
   * @param options - Optional configuration
   * @param options.includeOriginalPrompt - Whether to prepend the original issue content (default: false, assumes session resumption with full history)
   * @returns Created follow-up execution record
   */
  async createFollowUp(
    executionId: string,
    feedback: string,
    options?: {
      includeOriginalPrompt?: boolean;
    }
  ): Promise<Execution> {
    // 1. Get previous execution
    const prevExecution = getExecution(this.db, executionId);
    if (!prevExecution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const hasWorktree = !!prevExecution.worktree_path;

    // For worktree executions, check if worktree still exists on filesystem, recreate if needed
    if (hasWorktree && this.lifecycleService) {
      const fs = await import("fs");
      const worktreeExists = fs.existsSync(prevExecution.worktree_path!);

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

    // TODO: Make it so follow-ups don't require an issue id.
    // 2. Build follow-up prompt (default: just feedback, assumes session resumption)
    let followUpPrompt = feedback;

    if (options?.includeOriginalPrompt) {
      // Optional: include original issue content if explicitly requested
      if (!prevExecution.issue_id) {
        throw new Error(
          "Previous execution must have an issue_id to include original prompt"
        );
      }

      // Get issue content directly from database
      const issue = this.db
        .prepare("SELECT content FROM issues WHERE id = ?")
        .get(prevExecution.issue_id) as { content: string } | undefined;

      if (!issue) {
        throw new Error(`Issue ${prevExecution.issue_id} not found`);
      }

      followUpPrompt = `${issue.content}

${feedback}`;
    }

    // 3. Create new execution record that references previous execution
    // Default to 'claude-code' if agent_type is null (for backwards compatibility)
    const agentType = (prevExecution.agent_type || "claude-code") as AgentType;

    // Determine working directory: worktree path if available, otherwise repo path (local mode)
    const workDir = hasWorktree ? prevExecution.worktree_path! : this.repoPath;

    const newExecutionId = randomUUID();
    const newExecution = createExecution(this.db, {
      id: newExecutionId,
      issue_id: prevExecution.issue_id,
      agent_type: agentType, // Use same agent as previous execution
      target_branch: prevExecution.target_branch,
      branch_name: prevExecution.branch_name,
      worktree_path: prevExecution.worktree_path || undefined, // Reuse same worktree (undefined for local)
      config: prevExecution.config || undefined, // Preserve config (including cleanupMode) from previous execution
      parent_execution_id: executionId, // Link to parent execution for follow-up chain
      prompt: followUpPrompt, // Store the follow-up prompt (feedback or combined with original)
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

    // 4. Use executor wrapper with session resumption
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

    // Use previous execution's session_id (the actual Claude UUID) if available
    // This enables proper session resumption with Claude Code's --resume-session flag
    // If no session_id was captured, we can't resume - this would start a new session
    const sessionId = prevExecution.session_id;
    if (!sessionId) {
      console.warn(
        `[ExecutionService] No session_id found for execution ${executionId}, follow-up will start a new session`
      );
    }

    // Parse config to get model and other settings
    const parsedConfig = prevExecution.config
      ? JSON.parse(prevExecution.config)
      : {};

    // Build execution task for follow-up
    const task: ExecutionTask = {
      id: newExecution.id,
      type: "issue",
      entityId: prevExecution.issue_id ?? undefined,
      prompt: followUpPrompt,
      workDir: workDir,
      config: {
        timeout: parsedConfig.timeout,
      },
      metadata: {
        model: parsedConfig.model || "claude-sonnet-4",
        captureFileChanges: parsedConfig.captureFileChanges ?? true,
        captureToolCalls: parsedConfig.captureToolCalls ?? true,
        issueId: prevExecution.issue_id ?? undefined,
        executionId: newExecution.id,
        followUpOf: executionId,
      },
      priority: 0,
      dependencies: [],
      createdAt: new Date(),
    };

    // Execute follow-up (non-blocking)
    // If we have a session ID, resume the session; otherwise start a new one
    if (sessionId) {
      wrapper
        .resumeWithLifecycle(newExecution.id, sessionId, task, workDir)
        .catch((error) => {
          console.error(
            `[ExecutionService] Follow-up execution ${newExecution.id} failed:`,
            error
          );
          // Error is already handled by wrapper (status updated, broadcasts sent)
        });
    } else {
      // No session to resume, start a new execution with the follow-up prompt
      wrapper
        .executeWithLifecycle(newExecution.id, task, workDir)
        .catch((error) => {
          console.error(
            `[ExecutionService] Follow-up execution ${newExecution.id} failed:`,
            error
          );
        });
    }

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

    // For in-process executions using AgentExecutorWrapper:
    // The wrapper manages its own lifecycle and cancellation.
    // We update the database status, which the wrapper may check,
    // or we rely on process termination to stop execution.
    // TODO: Add cancellation registry in AgentExecutorWrapper for direct process control

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
   * Delete an execution and its entire chain
   *
   * Deletes the execution and all its follow-ups (descendants).
   * Also attempts to clean up the worktree if one exists.
   *
   * @param executionId - ID of execution to delete (can be root or any execution in chain)
   * @throws Error if execution not found
   */
  async deleteExecution(executionId: string): Promise<void> {
    const execution = getExecution(this.db, executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Find the root execution by traversing up parent_execution_id
    let rootId = executionId;
    let current = execution;
    while (current.parent_execution_id) {
      rootId = current.parent_execution_id;
      const parent = getExecution(this.db, rootId);
      if (!parent) break;
      current = parent;
    }

    // Get all executions in the chain (root + all descendants)
    const chain = this.db
      .prepare(
        `
      WITH RECURSIVE execution_chain AS (
        -- Base case: the root execution
        SELECT * FROM executions WHERE id = ?
        UNION ALL
        -- Recursive case: children of executions in the chain
        SELECT e.* FROM executions e
        INNER JOIN execution_chain ec ON e.parent_execution_id = ec.id
      )
      SELECT * FROM execution_chain
    `
      )
      .all(rootId) as Execution[];

    // Cancel any running executions in the chain
    for (const exec of chain) {
      if (exec.status === "running" || exec.status === "pending") {
        try {
          await this.cancelExecution(exec.id);
        } catch (err) {
          console.warn(
            `Failed to cancel execution ${exec.id} during deletion:`,
            err
          );
          // Continue with deletion even if cancel fails
        }
      }
    }

    // Delete worktree if it exists (only for root execution)
    const rootExecution = chain.find((e) => e.id === rootId);
    if (rootExecution?.worktree_path) {
      try {
        const fs = await import("fs");
        if (fs.existsSync(rootExecution.worktree_path)) {
          await this.deleteWorktree(rootId);
        }
      } catch (err) {
        console.warn(
          `Failed to delete worktree during execution deletion:`,
          err
        );
        // Continue with deletion even if worktree cleanup fails
      }
    }

    // Delete execution logs for all executions in the chain
    for (const exec of chain) {
      try {
        this.logsStore.deleteLogs(exec.id);
      } catch (err) {
        console.warn(`Failed to delete logs for execution ${exec.id}:`, err);
        // Continue with deletion even if log cleanup fails
      }
    }

    // Delete all executions in the chain from database
    // Delete in reverse order (children first) to avoid foreign key issues
    const chainIds = chain.map((e) => e.id);
    const placeholders = chainIds.map(() => "?").join(",");
    this.db
      .prepare(`DELETE FROM executions WHERE id IN (${placeholders})`)
      .run(...chainIds);

    // Broadcast deletion event for each execution
    for (const exec of chain) {
      broadcastExecutionUpdate(
        this.projectId,
        exec.id,
        "deleted",
        { executionId: exec.id },
        exec.issue_id || undefined
      );
    }
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

    // For in-process executions using AgentExecutorWrapper:
    // The wrapper manages its own lifecycle. Processes will be terminated
    // when the Node.js process exits.
    // TODO: Add active execution tracking to AgentExecutorWrapper for graceful shutdown
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
