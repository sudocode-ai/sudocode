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
  type SessionUpdate,
  type PermissionRequestUpdate,
} from "acp-factory";
import type {
  AcpSession,
  AcpSessionProvider,
  ExtendedSessionUpdate,
  McpServer,
  PermissionMode,
} from "./session-providers/index.js";
import type {
  SessionMode,
  SessionEndModeConfig,
} from "@sudocode-ai/types";
import { PermissionManager } from "./permission-manager.js";
import type Database from "better-sqlite3";
import type { ExecutionLogsStore } from "../../services/execution-logs-store.js";
import type { MacroAgentObservabilityService } from "../../services/macro-agent-observability.js";
import { SessionUpdateCoalescer } from "../output/session-update-coalescer.js";
import {
  serializeCoalescedUpdate,
  type UserMessageComplete,
} from "../output/coalesced-types.js";
import { updateExecution, getExecution } from "../../services/executions.js";
import {
  broadcastExecutionUpdate,
  broadcastSessionEvent,
  websocketManager,
} from "../../services/websocket.js";
import { execSync } from "child_process";
import { ExecutionChangesService } from "../../services/execution-changes-service.js";
import { notifyExecutionEvent } from "../../services/execution-event-callbacks.js";
import type { FileChangeStat } from "@sudocode-ai/types";
import { getSessionPermissionMode } from "./agent-config-handlers.js";

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
  /** Permission handling mode at ACP protocol level */
  permissionMode?: PermissionMode;
  /**
   * Agent-specific permission mode to set on the session.
   * Used by agents that support setMode() for internal permission handling.
   * Common values: "default", "plan", "bypassPermissions", "acceptEdits"
   */
  agentPermissionMode?: string;
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
 * Options for execution lifecycle
 */
export interface ExecutionLifecycleOptions {
  /** Session persistence mode (default: "discrete") */
  sessionMode?: SessionMode;
  /** How the persistent session ends (only when sessionMode: "persistent") */
  sessionEndMode?: SessionEndModeConfig;
}

/**
 * Internal state for tracking persistent sessions
 */
interface PersistentSessionState {
  /** Session end mode configuration */
  config: SessionEndModeConfig;
  /** Number of prompts sent to this session */
  promptCount: number;
  /** Current state of the session */
  state: "running" | "waiting" | "paused" | "ended";
  /** When the last prompt completed */
  lastPromptCompletedAt?: Date;
  /** Active idle timeout handle */
  idleTimeout?: NodeJS.Timeout;
  /** Working directory for this session */
  workDir: string;
  /** Unregister function for disconnect callback */
  unregisterDisconnectCallback?: () => void;
}

/**
 * Configuration for AcpExecutorWrapper
 */
export interface AcpExecutorWrapperConfig {
  /** Agent type (claude-code, codex, gemini, opencode, macro-agent) */
  agentType: string;
  /** ACP execution configuration */
  acpConfig: AcpExecutionConfig;
  /** Session provider for creating/loading sessions (transport-agnostic) */
  sessionProvider: AcpSessionProvider;
  /** Logs store for persisting execution events */
  logsStore: ExecutionLogsStore;
  /** Project ID for broadcasts */
  projectId: string;
  /** Database connection */
  db: Database.Database;
  /**
   * Observability service for macro-agent connection tracking.
   * Only used when agentType is "macro-agent".
   */
  observabilityService?: MacroAgentObservabilityService;
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
  private readonly sessionProvider: AcpSessionProvider;
  private readonly logsStore: ExecutionLogsStore;
  private readonly projectId: string;
  private readonly db: Database.Database;
  /** Observability service for macro-agent connection tracking */
  private readonly observabilityService?: MacroAgentObservabilityService;

  /** Active sessions by execution ID (transport-agnostic) */
  private activeSessions: Map<string, AcpSession> = new Map();
  /** Permission managers by execution ID (for interactive mode) */
  private permissionManagers: Map<string, PermissionManager> = new Map();
  /** Persistent session state by execution ID */
  private persistentSessions: Map<string, PersistentSessionState> = new Map();

  constructor(config: AcpExecutorWrapperConfig) {
    this.agentType = config.agentType;
    this.acpConfig = config.acpConfig;
    this.sessionProvider = config.sessionProvider;
    this.logsStore = config.logsStore;
    this.projectId = config.projectId;
    this.db = config.db;
    this.observabilityService = config.observabilityService;

    console.log("[AcpExecutorWrapper] Initialized", {
      agentType: this.agentType,
      projectId: this.projectId,
      hasLogsStore: !!this.logsStore,
      hasObservability: !!this.observabilityService,
    });
  }

  /**
   * Execute a task with full lifecycle management
   *
   * @param executionId - Unique execution identifier
   * @param task - Task to execute
   * @param workDir - Working directory for execution
   * @param options - Execution lifecycle options (sessionMode, sessionEndMode)
   */
  async executeWithLifecycle(
    executionId: string,
    task: AcpExecutionTask,
    workDir: string,
    options?: ExecutionLifecycleOptions
  ): Promise<void> {
    const isPersistent = options?.sessionMode === "persistent";

    console.log(`[AcpExecutorWrapper] Starting execution ${executionId}`, {
      agentType: this.agentType,
      taskId: task.id,
      workDir,
      sessionMode: options?.sessionMode ?? "discrete",
    });

    // Initialize persistent session state if needed
    if (isPersistent) {
      const sessionConfig = options?.sessionEndMode ?? { explicit: true };
      const persistentState: PersistentSessionState = {
        config: sessionConfig,
        promptCount: 0,
        state: "running",
        workDir,
      };

      // Register disconnect callback if endOnDisconnect is enabled
      if (sessionConfig.endOnDisconnect) {
        persistentState.unregisterDisconnectCallback = this.registerDisconnectHandler(executionId);
      }

      this.persistentSessions.set(executionId, persistentState);
    }

    let session: AcpSession | null = null;

    // Create permission manager for this execution (for interactive mode)
    const permissionManager = new PermissionManager();
    this.permissionManagers.set(executionId, permissionManager);

    // Determine permission mode for session mode setting
    const permissionMode = this.acpConfig.permissionMode ?? "interactive";

    try {
      // 1. Create session via provider (handles agent lifecycle internally)
      // Convert from sudocode format (Record<string, config>) to acp-factory format (McpServer[])
      const mcpServers = convertMcpServers(
        task.metadata?.mcpServers ?? this.acpConfig.mcpServers
      );
      console.log(`[AcpExecutorWrapper] Creating session for ${executionId}`, {
        agentType: this.agentType,
        mcpServers: mcpServers.map((s) => s.name),
      });
      session = await this.sessionProvider.createSession(workDir, {
        mcpServers,
        mode: this.acpConfig.mode,
      });
      this.activeSessions.set(executionId, session);

      // 2a. Register connection with observability service (macro-agent only)
      if (this.observabilityService && this.agentType === "macro-agent") {
        this.observabilityService.registerConnection(
          executionId,
          this.projectId,
          session.id
        );
        console.log(
          `[AcpExecutorWrapper] Registered observability connection for ${executionId} (session: ${session.id})`
        );
      }

      // 2b. Set permission mode on the agent session using handler logic
      const sessionPermissionMode = getSessionPermissionMode(this.agentType, {
        skipPermissions: permissionMode === "auto-approve",
        acpPermissionMode: permissionMode,
        agentPermissionMode: this.acpConfig.agentPermissionMode,
      });

      if (sessionPermissionMode) {
        try {
          await session.setMode(sessionPermissionMode);
          console.log(
            `[AcpExecutorWrapper] Set session permission mode to ${sessionPermissionMode} for ${executionId}`
          );
        } catch (modeError) {
          console.warn(
            `[AcpExecutorWrapper] Failed to set ${sessionPermissionMode} mode (agent may not support it): ${modeError}`
          );
        }
      }

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

      console.log(`[AcpExecutorWrapper] Sending prompt for ${executionId}`, {
        promptLength: task.prompt.length,
      });

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
          console.log(`[AcpExecutorWrapper] Permission request received:`, {
            executionId,
            requestId: permUpdate.requestId,
            toolCall: permUpdate.toolCall?.title,
            options: permUpdate.options?.map((o) => o.kind),
          });
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

      console.log(`[AcpExecutorWrapper] Prompt completed for ${executionId}`, {
        totalUpdates: updateCount,
        isPersistent,
      });

      // 8. Handle completion based on session mode
      if (isPersistent) {
        // Persistent mode: transition to waiting state
        await this.transitionToWaiting(executionId);
      } else {
        // Discrete mode: complete the execution
        await this.handleSuccess(executionId, workDir);
      }
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Execution failed for ${executionId}:`,
        error
      );
      await this.handleError(executionId, error as Error, workDir);
      throw error;
    } finally {
      // Skip cleanup for persistent sessions that are still alive
      const persistentState = this.persistentSessions.get(executionId);
      if (persistentState && persistentState.state !== "ended") {
        console.log(
          `[AcpExecutorWrapper] Skipping cleanup for persistent session ${executionId} (state: ${persistentState.state})`
        );
        return;
      }

      // Cleanup for discrete sessions or ended persistent sessions
      this.activeSessions.delete(executionId);
      this.persistentSessions.delete(executionId);

      // Unregister from observability service (macro-agent only)
      // This is a safety net in case handleSuccess/handleError wasn't called
      if (this.observabilityService && this.agentType === "macro-agent") {
        this.observabilityService.unregisterConnection(executionId);
      }

      // Cancel any pending permissions
      const pm = this.permissionManagers.get(executionId);
      if (pm) {
        pm.cancelAll();
        this.permissionManagers.delete(executionId);
      }

      // Close session if still exists
      // Note: Provider handles agent lifecycle; session.close() is transport-specific
      if (session) {
        try {
          await session.close();
          console.log(`[AcpExecutorWrapper] Closed session for ${executionId}`);
        } catch (closeError) {
          console.warn(
            `[AcpExecutorWrapper] Error closing session for ${executionId}:`,
            closeError
          );
        }
      }

      // Close session provider for discrete sessions to release agent subprocess
      // For persistent sessions, the provider stays alive until explicit end
      try {
        await this.sessionProvider.close();
        console.log(`[AcpExecutorWrapper] Closed provider for ${executionId}`);
      } catch (providerCloseError) {
        console.warn(
          `[AcpExecutorWrapper] Error closing provider for ${executionId}:`,
          providerCloseError
        );
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
   * @param options - Execution lifecycle options (sessionMode, sessionEndMode)
   */
  async resumeWithLifecycle(
    executionId: string,
    sessionId: string,
    task: AcpExecutionTask,
    workDir: string,
    options?: ExecutionLifecycleOptions
  ): Promise<void> {
    const isPersistent = options?.sessionMode === "persistent";

    console.log(
      `[AcpExecutorWrapper] Resuming session ${sessionId} for ${executionId}`,
      { sessionMode: options?.sessionMode ?? "discrete" }
    );

    // Initialize persistent session state if needed
    if (isPersistent) {
      const sessionConfig = options?.sessionEndMode ?? { explicit: true };
      const persistentState: PersistentSessionState = {
        config: sessionConfig,
        promptCount: 0,
        state: "running",
        workDir,
      };
      this.persistentSessions.set(executionId, persistentState);

      // Register for WebSocket disconnect events to handle cleanup
      persistentState.unregisterDisconnectCallback =
        this.registerDisconnectHandler(executionId);
    }

    let session: AcpSession | null = null;

    // Create permission manager for this execution
    const permissionManager = new PermissionManager();
    this.permissionManagers.set(executionId, permissionManager);

    // Determine permission mode for session mode setting
    const permissionMode = this.acpConfig.permissionMode ?? "interactive";

    try {
      // 1. Load or create session via provider
      // Provider handles fallback to createSession if loading is not supported
      const mcpServers = convertMcpServers(
        task.metadata?.mcpServers ?? this.acpConfig.mcpServers
      );

      console.log(
        `[AcpExecutorWrapper] Loading session ${sessionId} for ${executionId}`
      );
      session = await this.sessionProvider.loadSession(sessionId, workDir, {
        mcpServers,
        mode: this.acpConfig.mode,
      });
      this.activeSessions.set(executionId, session);

      // 2a. Register connection with observability service (macro-agent only)
      if (this.observabilityService && this.agentType === "macro-agent") {
        this.observabilityService.registerConnection(
          executionId,
          this.projectId,
          session.id
        );
        console.log(
          `[AcpExecutorWrapper] Registered observability connection for ${executionId} (session: ${session.id})`
        );
      }

      // 2b. Set permission mode on the agent session using handler logic
      const sessionPermissionMode = getSessionPermissionMode(this.agentType, {
        skipPermissions: permissionMode === "auto-approve",
        acpPermissionMode: permissionMode,
        agentPermissionMode: this.acpConfig.agentPermissionMode,
      });

      if (sessionPermissionMode) {
        try {
          await session.setMode(sessionPermissionMode);
          console.log(
            `[AcpExecutorWrapper] Set session permission mode to ${sessionPermissionMode} for ${executionId}`
          );
        } catch (modeError) {
          console.warn(
            `[AcpExecutorWrapper] Failed to set ${sessionPermissionMode} mode (agent may not support it): ${modeError}`
          );
        }
      }

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
          console.log(`[AcpExecutorWrapper] Permission request received:`, {
            executionId,
            requestId: permUpdate.requestId,
            toolCall: permUpdate.toolCall?.title,
            options: permUpdate.options?.map((o) => o.kind),
          });
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

      console.log(`[AcpExecutorWrapper] Resume completed for ${executionId}`, {
        totalUpdates: updateCount,
        isPersistent,
      });

      // 6. Handle completion based on session mode
      if (isPersistent) {
        // Persistent mode: transition to waiting state
        await this.transitionToWaiting(executionId);
      } else {
        // Discrete mode: complete the execution
        await this.handleSuccess(executionId, workDir);
      }
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Resume failed for ${executionId}:`,
        error
      );
      await this.handleError(executionId, error as Error, workDir);
      throw error;
    } finally {
      // Skip cleanup for persistent sessions that are still alive
      const persistentState = this.persistentSessions.get(executionId);
      if (persistentState && persistentState.state !== "ended") {
        console.log(
          `[AcpExecutorWrapper] Skipping cleanup for persistent session ${executionId} (state: ${persistentState.state})`
        );
        return;
      }

      // Cleanup for discrete sessions or ended persistent sessions
      this.activeSessions.delete(executionId);
      this.persistentSessions.delete(executionId);

      // Unregister from observability service (macro-agent only)
      // This is a safety net in case handleSuccess/handleError wasn't called
      if (this.observabilityService && this.agentType === "macro-agent") {
        this.observabilityService.unregisterConnection(executionId);
      }

      // Cancel any pending permissions
      const pm = this.permissionManagers.get(executionId);
      if (pm) {
        pm.cancelAll();
        this.permissionManagers.delete(executionId);
      }

      // Close session if still exists
      if (session) {
        try {
          await session.close();
          console.log(`[AcpExecutorWrapper] Closed session for ${executionId}`);
        } catch (closeError) {
          console.warn(
            `[AcpExecutorWrapper] Error closing session for ${executionId}:`,
            closeError
          );
        }
      }

      // Close session provider for discrete sessions to release agent subprocess
      try {
        await this.sessionProvider.close();
        console.log(`[AcpExecutorWrapper] Closed provider for ${executionId}`);
      } catch (providerCloseError) {
        console.warn(
          `[AcpExecutorWrapper] Error closing provider for ${executionId}:`,
          providerCloseError
        );
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

    // Unregister from observability service (macro-agent only)
    if (this.observabilityService && this.agentType === "macro-agent") {
      this.observabilityService.unregisterConnection(executionId);
      console.log(
        `[AcpExecutorWrapper] Unregistered observability connection for ${executionId}`
      );
    }

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

      // Close the session
      try {
        await session.close();
        console.log(`[AcpExecutorWrapper] Session closed for ${executionId}`);
      } catch (error) {
        console.warn(
          `[AcpExecutorWrapper] Error closing session for ${executionId}:`,
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

    // Cancel any pending permissions
    const pm = this.permissionManagers.get(executionId);
    if (pm) {
      pm.cancelAll();
      this.permissionManagers.delete(executionId);
    }

    // Close session provider to release agent subprocess
    try {
      await this.sessionProvider.close();
      console.log(`[AcpExecutorWrapper] Closed provider for ${executionId}`);
    } catch (providerCloseError) {
      console.warn(
        `[AcpExecutorWrapper] Error closing provider for ${executionId}:`,
        providerCloseError
      );
    }
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
      console.warn(`[AcpExecutorWrapper] No active session for ${executionId}`);
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
      console.warn(`[AcpExecutorWrapper] No active session for ${executionId}`);
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
   * @returns The forked AcpSession, or null if forking failed
   * @experimental This relies on the unstable session/fork ACP capability.
   *               Currently not supported with the transport abstraction layer.
   */
  async forkSession(
    executionId: string,
    newExecutionId: string
  ): Promise<AcpSession | null> {
    console.log(
      `[AcpExecutorWrapper] Forking session from ${executionId} to ${newExecutionId}`
    );

    // TODO: Add fork() to AcpSession interface when this capability is needed
    // For now, forking is not supported with the transport abstraction layer
    console.warn(
      `[AcpExecutorWrapper] Session forking is not yet supported with the transport abstraction layer`
    );
    return null;
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
      console.warn(`[AcpExecutorWrapper] No active session for ${executionId}`);
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
   * @experimental This relies on the interruptWith ACP capability.
   *               Currently not supported with the transport abstraction layer.
   */
  async *interruptWithNewPrompt(
    executionId: string,
    _newPrompt: string
  ): AsyncGenerator<ExtendedSessionUpdate, void, unknown> {
    console.log(
      `[AcpExecutorWrapper] Interrupting session for execution ${executionId} with new prompt`
    );

    // TODO: Add interruptWith() to AcpSession interface when this capability is needed
    // For now, interrupting is not supported with the transport abstraction layer
    console.warn(
      `[AcpExecutorWrapper] Session interrupting is not yet supported with the transport abstraction layer`
    );
    return;
  }

  // ============================================================================
  // Persistent Session Methods
  // ============================================================================

  /**
   * Send an additional prompt to a persistent session
   *
   * Only works for executions started with sessionMode: "persistent" that are
   * currently in the "waiting" or "paused" state. Sending a prompt to a paused
   * session will resume it.
   *
   * @param executionId - Execution ID with active persistent session
   * @param prompt - The prompt to send
   * @throws Error if no persistent session exists or session is not waiting/paused
   */
  async sendPrompt(executionId: string, prompt: string): Promise<void> {
    const persistentState = this.persistentSessions.get(executionId);
    if (!persistentState) {
      throw new Error(`No persistent session found for execution ${executionId}`);
    }

    if (persistentState.state !== "waiting" && persistentState.state !== "paused") {
      throw new Error(
        `Cannot send prompt to session in state: ${persistentState.state}`
      );
    }

    const wasResumingFromPaused = persistentState.state === "paused";
    if (wasResumingFromPaused) {
      console.log(
        `[AcpExecutorWrapper] Resuming paused session ${executionId} with new prompt`
      );
    }

    const session = this.activeSessions.get(executionId);
    if (!session) {
      throw new Error(`No active session for execution ${executionId}`);
    }

    console.log(
      `[AcpExecutorWrapper] Sending prompt to persistent session ${executionId}`,
      { promptNumber: persistentState.promptCount + 1 }
    );

    // Clear any idle timeout
    this.clearIdleTimeout(executionId);

    // Update state to running
    persistentState.state = "running";

    // Update execution status
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

    // Emit and store user message before streaming agent response
    const userMessage: UserMessageComplete = {
      sessionUpdate: "user_message_complete",
      content: { type: "text", text: prompt },
      timestamp: new Date(),
    };
    // Broadcast to frontend
    this.broadcastSessionUpdate(executionId, userMessage as unknown as ExtendedSessionUpdate);
    // Store in logs
    this.logsStore.appendRawLog(executionId, serializeCoalescedUpdate(userMessage));

    // Stream prompt and process updates
    const coalescer = new SessionUpdateCoalescer();
    const permissionManager = this.permissionManagers.get(executionId);

    try {
      let updateCount = 0;
      for await (const update of session.prompt(prompt)) {
        updateCount++;

        // Handle permission requests
        if (update.sessionUpdate === "permission_request" && permissionManager) {
          const permUpdate = update as PermissionRequestUpdate;
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

      // Flush remaining state
      const remaining = coalescer.flush();
      for (const coalesced of remaining) {
        this.logsStore.appendRawLog(
          executionId,
          serializeCoalescedUpdate(coalesced)
        );
      }

      console.log(
        `[AcpExecutorWrapper] Prompt ${persistentState.promptCount + 1} completed for ${executionId}`,
        { updateCount }
      );

      // Transition back to waiting
      await this.transitionToWaiting(executionId);
    } catch (error) {
      console.error(
        `[AcpExecutorWrapper] Error sending prompt to persistent session ${executionId}:`,
        error
      );
      // Mark session as ended on error
      persistentState.state = "ended";
      await this.handleError(executionId, error as Error, persistentState.workDir);
      throw error;
    }
  }

  /**
   * Explicitly end a persistent session
   *
   * Closes the agent, cleans up resources, and marks the execution as completed.
   *
   * @param executionId - Execution ID with active persistent session
   * @param reason - Reason for ending the session (default: "explicit")
   */
  async endSession(
    executionId: string,
    reason: "explicit" | "timeout" | "disconnect" = "explicit"
  ): Promise<void> {
    const persistentState = this.persistentSessions.get(executionId);
    if (!persistentState) {
      console.warn(
        `[AcpExecutorWrapper] No persistent session found for ${executionId}`
      );
      return;
    }

    console.log(
      `[AcpExecutorWrapper] Ending persistent session ${executionId}`,
      { promptCount: persistentState.promptCount }
    );

    // Clear any idle timeout
    this.clearIdleTimeout(executionId);

    // Unregister disconnect callback if registered
    if (persistentState.unregisterDisconnectCallback) {
      persistentState.unregisterDisconnectCallback();
      persistentState.unregisterDisconnectCallback = undefined;
    }

    // Mark as ended
    persistentState.state = "ended";

    // Complete the execution
    await this.handleSuccess(executionId, persistentState.workDir);

    // Cleanup - close session
    const session = this.activeSessions.get(executionId);
    if (session) {
      try {
        await session.close();
        console.log(`[AcpExecutorWrapper] Closed session for ${executionId}`);
      } catch (closeError) {
        console.warn(
          `[AcpExecutorWrapper] Error closing session for ${executionId}:`,
          closeError
        );
      }
    }

    // Remove from maps
    this.activeSessions.delete(executionId);
    this.persistentSessions.delete(executionId);

    const pm = this.permissionManagers.get(executionId);
    if (pm) {
      pm.cancelAll();
      this.permissionManagers.delete(executionId);
    }

    // Close session provider to release agent subprocess
    try {
      await this.sessionProvider.close();
      console.log(`[AcpExecutorWrapper] Closed provider for ${executionId}`);
    } catch (providerCloseError) {
      console.warn(
        `[AcpExecutorWrapper] Error closing provider for ${executionId}:`,
        providerCloseError
      );
    }

    // Broadcast session ended event with the specified reason
    broadcastSessionEvent(this.projectId, executionId, "session_ended", {
      reason,
    });
  }

  /**
   * Get the current state of a persistent session
   *
   * @param executionId - Execution ID to check
   * @returns Session state info or null if not a persistent session
   */
  getSessionState(executionId: string): {
    mode: "persistent";
    state: "running" | "waiting" | "paused" | "ended";
    promptCount: number;
    idleTimeMs?: number;
  } | null {
    const persistentState = this.persistentSessions.get(executionId);
    if (!persistentState) {
      return null;
    }

    return {
      mode: "persistent",
      state: persistentState.state,
      promptCount: persistentState.promptCount,
      idleTimeMs: persistentState.lastPromptCompletedAt
        ? Date.now() - persistentState.lastPromptCompletedAt.getTime()
        : undefined,
    };
  }

  /**
   * Check if an execution has an active persistent session
   *
   * @param executionId - Execution ID to check
   * @returns true if execution has a persistent session that's not ended
   */
  isPersistentSession(executionId: string): boolean {
    const state = this.persistentSessions.get(executionId);
    return state !== undefined && state.state !== "ended";
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
   * Transition a persistent session to waiting or paused state
   *
   * Updates the session state, increments prompt count, starts idle timeout if configured,
   * and broadcasts the state change to clients. If pauseOnCompletion is enabled, the session
   * transitions to "paused" instead of "waiting".
   */
  private async transitionToWaiting(executionId: string): Promise<void> {
    const persistentState = this.persistentSessions.get(executionId);
    if (!persistentState) {
      console.warn(
        `[AcpExecutorWrapper] No persistent session found for ${executionId} during transition`
      );
      return;
    }

    // Update state - use "paused" if pauseOnCompletion is enabled
    const targetState = persistentState.config.pauseOnCompletion ? "paused" : "waiting";
    persistentState.state = targetState;
    persistentState.promptCount++;
    persistentState.lastPromptCompletedAt = new Date();

    console.log(
      `[AcpExecutorWrapper] Transitioned to ${targetState} state for ${executionId}`,
      { promptCount: persistentState.promptCount }
    );

    // Start idle timeout if configured (only for waiting state, not paused)
    if (
      targetState === "waiting" &&
      persistentState.config.idleTimeoutMs &&
      persistentState.config.idleTimeoutMs > 0
    ) {
      persistentState.idleTimeout = setTimeout(async () => {
        console.log(
          `[AcpExecutorWrapper] Idle timeout reached for ${executionId}`
        );
        await this.endSession(executionId, "timeout");
      }, persistentState.config.idleTimeoutMs);
    }

    // Update execution status
    updateExecution(this.db, executionId, { status: targetState });
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

    // Broadcast session state change event
    const eventType = targetState === "paused" ? "session_paused" : "session_waiting";
    broadcastSessionEvent(this.projectId, executionId, eventType, {
      promptCount: persistentState.promptCount,
    });
  }

  /**
   * Clear the idle timeout for a persistent session
   */
  private clearIdleTimeout(executionId: string): void {
    const persistentState = this.persistentSessions.get(executionId);
    if (persistentState?.idleTimeout) {
      clearTimeout(persistentState.idleTimeout);
      persistentState.idleTimeout = undefined;
    }
  }

  /**
   * Register a disconnect handler for endOnDisconnect mode
   *
   * Returns an unregister function to be called during cleanup.
   */
  private registerDisconnectHandler(executionId: string): () => void {
    const unregister = websocketManager.onDisconnect(
      async (_clientId: string, subscriptions: Set<string>) => {
        const persistentState = this.persistentSessions.get(executionId);
        if (!persistentState || persistentState.state === "ended") {
          return;
        }

        // Check if the disconnected client was subscribed to this execution
        const executionSubscription = `${this.projectId}:execution:${executionId}`;
        const allSubscription = `${this.projectId}:all`;
        const typeSubscription = `${this.projectId}:execution:*`;

        const wasSubscribed =
          subscriptions.has(executionSubscription) ||
          subscriptions.has(allSubscription) ||
          subscriptions.has(typeSubscription);

        if (!wasSubscribed) {
          return;
        }

        // Check if there are still other subscribers
        const hasOtherSubscribers = websocketManager.hasSubscribers(
          this.projectId,
          "execution",
          executionId
        );

        if (!hasOtherSubscribers) {
          console.log(
            `[AcpExecutorWrapper] Last subscriber disconnected for ${executionId}, ending session`
          );
          await this.endSession(executionId, "disconnect");
        }
      }
    );

    return unregister;
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

    // Unregister from observability service (macro-agent only)
    if (this.observabilityService && this.agentType === "macro-agent") {
      this.observabilityService.unregisterConnection(executionId);
      console.log(
        `[AcpExecutorWrapper] Unregistered observability connection for ${executionId}`
      );
    }

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

    // Unregister from observability service (macro-agent only)
    if (this.observabilityService && this.agentType === "macro-agent") {
      this.observabilityService.unregisterConnection(executionId);
      console.log(
        `[AcpExecutorWrapper] Unregistered observability connection for ${executionId}`
      );
    }

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
