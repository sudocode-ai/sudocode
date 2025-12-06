/**
 * Workflow types for sudocode
 * Enables multi-issue automation with dependency-based orchestration
 */

import type { AgentType } from "./agents.js";

// =============================================================================
// Status Types
// =============================================================================

/**
 * Workflow lifecycle status
 */
export type WorkflowStatus =
  | "pending" // Created, not yet started
  | "running" // Actively executing steps (includes planning phase)
  | "paused" // Paused by user or orchestrator
  | "completed" // All steps finished successfully
  | "failed" // Workflow failed (unrecoverable)
  | "cancelled"; // User cancelled

/**
 * Individual workflow step status
 */
export type WorkflowStepStatus =
  | "pending" // Not yet ready (dependencies not met)
  | "ready" // Dependencies met, can be executed
  | "running" // Currently executing
  | "completed" // Finished successfully
  | "failed" // Execution failed
  | "skipped" // Skipped by orchestrator
  | "blocked"; // Blocked by failed dependency

// =============================================================================
// Source Types
// =============================================================================

/**
 * Defines how a workflow's scope is determined
 */
export type WorkflowSource =
  | WorkflowSourceSpec
  | WorkflowSourceIssues
  | WorkflowSourceRootIssue
  | WorkflowSourceGoal;

/**
 * Workflow from issues implementing a spec
 */
export interface WorkflowSourceSpec {
  type: "spec";
  specId: string;
}

/**
 * Workflow from explicit list of issues
 */
export interface WorkflowSourceIssues {
  type: "issues";
  issueIds: string[];
}

/**
 * Workflow from a root issue and all its blockers
 */
export interface WorkflowSourceRootIssue {
  type: "root_issue";
  issueId: string;
}

/**
 * Goal-based workflow where orchestrator creates issues dynamically
 */
export interface WorkflowSourceGoal {
  type: "goal";
  goal: string;
}

// =============================================================================
// Escalation Types (Human-in-the-Loop)
// =============================================================================

/**
 * Escalation status for human-in-the-loop workflows
 */
export type EscalationStatus = "pending" | "resolved" | "bypassed";

/**
 * User response to an escalation request
 */
export interface EscalationResponse {
  /** User's action choice */
  action: "approve" | "reject" | "custom";
  /** Optional message from user */
  message?: string;
  /** When the user responded */
  respondedAt: string;
}

/**
 * Escalation data structure for pending or resolved escalations
 */
export interface EscalationData {
  /** Unique escalation request identifier */
  requestId: string;
  /** Message displayed to user */
  message: string;
  /** Optional predefined options for user to choose */
  options?: string[];
  /** Additional context for the escalation */
  context?: Record<string, unknown>;
  /** User's response (present when resolved) */
  response?: EscalationResponse;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Workflow engine type
 * - sequential: Steps are executed in order by the server, no agent orchestration
 * - orchestrator: An AI agent orchestrates the workflow, making decisions dynamically
 */
export type WorkflowEngineType = "sequential" | "orchestrator";

/**
 * Workflow parallelism mode
 */
export type WorkflowParallelism = "sequential" | "parallel";

/**
 * Failure handling strategy
 */
export type WorkflowFailureStrategy =
  | "stop" // Stop workflow immediately
  | "pause" // Pause for user intervention
  | "skip_dependents" // Skip this step and all dependents
  | "continue"; // Continue with other independent steps

/**
 * Autonomy level for orchestrator-managed workflows
 */
export type WorkflowAutonomyLevel = "full_auto" | "human_in_the_loop";

/**
 * Workflow configuration options
 */
export interface WorkflowConfig {
  // === Engine Selection ===

  /**
   * Which engine to use for workflow execution
   * - sequential: Server-managed step execution (default)
   * - orchestrator: AI agent orchestrates the workflow
   * @default "sequential"
   */
  engineType: WorkflowEngineType;

  // === Sequential Engine Options ===

  /**
   * Execution mode: sequential or parallel
   * @default "sequential"
   */
  parallelism: WorkflowParallelism;

  /**
   * Maximum concurrent executions (when parallelism is "parallel")
   */
  maxConcurrency?: number;

  /**
   * How to handle step failures
   * @default "pause"
   */
  onFailure: WorkflowFailureStrategy;

  /**
   * Auto-commit changes after each successful step
   * @default true
   */
  autoCommitAfterStep: boolean;

  /**
   * Default agent type for step executions
   * @default "claude-code"
   */
  defaultAgentType: AgentType;

  // === Orchestrator Engine Options ===

  /**
   * Agent type for the orchestrator (agent-managed mode)
   */
  orchestratorAgentType?: AgentType;

  /**
   * Model for the orchestrator agent
   */
  orchestratorModel?: string;

  /**
   * Autonomy level for orchestrator decisions
   * - full_auto: No user intervention, escalate_to_user bypassed
   * - human_in_the_loop: Pause on escalations for user input
   * @default "human_in_the_loop"
   */
  autonomyLevel: WorkflowAutonomyLevel;

  // === Timeout Options ===

  /**
   * Timeout for individual executions (ms)
   * Orchestrator will cancel stuck executions after this time
   */
  executionTimeoutMs?: number;

  /**
   * Idle timeout (ms) - wake orchestrator if nothing happens
   */
  idleTimeoutMs?: number;

  /**
   * Batch window for wakeup events (ms)
   * Multiple events within this window are batched into one wakeup
   */
  wakeupBatchWindowMs?: number;

  // === Worktree Options ===

  /**
   * Base branch for worktree creation
   * Defaults to current working branch if not specified
   */
  baseBranch?: string;

  /**
   * Whether to create baseBranch if it doesn't exist
   * @default false
   */
  createBaseBranch?: boolean;

  /**
   * Reuse an existing worktree by path
   * If set, the workflow will use this worktree instead of creating a new one
   * The path must exist and be a valid git worktree
   */
  reuseWorktreePath?: string;

  // === Metadata Options ===

  /**
   * Custom workflow title
   * Auto-generated from source if not specified
   */
  title?: string;
}

// =============================================================================
// Core Entity Types
// =============================================================================

/**
 * A single step in a workflow
 * Each step corresponds to one issue execution
 */
export interface WorkflowStep {
  /** Unique step identifier */
  id: string;

  /** Issue ID this step executes */
  issueId: string;

  /** Step index in workflow (for ordering) */
  index: number;

  /** Step IDs this step depends on */
  dependencies: string[];

  /** Current step status */
  status: WorkflowStepStatus;

  /** Execution ID once started */
  executionId?: string;

  /** Git commit SHA after step completion */
  commitSha?: string;

  /** Error message if failed */
  error?: string;

  /** Agent type override for this step */
  agentType?: AgentType;

  /** Model override for this step */
  model?: string;
}

/**
 * A workflow orchestrating multiple issue executions
 */
export interface Workflow {
  /** Unique workflow identifier */
  id: string;

  /** Human-readable workflow title */
  title: string;

  /** How the workflow scope was defined */
  source: WorkflowSource;

  /** Current workflow status */
  status: WorkflowStatus;

  /** Steps in this workflow (empty initially for goal-based) */
  steps: WorkflowStep[];

  // === Worktree Information ===

  /** Shared worktree path for sequential execution */
  worktreePath?: string;

  /** Branch name for workflow changes */
  branchName?: string;

  /** Base branch to create workflow branch from */
  baseBranch: string;

  // === Progress Tracking ===

  /** Current step index (for sequential mode) */
  currentStepIndex: number;

  // === Orchestrator Information (agent-managed mode) ===

  /** Execution ID of the orchestrator agent */
  orchestratorExecutionId?: string;

  /** Session ID for orchestrator (maintained across wakeups) */
  orchestratorSessionId?: string;

  // === Configuration ===

  /** Workflow configuration */
  config: WorkflowConfig;

  // === Timestamps ===

  /** When workflow was created */
  createdAt: string;

  /** When workflow was last updated */
  updatedAt: string;

  /** When workflow execution started */
  startedAt?: string;

  /** When workflow completed (success or failure) */
  completedAt?: string;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Types of workflow events
 */
export type WorkflowEventType =
  // Step events
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_skipped"
  // Workflow lifecycle events
  | "workflow_started"
  | "workflow_paused"
  | "workflow_resumed"
  | "workflow_completed"
  | "workflow_failed"
  | "workflow_cancelled"
  // Escalation events
  | "escalation_requested"
  | "escalation_resolved"
  // Notification events
  | "user_notification"
  // Orchestrator events
  | "orchestrator_wakeup"
  | "user_response";

/**
 * A workflow event for tracking and orchestrator wakeups
 */
export interface WorkflowEvent {
  /** Unique event identifier */
  id: string;

  /** Workflow this event belongs to */
  workflowId: string;

  /** Event type */
  type: WorkflowEventType;

  /** Related step ID (for step events) */
  stepId?: string;

  /** Related execution ID */
  executionId?: string;

  /** Event-specific payload */
  payload: Record<string, unknown>;

  /** When event was created */
  createdAt: string;

  /** When event was processed by orchestrator */
  processedAt?: string;
}

// =============================================================================
// Database Row Types (snake_case for SQLite)
// =============================================================================

/**
 * Workflow row as stored in SQLite
 * JSON fields are serialized as TEXT
 */
export interface WorkflowRow {
  id: string;
  title: string;
  source: string; // JSON (WorkflowSource)
  status: WorkflowStatus;
  steps: string; // JSON (WorkflowStep[])
  worktree_path: string | null;
  branch_name: string | null;
  base_branch: string;
  current_step_index: number;
  orchestrator_execution_id: string | null;
  orchestrator_session_id: string | null;
  config: string; // JSON (WorkflowConfig)
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Workflow event row as stored in SQLite
 */
export interface WorkflowEventRow {
  id: string;
  workflow_id: string;
  type: WorkflowEventType;
  step_id: string | null;
  execution_id: string | null;
  payload: string; // JSON
  created_at: string;
  processed_at: string | null;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Options for creating a new workflow
 */
export interface CreateWorkflowOptions {
  title: string;
  source: WorkflowSource;
  config?: Partial<WorkflowConfig>;
  baseBranch?: string;
}

/**
 * Dependency graph analysis result
 */
export interface DependencyGraph {
  /** Issue IDs in the graph */
  issueIds: string[];

  /** Edges: [fromId, toId] pairs (from blocks to) */
  edges: Array<[string, string]>;

  /** Issues in topological order */
  topologicalOrder: string[];

  /** Detected cycles (if any) */
  cycles: string[][] | null;

  /** Groups of issues that can run in parallel */
  parallelGroups: string[][];
}

/**
 * Default workflow configuration values (type declaration)
 * Actual defaults should be implemented in consuming packages
 */
export declare const DEFAULT_WORKFLOW_CONFIG: Readonly<WorkflowConfig>;
