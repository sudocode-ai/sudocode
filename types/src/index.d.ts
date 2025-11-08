/**
 * Core entity types for sudocode
 */
export interface Spec {
  id: string;
  title: string;
  uuid: string;
  file_path: string;
  content: string;
  priority: number;
  archived?: boolean;
  archived_at?: string;
  created_at: string;
  updated_at: string;
  parent_id?: string;
  parent_uuid?: string;
}

export interface Issue {
  id: string;
  title: string;
  status: IssueStatus;
  uuid: string;
  content: string;
  priority: number;
  assignee?: string;
  archived?: boolean;
  archived_at?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  parent_id?: string;
  parent_uuid?: string;
}

export type IssueStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "needs_review"
  | "closed";

export interface Relationship {
  from_id: string;
  from_uuid: string;
  from_type: EntityType;
  to_id: string;
  to_uuid: string;
  to_type: EntityType;
  relationship_type: RelationshipType;
  created_at: string;
  metadata?: string;
}

export type EntityType = "spec" | "issue";

export type RelationshipType =
  | "blocks"
  | "related"
  | "discovered-from"
  | "implements"
  | "references"
  | "depends-on";

export interface Tag {
  entity_id: string;
  entity_uuid: string;
  entity_type: EntityType;
  tag: string;
}

export interface Event {
  id: number;
  entity_id: string;
  entity_uuid: string;
  entity_type: EntityType;
  event_type: EventType;
  actor: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_at: string;
  git_commit_sha: string | null;
  source?: string;
}

export type EventType =
  | "created"
  | "updated"
  | "status_changed"
  | "relationship_added"
  | "relationship_removed"
  | "tag_added"
  | "tag_removed";

/**
 * Issue-based spec feedback types
 */
export interface IssueFeedback {
  id: string;
  issue_id: string;
  issue_uuid: string;
  spec_id: string;
  spec_uuid: string;
  feedback_type: FeedbackType;
  content: string;
  agent?: string;
  anchor?: string;
  dismissed?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Base location anchor for tracking positions in markdown documents
 */
export interface LocationAnchor {
  section_heading?: string;
  section_level?: number;
  line_number?: number;
  line_offset?: number;
  text_snippet?: string;
  context_before?: string;
  context_after?: string;
  content_hash?: string;
}

/**
 * Feedback anchor with additional tracking for changes over time
 */
export interface FeedbackAnchor extends LocationAnchor {
  anchor_status: "valid" | "relocated" | "stale";
  last_verified_at?: string;
  original_location?: {
    line_number: number;
    section_heading?: string;
  };
}

export type FeedbackType = "comment" | "suggestion" | "request";

/**
 * JSONL format types
 */
export interface SpecJSONL extends Spec {
  relationships: RelationshipJSONL[];
  tags: string[];
}

export interface IssueJSONL extends Issue {
  relationships: RelationshipJSONL[];
  tags: string[];
  feedback?: FeedbackJSONL[];
}

export interface FeedbackJSONL {
  id: string;
  issue_id: string;
  spec_id: string;
  feedback_type: FeedbackType;
  content: string;
  agent?: string;
  anchor?: FeedbackAnchor;
  dismissed?: boolean;
  created_at: string;
  updated_at: string;
}

export interface RelationshipJSONL {
  from: string;
  from_type: EntityType;
  to: string;
  to_type: EntityType;
  type: RelationshipType;
}

/**
 * Worktree configuration for session isolation
 */
export interface WorktreeConfig {
  /** Where to store worktrees (default: ".sudocode/worktrees") */
  worktreeStoragePath: string;
  /** Auto-create branches for new sessions (default: true) */
  autoCreateBranches: boolean;
  /** Auto-delete branches when session is cleaned up (default: false) */
  autoDeleteBranches: boolean;
  /** Use sparse-checkout for worktrees (default: false) */
  enableSparseCheckout: boolean;
  /** Patterns for sparse-checkout (optional) */
  sparseCheckoutPatterns?: string[];
  /** Branch naming prefix (default: "sudocode") */
  branchPrefix: string;
  /** Cleanup orphaned worktrees on server startup (default: true) */
  cleanupOrphanedWorktreesOnStartup: boolean;
}

/**
 * Config metadata file structure (.sudocode/config.json)
 */
export interface Config {
  // TODO: Deprecate version field.
  version: string;
  /** Worktree configuration (optional) */
  worktree?: WorktreeConfig;
}

/**
 * Agent types supported for execution
 */
export type AgentType = "claude-code" | "codex" | "project-coordinator";

/**
 * Execution status
 */
export type ExecutionStatus =
  | "preparing" // Template being prepared
  | "pending" // Created, not yet started
  | "running" // Agent executing
  | "paused" // Execution paused (awaiting follow-up)
  | "completed" // Successfully finished
  | "failed" // Execution failed
  | "cancelled" // User cancelled
  | "stopped"; // User stopped (legacy alias for cancelled)

/**
 * Represents a single agent run on an issue
 * Tracks the full lifecycle of a coding agent execution
 */
export interface Execution {
  id: string;
  issue_id: string | null;
  issue_uuid: string | null;

  mode: string | null;
  prompt: string | null;
  config: string | null;

  // Process information
  agent_type: AgentType;
  session_id: string | null;
  workflow_execution_id: string | null;

  // Git/branch information
  target_branch: string;
  branch_name: string;
  before_commit: string | null;
  after_commit: string | null;
  worktree_path: string | null;

  // Status
  status: ExecutionStatus;

  // Timing
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;

  // Results and metadata
  // TODO: Expand as a proper JSON object
  exit_code: number | null;
  error_message: string | null;
  error: string | null;
  model: string | null;
  summary: string | null;
  files_changed: string | null;

  parent_execution_id: string | null;

  // Multi-step workflow support (future extension)
  step_type: string | null;
  step_index: number | null;
  step_config: string | null;
}

/**
 * Project Agent types
 */

/**
 * Project agent mode
 */
export type ProjectAgentMode = "monitoring" | "planning" | "full";

/**
 * Project agent status
 */
export type ProjectAgentStatus = "running" | "stopped" | "error";

/**
 * Project agent execution tracking
 */
export interface ProjectAgentExecution {
  id: string;
  execution_id: string;
  status: ProjectAgentStatus;
  mode: ProjectAgentMode;
  use_worktree: boolean;
  worktree_path: string | null;
  config_json: string;

  // Metrics
  events_processed: number;
  actions_proposed: number;
  actions_approved: number;
  actions_rejected: number;

  started_at: string;
  stopped_at: string | null;
  last_activity_at: string | null;
}

/**
 * Project agent action types
 */
export type ProjectAgentActionType =
  | "create_issues_from_spec"
  | "start_execution"
  | "pause_execution"
  | "resume_execution"
  | "add_feedback"
  | "modify_spec"
  | "create_relationship"
  | "update_issue_status";

/**
 * Project agent action status
 */
export type ProjectAgentActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

/**
 * Project agent action priority
 */
export type ProjectAgentActionPriority = "high" | "medium" | "low";

/**
 * Project agent action target type
 */
export type ProjectAgentActionTargetType = "spec" | "issue" | "execution";

/**
 * Project agent action
 */
export interface ProjectAgentAction {
  id: string;
  project_agent_execution_id: string;

  action_type: ProjectAgentActionType;
  status: ProjectAgentActionStatus;
  priority: ProjectAgentActionPriority | null;

  // Action details
  target_id: string | null;
  target_type: ProjectAgentActionTargetType | null;
  payload_json: string;
  justification: string;

  // Auto-approval & Risk (Phase 6)
  confidence_score: number | null; // 0-100: confidence in action correctness
  risk_level: "low" | "medium" | "high" | null; // risk assessment

  // Lifecycle
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  executed_at: string | null;
  completed_at: string | null;

  // Result
  result_json: string | null;
  error_message: string | null;
}

/**
 * Project agent event
 */
export interface ProjectAgentEvent {
  id: string;
  project_agent_execution_id: string;

  event_type: string;
  event_payload_json: string;

  processed_at: string;
  processing_duration_ms: number | null;

  // Action taken (if any)
  action_id: string | null;
}

/**
 * Project agent configuration
 */
export interface ProjectAgentConfig {
  useWorktree: boolean;
  worktreePath?: string;
  mode: ProjectAgentMode;
  autoApprove: AutoApprovalConfig;
  monitoring: MonitoringConfig;
}

/**
 * Auto-approval configuration
 */
export interface AutoApprovalConfig {
  enabled: boolean;
  allowedActions: ProjectAgentActionType[];
  // Phase 6: Confidence & Risk thresholds
  minConfidenceScore?: number; // Default: 70 (0-100)
  maxRiskLevel?: "low" | "medium" | "high"; // Default: "medium"
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  stallThresholdMinutes: number;
  checkIntervalSeconds: number;
}
