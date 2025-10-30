/**
 * Worktree Manager
 *
 * Manages git worktrees for session isolation.
 * Based on design from SPEC-010 and vibe-kanban implementation.
 *
 * @module execution/worktree/manager
 */

import { Mutex } from 'async-mutex';
import type {
  WorktreeCreateParams,
  WorktreeConfig,
  WorktreeInfo,
} from './types.js';
import { WorktreeError, WorktreeErrorCode } from './types.js';

/**
 * IWorktreeManager - Interface for worktree management
 *
 * Provides methods for creating, validating, and cleaning up git worktrees.
 * Implementations must handle race conditions with locking.
 */
export interface IWorktreeManager {
  /**
   * Create a new worktree for a session
   *
   * @param params - Worktree creation parameters
   * @returns Promise that resolves when worktree is created
   * @throws WorktreeError if creation fails
   */
  createWorktree(params: WorktreeCreateParams): Promise<void>;

  /**
   * Ensure worktree exists, recreating if necessary
   * Uses locking to prevent race conditions
   *
   * @param repoPath - Path to the main git repository
   * @param branchName - Branch name for the worktree
   * @param worktreePath - Where the worktree should exist
   * @returns Promise that resolves when worktree exists
   * @throws WorktreeError if ensure fails
   */
  ensureWorktreeExists(
    repoPath: string,
    branchName: string,
    worktreePath: string
  ): Promise<void>;

  /**
   * Clean up a worktree (filesystem + git metadata)
   *
   * @param worktreePath - Path to the worktree to cleanup
   * @param repoPath - Optional path to repository (will try to infer if not provided)
   * @returns Promise that resolves when cleanup is complete
   * @throws WorktreeError if cleanup fails
   */
  cleanupWorktree(worktreePath: string, repoPath?: string): Promise<void>;

  /**
   * Check if worktree is properly set up
   * Validates both filesystem existence and git metadata registration
   *
   * @param repoPath - Path to the main git repository
   * @param worktreePath - Path to check
   * @returns Promise resolving to true if valid, false otherwise
   */
  isWorktreeValid(repoPath: string, worktreePath: string): Promise<boolean>;

  /**
   * List all worktrees for a repository
   *
   * @param repoPath - Path to the main git repository
   * @returns Promise resolving to list of worktree info
   * @throws WorktreeError if listing fails
   */
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;

  /**
   * Get the current configuration
   *
   * @returns Current worktree configuration
   */
  getConfig(): WorktreeConfig;
}

/**
 * WorktreeManager - Implementation of IWorktreeManager
 *
 * Manages git worktrees with proper locking, cleanup, and error recovery.
 * Uses git CLI commands for reliability.
 */
export class WorktreeManager implements IWorktreeManager {
  /** Per-path locks to prevent concurrent operations */
  private locks = new Map<string, Mutex>();

  /** Configuration loaded from .sudocode/config.json */
  private config: WorktreeConfig;

  /**
   * Create a new WorktreeManager
   *
   * @param config - Worktree configuration
   */
  constructor(config: WorktreeConfig) {
    this.config = config;
  }

  /**
   * Get or create a lock for a specific path
   *
   * @param path - Path to lock
   * @returns Mutex for the path
   */
  private getLock(path: string): Mutex {
    let lock = this.locks.get(path);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(path, lock);
    }
    return lock;
  }

  async createWorktree(_params: WorktreeCreateParams): Promise<void> {
    // TODO: Implement in coordination with ISSUE-110 (git CLI wrapper)
    // This will:
    // 1. Create branch if createBranch is true
    // 2. Call git worktree add
    // 3. Apply sparse-checkout if configured
    // 4. Validate creation
    throw new WorktreeError(
      'Not implemented - depends on ISSUE-110 (git CLI wrapper)',
      WorktreeErrorCode.REPOSITORY_ERROR
    );
  }

  async ensureWorktreeExists(
    repoPath: string,
    branchName: string,
    worktreePath: string
  ): Promise<void> {
    // Get lock for this specific path
    const lock = this.getLock(worktreePath);
    const release = await lock.acquire();

    try {
      // Check if already exists and valid
      if (await this.isWorktreeValid(repoPath, worktreePath)) {
        return;
      }

      // Recreate worktree
      await this.recreateWorktree(repoPath, branchName, worktreePath);
    } finally {
      release();
    }
  }

  async cleanupWorktree(worktreePath: string, _repoPath?: string): Promise<void> {
    // Get lock for this specific path
    const lock = this.getLock(worktreePath);
    const release = await lock.acquire();

    try {
      // TODO: Implement comprehensive cleanup (ISSUE-110)
      // This will:
      // 1. Remove git worktree registration
      // 2. Force cleanup metadata directory
      // 3. Remove filesystem directory
      // 4. Prune stale worktree entries
      // 5. Delete branch if configured
      throw new WorktreeError(
        'Not implemented - depends on ISSUE-110 (git CLI wrapper)',
        WorktreeErrorCode.REPOSITORY_ERROR
      );
    } finally {
      release();
    }
  }

  async isWorktreeValid(_repoPath: string, _worktreePath: string): Promise<boolean> {
    // TODO: Implement validation (ISSUE-110)
    // This will:
    // 1. Check filesystem path exists
    // 2. Check worktree is registered in git metadata
    throw new WorktreeError(
      'Not implemented - depends on ISSUE-110 (git CLI wrapper)',
      WorktreeErrorCode.REPOSITORY_ERROR
    );
  }

  async listWorktrees(_repoPath: string): Promise<WorktreeInfo[]> {
    // TODO: Implement listing (ISSUE-110)
    // This will call git worktree list --porcelain and parse output
    throw new WorktreeError(
      'Not implemented - depends on ISSUE-110 (git CLI wrapper)',
      WorktreeErrorCode.REPOSITORY_ERROR
    );
  }

  getConfig(): WorktreeConfig {
    return { ...this.config };
  }

  /**
   * Recreate a worktree (internal method)
   *
   * @param repoPath - Path to repository
   * @param branchName - Branch name
   * @param worktreePath - Worktree path
   */
  private async recreateWorktree(
    _repoPath: string,
    _branchName: string,
    _worktreePath: string
  ): Promise<void> {
    // TODO: Implement recreation logic (ISSUE-110)
    // This will:
    // 1. Comprehensive cleanup of existing worktree
    // 2. Create parent directory if needed
    // 3. Create worktree with retry logic
    throw new WorktreeError(
      'Not implemented - depends on ISSUE-110 (git CLI wrapper)',
      WorktreeErrorCode.REPOSITORY_ERROR
    );
  }
}

