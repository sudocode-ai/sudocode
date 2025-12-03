/**
 * WorkflowWakeupService
 *
 * Handles event recording and orchestrator wakeups.
 * Events are batched within a configurable window before triggering wakeups.
 */

import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  Workflow,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowEventRow,
  Execution,
} from "@sudocode-ai/types";

import type { ExecutionService } from "../../services/execution-service.js";
import type { WorkflowEventEmitter } from "../workflow-event-emitter.js";
import { WorkflowPromptBuilder } from "./prompt-builder.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for wakeup behavior
 */
export interface WakeupConfig {
  /** Batch window in ms - events within this window are batched into one wakeup */
  batchWindowMs: number;
  /** Optional: wake orchestrator if idle for this long */
  idleTimeoutMs?: number;
  /** Optional: wake orchestrator if execution takes longer than this */
  executionTimeoutMs?: number;
}

/**
 * Default wakeup configuration
 */
export const DEFAULT_WAKEUP_CONFIG: WakeupConfig = {
  batchWindowMs: 5000, // 5 seconds
};

/**
 * Event to record
 */
export interface RecordEventParams {
  workflowId: string;
  type: WorkflowEventType;
  executionId?: string;
  stepId?: string;
  payload: Record<string, unknown>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a database row to a WorkflowEvent object
 */
function rowToEvent(row: WorkflowEventRow): WorkflowEvent {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    type: row.type,
    stepId: row.step_id ?? undefined,
    executionId: row.execution_id ?? undefined,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
    processedAt: row.processed_at ?? undefined,
  };
}

// =============================================================================
// WorkflowWakeupService
// =============================================================================

/**
 * Service for recording workflow events and triggering orchestrator wakeups.
 *
 * Events are batched within a configurable window. When the window expires,
 * a wakeup is triggered by creating a follow-up execution for the orchestrator.
 */
export class WorkflowWakeupService {
  private db: Database.Database;
  private executionService: ExecutionService;
  private promptBuilder: WorkflowPromptBuilder;
  private eventEmitter: WorkflowEventEmitter;
  private config: WakeupConfig;

  /** Pending wakeup timers by workflow ID */
  private pendingWakeups = new Map<string, NodeJS.Timeout>();

  /** Active execution timeout timers by execution ID */
  private executionTimeouts = new Map<
    string,
    { timeout: NodeJS.Timeout; workflowId: string; stepId: string }
  >();

  /** Whether the service is running (for timeout monitoring) */
  private _isRunning = false;

  /** Check if the service is running */
  get isRunning(): boolean {
    return this._isRunning;
  }

  constructor(deps: {
    db: Database.Database;
    executionService: ExecutionService;
    promptBuilder: WorkflowPromptBuilder;
    eventEmitter: WorkflowEventEmitter;
    config?: Partial<WakeupConfig>;
  }) {
    this.db = deps.db;
    this.executionService = deps.executionService;
    this.promptBuilder = deps.promptBuilder;
    this.eventEmitter = deps.eventEmitter;
    this.config = { ...DEFAULT_WAKEUP_CONFIG, ...deps.config };
  }

  // ===========================================================================
  // Event Recording
  // ===========================================================================

  /**
   * Record a workflow event.
   * Automatically schedules a wakeup after the batch window.
   */
  async recordEvent(params: RecordEventParams): Promise<void> {
    const eventId = randomUUID();
    const now = new Date().toISOString();

    // Insert event into database
    this.db
      .prepare(
        `
        INSERT INTO workflow_events (id, workflow_id, type, step_id, execution_id, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        eventId,
        params.workflowId,
        params.type,
        params.stepId ?? null,
        params.executionId ?? null,
        JSON.stringify(params.payload),
        now
      );

    // Schedule wakeup (debounced)
    this.scheduleWakeup(params.workflowId);
  }

  /**
   * Get all unprocessed events for a workflow.
   */
  getUnprocessedEvents(workflowId: string): WorkflowEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM workflow_events
        WHERE workflow_id = ? AND processed_at IS NULL
        ORDER BY created_at ASC
      `
      )
      .all(workflowId) as WorkflowEventRow[];

    return rows.map(rowToEvent);
  }

  /**
   * Mark events as processed.
   */
  markEventsProcessed(eventIds: string[]): void {
    if (eventIds.length === 0) return;

    const now = new Date().toISOString();
    const placeholders = eventIds.map(() => "?").join(", ");

    this.db
      .prepare(
        `UPDATE workflow_events SET processed_at = ? WHERE id IN (${placeholders})`
      )
      .run(now, ...eventIds);
  }

  // ===========================================================================
  // Wakeup Scheduling
  // ===========================================================================

  /**
   * Schedule a wakeup for a workflow.
   * Debounced within the batch window - multiple events will be batched.
   */
  scheduleWakeup(workflowId: string): void {
    // Cancel any existing pending wakeup
    const existing = this.pendingWakeups.get(workflowId);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule new wakeup after batch window
    const timeout = setTimeout(() => {
      this.pendingWakeups.delete(workflowId);
      this.triggerWakeup(workflowId).catch((err) => {
        console.error(`Failed to trigger wakeup for workflow ${workflowId}:`, err);
      });
    }, this.config.batchWindowMs);

    this.pendingWakeups.set(workflowId, timeout);
  }

  /**
   * Cancel a pending wakeup for a workflow.
   */
  cancelPendingWakeup(workflowId: string): void {
    const existing = this.pendingWakeups.get(workflowId);
    if (existing) {
      clearTimeout(existing);
      this.pendingWakeups.delete(workflowId);
    }
  }

  // ===========================================================================
  // Execution Timeout Tracking
  // ===========================================================================

  /**
   * Start a timeout for an execution.
   *
   * When the timeout fires, the execution is cancelled and a step_failed
   * event is recorded with reason "timeout".
   *
   * @param executionId - The execution to track
   * @param workflowId - The workflow the execution belongs to
   * @param stepId - The workflow step ID
   * @param timeoutMs - Timeout duration in milliseconds
   */
  startExecutionTimeout(
    executionId: string,
    workflowId: string,
    stepId: string,
    timeoutMs: number
  ): void {
    // Clear any existing timeout for this execution
    this.clearExecutionTimeout(executionId);

    const timeout = setTimeout(() => {
      this.executionTimeouts.delete(executionId);
      this.handleExecutionTimeout(executionId, workflowId, stepId).catch(
        (err) => {
          console.error(
            `[WakeupService] Error handling execution timeout:`,
            err
          );
        }
      );
    }, timeoutMs);

    this.executionTimeouts.set(executionId, { timeout, workflowId, stepId });

    console.log(
      `[WakeupService] Started ${timeoutMs}ms timeout for execution ${executionId}`
    );
  }

  /**
   * Clear timeout for an execution.
   *
   * Call this when an execution completes normally to prevent
   * the timeout from firing.
   *
   * @param executionId - The execution to clear timeout for
   */
  clearExecutionTimeout(executionId: string): void {
    const entry = this.executionTimeouts.get(executionId);
    if (entry) {
      clearTimeout(entry.timeout);
      this.executionTimeouts.delete(executionId);
      console.log(
        `[WakeupService] Cleared timeout for execution ${executionId}`
      );
    }
  }

  /**
   * Handle an execution timeout.
   *
   * Cancels the execution and records a step_failed event.
   *
   * @param executionId - The timed-out execution
   * @param workflowId - The workflow containing the execution
   * @param stepId - The workflow step that timed out
   */
  private async handleExecutionTimeout(
    executionId: string,
    workflowId: string,
    stepId: string
  ): Promise<void> {
    console.warn(`[WakeupService] Execution ${executionId} timed out`);

    // Try to cancel the execution
    try {
      await this.executionService.cancelExecution(executionId);
    } catch (err) {
      console.error(
        `[WakeupService] Failed to cancel timed-out execution ${executionId}:`,
        err
      );
      // Continue to record the timeout event anyway
    }

    // Record timeout event (will trigger wakeup via scheduleWakeup)
    await this.recordEvent({
      workflowId,
      type: "step_failed",
      executionId,
      stepId,
      payload: {
        reason: "timeout",
        message: "Execution exceeded configured timeout",
      },
    });
  }

  // ===========================================================================
  // Wakeup Triggering
  // ===========================================================================

  /**
   * Trigger an immediate wakeup for a workflow.
   * Collects unprocessed events, builds a wakeup message, and creates
   * a follow-up execution for the orchestrator.
   */
  async triggerWakeup(workflowId: string): Promise<void> {
    // 1. Get workflow
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      console.warn(`Cannot trigger wakeup: workflow ${workflowId} not found`);
      return;
    }

    // 2. Check if workflow has an orchestrator execution
    if (!workflow.orchestratorExecutionId) {
      console.warn(
        `Cannot trigger wakeup: workflow ${workflowId} has no orchestrator execution`
      );
      return;
    }

    // 3. Check workflow status - don't wake if paused/cancelled/completed
    if (
      workflow.status === "paused" ||
      workflow.status === "cancelled" ||
      workflow.status === "completed" ||
      workflow.status === "failed"
    ) {
      console.debug(
        `Skipping wakeup for workflow ${workflowId}: status is ${workflow.status}`
      );
      return;
    }

    // 4. Get unprocessed events
    const events = this.getUnprocessedEvents(workflowId);
    if (events.length === 0) {
      console.debug(`No unprocessed events for workflow ${workflowId}`);
      return;
    }

    // 5. Get executions referenced by events
    const executions = this.getExecutionsForEvents(events);

    // 6. Build wakeup message
    const message = this.promptBuilder.buildWakeupMessage(events, executions);

    // 7. Create follow-up execution
    try {
      const followUp = await this.executionService.createFollowUp(
        workflow.orchestratorExecutionId,
        message
      );

      // 8. Update workflow with new orchestrator execution ID
      this.updateOrchestratorExecution(workflowId, followUp.id, followUp.session_id);

      // 9. Mark events as processed
      this.markEventsProcessed(events.map((e) => e.id));

      // 10. Emit wakeup event
      this.eventEmitter.emit({
        type: "orchestrator_wakeup",
        workflowId,
        payload: {
          eventCount: events.length,
          executionId: followUp.id,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(`Failed to create follow-up execution for workflow ${workflowId}:`, err);
      // Don't mark events as processed - they'll be retried on next wakeup
      throw err;
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the wakeup service (enables timeout monitoring).
   */
  start(): void {
    this._isRunning = true;
    // TODO: Implement idle timeout monitoring if configured
    // TODO: Implement execution timeout monitoring if configured
  }

  /**
   * Stop the wakeup service.
   * Cancels all pending wakeups and execution timeouts.
   */
  stop(): void {
    this._isRunning = false;

    // Cancel all pending wakeups
    for (const [, timeout] of this.pendingWakeups) {
      clearTimeout(timeout);
    }
    this.pendingWakeups.clear();

    // Cancel all execution timeouts
    for (const [, entry] of this.executionTimeouts) {
      clearTimeout(entry.timeout);
    }
    this.executionTimeouts.clear();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get a workflow by ID.
   */
  private getWorkflow(workflowId: string): Workflow | null {
    const row = this.db
      .prepare("SELECT * FROM workflows WHERE id = ?")
      .get(workflowId) as
      | {
          id: string;
          title: string;
          source: string;
          status: string;
          steps: string;
          worktree_path: string | null;
          branch_name: string | null;
          base_branch: string;
          current_step_index: number;
          orchestrator_execution_id: string | null;
          orchestrator_session_id: string | null;
          config: string;
          created_at: string;
          updated_at: string;
          started_at: string | null;
          completed_at: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      source: JSON.parse(row.source),
      status: row.status as Workflow["status"],
      steps: JSON.parse(row.steps),
      worktreePath: row.worktree_path ?? undefined,
      branchName: row.branch_name ?? undefined,
      baseBranch: row.base_branch,
      currentStepIndex: row.current_step_index,
      orchestratorExecutionId: row.orchestrator_execution_id ?? undefined,
      orchestratorSessionId: row.orchestrator_session_id ?? undefined,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }

  /**
   * Get executions referenced by events.
   */
  private getExecutionsForEvents(
    events: WorkflowEvent[]
  ): Map<string, Execution> {
    const executions = new Map<string, Execution>();

    // Collect unique execution IDs
    const executionIds = new Set<string>();
    for (const event of events) {
      if (event.executionId) {
        executionIds.add(event.executionId);
      }
    }

    // Fetch executions
    for (const executionId of executionIds) {
      const row = this.db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get(executionId) as Execution | undefined;

      if (row) {
        executions.set(executionId, row);
      }
    }

    return executions;
  }

  /**
   * Update the workflow's orchestrator execution ID.
   */
  private updateOrchestratorExecution(
    workflowId: string,
    executionId: string,
    sessionId: string | null
  ): void {
    this.db
      .prepare(
        `
        UPDATE workflows
        SET orchestrator_execution_id = ?,
            orchestrator_session_id = ?,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(executionId, sessionId, new Date().toISOString(), workflowId);
  }
}
