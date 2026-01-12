/**
 * Dataplane Adapter Types
 *
 * TypeScript interfaces for the dataplane integration layer.
 *
 * @module services/dataplane-types
 */

import type { AgentType } from '@sudocode-ai/types';

// ─────────────────────────────────────────────────────────────────────────────
// Stream Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata stored in dataplane streams for sudocode tracking
 */
export interface SudocodeStreamMetadata {
  sudocode: {
    /** Type of stream - issue-level or execution-level */
    type: 'issue' | 'execution';
    /** Associated issue ID */
    issue_id: string;
    /** Associated execution ID (for execution streams) */
    execution_id?: string;
    /** Agent type running the execution */
    agent_type?: AgentType;
    /** Target branch for sync operations */
    target_branch?: string;
    /** Parent execution ID (for follow-ups) */
    parent_execution_id?: string;
    /** Checkpoint tracking for issue streams */
    checkpoint?: IssueCheckpointMetadata;
  };
}

/**
 * Checkpoint metadata stored in issue stream
 */
export interface IssueCheckpointMetadata {
  /** Number of checkpoints saved to this issue stream */
  checkpoint_count: number;
  /** Latest checkpoint info */
  current_checkpoint?: {
    /** Execution ID that created the checkpoint */
    execution_id: string;
    /** Checkpoint commit SHA */
    commit: string;
    /** When checkpoint was created (ISO 8601) */
    checkpointed_at: string;
  };
  /** Review status of the issue stream */
  review_status: 'none' | 'pending' | 'approved' | 'changes_requested';
}

/**
 * Info about an issue-level stream
 */
export interface IssueStreamInfo {
  /** Dataplane stream ID */
  streamId: string;
  /** Git branch name for the stream */
  branchName: string;
  /** Issue ID this stream belongs to */
  issueId: string;
  /** Base commit the stream was created from */
  baseCommit: string;
  /** Current HEAD commit */
  currentHead: string | null;
  /** Number of checkpoints */
  checkpointCount: number;
  /** Current checkpoint info */
  currentCheckpoint?: {
    executionId: string;
    commit: string;
    checkpointedAt: string;
  };
  /** Review status */
  reviewStatus: 'none' | 'pending' | 'approved' | 'changes_requested';
  /** Parent issue stream ID (for stacked issues) */
  parentStreamId?: string;
  /** Parent issue ID (for stacked issues) */
  parentIssueId?: string;
  /** When the stream was created */
  createdAt: number;
}

/**
 * Result of creating an execution stream
 */
export interface ExecutionStreamResult {
  /** Dataplane stream ID */
  streamId: string;
  /** Git branch name for the stream */
  branchName: string;
  /** Worktree path if created */
  worktreePath?: string;
  /** Whether this is a local mode stream (existing branch) */
  isLocalMode: boolean;
  /** Base commit the stream was created from */
  baseCommit: string;
}

/**
 * Worktree information
 */
export interface WorktreeInfo {
  /** Filesystem path to worktree */
  path: string;
  /** Stream ID associated with worktree */
  streamId: string;
  /** Git branch checked out in worktree */
  branch: string;
  /** Agent ID that owns the worktree */
  agentId: string;
  /** Whether worktree was newly created */
  created: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Change Tracking Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set of changes in a stream
 */
export interface ChangeSet {
  /** List of file changes */
  files: FileChange[];
  /** Total additions across all files */
  totalAdditions: number;
  /** Total deletions across all files */
  totalDeletions: number;
  /** Total files changed */
  totalFiles: number;
  /** Commit range (before..after) */
  commitRange: {
    before: string;
    after: string;
  };
}

/**
 * Individual file change
 */
export interface FileChange {
  /** File path relative to repo root */
  path: string;
  /** Change status */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** Previous path (for renames) */
  previousPath?: string;
}

/**
 * Diff for a single file
 */
export interface FileDiff {
  /** File path */
  path: string;
  /** Unified diff content */
  diff: string;
  /** Whether file is binary */
  isBinary: boolean;
  /** Old file mode */
  oldMode?: string;
  /** New file mode */
  newMode?: string;
}

/**
 * Commit parameters
 */
export interface CommitParams {
  /** Stream to commit on */
  streamId: string;
  /** Commit message */
  message: string;
  /** Agent making the commit */
  agentId: string;
  /** Worktree path */
  worktree: string;
  /** Whether to stage all changes first */
  stageAll?: boolean;
}

/**
 * Commit result
 */
export interface CommitResult {
  /** Whether commit succeeded */
  success: boolean;
  /** New commit hash */
  commitHash?: string;
  /** Files included in commit */
  filesChanged: number;
  /** Error message if failed */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync preview information
 */
export interface SyncPreview {
  /** Whether sync can proceed */
  canSync: boolean;
  /** Detected conflicts */
  conflicts: SyncConflict[];
  /** Whether there are JSONL conflicts (auto-resolvable) */
  hasJsonlConflicts: boolean;
  /** Whether there are code conflicts (manual resolution needed) */
  hasCodeConflicts: boolean;
  /** Diff summary */
  diff: ChangeSet;
  /** Commits to be synced */
  commits: SyncCommit[];
  /** Merge base commit */
  mergeBase: string;
  /** Uncommitted changes in worktree */
  uncommittedChanges?: UncommittedChanges;
  /** Warnings */
  warnings: string[];
}

/**
 * Conflict detected during sync preview
 */
export interface SyncConflict {
  /** File path */
  path: string;
  /** Type of conflict */
  type: 'jsonl' | 'code' | 'binary';
  /** Whether auto-resolvable */
  autoResolvable: boolean;
  /** Conflict details */
  details?: string;
}

/**
 * Commit in sync range
 */
export interface SyncCommit {
  /** Commit hash */
  hash: string;
  /** Commit message */
  message: string;
  /** Author */
  author: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Uncommitted changes info
 */
export interface UncommittedChanges {
  /** List of uncommitted files */
  files: string[];
  /** Total additions */
  additions: number;
  /** Total deletions */
  deletions: number;
}

/**
 * Sync operation options
 */
export interface SyncOptions {
  /** Include uncommitted changes */
  includeUncommitted?: boolean;
  /** Commit message for sync */
  message?: string;
  /** Agent performing sync */
  agentId: string;
  /** Create backup tag before sync */
  createBackup?: boolean;
}

/**
 * Sync operation result
 */
export interface SyncResult {
  /** Whether sync succeeded */
  success: boolean;
  /** Final commit hash on target */
  finalCommit?: string;
  /** Number of files changed */
  filesChanged: number;
  /** Whether manual conflict resolution is needed */
  hasUnresolvedConflicts?: boolean;
  /** Files with unresolved conflicts */
  conflictFiles?: string[];
  /** Error message if failed */
  error?: string;
  /** Backup tag created */
  backupTag?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = 'ours' | 'theirs' | 'manual' | 'abort';

/**
 * Active conflict info
 */
export interface ConflictInfo {
  /** Conflict ID */
  id: string;
  /** Stream ID */
  streamId: string;
  /** File path */
  path: string;
  /** Our version content */
  ours?: string;
  /** Their version content */
  theirs?: string;
  /** Base version content */
  base?: string;
  /** Conflict markers if present */
  markers?: string;
  /** When conflict was detected */
  detectedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconciliation result
 */
export interface ReconcileResult {
  /** Stream ID */
  streamId: string;
  /** Whether stream is in sync */
  inSync: boolean;
  /** Database state (expected head) */
  dbState?: string;
  /** Git state (actual head) */
  gitState?: string;
  /** Discrepancy description if out of sync */
  discrepancy?: string;
  /** Whether reconciliation was performed */
  reconciled: boolean;
  /** New head after reconciliation */
  newHead?: string;
}

/**
 * Health check report
 */
export interface HealthReport {
  /** Overall health status */
  healthy: boolean;
  /** Number of active streams */
  activeStreams: number;
  /** Streams that are out of sync */
  outOfSyncStreams: string[];
  /** Missing branches */
  missingBranches: string[];
  /** Orphaned worktrees */
  orphanedWorktrees: string[];
  /** Pending operations */
  pendingOperations: number;
  /** Last check timestamp */
  checkedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cascade Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result for a single stream in cascade
 */
export interface CascadeStreamResult {
  /** Stream ID */
  stream_id: string;
  /** Associated issue ID (if known) */
  issue_id?: string;
  /** Result status */
  result: 'rebased' | 'conflict' | 'skipped' | 'failed';
  /** Files with conflicts (if result is 'conflict') */
  conflict_files?: string[];
  /** New HEAD commit after rebase */
  new_head?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Cascade operation report
 */
export interface CascadeReport {
  /** Stream that triggered the cascade */
  triggered_by: string;
  /** Affected streams with results */
  affected_streams: CascadeStreamResult[];
  /** Whether cascade completed fully (no failures/conflicts stopped it) */
  complete: boolean;
  /** Streams with deferred conflicts (for defer_conflicts strategy) */
  deferred?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge Queue Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge queue entry
 */
export interface QueueEntry {
  /** Queue entry ID */
  id: string;
  /** Execution ID (stream source) */
  executionId: string;
  /** Stream ID */
  streamId: string;
  /** Target branch */
  targetBranch: string;
  /** Position in queue */
  position: number;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Queue status */
  status: 'pending' | 'ready' | 'merging' | 'merged' | 'failed' | 'cancelled';
  /** When added to queue */
  addedAt: number;
  /** Error message if failed */
  error?: string;
  /** Merge commit if merged */
  mergeCommit?: string;
}

/**
 * Reorder operation result
 */
export interface ReorderResult {
  /** Whether reorder succeeded */
  success: boolean;
  /** New queue order */
  newOrder: string[];
  /** Cascade triggered if any */
  cascadeTriggered: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Merge operation result
 */
export interface MergeResult {
  /** Whether merge succeeded */
  success: boolean;
  /** Merge commit hash */
  mergeCommit?: string;
  /** Stream that was merged */
  streamId: string;
  /** Error message if failed */
  error?: string;
  /** Conflicts if any */
  conflicts?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for checkpoint sync operation
 */
export interface CheckpointOptions {
  /** Checkpoint commit message */
  message?: string;
  /** Squash execution commits into single commit (default: true) */
  squash?: boolean;
  /** Automatically add to merge queue (default: true) */
  autoEnqueue?: boolean;
  /** Who is performing the checkpoint */
  checkpointedBy?: string;
}

/**
 * Checkpoint information
 */
export interface CheckpointInfo {
  /** Checkpoint ID */
  id: string;
  /** Issue ID this checkpoint belongs to */
  issueId: string;
  /** Execution ID that created this checkpoint */
  executionId: string;
  /** Commit SHA of the checkpoint */
  commit: string;
  /** Number of files changed */
  changedFiles: number;
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** Checkpoint message */
  message: string;
  /** When checkpoint was created (ISO 8601) */
  checkpointedAt: string;
  /** Who created the checkpoint */
  checkpointedBy?: string;
}

/**
 * Result of checkpoint sync operation
 */
export interface CheckpointResult {
  /** Whether checkpoint succeeded */
  success: boolean;
  /** Checkpoint information (if successful) */
  checkpoint?: CheckpointInfo;
  /** Issue stream information */
  issueStream?: {
    /** Stream ID */
    id: string;
    /** Branch name */
    branch: string;
    /** Whether stream was created (vs already existed) */
    created: boolean;
  };
  /** Queue entry if auto-enqueued */
  queueEntry?: QueueEntry;
  /** Conflicts if any were detected */
  conflicts?: ConflictInfo[];
  /** Error message if failed */
  error?: string;
}
