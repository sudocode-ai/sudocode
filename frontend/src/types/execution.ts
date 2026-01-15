/**
 * Execution system types
 */

import type {
  ExecutionStatus,
  AgentType,
  Execution,
  ExecutionChangesResult,
  FileChangeStat,
} from '@sudocode-ai/types'

// TODO: Remove this re-export and fully migrate to @sudocode-ai/types
/**
 * Re-export types from @sudocode-ai/types
 */
export type { ExecutionStatus, AgentType, Execution, ExecutionChangesResult, FileChangeStat }

/**
 * Execution mode - where the agent runs
 */
export type ExecutionMode =
  | 'worktree' // Isolated git worktree
  | 'local' // Local working directory

/**
 * Cleanup mode - when to cleanup worktree
 */
export type CleanupMode =
  | 'auto' // Cleanup on successful completion
  | 'manual' // User must manually cleanup
  | 'never' // Never auto-cleanup (for debugging)

/**
 * Execution configuration - user-configurable settings
 * NOTE: This is frontend-specific configuration that gets serialized to JSON
 * and stored in the execution.config field (from @sudocode-ai/types)
 */
export interface ExecutionConfig {
  // Agent settings
  model?: string // e.g., 'claude-sonnet-4'
  maxTokens?: number
  temperature?: number

  // Execution behavior
  timeout?: number // Overall timeout (ms)
  mode?: ExecutionMode // Execution mode

  // Session mode (persistent sessions)
  sessionMode?: SessionMode // 'discrete' (default) or 'persistent'
  sessionEndMode?: {
    idleTimeoutMs?: number // Auto-end after idle period
    endOnDisconnect?: boolean // End when browser disconnects
    pauseOnCompletion?: boolean // Pause instead of wait after prompt
  }

  // Worktree settings (if mode === 'worktree')
  baseBranch?: string // Branch to base worktree on
  createBaseBranch?: boolean // If true, create baseBranch from current HEAD
  branchName?: string // Override auto-generated branch name
  cleanupMode?: CleanupMode // When to cleanup worktree
  reuseWorktreePath?: string // If set, reuse existing worktree at this path

  // Workflow settings
  checkpointInterval?: number // Steps between checkpoints
  continueOnStepFailure?: boolean // Continue after step failure

  // Output settings
  captureFileChanges?: boolean
  captureToolCalls?: boolean

  // Agent-specific configuration (e.g., Codex flags, Copilot settings)
  agentConfig?: Record<string, any>

  // Tags for categorization (e.g., 'project-assistant')
  tags?: string[]
}

/**
 * Prompt template variable
 */
export interface PromptVariable {
  name: string // e.g., 'issueId', 'title', 'description'
  description: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required: boolean
  defaultValue?: any
}

/**
 * Prompt template
 */
export interface PromptTemplate {
  id: string
  name: string
  description: string
  type: 'issue' | 'spec' | 'custom'
  template: string
  variables: PromptVariable[]
  isDefault?: boolean
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Execution preparation result - preview before starting
 */
export interface ExecutionPrepareResult {
  // Rendered preview
  renderedPrompt: string

  // Issue context
  issue: {
    id: string
    title: string
    description: string
  }

  // Related context
  relatedSpecs: Array<{ id: string; title: string }>
  relatedFeedback: Array<{ issueId: string; content: string }>

  // Default configuration
  defaultConfig: ExecutionConfig

  // Available options
  availableModels: string[]
  availableBranches: string[]
  availableTemplates?: PromptTemplate[]

  // Validation
  warnings?: string[]
  errors?: string[]
}

/**
 * API Request types
 */

export interface PrepareExecutionRequest {
  templateId?: string
  config?: Partial<ExecutionConfig>
}

export interface CreateExecutionRequest {
  config: ExecutionConfig
  prompt: string
  agentType?: string
}

export interface CreateFollowUpRequest {
  feedback: string
}

/**
 * Worktree Sync types
 */

export interface SyncConflict {
  filePath: string
  conflictType: 'content' | 'delete' | 'rename' | 'mode'
  description: string
  canAutoResolve: boolean
  resolutionStrategy?: string
}

export interface JSONLConflict {
  filePath: string
  entityType: 'issue' | 'spec'
  conflictCount: number
  canAutoResolve: boolean
}

export interface ConflictReport {
  hasConflicts: boolean
  codeConflicts: SyncConflict[]
  jsonlConflicts: JSONLConflict[]
  totalFiles: number
  summary: string
}

export interface DiffSummary {
  files: string[]
  additions: number
  deletions: number
}

export interface Commit {
  sha: string
  message: string
  author: string
  timestamp: string
}

/**
 * Stats about uncommitted changes in worktree
 */
export interface UncommittedFileStats {
  files: string[]
  additions: number
  deletions: number
}

/**
 * Info about potential local conflicts when including uncommitted files
 */
export interface PotentialLocalConflicts {
  /** Number of files that may have merge conflicts */
  count: number
  /** List of files that may have merge conflicts */
  files: string[]
}

/**
 * Info about local uncommitted JSONL files that will be auto-merged during sync
 */
export interface LocalUncommittedJsonl {
  /** List of uncommitted JSONL files in the local working tree */
  files: string[]
  /** Whether these files will be auto-merged during sync */
  willAutoMerge: boolean
}

export interface SyncPreviewResult {
  canSync: boolean
  conflicts: ConflictReport
  diff: DiffSummary
  commits: Commit[]
  mergeBase: string
  /** @deprecated Use uncommittedChanges instead */
  uncommittedJSONLChanges?: boolean
  /** Stats about uncommitted changes in worktree (not included in sync by default) */
  uncommittedChanges?: UncommittedFileStats
  /** Files that may have merge conflicts if "include uncommitted" is selected */
  potentialLocalConflicts?: PotentialLocalConflicts
  /** Local uncommitted JSONL files that will be auto-merged during sync */
  localUncommittedJsonl?: LocalUncommittedJsonl
  executionStatus: ExecutionStatus
  warnings: string[]
}

export interface SyncResult {
  success: boolean
  finalCommit?: string
  filesChanged: number
  /** Whether there are unresolved merge conflicts (user must resolve manually) */
  hasConflicts?: boolean
  /** List of files that have merge conflicts requiring manual resolution */
  filesWithConflicts?: string[]
  /** Number of uncommitted files copied from worktree (stage sync only) */
  uncommittedFilesIncluded?: number
  error?: string
  cleanupOffered?: boolean
}

export type SyncMode = 'squash' | 'preserve' | 'stage'

export interface PerformSyncRequest {
  mode: SyncMode
  commitMessage?: string
}

/**
 * Persistent session state response
 */
export type SessionMode = 'discrete' | 'persistent'
export type SessionState = 'running' | 'waiting' | 'paused' | 'ended'

export interface SessionStateResponse {
  mode: SessionMode
  state: SessionState | null // null for discrete mode
  promptCount: number
  idleTimeMs?: number
}

/**
 * Checkpoint types
 */

/**
 * Options for checkpoint operation
 */
export interface CheckpointOptions {
  /** Checkpoint message */
  message?: string
  /** Whether to squash commits (default: true) */
  squash?: boolean
  /** Whether to add to merge queue (default: true) */
  autoEnqueue?: boolean
}

/**
 * Checkpoint review status
 */
export type CheckpointReviewStatus = 'pending' | 'approved' | 'rejected' | 'merged'

/**
 * Checkpoint information
 */
export interface Checkpoint {
  id: string
  issue_id: string
  execution_id: string
  stream_id?: string
  commit_sha: string
  parent_commit?: string
  changed_files: number
  additions: number
  deletions: number
  message: string
  checkpointed_at: string
  checkpointed_by?: string
  review_status: CheckpointReviewStatus
  reviewed_at?: string
  reviewed_by?: string
  review_notes?: string
}

/**
 * Issue stream information for checkpoint result
 */
export interface IssueStreamInfo {
  id: string
  branch: string
  created: boolean
}

/**
 * Queue entry for checkpoint result
 */
export interface QueueEntry {
  id: string
  executionId: string
  streamId: string
  targetBranch: string
  position: number
  priority: number
  status: 'pending' | 'ready' | 'merging' | 'merged' | 'failed' | 'cancelled'
  addedAt: number
  error?: string
  mergeCommit?: string
}

/**
 * Conflict information for checkpoint
 */
export interface CheckpointConflict {
  id: string
  streamId: string
  path: string
  ours?: string
  theirs?: string
  base?: string
  markers?: string
  detectedAt: number
}

/**
 * Result of checkpoint operation
 */
export interface CheckpointResult {
  success: boolean
  checkpoint?: Checkpoint
  issueStream?: IssueStreamInfo
  queueEntry?: QueueEntry
  conflicts?: CheckpointConflict[]
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Promote Types (Issue Stream → Main Branch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for promote operation
 */
export interface PromoteOptions {
  /** Target branch to merge into (default: main) */
  target_branch?: string
  /** Merge strategy: squash all into one commit or preserve history */
  strategy?: 'squash' | 'merge'
  /** Promote entire stack of dependent issues (default: false) */
  include_stack?: boolean
  /** Custom merge commit message */
  message?: string
  /** Force promote even if checkpoint is not approved (default: false) */
  force?: boolean
  /** Who is performing the promote */
  promoted_by?: string
}

/**
 * Cascade stream result for dependent rebases
 */
export interface CascadeStreamResult {
  stream_id: string
  issue_id?: string
  result: 'rebased' | 'conflict' | 'skipped' | 'failed'
  conflict_files?: string[]
  new_head?: string
  error?: string
}

/**
 * Cascade report for dependent streams
 */
export interface CascadeReport {
  triggered_by: string
  affected_streams: CascadeStreamResult[]
  complete: boolean
  deferred?: string[]
}

/**
 * Result of promote operation
 */
export interface PromoteResult {
  success: boolean
  /** Merge commit hash on target branch */
  merge_commit?: string
  /** Number of files changed */
  files_changed: number
  /** Lines added */
  additions: number
  /** Lines deleted */
  deletions: number
  /** Issue IDs that were promoted (if include_stack: true) */
  promoted_issues?: string[]
  /** Error message if failed */
  error?: string
  /** Issue IDs that must be promoted first (blocking dependencies) */
  blocked_by?: string[]
  /** Whether approval is required before promote */
  requires_approval?: boolean
  /** Conflicts if any were detected */
  conflicts?: CheckpointConflict[]
  /** Cascade report if dependents were rebased */
  cascade?: CascadeReport
}
