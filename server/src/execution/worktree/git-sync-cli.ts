/**
 * Git Sync CLI Wrapper
 *
 * Extends git CLI operations with sync-specific functionality for worktree-to-local synchronization.
 * Provides conflict detection, diff analysis, and merge operations without modifying the working tree.
 *
 * @module execution/worktree/git-sync-cli
 */

import { execSync } from 'child_process';
import { WorktreeError, WorktreeErrorCode } from './types.js';

/**
 * Result of diff operation between two commits
 */
export interface DiffResult {
  files: string[];
  additions: number;
  deletions: number;
}

/**
 * Result of conflict check operation
 */
export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflictingFiles: string[];
}

/**
 * Result of cherry-pick operation
 */
export interface CherryPickResult {
  success: boolean;
  conflictingCommit?: string;
  conflictingFiles?: string[];
}

/**
 * Commit information
 */
export interface Commit {
  sha: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
}

/**
 * GitSyncCli - Git operations for worktree sync
 *
 * Provides sync-specific git operations:
 * - Merge base detection
 * - Diff analysis
 * - Conflict detection (dry-run)
 * - Squash merge
 * - Cherry-pick operations
 * - Working tree status checks
 */
export class GitSyncCli {
  constructor(private repoPath: string) {}

  /**
   * Execute a git command
   *
   * @param command - Git command to execute
   * @param cwd - Working directory (defaults to repoPath)
   * @returns Command output
   * @throws WorktreeError on failure
   */
  protected execGit(command: string, cwd?: string): string {
    try {
      return execSync(command, {
        cwd: cwd || this.repoPath,
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

  /**
   * Validate commit SHA format
   *
   * @param sha - Commit SHA to validate
   * @returns true if valid SHA format
   */
  private isValidSha(sha: string): boolean {
    return /^[0-9a-f]{40}$/.test(sha);
  }

  /**
   * Find common ancestor between two branches
   * Equivalent to: git merge-base <branch1> <branch2>
   *
   * @param branch1 - First branch name or commit SHA
   * @param branch2 - Second branch name or commit SHA
   * @returns Commit SHA of merge base
   * @throws WorktreeError if merge base cannot be found
   */
  getMergeBase(branch1: string, branch2: string): string {
    const escapedBranch1 = this.escapeShellArg(branch1);
    const escapedBranch2 = this.escapeShellArg(branch2);

    const command = `git merge-base ${escapedBranch1} ${escapedBranch2}`;
    const output = this.execGit(command);
    const sha = output.trim();

    if (!this.isValidSha(sha)) {
      throw new WorktreeError(
        `Invalid merge base SHA: ${sha}`,
        WorktreeErrorCode.GIT_ERROR
      );
    }

    return sha;
  }

  /**
   * Get diff between two commits
   * Equivalent to: git diff --name-status --numstat <from>..<to>
   *
   * @param fromCommit - Starting commit SHA
   * @param toCommit - Ending commit SHA
   * @returns Diff result with file list and line counts
   */
  getDiff(fromCommit: string, toCommit: string): DiffResult {
    const escapedFrom = this.escapeShellArg(fromCommit);
    const escapedTo = this.escapeShellArg(toCommit);

    // Get file list with status
    const nameStatusCmd = `git diff --name-status ${escapedFrom}..${escapedTo}`;
    const nameStatusOutput = this.execGit(nameStatusCmd);

    const files = nameStatusOutput
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        // Format: "M\tpath/to/file.ts" or "A\tpath/to/file.ts"
        const parts = line.split('\t');
        return parts[1] || '';
      })
      .filter((file) => file.length > 0);

    // Get line counts
    const numstatCmd = `git diff --numstat ${escapedFrom}..${escapedTo}`;
    const numstatOutput = this.execGit(numstatCmd);

    let additions = 0;
    let deletions = 0;

    numstatOutput
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => {
        // Format: "5\t3\tpath/to/file.ts"
        const parts = line.split('\t');
        const add = parseInt(parts[0], 10);
        const del = parseInt(parts[1], 10);

        if (!isNaN(add)) additions += add;
        if (!isNaN(del)) deletions += del;
      });

    return { files, additions, deletions };
  }

  /**
   * Check if merge would conflict WITHOUT modifying working tree
   * Detects files that changed in both branches since merge base
   *
   * @param sourceBranch - Source branch to merge from
   * @param targetBranch - Target branch to merge into
   * @returns Conflict check result
   */
  checkMergeConflicts(
    sourceBranch: string,
    targetBranch: string
  ): ConflictCheckResult {
    try {
      // Find merge base
      const mergeBase = this.getMergeBase(sourceBranch, targetBranch);

      // Get files changed in source branch since merge base
      const sourceFiles = this.getChangedFiles(mergeBase, sourceBranch);

      // Get files changed in target branch since merge base
      const targetFiles = this.getChangedFiles(mergeBase, targetBranch);

      // Files that changed in both branches are potential conflicts
      const conflictingFiles = sourceFiles.filter((file) =>
        targetFiles.includes(file)
      );

      return {
        hasConflicts: conflictingFiles.length > 0,
        conflictingFiles,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get list of files changed between two refs
   * Equivalent to: git diff --name-only <fromRef>..<toRef>
   *
   * @param fromRef - Starting reference
   * @param toRef - Ending reference
   * @returns Array of changed file paths
   */
  private getChangedFiles(fromRef: string, toRef: string): string[] {
    const escapedFrom = this.escapeShellArg(fromRef);
    const escapedTo = this.escapeShellArg(toRef);

    const command = `git diff --name-only ${escapedFrom}..${escapedTo}`;
    const output = this.execGit(command);

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Perform squash merge
   * Equivalent to: git merge --squash <source>
   *
   * Note: This modifies the working tree. Caller should ensure clean state.
   * The target branch must be the current checked-out branch.
   *
   * @param sourceBranch - Source branch to squash merge
   * @param message - Commit message for the squash commit
   * @throws WorktreeError if merge fails
   */
  squashMerge(sourceBranch: string, message: string): void {
    const escapedSource = this.escapeShellArg(sourceBranch);
    const escapedMessage = this.escapeShellArg(message);

    // Perform squash merge
    const mergeCommand = `git merge --squash ${escapedSource}`;
    this.execGit(mergeCommand);

    // Create commit with provided message
    const commitCommand = `git commit -m ${escapedMessage}`;
    this.execGit(commitCommand);
  }

  /**
   * Cherry-pick range of commits
   * Equivalent to: git cherry-pick <start>..<end>
   *
   * Note: This modifies the working tree. May stop on conflicts.
   *
   * @param startCommit - Starting commit SHA (exclusive)
   * @param endCommit - Ending commit SHA (inclusive)
   * @returns Cherry-pick result
   */
  cherryPickRange(startCommit: string, endCommit: string): CherryPickResult {
    const escapedStart = this.escapeShellArg(startCommit);
    const escapedEnd = this.escapeShellArg(endCommit);

    try {
      // Cherry-pick the range
      // Format: start..end means all commits reachable from end but not from start
      const command = `git cherry-pick ${escapedStart}..${escapedEnd}`;
      this.execGit(command);

      return { success: true };
    } catch (error: any) {
      // Check if it's a conflict
      const stderr = error.cause?.stderr?.toString() || '';

      if (stderr.includes('conflict') || stderr.includes('CONFLICT')) {
        // Get the commit that caused conflict
        const conflictingCommit = this.getCurrentCommit();

        // Get conflicting files
        const conflictingFiles = this.getConflictingFiles();

        return {
          success: false,
          conflictingCommit,
          conflictingFiles,
        };
      }

      // Some other error
      throw error;
    }
  }

  /**
   * Get list of commits between two refs
   * Equivalent to: git log --format='%H|%an|%ae|%at|%s' <base>..<head>
   *
   * @param baseRef - Base reference (exclusive)
   * @param headRef - Head reference (inclusive)
   * @returns Array of commits
   */
  getCommitList(baseRef: string, headRef: string): Commit[] {
    const escapedBase = this.escapeShellArg(baseRef);
    const escapedHead = this.escapeShellArg(headRef);

    // Format: SHA|author name|author email|timestamp|subject
    const command = `git log --format='%H|%an|%ae|%at|%s' ${escapedBase}..${escapedHead}`;
    const output = this.execGit(command);

    const commits: Commit[] = [];

    output
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => {
        const parts = line.split('|');
        if (parts.length >= 5) {
          commits.push({
            sha: parts[0],
            author: parts[1],
            email: parts[2],
            timestamp: parseInt(parts[3], 10),
            message: parts.slice(4).join('|'), // In case message contains |
          });
        }
      });

    return commits;
  }

  /**
   * Check if working tree is clean (no uncommitted changes)
   * Equivalent to: git status --porcelain
   *
   * @returns true if working tree is clean, false otherwise
   */
  isWorkingTreeClean(): boolean {
    try {
      const output = this.execGit('git status --porcelain');
      return output.trim().length === 0;
    } catch (error) {
      // If git status fails, assume not clean
      return false;
    }
  }

  /**
   * Create safety tag for rollback
   * Equivalent to: git tag -a <tagName> <ref> -m "message"
   *
   * @param tagName - Name of the tag (e.g., "sudocode-sync-before-abc123")
   * @param ref - Reference to tag (commit SHA or branch name)
   * @throws WorktreeError if tag creation fails
   */
  createSafetyTag(tagName: string, ref: string): void {
    const escapedTag = this.escapeShellArg(tagName);
    const escapedRef = this.escapeShellArg(ref);
    const message = this.escapeShellArg(`Safety snapshot before sync at ${ref}`);

    // Use -f to force update if tag already exists (e.g., after revert and re-sync)
    const command = `git tag -f -a ${escapedTag} ${escapedRef} -m ${message}`;
    this.execGit(command);
  }

  /**
   * Get list of uncommitted files, optionally filtered by pattern
   * Equivalent to: git status --porcelain [pattern]
   *
   * @param pattern - Optional glob pattern to filter files (e.g., "*.jsonl")
   * @returns Array of uncommitted file paths
   */
  getUncommittedFiles(pattern?: string): string[] {
    const escapedPattern = pattern ? this.escapeShellArg(pattern) : '';
    const command = `git status --porcelain ${escapedPattern}`.trim();

    const output = this.execGit(command);

    return output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        // Format: "XY filename" where XY is status code
        // Extract filename (handle spaces in filenames)
        const match = line.match(/^..\s+(.+)$/);
        return match ? match[1] : '';
      })
      .filter((file) => file.length > 0);
  }

  /**
   * Get current HEAD commit SHA
   * Equivalent to: git rev-parse HEAD
   *
   * @returns Current HEAD commit SHA
   */
  private getCurrentCommit(): string {
    const output = this.execGit('git rev-parse HEAD');
    return output.trim();
  }

  /**
   * Get list of files with merge conflicts
   * Equivalent to: git diff --name-only --diff-filter=U
   *
   * @returns Array of conflicting file paths
   */
  private getConflictingFiles(): string[] {
    try {
      const output = this.execGit('git diff --name-only --diff-filter=U');
      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (error) {
      return [];
    }
  }
}
