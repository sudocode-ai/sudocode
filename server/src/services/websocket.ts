import { WebSocketServer, WebSocket, RawData } from "ws";
import * as http from "http";
import { randomUUID } from "crypto";

const LOG_CONNECTIONS = false;

/**
 * WebSocket client information
 */
interface Client {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>; // e.g., 'project-id:issue:ISSUE-001', 'project-id:spec:*', 'project-id:all'
  isAlive: boolean;
  connectedAt: Date;
}

/**
 * Message types that clients can send to the server
 */
interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  project_id?: string; // Project ID for project-scoped subscriptions
  entity_type?: "issue" | "spec" | "execution" | "workflow" | "all";
  entity_id?: string;
}

/**
 * Message types that the server sends to clients
 */
export interface ServerMessage {
  type:
    | "issue_created"
    | "issue_updated"
    | "issue_deleted"
    | "spec_created"
    | "spec_updated"
    | "spec_deleted"
    | "feedback_created"
    | "feedback_updated"
    | "feedback_deleted"
    | "relationship_created"
    | "relationship_deleted"
    | "execution_created"
    | "execution_updated"
    | "execution_status_changed"
    | "execution_deleted"
    | "voice_narration"
    | "workflow_created"
    | "workflow_updated"
    | "workflow_deleted"
    | "workflow_started"
    | "workflow_paused"
    | "workflow_resumed"
    | "workflow_completed"
    | "workflow_failed"
    | "workflow_cancelled"
    | "workflow_step_started"
    | "workflow_step_completed"
    | "workflow_step_failed"
    | "workflow_step_skipped"
    | "project_opened"
    | "project_closed"
    | "pong"
    | "error"
    | "subscribed"
    | "unsubscribed";
  projectId?: string; // Project ID for project-scoped messages
  data?: any;
  message?: string;
  subscription?: string;
}

/**
 * WebSocket server manager
 */
class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Client> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  /**
   * Initialize the WebSocket server
   * @param server HTTP server instance
   * @param path WebSocket path (default: "/ws")
   * @param allowReinit Allow re-initialization after shutdown (default: false)
   */
  init(server: http.Server, path: string = "/ws", allowReinit: boolean = false): void {
    if (this.wss) {
      if (allowReinit) {
        console.warn("[websocket] WebSocket server already initialized, but re-initialization is allowed");
        // Don't return, allow re-initialization
      } else {
        console.warn("[websocket] WebSocket server already initialized");
        return;
      }
    }

    try {
      this.wss = new WebSocketServer({ server, path });

      // Verify the WebSocket server was created successfully
      if (!this.wss) {
        throw new Error("Failed to create WebSocket server");
      }

      // Add error handler to catch initialization issues
      this.wss.on("error", (error) => {
        console.error(`[websocket] WebSocket server error:`, error);
        throw new Error(`WebSocket server error: ${error.message}`);
      });

      console.log(`[websocket] WebSocket server initialized on path: ${path}`);

      this.wss.on("connection", this.handleConnection.bind(this));
      this.startHeartbeat();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[websocket] Failed to initialize WebSocket server:`, errorMessage);
      // Clean up on failure
      this.wss = null;
      throw new Error(`Failed to initialize WebSocket server on path ${path}: ${errorMessage}`);
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, _req: http.IncomingMessage): void {
    const clientId = randomUUID();
    const client: Client = {
      id: clientId,
      ws,
      subscriptions: new Set(),
      isAlive: true,
      connectedAt: new Date(),
    };

    this.clients.set(clientId, client);
    if (LOG_CONNECTIONS) {
      console.log(
        `[websocket] Client connected: ${clientId} (total: ${this.clients.size})`
      );
    }

    // Set up event handlers
    ws.on("message", (data: RawData) => this.handleMessage(clientId, data));
    ws.on("close", () => this.handleDisconnection(clientId));
    ws.on("error", (error) => this.handleError(clientId, error));
    ws.on("pong", () => this.handlePong(clientId));

    // Send welcome message
    this.sendToClient(clientId, {
      type: "pong",
      message: "Connected to sudocode server",
    });
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      if (LOG_CONNECTIONS) {
        console.log(
          `[websocket] Client disconnected: ${clientId} (subscriptions: ${client.subscriptions.size})`
        );
      }
      this.clients.delete(clientId);
    }
  }

  /**
   * Handle client errors
   */
  private handleError(clientId: string, error: Error): void {
    console.error(`[websocket] Client error (${clientId}):`, error.message);
  }

  /**
   * Handle pong response from client
   */
  private handlePong(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.isAlive = true;
    }
  }

  /**
   * Handle incoming messages from clients
   */
  private handleMessage(clientId: string, data: RawData): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    try {
      const message: ClientMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe":
          this.handleSubscribe(clientId, message);
          break;

        case "unsubscribe":
          this.handleUnsubscribe(clientId, message);
          break;

        case "ping":
          this.sendToClient(clientId, { type: "pong" });
          break;

        default:
          this.sendToClient(clientId, {
            type: "error",
            message: `Unknown message type: ${(message as any).type}`,
          });
      }
    } catch (error) {
      console.error(
        `[websocket] Failed to parse message from ${clientId}:`,
        error
      );
      this.sendToClient(clientId, {
        type: "error",
        message: "Invalid message format",
      });
    }
  }

  /**
   * Handle subscription request
   */
  private handleSubscribe(clientId: string, message: ClientMessage): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    let subscription: string;
    const projectId = message.project_id;

    if (!projectId) {
      this.sendToClient(clientId, {
        type: "error",
        message: "project_id is required for subscriptions",
      });
      return;
    }

    if (message.entity_type === "all") {
      // Subscribe to all updates for a project
      subscription = `${projectId}:all`;
    } else if (message.entity_type && message.entity_id) {
      // Subscribe to a specific entity in a project
      subscription = `${projectId}:${message.entity_type}:${message.entity_id}`;
    } else if (message.entity_type) {
      // Subscribe to all entities of a type in a project
      subscription = `${projectId}:${message.entity_type}:*`;
    } else {
      this.sendToClient(clientId, {
        type: "error",
        message: "Invalid subscription request",
      });
      return;
    }

    client.subscriptions.add(subscription);
    if (LOG_CONNECTIONS) {
      console.log(
        `[websocket] Client ${clientId} subscribed to: ${subscription}`
      );
    }

    this.sendToClient(clientId, {
      type: "subscribed",
      subscription,
      message: `Subscribed to ${subscription}`,
    });
  }

  /**
   * Handle unsubscription request
   */
  private handleUnsubscribe(clientId: string, message: ClientMessage): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    let subscription: string;
    const projectId = message.project_id;

    if (!projectId) {
      this.sendToClient(clientId, {
        type: "error",
        message: "project_id is required for unsubscription",
      });
      return;
    }

    if (message.entity_type === "all") {
      subscription = `${projectId}:all`;
    } else if (message.entity_type && message.entity_id) {
      subscription = `${projectId}:${message.entity_type}:${message.entity_id}`;
    } else if (message.entity_type) {
      subscription = `${projectId}:${message.entity_type}:*`;
    } else {
      this.sendToClient(clientId, {
        type: "error",
        message: "Invalid unsubscription request",
      });
      return;
    }

    client.subscriptions.delete(subscription);
    if (LOG_CONNECTIONS) {
      console.log(
        `[websocket] Client ${clientId} unsubscribed from: ${subscription}`
      );
    }

    this.sendToClient(clientId, {
      type: "unsubscribed",
      subscription,
      message: `Unsubscribed from ${subscription}`,
    });
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(clientId: string, message: ServerMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(
        `[websocket] Failed to send message to ${clientId}:`,
        error
      );
    }
  }

  /**
   * Broadcast a message to all subscribed clients for a specific project
   */
  broadcast(
    projectId: string,
    entityType: "issue" | "spec" | "execution" | "workflow",
    entityId: string,
    message: ServerMessage
  ): void {
    const subscription = `${projectId}:${entityType}:${entityId}`;
    const typeSubscription = `${projectId}:${entityType}:*`;
    const allSubscription = `${projectId}:all`;
    let sentCount = 0;

    // Ensure message includes projectId
    message.projectId = projectId;

    this.clients.forEach((client) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Check if client is subscribed to this specific entity, entity type, or all for this project
      if (
        client.subscriptions.has(subscription) ||
        client.subscriptions.has(typeSubscription) ||
        client.subscriptions.has(allSubscription)
      ) {
        try {
          client.ws.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          console.error(
            `[websocket] Failed to broadcast to ${client.id}:`,
            error
          );
        }
      }
    });

    if (sentCount > 0) {
      console.log(
        `[websocket] Broadcasted ${message.type} for ${subscription} to ${sentCount} clients`
      );
    }
  }

  /**
   * Broadcast a relationship or feedback update for a specific project
   * These don't have a specific entity type in the subscription, so we broadcast to 'all' subscribers for the project
   */
  broadcastGeneric(projectId: string, message: ServerMessage): void {
    const allSubscription = `${projectId}:all`;
    let sentCount = 0;

    // Ensure message includes projectId
    message.projectId = projectId;

    this.clients.forEach((client) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Only send to clients subscribed to 'all' for this project
      if (client.subscriptions.has(allSubscription)) {
        try {
          client.ws.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          console.error(
            `[websocket] Failed to broadcast to ${client.id}:`,
            error
          );
        }
      }
    });

    if (sentCount > 0) {
      console.log(
        `[websocket] Broadcasted ${message.type} for project ${projectId} to ${sentCount} clients`
      );
    }
  }

  /**
   * Broadcast project lifecycle events (opened/closed)
   */
  broadcastProjectEvent(projectId: string, event: "opened" | "closed", data?: any): void {
    const allSubscription = `${projectId}:all`;
    const message: ServerMessage = {
      type: event === "opened" ? "project_opened" : "project_closed",
      projectId,
      data,
    };

    let sentCount = 0;

    this.clients.forEach((client) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Send to clients subscribed to this project
      if (client.subscriptions.has(allSubscription)) {
        try {
          client.ws.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          console.error(
            `[websocket] Failed to broadcast to ${client.id}:`,
            error
          );
        }
      }
    });

    if (sentCount > 0) {
      console.log(
        `[websocket] Broadcasted project_${event} for ${projectId} to ${sentCount} clients`
      );
    }
  }

  /**
   * Start the heartbeat mechanism to detect dead connections
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, clientId) => {
        if (!client.isAlive) {
          console.log(`[websocket] Terminating dead connection: ${clientId}`);
          client.ws.terminate();
          this.clients.delete(clientId);
          return;
        }

        client.isAlive = false;
        try {
          client.ws.ping();
        } catch (error) {
          console.error(`[websocket] Failed to ping ${clientId}:`, error);
        }
      });
    }, this.HEARTBEAT_INTERVAL);

    console.log(
      `[websocket] Heartbeat started (interval: ${this.HEARTBEAT_INTERVAL}ms)`
    );
  }

  /**
   * Stop the heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log("[websocket] Heartbeat stopped");
    }
  }

  /**
   * Get the WebSocket server instance
   */
  getServer(): WebSocketServer | null {
    return this.wss;
  }

  /**
   * Get statistics about connected clients
   */
  getStats(): {
    totalClients: number;
    clients: Array<{
      id: string;
      subscriptions: string[];
      connectedAt: string;
      isAlive: boolean;
    }>;
  } {
    return {
      totalClients: this.clients.size,
      clients: Array.from(this.clients.values()).map((client) => ({
        id: client.id,
        subscriptions: Array.from(client.subscriptions),
        connectedAt: client.connectedAt.toISOString(),
        isAlive: client.isAlive,
      })),
    };
  }

  /**
   * Gracefully shutdown the WebSocket server
   */
  async shutdown(): Promise<void> {
    console.log("[websocket] Shutting down WebSocket server...");

    this.stopHeartbeat();

    // Close all client connections
    this.clients.forEach((client) => {
      try {
        client.ws.close(1000, "Server shutting down");
      } catch (error) {
        console.error(`[websocket] Error closing client ${client.id}:`, error);
      }
    });

    this.clients.clear();

    // Close the WebSocket server
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          console.log("[websocket] WebSocket server closed");
          this.wss = null;
          resolve();
        });
      });
    }
  }
}

// Export singleton instance
export const websocketManager = new WebSocketManager();

/**
 * Initialize the WebSocket server
 */
export function initWebSocketServer(server: http.Server, path?: string): void {
  websocketManager.init(server, path);
}

/**
 * Broadcast issue updates to subscribed clients for a specific project
 */
export function broadcastIssueUpdate(
  projectId: string,
  issueId: string,
  action: "created" | "updated" | "deleted",
  data?: any
): void {
  websocketManager.broadcast(projectId, "issue", issueId, {
    type: `issue_${action}` as any,
    data,
  });
}

/**
 * Broadcast spec updates to subscribed clients for a specific project
 */
export function broadcastSpecUpdate(
  projectId: string,
  specId: string,
  action: "created" | "updated" | "deleted",
  data?: any
): void {
  websocketManager.broadcast(projectId, "spec", specId, {
    type: `spec_${action}` as any,
    data,
  });
}

/**
 * Broadcast feedback updates to subscribed clients for a specific project
 */
export function broadcastFeedbackUpdate(
  projectId: string,
  action: "created" | "updated" | "deleted",
  data?: any
): void {
  websocketManager.broadcastGeneric(projectId, {
    type: `feedback_${action}` as any,
    data,
  });
}

/**
 * Broadcast relationship updates to subscribed clients for a specific project
 */
export function broadcastRelationshipUpdate(
  projectId: string,
  action: "created" | "deleted",
  data?: any
): void {
  websocketManager.broadcastGeneric(projectId, {
    type: `relationship_${action}` as any,
    data,
  });
}

/**
 * Broadcast execution updates to subscribed clients for a specific project
 * Also optionally broadcasts to parent issue subscribers
 *
 * @param projectId - ID of the project
 * @param executionId - ID of the execution
 * @param action - The action performed on the execution
 * @param data - Execution data to broadcast
 * @param issueId - Optional issue ID to also broadcast to issue subscribers
 */
export function broadcastExecutionUpdate(
  projectId: string,
  executionId: string,
  action: "created" | "updated" | "status_changed" | "deleted",
  data?: any,
  issueId?: string
): void {
  // Primary broadcast to execution subscribers
  websocketManager.broadcast(projectId, "execution", executionId, {
    type: `execution_${action}` as any,
    data,
  });

  // Secondary broadcast to issue subscribers if issueId provided
  // This allows clients viewing an issue to see its execution updates
  // without subscribing to each individual execution
  if (issueId) {
    websocketManager.broadcast(projectId, "issue", issueId, {
      type: `execution_${action}` as any,
      data,
    });
  }
}

/**
 * Broadcast voice narration event to subscribed clients for a specific execution
 *
 * This is used to emit voice narration events during execution streaming.
 * Clients can subscribe to execution events to receive narration updates.
 *
 * @param projectId - ID of the project
 * @param executionId - ID of the execution emitting the narration
 * @param narrationData - Voice narration event data
 * @param issueId - Optional issue ID to also broadcast to issue subscribers
 */
export function broadcastVoiceNarration(
  projectId: string,
  executionId: string,
  narrationData: {
    text: string;
    category: "status" | "progress" | "result" | "error";
    priority: "low" | "normal" | "high";
  },
  issueId?: string
): void {
  // Primary broadcast to execution subscribers
  websocketManager.broadcast(projectId, "execution", executionId, {
    type: "voice_narration",
    data: {
      executionId,
      ...narrationData,
    },
  });

  // Secondary broadcast to issue subscribers if issueId provided
  if (issueId) {
    websocketManager.broadcast(projectId, "issue", issueId, {
      type: "voice_narration",
      data: {
        executionId,
        ...narrationData,
      },
    });
  }
}

/**
 * Broadcast project opened event to subscribed clients
 */
export function broadcastProjectOpened(projectId: string, data?: any): void {
  websocketManager.broadcastProjectEvent(projectId, "opened", data);
}

/**
 * Broadcast project closed event to subscribed clients
 */
export function broadcastProjectClosed(projectId: string, data?: any): void {
  websocketManager.broadcastProjectEvent(projectId, "closed", data);
}

/**
 * Get the WebSocket server instance
 */
export function getWebSocketServer() {
  return websocketManager.getServer();
}

/**
 * Get WebSocket server statistics
 */
export function getWebSocketStats() {
  return websocketManager.getStats();
}

/**
 * Shutdown the WebSocket server
 */
export async function shutdownWebSocketServer(): Promise<void> {
  await websocketManager.shutdown();
}

/**
 * Broadcast workflow updates to subscribed clients for a specific project
 */
export function broadcastWorkflowUpdate(
  projectId: string,
  workflowId: string,
  action:
    | "created"
    | "updated"
    | "deleted"
    | "started"
    | "paused"
    | "resumed"
    | "completed"
    | "failed"
    | "cancelled"
    | "escalation_requested"
    | "escalation_resolved"
    | "notification"
    | "awaiting",
  data?: any
): void {
  websocketManager.broadcast(projectId, "workflow", workflowId, {
    type: `workflow_${action}` as ServerMessage["type"],
    data,
  });
}

/**
 * Broadcast workflow step updates to subscribed clients for a specific project
 */
export function broadcastWorkflowStepUpdate(
  projectId: string,
  workflowId: string,
  action: "started" | "completed" | "failed" | "skipped",
  data?: any
): void {
  websocketManager.broadcast(projectId, "workflow", workflowId, {
    type: `workflow_step_${action}` as ServerMessage["type"],
    data,
  });
}

/**
 * Broadcast a generic message to all subscribers for a specific project
 * Used for integration sync events and other project-wide notifications
 */
export function broadcastToProject(
  projectId: string,
  message: { type: string; [key: string]: unknown }
): void {
  websocketManager.broadcastGeneric(projectId, message as ServerMessage);
}
