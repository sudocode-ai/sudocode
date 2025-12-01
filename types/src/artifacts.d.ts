/**
 * Execution artifacts types
 *
 * Types for artifacts created during executions (code changes, outputs, etc.)
 */

/**
 * File change statistics for execution diff
 */
export interface FileChangeStat {
  path: string;
  additions: number;
  deletions: number;
  status: 'A' | 'M' | 'D' | 'R'; // Added, Modified, Deleted, Renamed
}

/**
 * Changes snapshot at a specific point in time
 */
export interface ChangesSnapshot {
  files: FileChangeStat[];
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
  commitRange: {
    before: string;
    after: string;
  } | null;
  uncommitted: boolean;
}

/**
 * Result of execution changes calculation
 */
export interface ExecutionChangesResult {
  available: boolean;
  reason?: 'missing_commits' | 'commits_not_found' | 'incomplete_execution' | 'git_error' | 'worktree_deleted_with_uncommitted_changes' | 'branch_deleted';

  // Captured state: changes at execution completion time
  captured?: ChangesSnapshot;

  // Uncommitted changes at execution completion time (if any)
  // This allows displaying both committed and uncommitted changes separately
  uncommittedSnapshot?: ChangesSnapshot;

  // Current state: changes at current branch HEAD (if different from captured)
  current?: ChangesSnapshot;

  // Branch and worktree metadata
  branchName?: string; // Branch associated with execution
  branchExists?: boolean; // Whether branch still exists
  worktreeExists?: boolean; // Whether worktree still exists
  additionalCommits?: number; // Number of commits since execution completed (current - captured)
  executionMode?: 'worktree' | 'local' | null; // Execution mode - helps distinguish between local and worktree executions

  // Legacy compatibility (deprecated - use captured instead)
  changes?: ChangesSnapshot;
  commitRange?: {
    before: string;
    after: string;
  } | null;
  uncommitted?: boolean;
}
