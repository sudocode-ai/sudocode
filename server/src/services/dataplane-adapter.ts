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
import type { AgentType } from '@sudocode-ai/types';
import { mergeThreeWay, type JSONLEntity } from '@sudocode-ai/cli/dist/merge-resolver.js';
import { readJSONLSync } from '@sudocode-ai/cli/dist/jsonl.js';
import {
  type DataplaneConfig,
  getDataplaneConfig,
  isDataplaneEnabled,
} from './dataplane-config.js';
import type {
  SudocodeStreamMetadata,
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
  QueueEntry,
  ReorderResult,
  MergeResult,
} from './dataplane-types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dataplane Types (inline definitions until dataplane package is available)
// ─────────────────────────────────────────────────────────────────────────────

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
  close(): void;
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

  constructor(repoPath: string, config?: DataplaneConfig) {
    this.repoPath = repoPath;
    this.config = config || getDataplaneConfig(repoPath);
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
      const dataplane = await import('dataplane' as any) as { MultiAgentRepoTracker: new (opts: { repoPath: string; dbPath: string; skipRecovery?: boolean }) => DataplaneTracker };
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
   */
  async ensureIssueStream(issueId: string, agentId: string): Promise<string> {
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

    // Create new stream for issue
    const streamId = tracker.createStream({
      name: `issue-${issueId}`,
      agentId,
      metadata: {
        sudocode: {
          type: 'issue',
          issue_id: issueId,
        },
      },
    });

    return streamId;
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
   * Sync issue dependencies to dataplane
   */
  async syncIssueDependencies(_issueId: string): Promise<void> {
    // Would map sudocode issue dependencies to dataplane stream dependencies
  }

  /**
   * Trigger cascade rebase from a stream
   */
  async triggerCascade(streamId: string): Promise<CascadeReport> {
    return {
      rootStream: streamId,
      updated: [],
      skipped: [],
      failed: [],
      complete: false,
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
   * Reorder queue entry
   */
  async reorderQueue(_executionId: string, _newPosition: number): Promise<ReorderResult> {
    return {
      success: false,
      newOrder: [],
      cascadeTriggered: false,
      error: 'reorderQueue not yet implemented',
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
  repoPath: string
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

  // Create and initialize new adapter
  const adapter = new DataplaneAdapter(repoPath);
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
