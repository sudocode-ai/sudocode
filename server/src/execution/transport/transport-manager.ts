/**
 * Transport Manager
 *
 * Coordinates between AG-UI adapter and SSE transport layer.
 * Acts as a facade that routes adapter events to appropriate transport methods.
 * Also manages voice transport for speech input/output.
 *
 * @module execution/transport/transport-manager
 */

import type { AgUiEventAdapter } from "../output/ag-ui-adapter.js";
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
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
  CustomEvent,
} from "@ag-ui/core";
import { SseTransport } from "./sse-transport.js";
import { EventBuffer } from "./event-buffer.js";
import { VoiceTransport } from "./voice-transport.js";
import { VoiceEventAdapter } from "../output/voice-event-adapter.js";
import type { VoiceEvent } from "@sudocode-ai/types";
import type { VoiceTranscriptQueue } from "../../services/voice-transcript-queue.js";

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
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
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
  private voiceTransport: VoiceTransport;
  private eventBuffer: EventBuffer;
  private adapterListeners: Map<AgUiEventAdapter, (event: AgUiEvent) => void> =
    new Map();
  private voiceAdapters: Map<string, VoiceEventAdapter> = new Map();
  private pruneInterval: NodeJS.Timeout | null = null;

  /**
   * Create a new transport manager
   *
   * Initializes the SSE transport layer, voice transport, and event buffer
   *
   * @param transcriptQueue - Optional voice transcript queue
   */
  constructor(transcriptQueue?: VoiceTranscriptQueue) {
    this.sseTransport = new SseTransport();
    this.voiceTransport = new VoiceTransport(transcriptQueue);
    this.eventBuffer = new EventBuffer();

    // Start periodic pruning of stale buffers (every 15 minutes)
    this.pruneInterval = setInterval(
      () => {
        this.eventBuffer.pruneStale();
      },
      15 * 60 * 1000
    );
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
      // Buffer the event if runId is provided
      if (runId) {
        this.eventBuffer.addEvent(runId, event);
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
    const clientCount = this.sseTransport.broadcastToRun(runId, {
      event: event.type,
      data: event,
    });
    return clientCount;
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
   * Get buffered events for an execution
   *
   * Returns all events that have been buffered for the specified execution.
   * Useful for replaying events to late-joining clients.
   *
   * @param runId - Target run ID
   * @param fromSequence - Optional: only return events >= this sequence number
   * @returns Array of buffered events
   *
   * @example
   * ```typescript
   * const events = manager.getBufferedEvents('run-123');
   * for (const buffered of events) {
   *   console.log(buffered.event.type, buffered.sequenceNumber);
   * }
   * ```
   */
  getBufferedEvents(runId: string, fromSequence?: number) {
    return this.eventBuffer.getEvents(runId, fromSequence);
  }

  /**
   * Check if events are buffered for an execution
   *
   * @param runId - Target run ID
   * @returns true if events are buffered
   */
  hasBufferedEvents(runId: string): boolean {
    return this.eventBuffer.hasBuffer(runId);
  }

  /**
   * Get buffer statistics
   *
   * @returns Buffer statistics
   */
  getBufferStats() {
    return this.eventBuffer.getStats();
  }

  /**
   * Connect voice adapter for an execution
   *
   * Creates a voice adapter that transforms AG-UI events to voice events
   * and connects it to the AG-UI adapter's event stream.
   *
   * @param executionId - Execution ID
   * @param agUiAdapter - AG-UI adapter to listen to
   * @returns Voice event adapter instance
   */
  connectVoiceAdapter(
    executionId: string,
    agUiAdapter: AgUiEventAdapter
  ): VoiceEventAdapter {
    // Create voice adapter
    const voiceAdapter = new VoiceEventAdapter(executionId);
    this.voiceAdapters.set(executionId, voiceAdapter);

    // Subscribe to AG-UI events and transform to voice events
    const listener = (event: AgUiEvent) => {
      let voiceEvents: VoiceEvent[] = [];

      // Transform based on event type
      switch (event.type) {
        case "TEXT_MESSAGE_START":
          voiceEvents = voiceAdapter.processTextMessageStart(
            event as TextMessageStartEvent
          );
          break;
        case "TEXT_MESSAGE_CONTENT":
          voiceEvents = voiceAdapter.processTextMessageContent(
            event as TextMessageContentEvent
          );
          break;
        case "TEXT_MESSAGE_END":
          voiceEvents = voiceAdapter.processTextMessageEnd(
            event as TextMessageEndEvent
          );
          break;
        case "TOOL_CALL_RESULT":
          voiceEvents = voiceAdapter.processToolCallResult(
            event as ToolCallResultEvent
          );
          break;
        case "RUN_ERROR":
          voiceEvents = voiceAdapter.processRunError(event as RunErrorEvent);
          break;
      }

      // Broadcast voice events
      voiceEvents.forEach((voiceEvent) => {
        if (voiceEvent.type === "voice_output") {
          this.voiceTransport.broadcastVoiceOutput(executionId, voiceEvent);
        } else if (voiceEvent.type === "voice_status") {
          this.voiceTransport.broadcastVoiceStatus(executionId, voiceEvent);
        }
      });
    };

    agUiAdapter.onEvent(listener);

    return voiceAdapter;
  }

  /**
   * Disconnect voice adapter for an execution
   *
   * @param executionId - Execution ID
   * @returns true if adapter was disconnected, false if not found
   */
  disconnectVoiceAdapter(executionId: string): boolean {
    const adapter = this.voiceAdapters.get(executionId);
    if (!adapter) {
      return false;
    }

    adapter.dispose();
    this.voiceAdapters.delete(executionId);
    return true;
  }

  /**
   * Get voice transport instance
   *
   * Provides access to voice transport for WebSocket handlers
   *
   * @returns Voice transport instance
   */
  getVoiceTransport(): VoiceTransport {
    return this.voiceTransport;
  }

  /**
   * Get voice adapter for an execution
   *
   * @param executionId - Execution ID
   * @returns Voice adapter or undefined if not found
   */
  getVoiceAdapter(executionId: string): VoiceEventAdapter | undefined {
    return this.voiceAdapters.get(executionId);
  }

  /**
   * Broadcast a voice event to an execution
   *
   * @param executionId - Target execution ID
   * @param event - Voice event to broadcast
   */
  broadcastVoiceEvent(executionId: string, event: VoiceEvent): void {
    if (event.type === "voice_output") {
      this.voiceTransport.broadcastVoiceOutput(executionId, event);
    } else if (event.type === "voice_status") {
      this.voiceTransport.broadcastVoiceStatus(executionId, event);
    }
  }

  /**
   * Shutdown transport manager
   *
   * Disconnects all adapters and shuts down SSE transport.
   * Closes all client connections and releases resources.
   */
  shutdown(): void {
    // Stop pruning interval
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }

    // Disconnect all adapters
    for (const adapter of this.adapterListeners.keys()) {
      this.disconnectAdapter(adapter);
    }

    // Disconnect all voice adapters
    for (const executionId of this.voiceAdapters.keys()) {
      this.disconnectVoiceAdapter(executionId);
    }

    // Shutdown transports
    this.sseTransport.shutdown();
    this.voiceTransport.dispose();

    // Clear event buffers
    this.eventBuffer.clearAll();
  }
}
