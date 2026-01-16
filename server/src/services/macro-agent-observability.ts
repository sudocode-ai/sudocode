/**
 * Macro-Agent Observability Service
 *
 * Provides global agent monitoring for macro-agent by connecting to its
 * WebSocket API endpoint. This service maintains a registry of all agents
 * across all sessions and tracks execution connections.
 *
 * Key concepts:
 * - Global observability: Monitor ALL agents across ALL sessions
 * - Execution connections: Track which executions are connected to which sessions
 * - Event broadcasting: Forward events to sudocode frontend WebSocket
 *
 * @module services/macro-agent-observability
 */

import WebSocket from "ws";
import {
  broadcastToProject,
  broadcastExecutionUpdate,
} from "./websocket.js";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Internal record of an agent in the registry
 */
export interface AgentRecord {
  id: string;
  session_id: string;
  task: string;
  state: "spawning" | "running" | "stopped";
  parent: string | null;
  lineage: string[];
  children_count: number;
  created_at: number;
  updated_at: number;
}

/**
 * Tracks an execution's connection to a macro-agent session
 */
export interface ExecutionConnection {
  executionId: string;
  projectId: string;
  macroAgentSessionId: string;
  connectedAt: number;
  disconnectedAt?: number;
}

/**
 * Configuration for the observability service
 */
export interface MacroAgentObservabilityConfig {
  /** Base URL for macro-agent API (e.g., "http://localhost:3100") */
  apiBaseUrl: string;
  /** Maximum reconnect attempts before giving up (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnect backoff in ms (default: 1000) */
  baseReconnectDelayMs?: number;
}

/**
 * Agent summary from macro-agent WebSocket
 */
interface WSAgentSummary {
  id: string;
  session_id: string;
  task: string;
  state: string;
  parent: string | null;
  children_count: number;
  lineage?: string[];
  created_at: number;
}

/**
 * Agent update event from macro-agent WebSocket
 */
interface WSAgentUpdate {
  type: "agent_update";
  action: "spawned" | "started" | "stopped" | "status";
  agent: WSAgentSummary;
}

/**
 * Task summary from macro-agent WebSocket
 */
interface WSTaskSummary {
  id: string;
  description: string;
  status: string;
  assigned_agent?: string;
  created_at: number;
}

/**
 * Task update event from macro-agent WebSocket
 */
interface WSTaskUpdate {
  type: "task_update";
  action: "created" | "assigned" | "status_change" | "completed" | "failed";
  task: WSTaskSummary;
}

/**
 * Subscription confirmation from macro-agent
 */
interface WSSubscribed {
  type: "subscribed";
  channel: string;
}

/**
 * Union of all WebSocket message types
 */
type WSMessage = WSAgentUpdate | WSTaskUpdate | WSSubscribed | { type: string };

/**
 * Connection state for the observability service
 */
type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// ─────────────────────────────────────────────────────────────────
// Service Implementation
// ─────────────────────────────────────────────────────────────────

/**
 * Macro-Agent Observability Service
 *
 * Maintains a global view of all agents across all macro-agent sessions.
 * Connects to macro-agent's WebSocket endpoint and tracks agent lifecycle events.
 */
export class MacroAgentObservabilityService {
  // WebSocket connection
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";

  // Reconnection
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly maxReconnectAttempts: number;
  private readonly baseReconnectDelayMs: number;

  // Global agent registry
  private agentRegistry = new Map<string, AgentRecord>();
  private knownSessions = new Set<string>();

  // Execution → session connections
  private executionConnections = new Map<string, ExecutionConnection>();

  // Configuration
  private readonly apiBaseUrl: string;

  constructor(config: MacroAgentObservabilityConfig) {
    this.apiBaseUrl = config.apiBaseUrl;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
    this.baseReconnectDelayMs = config.baseReconnectDelayMs ?? 1000;
  }

  // ─────────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Connect to macro-agent's observability WebSocket.
   * Called when macro-agent server starts (not per-execution).
   *
   * @throws Error if connection fails after retries
   */
  async connect(): Promise<void> {
    if (
      this.connectionState === "connected" ||
      this.connectionState === "connecting"
    ) {
      console.log(
        "[MacroAgentObservability] Already connected or connecting"
      );
      return;
    }

    this.connectionState = "connecting";
    const wsUrl = this.apiBaseUrl.replace(/^http/, "ws") + "/api/ws";

    console.log(`[MacroAgentObservability] Connecting to ${wsUrl}`);

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        const connectionTimeout = setTimeout(() => {
          if (this.ws) {
            this.ws.close();
          }
          reject(new Error("Connection timeout"));
        }, 10000);

        this.ws.on("open", () => {
          clearTimeout(connectionTimeout);
          console.log("[MacroAgentObservability] Connected");

          this.connectionState = "connected";
          this.reconnectAttempts = 0;

          // Subscribe to channels
          this.subscribe("agents");
          this.subscribe("tasks");

          resolve();
        });

        this.ws.on("error", (error) => {
          clearTimeout(connectionTimeout);
          console.error("[MacroAgentObservability] WebSocket error:", error);

          if (this.connectionState === "connecting") {
            this.connectionState = "disconnected";
            reject(error);
          }
        });

        this.ws.on("close", (code, reason) => {
          clearTimeout(connectionTimeout);
          console.log(
            `[MacroAgentObservability] Connection closed: ${code} ${reason}`
          );

          const wasConnected = this.connectionState === "connected";
          this.connectionState = "disconnected";
          this.ws = null;

          // Attempt reconnect if was previously connected
          if (wasConnected) {
            this.scheduleReconnect();
          }
        });

        this.ws.on("message", (data) => {
          this.handleMessage(data);
        });
      } catch (error) {
        this.connectionState = "disconnected";
        reject(error);
      }
    });
  }

  /**
   * Subscribe to a macro-agent WebSocket channel
   */
  private subscribe(channel: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ type: "subscribe", channel });
      this.ws.send(message);
      console.log(`[MacroAgentObservability] Subscribed to ${channel}`);
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        `[MacroAgentObservability] Max reconnect attempts (${this.maxReconnectAttempts}) reached`
      );
      return;
    }

    const delay =
      this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.connectionState = "reconnecting";

    console.log(
      `[MacroAgentObservability] Scheduling reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error("[MacroAgentObservability] Reconnect failed:", error);
        // Schedule another attempt if we haven't hit max
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Close the observability connection
   */
  async close(): Promise<void> {
    console.log("[MacroAgentObservability] Closing connection");

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Prevent reconnection
    this.reconnectAttempts = this.maxReconnectAttempts;

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connectionState = "disconnected";
  }

  /**
   * Check if connected to macro-agent
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  // ─────────────────────────────────────────────────────────────────
  // Message Handling
  // ─────────────────────────────────────────────────────────────────

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString()) as WSMessage;

      switch (message.type) {
        case "agent_update":
          this.handleAgentUpdate(message as WSAgentUpdate);
          break;
        case "task_update":
          this.handleTaskUpdate(message as WSTaskUpdate);
          break;
        case "subscribed":
          console.log(
            `[MacroAgentObservability] Subscription confirmed: ${(message as WSSubscribed).channel}`
          );
          break;
        default:
          console.log(
            `[MacroAgentObservability] Unknown message type: ${message.type}`
          );
      }
    } catch (error) {
      console.error(
        "[MacroAgentObservability] Failed to parse message:",
        error
      );
    }
  }

  /**
   * Handle agent update event
   */
  private handleAgentUpdate(event: WSAgentUpdate): void {
    const { action, agent } = event;

    console.log(
      `[MacroAgentObservability] Agent ${action}: ${agent.id} (session: ${agent.session_id})`
    );

    // Update registry
    if (action === "stopped") {
      const existing = this.agentRegistry.get(agent.id);
      if (existing) {
        existing.state = "stopped";
        existing.updated_at = Date.now();
      }
    } else {
      this.agentRegistry.set(agent.id, {
        id: agent.id,
        session_id: agent.session_id,
        task: agent.task,
        state: agent.state as AgentRecord["state"],
        parent: agent.parent,
        lineage: agent.lineage ?? [],
        children_count: agent.children_count,
        created_at: agent.created_at,
        updated_at: Date.now(),
      });
      this.knownSessions.add(agent.session_id);
    }

    // Broadcast to all execution connections for this session
    this.broadcastAgentUpdate(event);
  }

  /**
   * Handle task update event
   */
  private handleTaskUpdate(event: WSTaskUpdate): void {
    const { action, task } = event;

    console.log(
      `[MacroAgentObservability] Task ${action}: ${task.id} - ${task.description}`
    );

    // Broadcast task updates (global - tasks don't have session_id)
    this.broadcastTaskUpdate(event);
  }

  /**
   * Broadcast agent update to relevant execution connections
   */
  private broadcastAgentUpdate(event: WSAgentUpdate): void {
    const { agent, action } = event;

    // Find all executions connected to this session
    for (const [executionId, conn] of this.executionConnections) {
      if (
        conn.macroAgentSessionId === agent.session_id &&
        !conn.disconnectedAt
      ) {
        // Broadcast to execution-specific channel
        broadcastExecutionUpdate(
          conn.projectId,
          executionId,
          "updated",
          {
            macro_agent_event: {
              event_type: "macro_agent_update",
              executionId,
              action,
              agent,
            },
          }
        );
      }
    }

    // Also broadcast to a global macro-agent channel for any project
    // that has an active connection
    const projectIds = new Set<string>();
    for (const conn of this.executionConnections.values()) {
      if (!conn.disconnectedAt) {
        projectIds.add(conn.projectId);
      }
    }

    for (const projectId of projectIds) {
      broadcastToProject(projectId, {
        type: "execution_updated", // Use existing type that frontend handles
        data: {
          macro_agent_event: {
            event_type: "macro_agent_update",
            action,
            agent,
          },
        },
      });
    }
  }

  /**
   * Broadcast task update to relevant execution connections
   */
  private broadcastTaskUpdate(event: WSTaskUpdate): void {
    const { action, task } = event;

    // Tasks don't have session_id, broadcast to all active connections
    const projectIds = new Set<string>();
    for (const conn of this.executionConnections.values()) {
      if (!conn.disconnectedAt) {
        projectIds.add(conn.projectId);
      }
    }

    for (const projectId of projectIds) {
      broadcastToProject(projectId, {
        type: "execution_updated",
        data: {
          macro_agent_event: {
            event_type: "macro_task_update",
            action,
            task,
          },
        },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Connection Tracking
  // ─────────────────────────────────────────────────────────────────

  /**
   * Register an execution's connection to a macro-agent session.
   * Called when execution creates/loads ACP session.
   *
   * @param executionId - The sudocode execution ID
   * @param projectId - The project ID for broadcasting
   * @param macroAgentSessionId - The macro-agent session (workspace) ID
   */
  registerConnection(
    executionId: string,
    projectId: string,
    macroAgentSessionId: string
  ): void {
    console.log(
      `[MacroAgentObservability] Registering connection: execution=${executionId}, session=${macroAgentSessionId}`
    );

    this.executionConnections.set(executionId, {
      executionId,
      projectId,
      macroAgentSessionId,
      connectedAt: Date.now(),
    });
    this.knownSessions.add(macroAgentSessionId);
  }

  /**
   * Unregister an execution's connection.
   * Called when execution ends.
   *
   * @param executionId - The sudocode execution ID
   */
  unregisterConnection(executionId: string): void {
    const conn = this.executionConnections.get(executionId);
    if (conn) {
      console.log(
        `[MacroAgentObservability] Unregistering connection: execution=${executionId}`
      );
      conn.disconnectedAt = Date.now();
      // Keep in map for historical reference
    }
  }

  /**
   * Check if an execution is currently connected
   */
  isExecutionConnected(executionId: string): boolean {
    const conn = this.executionConnections.get(executionId);
    return conn !== undefined && conn.disconnectedAt === undefined;
  }

  // ─────────────────────────────────────────────────────────────────
  // Global Queries
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get ALL agents across all sessions
   */
  getAllAgents(): AgentRecord[] {
    return Array.from(this.agentRegistry.values());
  }

  /**
   * Get agents for a specific macro-agent session
   */
  getAgentsBySession(sessionId: string): AgentRecord[] {
    return Array.from(this.agentRegistry.values()).filter(
      (a) => a.session_id === sessionId
    );
  }

  /**
   * Get all known sessions
   */
  getAllSessions(): string[] {
    return Array.from(this.knownSessions);
  }

  /**
   * Get a specific agent by ID
   */
  getAgent(agentId: string): AgentRecord | undefined {
    return this.agentRegistry.get(agentId);
  }

  /**
   * Get agents by state
   */
  getAgentsByState(state: AgentRecord["state"]): AgentRecord[] {
    return Array.from(this.agentRegistry.values()).filter(
      (a) => a.state === state
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Execution-Scoped Queries
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get agents for a specific execution (via its connected session)
   */
  getAgentsForExecution(executionId: string): AgentRecord[] {
    const conn = this.executionConnections.get(executionId);
    if (!conn) return [];
    return this.getAgentsBySession(conn.macroAgentSessionId);
  }

  /**
   * Get the macro-agent session ID for an execution
   */
  getSessionForExecution(executionId: string): string | undefined {
    return this.executionConnections.get(executionId)?.macroAgentSessionId;
  }

  /**
   * Get the execution connection record
   */
  getExecutionConnection(executionId: string): ExecutionConnection | undefined {
    return this.executionConnections.get(executionId);
  }

  /**
   * Get all execution connections (including disconnected)
   */
  getAllExecutionConnections(): ExecutionConnection[] {
    return Array.from(this.executionConnections.values());
  }

  /**
   * Get active (not disconnected) execution connections
   */
  getActiveExecutionConnections(): ExecutionConnection[] {
    return Array.from(this.executionConnections.values()).filter(
      (c) => !c.disconnectedAt
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // REST API Queries (fetch from macro-agent)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Fetch agent hierarchy from macro-agent REST API
   */
  async fetchHierarchy(sessionId?: string): Promise<unknown> {
    const url = sessionId
      ? `${this.apiBaseUrl}/api/hierarchy?session=${sessionId}`
      : `${this.apiBaseUrl}/api/hierarchy`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch hierarchy: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Fetch tasks from macro-agent REST API
   */
  async fetchTasks(params?: { session?: string; status?: string }): Promise<unknown> {
    const searchParams = new URLSearchParams();
    if (params?.session) searchParams.set("session", params.session);
    if (params?.status) searchParams.set("status", params.status);

    const url = `${this.apiBaseUrl}/api/tasks${searchParams.toString() ? "?" + searchParams.toString() : ""}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch tasks: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Fetch agents from macro-agent REST API
   */
  async fetchAgents(params?: { session?: string; state?: string }): Promise<unknown> {
    const searchParams = new URLSearchParams();
    if (params?.session) searchParams.set("session", params.session);
    if (params?.state) searchParams.set("state", params.state);

    const url = `${this.apiBaseUrl}/api/agents${searchParams.toString() ? "?" + searchParams.toString() : ""}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }
    return response.json();
  }

  // ─────────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get statistics about the observability service
   */
  getStats(): {
    connectionState: ConnectionState;
    totalAgents: number;
    runningAgents: number;
    stoppedAgents: number;
    totalSessions: number;
    totalExecutionConnections: number;
    activeExecutionConnections: number;
  } {
    const agents = this.getAllAgents();
    const runningAgents = agents.filter((a) => a.state === "running").length;
    const stoppedAgents = agents.filter((a) => a.state === "stopped").length;
    const activeConnections = this.getActiveExecutionConnections().length;

    return {
      connectionState: this.connectionState,
      totalAgents: agents.length,
      runningAgents,
      stoppedAgents,
      totalSessions: this.knownSessions.size,
      totalExecutionConnections: this.executionConnections.size,
      activeExecutionConnections: activeConnections,
    };
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.agentRegistry.clear();
    this.knownSessions.clear();
    this.executionConnections.clear();
  }
}

// ─────────────────────────────────────────────────────────────────
// Singleton Management
// ─────────────────────────────────────────────────────────────────

let _instance: MacroAgentObservabilityService | null = null;

/**
 * Get or create the MacroAgentObservabilityService singleton
 *
 * @param config - Configuration (only used on first call)
 * @returns The singleton instance
 */
export function getMacroAgentObservabilityService(
  config?: MacroAgentObservabilityConfig
): MacroAgentObservabilityService {
  if (!_instance) {
    if (!config) {
      throw new Error(
        "MacroAgentObservabilityService config required on first call"
      );
    }
    _instance = new MacroAgentObservabilityService(config);
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetMacroAgentObservabilityService(): void {
  if (_instance) {
    _instance.close();
  }
  _instance = null;
}
