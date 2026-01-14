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
  | "stopped"; // User stopped (legacy alias for cancelled)

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
