/**
 * LegacyShimExecutorWrapper - Shim wrapper for legacy agents
 *
 * Uses agent-execution-engine adapters internally but emits coalesced
 * SessionUpdate events for a unified ACP-compatible interface.
 *
 * This enables legacy agents (Copilot, Cursor) to integrate with
 * the same streaming infrastructure as native ACP agents.
 *
 * @module execution/executors/legacy-shim-executor-wrapper
 */

import type { NormalizedEntry } from "agent-execution-engine/agents";
import {
  CopilotExecutor,
  CursorExecutor,
} from "agent-execution-engine/agents";
import type { ExecutionTask } from "agent-execution-engine/engine";
import type Database from "better-sqlite3";
import type { ExecutionLifecycleService } from "../../services/execution-lifecycle.js";
import type { ExecutionLogsStore } from "../../services/execution-logs-store.js";
import {
  serializeCoalescedUpdate,
  type CoalescedSessionUpdate,
  type AgentMessageComplete,
  type AgentThoughtComplete,
  type ToolCallComplete,
  type UserMessageComplete,
} from "../output/coalesced-types.js";
import { updateExecution, getExecution } from "../../services/executions.js";
import {
  broadcastExecutionUpdate,
  websocketManager,
} from "../../services/websocket.js";
import { execSync } from "child_process";
import { ExecutionChangesService } from "../../services/execution-changes-service.js";
import { notifyExecutionEvent } from "../../services/execution-event-callbacks.js";
import type { FileChangeStat } from "@sudocode-ai/types";

/**
 * Supported legacy agent types
 */
export type LegacyAgentType = "copilot" | "cursor";

/**
 * Configuration for legacy agent execution
 */
export interface LegacyAgentConfig {
  /** Working directory for execution */
  workDir: string;
  /** Model name (optional) */
  model?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
}

/**
 * Task definition for legacy execution
 */
export interface LegacyExecutionTask {
  /** Unique task identifier */
  id: string;
  /** The prompt to send to the agent */
  prompt: string;
  /** Optional metadata */
  metadata?: {
    /** Additional system prompt to append */
    appendSystemPrompt?: string;
  };
}

/**
 * Configuration for LegacyShimExecutorWrapper
 */
export interface LegacyShimExecutorWrapperConfig {
  /** Agent type (copilot, cursor) */
  agentType: LegacyAgentType;
  /** Agent configuration */
  agentConfig: LegacyAgentConfig;
  /** Lifecycle service for status updates */
  lifecycleService: ExecutionLifecycleService;
  /** Logs store for persisting execution events */
  logsStore: ExecutionLogsStore;
  /** Project ID for broadcasts */
  projectId: string;
  /** Database connection */
  db: Database.Database;
}

/**
 * Base executor interface for legacy agents
 */
interface ILegacyExecutor {
  executeTask(task: ExecutionTask): Promise<{ process: any }>;
  normalizeOutput(
    outputStream: AsyncIterable<any>,
    workDir: string
  ): AsyncIterable<NormalizedEntry>;
  getCapabilities?(): {
    supportsSessionResume?: boolean;
    requiresSetup?: boolean;
    supportsApprovals?: boolean;
    supportsMcp?: boolean;
    protocol?: string;
  };
}

/**
 * LegacyShimExecutorWrapper
 *
 * Wraps legacy agents (Copilot, Cursor) from agent-execution-engine and
 * converts their NormalizedEntry output to CoalescedSessionUpdate events.
 * This provides a unified interface compatible with the ACP migration path.
 *
 * Key Implementation Details:
 * - Converts NormalizedEntry from agent-execution-engine to CoalescedSessionUpdate
 * - Uses 'session_update' WebSocket message type (unified with AcpExecutorWrapper)
 * - Stores to 'raw_logs' column as CoalescedSessionUpdate JSON
 *
 * @example
 * ```typescript
 * const wrapper = new LegacyShimExecutorWrapper({
 *   agentType: "copilot",
 *   agentConfig: {
 *     workDir: "/path/to/repo",
 *     model: "gpt-4o",
 *   },
 *   lifecycleService,
 *   logsStore,
 *   projectId: "my-project",
 *   db,
 * });
 *
 * await wrapper.executeWithLifecycle(executionId, task, workDir);
 * ```
 */
export class LegacyShimExecutorWrapper {
  private readonly agentType: LegacyAgentType;
  private readonly agentConfig: LegacyAgentConfig;
  private readonly logsStore: ExecutionLogsStore;
  private readonly projectId: string;
  private readonly db: Database.Database;
  private readonly executor: ILegacyExecutor;

  /** Active executions for cancellation */
  private activeExecutions: Map<string, { cancel: () => void }> = new Map();

  constructor(config: LegacyShimExecutorWrapperConfig) {
    this.agentType = config.agentType;
    this.agentConfig = config.agentConfig;
    this.logsStore = config.logsStore;
    this.projectId = config.projectId;
    this.db = config.db;

    // Create the appropriate legacy executor
    this.executor = this.createExecutor(config.agentType, config.agentConfig);

    console.log("[LegacyShimExecutorWrapper] Initialized", {
      agentType: this.agentType,
      projectId: this.projectId,
      hasLogsStore: !!this.logsStore,
    });
  }

  /**
   * Create the appropriate executor for the legacy agent type
   */
  private createExecutor(
    agentType: LegacyAgentType,
    agentConfig: LegacyAgentConfig
  ): ILegacyExecutor {
    switch (agentType) {
      case "copilot":
        return new CopilotExecutor({
          workDir: agentConfig.workDir,
          model: agentConfig.model,
        }) as unknown as ILegacyExecutor;

      case "cursor":
        return new CursorExecutor({
          workspace: agentConfig.workDir,
          model: agentConfig.model,
          force: true, // Auto-approve for non-interactive execution
        }) as unknown as ILegacyExecutor;

      default:
        throw new Error(`Unknown legacy agent type: ${agentType}`);
    }
  }

  /**
   * Execute a task with full lifecycle management
   *
   * @param executionId - Unique execution identifier
   * @param task - Task to execute
   * @param workDir - Working directory for execution
   */
  async executeWithLifecycle(
    executionId: string,
    task: LegacyExecutionTask,
    workDir: string
  ): Promise<void> {
    console.log(
      `[LegacyShimExecutorWrapper] Starting execution ${executionId}`,
      {
        agentType: this.agentType,
        taskId: task.id,
        workDir,
      }
    );

    try {
      // 1. Update execution status to running
      updateExecution(this.db, executionId, { status: "running" });
      const execution = getExecution(this.db, executionId);
      if (execution) {
        broadcastExecutionUpdate(
          this.projectId,
          executionId,
          "status_changed",
          execution,
          execution.issue_id || undefined
        );
      }

      // 2. Execute task with legacy executor
      const executionTask: ExecutionTask = {
        id: task.id,
        type: "custom",
        prompt: task.prompt,
        workDir,
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      console.log(
        `[LegacyShimExecutorWrapper] Spawning ${this.agentType} process for ${executionId}`
      );
      const spawned = await this.executor.executeTask(executionTask);

      // 3. Store cancellation handle
      this.activeExecutions.set(executionId, {
        cancel: () => {
          if (spawned.process.process) {
            spawned.process.process.kill("SIGTERM");
          }
        },
      });

      // 4. Create output stream and normalize
      const outputStream = this.createOutputChunks(spawned.process, executionId);
      const normalized = this.executor.normalizeOutput(outputStream, workDir);

      // 5. Process normalized output and convert to SessionUpdate
      await this.processNormalizedOutput(executionId, normalized);

      console.log(
        `[LegacyShimExecutorWrapper] Output processing completed for ${executionId}`
      );

      // 6. Wait for process to exit
      const exitCode = await new Promise<number>((resolve) => {
        const childProcess = spawned.process.process;
        if (!childProcess) {
          resolve(0);
          return;
        }

        childProcess.on("exit", (code: number | null) => {
          console.log(
            `[LegacyShimExecutorWrapper] Process exited with code ${code} for ${executionId}`
          );
          resolve(code ?? 0);
        });

        childProcess.on("error", (error: Error) => {
          console.error(
            `[LegacyShimExecutorWrapper] Process error for ${executionId}:`,
            error
          );
          resolve(1);
        });
      });

      // 7. Handle completion
      if (exitCode === 0) {
        await this.handleSuccess(executionId, workDir);
      } else {
        throw new Error(`Process exited with code ${exitCode}`);
      }
    } catch (error) {
      console.error(
        `[LegacyShimExecutorWrapper] Execution failed for ${executionId}:`,
        error
      );
      await this.handleError(executionId, error as Error, workDir);
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Resume a task from a previous session
   *
   * Note: Most legacy agents don't support session resume. This method
   * is provided for interface compatibility but may not work for all agents.
   *
   * @param executionId - Unique execution identifier
   * @param sessionId - Session ID to resume from
   * @param task - Task to resume
   * @param workDir - Working directory for execution
   */
  async resumeWithLifecycle(
    executionId: string,
    sessionId: string,
    task: LegacyExecutionTask,
    workDir: string
  ): Promise<void> {
    console.log(
      `[LegacyShimExecutorWrapper] Resume requested for ${executionId} with session ${sessionId}`
    );

    // Check capabilities
    const capabilities = this.executor.getCapabilities?.();
    if (!capabilities?.supportsSessionResume) {
      console.warn(
        `[LegacyShimExecutorWrapper] Agent '${this.agentType}' does not support session resume, starting fresh execution`
      );
    }

    // For legacy agents, we typically start a fresh execution
    // The sessionId is logged for reference but may not be used
    await this.executeWithLifecycle(executionId, task, workDir);
  }

  /**
   * Cancel a running execution
   *
   * @param executionId - Execution ID to cancel
   */
  async cancel(executionId: string): Promise<void> {
    console.log(`[LegacyShimExecutorWrapper] Cancel execution ${executionId}`);

    // Kill the process if active
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.cancel();
      this.activeExecutions.delete(executionId);
    } else {
      console.warn(
        `[LegacyShimExecutorWrapper] No active execution found for ${executionId}`
      );
    }

    // Capture final commit
    const dbExecution = getExecution(this.db, executionId);
    const repoPath = dbExecution?.worktree_path || this.agentConfig.workDir;

    let afterCommit: string | undefined;
    try {
      afterCommit = execSync("git rev-parse HEAD", {
        cwd: repoPath,
        encoding: "utf-8",
      }).trim();
    } catch (error) {
      console.warn(
        `[LegacyShimExecutorWrapper] Failed to capture after_commit for cancelled execution ${executionId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Update database status
    updateExecution(this.db, executionId, {
      after_commit: afterCommit,
      status: "stopped",
      completed_at: new Date().toISOString(),
    });

    const updatedExecution = getExecution(this.db, executionId);
    if (updatedExecution) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        updatedExecution,
        updatedExecution.issue_id || undefined
      );
    }
  }

  /**
   * Check if an agent type is a legacy agent
   *
   * @param agentType - Agent type to check
   * @returns true if the agent is a legacy type
   */
  static isLegacyAgent(agentType: string): boolean {
    return agentType === "copilot" || agentType === "cursor";
  }

  /**
   * List all legacy agent types
   *
   * @returns Array of legacy agent type names
   */
  static listLegacyAgents(): LegacyAgentType[] {
    return ["copilot", "cursor"];
  }

  // ============================================================================
  // NormalizedEntry to CoalescedSessionUpdate mapping
  // ============================================================================

  /**
   * Convert a NormalizedEntry to a CoalescedSessionUpdate
   *
   * Mapping:
   * - assistant_message -> agent_message_complete
   * - thinking -> agent_thought_complete
   * - tool_use -> tool_call_complete
   * - error -> tool_call_complete with failed status
   * - system_message -> agent_message_complete with [System] prefix
   * - user_message -> user_message_complete
   */
  private normalizedEntryToSessionUpdate(
    entry: NormalizedEntry
  ): CoalescedSessionUpdate | null {
    const timestamp = entry.timestamp ?? new Date();

    switch (entry.type.kind) {
      case "assistant_message":
        return {
          sessionUpdate: "agent_message_complete",
          content: { type: "text", text: entry.content },
          timestamp,
        } as AgentMessageComplete;

      case "thinking":
        return {
          sessionUpdate: "agent_thought_complete",
          content: {
            type: "text",
            text: entry.type.reasoning || entry.content,
          },
          timestamp,
        } as AgentThoughtComplete;

      case "tool_use": {
        const tool = entry.type.tool;
        return {
          sessionUpdate: "tool_call_complete",
          toolCallId: `${tool.toolName}-${entry.index}`,
          title: this.getToolTitle(tool),
          status: this.mapToolStatus(tool.status),
          result: tool.result?.data,
          rawInput: this.extractToolInput(tool),
          rawOutput: tool.result?.data,
          timestamp,
          completedAt:
            tool.status === "success" || tool.status === "failed"
              ? new Date()
              : undefined,
        } as ToolCallComplete;
      }

      case "error": {
        // Map error to a tool_call_complete with failed status
        const error = entry.type.error;
        return {
          sessionUpdate: "tool_call_complete",
          toolCallId: `error-${entry.index}`,
          title: `Error: ${error.code || "unknown"}`,
          status: "failed",
          result: { error: error.message, stack: error.stack },
          timestamp,
          completedAt: new Date(),
        } as ToolCallComplete;
      }

      case "system_message":
        return {
          sessionUpdate: "agent_message_complete",
          content: { type: "text", text: `[System] ${entry.content}` },
          timestamp,
        } as AgentMessageComplete;

      case "user_message":
        return {
          sessionUpdate: "user_message_complete",
          content: { type: "text", text: entry.content },
          timestamp,
        } as UserMessageComplete;

      default:
        console.warn(
          "[LegacyShimExecutorWrapper] Unknown entry type:",
          (entry.type as any).kind
        );
        return null;
    }
  }

  /**
   * Get a human-readable title for a tool use
   */
  private getToolTitle(tool: {
    toolName: string;
    action: any;
    status: string;
  }): string {
    const action = tool.action;
    switch (action.kind) {
      case "file_read":
        return `Read ${action.path}`;
      case "file_write":
        return `Write ${action.path}`;
      case "file_edit":
        return `Edit ${action.path}`;
      case "command_run":
        return `Run: ${action.command?.substring(0, 50) || "command"}`;
      case "search":
        return `Search: ${action.query}`;
      case "tool":
        return `${action.toolName}`;
      default:
        return tool.toolName;
    }
  }

  /**
   * Extract tool input from action type
   */
  private extractToolInput(tool: { action: any }): unknown {
    const action = tool.action;
    switch (action.kind) {
      case "file_read":
        return { path: action.path };
      case "file_write":
        return { path: action.path };
      case "file_edit":
        return { path: action.path, changes: action.changes };
      case "command_run":
        return { command: action.command };
      case "search":
        return { query: action.query };
      case "tool":
        return action.args;
      default:
        return {};
    }
  }

  /**
   * Map tool status to ToolCallStatus
   */
  private mapToolStatus(
    status: "created" | "running" | "success" | "failed"
  ): "working" | "completed" | "failed" | "incomplete" {
    switch (status) {
      case "created":
      case "running":
        return "working";
      case "success":
        return "completed";
      case "failed":
        return "failed";
      default:
        return "incomplete";
    }
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Broadcast CoalescedSessionUpdate to frontend via WebSocket
   *
   * Uses 'session_update' message type for compatibility with ACP streaming
   */
  private broadcastSessionUpdate(
    executionId: string,
    update: CoalescedSessionUpdate
  ): void {
    const execution = getExecution(this.db, executionId);

    // Broadcast to execution subscribers
    websocketManager.broadcast(this.projectId, "execution", executionId, {
      type: "session_update" as unknown as "execution_created",
      data: { update, executionId },
    });

    // Also broadcast to issue subscribers if applicable
    if (execution?.issue_id) {
      websocketManager.broadcast(this.projectId, "issue", execution.issue_id, {
        type: "session_update" as unknown as "execution_created",
        data: { update, executionId },
      });
    }
  }

  /**
   * Process normalized output from legacy executor
   *
   * Converts each NormalizedEntry to CoalescedSessionUpdate,
   * broadcasts to WebSocket, and stores to raw_logs.
   */
  private async processNormalizedOutput(
    executionId: string,
    normalized: AsyncIterable<NormalizedEntry>
  ): Promise<void> {
    console.log(
      `[LegacyShimExecutorWrapper] Processing normalized output for ${executionId}`
    );

    let entryCount = 0;

    for await (const entry of normalized) {
      entryCount++;

      // Log progress
      if (entryCount <= 10 || entryCount % 100 === 0) {
        console.log(
          `[LegacyShimExecutorWrapper] Entry ${entryCount} for ${executionId}:`,
          {
            index: entry.index,
            kind: entry.type.kind,
            timestamp: entry.timestamp,
          }
        );
      }

      try {
        // 1. Convert to CoalescedSessionUpdate
        const sessionUpdate = this.normalizedEntryToSessionUpdate(entry);
        if (!sessionUpdate) {
          continue;
        }

        // 2. Broadcast to frontend via WebSocket
        this.broadcastSessionUpdate(executionId, sessionUpdate);

        // 3. Store to raw_logs column
        this.logsStore.appendRawLog(
          executionId,
          serializeCoalescedUpdate(sessionUpdate)
        );
      } catch (error) {
        console.error(
          `[LegacyShimExecutorWrapper] Error processing entry for ${executionId}:`,
          {
            entryIndex: entry.index,
            entryType: entry.type.kind,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // Continue processing (don't fail entire execution for one entry)
      }
    }

    console.log(
      `[LegacyShimExecutorWrapper] Finished processing ${entryCount} entries for ${executionId}`
    );
  }

  /**
   * Create output chunk stream from ManagedProcess
   */
  private async *createOutputChunks(
    process: any,
    _executionId: string
  ): AsyncIterable<{
    type: "stdout" | "stderr";
    data: Buffer;
    timestamp: Date;
  }> {
    if (!process.streams) {
      throw new Error("Process does not have streams available");
    }

    const { stdout, stderr } = process.streams;

    // Merge stdout and stderr
    const streams: AsyncIterable<{
      type: "stdout" | "stderr";
      data: Buffer;
      timestamp: Date;
    }>[] = [];

    if (stdout) {
      streams.push(this.streamToChunks(stdout, "stdout"));
    }
    if (stderr) {
      streams.push(this.streamToChunks(stderr, "stderr"));
    }

    // Yield chunks from all streams
    for (const stream of streams) {
      for await (const chunk of stream) {
        yield chunk;
      }
    }
  }

  /**
   * Convert a readable stream to output chunks
   */
  private async *streamToChunks(
    stream: any,
    type: "stdout" | "stderr"
  ): AsyncIterable<{
    type: "stdout" | "stderr";
    data: Buffer;
    timestamp: Date;
  }> {
    for await (const chunk of stream) {
      yield {
        type,
        data: Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Handle successful execution
   */
  private async handleSuccess(
    executionId: string,
    workDir: string
  ): Promise<void> {
    console.log(
      `[LegacyShimExecutorWrapper] Execution ${executionId} completed successfully`
    );

    const execution = getExecution(this.db, executionId);
    const repoPath = execution?.worktree_path || workDir;

    // Capture final commit
    let afterCommit: string | undefined;
    try {
      afterCommit = execSync("git rev-parse HEAD", {
        cwd: repoPath,
        encoding: "utf-8",
      }).trim();
    } catch (error) {
      console.warn(
        `[LegacyShimExecutorWrapper] Failed to capture after_commit for execution ${executionId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Calculate file changes
    let filesChangedJson: string | null = null;
    try {
      const changesService = new ExecutionChangesService(this.db, workDir);
      const changesResult = await changesService.getChanges(executionId);

      if (changesResult.available && changesResult.captured) {
        const filePaths = changesResult.captured.files.map(
          (f: FileChangeStat) => f.path
        );
        filesChangedJson = JSON.stringify(filePaths);
        console.log(
          `[LegacyShimExecutorWrapper] Captured ${filePaths.length} file changes for execution ${executionId}`
        );
      }
    } catch (error) {
      console.warn(
        `[LegacyShimExecutorWrapper] Failed to calculate files_changed for execution ${executionId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Update execution status
    updateExecution(this.db, executionId, {
      after_commit: afterCommit,
      files_changed: filesChangedJson,
      status: "completed",
      completed_at: new Date().toISOString(),
      exit_code: 0,
    });

    const updatedExecution = getExecution(this.db, executionId);
    if (updatedExecution) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        updatedExecution,
        updatedExecution.issue_id || undefined
      );

      // Notify callbacks for workflow integration
      await notifyExecutionEvent("completed", {
        executionId,
        workflowId: updatedExecution.workflow_execution_id ?? undefined,
        issueId: updatedExecution.issue_id ?? undefined,
      });
    }
  }

  /**
   * Handle execution error
   */
  private async handleError(
    executionId: string,
    error: Error,
    workDir: string
  ): Promise<void> {
    console.error(
      `[LegacyShimExecutorWrapper] Execution ${executionId} failed:`,
      error
    );

    // Calculate file changes even for failed executions
    let filesChangedJson: string | null = null;
    try {
      const changesService = new ExecutionChangesService(this.db, workDir);
      const changesResult = await changesService.getChanges(executionId);

      if (changesResult.available && changesResult.captured) {
        const filePaths = changesResult.captured.files.map(
          (f: FileChangeStat) => f.path
        );
        filesChangedJson = JSON.stringify(filePaths);
      }
    } catch (calcError) {
      console.warn(
        `[LegacyShimExecutorWrapper] Failed to calculate files_changed for failed execution ${executionId}:`,
        calcError instanceof Error ? calcError.message : String(calcError)
      );
    }

    // Update execution status
    updateExecution(this.db, executionId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: error.message,
      files_changed: filesChangedJson,
    });

    const execution = getExecution(this.db, executionId);
    if (execution) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        execution,
        execution.issue_id || undefined
      );

      // Notify callbacks for workflow integration
      await notifyExecutionEvent("failed", {
        executionId,
        workflowId: execution.workflow_execution_id ?? undefined,
        issueId: execution.issue_id ?? undefined,
        error: error.message,
      });
    }
  }
}
