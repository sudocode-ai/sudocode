/**
 * Worktree Sync Service
 *
 * Orchestrates worktree sync operations including conflict detection,
 * JSONL resolution, git operations, and database updates.
 *
 * @module services/worktree-sync-service
 */

import type Database from "better-sqlite3";
import type { Execution, ExecutionStatus } from "@sudocode-ai/types";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { GitSyncCli, type DiffResult, type Commit } from "../execution/worktree/git-sync-cli.js";
import { ConflictDetector, type ConflictReport, type JSONLConflict } from "../execution/worktree/conflict-detector.js";
import { mergeThreeWay } from "@sudocode-ai/cli/dist/merge-resolver.js";
import { writeJSONL } from "@sudocode-ai/cli/dist/jsonl.js";

/**
 * Worktree sync error codes
 */
export enum WorktreeSyncErrorCode {
  NO_WORKTREE = "NO_WORKTREE",
  WORKTREE_MISSING = "WORKTREE_MISSING",
  BRANCH_MISSING = "BRANCH_MISSING",
  DIRTY_WORKING_TREE = "DIRTY_WORKING_TREE",
  TARGET_BRANCH_MISSING = "TARGET_BRANCH_MISSING",
  NO_COMMON_BASE = "NO_COMMON_BASE",
  CODE_CONFLICTS = "CODE_CONFLICTS",
  MERGE_FAILED = "MERGE_FAILED",
  JSONL_RESOLUTION_FAILED = "JSONL_RESOLUTION_FAILED",
  DATABASE_SYNC_FAILED = "DATABASE_SYNC_FAILED",
  EXECUTION_NOT_FOUND = "EXECUTION_NOT_FOUND",
}

/**
 * Worktree sync error class
 */
export class WorktreeSyncError extends Error {
  constructor(
    message: string,
    public code: WorktreeSyncErrorCode,
    public cause?: Error
  ) {
    super(message);
    this.name = "WorktreeSyncError";
  }
}

/**
 * Sync preview result
 */
export interface SyncPreviewResult {
  canSync: boolean;
  conflicts: ConflictReport;
  diff: DiffResult;
  commits: Commit[];
  mergeBase: string;
  uncommittedJSONLChanges: string[];
  executionStatus: ExecutionStatus;
  warnings: string[];
}

/**
 * Squash sync result
 */
export interface SyncResult {
  success: boolean;
  finalCommit?: string;
  filesChanged: number;
  conflictsResolved: number;
  uncommittedJSONLIncluded: boolean;
  error?: string;
  cleanupOffered?: boolean;
}

/**
 * WorktreeSyncService
 *
 * Main service class for orchestrating worktree sync operations
 */
export class WorktreeSyncService {
  private gitSync: GitSyncCli;
  private conflictDetector: ConflictDetector;

  constructor(
    private db: Database.Database,
    private repoPath: string
  ) {
    this.gitSync = new GitSyncCli(repoPath);
    this.conflictDetector = new ConflictDetector(repoPath);
  }

  /**
   * Preview sync without making changes
   *
   * @param executionId - Execution ID to preview sync for
   * @returns Preview result with conflicts, diff, and warnings
   */
  async previewSync(executionId: string): Promise<SyncPreviewResult> {
    // 1. Load execution and validate
    const execution = await this._loadAndValidateExecution(executionId);

    // 2. Validate preconditions
    try {
      await this._validateSyncPreconditions(execution);
    } catch (error: any) {
      // Return preview with error details
      return {
        canSync: false,
        conflicts: {
          hasConflicts: false,
          codeConflicts: [],
          jsonlConflicts: [],
          totalFiles: 0,
          summary: "",
        },
        diff: { files: [], additions: 0, deletions: 0 },
        commits: [],
        mergeBase: "",
        uncommittedJSONLChanges: [],
        executionStatus: execution.status,
        warnings: [error.message],
      };
    }

    // 3. Find merge base
    const mergeBase = this.gitSync.getMergeBase(
      execution.branch_name,
      execution.target_branch
    );

    // 4. Get commit list
    const commits = this.gitSync.getCommitList(mergeBase, execution.branch_name);

    // 5. Get diff summary
    const diff = this.gitSync.getDiff(mergeBase, execution.branch_name);

    // 6. Detect conflicts
    const conflicts = this.conflictDetector.detectConflicts(
      execution.branch_name,
      execution.target_branch
    );

    // 7. Check for uncommitted JSONL changes
    const uncommittedJSONL = this._getUncommittedJSONLFiles(
      execution.worktree_path!
    );

    // 8. Generate warnings
    const warnings: string[] = [];

    // Warn if execution is running/paused
    if (
      execution.status === "running" ||
      execution.status === "paused"
    ) {
      warnings.push(
        "Execution is currently active. Synced state may not reflect final execution result."
      );
    }

    // Warn about code conflicts
    if (conflicts.codeConflicts.length > 0) {
      warnings.push(
        `${conflicts.codeConflicts.length} code conflict(s) detected. Manual resolution required.`
      );
    }

    // Warn about uncommitted JSONL
    if (uncommittedJSONL.length > 0) {
      warnings.push(
        `${uncommittedJSONL.length} uncommitted JSONL file(s) will be included in sync.`
      );
    }

    // 9. Determine if sync can proceed
    const canSync = conflicts.codeConflicts.length === 0;

    return {
      canSync,
      conflicts,
      diff,
      commits,
      mergeBase,
      uncommittedJSONLChanges: uncommittedJSONL,
      executionStatus: execution.status,
      warnings,
    };
  }

  /**
   * Load execution from database and validate it exists
   *
   * Used by previewSync() and will be used in i-9gz4 (squash sync)
   *
   * @param executionId - Execution ID to load
   * @returns Execution record
   * @throws WorktreeSyncError if execution not found
   */
  private async _loadAndValidateExecution(
    executionId: string
  ): Promise<Execution> {
    const stmt = this.db.prepare("SELECT * FROM executions WHERE id = ?");
    const execution = stmt.get(executionId) as Execution | undefined;

    if (!execution) {
      throw new WorktreeSyncError(
        `Execution ${executionId} not found`,
        WorktreeSyncErrorCode.EXECUTION_NOT_FOUND
      );
    }

    return execution;
  }

  /**
   * Validate preconditions for sync
   *
   * Used by previewSync() and will be used in i-9gz4 (squash sync)
   *
   * Checks:
   * - Worktree exists
   * - Worktree branch exists
   * - Local working tree is clean
   * - Target branch exists
   * - Branches have common base
   *
   * @param execution - Execution to validate
   * @throws WorktreeSyncError if any precondition fails
   */
  private async _validateSyncPreconditions(execution: Execution): Promise<void> {
    // 1. Check worktree path exists
    if (!execution.worktree_path) {
      throw new WorktreeSyncError(
        "No worktree path for execution",
        WorktreeSyncErrorCode.NO_WORKTREE
      );
    }

    // 2. Check worktree still exists on filesystem
    if (!fs.existsSync(execution.worktree_path)) {
      throw new WorktreeSyncError(
        "Worktree no longer exists",
        WorktreeSyncErrorCode.WORKTREE_MISSING
      );
    }

    // 3. Get list of branches
    const branches = this._getBranches();

    // 4. Check worktree branch exists
    if (!branches.includes(execution.branch_name)) {
      throw new WorktreeSyncError(
        `Worktree branch '${execution.branch_name}' not found`,
        WorktreeSyncErrorCode.BRANCH_MISSING
      );
    }

    // 5. Check target branch exists
    if (!branches.includes(execution.target_branch)) {
      throw new WorktreeSyncError(
        `Target branch '${execution.target_branch}' not found`,
        WorktreeSyncErrorCode.TARGET_BRANCH_MISSING
      );
    }

    // 6. Check local working tree is clean
    if (!this.gitSync.isWorkingTreeClean()) {
      throw new WorktreeSyncError(
        "Local working tree has uncommitted changes. Stash or commit them first.",
        WorktreeSyncErrorCode.DIRTY_WORKING_TREE
      );
    }

    // 7. Verify branches have common base
    try {
      this.gitSync.getMergeBase(execution.branch_name, execution.target_branch);
    } catch (error: any) {
      throw new WorktreeSyncError(
        "Worktree and target branch have diverged without common history",
        WorktreeSyncErrorCode.NO_COMMON_BASE,
        error
      );
    }
  }

  /**
   * Create safety snapshot before sync
   *
   * Creates a git tag pointing to current target branch HEAD
   * for rollback capability
   *
   * @param executionId - Execution ID
   * @param targetBranch - Target branch name
   * @returns Tag name created
   */
  private async _createSafetySnapshot(
    executionId: string,
    targetBranch: string
  ): Promise<string> {
    const tagName = `sudocode-sync-before-${executionId}`;

    // Get current commit of target branch
    const currentCommit = this._getCurrentCommit(targetBranch);

    // Create annotated tag
    this.gitSync.createSafetyTag(tagName, currentCommit);

    return tagName;
  }

  /**
   * Get uncommitted JSONL files from worktree
   *
   * Used by previewSync() and will be used in i-3wmx (JSONL conflict resolution)
   *
   * @param worktreePath - Path to worktree
   * @returns Array of uncommitted JSONL file paths
   */
  private _getUncommittedJSONLFiles(worktreePath: string): string[] {
    const gitSyncWorktree = new GitSyncCli(worktreePath);

    // Get all uncommitted files
    const uncommitted = gitSyncWorktree.getUncommittedFiles();

    // Filter for JSONL files in .sudocode/
    return uncommitted.filter(
      (file) =>
        file.endsWith(".jsonl") &&
        (file.includes(".sudocode/") || file.startsWith(".sudocode/"))
    );
  }

  /**
   * Check if local working tree is clean
   *
   * TODO: Will be used in i-7ya6 (sync preview)
   *
   * @returns true if clean, false if dirty
   */
  // @ts-expect-error - Foundation method, will be used in i-7ya6
  private _isLocalTreeClean(): boolean {
    return this.gitSync.isWorkingTreeClean();
  }

  /**
   * Get list of branches in repository
   *
   * @returns Array of branch names
   */
  private _getBranches(): string[] {
    try {
      const output = execSync("git branch --format='%(refname:short)'", {
        cwd: this.repoPath,
        encoding: "utf8",
        stdio: "pipe",
        shell: "/bin/bash",
      });

      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (error: any) {
      throw new WorktreeSyncError(
        `Failed to get branch list: ${error.message}`,
        WorktreeSyncErrorCode.BRANCH_MISSING,
        error
      );
    }
  }

  /**
   * Get current commit SHA for a branch
   *
   * @param branchName - Branch name
   * @returns Commit SHA
   */
  private _getCurrentCommit(branchName: string): string {
    try {
      const output = execSync(
        `git rev-parse ${this._escapeShellArg(branchName)}`,
        {
          cwd: this.repoPath,
          encoding: "utf8",
          stdio: "pipe",
        }
      );

      return output.trim();
    } catch (error: any) {
      throw new WorktreeSyncError(
        `Failed to get commit for branch ${branchName}: ${error.message}`,
        WorktreeSyncErrorCode.BRANCH_MISSING,
        error
      );
    }
  }

  /**
   * Escape shell argument for safe command execution
   *
   * @param arg - Argument to escape
   * @returns Escaped argument
   */
  private _escapeShellArg(arg: string): string {
    // Escape single quotes and wrap in single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Resolve JSONL conflicts using three-way merge
   *
   * Used in squash sync to auto-resolve JSONL conflicts
   *
   * @param execution - Execution record
   * @param jsonlConflicts - List of JSONL conflicts to resolve
   * @throws WorktreeSyncError if resolution fails
   */
  async resolveJSONLConflicts(
    execution: Execution,
    jsonlConflicts: JSONLConflict[]
  ): Promise<void> {
    if (jsonlConflicts.length === 0) {
      return;
    }

    const mergeBase = this.gitSync.getMergeBase(
      execution.branch_name,
      execution.target_branch
    );

    for (const conflict of jsonlConflicts) {
      try {
        // Read three versions of the file
        const baseVersion = await this._readJSONLVersion(
          conflict.filePath,
          mergeBase
        );
        const ourVersion = await this._readJSONLVersion(
          conflict.filePath,
          execution.target_branch
        );
        const theirVersion = await this._readJSONLVersion(
          conflict.filePath,
          execution.branch_name
        );

        // Perform three-way merge
        const { entities: merged } = mergeThreeWay(
          baseVersion,
          ourVersion,
          theirVersion
        );

        // Write resolved version to local repo
        const resolvedPath = path.join(this.repoPath, conflict.filePath);
        await writeJSONL(resolvedPath, merged);

        // Stage the resolved file
        execSync(`git add ${this._escapeShellArg(conflict.filePath)}`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      } catch (error: any) {
        throw new WorktreeSyncError(
          `Failed to resolve JSONL conflict in ${conflict.filePath}: ${error.message}`,
          WorktreeSyncErrorCode.JSONL_RESOLUTION_FAILED,
          error
        );
      }
    }
  }

  /**
   * Read JSONL file at a specific git revision
   *
   * @param filePath - Relative path to JSONL file
   * @param revision - Git revision (commit SHA or branch name)
   * @returns Array of JSONL entities
   */
  private async _readJSONLVersion(
    filePath: string,
    revision: string
  ): Promise<any[]> {
    try {
      // Get file content at revision using git show
      const content = execSync(
        `git show ${this._escapeShellArg(revision)}:${this._escapeShellArg(filePath)}`,
        {
          cwd: this.repoPath,
          encoding: "utf8",
          stdio: "pipe",
        }
      );

      // Parse JSONL content
      const lines = content.split("\n").filter((line) => line.trim().length > 0);
      return lines.map((line) => JSON.parse(line));
    } catch (error: any) {
      // File might not exist at this revision (new file)
      if (error.status === 128) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Commit uncommitted JSONL files in worktree
   *
   * Used during sync to include uncommitted JSONL changes
   *
   * @param worktreePath - Path to worktree
   * @param uncommittedFiles - List of uncommitted JSONL file paths
   * @throws WorktreeSyncError if commit fails
   */
  async commitUncommittedJSONL(
    worktreePath: string,
    uncommittedFiles: string[]
  ): Promise<void> {
    if (uncommittedFiles.length === 0) {
      return;
    }

    try {
      // Stage all uncommitted JSONL files
      for (const file of uncommittedFiles) {
        execSync(`git add ${this._escapeShellArg(file)}`, {
          cwd: worktreePath,
          stdio: "pipe",
        });
      }

      // Create commit with descriptive message
      const fileList = uncommittedFiles.join(", ");
      const message = `Auto-commit uncommitted JSONL changes before sync\n\nFiles: ${fileList}`;

      execSync(`git commit -m ${this._escapeShellArg(message)}`, {
        cwd: worktreePath,
        stdio: "pipe",
      });
    } catch (error: any) {
      throw new WorktreeSyncError(
        `Failed to commit uncommitted JSONL files: ${error.message}`,
        WorktreeSyncErrorCode.DATABASE_SYNC_FAILED,
        error
      );
    }
  }

  /**
   * Perform git merge --squash operation
   *
   * @param sourceBranch - Branch to merge from (worktree branch)
   * @param targetBranch - Branch to merge into
   * @returns Object with filesChanged count
   * @throws WorktreeSyncError if merge fails
   */
  private _performSquashMerge(
    sourceBranch: string,
    targetBranch: string
  ): { filesChanged: number } {
    try {
      // Checkout target branch
      execSync(`git checkout ${this._escapeShellArg(targetBranch)}`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });

      // Perform squash merge
      execSync(`git merge --squash ${this._escapeShellArg(sourceBranch)}`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });

      // Count staged files
      const statusOutput = execSync("git diff --cached --name-only", {
        cwd: this.repoPath,
        encoding: "utf8",
        stdio: "pipe",
      });

      const filesChanged = statusOutput
        .split("\n")
        .filter((line) => line.trim().length > 0).length;

      return { filesChanged };
    } catch (error: any) {
      throw new WorktreeSyncError(
        `Failed to perform squash merge: ${error.message}`,
        WorktreeSyncErrorCode.MERGE_FAILED,
        error
      );
    }
  }

  /**
   * Generate commit message for squash sync
   *
   * @param execution - Execution record
   * @param commitCount - Number of commits being squashed
   * @returns Generated commit message
   */
  private _generateCommitMessage(
    execution: Execution,
    commitCount: number
  ): string {
    const issueId = execution.issue_id || "unknown";
    const branchName = execution.branch_name;

    return `Squash merge from ${branchName} (${commitCount} commit${commitCount !== 1 ? "s" : ""})

Issue: ${issueId}
Execution: ${execution.id}

Synced changes from worktree execution.`;
  }

  /**
   * Create commit with staged changes
   *
   * @param message - Commit message
   * @returns Commit SHA
   * @throws WorktreeSyncError if commit fails
   */
  private _createCommit(message: string): string {
    try {
      execSync(`git commit -m ${this._escapeShellArg(message)}`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });

      // Get the commit SHA
      const sha = execSync("git rev-parse HEAD", {
        cwd: this.repoPath,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();

      return sha;
    } catch (error: any) {
      throw new WorktreeSyncError(
        `Failed to create commit: ${error.message}`,
        WorktreeSyncErrorCode.MERGE_FAILED,
        error
      );
    }
  }

  /**
   * Rollback to safety snapshot
   *
   * @param targetBranch - Target branch to reset
   * @param tagName - Safety tag to rollback to
   * @throws WorktreeSyncError if rollback fails
   */
  private async _rollbackToSnapshot(
    targetBranch: string,
    tagName: string
  ): Promise<void> {
    try {
      // Checkout target branch
      execSync(`git checkout ${this._escapeShellArg(targetBranch)}`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });

      // Reset to tag
      execSync(`git reset --hard ${this._escapeShellArg(tagName)}`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });

      console.log(`Rolled back ${targetBranch} to ${tagName}`);
    } catch (error: any) {
      throw new WorktreeSyncError(
        `Failed to rollback to snapshot ${tagName}: ${error.message}`,
        WorktreeSyncErrorCode.MERGE_FAILED,
        error
      );
    }
  }

  /**
   * Perform squash sync operation
   *
   * Squashes all worktree commits into a single commit on the target branch.
   * Auto-resolves JSONL conflicts but blocks on code conflicts.
   *
   * @param executionId - Execution ID to sync
   * @param customCommitMessage - Optional custom commit message
   * @returns Sync result with details
   * @throws WorktreeSyncError if sync fails
   */
  async squashSync(
    executionId: string,
    customCommitMessage?: string
  ): Promise<SyncResult> {
    // 1. Load and validate execution
    const execution = await this._loadAndValidateExecution(executionId);

    // 2. Validate preconditions
    await this._validateSyncPreconditions(execution);

    // 3. Preview sync to check for conflicts
    const preview = await this.previewSync(executionId);

    // 4. Block if code conflicts exist
    if (preview.conflicts.codeConflicts.length > 0) {
      return {
        success: false,
        filesChanged: 0,
        conflictsResolved: 0,
        uncommittedJSONLIncluded: false,
        error: `Cannot sync: ${preview.conflicts.codeConflicts.length} code conflict(s) detected. Please resolve manually.`,
      };
    }

    let safetyTag: string | undefined;

    try {
      // 5. Handle uncommitted JSONL files
      const uncommittedJSONL = preview.uncommittedJSONLChanges;
      if (uncommittedJSONL.length > 0) {
        await this.commitUncommittedJSONL(
          execution.worktree_path!,
          uncommittedJSONL
        );
      }

      // 6. Create safety snapshot
      safetyTag = await this._createSafetySnapshot(
        executionId,
        execution.target_branch
      );

      // 7. Perform git merge --squash
      const mergeResult = this._performSquashMerge(
        execution.branch_name,
        execution.target_branch
      );

      // 8. Resolve JSONL conflicts
      let conflictsResolved = 0;
      if (preview.conflicts.jsonlConflicts.length > 0) {
        await this.resolveJSONLConflicts(
          execution,
          preview.conflicts.jsonlConflicts
        );
        conflictsResolved = preview.conflicts.jsonlConflicts.length;
      }

      // 9. Generate commit message
      const commitMessage =
        customCommitMessage ||
        this._generateCommitMessage(execution, preview.commits.length);

      // 10. Create commit
      const finalCommit = this._createCommit(commitMessage);

      // 11. Return success result
      return {
        success: true,
        finalCommit,
        filesChanged: mergeResult.filesChanged,
        conflictsResolved,
        uncommittedJSONLIncluded: uncommittedJSONL.length > 0,
        cleanupOffered: true,
      };
    } catch (error: any) {
      // Rollback to safety snapshot on failure
      if (safetyTag) {
        try {
          await this._rollbackToSnapshot(execution.target_branch, safetyTag);
        } catch (rollbackError: any) {
          console.error(
            `Failed to rollback to snapshot ${safetyTag}:`,
            rollbackError
          );
        }
      }

      throw new WorktreeSyncError(
        `Squash sync failed: ${error.message}`,
        WorktreeSyncErrorCode.MERGE_FAILED,
        error
      );
    }
  }

  /**
   * Perform stage sync operation
   *
   * Applies all worktree changes to the working directory without committing.
   * Changes are left staged, ready for the user to commit manually.
   *
   * @param executionId - Execution ID to sync
   * @returns Sync result with details
   * @throws WorktreeSyncError if sync fails
   */
  async stageSync(executionId: string): Promise<SyncResult> {
    // 1. Load and validate execution
    const execution = await this._loadAndValidateExecution(executionId);

    // 2. Validate preconditions
    await this._validateSyncPreconditions(execution);

    // 3. Preview sync to check for conflicts
    const preview = await this.previewSync(executionId);

    // 4. Block if code conflicts exist
    if (preview.conflicts.codeConflicts.length > 0) {
      return {
        success: false,
        filesChanged: 0,
        conflictsResolved: 0,
        uncommittedJSONLIncluded: false,
        error: `Cannot sync: ${preview.conflicts.codeConflicts.length} code conflict(s) detected. Please resolve manually.`,
      };
    }

    let safetyTag: string | undefined;

    try {
      // 5. Handle uncommitted JSONL files
      const uncommittedJSONL = preview.uncommittedJSONLChanges;
      if (uncommittedJSONL.length > 0) {
        await this.commitUncommittedJSONL(
          execution.worktree_path!,
          uncommittedJSONL
        );
      }

      // 6. Create safety snapshot
      safetyTag = await this._createSafetySnapshot(
        executionId,
        execution.target_branch
      );

      // 7. Perform git merge --squash (this stages but doesn't commit)
      const mergeResult = this._performSquashMerge(
        execution.branch_name,
        execution.target_branch
      );

      // 8. Resolve JSONL conflicts
      let conflictsResolved = 0;
      if (preview.conflicts.jsonlConflicts.length > 0) {
        await this.resolveJSONLConflicts(
          execution,
          preview.conflicts.jsonlConflicts
        );
        conflictsResolved = preview.conflicts.jsonlConflicts.length;
      }

      // 9. Return success result WITHOUT creating a commit
      // Changes remain staged for user to commit manually
      return {
        success: true,
        filesChanged: mergeResult.filesChanged,
        conflictsResolved,
        uncommittedJSONLIncluded: uncommittedJSONL.length > 0,
        cleanupOffered: true,
      };
    } catch (error: any) {
      // Rollback to safety snapshot on failure
      if (safetyTag) {
        try {
          await this._rollbackToSnapshot(execution.target_branch, safetyTag);
        } catch (rollbackError: any) {
          console.error(
            `Failed to rollback to snapshot ${safetyTag}:`,
            rollbackError
          );
        }
      }

      throw new WorktreeSyncError(
        `Stage sync failed: ${error.message}`,
        WorktreeSyncErrorCode.MERGE_FAILED,
        error
      );
    }
  }
}
