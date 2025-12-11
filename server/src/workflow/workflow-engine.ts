/**
 * Workflow Engine Interface
 *
 * Defines the contract for workflow implementations (Sequential and Orchestrator).
 * Also includes error classes and default configuration.
 */

import type {
  Workflow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowStep,
} from "@sudocode-ai/types";
import type { WorkflowEventListener } from "./workflow-event-emitter.js";

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when a dependency cycle is detected in the workflow.
 */
export class WorkflowCycleError extends Error {
  /** The detected cycles as arrays of issue IDs */
  readonly cycles: string[][];

  constructor(cycles: string[][]) {
    const cycleDescriptions = cycles
      .map((cycle) => cycle.join(" → "))
      .join("; ");
    super(`Dependency cycle detected: ${cycleDescriptions}`);
    this.name = "WorkflowCycleError";
    this.cycles = cycles;
  }
}

/**
 * Error thrown when a workflow is not found.
 */
export class WorkflowNotFoundError extends Error {
  /** The workflow ID that was not found */
  readonly workflowId: string;

  constructor(workflowId: string) {
    super(`Workflow not found: ${workflowId}`);
    this.name = "WorkflowNotFoundError";
    this.workflowId = workflowId;
  }
}

/**
 * Error thrown when a workflow step is not found.
 */
export class WorkflowStepNotFoundError extends Error {
  /** The workflow ID */
  readonly workflowId: string;
  /** The step ID that was not found */
  readonly stepId: string;

  constructor(workflowId: string, stepId: string) {
    super(`Step ${stepId} not found in workflow ${workflowId}`);
    this.name = "WorkflowStepNotFoundError";
    this.workflowId = workflowId;
    this.stepId = stepId;
  }
}

/**
 * Error thrown when a workflow operation is invalid for the current state.
 */
export class WorkflowStateError extends Error {
  /** The workflow ID */
  readonly workflowId: string;
  /** The current workflow status */
  readonly currentStatus: string;
  /** The operation that was attempted */
  readonly operation: string;

  constructor(workflowId: string, currentStatus: string, operation: string) {
    super(
      `Cannot ${operation} workflow ${workflowId}: current status is ${currentStatus}`
    );
    this.name = "WorkflowStateError";
    this.workflowId = workflowId;
    this.currentStatus = currentStatus;
    this.operation = operation;
  }
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default workflow configuration values.
 */
export const DEFAULT_WORKFLOW_CONFIG: Readonly<WorkflowConfig> = {
  // Engine selection
  engineType: "sequential",

  // Sequential engine options
  parallelism: "sequential",
  maxConcurrency: 1,
  onFailure: "pause",
  autoCommitAfterStep: true,
  defaultAgentType: "claude-code",

  // Orchestrator engine options
  orchestratorAgentType: undefined,
  orchestratorModel: undefined,
  autonomyLevel: "human_in_the_loop",

  // Timeout options
  executionTimeoutMs: undefined,
  idleTimeoutMs: undefined,
  wakeupBatchWindowMs: undefined,
};

// =============================================================================
// Interface
// =============================================================================

/**
 * Interface for workflow engine implementations.
 *
 * Both SequentialWorkflowEngine and OrchestratorWorkflowEngine
 * implement this interface.
 */
export interface IWorkflowEngine {
  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Create a new workflow from a source definition.
   *
   * @param source - How to determine workflow scope (spec, issues, root_issue, or goal)
   * @param config - Optional configuration overrides
   * @returns The created workflow
   * @throws WorkflowCycleError if dependency cycles are detected
   */
  createWorkflow(
    source: WorkflowSource,
    config?: Partial<WorkflowConfig>
  ): Promise<Workflow>;

  /**
   * Start executing a pending workflow.
   *
   * @param workflowId - The workflow to start
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not in pending state
   */
  startWorkflow(workflowId: string): Promise<void>;

  /**
   * Pause a running workflow after the current step completes.
   *
   * @param workflowId - The workflow to pause
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not running
   */
  pauseWorkflow(workflowId: string): Promise<void>;

  /**
   * Resume a paused workflow.
   *
   * @param workflowId - The workflow to resume
   * @param message - Optional message to send to the orchestrator on resume
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not paused
   */
  resumeWorkflow(workflowId: string, message?: string): Promise<void>;

  /**
   * Cancel a workflow, stopping any running executions.
   *
   * @param workflowId - The workflow to cancel
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is already completed/failed/cancelled
   */
  cancelWorkflow(workflowId: string): Promise<void>;

  // ===========================================================================
  // Step Control Methods
  // ===========================================================================

  /**
   * Retry a failed step.
   *
   * @param workflowId - The workflow containing the step
   * @param stepId - The step to retry
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStepNotFoundError if step doesn't exist
   * @throws WorkflowStateError if step is not in failed state
   */
  retryStep(workflowId: string, stepId: string): Promise<void>;

  /**
   * Skip a step and mark its dependents as blocked or ready.
   *
   * @param workflowId - The workflow containing the step
   * @param stepId - The step to skip
   * @param reason - Optional reason for skipping
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStepNotFoundError if step doesn't exist
   */
  skipStep(workflowId: string, stepId: string, reason?: string): Promise<void>;

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get a workflow by ID.
   *
   * @param workflowId - The workflow ID
   * @returns The workflow or null if not found
   */
  getWorkflow(workflowId: string): Promise<Workflow | null>;

  /**
   * Get steps that are ready to execute (all dependencies completed).
   *
   * @param workflowId - The workflow ID
   * @returns Array of ready steps
   * @throws WorkflowNotFoundError if workflow doesn't exist
   */
  getReadySteps(workflowId: string): Promise<WorkflowStep[]>;

  // ===========================================================================
  // Event Methods
  // ===========================================================================

  /**
   * Subscribe to workflow events.
   *
   * @param listener - Event listener function
   * @returns Unsubscribe function
   */
  onWorkflowEvent(listener: WorkflowEventListener): () => void;

  /**
   * Emit an escalation requested event.
   *
   * @param workflowId - The workflow ID
   * @param escalationId - Unique escalation ID
   * @param message - Escalation message
   * @param options - Optional predefined response options
   * @param context - Optional additional context
   */
  emitEscalationRequested(
    workflowId: string,
    escalationId: string,
    message: string,
    options?: string[],
    context?: Record<string, unknown>
  ): void;

  /**
   * Emit an escalation resolved event.
   *
   * @param workflowId - The workflow ID
   * @param escalationId - The escalation ID that was resolved
   * @param action - User's response action
   * @param message - Optional user message
   */
  emitEscalationResolved(
    workflowId: string,
    escalationId: string,
    action: "approve" | "reject" | "custom",
    message?: string
  ): void;

  /**
   * Emit a step started event.
   *
   * @param workflowId - The workflow ID
   * @param step - The step that started
   */
  emitStepStarted(workflowId: string, step: WorkflowStep): void;

  /**
   * Emit a step completed event.
   *
   * @param workflowId - The workflow ID
   * @param step - The step that completed
   * @param executionId - The execution ID
   */
  emitStepCompleted(
    workflowId: string,
    step: WorkflowStep,
    executionId: string
  ): void;

  /**
   * Emit a step failed event.
   *
   * @param workflowId - The workflow ID
   * @param step - The step that failed
   * @param error - The error message
   */
  emitStepFailed(workflowId: string, step: WorkflowStep, error: string): void;

  /**
   * Emit a workflow completed event.
   *
   * @param workflowId - The workflow ID
   * @param workflow - The completed workflow
   */
  emitWorkflowCompleted(workflowId: string, workflow: Workflow): void;

  /**
   * Emit a workflow failed event.
   *
   * @param workflowId - The workflow ID
   * @param error - The error message
   */
  emitWorkflowFailed(workflowId: string, error: string): void;

  // ===========================================================================
  // Recovery Methods (Optional)
  // ===========================================================================

  /**
   * Recover orphaned workflows on server restart.
   *
   * Finds workflows in 'running' status whose orchestrator execution
   * is no longer running, and triggers a wakeup to resume them.
   *
   * Only implemented by OrchestratorWorkflowEngine.
   */
  recoverOrphanedWorkflows?(): Promise<void>;

  /**
   * Mark stale running executions as failed.
   *
   * Called during recovery to clean up executions that were running
   * when the server crashed.
   *
   * Only implemented by OrchestratorWorkflowEngine.
   */
  markStaleExecutionsAsFailed?(): Promise<void>;

  /**
   * Clean up resources when the engine is disposed.
   */
  dispose?(): void;
}
