/**
 * Workflow Layer Types
 *
 * Layer 4: Task Execution Layer - Workflow Orchestration & State Management
 *
 * @module execution/workflow/types
 */

import type { RetryPolicy } from '../resilience/types.js';
import type { ExecutionResult } from '../engine/types.js';

/**
 * WorkflowDefinition - Configuration for a multi-step workflow
 */
export interface WorkflowDefinition {
  /** Unique identifier for this workflow type */
  id: string;
  /** Steps to execute in sequence */
  steps: WorkflowStep[];
  /** Initial context variables */
  initialContext?: Record<string, any>;
  /** Workflow configuration */
  config?: {
    /** Number of steps between checkpoints (0 = no checkpoints) */
    checkpointInterval?: number;
    /** If true, continue executing remaining steps after a step fails */
    continueOnStepFailure?: boolean;
    /** Overall workflow timeout in milliseconds */
    timeout?: number;
  };
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * WorkflowStep - Individual step within a workflow
 */
export interface WorkflowStep {
  /** Unique step identifier */
  id: string;
  /** Task type to execute */
  taskType: 'issue' | 'spec' | 'custom';
  /** Prompt template with {{variable}} placeholders */
  prompt: string;
  /** Step IDs that must complete before this step */
  dependencies?: string[];
  /** Retry policy for this step (overrides default) */
  retryPolicy?: RetryPolicy;
  /** Step-specific timeout in milliseconds */
  timeout?: number;
  /** Condition to evaluate before executing step */
  condition?: string; // Template that evaluates to boolean
  /** Map step outputs to context variables */
  outputMapping?: Record<string, string>;
  /** Task configuration passed to engine */
  taskConfig?: Record<string, any>;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * WorkflowExecution - Runtime state of a workflow execution
 */
export interface WorkflowExecution {
  /** Unique execution identifier */
  executionId: string;
  /** Workflow definition ID */
  workflowId: string;
  /** Workflow definition */
  definition: WorkflowDefinition;
  /** Current execution status */
  status: WorkflowStatus;
  /** Index of current step being executed */
  currentStepIndex: number;
  /** Shared context across steps */
  context: Record<string, any>;
  /** Results from completed steps */
  stepResults: ExecutionResult[];
  /** When execution started */
  startedAt: Date;
  /** When execution completed */
  completedAt?: Date;
  /** When execution was paused */
  pausedAt?: Date;
  /** When execution was resumed */
  resumedAt?: Date;
  /** Error message if failed */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * WorkflowStatus - Possible workflow execution states
 */
export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * WorkflowCheckpoint - Saved workflow state for resumption
 */
export interface WorkflowCheckpoint {
  /** Workflow definition ID */
  workflowId: string;
  /** Execution ID */
  executionId: string;
  /** Workflow definition at checkpoint time */
  definition: WorkflowDefinition;
  /** Execution state at checkpoint */
  state: {
    status: WorkflowStatus;
    currentStepIndex: number;
    context: Record<string, any>;
    stepResults: ExecutionResult[];
    error?: string;
    startedAt: Date;
    completedAt?: Date;
  };
  /** When checkpoint was created */
  createdAt: Date;
}

/**
 * WorkflowResult - Final result of workflow execution
 */
export interface WorkflowResult {
  /** Execution ID */
  executionId: string;
  /** Whether workflow completed successfully */
  success: boolean;
  /** Number of steps completed */
  completedSteps: number;
  /** Number of steps failed */
  failedSteps: number;
  /** Number of steps skipped */
  skippedSteps: number;
  /** Final context outputs */
  outputs: Record<string, any>;
  /** Total execution duration in milliseconds */
  duration: number;
  /** Error message if failed */
  error?: string;
}

/**
 * StepStatus - Status information for a specific step
 */
export interface StepStatus {
  /** Step ID */
  stepId: string;
  /** Current status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** Execution result if completed/failed */
  result?: ExecutionResult;
  /** Number of attempts */
  attempts: number;
}

/**
 * Event Handlers
 */

/** Called when workflow execution starts */
export type WorkflowStartHandler = (
  executionId: string,
  workflowId: string
) => void;

/** Called when workflow execution completes */
export type WorkflowCompleteHandler = (
  executionId: string,
  result: WorkflowResult
) => void;

/** Called when workflow execution fails */
export type WorkflowFailedHandler = (
  executionId: string,
  error: Error
) => void;

/** Called when a step starts executing */
export type StepStartHandler = (
  executionId: string,
  stepId: string,
  stepIndex: number
) => void;

/** Called when a step completes */
export type StepCompleteHandler = (
  executionId: string,
  stepId: string,
  result: ExecutionResult
) => void;

/** Called when a step fails */
export type StepFailedHandler = (
  executionId: string,
  stepId: string,
  error: Error
) => void;

/** Called when a checkpoint is created */
export type WorkflowCheckpointHandler = (checkpoint: WorkflowCheckpoint) => void;

/** Called when a workflow is resumed from checkpoint */
export type WorkflowResumeHandler = (
  executionId: string,
  checkpoint: WorkflowCheckpoint
) => void;

/** Called when a workflow is paused */
export type WorkflowPauseHandler = (executionId: string) => void;

/** Called when a workflow is cancelled */
export type WorkflowCancelHandler = (executionId: string) => void;
