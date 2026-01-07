/**
 * Workflow Event Emitter
 *
 * Provides a typed event system for workflow lifecycle events.
 * Uses the typed listener set pattern, NOT Node.js EventEmitter.
 */

import type { Workflow, WorkflowStep } from "@sudocode-ai/types";

// =============================================================================
// Event Types
// =============================================================================

/**
 * Discriminated union of all workflow event types.
 * Each event has a `type` field for type-safe handling.
 */
export type WorkflowEventPayload =
  // Step events
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepSkippedEvent
  // Workflow lifecycle events
  | WorkflowStartedEvent
  | WorkflowPausedEvent
  | WorkflowResumedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | WorkflowCancelledEvent
  // Orchestrator events
  | OrchestratorWakeupEvent
  // Escalation events
  | EscalationRequestedEvent
  | EscalationResolvedEvent;

/**
 * Event type constants for use in switch statements.
 */
export const WorkflowEventType = {
  STEP_STARTED: "step_started",
  STEP_COMPLETED: "step_completed",
  STEP_FAILED: "step_failed",
  STEP_SKIPPED: "step_skipped",
  WORKFLOW_STARTED: "workflow_started",
  WORKFLOW_PAUSED: "workflow_paused",
  WORKFLOW_RESUMED: "workflow_resumed",
  WORKFLOW_COMPLETED: "workflow_completed",
  WORKFLOW_FAILED: "workflow_failed",
  WORKFLOW_CANCELLED: "workflow_cancelled",
  ORCHESTRATOR_WAKEUP: "orchestrator_wakeup",
  ESCALATION_REQUESTED: "escalation_requested",
  ESCALATION_RESOLVED: "escalation_resolved",
} as const;

// =============================================================================
// Step Events
// =============================================================================

/**
 * Emitted when a step starts executing.
 */
export interface StepStartedEvent {
  type: "step_started";
  workflowId: string;
  step: WorkflowStep;
  timestamp: number;
}

/**
 * Emitted when a step completes successfully.
 */
export interface StepCompletedEvent {
  type: "step_completed";
  workflowId: string;
  step: WorkflowStep;
  executionId: string;
  timestamp: number;
}

/**
 * Emitted when a step fails.
 */
export interface StepFailedEvent {
  type: "step_failed";
  workflowId: string;
  step: WorkflowStep;
  error: string;
  timestamp: number;
}

/**
 * Emitted when a step is skipped.
 */
export interface StepSkippedEvent {
  type: "step_skipped";
  workflowId: string;
  step: WorkflowStep;
  reason: string;
  timestamp: number;
}

// =============================================================================
// Workflow Lifecycle Events
// =============================================================================

/**
 * Emitted when a workflow starts executing.
 */
export interface WorkflowStartedEvent {
  type: "workflow_started";
  workflowId: string;
  workflow: Workflow;
  timestamp: number;
}

/**
 * Emitted when a workflow is paused.
 */
export interface WorkflowPausedEvent {
  type: "workflow_paused";
  workflowId: string;
  timestamp: number;
}

/**
 * Emitted when a workflow is resumed.
 */
export interface WorkflowResumedEvent {
  type: "workflow_resumed";
  workflowId: string;
  timestamp: number;
}

/**
 * Emitted when a workflow completes successfully.
 */
export interface WorkflowCompletedEvent {
  type: "workflow_completed";
  workflowId: string;
  workflow: Workflow;
  timestamp: number;
}

/**
 * Emitted when a workflow fails.
 */
export interface WorkflowFailedEvent {
  type: "workflow_failed";
  workflowId: string;
  error: string;
  timestamp: number;
}

/**
 * Emitted when a workflow is cancelled.
 */
export interface WorkflowCancelledEvent {
  type: "workflow_cancelled";
  workflowId: string;
  timestamp: number;
}

// =============================================================================
// Orchestrator Events
// =============================================================================

/**
 * Emitted when the orchestrator is woken up to process events.
 */
export interface OrchestratorWakeupEvent {
  type: "orchestrator_wakeup";
  workflowId: string;
  payload: {
    eventCount: number;
    executionId: string;
  };
  timestamp: number;
}

// =============================================================================
// Escalation Events
// =============================================================================

/**
 * Emitted when the orchestrator requests user input (escalation).
 */
export interface EscalationRequestedEvent {
  type: "escalation_requested";
  workflowId: string;
  escalationId: string;
  message: string;
  options?: string[];
  context?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Emitted when an escalation is resolved by user response.
 */
export interface EscalationResolvedEvent {
  type: "escalation_resolved";
  workflowId: string;
  escalationId: string;
  action: "approve" | "reject" | "custom";
  message?: string;
  timestamp: number;
}

// =============================================================================
// Listener Type
// =============================================================================

/**
 * Event listener function type.
 * Receives a WorkflowEventPayload and returns void.
 */
export type WorkflowEventListener = (event: WorkflowEventPayload) => void;

// =============================================================================
// Event Emitter Class
// =============================================================================

/**
 * Typed event emitter for workflow events.
 *
 * Uses a Set of listeners for:
 * - O(1) add/remove operations
 * - Safe iteration during emit (Set creates snapshot)
 * - No duplicate listeners
 *
 * @example
 * ```typescript
 * const emitter = new WorkflowEventEmitter();
 *
 * // Subscribe to events
 * const unsubscribe = emitter.on((event) => {
 *   switch (event.type) {
 *     case "step_completed":
 *       console.log(`Step ${event.step.id} completed`);
 *       break;
 *     case "workflow_failed":
 *       console.error(`Workflow failed: ${event.error}`);
 *       break;
 *   }
 * });
 *
 * // Emit an event
 * emitter.emit({
 *   type: "step_completed",
 *   workflowId: "wf-123",
 *   step: { ... },
 *   executionId: "exec-456",
 *   timestamp: Date.now(),
 * });
 *
 * // Unsubscribe when done
 * unsubscribe();
 * ```
 */
export class WorkflowEventEmitter {
  private listeners = new Set<WorkflowEventListener>();

  /**
   * Subscribe to workflow events.
   *
   * @param listener - Function to call when events are emitted
   * @returns Unsubscribe function - call to remove the listener
   */
  on(listener: WorkflowEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Unsubscribe a listener.
   *
   * @param listener - The listener to remove
   */
  off(listener: WorkflowEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners.
   *
   * @param event - The event to emit
   */
  emit(event: WorkflowEventPayload): void {
    // Iterate over a snapshot to allow listeners to unsubscribe during emit
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // Log but don't throw - one listener's error shouldn't break others
        console.error("Error in workflow event listener:", error);
      }
    }
  }

  /**
   * Get the current number of listeners.
   * Useful for testing and debugging.
   */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Remove all listeners.
   * Useful for cleanup.
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a step started event.
 */
export function createStepStartedEvent(
  workflowId: string,
  step: WorkflowStep
): StepStartedEvent {
  return {
    type: "step_started",
    workflowId,
    step,
    timestamp: Date.now(),
  };
}

/**
 * Create a step completed event.
 */
export function createStepCompletedEvent(
  workflowId: string,
  step: WorkflowStep,
  executionId: string
): StepCompletedEvent {
  return {
    type: "step_completed",
    workflowId,
    step,
    executionId,
    timestamp: Date.now(),
  };
}

/**
 * Create a step failed event.
 */
export function createStepFailedEvent(
  workflowId: string,
  step: WorkflowStep,
  error: string
): StepFailedEvent {
  return {
    type: "step_failed",
    workflowId,
    step,
    error,
    timestamp: Date.now(),
  };
}

/**
 * Create a step skipped event.
 */
export function createStepSkippedEvent(
  workflowId: string,
  step: WorkflowStep,
  reason: string
): StepSkippedEvent {
  return {
    type: "step_skipped",
    workflowId,
    step,
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Create a workflow started event.
 */
export function createWorkflowStartedEvent(
  workflowId: string,
  workflow: Workflow
): WorkflowStartedEvent {
  return {
    type: "workflow_started",
    workflowId,
    workflow,
    timestamp: Date.now(),
  };
}

/**
 * Create a workflow paused event.
 */
export function createWorkflowPausedEvent(
  workflowId: string
): WorkflowPausedEvent {
  return {
    type: "workflow_paused",
    workflowId,
    timestamp: Date.now(),
  };
}

/**
 * Create a workflow resumed event.
 */
export function createWorkflowResumedEvent(
  workflowId: string
): WorkflowResumedEvent {
  return {
    type: "workflow_resumed",
    workflowId,
    timestamp: Date.now(),
  };
}

/**
 * Create a workflow completed event.
 */
export function createWorkflowCompletedEvent(
  workflowId: string,
  workflow: Workflow
): WorkflowCompletedEvent {
  return {
    type: "workflow_completed",
    workflowId,
    workflow,
    timestamp: Date.now(),
  };
}

/**
 * Create a workflow failed event.
 */
export function createWorkflowFailedEvent(
  workflowId: string,
  error: string
): WorkflowFailedEvent {
  return {
    type: "workflow_failed",
    workflowId,
    error,
    timestamp: Date.now(),
  };
}

/**
 * Create a workflow cancelled event.
 */
export function createWorkflowCancelledEvent(
  workflowId: string
): WorkflowCancelledEvent {
  return {
    type: "workflow_cancelled",
    workflowId,
    timestamp: Date.now(),
  };
}

/**
 * Create an escalation requested event.
 */
export function createEscalationRequestedEvent(
  workflowId: string,
  escalationId: string,
  message: string,
  options?: string[],
  context?: Record<string, unknown>
): EscalationRequestedEvent {
  return {
    type: "escalation_requested",
    workflowId,
    escalationId,
    message,
    options,
    context,
    timestamp: Date.now(),
  };
}

/**
 * Create an escalation resolved event.
 */
export function createEscalationResolvedEvent(
  workflowId: string,
  escalationId: string,
  action: "approve" | "reject" | "custom",
  message?: string
): EscalationResolvedEvent {
  return {
    type: "escalation_resolved",
    workflowId,
    escalationId,
    action,
    message,
    timestamp: Date.now(),
  };
}
