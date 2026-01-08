/**
 * Execution Event Callbacks
 *
 * Provides a simple callback system to notify interested parties
 * when executions complete/fail, without tight coupling between
 * ExecutionService and the workflow system.
 *
 * Usage:
 * - Workflow engine registers a callback to record workflow events
 * - Executor wrappers call notifyExecutionEvent on completion/failure
 * - Callbacks receive execution context including workflow info
 *
 * @module services/execution-event-callbacks
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Types of execution events that can be notified
 */
export type ExecutionEventType = "completed" | "failed" | "cancelled";

/**
 * Data passed to execution event callbacks
 */
export interface ExecutionEventData {
  /** The execution ID */
  executionId: string;
  /** The workflow ID if this execution is part of a workflow */
  workflowId?: string;
  /** The issue ID being executed */
  issueId?: string;
  /** Error message for failed executions */
  error?: string;
}

/**
 * Callback function type for execution events
 */
export type ExecutionEventCallback = (
  event: ExecutionEventType,
  data: ExecutionEventData
) => Promise<void>;

// =============================================================================
// Registry
// =============================================================================

/**
 * Registered callbacks
 */
const callbacks: ExecutionEventCallback[] = [];

/**
 * Register a callback to be notified of execution events.
 *
 * @param cb - Callback function to register
 * @returns Unregister function to remove the callback
 *
 * @example
 * ```typescript
 * const unregister = registerExecutionCallback(async (event, data) => {
 *   if (data.workflowId) {
 *     await recordWorkflowEvent(data.workflowId, event, data);
 *   }
 * });
 *
 * // Later, to stop receiving events:
 * unregister();
 * ```
 */
export function registerExecutionCallback(
  cb: ExecutionEventCallback
): () => void {
  callbacks.push(cb);

  // Return unregister function
  return () => {
    const index = callbacks.indexOf(cb);
    if (index >= 0) {
      callbacks.splice(index, 1);
    }
  };
}

/**
 * Notify all registered callbacks of an execution event.
 *
 * Callbacks are called sequentially. Errors in individual callbacks
 * are caught and logged, but don't prevent other callbacks from running.
 *
 * @param event - The type of event (completed, failed, cancelled)
 * @param data - Event data including execution and workflow context
 */
export async function notifyExecutionEvent(
  event: ExecutionEventType,
  data: ExecutionEventData
): Promise<void> {
  for (const cb of callbacks) {
    try {
      await cb(event, data);
    } catch (err) {
      console.error(
        "[ExecutionEventCallbacks] Callback error:",
        err instanceof Error ? err.message : String(err)
      );
      // Continue to next callback
    }
  }
}

/**
 * Get the number of registered callbacks (for testing)
 */
export function getCallbackCount(): number {
  return callbacks.length;
}

/**
 * Clear all registered callbacks (for testing)
 */
export function clearAllCallbacks(): void {
  callbacks.length = 0;
}
