/**
 * Worktree Manager
 *
 * Manages git worktrees for session isolation.
 * Based on design from SPEC-010 and vibe-kanban implementation.
 *
 * @module execution/worktree/manager
 */

import { Mutex } from 'async-mutex';
import fs from 'fs';
import path from 'path';
import type {
  WorktreeCreateParams,
  WorktreeConfig,
  WorktreeInfo,
} from './types.js';
import { WorktreeError, WorktreeErrorCode } from './types.js';
import { GitCli, type IGitCli } from './git-cli.js';

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

  /** Git CLI wrapper */
  private git: IGitCli;

  /**
   * Create a new WorktreeManager
   *
   * @param config - Worktree configuration
   * @param git - Optional git CLI implementation (defaults to GitCli)
   */
  constructor(config: WorktreeConfig, git?: IGitCli) {
    this.config = config;
    this.git = git || new GitCli();
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

  async createWorktree(params: WorktreeCreateParams): Promise<void> {
    const { repoPath, branchName, worktreePath, baseBranch, createBranch } = params;

    try {
      // 1. Create branch if requested
      if (createBranch) {
        await this.git.createBranch(repoPath, branchName, baseBranch);
      }

      // 2. Create parent directory if needed
      const parentDir = path.dirname(worktreePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // 3. Call git worktree add
      await this.git.worktreeAdd(repoPath, worktreePath, branchName);

      // 4. Apply sparse-checkout if configured
      if (this.config.enableSparseCheckout && this.config.sparseCheckoutPatterns) {
        await this.git.configureSparseCheckout(
          worktreePath,
          this.config.sparseCheckoutPatterns
        );
      }

      // 5. Validate creation
      if (!fs.existsSync(worktreePath)) {
        throw new WorktreeError(
          `Worktree creation succeeded but path does not exist: ${worktreePath}`,
          WorktreeErrorCode.REPOSITORY_ERROR
        );
      }
    } catch (error) {
      if (error instanceof WorktreeError) {
        throw error;
      }
      throw new WorktreeError(
        `Failed to create worktree: ${error}`,
        WorktreeErrorCode.REPOSITORY_ERROR,
        error as Error
      );
    }
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

  async cleanupWorktree(worktreePath: string, repoPath?: string): Promise<void> {
    // Get lock for this specific path
    const lock = this.getLock(worktreePath);
    const release = await lock.acquire();

    try {
      // Infer repoPath if not provided (try to find from worktree)
      const effectiveRepoPath = repoPath || await this.inferRepoPath(worktreePath);

      if (!effectiveRepoPath) {
        // Can't determine repo path, just cleanup the directory
        if (fs.existsSync(worktreePath)) {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
        return;
      }

      // Get worktree info to find branch name (for optional deletion)
      let branchName: string | undefined;
      try {
        const worktrees = await this.git.worktreeList(effectiveRepoPath);
        const worktreeInfo = worktrees.find((w) => w.path === worktreePath);
        if (worktreeInfo) {
          branchName = worktreeInfo.branch;
        }
      } catch (error) {
        // Ignore errors, branch deletion is optional
      }

      // 1. Remove git worktree registration
      try {
        await this.git.worktreeRemove(effectiveRepoPath, worktreePath, true);
      } catch (error) {
        // Worktree might already be removed or invalid, continue cleanup
      }

      // 2. Force cleanup metadata directory
      const worktreeName = path.basename(worktreePath);
      const metadataPath = path.join(
        effectiveRepoPath,
        '.git',
        'worktrees',
        worktreeName
      );
      if (fs.existsSync(metadataPath)) {
        fs.rmSync(metadataPath, { recursive: true, force: true });
      }

      // 3. Remove filesystem directory
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }

      // 4. Prune stale worktree entries
      try {
        await this.git.worktreePrune(effectiveRepoPath);
      } catch (error) {
        // Prune is best-effort, continue even if it fails
      }

      // 5. Delete branch if configured
      if (this.config.autoDeleteBranches && branchName && branchName !== '(detached)') {
        try {
          await this.git.deleteBranch(effectiveRepoPath, branchName, true);
        } catch (error) {
          // Branch deletion is optional, don't fail the cleanup
        }
      }
    } finally {
      release();
    }
  }

  async isWorktreeValid(repoPath: string, worktreePath: string): Promise<boolean> {
    try {
      // 1. Check filesystem path exists
      if (!fs.existsSync(worktreePath)) {
        return false;
      }

      // 2. Check worktree is registered in git metadata
      const worktrees = await this.git.worktreeList(repoPath);
      const isRegistered = worktrees.some((w) => w.path === worktreePath);

      return isRegistered;
    } catch (error) {
      // On any error, consider invalid
      return false;
    }
  }

  async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    return await this.git.worktreeList(repoPath);
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
    repoPath: string,
    branchName: string,
    worktreePath: string
  ): Promise<void> {
    // 1. Comprehensive cleanup of existing worktree
    await this.cleanupWorktree(worktreePath, repoPath);

    // 2. Create parent directory if needed
    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // 3. Create worktree with retry logic
    let lastError: Error | undefined;
    const maxRetries = 1;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.git.worktreeAdd(repoPath, worktreePath, branchName);

        // Apply sparse-checkout if configured
        if (this.config.enableSparseCheckout && this.config.sparseCheckoutPatterns) {
          await this.git.configureSparseCheckout(
            worktreePath,
            this.config.sparseCheckoutPatterns
          );
        }

        // Validate creation
        if (!fs.existsSync(worktreePath)) {
          throw new WorktreeError(
            `Worktree creation succeeded but path does not exist: ${worktreePath}`,
            WorktreeErrorCode.REPOSITORY_ERROR
          );
        }

        return; // Success!
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          // Cleanup metadata and try again
          const worktreeName = path.basename(worktreePath);
          const metadataPath = path.join(
            repoPath,
            '.git',
            'worktrees',
            worktreeName
          );
          if (fs.existsSync(metadataPath)) {
            fs.rmSync(metadataPath, { recursive: true, force: true });
          }
        }
      }
    }

    // All retries failed
    throw new WorktreeError(
      `Failed to recreate worktree after ${maxRetries + 1} attempts: ${lastError}`,
      WorktreeErrorCode.REPOSITORY_ERROR,
      lastError
    );
  }

  /**
   * Infer git repository path from a worktree
   * Uses git rev-parse --git-common-dir
   *
   * @param worktreePath - Path to worktree
   * @returns Repository path or undefined
   */
  private async inferRepoPath(worktreePath: string): Promise<string | undefined> {
    try {
      if (!fs.existsSync(worktreePath)) {
        return undefined;
      }

      // Try to use git to find the common git directory
      const { execSync } = await import('child_process');
      const gitCommonDir = execSync('git rev-parse --git-common-dir', {
        cwd: worktreePath,
        encoding: 'utf8',
      }).trim();

      // git-common-dir gives us the .git directory
      // We need the working directory (parent of .git)
      const gitDirPath = path.resolve(worktreePath, gitCommonDir);
      if (path.basename(gitDirPath) === '.git') {
        return path.dirname(gitDirPath);
      }

      return gitDirPath;
    } catch (error) {
      return undefined;
    }
  }
}

