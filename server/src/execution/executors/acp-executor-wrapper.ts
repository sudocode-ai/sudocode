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
  type PermissionRequestUpdate,
  type CreateTerminalRequest,
} from "acp-factory";
import { PermissionManager } from "./permission-manager.js";
import { TerminalHandler } from "../handlers/terminal-handler.js";
import { FileHandler } from "../handlers/file-handler.js";
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
  /** Permission managers by execution ID (for interactive mode) */
  private permissionManagers: Map<string, PermissionManager> = new Map();
  /** Terminal handlers by execution ID */
  private terminalHandlers: Map<string, TerminalHandler> = new Map();
  /** File handlers by execution ID */
  private fileHandlers: Map<string, FileHandler> = new Map();

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

    // Create permission manager for this execution (for interactive mode)
    const permissionManager = new PermissionManager();
    this.permissionManagers.set(executionId, permissionManager);

    // Create terminal and file handlers for this execution
    const terminalHandler = new TerminalHandler(workDir);
    const fileHandler = new FileHandler(workDir);
    this.terminalHandlers.set(executionId, terminalHandler);
    this.fileHandlers.set(executionId, fileHandler);

    try {
      // 1. Spawn agent via ACP factory
      console.log(
        `[AcpExecutorWrapper] Spawning ${this.agentType} agent for ${executionId}`
      );

      // Determine permission mode
      const permissionMode = this.acpConfig.permissionMode ?? "interactive";

      agent = await AgentFactory.spawn(this.agentType, {
        env: this.acpConfig.env,
        permissionMode,
        // Terminal handlers
        onTerminalCreate: (params: CreateTerminalRequest) =>
          terminalHandler.onCreate(params),
        onTerminalOutput: (terminalId: string) =>
          terminalHandler.onOutput(terminalId),
        onTerminalKill: (terminalId: string) =>
          terminalHandler.onKill(terminalId),
        onTerminalRelease: (terminalId: string) =>
          terminalHandler.onRelease(terminalId),
        onTerminalWaitForExit: (terminalId: string) =>
          terminalHandler.onWaitForExit(terminalId),
        // File handlers
        onFileRead: (path: string) => fileHandler.onRead(path),
        onFileWrite: (path: string, content: string) =>
          fileHandler.onWrite(path, content),
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

        // Always log tool_call events with details for debugging
        if (
          update.sessionUpdate === "tool_call" ||
          update.sessionUpdate === "tool_call_update"
        ) {
          const toolUpdate = update as {
            sessionUpdate: string;
            toolCallId?: string;
            title?: string;
            status?: string;
            rawInput?: unknown;
          };
          console.log(`[AcpExecutorWrapper] Tool call event:`, {
            type: toolUpdate.sessionUpdate,
            toolCallId: toolUpdate.toolCallId,
            title: toolUpdate.title,
            status: toolUpdate.status,
            hasRawInput: !!toolUpdate.rawInput,
            rawInputPreview:
              typeof toolUpdate.rawInput === "object"
                ? JSON.stringify(toolUpdate.rawInput).substring(0, 200)
                : undefined,
          });
        }

        // Handle permission requests (for interactive mode)
        if (update.sessionUpdate === "permission_request") {
          const permUpdate = update as PermissionRequestUpdate;
          // Register with permission manager (non-blocking)
          permissionManager.addPending({
            requestId: permUpdate.requestId,
            sessionId: permUpdate.sessionId,
            toolCall: permUpdate.toolCall,
            options: permUpdate.options,
          });
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

      // Cancel any pending permissions
      const pm = this.permissionManagers.get(executionId);
      if (pm) {
        pm.cancelAll();
        this.permissionManagers.delete(executionId);
      }

      // Cleanup terminal handler
      const th = this.terminalHandlers.get(executionId);
      if (th) {
        th.cleanup();
        this.terminalHandlers.delete(executionId);
      }

      // Cleanup file handler
      this.fileHandlers.delete(executionId);

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

    // Create permission manager for this execution
    const permissionManager = new PermissionManager();
    this.permissionManagers.set(executionId, permissionManager);

    // Create terminal and file handlers for this execution
    const terminalHandler = new TerminalHandler(workDir);
    const fileHandler = new FileHandler(workDir);
    this.terminalHandlers.set(executionId, terminalHandler);
    this.fileHandlers.set(executionId, fileHandler);

    try {
      // 1. Spawn agent
      const permissionMode = this.acpConfig.permissionMode ?? "interactive";

      agent = await AgentFactory.spawn(this.agentType, {
        env: this.acpConfig.env,
        permissionMode,
        // Terminal handlers
        onTerminalCreate: (params: CreateTerminalRequest) =>
          terminalHandler.onCreate(params),
        onTerminalOutput: (terminalId: string) =>
          terminalHandler.onOutput(terminalId),
        onTerminalKill: (terminalId: string) =>
          terminalHandler.onKill(terminalId),
        onTerminalRelease: (terminalId: string) =>
          terminalHandler.onRelease(terminalId),
        onTerminalWaitForExit: (terminalId: string) =>
          terminalHandler.onWaitForExit(terminalId),
        // File handlers
        onFileRead: (path: string) => fileHandler.onRead(path),
        onFileWrite: (path: string, content: string) =>
          fileHandler.onWrite(path, content),
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

        // Debug: Log tool_call events
        if (
          update.sessionUpdate === "tool_call" ||
          update.sessionUpdate === "tool_call_update"
        ) {
          const toolUpdate = update as {
            sessionUpdate: string;
            toolCallId?: string;
            title?: string;
            status?: string;
            rawInput?: unknown;
          };
          console.log(`[AcpExecutorWrapper] Tool call event (interactive):`, {
            type: toolUpdate.sessionUpdate,
            toolCallId: toolUpdate.toolCallId,
            title: toolUpdate.title,
            status: toolUpdate.status,
            hasRawInput: !!toolUpdate.rawInput,
            rawInputPreview:
              typeof toolUpdate.rawInput === "object"
                ? JSON.stringify(toolUpdate.rawInput).substring(0, 200)
                : undefined,
          });
        }

        // Handle permission requests (for interactive mode)
        if (update.sessionUpdate === "permission_request") {
          const permUpdate = update as PermissionRequestUpdate;
          // Register with permission manager (non-blocking)
          permissionManager.addPending({
            requestId: permUpdate.requestId,
            sessionId: permUpdate.sessionId,
            toolCall: permUpdate.toolCall,
            options: permUpdate.options,
          });
        }

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

      // Cancel any pending permissions
      const pm = this.permissionManagers.get(executionId);
      if (pm) {
        pm.cancelAll();
        this.permissionManagers.delete(executionId);
      }

      // Cleanup terminal handler
      const th = this.terminalHandlers.get(executionId);
      if (th) {
        th.cleanup();
        this.terminalHandlers.delete(executionId);
      }

      // Cleanup file handler
      this.fileHandlers.delete(executionId);

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

    // Cancel any pending permissions
    const pm = this.permissionManagers.get(executionId);
    if (pm) {
      pm.cancelAll();
      this.permissionManagers.delete(executionId);
    }

    // Cleanup terminal handler
    const th = this.terminalHandlers.get(executionId);
    if (th) {
      th.cleanup();
      this.terminalHandlers.delete(executionId);
    }

    // Cleanup file handler
    this.fileHandlers.delete(executionId);
  }

  /**
   * Respond to a permission request
   *
   * @param executionId - Execution ID
   * @param requestId - Permission request ID
   * @param optionId - Selected option ID (e.g., 'allow_once', 'reject_always')
   * @returns true if the permission was found and responded to
   */
  respondToPermission(
    executionId: string,
    requestId: string,
    optionId: string
  ): boolean {
    console.log(
      `[AcpExecutorWrapper] Responding to permission ${requestId} for ${executionId} with ${optionId}`
    );

    // Get the session and permission manager
    const session = this.activeSessions.get(executionId);
    const permissionManager = this.permissionManagers.get(executionId);

    if (!session) {
      console.warn(
        `[AcpExecutorWrapper] No active session for ${executionId}`
      );
      return false;
    }

    if (!permissionManager) {
      console.warn(
        `[AcpExecutorWrapper] No permission manager for ${executionId}`
      );
      return false;
    }

    // Respond via the session (this unblocks the ACP session)
    try {
      session.respondToPermission(requestId, optionId);
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Error responding to permission via session:`,
        error
      );
      return false;
    }

    // Also resolve in our permission manager (for tracking)
    return permissionManager.respond(requestId, optionId);
  }

  /**
   * Check if an execution has pending permissions
   *
   * @param executionId - Execution ID
   * @returns true if there are pending permission requests
   */
  hasPendingPermissions(executionId: string): boolean {
    const pm = this.permissionManagers.get(executionId);
    return pm ? pm.pendingCount > 0 : false;
  }

  /**
   * Get pending permission request IDs for an execution
   *
   * @param executionId - Execution ID
   * @returns Array of pending request IDs
   */
  getPendingPermissionIds(executionId: string): string[] {
    const pm = this.permissionManagers.get(executionId);
    return pm ? pm.getPendingIds() : [];
  }

  /**
   * Set the session mode for an active execution
   *
   * @param executionId - Execution ID
   * @param mode - The mode to set (e.g., "code", "plan", "architect")
   * @returns true if mode was set successfully, false otherwise
   */
  setMode(executionId: string, mode: string): boolean {
    console.log(
      `[AcpExecutorWrapper] Setting mode to "${mode}" for execution ${executionId}`
    );

    const session = this.activeSessions.get(executionId);

    if (!session) {
      console.warn(
        `[AcpExecutorWrapper] No active session for ${executionId}`
      );
      return false;
    }

    try {
      session.setMode(mode);
      console.log(
        `[AcpExecutorWrapper] Mode set to "${mode}" for execution ${executionId}`
      );
      return true;
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Error setting mode for ${executionId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Fork an active session into a new session
   *
   * Creates a new session that inherits the conversation history from the parent.
   * The new session can be run independently while preserving context.
   *
   * @param executionId - Source execution ID to fork from
   * @param newExecutionId - ID for the new forked execution
   * @returns The forked Session, or null if forking failed
   * @experimental This relies on the unstable session/fork ACP capability
   */
  async forkSession(
    executionId: string,
    newExecutionId: string
  ): Promise<Session | null> {
    console.log(
      `[AcpExecutorWrapper] Forking session from ${executionId} to ${newExecutionId}`
    );

    const session = this.activeSessions.get(executionId);

    if (!session) {
      console.warn(
        `[AcpExecutorWrapper] No active session for ${executionId}`
      );
      return null;
    }

    try {
      // Use forkWithFlush which handles active sessions by flushing first
      const forkedSession = await session.forkWithFlush();

      // Register the new session
      this.activeSessions.set(newExecutionId, forkedSession);

      // Create a permission manager for the forked session
      this.permissionManagers.set(newExecutionId, new PermissionManager());

      console.log(
        `[AcpExecutorWrapper] Forked session created for ${newExecutionId}`
      );

      return forkedSession;
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Error forking session from ${executionId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Cancel the current prompt for an active session
   *
   * Stops the agent's current work without providing new instructions.
   * The session remains valid and can receive new prompts via follow-up.
   *
   * @param executionId - Execution ID to cancel
   * @returns true if the cancel was initiated, false if no active session
   */
  async cancelSession(executionId: string): Promise<boolean> {
    console.log(
      `[AcpExecutorWrapper] Cancelling session for execution ${executionId}`
    );

    const session = this.activeSessions.get(executionId);

    if (!session) {
      console.warn(
        `[AcpExecutorWrapper] No active session for ${executionId}`
      );
      return false;
    }

    try {
      await session.cancel();
      console.log(
        `[AcpExecutorWrapper] Session cancelled for execution ${executionId}`
      );
      return true;
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Error cancelling session for ${executionId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Interrupt the current prompt and continue with new content
   *
   * Cancels the agent's current work and immediately starts processing
   * the new prompt. Returns an async iterator of session updates.
   *
   * @param executionId - Execution ID to interrupt
   * @param newPrompt - New prompt to continue with
   * @returns Async iterator of ExtendedSessionUpdate events, or null if no active session
   * @experimental This relies on the interruptWith ACP capability
   */
  async *interruptWithNewPrompt(
    executionId: string,
    newPrompt: string
  ): AsyncGenerator<ExtendedSessionUpdate, void, unknown> {
    console.log(
      `[AcpExecutorWrapper] Interrupting session for execution ${executionId} with new prompt`
    );

    const session = this.activeSessions.get(executionId);

    if (!session) {
      console.warn(
        `[AcpExecutorWrapper] No active session for ${executionId}`
      );
      return;
    }

    try {
      for await (const update of session.interruptWith(newPrompt)) {
        yield update;
      }
      console.log(
        `[AcpExecutorWrapper] Interrupt complete for execution ${executionId}`
      );
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Error during interrupt for ${executionId}:`,
        error
      );
      throw error;
    }
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
    // Broadcast to execution subscribers only
    // Note: Do NOT broadcast to issue subscribers - this causes duplicate messages
    // when a page is subscribed to both execution:X and issue:Y channels
    websocketManager.broadcast(this.projectId, "execution", executionId, {
      type: "session_update" as unknown as "execution_created", // Type cast for internal use
      data: { update, executionId },
    });
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
