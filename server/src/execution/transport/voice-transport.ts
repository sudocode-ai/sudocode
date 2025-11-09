/**
 * Voice Transport
 *
 * Handles bidirectional WebSocket communication for voice events.
 * Routes voice input from clients to executions and broadcasts
 * voice output/status events to connected clients.
 *
 * @module execution/transport/voice-transport
 */

import type { VoiceEvent, VoiceInputData } from "@sudocode-ai/types";
import type { VoiceTranscriptQueue } from "../../services/voice-transcript-queue.js";

/**
 * Voice input handler callback
 */
export type VoiceInputHandler = (
  executionId: string,
  data: VoiceInputData
) => void | Promise<void>;

/**
 * Voice client connection
 */
interface VoiceClient {
  clientId: string;
  executionIds: Set<string>; // Executions this client is listening to
  connectedAt: Date;
}

/**
 * VoiceTransport - WebSocket transport for voice events
 *
 * Manages voice-specific WebSocket connections and routes voice events
 * between clients and executions. Integrates with the existing WebSocket
 * infrastructure while providing voice-specific functionality.
 *
 * @example
 * ```typescript
 * const transport = new VoiceTransport();
 *
 * // Register handler for voice input
 * transport.onVoiceInput((executionId, data) => {
 *   console.log(`Voice input for ${executionId}:`, data.transcript);
 *   // Process the voice input...
 * });
 *
 * // Register a client for voice events
 * transport.registerClient('client-123', 'exec-456');
 *
 * // Broadcast voice output
 * transport.broadcastVoiceOutput('exec-456', {
 *   type: 'voice_output',
 *   executionId: 'exec-456',
 *   timestamp: new Date().toISOString(),
 *   data: {
 *     text: 'Processing your request...',
 *     priority: 'normal',
 *     interrupt: false
 *   }
 * });
 * ```
 */
export class VoiceTransport {
  private clients: Map<string, VoiceClient> = new Map();
  private inputHandlers: Set<VoiceInputHandler> = new Set();
  private executionClients: Map<string, Set<string>> = new Map(); // execution -> clients
  private broadcastCallback: ((
    clientId: string,
    message: any
  ) => void) | null = null;
  private transcriptQueue: VoiceTranscriptQueue | null = null;

  /**
   * Create a new voice transport instance
   *
   * @param transcriptQueue - Optional transcript queue for storing voice input
   */
  constructor(transcriptQueue?: VoiceTranscriptQueue) {
    this.transcriptQueue = transcriptQueue || null;
  }

  /**
   * Set the callback for broadcasting messages to clients
   *
   * This should be connected to the WebSocket manager's sendToClient method
   *
   * @param callback - Function to send message to a specific client
   */
  setBroadcastCallback(callback: (clientId: string, message: any) => void): void {
    this.broadcastCallback = callback;
  }

  /**
   * Register a client for voice events on an execution
   *
   * @param clientId - Client identifier
   * @param executionId - Execution to listen to
   */
  registerClient(clientId: string, executionId: string): void {
    let client = this.clients.get(clientId);

    if (!client) {
      client = {
        clientId,
        executionIds: new Set(),
        connectedAt: new Date(),
      };
      this.clients.set(clientId, client);
    }

    client.executionIds.add(executionId);

    // Add to execution -> clients mapping
    let clients = this.executionClients.get(executionId);
    if (!clients) {
      clients = new Set();
      this.executionClients.set(executionId, clients);
    }
    clients.add(clientId);

    console.log(
      `[voice-transport] Client ${clientId} registered for execution ${executionId}`
    );
  }

  /**
   * Unregister a client from an execution
   *
   * @param clientId - Client identifier
   * @param executionId - Execution to stop listening to
   */
  unregisterClient(clientId: string, executionId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.executionIds.delete(executionId);

      // If client has no more executions, remove entirely
      if (client.executionIds.size === 0) {
        this.clients.delete(clientId);
      }
    }

    // Remove from execution -> clients mapping
    const clients = this.executionClients.get(executionId);
    if (clients) {
      clients.delete(clientId);
      if (clients.size === 0) {
        this.executionClients.delete(executionId);
      }
    }

    console.log(
      `[voice-transport] Client ${clientId} unregistered from execution ${executionId}`
    );
  }

  /**
   * Remove all registrations for a client
   *
   * @param clientId - Client identifier
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      // Remove from all execution mappings
      client.executionIds.forEach((executionId) => {
        const clients = this.executionClients.get(executionId);
        if (clients) {
          clients.delete(clientId);
          if (clients.size === 0) {
            this.executionClients.delete(executionId);
          }
        }
      });

      this.clients.delete(clientId);
      console.log(`[voice-transport] Client ${clientId} removed`);
    }
  }

  /**
   * Handle incoming voice input from a client
   *
   * @param clientId - Client that sent the input
   * @param event - Voice input event
   */
  async handleVoiceInput(clientId: string, event: VoiceEvent): Promise<void> {
    if (event.type !== "voice_input") {
      console.warn(
        `[voice-transport] Invalid event type: ${event.type}, expected voice_input`
      );
      return;
    }

    const { executionId, data } = event;

    // Verify client is registered for this execution
    const client = this.clients.get(clientId);
    if (!client || !client.executionIds.has(executionId)) {
      console.warn(
        `[voice-transport] Client ${clientId} not registered for execution ${executionId}`
      );
      return;
    }

    console.log(
      `[voice-transport] Voice input from ${clientId} for ${executionId}:`,
      (data as VoiceInputData).transcript?.substring(0, 50)
    );

    // Queue transcript if queue is available
    if (this.transcriptQueue) {
      this.transcriptQueue.enqueue(executionId, data as VoiceInputData);
    }

    // Notify all registered handlers
    for (const handler of Array.from(this.inputHandlers)) {
      try {
        await handler(executionId, data as VoiceInputData);
      } catch (error) {
        console.error("[voice-transport] Error in voice input handler:", error);
      }
    }
  }

  /**
   * Broadcast voice output to all clients listening to an execution
   *
   * @param executionId - Execution that generated the output
   * @param event - Voice output event
   */
  broadcastVoiceOutput(executionId: string, event: VoiceEvent): void {
    const clients = this.executionClients.get(executionId);

    if (!clients || clients.size === 0) {
      console.log(
        `[voice-transport] No clients for execution ${executionId}, skipping broadcast`
      );
      return;
    }

    console.log(
      `[voice-transport] Broadcasting voice output to ${clients.size} client(s) for ${executionId}`
    );

    // Broadcast to all clients
    for (const clientId of Array.from(clients)) {
      this.sendToClient(clientId, {
        type: "voice_event",
        event,
      });
    }
  }

  /**
   * Broadcast voice status to all clients listening to an execution
   *
   * @param executionId - Execution that changed status
   * @param event - Voice status event
   */
  broadcastVoiceStatus(executionId: string, event: VoiceEvent): void {
    const clients = this.executionClients.get(executionId);

    if (!clients || clients.size === 0) {
      return;
    }

    // Broadcast to all clients
    for (const clientId of Array.from(clients)) {
      this.sendToClient(clientId, {
        type: "voice_event",
        event,
      });
    }
  }

  /**
   * Register a handler for voice input events
   *
   * @param handler - Callback to invoke when voice input is received
   */
  onVoiceInput(handler: VoiceInputHandler): void {
    this.inputHandlers.add(handler);
  }

  /**
   * Remove a voice input handler
   *
   * @param handler - Handler to remove
   */
  offVoiceInput(handler: VoiceInputHandler): void {
    this.inputHandlers.delete(handler);
  }

  /**
   * Send a message to a specific client
   *
   * @param clientId - Client to send to
   * @param message - Message to send
   */
  private sendToClient(clientId: string, message: any): void {
    if (this.broadcastCallback) {
      this.broadcastCallback(clientId, message);
    } else {
      console.warn(
        "[voice-transport] No broadcast callback set, cannot send message"
      );
    }
  }

  /**
   * Get all clients listening to an execution
   *
   * @param executionId - Execution ID
   * @returns Set of client IDs
   */
  getClientsForExecution(executionId: string): Set<string> {
    return this.executionClients.get(executionId) || new Set();
  }

  /**
   * Get all executions a client is listening to
   *
   * @param clientId - Client ID
   * @returns Set of execution IDs
   */
  getExecutionsForClient(clientId: string): Set<string> {
    const client = this.clients.get(clientId);
    return client ? client.executionIds : new Set();
  }

  /**
   * Get statistics about voice transport
   */
  getStats(): {
    totalClients: number;
    totalExecutions: number;
    clientExecutionPairs: number;
  } {
    let pairs = 0;
    this.clients.forEach((client) => {
      pairs += client.executionIds.size;
    });

    return {
      totalClients: this.clients.size,
      totalExecutions: this.executionClients.size,
      clientExecutionPairs: pairs,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clients.clear();
    this.executionClients.clear();
    this.inputHandlers.clear();
    this.broadcastCallback = null;
  }
}
