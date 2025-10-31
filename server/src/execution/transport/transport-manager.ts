/**
 * Transport Manager
 *
 * Coordinates between AG-UI adapter and SSE transport layer.
 * Acts as a facade that routes adapter events to appropriate transport methods.
 *
 * @module execution/transport/transport-manager
 */

import type { AgUiEventAdapter } from '../output/ag-ui-adapter.js';
import type {
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StepStartedEvent,
  StepFinishedEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
  CustomEvent,
} from '@ag-ui/core';
import { SseTransport } from './sse-transport.js';

/**
 * Union type for all AG-UI events
 */
export type AgUiEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StateDeltaEvent
  | StateSnapshotEvent
  | CustomEvent;

/**
 * TransportManager - Coordinates AG-UI events with SSE transport
 *
 * Manages the connection between AG-UI adapters and SSE transport,
 * routing events to appropriate broadcast methods based on run filtering.
 *
 * @example
 * ```typescript
 * const manager = new TransportManager();
 * const adapter = new AgUiEventAdapter('run-123');
 *
 * // Connect adapter to transport
 * manager.connectAdapter(adapter, 'run-123');
 *
 * // Events from adapter are now automatically broadcast via SSE
 * ```
 */
export class TransportManager {
  private sseTransport: SseTransport;
  private adapterListeners: Map<AgUiEventAdapter, (event: AgUiEvent) => void> =
    new Map();

  /**
   * Create a new transport manager
   *
   * Initializes the SSE transport layer
   */
  constructor() {
    this.sseTransport = new SseTransport();
  }

  /**
   * Connect AG-UI adapter to SSE transport
   *
   * Subscribes to adapter's event stream and routes events to SSE transport.
   * If runId is provided, events are broadcast only to clients watching that run.
   * Otherwise, events are broadcast to all connected clients.
   *
   * @param adapter - AG-UI event adapter to connect
   * @param runId - Optional run ID for filtering events
   *
   * @example
   * ```typescript
   * const adapter = new AgUiEventAdapter('run-123');
   * manager.connectAdapter(adapter, 'run-123');
   * ```
   */
  connectAdapter(adapter: AgUiEventAdapter, runId?: string): void {
    // Create listener function
    const listener = (event: AgUiEvent) => {
      if (runId) {
        this.broadcastToRun(runId, event);
      } else {
        this.broadcast(event);
      }
    };

    // Store listener for cleanup
    this.adapterListeners.set(adapter, listener);

    // Subscribe to adapter events
    adapter.onEvent(listener);
  }

  /**
   * Disconnect AG-UI adapter from transport
   *
   * Removes the adapter's event listener and stops broadcasting its events.
   *
   * @param adapter - AG-UI event adapter to disconnect
   * @returns true if adapter was disconnected, false if not found
   */
  disconnectAdapter(adapter: AgUiEventAdapter): boolean {
    const listener = this.adapterListeners.get(adapter);
    if (!listener) {
      return false;
    }

    adapter.offEvent(listener);
    this.adapterListeners.delete(adapter);
    return true;
  }

  /**
   * Broadcast event to all connected clients
   *
   * @param event - AG-UI event to broadcast
   * @returns Number of clients that received the event
   *
   * @example
   * ```typescript
   * manager.broadcast({
   *   type: EventType.RUN_STARTED,
   *   runId: 'run-123',
   *   threadId: 'run-123',
   *   timestamp: Date.now()
   * });
   * ```
   */
  broadcast(event: AgUiEvent): number {
    return this.sseTransport.broadcast({
      event: event.type,
      data: event,
    });
  }

  /**
   * Broadcast event to clients watching a specific run
   *
   * @param runId - Target run ID
   * @param event - AG-UI event to broadcast
   * @returns Number of clients that received the event
   *
   * @example
   * ```typescript
   * manager.broadcastToRun('run-123', {
   *   type: EventType.TOOL_CALL_START,
   *   toolCallId: 'tool-1',
   *   toolCallName: 'Read',
   *   timestamp: Date.now()
   * });
   * ```
   */
  broadcastToRun(runId: string, event: AgUiEvent): number {
    return this.sseTransport.broadcastToRun(runId, {
      event: event.type,
      data: event,
    });
  }

  /**
   * Get underlying SSE transport
   *
   * Provides access to the SSE transport for route handlers
   * that need to manage client connections.
   *
   * @returns SSE transport instance
   *
   * @example
   * ```typescript
   * const transport = manager.getSseTransport();
   *
   * // Handle SSE connection in route
   * app.get('/api/events', (req, res) => {
   *   transport.handleConnection(clientId, res, runId);
   * });
   * ```
   */
  getSseTransport(): SseTransport {
    return this.sseTransport;
  }

  /**
   * Get number of connected adapters
   *
   * @returns Number of active adapter connections
   */
  getAdapterCount(): number {
    return this.adapterListeners.size;
  }

  /**
   * Shutdown transport manager
   *
   * Disconnects all adapters and shuts down SSE transport.
   * Closes all client connections and releases resources.
   */
  shutdown(): void {
    // Disconnect all adapters
    for (const adapter of this.adapterListeners.keys()) {
      this.disconnectAdapter(adapter);
    }

    // Shutdown SSE transport
    this.sseTransport.shutdown();
  }
}
