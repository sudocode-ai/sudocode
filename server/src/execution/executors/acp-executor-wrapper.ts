/**
 * AcpExecutorWrapper - Unified executor using Agent Client Protocol (ACP)
 *
 * Uses acp-factory for agent lifecycle management and streams SessionUpdate
 * events directly to the frontend. Supports all ACP-native agents (claude-code,
 * codex, gemini, opencode) with a unified interface.
 *
 * @module execution/executors/acp-executor-wrapper
 */

import {
  AgentFactory,
  type AgentHandle,
  type Session,
  type SessionUpdate,
  type ExtendedSessionUpdate,
  type McpServer,
  type PermissionMode,
} from "acp-factory";
import type Database from "better-sqlite3";
import type { ExecutionLifecycleService } from "../../services/execution-lifecycle.js";
import type { ExecutionLogsStore } from "../../services/execution-logs-store.js";
import { SessionUpdateCoalescer } from "../output/session-update-coalescer.js";
import { serializeCoalescedUpdate } from "../output/coalesced-types.js";
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
 * Sudocode's MCP server configuration format
 * Used by ExecutionService.buildExecutionConfig()
 */
export interface SudocodeMcpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * MCP servers config as produced by ExecutionService
 * Key is the server name, value is the config
 */
export type SudocodeMcpServersConfig = Record<string, SudocodeMcpServerConfig>;

/**
 * Convert sudocode's MCP config format to acp-factory's McpServer[] format
 *
 * sudocode format: { "server-name": { command, args?, env?: Record } }
 * acp-factory format: [{ name, command, args: [], env: [{name, value}] }]
 */
export function convertMcpServers(
  config: SudocodeMcpServersConfig | McpServer[] | undefined
): McpServer[] {
  if (!config) {
    return [];
  }

  // Already in array format (McpServer[])
  if (Array.isArray(config)) {
    return config;
  }

  // Convert from Record<string, SudocodeMcpServerConfig> to McpServer[]
  return Object.entries(config).map(([name, serverConfig]) => ({
    name,
    command: serverConfig.command,
    args: serverConfig.args ?? [],
    env: serverConfig.env
      ? Object.entries(serverConfig.env).map(([envName, value]) => ({
          name: envName,
          value,
        }))
      : [],
  }));
}

/**
 * Configuration for ACP-based execution
 */
export interface AcpExecutionConfig {
  /** Agent type (must be ACP-registered) */
  agentType: string;
  /**
   * MCP servers to connect to the agent session
   * Accepts both sudocode format (Record<string, config>) and acp-factory format (McpServer[])
   */
  mcpServers?: SudocodeMcpServersConfig | McpServer[];
  /** Permission handling mode */
  permissionMode?: PermissionMode;
  /** Environment variables to pass to the agent */
  env?: Record<string, string>;
  /** Session mode to set (e.g., "code", "plan") */
  mode?: string;
}

/**
 * Task definition for ACP execution
 */
export interface AcpExecutionTask {
  /** Unique task identifier */
  id: string;
  /** The prompt to send to the agent */
  prompt: string;
  /** Optional metadata */
  metadata?: {
    /**
     * MCP servers specific to this task
     * Accepts both sudocode format (Record<string, config>) and acp-factory format (McpServer[])
     */
    mcpServers?: SudocodeMcpServersConfig | McpServer[];
    /** Additional system prompt to append */
    appendSystemPrompt?: string;
    /** Whether to skip permission prompts */
    dangerouslySkipPermissions?: boolean;
  };
}

/**
 * Configuration for AcpExecutorWrapper
 */
export interface AcpExecutorWrapperConfig {
  /** Agent type (claude-code, codex, gemini, opencode) */
  agentType: string;
  /** ACP execution configuration */
  acpConfig: AcpExecutionConfig;
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
 * AcpExecutorWrapper
 *
 * Unified executor wrapper that uses acp-factory for agent lifecycle management.
 * Streams SessionUpdate events directly to the frontend and coalesces them for storage.
 *
 * @example
 * ```typescript
 * const wrapper = new AcpExecutorWrapper({
 *   agentType: "claude-code",
 *   acpConfig: {
 *     agentType: "claude-code",
 *     mcpServers: [{ name: "context", uri: "..." }],
 *     permissionMode: "auto-approve",
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
export class AcpExecutorWrapper {
  private readonly agentType: string;
  private readonly acpConfig: AcpExecutionConfig;
  private readonly logsStore: ExecutionLogsStore;
  private readonly projectId: string;
  private readonly db: Database.Database;

  /** Active agent handles by execution ID */
  private activeAgents: Map<string, AgentHandle> = new Map();
  /** Active sessions by execution ID */
  private activeSessions: Map<string, Session> = new Map();

  constructor(config: AcpExecutorWrapperConfig) {
    this.agentType = config.agentType;
    this.acpConfig = config.acpConfig;
    this.logsStore = config.logsStore;
    this.projectId = config.projectId;
    this.db = config.db;

    console.log("[AcpExecutorWrapper] Initialized", {
      agentType: this.agentType,
      projectId: this.projectId,
      hasLogsStore: !!this.logsStore,
    });
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
    task: AcpExecutionTask,
    workDir: string
  ): Promise<void> {
    console.log(`[AcpExecutorWrapper] Starting execution ${executionId}`, {
      agentType: this.agentType,
      taskId: task.id,
      workDir,
    });

    let agent: AgentHandle | null = null;
    let session: Session | null = null;

    try {
      // 1. Spawn agent via ACP factory
      console.log(
        `[AcpExecutorWrapper] Spawning ${this.agentType} agent for ${executionId}`
      );
      agent = await AgentFactory.spawn(this.agentType, {
        env: this.acpConfig.env,
        permissionMode: this.acpConfig.permissionMode ?? "auto-approve",
      });
      this.activeAgents.set(executionId, agent);

      // 2. Create session with MCP servers
      // Convert from sudocode format (Record<string, config>) to acp-factory format (McpServer[])
      const mcpServers = convertMcpServers(
        task.metadata?.mcpServers ?? this.acpConfig.mcpServers
      );
      console.log(
        `[AcpExecutorWrapper] Creating session for ${executionId}`,
        { mcpServers: mcpServers.map((s) => s.name) }
      );
      session = await agent.createSession(workDir, {
        mcpServers,
        mode: this.acpConfig.mode,
      });
      this.activeSessions.set(executionId, session);

      // 3. Update execution status to running and capture session ID
      updateExecution(this.db, executionId, {
        status: "running",
        session_id: session.id,
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
      }

      // 4. Stream prompt and process SessionUpdate events
      const coalescer = new SessionUpdateCoalescer();

      console.log(
        `[AcpExecutorWrapper] Sending prompt for ${executionId}`,
        { promptLength: task.prompt.length }
      );

      let updateCount = 0;
      for await (const update of session.prompt(task.prompt)) {
        updateCount++;

        // Log first 10 updates and every 100th update
        if (updateCount <= 10 || updateCount % 100 === 0) {
          console.log(
            `[AcpExecutorWrapper] Update ${updateCount} for ${executionId}:`,
            { sessionUpdate: update.sessionUpdate }
          );
        }

        // 5. Broadcast SessionUpdate to frontend via SSE
        this.broadcastSessionUpdate(executionId, update);

        // 6. Coalesce for storage
        const coalescedUpdates = coalescer.process(update as SessionUpdate);
        for (const coalesced of coalescedUpdates) {
          this.logsStore.appendRawLog(
            executionId,
            serializeCoalescedUpdate(coalesced)
          );
        }
      }

      // 7. Flush remaining coalesced state
      const remaining = coalescer.flush();
      for (const coalesced of remaining) {
        this.logsStore.appendRawLog(
          executionId,
          serializeCoalescedUpdate(coalesced)
        );
      }

      console.log(
        `[AcpExecutorWrapper] Prompt completed for ${executionId}`,
        { totalUpdates: updateCount }
      );

      // 8. Handle success
      await this.handleSuccess(executionId, workDir);
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Execution failed for ${executionId}:`,
        error
      );
      await this.handleError(executionId, error as Error, workDir);
      throw error;
    } finally {
      // Cleanup
      this.activeSessions.delete(executionId);
      this.activeAgents.delete(executionId);

      // Close agent if still running
      if (agent?.isRunning()) {
        try {
          await agent.close();
          console.log(`[AcpExecutorWrapper] Closed agent for ${executionId}`);
        } catch (closeError) {
          console.warn(
            `[AcpExecutorWrapper] Error closing agent for ${executionId}:`,
            closeError
          );
        }
      }
    }
  }

  /**
   * Resume a task from a previous session
   *
   * @param executionId - Unique execution identifier
   * @param sessionId - Session ID to resume from
   * @param task - Task to resume
   * @param workDir - Working directory for execution
   */
  async resumeWithLifecycle(
    executionId: string,
    sessionId: string,
    task: AcpExecutionTask,
    workDir: string
  ): Promise<void> {
    console.log(
      `[AcpExecutorWrapper] Resuming session ${sessionId} for ${executionId}`
    );

    let agent: AgentHandle | null = null;
    let session: Session | null = null;

    try {
      // 1. Spawn agent
      agent = await AgentFactory.spawn(this.agentType, {
        env: this.acpConfig.env,
        permissionMode: this.acpConfig.permissionMode ?? "auto-approve",
      });
      this.activeAgents.set(executionId, agent);

      // 2. Load existing session
      console.log(
        `[AcpExecutorWrapper] Loading session ${sessionId} for ${executionId}`
      );
      session = await agent.loadSession(sessionId, workDir);
      this.activeSessions.set(executionId, session);

      // 3. Update execution status
      updateExecution(this.db, executionId, {
        status: "running",
        session_id: session.id,
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
      }

      // 4. Stream prompt and process updates
      const coalescer = new SessionUpdateCoalescer();

      let updateCount = 0;
      for await (const update of session.prompt(task.prompt)) {
        updateCount++;

        // Broadcast to frontend
        this.broadcastSessionUpdate(executionId, update);

        // Coalesce for storage
        const coalescedUpdates = coalescer.process(update as SessionUpdate);
        for (const coalesced of coalescedUpdates) {
          this.logsStore.appendRawLog(
            executionId,
            serializeCoalescedUpdate(coalesced)
          );
        }
      }

      // 5. Flush remaining state
      const remaining = coalescer.flush();
      for (const coalesced of remaining) {
        this.logsStore.appendRawLog(
          executionId,
          serializeCoalescedUpdate(coalesced)
        );
      }

      console.log(
        `[AcpExecutorWrapper] Resume completed for ${executionId}`,
        { totalUpdates: updateCount }
      );

      // 6. Handle success
      await this.handleSuccess(executionId, workDir);
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Resume failed for ${executionId}:`,
        error
      );
      await this.handleError(executionId, error as Error, workDir);
      throw error;
    } finally {
      this.activeSessions.delete(executionId);
      this.activeAgents.delete(executionId);

      if (agent?.isRunning()) {
        try {
          await agent.close();
        } catch (closeError) {
          console.warn(
            `[AcpExecutorWrapper] Error closing agent for ${executionId}:`,
            closeError
          );
        }
      }
    }
  }

  /**
   * Cancel a running execution
   *
   * @param executionId - Execution ID to cancel
   */
  async cancel(executionId: string): Promise<void> {
    console.log(`[AcpExecutorWrapper] Cancel execution ${executionId}`);

    // Get active session
    const session = this.activeSessions.get(executionId);
    if (session) {
      try {
        await session.cancel();
        console.log(
          `[AcpExecutorWrapper] Session cancelled for ${executionId}`
        );
      } catch (error) {
        console.warn(
          `[AcpExecutorWrapper] Error cancelling session for ${executionId}:`,
          error
        );
      }
    }

    // Close agent
    const agent = this.activeAgents.get(executionId);
    if (agent?.isRunning()) {
      try {
        await agent.close();
        console.log(`[AcpExecutorWrapper] Agent closed for ${executionId}`);
      } catch (error) {
        console.warn(
          `[AcpExecutorWrapper] Error closing agent for ${executionId}:`,
          error
        );
      }
    }

    // Capture final commit
    const execution = getExecution(this.db, executionId);
    const repoPath = execution?.worktree_path;

    let afterCommit: string | undefined;
    if (repoPath) {
      try {
        afterCommit = execSync("git rev-parse HEAD", {
          cwd: repoPath,
          encoding: "utf-8",
        }).trim();
      } catch (error) {
        console.warn(
          `[AcpExecutorWrapper] Failed to capture after_commit for cancelled execution ${executionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
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

    // Cleanup maps
    this.activeSessions.delete(executionId);
    this.activeAgents.delete(executionId);
  }

  /**
   * Check if an agent type is supported via ACP
   *
   * @param agentType - Agent type to check
   * @returns true if the agent is registered in AgentFactory
   */
  static isAcpSupported(agentType: string): boolean {
    return AgentFactory.listAgents().includes(agentType);
  }

  /**
   * List all ACP-supported agent types
   *
   * @returns Array of agent type names
   */
  static listAcpAgents(): string[] {
    return AgentFactory.listAgents();
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Broadcast SessionUpdate to frontend via WebSocket
   *
   * Sends the raw SessionUpdate event to clients subscribed to this execution.
   * This enables real-time streaming of agent output.
   */
  private broadcastSessionUpdate(
    executionId: string,
    update: ExtendedSessionUpdate
  ): void {
    // Get the execution to find the issue ID
    const execution = getExecution(this.db, executionId);

    // Broadcast to execution subscribers
    websocketManager.broadcast(this.projectId, "execution", executionId, {
      type: "session_update" as unknown as "execution_created", // Type cast for internal use
      data: { update, executionId },
    });

    // Also broadcast to issue subscribers if applicable
    if (execution?.issue_id) {
      websocketManager.broadcast(this.projectId, "issue", execution.issue_id, {
        type: "session_update" as unknown as "execution_created", // Type cast for internal use
        data: { update, executionId },
      });
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
      `[AcpExecutorWrapper] Execution ${executionId} completed successfully`
    );

    // Get execution to find worktree path
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
        `[AcpExecutorWrapper] Failed to capture after_commit for execution ${executionId}:`,
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
          `[AcpExecutorWrapper] Captured ${filePaths.length} file changes for execution ${executionId}`
        );
      }
    } catch (error) {
      console.warn(
        `[AcpExecutorWrapper] Failed to calculate files_changed for execution ${executionId}:`,
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
      `[AcpExecutorWrapper] Execution ${executionId} failed:`,
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
        `[AcpExecutorWrapper] Failed to calculate files_changed for failed execution ${executionId}:`,
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
