/**
 * Workflow Broadcast Service
 *
 * Bridges the internal WorkflowEventEmitter to WebSocket broadcasts.
 * Subscribes to workflow events and broadcasts them to connected clients.
 */

import {
  WorkflowEventEmitter,
  WorkflowEventPayload,
} from "../workflow/workflow-event-emitter.js";
import {
  broadcastWorkflowUpdate,
  broadcastWorkflowStepUpdate,
} from "./websocket.js";

/**
 * Service that connects WorkflowEventEmitter to WebSocket broadcasts.
 *
 * @example
 * ```typescript
 * const eventEmitter = new WorkflowEventEmitter();
 * const broadcastService = new WorkflowBroadcastService(
 *   eventEmitter,
 *   (workflowId) => getProjectIdForWorkflow(workflowId)
 * );
 *
 * // Later, when shutting down
 * broadcastService.dispose();
 * ```
 */
export class WorkflowBroadcastService {
  private unsubscribe: () => void;

  /**
   * Create a new workflow broadcast service.
   *
   * @param eventEmitter - The workflow event emitter to subscribe to
   * @param getProjectId - Function to resolve workflow ID to project ID
   */
  constructor(
    private eventEmitter: WorkflowEventEmitter,
    private getProjectId: (workflowId: string) => string | null
  ) {
    this.unsubscribe = this.eventEmitter.on((event) => this.handleEvent(event));
  }

  /**
   * Dispose of the service and unsubscribe from events.
   */
  dispose(): void {
    this.unsubscribe();
  }

  /**
   * Handle a workflow event and broadcast it via WebSocket.
   */
  private handleEvent(event: WorkflowEventPayload): void {
    const projectId = this.getProjectId(event.workflowId);
    if (!projectId) {
      console.warn(
        `[WorkflowBroadcastService] No project found for workflow ${event.workflowId}`
      );
      return;
    }

    switch (event.type) {
      // Workflow lifecycle events
      case "workflow_started":
        broadcastWorkflowUpdate(projectId, event.workflowId, "started", {
          workflow: event.workflow,
          timestamp: event.timestamp,
        });
        break;

      case "workflow_paused":
        broadcastWorkflowUpdate(projectId, event.workflowId, "paused", {
          timestamp: event.timestamp,
        });
        break;

      case "workflow_resumed":
        broadcastWorkflowUpdate(projectId, event.workflowId, "resumed", {
          timestamp: event.timestamp,
        });
        break;

      case "workflow_completed":
        broadcastWorkflowUpdate(projectId, event.workflowId, "completed", {
          workflow: event.workflow,
          timestamp: event.timestamp,
        });
        break;

      case "workflow_failed":
        broadcastWorkflowUpdate(projectId, event.workflowId, "failed", {
          error: event.error,
          timestamp: event.timestamp,
        });
        break;

      case "workflow_cancelled":
        broadcastWorkflowUpdate(projectId, event.workflowId, "cancelled", {
          timestamp: event.timestamp,
        });
        break;

      // Step events
      case "step_started":
        broadcastWorkflowStepUpdate(projectId, event.workflowId, "started", {
          step: event.step,
          timestamp: event.timestamp,
        });
        break;

      case "step_completed":
        broadcastWorkflowStepUpdate(projectId, event.workflowId, "completed", {
          step: event.step,
          executionId: event.executionId,
          timestamp: event.timestamp,
        });
        break;

      case "step_failed":
        broadcastWorkflowStepUpdate(projectId, event.workflowId, "failed", {
          step: event.step,
          error: event.error,
          timestamp: event.timestamp,
        });
        break;

      case "step_skipped":
        broadcastWorkflowStepUpdate(projectId, event.workflowId, "skipped", {
          step: event.step,
          reason: event.reason,
          timestamp: event.timestamp,
        });
        break;

      // Orchestrator events (no broadcast needed - internal only)
      case "orchestrator_wakeup":
        // Orchestrator wakeup events are internal and don't need to be broadcast
        break;

      // Escalation events
      case "escalation_requested":
        broadcastWorkflowUpdate(
          projectId,
          event.workflowId,
          "escalation_requested",
          {
            escalationId: event.escalationId,
            message: event.message,
            options: event.options,
            context: event.context,
            timestamp: event.timestamp,
          }
        );
        break;

      case "escalation_resolved":
        broadcastWorkflowUpdate(
          projectId,
          event.workflowId,
          "escalation_resolved",
          {
            escalationId: event.escalationId,
            action: event.action,
            message: event.message,
            timestamp: event.timestamp,
          }
        );
        break;

      default:
        // Exhaustive check - TypeScript will error if we miss a case
        const _exhaustive: never = event;
        console.warn(
          `[WorkflowBroadcastService] Unknown event type: ${(_exhaustive as any).type}`
        );
    }
  }
}
