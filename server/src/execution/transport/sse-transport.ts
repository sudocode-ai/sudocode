/**
 * Server-Sent Events (SSE) Transport Layer
 *
 * Provides real-time streaming of AG-UI events to frontend clients using SSE.
 * Supports connection management, heartbeat, and run-specific event filtering.
 *
 * @module execution/transport/sse-transport
 */

import type { Response } from 'express';

/**
 * SSE Client Connection
 *
 * Represents an active SSE connection with a client
 */
interface SseClient {
  /** Unique client identifier */
  clientId: string;
  /** Express response object for sending events */
  response: Response;
  /** Optional run ID for filtering events */
  runId?: string;
  /** When the connection was established */
  connectedAt: Date;
  /** Last time data was sent to this client */
  lastActivity: Date;
}

/**
 * SSE Event to send to clients
 *
 * Follows the SSE specification format
 */
interface SseEvent {
  /** Event type (optional, defaults to 'message') */
  event?: string;
  /** Event data (will be JSON stringified) */
  data: any;
  /** Event ID (optional) */
  id?: string;
}

/**
 * SseTransport - Server-Sent Events transport for AG-UI events
 *
 * Manages SSE connections and streams AG-UI protocol events to connected clients.
 * Supports multiple concurrent connections, heartbeat mechanism, and run-specific filtering.
 *
 * @example
 * ```typescript
 * const transport = new SseTransport();
 *
 * // Handle new connection
 * app.get('/api/events', (req, res) => {
 *   const clientId = req.query.clientId as string;
 *   const runId = req.query.runId as string | undefined;
 *   transport.handleConnection(clientId, res, runId);
 * });
 *
 * // Send event to specific client
 * transport.sendToClient('client-123', {
 *   event: 'TOOL_CALL_START',
 *   data: { type: 'TOOL_CALL_START', toolCallId: 'tool-1' }
 * });
 *
 * // Broadcast to all clients watching a specific run
 * transport.broadcastToRun('run-123', {
 *   event: 'RUN_FINISHED',
 *   data: { type: 'RUN_FINISHED', runId: 'run-123' }
 * });
 * ```
 */
export class SseTransport {
  private clients: Map<string, SseClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

  /**
   * Create a new SSE transport instance
   */
  constructor() {
    this.startHeartbeat();
  }

  /**
   * Handle a new SSE connection from a client
   *
   * Sets up proper SSE headers, registers the client, and handles cleanup on disconnect.
   *
   * @param clientId - Unique identifier for this client
   * @param res - Express response object
   * @param runId - Optional run ID to filter events
   */
  handleConnection(clientId: string, res: Response, runId?: string): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Enable CORS for SSE (if needed)
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Disable compression for SSE
    res.flushHeaders();

    const client: SseClient = {
      clientId,
      response: res,
      runId,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    this.clients.set(clientId, client);

    // Send initial connection acknowledgment
    this.sendToClient(clientId, {
      event: 'connected',
      data: {
        clientId,
        runId,
        timestamp: Date.now(),
      },
    });

    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(clientId);
    });
  }

  /**
   * Send an event to a specific client
   *
   * @param clientId - Target client ID
   * @param event - Event to send
   * @returns true if sent successfully, false if client not found
   */
  sendToClient(clientId: string, event: SseEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    return this.writeEvent(client, event);
  }

  /**
   * Broadcast an event to all connected clients
   *
   * @param event - Event to broadcast
   * @returns Number of clients that received the event
   */
  broadcast(event: SseEvent): number {
    let sentCount = 0;

    for (const client of this.clients.values()) {
      if (this.writeEvent(client, event)) {
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Broadcast an event to all clients watching a specific run
   *
   * @param runId - Target run ID
   * @param event - Event to send
   * @returns Number of clients that received the event
   */
  broadcastToRun(runId: string, event: SseEvent): number {
    let sentCount = 0;

    for (const client of this.clients.values()) {
      if (client.runId === runId) {
        if (this.writeEvent(client, event)) {
          sentCount++;
        }
      }
    }

    return sentCount;
  }

  /**
   * Remove a client connection
   *
   * @param clientId - Client to remove
   * @returns true if client was removed, false if not found
   */
  removeClient(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    // Try to close the response if it's still open
    try {
      if (!client.response.writableEnded) {
        client.response.end();
      }
    } catch (error) {
      // Connection already closed, ignore
    }

    this.clients.delete(clientId);
    return true;
  }

  /**
   * Get the number of active connections
   *
   * @returns Number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get the number of clients watching a specific run
   *
   * @param runId - Run ID to check
   * @returns Number of clients watching this run
   */
  getRunClientCount(runId: string): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.runId === runId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get all active client IDs
   *
   * @returns Array of client IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Shutdown the transport and close all connections
   */
  shutdown(): void {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const clientId of this.clients.keys()) {
      this.removeClient(clientId);
    }
  }

  /**
   * Write an event to a client connection
   *
   * Formats the event according to SSE specification and writes it to the response.
   *
   * @param client - Target client
   * @param event - Event to write
   * @returns true if successful, false if write failed
   */
  private writeEvent(client: SseClient, event: SseEvent): boolean {
    try {
      const { response } = client;

      // Check if response is still writable
      if (response.writableEnded || !response.writable) {
        this.removeClient(client.clientId);
        return false;
      }

      // Format SSE message
      let message = '';

      // Add event type if specified
      if (event.event) {
        message += `event: ${event.event}\n`;
      }

      // Add event ID if specified
      if (event.id) {
        message += `id: ${event.id}\n`;
      }

      // Add data (JSON stringify if object)
      const dataString =
        typeof event.data === 'string'
          ? event.data
          : JSON.stringify(event.data);

      // SSE spec requires data to be on separate lines if multiline
      const dataLines = dataString.split('\n');
      for (const line of dataLines) {
        message += `data: ${line}\n`;
      }

      // SSE messages end with double newline
      message += '\n';

      // Write to response
      response.write(message);

      // Update last activity
      client.lastActivity = new Date();

      return true;
    } catch (error) {
      // Connection error, remove client
      this.removeClient(client.clientId);
      return false;
    }
  }

  /**
   * Start the heartbeat mechanism
   *
   * Sends periodic ping events to keep connections alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const pingEvent: SseEvent = {
        event: 'ping',
        data: { timestamp: Date.now() },
      };

      // Send ping to all clients
      for (const client of this.clients.values()) {
        this.writeEvent(client, pingEvent);
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }
}
