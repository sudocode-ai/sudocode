/**
 * Dataplane Adapter
 *
 * Integration layer between sudocode services and the dataplane library.
 * Provides high-level operations for stream management, worktrees,
 * sync operations, and conflict resolution.
 *
 * @module services/dataplane-adapter
 */

import * as path from 'path';
import * as fs from 'fs';
import type Database from 'better-sqlite3';
import type { AgentType } from '@sudocode-ai/types';
import { mergeThreeWay, type JSONLEntity } from '@sudocode-ai/cli/dist/merge-resolver.js';
import { readJSONLSync } from '@sudocode-ai/cli/dist/jsonl.js';
import {
  getIncomingRelationships,
  getOutgoingRelationships,
} from '@sudocode-ai/cli/dist/operations/relationships.js';
import {
  type DataplaneConfig,
  getDataplaneConfig,
  isDataplaneEnabled,
} from './dataplane-config.js';
import type {
  SudocodeStreamMetadata,
  IssueCheckpointMetadata,
  IssueStreamInfo,
  ExecutionStreamResult,
  WorktreeInfo,
  ChangeSet,
  FileChange,
  FileDiff,
  CommitParams,
  CommitResult,
  SyncPreview,
  SyncConflict,
  SyncCommit,
  SyncOptions,
  SyncResult,
  ConflictStrategy,
  ConflictInfo,
  ReconcileResult,
  HealthReport,
  CascadeReport,
  CascadeStreamResult,
  QueueEntry,
  ReorderResult,
  MergeResult,
  CheckpointOptions,
  CheckpointInfo,
  CheckpointResult,
  PromoteOptions,
  PromoteResult,
} from './dataplane-types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dataplane Types (inline definitions until dataplane package is available)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for creating a DataplaneTracker instance
 */
interface DataplaneTrackerOptions {
  /** Path to the git repository */
  repoPath: string;
  /** Path to SQLite database file (legacy - ignored if db is provided) */
  dbPath?: string;
  /** Existing database connection (for shared database) */
  db?: import('better-sqlite3').Database;
  /** Table name prefix for dataplane tables (default: no prefix) */
  tablePrefix?: string;
  /** Skip startup recovery (default: false) */
  skipRecovery?: boolean;
}

interface DataplaneTracker {
  db: import('better-sqlite3').Database;
  repoPath: string;
  createStream(options: {
    name: string;
    agentId: string;
    metadata?: Record<string, unknown>;
    existingBranch?: string;
    createBranch?: boolean;
  }): string;
  getStream(streamId: string): DataplaneStream | null;
  listStreams(options?: { agentId?: string; status?: string }): DataplaneStream[];
  getStreamBranchName(streamId: string): string;
  getStreamHead(streamId: string): string | null;
  abandonStream(streamId: string, reason: string): void;
  createWorktree(options: { agentId: string; path: string; branch?: string }): void;
  getWorktree(agentId: string): DataplaneWorktree | null;
  updateWorktreeStream(agentId: string, streamId: string): void;
  deallocateWorktree(agentId: string): void;
  commitChanges(options: {
    streamId: string;
    message: string;
    agentId: string;
    worktree: string;
  }): { commitHash: string };
  checkStreamSync(streamId: string): StreamSyncStatus;
  checkAllStreamsSync(options?: { streamIds?: string[] }): AllStreamsSyncResult;
  reconcile(options?: {
    streamIds?: string[];
    updateDatabase?: boolean;
    createMissingBranches?: boolean;
  }): ReconcileOperationResult;
  ensureStreamInSync(streamId: string, options?: { force?: boolean }): void;
  addToMergeQueue(options: {
    streamId: string;
    agentId: string;
    targetBranch?: string;
    priority?: number;
    metadata?: Record<string, unknown>;
  }): string;
  getMergeQueue(options?: {
    targetBranch?: string;
    status?: string | string[];
  }): DataplaneMergeQueueEntry[];
  getMergeQueueEntry(entryId: string): DataplaneMergeQueueEntry | null;
  markMergeQueueReady(entryId: string): void;
  cancelMergeQueueEntry(entryId: string): void;
  removeFromMergeQueue(entryId: string): void;
  getNextToMerge(targetBranch?: string): DataplaneMergeQueueEntry | null;
  getMergeQueuePosition(streamId: string, targetBranch?: string): number | null;
  processMergeQueue(options: {
    agentId: string;
    worktree: string;
    targetBranch?: string;
    limit?: number;
    strategy?: string;
  }): ProcessQueueResult;
  // Dependency methods
  addDependency(streamId: string, dependsOnId: string): void;
  removeDependency(streamId: string, dependsOnId: string): void;
  getDependencies(streamId: string): string[];
  getDependents(streamId: string): string[];
  // Rebase methods
  syncWithParent(
    streamId: string,
    agentId: string,
    worktree: string,
    onConflict?: 'abort' | 'defer' | 'ours' | 'theirs'
  ): DataplaneRebaseResult;
  close(): void;
}

interface DataplaneRebaseResult {
  success: boolean;
  newHead?: string;
  conflicts?: Array<{ path: string; type: string }>;
  error?: string;
}

interface DataplaneStream {
  id: string;
  name: string;
  agentId: string;
  baseCommit: string;
  parentStream: string | null;
  status: string;
  isLocalMode: boolean;
  existingBranch: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface DataplaneWorktree {
  agentId: string;
  path: string;
  branch: string;
  createdAt: number;
  lastActive: number;
}

interface StreamSyncStatus {
  streamId: string;
  name: string;
  inSync: boolean;
  expectedHead?: string;
  actualHead: string | null;
  discrepancy?: string;
}

interface AllStreamsSyncResult {
  allInSync: boolean;
  streams: StreamSyncStatus[];
  synced: string[];
  diverged: string[];
  missing: string[];
}

interface ReconcileOperationResult {
  updated: string[];
  branchesCreated: string[];
  failed: Array<{ streamId: string; error: string }>;
}

interface DataplaneMergeQueueEntry {
  id: string;
  streamId: string;
  targetBranch: string;
  priority: number;
  status: string;
  addedBy: string;
  addedAt: number;
  updatedAt: number;
  position?: number;
  error?: string;
  mergeCommit?: string;
  metadata: Record<string, unknown>;
}

interface ProcessQueueResult {
  merged: Array<{ entryId: string; streamId: string; mergeCommit: string }>;
  failed: Array<{ entryId: string; streamId: string; error: string }>;
  skipped: string[];
}

// Helper to safely cast metadata
function getSudocodeMetadata(
  metadata: Record<string, unknown>
): SudocodeStreamMetadata['sudocode'] | null {
  const sudocode = metadata?.sudocode as SudocodeStreamMetadata['sudocode'] | undefined;
  if (sudocode && typeof sudocode === 'object' && 'type' in sudocode) {
    return sudocode;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DataplaneAdapter Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adapter for dataplane operations in sudocode
 */
export class DataplaneAdapter {
  private tracker: DataplaneTracker | null = null;
  private config: DataplaneConfig;
  private repoPath: string;
  private initialized = false;
  private externalDb: Database.Database | null = null;

  constructor(repoPath: string, config?: DataplaneConfig, db?: Database.Database) {
    this.repoPath = repoPath;
    this.config = config || getDataplaneConfig(repoPath);
    this.externalDb = db || null;
  }

  /**
   * Check if dataplane is enabled in configuration
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if the adapter is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Initialize the dataplane tracker
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.config.enabled) {
      throw new Error('Dataplane is not enabled in configuration');
    }

    try {
      // Dynamic import of dataplane - may not be installed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataplane = await import('dataplane' as any) as {
        MultiAgentRepoTracker: new (opts: DataplaneTrackerOptions) => DataplaneTracker
      };

      if (this.externalDb) {
        // Use shared database with table prefix (preferred)
        // Use nullish coalescing (??) to preserve empty string as valid value
        const tablePrefix = this.config.tablePrefix ?? 'dp_';
        this.tracker = new dataplane.MultiAgentRepoTracker({
          repoPath: this.repoPath,
          db: this.externalDb,
          tablePrefix,
          skipRecovery: !this.config.recovery.runOnStartup,
        });
        console.log(`[DataplaneAdapter] Initialized with shared database (prefix: ${tablePrefix})`);
      } else {
        // Legacy: separate database file (backward compatibility)
        const dbPath = path.join(this.repoPath, '.sudocode', this.config.dbPath);

        // Ensure directory exists
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }

        this.tracker = new dataplane.MultiAgentRepoTracker({
          repoPath: this.repoPath,
          dbPath,
          skipRecovery: !this.config.recovery.runOnStartup,
        });
        console.log(`[DataplaneAdapter] Initialized with separate database: ${dbPath}`);
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize dataplane: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Ensure tracker is initialized
   */
  private ensureInitialized(): DataplaneTracker {
    if (!this.tracker) {
      throw new Error('DataplaneAdapter not initialized. Call initialize() first.');
    }
    return this.tracker;
  }

  /**
   * Close the adapter and release resources
   */
  close(): void {
    if (this.tracker) {
      this.tracker.close();
      this.tracker = null;
      this.initialized = false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stream Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Ensure an issue has an associated stream
   *
   * For stacked issues (those with dependencies), the stream branches from
   * the parent issue stream rather than main. This enables the checkpoint
   * workflow where work builds on top of earlier issue checkpoints.
   *
   * @param issueId - Issue ID to create/get stream for
   * @param agentId - Agent ID creating the stream
   * @param db - Optional database for dependency lookup
   * @returns Stream ID
   */
  async ensureIssueStream(
    issueId: string,
    agentId: string,
    db?: Database.Database
  ): Promise<string> {
    const tracker = this.ensureInitialized();

    // Check if stream already exists for this issue
    const streams = tracker.listStreams();
    const existingStream = streams.find((s) => {
      const meta = getSudocodeMetadata(s.metadata);
      return meta?.type === 'issue' && meta?.issue_id === issueId;
    });

    if (existingStream) {
      return existingStream.id;
    }

    // Determine parent stream from issue dependencies if db provided
    let parentStreamId: string | undefined;

    if (db) {
      // Check for blocking issues (issues that block this one)
      const blockedBy = getIncomingRelationships(db, issueId, 'issue', 'blocks');
      // Check for depends-on relationships
      const dependsOn = getOutgoingRelationships(db, issueId, 'issue', 'depends-on');

      // Combine both types of dependencies
      const dependencies = [
        ...blockedBy.map((rel) => rel.from_id),
        ...dependsOn.map((rel) => rel.to_id),
      ];

      // Find the first dependency that has an issue stream
      for (const depIssueId of dependencies) {
        const depStream = this.getStreamByIssueId(depIssueId);
        if (depStream) {
          parentStreamId = depStream.id;
          break;
        }
      }
    }

    // Create metadata with checkpoint tracking
    const checkpointMeta: IssueCheckpointMetadata = {
      checkpoint_count: 0,
      review_status: 'none',
    };

    const metadata: SudocodeStreamMetadata = {
      sudocode: {
        type: 'issue',
        issue_id: issueId,
        checkpoint: checkpointMeta,
      },
    };

    // Create new stream for issue
    // If parent stream exists, this creates a fork from that stream
    const streamId = tracker.createStream({
      name: `issue-${issueId}`,
      agentId,
      metadata: metadata as unknown as Record<string, unknown>,
    });

    // Add dependency to parent stream if exists
    if (parentStreamId) {
      try {
        tracker.addDependency(streamId, parentStreamId);
      } catch (error) {
        // Log but don't fail - dependency may already exist or would create cycle
        console.warn(
          `Failed to add dependency ${streamId} → ${parentStreamId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return streamId;
  }

  /**
   * Get information about an issue-level stream
   *
   * @param issueId - Issue ID to get stream info for
   * @returns Issue stream info or null if not found
   */
  getIssueStreamInfo(issueId: string): IssueStreamInfo | null {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByIssueId(issueId);

    if (!stream) {
      return null;
    }

    const meta = getSudocodeMetadata(stream.metadata);
    const checkpointMeta = meta?.checkpoint;
    const branchName = tracker.getStreamBranchName(stream.id);
    const currentHead = tracker.getStreamHead(stream.id);

    // Get parent stream info from dependencies
    const dependencies = tracker.getDependencies(stream.id);
    let parentStreamId: string | undefined;
    let parentIssueId: string | undefined;

    for (const depId of dependencies) {
      const depStream = tracker.getStream(depId);
      if (depStream) {
        const depMeta = getSudocodeMetadata(depStream.metadata);
        if (depMeta?.type === 'issue') {
          parentStreamId = depStream.id;
          parentIssueId = depMeta.issue_id;
          break;
        }
      }
    }

    return {
      streamId: stream.id,
      branchName,
      issueId,
      baseCommit: stream.baseCommit,
      currentHead,
      checkpointCount: checkpointMeta?.checkpoint_count || 0,
      currentCheckpoint: checkpointMeta?.current_checkpoint
        ? {
            executionId: checkpointMeta.current_checkpoint.execution_id,
            commit: checkpointMeta.current_checkpoint.commit,
            checkpointedAt: checkpointMeta.current_checkpoint.checkpointed_at,
          }
        : undefined,
      reviewStatus: checkpointMeta?.review_status || 'none',
      parentStreamId,
      parentIssueId,
      createdAt: stream.createdAt,
    };
  }

  /**
   * Update issue stream metadata after a checkpoint operation
   *
   * @param issueId - Issue ID whose stream to update
   * @param checkpoint - Checkpoint information
   */
  updateIssueStreamCheckpoint(
    issueId: string,
    checkpoint: {
      executionId: string;
      commit: string;
      checkpointedAt: string;
    }
  ): void {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByIssueId(issueId);

    if (!stream) {
      throw new Error(`Issue stream not found: ${issueId}`);
    }

    // Get existing metadata
    const existingMeta = getSudocodeMetadata(stream.metadata);
    const existingCheckpoint = existingMeta?.checkpoint;

    // Update checkpoint metadata
    const newCheckpointMeta: IssueCheckpointMetadata = {
      checkpoint_count: (existingCheckpoint?.checkpoint_count || 0) + 1,
      current_checkpoint: {
        execution_id: checkpoint.executionId,
        commit: checkpoint.commit,
        checkpointed_at: checkpoint.checkpointedAt,
      },
      review_status: 'pending', // New checkpoint sets status to pending
    };

    // Update stream metadata in database
    // Note: This updates the metadata field in the dataplane streams table
    const updateStmt = tracker.db.prepare(`
      UPDATE streams SET metadata = json_set(metadata, '$.sudocode.checkpoint', json(?))
      WHERE id = ?
    `);
    updateStmt.run(JSON.stringify(newCheckpointMeta), stream.id);
  }

  /**
   * Update issue stream review status
   *
   * @param issueId - Issue ID whose stream to update
   * @param status - New review status
   */
  updateIssueStreamReviewStatus(
    issueId: string,
    status: 'none' | 'pending' | 'approved' | 'changes_requested'
  ): void {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByIssueId(issueId);

    if (!stream) {
      throw new Error(`Issue stream not found: ${issueId}`);
    }

    // Update review status in metadata
    const updateStmt = tracker.db.prepare(`
      UPDATE streams SET metadata = json_set(metadata, '$.sudocode.checkpoint.review_status', ?)
      WHERE id = ?
    `);
    updateStmt.run(JSON.stringify(status), stream.id);
  }

  /**
   * Create a stream for an execution
   */
  async createExecutionStream(params: {
    executionId: string;
    issueId?: string;
    agentType: AgentType;
    targetBranch: string;
    mode: 'worktree' | 'local';
    agentId: string;
  }): Promise<ExecutionStreamResult> {
    const tracker = this.ensureInitialized();

    const metadata = {
      sudocode: {
        type: 'execution' as const,
        issue_id: params.issueId || 'standalone',
        execution_id: params.executionId,
        agent_type: params.agentType,
        target_branch: params.targetBranch,
      },
    };

    let streamId: string;
    let isLocalMode = false;

    if (params.mode === 'local') {
      // Local mode - track existing branch without creating new one
      streamId = tracker.createStream({
        name: `exec-${params.executionId}`,
        agentId: params.agentId,
        metadata,
        existingBranch: params.targetBranch,
        createBranch: false,
      });
      isLocalMode = true;
    } else {
      // Worktree mode - create new stream branch
      streamId = tracker.createStream({
        name: `exec-${params.executionId}`,
        agentId: params.agentId,
        metadata,
      });
    }

    const stream = tracker.getStream(streamId);
    const branchName = tracker.getStreamBranchName(streamId);

    return {
      streamId,
      branchName,
      isLocalMode,
      baseCommit: stream?.baseCommit || '',
    };
  }

  /**
   * Create a follow-up execution stream
   */
  async createFollowUpStream(params: {
    parentExecutionId: string;
    executionId: string;
    reuseWorktree: boolean;
    agentId: string;
  }): Promise<ExecutionStreamResult> {
    const tracker = this.ensureInitialized();

    // Find parent stream
    const streams = tracker.listStreams();
    const parentStream = streams.find((s) => {
      const meta = getSudocodeMetadata(s.metadata);
      return meta?.execution_id === params.parentExecutionId;
    });

    if (!parentStream) {
      throw new Error(`Parent execution stream not found: ${params.parentExecutionId}`);
    }

    const parentMeta = getSudocodeMetadata(parentStream.metadata);

    if (params.reuseWorktree) {
      // Reuse same stream - return existing info
      return {
        streamId: parentStream.id,
        branchName: tracker.getStreamBranchName(parentStream.id),
        isLocalMode: parentStream.isLocalMode,
        baseCommit: tracker.getStreamHead(parentStream.id) || parentStream.baseCommit,
      };
    } else {
      // Create new stream forked from parent
      const metadata = {
        sudocode: {
          type: 'execution' as const,
          issue_id: parentMeta?.issue_id || 'standalone',
          execution_id: params.executionId,
          agent_type: parentMeta?.agent_type,
          target_branch: parentMeta?.target_branch,
          parent_execution_id: params.parentExecutionId,
        },
      };

      const streamId = tracker.createStream({
        name: `exec-${params.executionId}`,
        agentId: params.agentId,
        metadata,
      });

      const stream = tracker.getStream(streamId);

      return {
        streamId,
        branchName: tracker.getStreamBranchName(streamId),
        isLocalMode: false,
        baseCommit: stream?.baseCommit || '',
      };
    }
  }

  /**
   * Get stream info by execution ID
   */
  getStreamByExecutionId(executionId: string): DataplaneStream | null {
    const tracker = this.ensureInitialized();
    const streams = tracker.listStreams();
    return streams.find((s) => {
      const meta = getSudocodeMetadata(s.metadata);
      return meta?.execution_id === executionId;
    }) || null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Worktree Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get or create a worktree for a stream
   */
  async getOrCreateWorktree(
    streamId: string,
    agentId: string,
    basePath?: string
  ): Promise<WorktreeInfo> {
    const tracker = this.ensureInitialized();

    // Check if worktree already exists for this agent
    const existing = tracker.getWorktree(agentId);
    if (existing) {
      // Update to use the requested stream
      tracker.updateWorktreeStream(agentId, streamId);
      return {
        path: existing.path,
        streamId,
        branch: tracker.getStreamBranchName(streamId),
        agentId,
        created: false,
      };
    }

    // Create new worktree
    const worktreePath = basePath || path.join(
      this.repoPath,
      '.sudocode',
      'worktrees',
      agentId
    );

    // Ensure parent directory exists
    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const branchName = tracker.getStreamBranchName(streamId);
    tracker.createWorktree({
      agentId,
      path: worktreePath,
      branch: branchName,
    });

    // Associate with stream
    tracker.updateWorktreeStream(agentId, streamId);

    return {
      path: worktreePath,
      streamId,
      branch: branchName,
      agentId,
      created: true,
    };
  }

  /**
   * Cleanup a worktree
   */
  async cleanupWorktree(agentId: string): Promise<void> {
    const tracker = this.ensureInitialized();
    tracker.deallocateWorktree(agentId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Change Tracking
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get changes for an execution
   */
  async getChanges(executionId: string): Promise<ChangeSet> {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByExecutionId(executionId);

    if (!stream) {
      return {
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        totalFiles: 0,
        commitRange: { before: '', after: '' },
      };
    }

    const currentHead = tracker.getStreamHead(stream.id);
    const baseCommit = stream.baseCommit;

    if (!currentHead || currentHead === baseCommit) {
      return {
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        totalFiles: 0,
        commitRange: { before: baseCommit, after: currentHead || baseCommit },
      };
    }

    // Use git diff to get changes
    const { execSync } = await import('child_process');
    try {
      const diffOutput = execSync(
        `git diff --stat ${baseCommit}..${currentHead}`,
        { cwd: this.repoPath, encoding: 'utf-8' }
      );

      const files: FileChange[] = [];
      let totalAdditions = 0;
      let totalDeletions = 0;

      // Parse diff stat output
      const lines = diffOutput.trim().split('\n');
      for (const line of lines.slice(0, -1)) {
        // Skip summary line
        const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+-]+)?$/);
        if (match) {
          const [, filePath, , changes] = match;
          const additions = (changes?.match(/\+/g) || []).length;
          const deletions = (changes?.match(/-/g) || []).length;

          files.push({
            path: filePath.trim(),
            status: 'modified',
            additions,
            deletions,
          });
          totalAdditions += additions;
          totalDeletions += deletions;
        }
      }

      return {
        files,
        totalAdditions,
        totalDeletions,
        totalFiles: files.length,
        commitRange: { before: baseCommit, after: currentHead },
      };
    } catch {
      return {
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        totalFiles: 0,
        commitRange: { before: baseCommit, after: currentHead },
      };
    }
  }

  /**
   * Get diff for a specific file
   */
  async getFileDiff(executionId: string, filePath: string): Promise<FileDiff> {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByExecutionId(executionId);

    if (!stream) {
      return { path: filePath, diff: '', isBinary: false };
    }

    const currentHead = tracker.getStreamHead(stream.id);
    const baseCommit = stream.baseCommit;

    if (!currentHead) {
      return { path: filePath, diff: '', isBinary: false };
    }

    const { execSync } = await import('child_process');
    try {
      const diff = execSync(
        `git diff ${baseCommit}..${currentHead} -- "${filePath}"`,
        { cwd: this.repoPath, encoding: 'utf-8' }
      );

      return {
        path: filePath,
        diff,
        isBinary: diff.includes('Binary files'),
      };
    } catch {
      return { path: filePath, diff: '', isBinary: false };
    }
  }

  /**
   * Commit changes on a stream
   */
  async commitChanges(params: CommitParams): Promise<CommitResult> {
    const tracker = this.ensureInitialized();

    try {
      if (params.stageAll) {
        const { execSync } = await import('child_process');
        execSync('git add -A', { cwd: params.worktree });
      }

      const result = tracker.commitChanges({
        streamId: params.streamId,
        message: params.message,
        agentId: params.agentId,
        worktree: params.worktree,
      });

      return {
        success: true,
        commitHash: result.commitHash,
        filesChanged: 0, // TODO: get actual count
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        filesChanged: 0,
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sync Operations
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Preview sync operation
   */
  async previewSync(executionId: string): Promise<SyncPreview> {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByExecutionId(executionId);

    if (!stream) {
      return {
        canSync: false,
        conflicts: [],
        hasJsonlConflicts: false,
        hasCodeConflicts: false,
        diff: {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          totalFiles: 0,
          commitRange: { before: '', after: '' },
        },
        commits: [],
        mergeBase: '',
        warnings: ['Execution stream not found'],
      };
    }

    const meta = getSudocodeMetadata(stream.metadata);
    const targetBranch = meta?.target_branch || 'main';
    const currentHead = tracker.getStreamHead(stream.id);

    // Get merge base
    const { execSync } = await import('child_process');
    let mergeBase = '';
    try {
      mergeBase = execSync(
        `git merge-base ${targetBranch} ${currentHead}`,
        { cwd: this.repoPath, encoding: 'utf-8' }
      ).trim();
    } catch {
      return {
        canSync: false,
        conflicts: [],
        hasJsonlConflicts: false,
        hasCodeConflicts: false,
        diff: {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          totalFiles: 0,
          commitRange: { before: '', after: '' },
        },
        commits: [],
        mergeBase: '',
        warnings: ['Cannot find merge base with target branch'],
      };
    }

    // Get commits
    const commits: SyncCommit[] = [];
    try {
      const logOutput = execSync(
        `git log --format="%H|%s|%an|%at" ${mergeBase}..${currentHead}`,
        { cwd: this.repoPath, encoding: 'utf-8' }
      );

      for (const line of logOutput.trim().split('\n')) {
        if (!line) continue;
        const [hash, message, author, timestamp] = line.split('|');
        commits.push({
          hash,
          message,
          author,
          timestamp: parseInt(timestamp, 10) * 1000,
        });
      }
    } catch {
      // Continue with empty commits
    }

    // Check for conflicts (simplified)
    const conflicts: SyncConflict[] = [];

    const hasJsonlConflicts = conflicts.some((c) => c.type === 'jsonl');
    const hasCodeConflicts = conflicts.some((c) => c.type === 'code' && !c.autoResolvable);

    // Get changes
    const diff = await this.getChanges(executionId);

    return {
      canSync: !hasCodeConflicts,
      conflicts,
      hasJsonlConflicts,
      hasCodeConflicts,
      diff,
      commits,
      mergeBase,
      warnings: [],
    };
  }

  /**
   * Squash sync - combines all commits into one
   */
  async squashSync(_executionId: string, _options: SyncOptions): Promise<SyncResult> {
    // Implementation would integrate with existing WorktreeSyncService
    return {
      success: false,
      error: 'squashSync not yet integrated - use WorktreeSyncService directly',
      filesChanged: 0,
    };
  }

  /**
   * Preserve sync - keeps commit history
   */
  async preserveSync(_executionId: string, _options: SyncOptions): Promise<SyncResult> {
    return {
      success: false,
      error: 'preserveSync not yet integrated - use WorktreeSyncService directly',
      filesChanged: 0,
    };
  }

  /**
   * Stage sync - stage changes without committing
   */
  async stageSync(_executionId: string): Promise<void> {
    throw new Error('stageSync not yet integrated - use WorktreeSyncService directly');
  }

  /**
   * Checkpoint sync - merge execution changes to issue stream for review
   *
   * This is the core operation for the stacked diffs workflow. It:
   * 1. Validates execution has changes
   * 2. Ensures issue stream exists
   * 3. Optionally squashes execution commits
   * 4. Merges execution onto issue stream
   * 5. Creates checkpoint record
   * 6. Updates issue stream metadata
   * 7. Optionally enqueues for main merge
   *
   * @param executionId - Execution ID to checkpoint
   * @param db - Sudocode database connection (for checkpoint record creation)
   * @param options - Checkpoint options
   * @returns Checkpoint result
   */
  async checkpointSync(
    executionId: string,
    db: Database.Database,
    options: CheckpointOptions = {}
  ): Promise<CheckpointResult> {
    const tracker = this.ensureInitialized();

    // Set defaults
    const squash = options.squash ?? true;
    const autoEnqueue = options.autoEnqueue ?? true;

    // 1. Get execution stream
    const execStream = this.getStreamByExecutionId(executionId);
    if (!execStream) {
      return {
        success: false,
        error: `Execution stream not found: ${executionId}`,
      };
    }

    // 2. Get execution's issue ID from stream metadata
    const execMeta = getSudocodeMetadata(execStream.metadata);
    const issueId = execMeta?.issue_id;
    if (!issueId || issueId === 'standalone') {
      return {
        success: false,
        error: 'Execution has no associated issue',
      };
    }

    // 3. Get execution changes - first try execution's before/after commits from DB
    // This handles workflow executions where commits are made outside dataplane's control
    const execution = db.prepare('SELECT before_commit, after_commit FROM executions WHERE id = ?').get(executionId) as {
      before_commit: string | null;
      after_commit: string | null;
    } | undefined;

    // Determine if we have changes to checkpoint
    const hasExecutionCommits = execution?.before_commit && execution?.after_commit &&
      execution.before_commit !== execution.after_commit;

    // Get changes for checkpoint stats - use execution commits if available
    let changes = await this.getChanges(executionId);

    // If dataplane didn't detect changes but execution has commits, calculate from git
    if (changes.totalFiles === 0 && hasExecutionCommits) {
      const { execSync } = await import('child_process');
      try {
        const diffOutput = execSync(
          `git diff --stat ${execution!.before_commit}..${execution!.after_commit}`,
          { cwd: options.worktreePath || this.repoPath, encoding: 'utf-8' }
        );

        // Parse diff stat for file count and lines
        const lines = diffOutput.trim().split('\n');
        const summaryLine = lines[lines.length - 1];
        const filesMatch = summaryLine.match(/(\d+) files? changed/);
        const insertionsMatch = summaryLine.match(/(\d+) insertions?/);
        const deletionsMatch = summaryLine.match(/(\d+) deletions?/);

        changes = {
          files: [], // We don't need detailed file list for checkpoint
          totalFiles: filesMatch ? parseInt(filesMatch[1], 10) : 0,
          totalAdditions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
          totalDeletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
          commitRange: {
            before: execution!.before_commit!,
            after: execution!.after_commit!,
          },
        };
      } catch {
        // If git diff fails, estimate with 1 file changed
        changes = {
          files: [],
          totalFiles: 1,
          totalAdditions: 0,
          totalDeletions: 0,
          commitRange: {
            before: execution!.before_commit!,
            after: execution!.after_commit!,
          },
        };
      }
    }

    if (changes.totalFiles === 0 && !hasExecutionCommits) {
      return {
        success: false,
        error: 'Execution has no changes to checkpoint',
      };
    }

    // 4. Ensure issue stream exists
    const issueStreamId = await this.ensureIssueStream(issueId, execStream.agentId, db);
    const issueStream = tracker.getStream(issueStreamId);
    if (!issueStream) {
      return {
        success: false,
        error: 'Failed to create issue stream',
      };
    }

    const issueStreamBranch = tracker.getStreamBranchName(issueStreamId);
    const issueStreamCreated = issueStream.createdAt > Date.now() - 1000; // Just created

    // 5. Get worktree for merge operations
    // Use explicit worktreePath option if provided (for workflow-managed worktrees)
    // Otherwise, try to get from dataplane's worktree registry
    let worktreePath: string;
    if (options.worktreePath) {
      worktreePath = options.worktreePath;
    } else {
      const worktree = tracker.getWorktree(execStream.agentId);
      if (!worktree) {
        return {
          success: false,
          error: 'No worktree available for checkpoint operation. Provide worktreePath option for workflow executions.',
        };
      }
      worktreePath = worktree.path;
    }

    const { execSync } = await import('child_process');
    const execBranch = tracker.getStreamBranchName(execStream.id);

    try {
      // 6. Check for conflicts before merge
      const mergeBase = execSync(
        `git merge-base ${issueStreamBranch} ${execBranch}`,
        { cwd: worktreePath, encoding: 'utf-8' }
      ).trim();

      // Check if there would be conflicts
      try {
        execSync(`git merge-tree ${mergeBase} ${issueStreamBranch} ${execBranch}`, {
          cwd: worktreePath,
          encoding: 'utf-8',
        });
      } catch {
        // merge-tree returns non-zero if there are conflicts
        return {
          success: false,
          error: 'Merge conflicts detected',
          conflicts: [], // TODO: parse conflict files
          issueStream: {
            id: issueStreamId,
            branch: issueStreamBranch,
            created: issueStreamCreated,
          },
        };
      }

      // 7. Perform merge (checkout issue stream, merge exec stream)
      // First, fetch the issue stream branch if it doesn't exist locally
      execSync(`git checkout ${issueStreamBranch}`, {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Determine commit message
      const message =
        options.message ||
        `Checkpoint: ${issueId} from execution ${executionId}`;

      let mergeCommit: string;

      if (squash) {
        // Squash merge
        execSync(`git merge --squash ${execBranch}`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        execSync(`git commit -m "${message}"`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } else {
        // Regular merge with commit
        execSync(`git merge ${execBranch} -m "${message}"`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      }

      // Get the new HEAD
      mergeCommit = execSync('git rev-parse HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      // 8. Create checkpoint record in database
      const checkpointId = `cp-${Date.now().toString(36)}`;
      const checkpointedAt = new Date().toISOString();
      // Get target branch from options, stream metadata, or default to 'main'
      const targetBranch = options.targetBranch || execMeta?.target_branch || 'main';

      const insertStmt = db.prepare(`
        INSERT INTO checkpoints (
          id, issue_id, execution_id, stream_id, commit_sha, parent_commit,
          changed_files, additions, deletions, message, checkpointed_at,
          checkpointed_by, review_status, target_branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `);

      insertStmt.run(
        checkpointId,
        issueId,
        executionId,
        issueStreamId,
        mergeCommit,
        changes.commitRange.before,
        changes.totalFiles,
        changes.totalAdditions,
        changes.totalDeletions,
        message,
        checkpointedAt,
        options.checkpointedBy || null,
        targetBranch
      );

      // 9. Update issue stream metadata
      this.updateIssueStreamCheckpoint(issueId, {
        executionId,
        commit: mergeCommit,
        checkpointedAt,
      });

      // 10. Auto-enqueue to merge queue if enabled
      let queueEntry: QueueEntry | undefined;
      if (autoEnqueue && this.config.mergeQueue.enabled) {
        try {
          queueEntry = await this.enqueue({
            executionId,
            targetBranch: execMeta?.target_branch || 'main',
            agentId: execStream.agentId,
          });
        } catch (error) {
          // Log but don't fail - checkpoint succeeded
          console.warn(
            `Failed to enqueue checkpoint: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // 11. Return result
      const checkpoint: CheckpointInfo = {
        id: checkpointId,
        issueId,
        executionId,
        commit: mergeCommit,
        changedFiles: changes.totalFiles,
        additions: changes.totalAdditions,
        deletions: changes.totalDeletions,
        message,
        checkpointedAt,
        checkpointedBy: options.checkpointedBy,
      };

      return {
        success: true,
        checkpoint,
        issueStream: {
          id: issueStreamId,
          branch: issueStreamBranch,
          created: issueStreamCreated,
        },
        queueEntry,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        issueStream: {
          id: issueStreamId,
          branch: issueStreamBranch,
          created: issueStreamCreated,
        },
      };
    }
  }

  /**
   * Promote sync - merge issue stream to main branch
   *
   * This is the second tier of the two-tier merge model. After checkpoints
   * are approved, this merges the issue stream into the target branch (main).
   *
   * Flow:
   * 1. Validate issue has checkpoint(s)
   * 2. Verify checkpoint is approved (unless force)
   * 3. Check dependencies are merged first
   * 4. Perform merge to target branch
   * 5. Update checkpoint status to 'merged'
   * 6. Trigger cascade rebase for dependents
   *
   * @param issueId - Issue ID to promote
   * @param db - Sudocode database connection
   * @param options - Promote options
   * @returns Promote result
   */
  async promoteSync(
    issueId: string,
    db: Database.Database,
    options: PromoteOptions = {}
  ): Promise<PromoteResult> {
    const tracker = this.ensureInitialized();

    // Set defaults
    const strategy = options.strategy || 'squash';
    const force = options.force || false;

    // 1. Get issue stream
    const issueStream = this.getStreamByIssueId(issueId);
    if (!issueStream) {
      return {
        success: false,
        error: `Issue stream not found: ${issueId}`,
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      };
    }

    const issueStreamBranch = tracker.getStreamBranchName(issueStream.id);

    // 2. Check for checkpoint (must have at least one checkpoint to promote)
    const checkpoint = db.prepare(`
      SELECT * FROM checkpoints
      WHERE issue_id = ?
      ORDER BY checkpointed_at DESC
      LIMIT 1
    `).get(issueId) as {
      id: string;
      execution_id: string;
      review_status: string;
      commit_sha: string;
      changed_files: number;
      additions: number;
      deletions: number;
    } | undefined;

    if (!checkpoint) {
      return {
        success: false,
        error: 'No checkpoint found for this issue. Create a checkpoint first.',
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        issueStream: {
          id: issueStream.id,
          branch: issueStreamBranch,
        },
      };
    }

    // 2b. Resolve target branch from execution stream metadata
    // Priority: explicit option > execution's configured base branch > 'main'
    let targetBranch = options.targetBranch || 'main';
    const execStream = this.getStreamByExecutionId(checkpoint.execution_id);
    if (execStream) {
      const execMeta = getSudocodeMetadata(execStream.metadata);
      if (execMeta?.target_branch) {
        targetBranch = options.targetBranch || execMeta.target_branch;
      }
    }

    // 3. Check approval status (unless force)
    if (!force && checkpoint.review_status !== 'approved') {
      return {
        success: false,
        error: `Checkpoint is not approved (status: ${checkpoint.review_status}). Approve the checkpoint or use force flag.`,
        requiresApproval: true,
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        issueStream: {
          id: issueStream.id,
          branch: issueStreamBranch,
        },
      };
    }

    // 4. Check for blocking dependencies that haven't been merged
    const blockedByIssues = this.getUnmergedBlockingIssues(issueId, db);
    if (blockedByIssues.length > 0) {
      return {
        success: false,
        error: `Cannot promote: blocked by unmerged issues: ${blockedByIssues.join(', ')}`,
        blockedBy: blockedByIssues,
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        issueStream: {
          id: issueStream.id,
          branch: issueStreamBranch,
        },
      };
    }

    // 5. Get worktree or create temporary one for merge
    let worktreePath = '';
    const existingWorktree = tracker.getWorktree(issueStream.agentId);

    if (existingWorktree) {
      worktreePath = existingWorktree.path;
    } else {
      // Try to find any available worktree or use main repo
      worktreePath = this.repoPath;
    }

    const { execSync } = await import('child_process');

    try {
      // 6. Check for conflicts with target branch
      const mergeBase = execSync(
        `git merge-base ${targetBranch} ${issueStreamBranch}`,
        { cwd: worktreePath, encoding: 'utf-8' }
      ).trim();

      // Check if there would be conflicts using merge-tree
      try {
        execSync(`git merge-tree ${mergeBase} ${targetBranch} ${issueStreamBranch}`, {
          cwd: worktreePath,
          encoding: 'utf-8',
        });
      } catch {
        // merge-tree returns non-zero if there are conflicts
        return {
          success: false,
          error: 'Merge conflicts detected with target branch',
          conflicts: [], // TODO: parse conflict files from merge-tree output
          filesChanged: 0,
          additions: 0,
          deletions: 0,
          issueStream: {
            id: issueStream.id,
            branch: issueStreamBranch,
          },
        };
      }

      // 7. Perform merge to target branch
      // First checkout target branch
      execSync(`git checkout ${targetBranch}`, {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Determine commit message
      const message =
        options.message ||
        `Promote: ${issueId} - checkpoint ${checkpoint.id}`;

      let mergeCommit: string;

      if (strategy === 'squash') {
        // Squash merge - combines all commits into one
        execSync(`git merge --squash ${issueStreamBranch}`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        execSync(`git commit -m "${message}"`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } else {
        // Regular merge - preserves commit history
        execSync(`git merge ${issueStreamBranch} -m "${message}"`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      }

      // Get the new HEAD
      mergeCommit = execSync('git rev-parse HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      // Get diff stats
      const diffStats = await this.getDiffStats(worktreePath, mergeBase, mergeCommit);

      // 8. Update checkpoint status to 'merged'
      const updateStmt = db.prepare(`
        UPDATE checkpoints
        SET review_status = 'merged', merged_at = ?, merge_commit = ?
        WHERE id = ?
      `);
      updateStmt.run(new Date().toISOString(), mergeCommit, checkpoint.id);

      // Update issue stream review status
      this.updateIssueStreamReviewStatus(issueId, 'none');

      // 9. Remove from merge queue if present
      try {
        const queue = tracker.getMergeQueue({ targetBranch });
        const queueEntry = queue.find((e) => e.streamId === issueStream.id);
        if (queueEntry) {
          tracker.removeFromMergeQueue(queueEntry.id);
        }
      } catch {
        // Queue operations are non-critical
      }

      // 10. Trigger cascade rebase for dependent streams
      let cascade: CascadeReport | undefined;
      if (this.config.cascadeOnMerge) {
        try {
          cascade = await this.triggerCascade(issueStream.id);
        } catch (error) {
          // Log but don't fail - promote succeeded
          console.warn(
            `Cascade rebase warning: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // 11. Return success result
      return {
        success: true,
        mergeCommit,
        filesChanged: diffStats.filesChanged,
        additions: diffStats.additions,
        deletions: diffStats.deletions,
        promotedIssues: [issueId],
        issueStream: {
          id: issueStream.id,
          branch: issueStreamBranch,
        },
        cascade,
      };
    } catch (error) {
      // Restore original branch on failure
      try {
        execSync(`git checkout -`, { cwd: worktreePath, stdio: 'pipe' });
      } catch {
        // Best effort cleanup
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        issueStream: {
          id: issueStream.id,
          branch: issueStreamBranch,
        },
      };
    }
  }

  /**
   * Get diff statistics between two commits
   */
  private async getDiffStats(
    repoPath: string,
    fromCommit: string,
    toCommit: string
  ): Promise<{ filesChanged: number; additions: number; deletions: number }> {
    const { execSync } = await import('child_process');

    try {
      const output = execSync(
        `git diff --shortstat ${fromCommit}..${toCommit}`,
        { cwd: repoPath, encoding: 'utf-8' }
      ).trim();

      // Parse output like: "3 files changed, 10 insertions(+), 5 deletions(-)"
      const filesMatch = output.match(/(\d+) files? changed/);
      const insertionsMatch = output.match(/(\d+) insertions?\(\+\)/);
      const deletionsMatch = output.match(/(\d+) deletions?\(-\)/);

      return {
        filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
        additions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
        deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
      };
    } catch {
      return { filesChanged: 0, additions: 0, deletions: 0 };
    }
  }

  /**
   * Get list of blocking issues that haven't been merged yet
   */
  private getUnmergedBlockingIssues(issueId: string, db: Database.Database): string[] {
    const unmergedIssues: string[] = [];

    // Get issues that block this one (incoming "blocks" relationships)
    const blockedBy = getIncomingRelationships(db, issueId, 'issue', 'blocks');

    // Get issues this depends on (outgoing "depends-on" relationships)
    const dependsOn = getOutgoingRelationships(db, issueId, 'issue', 'depends-on');

    // Combine all dependencies
    const allDependencies = [
      ...blockedBy.map((rel) => rel.from_id),
      ...dependsOn.map((rel) => rel.to_id),
    ];

    for (const depIssueId of allDependencies) {
      // Check if dependency has been merged (latest checkpoint has review_status = 'merged')
      const checkpoint = db.prepare(`
        SELECT review_status FROM checkpoints
        WHERE issue_id = ?
        ORDER BY checkpointed_at DESC
        LIMIT 1
      `).get(depIssueId) as { review_status: string } | undefined;

      // If no checkpoint or not merged, it's a blocker
      if (!checkpoint || checkpoint.review_status !== 'merged') {
        unmergedIssues.push(depIssueId);
      }
    }

    return unmergedIssues;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Conflict Handling
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * JSONL conflict handler for merge operations
   */
  async resolveJsonlConflict(
    basePath: string,
    oursPath: string,
    theirsPath: string
  ): Promise<{ success: boolean; resolved?: string; error?: string }> {
    try {
      const base = fs.existsSync(basePath) ? readJSONLSync(basePath) : [];
      const ours = fs.existsSync(oursPath) ? readJSONLSync(oursPath) : [];
      const theirs = fs.existsSync(theirsPath) ? readJSONLSync(theirsPath) : [];

      const result = mergeThreeWay(base as JSONLEntity[], ours as JSONLEntity[], theirs as JSONLEntity[]);

      // Convert back to JSONL format
      const resolved = result.entities
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n';

      return { success: true, resolved };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get active conflicts for an execution
   */
  async getConflicts(_executionId: string): Promise<ConflictInfo[]> {
    // Would integrate with dataplane conflict tracking
    return [];
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(_conflictId: string, _strategy: ConflictStrategy): Promise<void> {
    throw new Error('resolveConflict not yet implemented');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reconciliation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Reconcile a stream with git state
   */
  async reconcileStream(streamId: string): Promise<ReconcileResult> {
    const tracker = this.ensureInitialized();

    const status = tracker.checkStreamSync(streamId);

    if (status.inSync) {
      return {
        streamId,
        inSync: true,
        dbState: status.expectedHead,
        gitState: status.actualHead || undefined,
        reconciled: false,
      };
    }

    if (this.config.autoReconcile) {
      const result = tracker.reconcile({
        streamIds: [streamId],
        updateDatabase: true,
      });

      const wasUpdated = result.updated.includes(streamId);

      return {
        streamId,
        inSync: wasUpdated,
        dbState: status.expectedHead,
        gitState: status.actualHead || undefined,
        discrepancy: status.discrepancy,
        reconciled: wasUpdated,
        newHead: wasUpdated ? status.actualHead || undefined : undefined,
      };
    }

    return {
      streamId,
      inSync: false,
      dbState: status.expectedHead,
      gitState: status.actualHead || undefined,
      discrepancy: status.discrepancy,
      reconciled: false,
    };
  }

  /**
   * Run health check on dataplane state
   */
  async healthCheck(): Promise<HealthReport> {
    const tracker = this.ensureInitialized();

    const syncResult = tracker.checkAllStreamsSync();
    const streams = tracker.listStreams({ status: 'active' });

    return {
      healthy: syncResult.allInSync,
      activeStreams: streams.length,
      outOfSyncStreams: syncResult.diverged,
      missingBranches: syncResult.missing,
      orphanedWorktrees: [],
      pendingOperations: 0,
      checkedAt: Date.now(),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Dependencies & Cascade
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Sync issue dependencies to dataplane stream dependencies
   *
   * Maps sudocode issue relationships (blocks, depends-on) to dataplane stream
   * dependencies. This enables cascade rebase to propagate changes correctly.
   *
   * Relationship semantics:
   * - `A blocks B` → B's stream depends on A's stream
   * - `A depends-on B` → A's stream depends on B's stream
   *
   * @param issueId - Issue ID to sync dependencies for
   * @param db - Sudocode database connection
   */
  async syncIssueDependencies(issueId: string, db: Database.Database): Promise<void> {
    const tracker = this.ensureInitialized();

    // Get the stream for this issue
    const issueStream = this.getStreamByIssueId(issueId);
    if (!issueStream) {
      // No stream for this issue yet - nothing to sync
      return;
    }

    // Get incoming "blocks" relationships - other issues that block this one
    // If X blocks issueId, then issueId's stream depends on X's stream
    const blockedBy = getIncomingRelationships(db, issueId, 'issue', 'blocks');
    for (const rel of blockedBy) {
      const blockerStream = this.getStreamByIssueId(rel.from_id);
      if (blockerStream) {
        try {
          tracker.addDependency(issueStream.id, blockerStream.id);
        } catch (error) {
          // Ignore if dependency already exists or would create cycle
          console.warn(
            `Failed to add dependency ${issueStream.id} → ${blockerStream.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    // Get outgoing "depends-on" relationships - issues this one depends on
    // If issueId depends-on Y, then issueId's stream depends on Y's stream
    const dependsOn = getOutgoingRelationships(db, issueId, 'issue', 'depends-on');
    for (const rel of dependsOn) {
      const dependencyStream = this.getStreamByIssueId(rel.to_id);
      if (dependencyStream) {
        try {
          tracker.addDependency(issueStream.id, dependencyStream.id);
        } catch (error) {
          // Ignore if dependency already exists or would create cycle
          console.warn(
            `Failed to add dependency ${issueStream.id} → ${dependencyStream.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }

  /**
   * Get stream by issue ID (searches all streams with issue metadata)
   */
  private getStreamByIssueId(issueId: string): DataplaneStream | null {
    const tracker = this.ensureInitialized();
    const streams = tracker.listStreams();

    for (const stream of streams) {
      const metadata = stream.metadata as unknown as SudocodeStreamMetadata | undefined;
      if (metadata?.sudocode?.issue_id === issueId) {
        return stream;
      }
    }

    return null;
  }

  /**
   * Trigger cascade rebase from a stream
   *
   * After a stream is merged/rebased, this triggers rebase of all dependent
   * streams to keep them up to date with the new base.
   *
   * @param streamId - Stream that was just merged/rebased
   * @returns Cascade report with affected streams
   */
  async triggerCascade(streamId: string): Promise<CascadeReport> {
    const tracker = this.ensureInitialized();

    // Check if cascade is enabled in config
    if (!this.config.cascadeOnMerge) {
      return {
        triggered_by: streamId,
        affected_streams: [],
        complete: true,
      };
    }

    // Get dependents of this stream
    const dependents = tracker.getDependents(streamId);
    if (dependents.length === 0) {
      return {
        triggered_by: streamId,
        affected_streams: [],
        complete: true,
      };
    }

    // Map cascade strategy from config to dataplane strategy
    const strategy = this.config.conflictStrategy.cascade;

    // Build cascade results
    const affectedStreams: CascadeStreamResult[] = [];

    // Process dependents in order (topologically sorted would be ideal)
    for (const dependentId of dependents) {
      const stream = tracker.getStream(dependentId);
      if (!stream) {
        affectedStreams.push({
          stream_id: dependentId,
          result: 'skipped',
          error: 'Stream not found',
        });
        continue;
      }

      // Get issue ID from stream metadata
      const metadata = stream.metadata as unknown as SudocodeStreamMetadata | undefined;
      const issueId = metadata?.sudocode?.issue_id;

      try {
        // Perform rebase using syncWithParent
        // Note: This is a simplified implementation - full cascade would use
        // dataplane's cascadeRebase function which handles topological ordering
        // and conflict strategies
        const worktree = tracker.getWorktree(stream.agentId);
        if (!worktree) {
          affectedStreams.push({
            stream_id: dependentId,
            issue_id: issueId,
            result: 'skipped',
            error: 'No worktree available for rebase',
          });
          continue;
        }

        const rebaseResult = tracker.syncWithParent(
          dependentId,
          stream.agentId,
          worktree.path,
          strategy === 'stop_on_conflict' ? 'abort' : 'defer'
        );

        if (rebaseResult.success) {
          affectedStreams.push({
            stream_id: dependentId,
            issue_id: issueId,
            result: 'rebased',
            new_head: rebaseResult.newHead,
          });
        } else if (rebaseResult.conflicts && rebaseResult.conflicts.length > 0) {
          affectedStreams.push({
            stream_id: dependentId,
            issue_id: issueId,
            result: 'conflict',
            conflict_files: rebaseResult.conflicts.map((c) => c.path),
          });

          // Stop on first conflict if configured
          if (strategy === 'stop_on_conflict') {
            break;
          }
        } else {
          affectedStreams.push({
            stream_id: dependentId,
            issue_id: issueId,
            result: 'failed',
            error: rebaseResult.error || 'Unknown error',
          });
        }
      } catch (error) {
        affectedStreams.push({
          stream_id: dependentId,
          issue_id: issueId,
          result: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });

        // Stop on first error if configured
        if (strategy === 'stop_on_conflict') {
          break;
        }
      }
    }

    // Determine if cascade completed fully
    const complete = affectedStreams.every(
      (s) => s.result === 'rebased' || s.result === 'skipped'
    );

    // Get deferred conflicts if using defer strategy
    const deferred =
      strategy === 'defer_conflicts'
        ? affectedStreams
            .filter((s) => s.result === 'conflict')
            .map((s) => s.stream_id)
        : undefined;

    return {
      triggered_by: streamId,
      affected_streams: affectedStreams,
      complete,
      deferred,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Merge Queue
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Add execution to merge queue
   */
  async enqueue(params: {
    executionId: string;
    targetBranch: string;
    position?: number;
    agentId: string;
  }): Promise<QueueEntry> {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByExecutionId(params.executionId);

    if (!stream) {
      throw new Error(`Stream not found for execution: ${params.executionId}`);
    }

    const entryId = tracker.addToMergeQueue({
      streamId: stream.id,
      agentId: params.agentId,
      targetBranch: params.targetBranch,
      priority: params.position ? params.position * 10 : 100,
      metadata: { executionId: params.executionId },
    });

    const entry = tracker.getMergeQueueEntry(entryId);
    if (!entry) {
      throw new Error('Failed to create queue entry');
    }

    return this.mapQueueEntry(entry, params.executionId);
  }

  /**
   * Remove execution from merge queue
   */
  async dequeue(executionId: string): Promise<void> {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByExecutionId(executionId);

    if (!stream) return;

    const queue = tracker.getMergeQueue();
    const entry = queue.find((e) => e.streamId === stream.id);

    if (entry) {
      tracker.removeFromMergeQueue(entry.id);
    }
  }

  /**
   * Get queue position for an execution
   */
  async getQueuePosition(
    executionId: string,
    targetBranch: string = 'main'
  ): Promise<number | null> {
    const tracker = this.ensureInitialized();
    const stream = this.getStreamByExecutionId(executionId);

    if (!stream) return null;

    return tracker.getMergeQueuePosition(stream.id, targetBranch);
  }

  /**
   * Get the merge queue
   */
  async getQueue(targetBranch: string = 'main'): Promise<QueueEntry[]> {
    const tracker = this.ensureInitialized();
    const queue = tracker.getMergeQueue({ targetBranch });

    return queue.map((entry) => {
      const executionId = (entry.metadata.executionId as string) || '';
      return this.mapQueueEntry(entry, executionId);
    });
  }

  /**
   * Reorder queue entry to a new position
   *
   * @param executionId - The execution ID to reorder
   * @param newPosition - The desired position (1-indexed, 1 = first)
   * @param targetBranch - The target branch queue to reorder in (default: 'main')
   * @returns ReorderResult with new queue order
   */
  async reorderQueue(
    executionId: string,
    newPosition: number,
    targetBranch: string = 'main'
  ): Promise<ReorderResult> {
    const tracker = this.ensureInitialized();

    // 1. Get the stream for this execution
    const stream = this.getStreamByExecutionId(executionId);
    if (!stream) {
      return {
        success: false,
        newOrder: [],
        cascadeTriggered: false,
        error: `Stream not found for execution: ${executionId}`,
      };
    }

    // 2. Get the current queue
    const queue = tracker.getMergeQueue({ targetBranch });
    const entry = queue.find((e) => e.streamId === stream.id);

    if (!entry) {
      return {
        success: false,
        newOrder: [],
        cascadeTriggered: false,
        error: `Queue entry not found for execution: ${executionId}`,
      };
    }

    // 3. Validate new position
    if (newPosition < 1) {
      newPosition = 1;
    }
    if (newPosition > queue.length) {
      newPosition = queue.length;
    }

    // 4. Calculate new priority based on position
    // Priority determines order: lower priority = earlier in queue
    // We use position * 10 to leave gaps for future insertions
    // To insert at position N, we need priority between position N-1 and N entries
    let newPriority: number;

    if (newPosition === 1) {
      // Moving to first position - priority lower than current first
      const firstEntry = queue[0];
      newPriority = firstEntry.id === entry.id ? entry.priority : firstEntry.priority - 10;
    } else if (newPosition >= queue.length) {
      // Moving to last position - priority higher than current last
      const lastEntry = queue[queue.length - 1];
      newPriority = lastEntry.id === entry.id ? entry.priority : lastEntry.priority + 10;
    } else {
      // Moving to middle - calculate priority between adjacent entries
      // Account for the entry being moved (it will be removed from current position)
      const sortedQueue = queue.filter((e) => e.id !== entry.id);
      const beforeEntry = sortedQueue[newPosition - 2]; // Entry that will be before
      const afterEntry = sortedQueue[newPosition - 1]; // Entry that will be after

      if (beforeEntry && afterEntry) {
        newPriority = Math.floor((beforeEntry.priority + afterEntry.priority) / 2);
        // If priorities are adjacent, shift the after entry
        if (newPriority === beforeEntry.priority) {
          newPriority = beforeEntry.priority + 1;
        }
      } else if (beforeEntry) {
        newPriority = beforeEntry.priority + 10;
      } else if (afterEntry) {
        newPriority = afterEntry.priority - 10;
      } else {
        newPriority = newPosition * 10;
      }
    }

    // 5. Update the entry's priority in the database
    try {
      tracker.db
        .prepare('UPDATE merge_queue SET priority = ?, updated_at = ? WHERE id = ?')
        .run(newPriority, Date.now(), entry.id);
    } catch (error) {
      return {
        success: false,
        newOrder: [],
        cascadeTriggered: false,
        error: `Failed to update queue entry: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // 6. Get the new queue order and return
    const newQueue = tracker.getMergeQueue({ targetBranch });
    const newOrder = newQueue.map((e) => (e.metadata.executionId as string) || '');

    return {
      success: true,
      newOrder,
      cascadeTriggered: false,
    };
  }

  /**
   * Merge next item in queue
   */
  async mergeNext(
    targetBranch: string,
    agentId: string,
    worktree: string
  ): Promise<MergeResult> {
    const tracker = this.ensureInitialized();

    const result = tracker.processMergeQueue({
      agentId,
      worktree,
      targetBranch,
      limit: 1,
    });

    if (result.merged.length > 0) {
      return {
        success: true,
        mergeCommit: result.merged[0].mergeCommit,
        streamId: result.merged[0].streamId,
      };
    }

    if (result.failed.length > 0) {
      return {
        success: false,
        streamId: result.failed[0].streamId,
        error: result.failed[0].error,
      };
    }

    return {
      success: false,
      streamId: '',
      error: 'No items ready in queue',
    };
  }

  /**
   * Merge all items up to a specific execution
   */
  async mergeUpTo(
    _executionId: string,
    _agentId: string,
    _worktree: string
  ): Promise<MergeResult[]> {
    return [];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Map dataplane queue entry to adapter queue entry
   */
  private mapQueueEntry(
    entry: DataplaneMergeQueueEntry,
    executionId: string
  ): QueueEntry {
    return {
      id: entry.id,
      executionId,
      streamId: entry.streamId,
      targetBranch: entry.targetBranch,
      position: entry.position || 0,
      priority: entry.priority,
      status: entry.status as QueueEntry['status'],
      addedAt: entry.addedAt,
      error: entry.error,
      mergeCommit: entry.mergeCommit,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Singleton cache for DataplaneAdapter instances
 * Keyed by normalized repository path
 */
const adapterCache = new Map<string, DataplaneAdapter>();

/**
 * Normalize a path for use as cache key
 */
function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath);
}

/**
 * Get the singleton DataplaneAdapter instance for a repository
 * Returns null if dataplane is not enabled in config
 */
export async function getDataplaneAdapter(
  repoPath: string,
  db?: Database.Database
): Promise<DataplaneAdapter | null> {
  const normalizedPath = normalizeRepoPath(repoPath);

  // Check if we already have an initialized adapter
  const cached = adapterCache.get(normalizedPath);
  if (cached && cached.isInitialized) {
    return cached;
  }

  // Check if dataplane is enabled
  if (!isDataplaneEnabled(repoPath)) {
    return null;
  }

  // Create and initialize new adapter (pass db for shared database mode)
  const adapter = new DataplaneAdapter(repoPath, undefined, db);
  try {
    await adapter.initialize();
    adapterCache.set(normalizedPath, adapter);
    return adapter;
  } catch (error) {
    // Log error but return null - dataplane is optional
    console.error(
      `Failed to initialize dataplane adapter: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Get the DataplaneAdapter instance synchronously (if already initialized)
 * Returns null if not initialized or not enabled
 */
export function getDataplaneAdapterSync(repoPath: string): DataplaneAdapter | null {
  const normalizedPath = normalizeRepoPath(repoPath);
  const cached = adapterCache.get(normalizedPath);

  if (cached && cached.isInitialized) {
    return cached;
  }

  return null;
}

/**
 * Close and remove the DataplaneAdapter for a repository
 */
export function closeDataplaneAdapter(repoPath: string): void {
  const normalizedPath = normalizeRepoPath(repoPath);
  const adapter = adapterCache.get(normalizedPath);

  if (adapter) {
    adapter.close();
    adapterCache.delete(normalizedPath);
  }
}

/**
 * Close all DataplaneAdapter instances
 * Call this on server shutdown
 */
export function closeAllDataplaneAdapters(): void {
  for (const adapter of adapterCache.values()) {
    adapter.close();
  }
  adapterCache.clear();
}

/**
 * Create a DataplaneAdapter instance if enabled (legacy factory)
 * @deprecated Use getDataplaneAdapter() instead for singleton behavior
 */
export async function createDataplaneAdapter(
  repoPath: string
): Promise<DataplaneAdapter | null> {
  return getDataplaneAdapter(repoPath);
}
