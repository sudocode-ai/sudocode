/**
 * Workflow Orchestrator Interface
 *
 * Defines the contract for workflow orchestration implementations.
 *
 * @module execution/workflow/orchestrator
 */

import type {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowCheckpoint,
  StepStatus,
  WorkflowStartHandler,
  WorkflowCompleteHandler,
  WorkflowFailedHandler,
  StepStartHandler,
  StepCompleteHandler,
  StepFailedHandler,
  WorkflowCheckpointHandler,
  WorkflowResumeHandler,
  WorkflowPauseHandler,
  WorkflowCancelHandler,
} from './types.js';

/**
 * IWorkflowOrchestrator - Core interface for workflow orchestration
 *
 * Implementations of this interface coordinate the execution of multi-step
 * workflows, managing state, checkpointing, and resumption.
 */
export interface IWorkflowOrchestrator {
  /**
   * Start a new workflow execution
   *
   * @param workflow - Workflow definition to execute
   * @param workDir - Working directory for task execution
   * @param options - Execution options
   * @returns Promise resolving to execution ID
   */
  startWorkflow(
    workflow: WorkflowDefinition,
    workDir: string,
    options?: {
      checkpointInterval?: number;
      initialContext?: Record<string, any>;
    }
  ): Promise<string>;

  /**
   * Resume a workflow from a checkpoint
   *
   * @param executionId - Execution ID to resume
   * @param options - Resume options
   * @returns Promise resolving to execution ID
   */
  resumeWorkflow(
    executionId: string,
    options?: {
      checkpointInterval?: number;
    }
  ): Promise<string>;

  /**
   * Pause a running workflow
   *
   * @param executionId - Execution ID to pause
   * @returns Promise that resolves when paused
   */
  pauseWorkflow(executionId: string): Promise<void>;

  /**
   * Cancel a running workflow
   *
   * @param executionId - Execution ID to cancel
   * @returns Promise that resolves when cancelled
   */
  cancelWorkflow(executionId: string): Promise<void>;

  /**
   * Get current execution state
   *
   * @param executionId - Execution ID to query
   * @returns Execution state or null if not found
   */
  getExecution(executionId: string): WorkflowExecution | null;

  /**
   * Get status of a specific step
   *
   * @param executionId - Execution ID
   * @param stepId - Step ID to query
   * @returns Step status or null if not found
   */
  getStepStatus(executionId: string, stepId: string): StepStatus | null;

  /**
   * Wait for workflow to complete
   *
   * @param executionId - Execution ID to wait for
   * @returns Promise resolving to workflow result
   */
  waitForWorkflow(executionId: string): Promise<WorkflowExecution>;

  /**
   * List all checkpoints for a workflow
   *
   * @param workflowId - Optional workflow ID to filter by
   * @returns Promise resolving to list of checkpoints
   */
  listCheckpoints(workflowId?: string): Promise<WorkflowCheckpoint[]>;

  /**
   * Register handler for workflow start events
   */
  onWorkflowStart(handler: WorkflowStartHandler): void;

  /**
   * Register handler for workflow completion events
   */
  onWorkflowComplete(handler: WorkflowCompleteHandler): void;

  /**
   * Register handler for workflow failure events
   */
  onWorkflowFailed(handler: WorkflowFailedHandler): void;

  /**
   * Register handler for step start events
   */
  onStepStart(handler: StepStartHandler): void;

  /**
   * Register handler for step completion events
   */
  onStepComplete(handler: StepCompleteHandler): void;

  /**
   * Register handler for step failure events
   */
  onStepFailed(handler: StepFailedHandler): void;

  /**
   * Register handler for checkpoint events
   */
  onCheckpoint(handler: WorkflowCheckpointHandler): void;

  /**
   * Register handler for resume events
   */
  onResume(handler: WorkflowResumeHandler): void;

  /**
   * Register handler for pause events
   */
  onPause(handler: WorkflowPauseHandler): void;

  /**
   * Register handler for cancel events
   */
  onCancel(handler: WorkflowCancelHandler): void;
}

/**
 * IWorkflowStorage - Interface for workflow checkpoint storage
 *
 * Implementations provide persistence for workflow checkpoints,
 * enabling crash recovery and workflow resumption.
 */
export interface IWorkflowStorage {
  /**
   * Save a workflow checkpoint
   *
   * @param checkpoint - Checkpoint to save
   * @returns Promise that resolves when saved
   */
  saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void>;

  /**
   * Load a workflow checkpoint
   *
   * @param executionId - Execution ID to load
   * @returns Promise resolving to checkpoint or null if not found
   */
  loadCheckpoint(executionId: string): Promise<WorkflowCheckpoint | null>;

  /**
   * List all checkpoints for a workflow
   *
   * @param workflowId - Optional workflow ID to filter by
   * @returns Promise resolving to list of checkpoints
   */
  listCheckpoints(workflowId?: string): Promise<WorkflowCheckpoint[]>;

  /**
   * Delete a checkpoint
   *
   * @param executionId - Execution ID to delete
   * @returns Promise that resolves when deleted
   */
  deleteCheckpoint(executionId: string): Promise<void>;
}
