/**
 * Worktree Types
 *
 * Type definitions for worktree management system.
 *
 * @module execution/worktree/types
 */

/**
 * Worktree creation parameters
 */
export interface WorktreeCreateParams {
  /** Path to the main git repository */
  repoPath: string;
  /** Branch name for the worktree */
  branchName: string;
  /** Where to create the worktree */
  worktreePath: string;
  /** Branch to base the new branch on */
  baseBranch: string;
  /** Whether to create the branch */
  createBranch: boolean;
}

/**
 * Worktree information returned from git worktree list
 */
export interface WorktreeInfo {
  /** Path to the worktree */
  path: string;
  /** Branch name */
  branch: string;
  /** Git commit hash */
  commit: string;
  /** Whether this is the main worktree */
  isMain: boolean;
  /** Whether the worktree is locked */
  isLocked: boolean;
  /** Reason for lock (if locked) */
  lockReason?: string;
}

/**
 * Worktree configuration (will be implemented in ISSUE-111)
 * Placeholder type for now
 */
export interface WorktreeConfig {
  /** Where to store worktrees */
  worktreeStoragePath: string;
  /** Auto-create branches for new sessions */
  autoCreateBranches: boolean;
  /** Auto-delete branches when session is cleaned up */
  autoDeleteBranches: boolean;
  /** Use sparse-checkout for worktrees */
  enableSparseCheckout: boolean;
  /** Patterns for sparse-checkout */
  sparseCheckoutPatterns?: string[];
  /** Branch naming prefix */
  branchPrefix: string;
  /** Cleanup orphaned worktrees on server startup */
  cleanupOrphanedWorktreesOnStartup: boolean;
}

/**
 * Worktree manager errors
 */
export class WorktreeError extends Error {
  constructor(
    message: string,
    public code: WorktreeErrorCode,
    public cause?: Error
  ) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export enum WorktreeErrorCode {
  /** Git operation failed */
  GIT_ERROR = 'GIT_ERROR',
  /** Worktree path already exists */
  PATH_EXISTS = 'PATH_EXISTS',
  /** Worktree path not found */
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  /** Invalid path */
  INVALID_PATH = 'INVALID_PATH',
  /** Branch not found */
  BRANCH_NOT_FOUND = 'BRANCH_NOT_FOUND',
  /** Repository error */
  REPOSITORY_ERROR = 'REPOSITORY_ERROR',
  /** Configuration error */
  CONFIG_ERROR = 'CONFIG_ERROR',
  /** Locking error */
  LOCK_ERROR = 'LOCK_ERROR',
  /** Cleanup failed */
  CLEANUP_FAILED = 'CLEANUP_FAILED',
}
