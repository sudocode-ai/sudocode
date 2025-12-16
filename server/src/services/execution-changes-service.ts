/**
 * Execution Changes Service
 *
 * Calculates code changes (file list + diff statistics) from execution commits.
 * Supports 3 scenarios:
 * - Committed changes (commit-to-commit diff)
 * - Uncommitted changes (working tree diff)
 * - No changes
 *
 * @module services/execution-changes-service
 */

import type Database from "better-sqlite3";
import { execSync } from "child_process";
import type {
  ExecutionChangesResult,
  FileChangeStat,
  ChangesSnapshot,
  Execution,
} from "@sudocode-ai/types";
import { getExecution } from "./executions.js";
import { existsSync, readFileSync } from "fs";

/**
 * Service for calculating code changes from execution commits
 */
export class ExecutionChangesService {
  constructor(
    private db: Database.Database,
    private repoPath: string
  ) {}

  /**
   * Get code changes for an execution
   *
   * For execution chains (follow-ups), automatically calculates accumulated changes
   * from the root execution to the current execution.
   *
   * @param executionId - Execution ID
   * @returns ExecutionChangesResult with both captured and current states
   */
  async getChanges(executionId: string): Promise<ExecutionChangesResult> {
    // 1. Load execution from database
    const execution = getExecution(this.db, executionId);
    if (!execution) {
      console.log(
        `[ExecutionChangesService] Execution not found: ${executionId}`
      );
      return {
        available: false,
        reason: "incomplete_execution",
      };
    }

    console.log(`[ExecutionChangesService] Execution ${executionId}:`, {
      status: execution.status,
      before_commit: execution.before_commit,
      after_commit: execution.after_commit,
      parent_execution_id: execution.parent_execution_id,
    });

    // 2. Validate status (must have started executing)
    // Allow running, completed, stopped, failed, cancelled - reject pending, preparing, paused
    const validStatuses = [
      "running",
      "completed",
      "stopped",
      "failed",
      "cancelled",
    ];
    if (!validStatuses.includes(execution.status)) {
      console.log(
        `[ExecutionChangesService] Execution not started: ${execution.status}`
      );
      return {
        available: false,
        reason: "incomplete_execution",
      };
    }

    // 3. Find root execution (for execution chains)
    const rootExecution = this.getRootExecution(execution);
    const beforeCommit = rootExecution.before_commit || execution.before_commit;

    console.log(
      `[ExecutionChangesService] Root execution ${rootExecution.id}:`,
      {
        before_commit: rootExecution.before_commit,
        after_commit: rootExecution.after_commit,
      }
    );
    console.log(
      `[ExecutionChangesService] Computed beforeCommit: ${beforeCommit}`
    );

    // 4. Validate before_commit exists (required for calculating any changes)
    if (!beforeCommit) {
      return {
        available: false,
        reason: "missing_commits",
      };
    }

    // 5. Get branch and worktree information
    const branchName = execution.branch_name;
    const executionMode = execution.mode as "worktree" | "local" | null;
    const worktreeExists = execution.worktree_path
      ? existsSync(execution.worktree_path)
      : false;

    // 6. Check if branch exists and get current HEAD
    // Always check the main repo for branch info (branches exist in main repo, not just worktrees)
    let branchExists = false;
    let currentBranchHead: string | null = null;

    if (branchName) {
      const branchInfo = this.getBranchInfo(branchName, this.repoPath);
      branchExists = branchInfo.exists;
      currentBranchHead = branchInfo.head;
    }

    // 7. Compute captured state (from root to current execution)
    let captured: ChangesSnapshot | undefined;
    let uncommittedSnapshot: ChangesSnapshot | undefined;
    const hasCommittedChanges =
      beforeCommit &&
      execution.after_commit &&
      execution.after_commit !== beforeCommit;

    if (hasCommittedChanges) {
      // Captured: committed changes (requires beforeCommit from root)
      const capturedResult = await this.getCommittedChanges(
        beforeCommit!,
        execution.after_commit!
      );
      if (!capturedResult.available) {
        // Preserve specific error reason (commits_not_found, etc.)
        return capturedResult;
      }
      if (capturedResult.changes) {
        captured = {
          files: capturedResult.changes.files,
          summary: capturedResult.changes.summary,
          commitRange: capturedResult.commitRange!,
          uncommitted: false,
        };
      }

      // Additionally check for uncommitted changes on top of committed changes
      const uncommittedResult = await this.getUncommittedChanges(
        execution.worktree_path
      );
      if (
        uncommittedResult.available &&
        uncommittedResult.changes &&
        uncommittedResult.changes.files.length > 0
      ) {
        uncommittedSnapshot = {
          files: uncommittedResult.changes.files,
          summary: uncommittedResult.changes.summary,
          commitRange: null,
          uncommitted: true,
        };
      }
    } else {
      // Captured: uncommitted changes only (or no changes at completion)
      const capturedResult = await this.getUncommittedChanges(
        execution.worktree_path
      );
      if (!capturedResult.available) {
        // Preserve specific error reason (worktree_deleted_with_uncommitted_changes, etc.)
        return capturedResult;
      }
      if (capturedResult.changes) {
        captured = {
          files: capturedResult.changes.files,
          summary: capturedResult.changes.summary,
          commitRange: null,
          uncommitted: true,
        };
      }
    }

    // 8. Compute current state (if branch exists and differs from captured)
    // Requires beforeCommit to calculate diff
    // Note: Use main repo for git operations (worktree may be deleted)
    let current: ChangesSnapshot | undefined;
    let additionalCommits = 0;

    if (branchExists && currentBranchHead && beforeCommit) {
      // Check if current HEAD is different from captured after_commit
      const isDifferent = currentBranchHead !== execution.after_commit;

      if (isDifferent && execution.after_commit) {
        // Count commits between captured and current
        // Always use main repo path (worktree may be deleted)
        additionalCommits = this.countCommitsBetween(
          execution.after_commit,
          currentBranchHead,
          this.repoPath
        );

        // Compute current changes (from root to current HEAD)
        const currentResult = await this.getCommittedChanges(
          beforeCommit,
          currentBranchHead
        );

        if (currentResult.available && currentResult.changes) {
          current = {
            files: currentResult.changes.files,
            summary: currentResult.changes.summary,
            commitRange: {
              before: beforeCommit,
              after: currentBranchHead,
            },
            uncommitted: false,
          };
        }
      }
    }

    // 9. Calculate commits ahead of target branch (for merge action visibility)
    let commitsAhead = 0;
    if (branchExists && currentBranchHead && execution.target_branch) {
      commitsAhead = this.countCommitsAhead(
        execution.target_branch,
        currentBranchHead,
        this.repoPath
      );
    }

    // 10. Return result with both states
    if (!captured) {
      return {
        available: false,
        reason: "git_error",
      };
    }

    return {
      available: true,
      captured,
      uncommittedSnapshot,
      current,
      branchName,
      branchExists,
      worktreeExists,
      executionMode,
      additionalCommits,
      commitsAhead,
      // Legacy compatibility
      changes: captured,
      commitRange: captured.commitRange,
      uncommitted: captured.uncommitted,
    };
  }

  /**
   * Get root execution by traversing parent_execution_id chain
   *
   * For execution chains (follow-ups), this finds the original root execution.
   * This allows us to calculate accumulated changes from the start of the chain.
   */
  private getRootExecution(execution: Execution): Execution {
    let current = execution;
    let maxDepth = 100; // Safety limit to prevent infinite loops
    let depth = 0;

    while (current.parent_execution_id && depth < maxDepth) {
      const parent = getExecution(this.db, current.parent_execution_id);
      if (!parent) {
        // Parent not found, return current as root
        break;
      }
      current = parent;
      depth++;
    }

    return current;
  }

  /**
   * Get committed changes (commit-to-commit diff)
   * Scenario A: after_commit exists and differs from before_commit
   */
  private async getCommittedChanges(
    beforeCommit: string,
    afterCommit: string
  ): Promise<ExecutionChangesResult> {
    try {
      // Verify commits exist in repo
      try {
        execSync(`git cat-file -t ${beforeCommit}`, {
          cwd: this.repoPath,
          encoding: "utf-8",
          stdio: "pipe",
        });
        execSync(`git cat-file -t ${afterCommit}`, {
          cwd: this.repoPath,
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch (error) {
        return {
          available: false,
          reason: "commits_not_found",
        };
      }

      // Get diff statistics
      const files = await this.calculateDiff(
        beforeCommit,
        afterCommit,
        this.repoPath
      );

      return {
        available: true,
        uncommitted: false,
        commitRange: {
          before: beforeCommit,
          after: afterCommit,
        },
        changes: {
          files,
          summary: this.calculateSummary(files),
          commitRange: {
            before: beforeCommit,
            after: afterCommit,
          },
          uncommitted: false,
        },
      };
    } catch (error) {
      console.error(
        "[ExecutionChangesService] Error getting committed changes:",
        error
      );
      return {
        available: false,
        reason: "git_error",
      };
    }
  }

  /**
   * Get uncommitted changes (working tree diff)
   * Scenario B: after_commit is null or equals before_commit
   */
  private async getUncommittedChanges(
    worktreePath: string | null
  ): Promise<ExecutionChangesResult> {
    // Determine the working directory to check
    const workDir = worktreePath || this.repoPath;

    // Check if worktree still exists
    if (worktreePath && !existsSync(worktreePath)) {
      return {
        available: false,
        reason: "worktree_deleted_with_uncommitted_changes",
      };
    }

    try {
      // Get uncommitted changes relative to HEAD
      const files = await this.calculateDiff(null, null, workDir);

      // If no files changed, return empty result
      if (files.length === 0) {
        return {
          available: true,
          uncommitted: true,
          commitRange: null,
          changes: {
            files: [],
            summary: {
              totalFiles: 0,
              totalAdditions: 0,
              totalDeletions: 0,
            },
            commitRange: null,
            uncommitted: true,
          },
        };
      }

      return {
        available: true,
        uncommitted: true,
        commitRange: null,
        changes: {
          files,
          summary: this.calculateSummary(files),
          commitRange: null,
          uncommitted: true,
        },
      };
    } catch (error) {
      console.error(
        "[ExecutionChangesService] Error getting uncommitted changes:",
        error
      );
      return {
        available: false,
        reason: "git_error",
      };
    }
  }

  /**
   * Calculate diff statistics using git commands
   *
   * @param beforeCommit - Before commit SHA (null for uncommitted)
   * @param afterCommit - After commit SHA (null for uncommitted)
   * @param workDir - Working directory for git commands
   * @returns Array of file change statistics
   */
  private async calculateDiff(
    beforeCommit: string | null,
    afterCommit: string | null,
    workDir: string
  ): Promise<FileChangeStat[]> {
    // Build git diff command based on scenario
    let numstatCmd: string;
    let nameStatusCmd: string;

    if (beforeCommit && afterCommit) {
      // Committed changes: commit-to-commit diff
      numstatCmd = `git diff --numstat --find-renames ${beforeCommit}..${afterCommit}`;
      nameStatusCmd = `git diff --name-status --find-renames ${beforeCommit}..${afterCommit}`;
    } else {
      // Uncommitted changes: working tree diff
      numstatCmd = `git diff --numstat --find-renames HEAD`;
      nameStatusCmd = `git diff --name-status --find-renames HEAD`;
    }

    // Execute git diff --numstat
    const numstatOutput = execSync(numstatCmd, {
      cwd: workDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    // Execute git diff --name-status
    const nameStatusOutput = execSync(nameStatusCmd, {
      cwd: workDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    // Parse outputs
    const numstatData = this.parseNumstat(numstatOutput);
    const statusData = this.parseNameStatus(nameStatusOutput);

    // Combine numstat and status data
    let files = this.combineFileData(numstatData, statusData);

    // For uncommitted changes, also include untracked files
    if (!beforeCommit && !afterCommit) {
      const untrackedFiles = this.getUntrackedFiles(workDir);
      files = files.concat(untrackedFiles);
    }

    return files;
  }

  /**
   * Parse git diff --numstat output
   *
   * Format: "additions\tdeletions\tfilepath"
   * Binary files: "-\t-\tfilepath"
   */
  private parseNumstat(
    output: string
  ): Map<string, { additions: number; deletions: number }> {
    const data = new Map<string, { additions: number; deletions: number }>();

    if (!output) {
      return data;
    }

    const lines = output.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split("\t");
      if (parts.length < 3) continue;

      const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
      const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
      const filePath = parts.slice(2).join("\t"); // Handle filenames with tabs

      data.set(filePath, { additions, deletions });
    }

    return data;
  }

  /**
   * Parse git diff --name-status output
   *
   * Format: "STATUS\tfilepath"
   * Renamed files: "R100\toldpath\tnewpath"
   */
  private parseNameStatus(output: string): Map<string, "A" | "M" | "D" | "R"> {
    const data = new Map<string, "A" | "M" | "D" | "R">();

    if (!output) {
      return data;
    }

    const lines = output.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split("\t");
      if (parts.length < 2) continue;

      const statusCode = parts[0];
      let status: "A" | "M" | "D" | "R";

      if (statusCode.startsWith("A")) {
        status = "A";
      } else if (statusCode.startsWith("M")) {
        status = "M";
      } else if (statusCode.startsWith("D")) {
        status = "D";
      } else if (statusCode.startsWith("R")) {
        status = "R";
      } else {
        // Default to modified for unknown status
        status = "M";
      }

      // For renamed files, use the new path (last part)
      const filePath = parts[parts.length - 1];
      data.set(filePath, status);
    }

    return data;
  }

  /**
   * Combine numstat and name-status data into FileChangeStat array
   */
  private combineFileData(
    numstatData: Map<string, { additions: number; deletions: number }>,
    statusData: Map<string, "A" | "M" | "D" | "R">
  ): FileChangeStat[] {
    const files: FileChangeStat[] = [];

    // Iterate through all files from numstat
    for (const [path, { additions, deletions }] of numstatData) {
      const status = statusData.get(path) || "M"; // Default to modified

      files.push({
        path,
        additions,
        deletions,
        status,
      });
    }

    return files;
  }

  /**
   * Calculate summary statistics from file changes
   */
  private calculateSummary(files: FileChangeStat[]): {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  } {
    return {
      totalFiles: files.length,
      totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
      totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
    };
  }

  /**
   * Get branch information (existence and current HEAD)
   */
  private getBranchInfo(
    branchName: string,
    workDir: string
  ): { exists: boolean; head: string | null } {
    try {
      // Try to get the commit SHA for the branch
      const head = execSync(`git rev-parse ${branchName}`, {
        cwd: workDir,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();

      return {
        exists: true,
        head,
      };
    } catch (error) {
      // Branch doesn't exist
      return {
        exists: false,
        head: null,
      };
    }
  }

  /**
   * Count commits between two commit SHAs
   */
  private countCommitsBetween(
    fromCommit: string,
    toCommit: string,
    workDir: string
  ): number {
    try {
      const output = execSync(
        `git rev-list --count ${fromCommit}..${toCommit}`,
        {
          cwd: workDir,
          encoding: "utf-8",
          stdio: "pipe",
        }
      ).trim();

      return parseInt(output, 10) || 0;
    } catch (error) {
      console.error("[ExecutionChangesService] Error counting commits:", error);
      return 0;
    }
  }

  /**
   * Count commits the branch is ahead of target branch
   * Uses merge-base to find the common ancestor
   */
  private countCommitsAhead(
    targetBranch: string,
    branchHead: string,
    workDir: string
  ): number {
    try {
      // Find the merge base between target branch and the current branch
      const mergeBase = execSync(
        `git merge-base ${targetBranch} ${branchHead}`,
        {
          cwd: workDir,
          encoding: "utf-8",
          stdio: "pipe",
        }
      ).trim();

      // Count commits from merge base to branch head
      const output = execSync(
        `git rev-list --count ${mergeBase}..${branchHead}`,
        {
          cwd: workDir,
          encoding: "utf-8",
          stdio: "pipe",
        }
      ).trim();

      return parseInt(output, 10) || 0;
    } catch (error) {
      console.error(
        "[ExecutionChangesService] Error counting commits ahead:",
        error
      );
      return 0;
    }
  }

  /**
   * Get untracked files (respecting .gitignore)
   */
  private getUntrackedFiles(workDir: string): FileChangeStat[] {
    try {
      // Get untracked files, excluding .gitignore patterns
      const output = execSync("git ls-files --others --exclude-standard", {
        cwd: workDir,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();

      if (!output) {
        return [];
      }

      const files: FileChangeStat[] = [];
      const lines = output.split("\n");

      for (const filePath of lines) {
        if (!filePath.trim()) continue;

        // Count lines in the file for additions
        const fullPath = `${workDir}/${filePath}`;
        let additions = 0;

        try {
          if (existsSync(fullPath)) {
            const content = readFileSync(fullPath, "utf-8");
            additions = content.split("\n").length;
          }
        } catch (error) {
          // If we can't read the file (binary, etc.), just set additions to 1
          additions = 1;
        }

        files.push({
          path: filePath,
          additions,
          deletions: 0,
          status: "A", // Untracked files are "Added"
        });
      }

      return files;
    } catch (error) {
      console.error(
        "[ExecutionChangesService] Error getting untracked files:",
        error
      );
      return [];
    }
  }

  /**
   * Get diff content for a specific file
   *
   * @param executionId - Execution ID
   * @param filePath - Path to the file
   * @returns Object with oldContent and newContent
   */
  async getFileDiff(
    executionId: string,
    filePath: string
  ): Promise<{
    success: boolean;
    oldContent?: string;
    newContent?: string;
    error?: string;
  }> {
    try {
      // 1. Load execution from database
      const execution = getExecution(this.db, executionId);
      if (!execution) {
        return { success: false, error: "Execution not found" };
      }

      // 2. Find root execution for before_commit
      const rootExecution = this.getRootExecution(execution);
      const beforeCommit =
        rootExecution.before_commit || execution.before_commit;
      const afterCommit = execution.after_commit;

      if (!beforeCommit) {
        return { success: false, error: "Missing before_commit" };
      }

      let oldContent = "";
      let newContent = "";

      // Normalize file path - remove leading './' if present
      const normalizedPath = filePath.startsWith("./")
        ? filePath.slice(2)
        : filePath;

      console.log(`[ExecutionChangesService] Getting diff for ${filePath}:`, {
        beforeCommit,
        afterCommit,
        worktreePath: execution.worktree_path,
        normalizedPath,
      });

      // 3. Get old content (from before_commit)
      try {
        const cmd = `git show ${beforeCommit}:${normalizedPath}`;
        console.log(`[ExecutionChangesService] Running: ${cmd}`);
        oldContent = execSync(cmd, {
          cwd: this.repoPath,
          encoding: "utf-8",
          stdio: "pipe",
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large files
        });
        console.log(
          `[ExecutionChangesService] Old content length: ${oldContent.length}`
        );
      } catch (error) {
        // File might not exist in before_commit (new file)
        console.log(
          `[ExecutionChangesService] Failed to get old content:`,
          error instanceof Error ? error.message : error
        );
        oldContent = "";
      }

      // 4. Get new content (depends on whether we have committed or uncommitted changes)
      if (afterCommit && afterCommit !== beforeCommit) {
        // Committed changes - get from after_commit
        console.log(
          `[ExecutionChangesService] Fetching new content from after_commit: ${afterCommit}`
        );
        try {
          const cmd = `git show ${afterCommit}:${normalizedPath}`;
          console.log(`[ExecutionChangesService] Running: ${cmd}`);
          newContent = execSync(cmd, {
            cwd: this.repoPath,
            encoding: "utf-8",
            stdio: "pipe",
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large files
          });
          console.log(
            `[ExecutionChangesService] New content length: ${newContent.length}`
          );
        } catch (error) {
          // File might have been deleted
          console.log(
            `[ExecutionChangesService] Failed to get new content:`,
            error instanceof Error ? error.message : error
          );
          newContent = "";
        }
      } else if (
        execution.worktree_path &&
        existsSync(execution.worktree_path)
      ) {
        // Uncommitted changes - get from working tree
        console.log(
          `[ExecutionChangesService] Fetching new content from worktree: ${execution.worktree_path}`
        );
        try {
          const { readFileSync } = await import("fs");
          const { join } = await import("path");
          const fullPath = join(execution.worktree_path, normalizedPath);
          console.log(`[ExecutionChangesService] Checking file: ${fullPath}`);
          if (existsSync(fullPath)) {
            newContent = readFileSync(fullPath, "utf-8");
            console.log(
              `[ExecutionChangesService] New content length: ${newContent.length}`
            );
          } else {
            // File might have been deleted
            console.log(`[ExecutionChangesService] File deleted in worktree`);
            newContent = "";
          }
        } catch (error) {
          return { success: false, error: `Failed to read file: ${error}` };
        }
      } else {
        // No after_commit and no worktree - use HEAD
        console.log(`[ExecutionChangesService] Fetching new content from HEAD`);
        try {
          newContent = execSync(`git show HEAD:${normalizedPath}`, {
            cwd: this.repoPath,
            encoding: "utf-8",
            stdio: "pipe",
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large files
          });
          console.log(
            `[ExecutionChangesService] New content length: ${newContent.length}`
          );
        } catch (error) {
          console.log(`[ExecutionChangesService] File deleted at HEAD`);
          newContent = "";
        }
      }

      console.log(
        `[ExecutionChangesService] Returning diff - oldContent: ${oldContent.length} chars, newContent: ${newContent.length} chars`
      );

      return {
        success: true,
        oldContent,
        newContent,
      };
    } catch (error) {
      console.error(
        "[ExecutionChangesService] Error getting file diff:",
        error
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
