/**
 * IPC Transport Manager
 *
 * Custom TransportManager implementation for worker processes that forwards
 * AG-UI events to the main process via IPC (Inter-Process Communication)
 * instead of using SSE.
 *
 * @module execution/transport/ipc-transport-manager
 */

import type { AgUiEventAdapter } from "../output/ag-ui-adapter.js";
import type { AgUiEvent } from "./transport-manager.js";

/**
 * IPC message sent from worker to main process
 */
export interface IpcAgUiMessage {
  type: "agui-event";
  executionId: string;
  event: AgUiEvent;
}

/**
 * IPC TransportManager - Forwards AG-UI events via process.send()
 *
 * Lightweight transport manager for worker processes that don't need
 * SSE infrastructure. Instead, it forwards all events to the main process
 * via IPC messages.
 *
 * @example
 * ```typescript
 * const transport = new IpcTransportManager(executionId);
 * const adapter = new AgUiEventAdapter(executionId);
 *
 * // Connect adapter - events now forwarded via IPC
 * transport.connectAdapter(adapter, executionId);
 * ```
 */
export class IpcTransportManager {
  private executionId: string;
  private adapterListeners: Map<AgUiEventAdapter, (event: AgUiEvent) => void> =
    new Map();

  /**
   * Create IPC transport manager
   *
   * @param executionId - Execution ID for this worker
   */
  constructor(executionId: string) {
    this.executionId = executionId;
  }

  /**
   * Connect AG-UI adapter to IPC transport
   *
   * Subscribes to adapter's event stream and forwards events to main process.
   *
   * @param adapter - AG-UI event adapter to connect
   * @param _runId - Optional run ID (not used in IPC, but matches interface)
   */
  connectAdapter(adapter: AgUiEventAdapter, _runId?: string): void {
    // Create listener that forwards events via IPC
    const listener = (event: AgUiEvent) => {
      this.sendToMain(event);
    };

    // Store listener for cleanup
    this.adapterListeners.set(adapter, listener);

    // Subscribe to adapter events
    adapter.onEvent(listener);
  }

  /**
   * Disconnect AG-UI adapter from transport
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
   * Send AG-UI event to main process via IPC
   *
   * @private
   */
  private sendToMain(event: AgUiEvent): void {
    if (!process.send) {
      console.error("[IpcTransportManager] IPC not available (process.send is undefined)");
      return;
    }

    try {
      const message: IpcAgUiMessage = {
        type: "agui-event",
        executionId: this.executionId,
        event,
      };
      process.send(message);
    } catch (error) {
      console.error("[IpcTransportManager] Failed to send IPC message:", error);
    }
  }

  /**
   * Shutdown transport manager
   *
   * Disconnects all adapters and releases resources.
   */
  shutdown(): void {
    // Disconnect all adapters
    for (const adapter of this.adapterListeners.keys()) {
      this.disconnectAdapter(adapter);
    }
  }
}
