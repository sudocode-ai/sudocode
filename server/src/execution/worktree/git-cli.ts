/**
 * Git CLI Wrapper
 *
 * Provides a wrapper around git CLI commands for worktree operations.
 * Uses git CLI directly for reliability (recommended over libgit2/nodegit).
 *
 * @module execution/worktree/git-cli
 */

import { execSync } from 'child_process';
import type { WorktreeInfo } from './types.js';
import { WorktreeError, WorktreeErrorCode } from './types.js';

/**
 * IGitCli - Interface for git CLI operations
 */
export interface IGitCli {
  /**
   * Add a new worktree
   * Equivalent to: git worktree add <path> <branch>
   *
   * @param repoPath - Path to the main git repository
   * @param worktreePath - Path where worktree will be created
   * @param branch - Branch name for the worktree
   * @param force - Force creation even if path exists
   */
  worktreeAdd(
    repoPath: string,
    worktreePath: string,
    branch: string,
    force?: boolean
  ): Promise<void>;

  /**
   * Remove a worktree
   * Equivalent to: git worktree remove <path> --force
   *
   * @param repoPath - Path to the main git repository
   * @param worktreePath - Path to worktree to remove
   * @param force - Force removal even if worktree is dirty
   */
  worktreeRemove(
    repoPath: string,
    worktreePath: string,
    force?: boolean
  ): Promise<void>;

  /**
   * Prune worktree metadata
   * Equivalent to: git worktree prune
   *
   * @param repoPath - Path to the main git repository
   */
  worktreePrune(repoPath: string): Promise<void>;

  /**
   * List all worktrees
   * Equivalent to: git worktree list --porcelain
   *
   * @param repoPath - Path to the main git repository
   * @returns Array of worktree information
   */
  worktreeList(repoPath: string): Promise<WorktreeInfo[]>;

  /**
   * Create a branch
   * Equivalent to: git branch <name> <base>
   *
   * @param repoPath - Path to the git repository
   * @param branchName - Name of the new branch
   * @param baseBranchOrCommit - Base branch or commit SHA to branch from
   */
  createBranch(
    repoPath: string,
    branchName: string,
    baseBranchOrCommit: string
  ): Promise<void>;

  /**
   * Delete a branch
   * Equivalent to: git branch -d <name>
   *
   * @param repoPath - Path to the git repository
   * @param branchName - Name of the branch to delete
   * @param force - Force deletion (use -D instead of -d)
   */
  deleteBranch(
    repoPath: string,
    branchName: string,
    force?: boolean
  ): Promise<void>;

  /**
   * Configure sparse-checkout for a worktree
   * Equivalent to: git sparse-checkout set <patterns>
   *
   * @param worktreePath - Path to the worktree
   * @param patterns - Sparse checkout patterns
   */
  configureSparseCheckout(
    worktreePath: string,
    patterns: string[]
  ): Promise<void>;

  /**
   * Check if a path is a valid git repository
   * Equivalent to: git rev-parse --git-dir
   *
   * @param repoPath - Path to check
   * @returns Promise resolving to true if valid repo, false otherwise
   */
  isValidRepo(repoPath: string): Promise<boolean>;

  /**
   * List all branches in a repository
   * Equivalent to: git branch --list --all --format='%(refname:short)'
   *
   * @param repoPath - Path to the git repository
   * @returns Promise resolving to array of branch names
   */
  listBranches(repoPath: string): Promise<string[]>;

  /**
   * Get current HEAD commit SHA
   * Equivalent to: git rev-parse HEAD
   *
   * @param repoPath - Path to the git repository
   * @returns Promise resolving to the current HEAD commit SHA
   */
  getCurrentCommit(repoPath: string): Promise<string>;

  /**
   * Get current branch name
   * Equivalent to: git rev-parse --abbrev-ref HEAD
   *
   * @param repoPath - Path to the git repository
   * @returns Promise resolving to the current branch name (or "(detached)" if detached HEAD)
   */
  getCurrentBranch(repoPath: string): Promise<string>;
}

/**
 * GitCli - Implementation of IGitCli using child_process
 */
export class GitCli implements IGitCli {
  /**
   * Execute a git command
   *
   * @param command - Git command to execute
   * @param cwd - Working directory
   * @returns Command output
   * @throws WorktreeError on failure
   */
  protected execGit(command: string, cwd: string): string {
    try {
      return execSync(command, {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: any) {
      const stderr = error.stderr?.toString() || '';
      const stdout = error.stdout?.toString() || '';
      const message = stderr || stdout || error.message || 'Unknown git error';

      throw new WorktreeError(
        `Git command failed: ${command}\n${message}`,
        WorktreeErrorCode.GIT_ERROR,
        error
      );
    }
  }

  /**
   * Escape shell argument
   *
   * @param arg - Argument to escape
   * @returns Escaped argument
   */
  private escapeShellArg(arg: string): string {
    // Escape single quotes and wrap in single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  async worktreeAdd(
    repoPath: string,
    worktreePath: string,
    branch: string,
    force = false
  ): Promise<void> {
    const escapedPath = this.escapeShellArg(worktreePath);
    const escapedBranch = this.escapeShellArg(branch);
    const forceFlag = force ? '--force' : '';

    const command = `git worktree add ${forceFlag} ${escapedPath} ${escapedBranch}`.trim();
    this.execGit(command, repoPath);
  }

  async worktreeRemove(
    repoPath: string,
    worktreePath: string,
    force = false
  ): Promise<void> {
    const escapedPath = this.escapeShellArg(worktreePath);
    const forceFlag = force ? '--force' : '';

    const command = `git worktree remove ${forceFlag} ${escapedPath}`.trim();
    this.execGit(command, repoPath);
  }

  async worktreePrune(repoPath: string): Promise<void> {
    this.execGit('git worktree prune', repoPath);
  }

  async worktreeList(repoPath: string): Promise<WorktreeInfo[]> {
    const output = this.execGit('git worktree list --porcelain', repoPath);
    return this.parseWorktreeList(output);
  }

  /**
   * Parse output from git worktree list --porcelain
   *
   * Format:
   * worktree /path/to/worktree
   * HEAD abc123...
   * branch refs/heads/branch-name
   * locked reason (optional)
   * prunable reason (optional)
   *
   * @param output - Output from git worktree list --porcelain
   * @returns Array of WorktreeInfo
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const lines = output.split('\n').filter((line) => line.trim());

    let currentWorktree: Partial<WorktreeInfo> | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        // Start a new worktree entry
        if (currentWorktree && currentWorktree.path) {
          worktrees.push(this.finalizeWorktreeInfo(currentWorktree));
        }
        currentWorktree = {
          path: line.substring('worktree '.length).trim(),
          isMain: false,
          isLocked: false,
        };
      } else if (line.startsWith('HEAD ')) {
        if (currentWorktree) {
          currentWorktree.commit = line.substring('HEAD '.length).trim();
        }
      } else if (line.startsWith('branch ')) {
        if (currentWorktree) {
          const branchRef = line.substring('branch '.length).trim();
          // Extract branch name from refs/heads/branch-name
          currentWorktree.branch = branchRef.replace('refs/heads/', '');
        }
      } else if (line.startsWith('bare')) {
        if (currentWorktree) {
          currentWorktree.isMain = true;
        }
      } else if (line.startsWith('locked ')) {
        if (currentWorktree) {
          currentWorktree.isLocked = true;
          currentWorktree.lockReason = line.substring('locked '.length).trim();
        }
      }
    }

    // Add the last worktree
    if (currentWorktree && currentWorktree.path) {
      worktrees.push(this.finalizeWorktreeInfo(currentWorktree));
    }

    return worktrees;
  }

  /**
   * Finalize worktree info with defaults
   *
   * @param partial - Partial worktree info
   * @returns Complete WorktreeInfo
   */
  private finalizeWorktreeInfo(partial: Partial<WorktreeInfo>): WorktreeInfo {
    return {
      path: partial.path || '',
      branch: partial.branch || '(detached)',
      commit: partial.commit || '',
      isMain: partial.isMain || false,
      isLocked: partial.isLocked || false,
      lockReason: partial.lockReason,
    };
  }

  async createBranch(
    repoPath: string,
    branchName: string,
    baseBranchOrCommit: string
  ): Promise<void> {
    const escapedBranch = this.escapeShellArg(branchName);
    const escapedBase = this.escapeShellArg(baseBranchOrCommit);

    const command = `git branch ${escapedBranch} ${escapedBase}`;
    this.execGit(command, repoPath);
  }

  async deleteBranch(
    repoPath: string,
    branchName: string,
    force = false
  ): Promise<void> {
    const escapedBranch = this.escapeShellArg(branchName);
    const flag = force ? '-D' : '-d';

    const command = `git branch ${flag} ${escapedBranch}`;
    this.execGit(command, repoPath);
  }

  async configureSparseCheckout(
    worktreePath: string,
    patterns: string[]
  ): Promise<void> {
    // Enable sparse-checkout
    this.execGit('git sparse-checkout init --cone', worktreePath);

    // Set patterns
    const escapedPatterns = patterns.map((p) => this.escapeShellArg(p)).join(' ');
    const command = `git sparse-checkout set ${escapedPatterns}`;
    this.execGit(command, worktreePath);
  }

  async isValidRepo(repoPath: string): Promise<boolean> {
    try {
      this.execGit('git rev-parse --git-dir', repoPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  async listBranches(repoPath: string): Promise<string[]> {
    const output = this.execGit(
      `git branch --list --all --format='%(refname:short)'`,
      repoPath
    );

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((branch) => {
        // Remove 'origin/' prefix if present for remote branches
        // This gives us both local and remote branch names in a consistent format
        return branch.replace(/^remotes\/origin\//, '');
      });
  }

  async getCurrentCommit(repoPath: string): Promise<string> {
    const output = this.execGit('git rev-parse HEAD', repoPath);
    return output.trim();
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const output = this.execGit('git rev-parse --abbrev-ref HEAD', repoPath);
      return output.trim();
    } catch (error) {
      // If we can't get the branch (detached HEAD, etc.), return '(detached)'
      return '(detached)';
    }
  }
}
