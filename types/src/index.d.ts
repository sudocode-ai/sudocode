/**
 * Core entity types for sudocode
 */

import type { IntegrationsConfig } from "./integrations.js";
import type { VoiceSettingsConfig } from "./voice.js";

// =============================================================================
// Integration Types (External Links)
// =============================================================================

/**
 * Direction of sync between sudocode and external system
 */
export type SyncDirection = "inbound" | "outbound" | "bidirectional";

/**
 * Strategy for resolving conflicts during sync
 */
export type ConflictResolution =
  | "newest-wins"
  | "sudocode-wins"
  | "external-wins"
  | "manual";

/**
 * Integration provider name - any string to support plugins
 * First-party providers: "beads", "jira", "spec-kit", "openspec"
 * Third-party plugins can use any unique name
 */
export type IntegrationProviderName = string;

/**
 * Represents a link between a sudocode entity (Spec/Issue) and an external system
 */
export interface ExternalLink {
  /** The integration provider this link belongs to (plugin name) */
  provider: string;
  /** Unique identifier in the external system */
  external_id: string;
  /** URL to view/edit in external system (optional) */
  external_url?: string;
  /** Whether sync is enabled for this link */
  sync_enabled: boolean;
  /** Direction of sync */
  sync_direction: SyncDirection;
  /** When this entity was last synced */
  last_synced_at?: string;
  /** Last known update time in external system */
  external_updated_at?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
  /** When this entity was initially imported (ISO 8601) */
  imported_at?: string;
  /** Hash of external content for change detection */
  content_hash?: string;
  /** Metadata captured during import (separate from sync metadata) */
  import_metadata?: Record<string, unknown>;
}

// =============================================================================
// Core Entities
// =============================================================================

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
  external_links?: ExternalLink[];
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
  external_links?: ExternalLink[];
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
 * Issue-based feedback types
 * Feedback can target either a spec or another issue (type inferred from ID prefix)
 *
 * When from_id is set, feedback originates from a sudocode issue.
 * When from_id is null/undefined, feedback is anonymous/external.
 */
export interface IssueFeedback {
  id: string;
  /** Issue ID that provided the feedback (optional for anonymous/external feedback) */
  from_id?: string;
  /** Issue UUID that provided the feedback (optional for anonymous/external feedback) */
  from_uuid?: string;
  to_id: string;
  to_uuid: string;
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
  /** Issue ID that provided the feedback (optional for anonymous/external feedback) */
  from_id?: string;
  to_id: string;
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
 * Supported editor types for opening worktrees
 */
export type EditorType =
  | "vs-code"
  | "cursor"
  | "windsurf"
  | "intellij"
  | "zed"
  | "xcode"
  | "custom";

/**
 * Editor configuration for IDE integration
 */
export interface EditorConfig {
  /** The editor type to use */
  editorType: EditorType;
  /** Custom command when editorType is 'custom' */
  customCommand?: string;
}

/**
 * Deployment configuration for remote development environments
 */
export interface DeployConfig {
  /** Deployment provider (currently only Codespaces supported) */
  provider: 'codespaces';
  /** Default branch to deploy from (optional) */
  defaultBranch?: string;
  /** Port number for the server (default: 3000) */
  port: number;
  /** Idle timeout in minutes before auto-shutdown */
  idleTimeout: number;
  /** Keep-alive duration in hours before auto-cleanup */
  keepAliveHours: number;
  /** Machine type/size (e.g., 'basicLinux32gb', 'premiumLinux') */
  machine: string;
  /** Retention period in days before cleanup */
  retentionPeriod: number;
}

/**
 * GitHub Codespaces provider configuration
 */
export interface CodespacesProviderConfig {
  /** Default branch to spawn from (optional) */
  defaultBranch?: string;
  /** Port number for the server (default: 3000) */
  port: number;
  /** Idle timeout in minutes before auto-shutdown */
  idleTimeout: number;
  /** Keep-alive duration in hours before auto-cleanup */
  keepAliveHours: number;
  /** Machine type/size (e.g., 'basicLinux32gb', 'premiumLinux') */
  machine: string;
  /** Retention period in days before cleanup */
  retentionPeriod: number;
}

/**
 * Coder provider configuration (future support)
 */
export interface CoderProviderConfig {
  // Future coder configuration
}

/**
 * Spawn configuration for remote development environments
 * Supports multiple provider configurations
 */
export interface SpawnConfig {
  /** Configuration version */
  version: string;
  /** Provider-specific configurations */
  providers: {
    /** GitHub Codespaces configuration (optional) */
    codespaces?: CodespacesProviderConfig;
    /** Coder configuration (optional, future support) */
    coder?: CoderProviderConfig;
  };
}

/**
 * Config metadata file structure (.sudocode/config.json)
 */
export interface Config {
  // TODO: Deprecate version field.
  version: string;
  /** Worktree configuration (optional) */
  worktree?: WorktreeConfig;
  /** Integration configurations (optional) */
  integrations?: IntegrationsConfig;
  /** Editor configuration (optional) */
  editor?: EditorConfig;
  /** Voice configuration (optional) */
  voice?: VoiceSettingsConfig;
}

/**
 * Agent types and configurations
 * See agents.d.ts for detailed agent configuration types
 */
export type {
  AgentType,
  ExecutionMode,
  BaseAgentConfig,
  ClaudeCodeConfig,
  CodexConfig,
  CopilotConfig,
  CursorConfig,
  AgentConfig,
} from "./agents.js";

/**
 * Execution status
 */
export type ExecutionStatus =
  | "preparing" // Template being prepared
  | "pending" // Created, not yet started
  | "running" // Agent executing
  | "paused" // Execution paused (awaiting follow-up)
  | "waiting" // Persistent session alive, waiting for next prompt
  | "completed" // Successfully finished
  | "failed" // Execution failed
  | "cancelled" // User cancelled
  | "stopped" // User stopped (legacy alias for cancelled)
  | "conflicted"; // Has unresolved merge/rebase conflicts

/**
 * Strategy for resolving conflicts
 */
export type ConflictStrategy = "ours" | "theirs" | "manual" | "abort";

/**
 * Type of conflict encountered during merge/rebase
 */
export type ConflictType = "code" | "jsonl" | "binary";

/**
 * Represents a merge/rebase conflict in an execution
 */
export interface ExecutionConflict {
  /** Unique conflict identifier */
  id: string;
  /** Execution ID this conflict belongs to */
  execution_id: string;
  /** File path with conflict */
  path: string;
  /** Type of conflict */
  type: ConflictType;
  /** Whether this conflict can be auto-resolved */
  auto_resolvable: boolean;
  /** Stream ID that caused the conflict (if from cascade) */
  conflicting_stream_id?: string;
  /** Issue ID of conflicting stream */
  conflicting_issue_id?: string;
  /** Conflict details or markers */
  details?: string;
  /** When conflict was detected */
  detected_at: string;
  /** When conflict was resolved (null if unresolved) */
  resolved_at?: string;
  /** Resolution strategy used */
  resolution_strategy?: ConflictStrategy;
}

/**
 * Review status for a checkpoint
 */
export type CheckpointReviewStatus = "pending" | "approved" | "rejected" | "merged";

/**
 * Represents a checkpoint of execution changes to an issue stream
 * Part of the stacked diffs workflow - allows saving work before merging to main
 */
export interface Checkpoint {
  /** Unique checkpoint identifier */
  id: string;
  /** Issue ID this checkpoint belongs to */
  issue_id: string;
  /** Execution ID that created this checkpoint */
  execution_id: string;
  /** Dataplane stream ID for the issue */
  stream_id: string;
  /** Git commit SHA of the checkpoint */
  commit_sha: string;
  /** Parent commit SHA (for incremental checkpoints) */
  parent_commit?: string;
  /** Number of files changed in this checkpoint */
  changed_files: number;
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** User-provided checkpoint message */
  message: string;
  /** When checkpoint was created (ISO 8601) */
  checkpointed_at: string;
  /** Who created the checkpoint (user/agent identifier) */
  checkpointed_by?: string;
  /** Review status of the checkpoint */
  review_status: CheckpointReviewStatus;
  /** When checkpoint was reviewed */
  reviewed_at?: string;
  /** Who reviewed the checkpoint */
  reviewed_by?: string;
  /** Review notes or comments */
  review_notes?: string;
  /** Target branch for the checkpoint (default: main) */
  target_branch?: string;
  /** Queue position (if queued for merge) */
  queue_position?: number;
  /** JSON snapshot of changed issues at this checkpoint */
  issue_snapshot?: string;
  /** JSON snapshot of changed specs at this checkpoint */
  spec_snapshot?: string;
}

/**
 * Health status of a stack
 */
export type StackHealth = "ready" | "blocked" | "conflicts" | "pending";

/**
 * Represents a stack of related issues for coordinated merging
 * Stacks can be auto-generated from issue dependencies or manually created
 */
export interface Stack {
  /** Unique stack identifier */
  id: string;
  /** Optional human-readable name */
  name?: string;
  /** Optional root issue that anchors this stack */
  root_issue_id?: string;
  /** Ordered list of issue IDs (depth=0 is first/leaf, following git convention) */
  issue_order: string[];
  /** True if auto-generated from dependencies */
  is_auto: boolean;
  /** When stack was created (ISO 8601) */
  created_at: string;
  /** When stack was last updated (ISO 8601) */
  updated_at: string;
}

/**
 * Represents a single entry in a stack with enriched status info
 */
export interface StackEntry {
  /** Issue ID */
  issue_id: string;
  /** Depth in stack (0 = leaf, following git convention) */
  depth: number;
  /** Whether this issue has a checkpoint */
  has_checkpoint: boolean;
  /** Review status of the checkpoint (if exists) */
  checkpoint_status?: CheckpointReviewStatus;
  /** Whether this issue's checkpoint has been promoted to base branch */
  is_promoted: boolean;
  /** Attribution for projected changes (Phase 2 overlay support) */
  _attribution?: Attribution;
  /** Whether this entry reflects projected state */
  _isProjected?: boolean;
  /** Type of change if projected */
  _changeType?: 'created' | 'modified' | 'deleted';
}

/**
 * Full stack information including computed entries and health
 */
export interface StackInfo {
  /** Stack metadata */
  stack: Stack;
  /** Computed entries with status info */
  entries: StackEntry[];
  /** Overall health status of the stack */
  health: StackHealth;
}

// =============================================================================
// Projected State Types (Checkpoint Overlay)
// =============================================================================

/**
 * Attribution information for a projected change.
 * Tracks the source of changes that come from pending checkpoints.
 */
export interface Attribution {
  /** Dataplane stream ID where the change originated */
  streamId: string;
  /** Execution ID that created the change */
  executionId: string;
  /** Checkpoint ID containing the snapshot */
  checkpointId: string;
  /** Worktree path where the change was made (if available) */
  worktreePath: string | null;
  /** Branch name of the worktree (if available) */
  branchName: string | null;
}

/**
 * Issue with projected changes from checkpoint overlays.
 * Extends Issue with optional attribution for changes that haven't been merged yet.
 */
export interface ProjectedIssue extends Issue {
  /** Attribution for the source of projected changes */
  _attribution?: Attribution;
  /** True if this issue has been modified or created from a checkpoint overlay */
  _isProjected?: boolean;
  /** Change type for new/modified issues in overlay */
  _changeType?: "created" | "modified" | "deleted";
}

/**
 * Spec with projected changes from checkpoint overlays.
 * Extends Spec with optional attribution for changes that haven't been merged yet.
 */
export interface ProjectedSpec extends Spec {
  /** Attribution for the source of projected changes */
  _attribution?: Attribution;
  /** True if this spec has been modified or created from a checkpoint overlay */
  _isProjected?: boolean;
  /** Change type for new/modified specs in overlay */
  _changeType?: "created" | "modified" | "deleted";
}

// =============================================================================
// PR Batch Types (Phase 5)
// =============================================================================

/**
 * PR status for a batch
 */
export type BatchPRStatus = "draft" | "open" | "approved" | "merged" | "closed";

/**
 * Merge strategy for combining commits
 */
export type MergeStrategy = "squash" | "preserve";

/**
 * Represents a batch of queue entries to be merged as a single PR
 * Enables atomic review and merge of dependent changes
 */
export interface PRBatch {
  /** Unique batch identifier */
  id: string;
  /** Human-readable title for the batch/PR */
  title: string;
  /** Optional description for the PR body */
  description?: string;
  /** JSON array of queue entry IDs included in this batch */
  entry_ids: string[];
  /** Target branch for the PR */
  target_branch: string;
  /** GitHub PR number (set after PR creation) */
  pr_number?: number;
  /** GitHub PR URL (set after PR creation) */
  pr_url?: string;
  /** Current status of the PR */
  pr_status: BatchPRStatus;
  /** Strategy for merging commits */
  merge_strategy: MergeStrategy;
  /** Whether to create as draft PR */
  is_draft_pr: boolean;
  /** When batch was created (ISO 8601) */
  created_at: string;
  /** When batch was last updated (ISO 8601) */
  updated_at: string;
  /** Who created the batch */
  created_by?: string;
}

/**
 * Enriched batch with resolved queue entries and computed stats
 */
export interface EnrichedBatch extends PRBatch {
  /** Resolved queue entries */
  entries: EnrichedQueueEntry[];
  /** Total number of files changed */
  total_files: number;
  /** Total lines added */
  total_additions: number;
  /** Total lines deleted */
  total_deletions: number;
  /** Computed dependency order for merging */
  dependency_order: string[];
  /** Whether there are dependency violations */
  has_dependency_violations: boolean;
}

/**
 * Request to create a new batch
 */
export interface CreateBatchRequest {
  /** Title for the batch/PR */
  title: string;
  /** Optional description */
  description?: string;
  /** Queue entry IDs to include */
  entry_ids: string[];
  /** Target branch (default: main) */
  target_branch?: string;
  /** Merge strategy (default: squash) */
  merge_strategy?: MergeStrategy;
  /** Whether to create as draft (default: true) */
  is_draft_pr?: boolean;
}

/**
 * Request to promote a batch (merge to target)
 */
export interface BatchPromoteRequest {
  /** Batch ID to promote */
  batch_id: string;
  /** Whether to auto-merge after PR creation */
  auto_merge?: boolean;
}

/**
 * Preview of what a batch will contain
 */
export interface BatchPreview {
  /** Computed dependency order */
  dependency_order: string[];
  /** Files that will be changed */
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  /** Total lines added */
  total_additions: number;
  /** Total lines deleted */
  total_deletions: number;
  /** Preview of PR body */
  pr_body_preview: string;
}

// =============================================================================
// Queue Types (for batch integration)
// =============================================================================

/**
 * Queue entry status
 */
export type QueueStatus =
  | "pending"
  | "ready"
  | "merging"
  | "merged"
  | "failed"
  | "cancelled";

/**
 * Enriched queue entry with issue/stack metadata
 */
export interface EnrichedQueueEntry {
  /** Queue entry ID */
  id: string;
  /** Execution ID */
  executionId: string;
  /** Dataplane stream ID */
  streamId: string;
  /** Target branch for merge */
  targetBranch: string;
  /** Position in queue */
  position: number;
  /** Priority value */
  priority: number;
  /** Current status */
  status: QueueStatus;
  /** When added to queue (epoch ms) */
  addedAt: number;
  /** Associated issue ID */
  issueId: string;
  /** Issue title */
  issueTitle: string;
  /** Stack ID (if in a stack) */
  stackId?: string;
  /** Stack name (if in a stack) */
  stackName?: string;
  /** Depth in stack */
  stackDepth: number;
  /** Issue IDs this entry depends on */
  dependencies: string[];
  /** Whether this entry can be promoted */
  canPromote: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Session persistence mode for executions
 *
 * - "discrete": Default behavior - one prompt per execution, process terminates after completion
 * - "persistent": Toad-style - process stays alive, multiple prompts to same session
 */
export type SessionMode = "discrete" | "persistent";

/**
 * Configuration for how a persistent session ends
 *
 * Multiple options can be enabled simultaneously. The session ends when any
 * configured condition is met.
 */
export interface SessionEndModeConfig {
  /** End on explicit user action (default: true) */
  explicit?: boolean;
  /** End after idle timeout in milliseconds (0 = disabled, default: 0) */
  idleTimeoutMs?: number;
  /** Pause on agent completion signal, resumable (default: false) */
  pauseOnCompletion?: boolean;
  /** End when WebSocket connection drops (default: false) */
  endOnDisconnect?: boolean;
}

/**
 * Session configuration for execution
 *
 * Controls how the agent session lifecycle is managed during execution.
 */
export interface ExecutionSessionConfig {
  /** Session persistence mode (default: "discrete") */
  sessionMode?: SessionMode;
  /** How the persistent session ends (only applies when sessionMode: "persistent") */
  sessionEndMode?: SessionEndModeConfig;
}

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

  // Dataplane integration
  stream_id: string | null;

  // Soft delete support
  deleted_at: string | null;
  deletion_reason: string | null;
}

// Re-export execution artifact types
export type {
  FileChangeStat,
  ExecutionChangesResult,
  ChangesSnapshot,
} from "./artifacts.js";

/**
 * Workflow types for multi-issue orchestration
 * See workflows.d.ts for detailed workflow types
 */
export type {
  // Status types
  WorkflowStatus,
  WorkflowStepStatus,
  // Source types
  WorkflowSource,
  WorkflowSourceSpec,
  WorkflowSourceIssues,
  WorkflowSourceRootIssue,
  WorkflowSourceGoal,
  // Escalation types (Human-in-the-Loop)
  EscalationStatus,
  EscalationResponse,
  EscalationData,
  // Configuration types
  WorkflowParallelism,
  WorkflowFailureStrategy,
  WorkflowAutonomyLevel,
  WorkflowConfig,
  // Core entity types
  WorkflowStep,
  Workflow,
  // Event types
  WorkflowEventType,
  WorkflowEvent,
  // Database row types
  WorkflowRow,
  WorkflowEventRow,
  // Utility types
  CreateWorkflowOptions,
  DependencyGraph,
} from "./workflows.js";

/**
 * Integration types for third-party systems
 * See integrations.d.ts for detailed integration types
 */
export type {
  // Configuration types
  IntegrationProviderConfig,
  IntegrationsConfig,
  IntegrationConfig, // Deprecated alias
  // Plugin types
  IntegrationPlugin,
  IntegrationProvider,
  PluginValidationResult,
  PluginTestResult,
  PluginConfigSchema,
  // Sync types
  ExternalEntity,
  ExternalChange,
  SyncResult,
  SyncConflict,
  // On-demand import types
  OnDemandImportCapable,
  ExternalComment,
  // Search types
  SearchOptions,
  SearchResult,
} from "./integrations.js";

/**
 * Voice types for STT/TTS functionality
 * See voice.d.ts for detailed voice types
 */
export type {
  // Provider types
  STTProvider,
  TTSProvider,
  // STT types
  TranscriptionResult,
  STTOptions,
  // TTS types
  TTSOptions,
  SynthesizeRequest,
  SynthesizeResponse,
  // Voice input state types
  VoiceInputState,
  VoiceInputErrorCode,
  VoiceInputError,
  // API request/response types
  TranscribeRequest,
  TranscribeResponse,
  // Configuration types
  STTConfig,
  TTSConfig,
  VoiceConfig,
  // Narration event types
  NarrationCategory,
  NarrationPriority,
  VoiceNarrationEvent,
  // User preferences
  VoicePreferences,
} from "./voice.js";
