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
  subscriptions: Set<string>; // e.g., 'issue:ISSUE-001', 'spec:SPEC-001', 'all'
  isAlive: boolean;
  connectedAt: Date;
}

/**
 * Message types that clients can send to the server
 */
interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  entity_type?: "issue" | "spec" | "all";
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
    | "pong"
    | "error"
    | "subscribed"
    | "unsubscribed";
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
   */
  init(server: http.Server, path: string = "/ws"): void {
    if (this.wss) {
      console.warn("[websocket] WebSocket server already initialized");
      return;
    }

    this.wss = new WebSocketServer({ server, path });
    console.log(`[websocket] WebSocket server initialized on path: ${path}`);

    this.wss.on("connection", this.handleConnection.bind(this));
    this.startHeartbeat();
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

    if (message.entity_type === "all") {
      // Subscribe to all updates
      subscription = "all";
    } else if (message.entity_type && message.entity_id) {
      // Subscribe to a specific entity
      subscription = `${message.entity_type}:${message.entity_id}`;
    } else if (message.entity_type) {
      // Subscribe to all entities of a type
      subscription = `${message.entity_type}:*`;
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

    if (message.entity_type === "all") {
      subscription = "all";
    } else if (message.entity_type && message.entity_id) {
      subscription = `${message.entity_type}:${message.entity_id}`;
    } else if (message.entity_type) {
      subscription = `${message.entity_type}:*`;
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
   * Broadcast a message to all subscribed clients
   */
  broadcast(
    entityType: "issue" | "spec",
    entityId: string,
    message: ServerMessage
  ): void {
    const subscription = `${entityType}:${entityId}`;
    const typeSubscription = `${entityType}:*`;
    let sentCount = 0;

    this.clients.forEach((client) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Check if client is subscribed to this specific entity, entity type, or all
      if (
        client.subscriptions.has(subscription) ||
        client.subscriptions.has(typeSubscription) ||
        client.subscriptions.has("all")
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
   * Broadcast a relationship or feedback update
   * These don't have a specific entity type in the subscription, so we broadcast to 'all' subscribers
   */
  broadcastGeneric(message: ServerMessage): void {
    let sentCount = 0;

    this.clients.forEach((client) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Only send to clients subscribed to 'all'
      if (client.subscriptions.has("all")) {
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
        `[websocket] Broadcasted ${message.type} to ${sentCount} clients`
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
 * Broadcast issue updates to subscribed clients
 */
export function broadcastIssueUpdate(
  issueId: string,
  action: "created" | "updated" | "deleted",
  data?: any
): void {
  websocketManager.broadcast("issue", issueId, {
    type: `issue_${action}` as any,
    data,
  });
}

/**
 * Broadcast spec updates to subscribed clients
 */
export function broadcastSpecUpdate(
  specId: string,
  action: "created" | "updated" | "deleted",
  data?: any
): void {
  websocketManager.broadcast("spec", specId, {
    type: `spec_${action}` as any,
    data,
  });
}

/**
 * Broadcast feedback updates to subscribed clients
 */
export function broadcastFeedbackUpdate(
  action: "created" | "updated" | "deleted",
  data?: any
): void {
  websocketManager.broadcastGeneric({
    type: `feedback_${action}` as any,
    data,
  });
}

/**
 * Broadcast relationship updates to subscribed clients
 */
export function broadcastRelationshipUpdate(
  action: "created" | "deleted",
  data?: any
): void {
  websocketManager.broadcastGeneric({
    type: `relationship_${action}` as any,
    data,
  });
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
