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
import {
  GitSyncCli,
  type DiffResult,
  type Commit,
} from "../execution/worktree/git-sync-cli.js";
import {
  ConflictDetector,
  type ConflictReport,
  type JSONLConflict,
} from "../execution/worktree/conflict-detector.js";
import {
  mergeThreeWay,
  hasGitConflictMarkers,
  parseMergeConflictFile,
} from "@sudocode-ai/cli/dist/merge-resolver.js";
import {
  writeJSONL,
  readJSONLSync,
  type JSONLEntity,
} from "@sudocode-ai/cli/dist/jsonl.js";
import * as os from "os";

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
 * Uncommitted file stats for preview
 */
export interface UncommittedFileStats {
  files: string[];
  additions: number;
  deletions: number;
}

/**
 * Info about potential local conflicts when including uncommitted files
 */
export interface PotentialLocalConflicts {
  /** Number of files that may have merge conflicts */
  count: number;
  /** List of files that may have merge conflicts */
  files: string[];
}

/**
 * Info about local uncommitted JSONL files that will be auto-merged during sync
 */
export interface LocalUncommittedJsonl {
  /** List of uncommitted JSONL files in the local working tree */
  files: string[];
  /** Whether these files will be auto-merged during sync */
  willAutoMerge: boolean;
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
  /** @deprecated Use uncommittedChanges instead */
  uncommittedJSONLChanges: string[];
  /** Stats about uncommitted changes in worktree (not included in sync by default) */
  uncommittedChanges?: UncommittedFileStats;
  /** Files that may have merge conflicts if "include uncommitted" is selected */
  potentialLocalConflicts?: PotentialLocalConflicts;
  /** Local uncommitted JSONL files that will be auto-merged during sync */
  localUncommittedJsonl?: LocalUncommittedJsonl;
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
  /** Whether there are unresolved merge conflicts (user must resolve manually) */
  hasConflicts?: boolean;
  /** List of files that have merge conflicts requiring manual resolution */
  filesWithConflicts?: string[];
  /** Number of uncommitted files copied from worktree (stage sync only) */
  uncommittedFilesIncluded?: number;
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

  constructor(
    private db: Database.Database,
    private repoPath: string
  ) {
    this.gitSync = new GitSyncCli(repoPath);
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

    // 2. Validate critical preconditions (ones that prevent us from getting any info)
    // These are "hard" failures - we can't get diff/commits if these fail
    const criticalPreconditionError =
      await this._validateCriticalPreconditions(execution);
    if (criticalPreconditionError) {
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
        uncommittedChanges: { files: [], additions: 0, deletions: 0 },
        executionStatus: execution.status,
        warnings: [criticalPreconditionError],
      };
    }

    // 3. Create ConflictDetector instance for worktree context
    const worktreeConflictDetector = new ConflictDetector(
      execution.worktree_path!
    );

    // 4. Find merge base (use main repo since it has both branches)
    const mergeBase = this.gitSync.getMergeBase(
      execution.branch_name,
      execution.target_branch
    );

    // 4. Get commit list
    const commits = this.gitSync.getCommitList(
      mergeBase,
      execution.branch_name
    );

    // 6. Get diff summary (use main repo to see all changes)
    const diff = this.gitSync.getDiff(mergeBase, execution.branch_name);

    // 7. Detect conflicts (use worktree for conflict detection)
    const conflicts = worktreeConflictDetector.detectConflicts(
      execution.branch_name,
      execution.target_branch
    );

    // 7. Check for uncommitted changes in worktree (not included by default)
    const uncommittedFiles = this._getUncommittedFiles(
      execution.worktree_path!
    );
    const uncommittedJSONL = uncommittedFiles.filter(
      (file) =>
        file.endsWith(".jsonl") &&
        (file.includes(".sudocode/") || file.startsWith(".sudocode/"))
    );
    const uncommittedChanges = this._getUncommittedFileStats(
      execution.worktree_path!
    );

    // 8. Generate warnings and check "soft" preconditions
    const warnings: string[] = [];
    let canSync = true;

    // Check local working tree status (categorizes JSONL vs other uncommitted changes)
    const localWorkingTreeStatus = this.gitSync.getWorkingTreeStatus();
    let localUncommittedJsonl: LocalUncommittedJsonl | undefined;

    if (!localWorkingTreeStatus.isClean) {
      if (localWorkingTreeStatus.hasOnlyJsonlChanges) {
        // Only JSONL files uncommitted - can still sync, will auto-merge
        localUncommittedJsonl = {
          files: localWorkingTreeStatus.uncommittedJsonlFiles,
          willAutoMerge: true,
        };
        // Don't add warning - info will be shown in UI
      } else {
        // Non-JSONL files are uncommitted - block sync
        warnings.push(
          "Local working tree has uncommitted changes. Stash or commit them first."
        );
        canSync = false;
        // Still include JSONL info for context
        if (localWorkingTreeStatus.uncommittedJsonlFiles.length > 0) {
          localUncommittedJsonl = {
            files: localWorkingTreeStatus.uncommittedJsonlFiles,
            willAutoMerge: false, // Can't auto-merge if there are other uncommitted files
          };
        }
      }
    }

    // Warn if execution is running/paused
    if (execution.status === "running" || execution.status === "paused") {
      warnings.push(
        "Execution is currently active. Synced state may not reflect final execution result."
      );
    }

    // Warn about code conflicts
    if (conflicts.codeConflicts.length > 0) {
      warnings.push(
        `${conflicts.codeConflicts.length} code conflict(s) detected. Manual resolution may be required.`
      );
    }

    // Note about uncommitted files (not included by default)
    // if (uncommittedChanges && uncommittedChanges.files.length > 0) {
    //   warnings.push(
    //     `${uncommittedChanges.files.length} uncommitted file(s) in worktree will NOT be included (only committed changes are synced).`
    //   );
    // }

    // 9. Detect potential local conflicts for uncommitted files
    // These are files in worktree that also have local changes or are untracked locally
    const potentialLocalConflicts = this._detectPotentialLocalConflicts(
      uncommittedChanges?.files || []
    );

    return {
      canSync,
      conflicts,
      diff,
      commits,
      mergeBase,
      uncommittedJSONLChanges: uncommittedJSONL,
      uncommittedChanges,
      potentialLocalConflicts,
      localUncommittedJsonl,
      executionStatus: execution.status,
      warnings,
    };
  }

  /**
   * Validate critical preconditions that prevent us from getting any sync info
   *
   * These are "hard" failures - if these fail, we can't get diff/commits info.
   * Returns an error message if validation fails, null if validation passes.
   *
   * @param execution - Execution to validate
   * @returns Error message if validation fails, null if validation passes
   */
  private async _validateCriticalPreconditions(
    execution: Execution
  ): Promise<string | null> {
    // 1. Check worktree path exists
    if (!execution.worktree_path) {
      return "No worktree path for execution";
    }

    // 2. Check worktree still exists on filesystem
    if (!fs.existsSync(execution.worktree_path)) {
      return "Worktree no longer exists";
    }

    // 3. Get list of branches
    const branches = this._getBranches();

    // 4. Check worktree branch exists
    if (!branches.includes(execution.branch_name)) {
      return `Worktree branch '${execution.branch_name}' not found`;
    }

    // 5. Check target branch exists
    if (!branches.includes(execution.target_branch)) {
      return `Target branch '${execution.target_branch}' not found`;
    }

    // 6. Verify branches have common base
    try {
      this.gitSync.getMergeBase(execution.branch_name, execution.target_branch);
    } catch (error: any) {
      return "Worktree and target branch have diverged without common history";
    }

    return null;
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
   * - Local working tree is clean (or only has JSONL changes which can be auto-merged)
   * - Target branch exists
   * - Branches have common base
   *
   * @param execution - Execution to validate
   * @param options - Options to control validation behavior
   * @param options.skipDirtyWorkingTreeCheck - Skip the dirty working tree check entirely
   * @param options.allowJsonlOnlyChanges - Allow sync if only JSONL files are uncommitted (they'll be auto-merged)
   * @throws WorktreeSyncError if any precondition fails
   */
  private async _validateSyncPreconditions(
    execution: Execution,
    options?: { skipDirtyWorkingTreeCheck?: boolean; allowJsonlOnlyChanges?: boolean }
  ): Promise<void> {
    const { skipDirtyWorkingTreeCheck = false, allowJsonlOnlyChanges = false } = options || {};

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

    // 6. Check local working tree is clean (skip for stage mode since it doesn't commit)
    if (!skipDirtyWorkingTreeCheck) {
      const workingTreeStatus = this.gitSync.getWorkingTreeStatus();

      if (!workingTreeStatus.isClean) {
        // If only JSONL files are uncommitted and allowJsonlOnlyChanges is true, allow sync
        if (allowJsonlOnlyChanges && workingTreeStatus.hasOnlyJsonlChanges) {
          // This is OK - JSONL files will be auto-merged
        } else if (workingTreeStatus.uncommittedOtherFiles.length > 0) {
          // Non-JSONL files are uncommitted - block sync
          throw new WorktreeSyncError(
            "Local working tree has uncommitted changes. Stash or commit them first.",
            WorktreeSyncErrorCode.DIRTY_WORKING_TREE
          );
        } else {
          // Only JSONL files but allowJsonlOnlyChanges is false - block sync
          throw new WorktreeSyncError(
            "Local working tree has uncommitted changes. Stash or commit them first.",
            WorktreeSyncErrorCode.DIRTY_WORKING_TREE
          );
        }
      }
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
   * Saved state of uncommitted JSONL files for restoration after merge
   */
  private _savedUncommittedJsonl: Map<
    string,
    { uncommittedContent: string; preCommittedContent: string }
  > | null = null;

  /**
   * Save uncommitted JSONL files before merge operation
   *
   * Reads both the uncommitted (working tree) and committed (HEAD) versions
   * of each JSONL file, then resets the working tree copy to HEAD.
   * The saved versions can be restored with _restoreUncommittedJsonl().
   *
   * @returns Map of file paths to their uncommitted and pre-committed content
   */
  private async _saveUncommittedJsonl(): Promise<
    Map<string, { uncommittedContent: string; preCommittedContent: string }>
  > {
    const status = this.gitSync.getWorkingTreeStatus();
    const savedFiles = new Map<
      string,
      { uncommittedContent: string; preCommittedContent: string }
    >();

    for (const filePath of status.uncommittedJsonlFiles) {
      const fullPath = path.join(this.repoPath, filePath);

      // Read current uncommitted content from working tree
      let uncommittedContent = "";
      if (fs.existsSync(fullPath)) {
        uncommittedContent = fs.readFileSync(fullPath, "utf8");
      }

      // Read committed version from HEAD
      let preCommittedContent = "";
      try {
        preCommittedContent = execSync(
          `git show HEAD:${this._escapeShellArg(filePath)}`,
          {
            cwd: this.repoPath,
            encoding: "utf8",
            stdio: "pipe",
          }
        );
      } catch {
        // File might not exist at HEAD (new file), use empty content
        preCommittedContent = "";
      }

      savedFiles.set(filePath, { uncommittedContent, preCommittedContent });

      // Reset the file to HEAD so it doesn't interfere with merge
      try {
        execSync(`git checkout HEAD -- ${this._escapeShellArg(filePath)}`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      } catch {
        // If file doesn't exist at HEAD, remove it from working tree
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    }

    this._savedUncommittedJsonl = savedFiles;
    return savedFiles;
  }

  /**
   * Restore uncommitted JSONL files after merge operation
   *
   * Performs a three-way merge:
   * - base: pre-merge committed version (from HEAD before merge)
   * - ours: saved uncommitted local changes
   * - theirs: post-merge result
   *
   * The merged result is written back to the working tree.
   */
  private async _restoreUncommittedJsonl(): Promise<void> {
    if (!this._savedUncommittedJsonl || this._savedUncommittedJsonl.size === 0) {
      return;
    }

    for (const [filePath, saved] of this._savedUncommittedJsonl) {
      const fullPath = path.join(this.repoPath, filePath);

      // Read post-merge version from working tree
      let postMergeContent = "";
      if (fs.existsSync(fullPath)) {
        postMergeContent = fs.readFileSync(fullPath, "utf8");
      }

      // Parse all three versions as JSONL entities
      const parseJsonl = (content: string): JSONLEntity[] => {
        if (!content.trim()) return [];
        return content
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter((entity): entity is JSONLEntity => entity !== null);
      };

      const baseEntities = parseJsonl(saved.preCommittedContent);
      const oursEntities = parseJsonl(saved.uncommittedContent);
      const theirsEntities = parseJsonl(postMergeContent);

      // Perform three-way merge using the merge resolver
      const { entities: merged } = mergeThreeWay(
        baseEntities,
        oursEntities,
        theirsEntities
      );

      // Write merged result back to working tree
      await writeJSONL(fullPath, merged);
    }

    // Clear saved state
    this._savedUncommittedJsonl = null;
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
   * Get all uncommitted files from worktree
   *
   * @param worktreePath - Path to worktree
   * @returns Array of all uncommitted file paths
   */
  private _getUncommittedFiles(worktreePath: string): string[] {
    const gitSyncWorktree = new GitSyncCli(worktreePath);
    return gitSyncWorktree.getUncommittedFiles();
  }

  /**
   * Get uncommitted file stats from worktree
   *
   * Returns list of files and aggregate additions/deletions stats
   * for uncommitted changes in the worktree.
   *
   * @param worktreePath - Path to worktree
   * @returns Uncommitted file stats
   */
  private _getUncommittedFileStats(worktreePath: string): UncommittedFileStats {
    try {
      // Get modified files
      const modifiedOutput = execSync("git diff --numstat", {
        cwd: worktreePath,
        encoding: "utf8",
        stdio: "pipe",
      });

      // Get untracked files
      const untrackedFiles = execSync(
        "git ls-files --others --exclude-standard",
        {
          cwd: worktreePath,
          encoding: "utf8",
          stdio: "pipe",
        }
      )
        .split("\n")
        .filter((line) => line.trim().length > 0);

      // Parse modified file stats
      let additions = 0;
      let deletions = 0;
      const modifiedFiles: string[] = [];

      for (const line of modifiedOutput.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const add = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
          const del = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
          additions += add;
          deletions += del;
          modifiedFiles.push(parts[2]);
        }
      }

      // Count lines in untracked files as additions
      for (const filePath of untrackedFiles) {
        try {
          const fullPath = path.join(worktreePath, filePath);
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const content = fs.readFileSync(fullPath, "utf-8");
            additions += content.split("\n").length;
          }
        } catch (e) {
          // Skip files we can't read
        }
      }

      // Combine all files
      const allFiles = [...new Set([...modifiedFiles, ...untrackedFiles])];

      return {
        files: allFiles,
        additions,
        deletions,
      };
    } catch (error) {
      // Return empty stats on error
      return {
        files: [],
        additions: 0,
        deletions: 0,
      };
    }
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
      const lines = content
        .split("\n")
        .filter((line) => line.trim().length > 0);
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
   * Perform git merge --squash operation, allowing conflicts
   *
   * This method doesn't throw on conflicts.
   * Instead, it returns information about whether conflicts occurred.
   *
   * @param sourceBranch - Branch to merge from (worktree branch)
   * @param targetBranch - Branch to merge into
   * @returns Object with filesChanged count and hasConflicts flag
   */
  private _performSquashMergeAllowConflicts(
    sourceBranch: string,
    targetBranch: string
  ): { filesChanged: number; hasConflicts: boolean } {
    // Checkout target branch
    execSync(`git checkout ${this._escapeShellArg(targetBranch)}`, {
      cwd: this.repoPath,
      stdio: "pipe",
    });

    // Perform squash merge - may fail with conflicts
    let hasConflicts = false;
    try {
      execSync(`git merge --squash ${this._escapeShellArg(sourceBranch)}`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });
    } catch (error: any) {
      // Check if this is a conflict situation (exit code 1) or a real error
      // git merge --squash returns 1 on conflicts but stages what it can
      hasConflicts = true;
    }

    // Count staged files (including conflicted ones)
    const statusOutput = execSync("git diff --cached --name-only", {
      cwd: this.repoPath,
      encoding: "utf8",
      stdio: "pipe",
    });

    const filesChanged = statusOutput
      .split("\n")
      .filter((line) => line.trim().length > 0).length;

    // Check for actual conflicts in the working tree
    try {
      const conflictCheck = execSync("git diff --name-only --diff-filter=U", {
        cwd: this.repoPath,
        encoding: "utf8",
        stdio: "pipe",
      });
      hasConflicts = conflictCheck.trim().length > 0;
    } catch (e) {
      // If this fails, assume no conflicts
    }

    return { filesChanged, hasConflicts };
  }

  /**
   * Check if a file has local uncommitted changes compared to HEAD
   *
   * @param filePath - Relative path to the file
   * @returns true if file has uncommitted changes, false otherwise
   */
  private _hasLocalUncommittedChanges(filePath: string): boolean {
    try {
      // git diff --quiet exits with 1 if there are changes, 0 if clean
      execSync(`git diff --quiet HEAD -- ${this._escapeShellArg(filePath)}`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });
      return false; // Exit 0 = no changes
    } catch {
      return true; // Exit 1 = has changes
    }
  }

  /**
   * Detect potential local conflicts for uncommitted worktree files
   *
   * Checks which uncommitted worktree files also exist locally with changes
   * or are untracked locally. These files may have merge conflicts when synced.
   *
   * @param worktreeFiles - List of uncommitted files in worktree
   * @returns Info about files that may have conflicts
   */
  private _detectPotentialLocalConflicts(
    worktreeFiles: string[]
  ): PotentialLocalConflicts {
    const conflictFiles: string[] = [];

    for (const filePath of worktreeFiles) {
      const localPath = path.join(this.repoPath, filePath);
      const localFileExists = fs.existsSync(localPath);

      if (localFileExists) {
        // Check if local file has uncommitted changes vs HEAD or is untracked
        const hasChangesVsHead = this._hasLocalUncommittedChanges(filePath);
        const isUntracked = this._isFileUntracked(filePath);

        if (hasChangesVsHead || isUntracked) {
          conflictFiles.push(filePath);
        }
      }
    }

    return {
      count: conflictFiles.length,
      files: conflictFiles,
    };
  }

  /**
   * Check if a file is untracked by git (not in the index)
   *
   * @param filePath - Relative path to the file
   * @returns true if file is untracked, false if tracked
   */
  private _isFileUntracked(filePath: string): boolean {
    try {
      // git ls-files returns the file path if it's tracked, empty if not
      const result = execSync(
        `git ls-files -- ${this._escapeShellArg(filePath)}`,
        {
          cwd: this.repoPath,
          encoding: "utf8",
          stdio: "pipe",
        }
      );
      return result.trim().length === 0; // Empty = untracked
    } catch {
      return true; // Assume untracked on error
    }
  }

  /**
   * Check if a file is a JSONL file in the .sudocode directory
   *
   * @param filePath - Relative path to the file
   * @returns true if file is a .sudocode JSONL file
   */
  private _isJSONLFile(filePath: string): boolean {
    return (
      filePath.endsWith(".jsonl") &&
      (filePath.startsWith(".sudocode/") || filePath.includes("/.sudocode/"))
    );
  }

  /**
   * Perform three-way merge on a file using git merge-file
   *
   * Uses HEAD as base, local working copy as "ours", and worktree version as "theirs".
   * Modifies the local file in place, inserting conflict markers if needed.
   *
   * @param filePath - Relative path to the file in local repo
   * @param worktreeFilePath - Absolute path to the file in worktree
   * @returns true if there are conflicts, false if merge was clean
   */
  private _threeWayMergeFile(
    filePath: string,
    worktreeFilePath: string
  ): boolean {
    const localFilePath = path.join(this.repoPath, filePath);

    // Create temp file for base version from HEAD
    const tempDir = os.tmpdir();
    const baseTempFile = path.join(
      tempDir,
      `sudocode-merge-base-${Date.now()}-${path.basename(filePath)}`
    );

    try {
      // Get base version from HEAD
      let baseContent = "";
      try {
        baseContent = execSync(
          `git show HEAD:${this._escapeShellArg(filePath)}`,
          {
            cwd: this.repoPath,
            encoding: "utf8",
            stdio: "pipe",
          }
        );
      } catch {
        // File might be new (not in HEAD), use empty base
        baseContent = "";
      }
      fs.writeFileSync(baseTempFile, baseContent, "utf8");

      // git merge-file modifies the first file in place
      // Returns 0 if clean merge, >0 for number of conflicts, -1 for error
      try {
        execSync(
          `git merge-file -L "LOCAL" -L "BASE" -L "WORKTREE" ${this._escapeShellArg(localFilePath)} ${this._escapeShellArg(baseTempFile)} ${this._escapeShellArg(worktreeFilePath)}`,
          {
            cwd: this.repoPath,
            stdio: "pipe",
          }
        );
        return false; // Exit 0 = clean merge, no conflicts
      } catch (error: any) {
        // Exit code > 0 means conflicts (number of conflicts)
        // Exit code < 0 means error
        if (error.status > 0) {
          return true; // Has conflicts
        }
        // Real error - rethrow
        throw error;
      }
    } finally {
      // Clean up temp file
      if (fs.existsSync(baseTempFile)) {
        fs.unlinkSync(baseTempFile);
      }
    }
  }

  /**
   * Merge two JSONL files using UUID-based resolution
   *
   * Reads both local and worktree versions, merges entities by UUID,
   * and writes the result back to the local file.
   *
   * @param localFilePath - Absolute path to local JSONL file
   * @param worktreeFilePath - Absolute path to worktree JSONL file
   */
  private async _mergeJSONLFiles(
    localFilePath: string,
    worktreeFilePath: string
  ): Promise<void> {
    // Read both versions
    const localEntities = readJSONLSync(localFilePath, { skipErrors: true });
    const worktreeEntities = readJSONLSync(worktreeFilePath, {
      skipErrors: true,
    });

    // Merge using three-way merge with empty base
    const { entities: merged } = mergeThreeWay(
      [],
      localEntities,
      worktreeEntities
    );

    // Write merged result back to local file
    await writeJSONL(localFilePath, merged);
  }

  /**
   * Copy uncommitted files from worktree to local repo with safe merging
   *
   * For files with local uncommitted changes:
   * - JSONL files: Uses UUID-based merge resolution
   * - Other files: Uses git merge-file for three-way merge with conflict markers
   *
   * Files without local changes are copied directly.
   *
   * @param worktreePath - Path to the worktree
   * @param options - Optional settings
   * @param options.overrideLocalChanges - If true, skip merge and overwrite local changes
   * @returns Object with filesCopied count and list of files with conflicts
   */
  private async _copyUncommittedFiles(
    worktreePath: string,
    options?: { overrideLocalChanges?: boolean }
  ): Promise<{
    filesCopied: number;
    filesWithConflicts: string[];
  }> {
    const { overrideLocalChanges = false } = options || {};
    // Get list of uncommitted/untracked files in worktree
    const modifiedOutput = execSync("git diff --name-only", {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    });

    const untrackedOutput = execSync(
      "git ls-files --others --exclude-standard",
      {
        cwd: worktreePath,
        encoding: "utf8",
        stdio: "pipe",
      }
    );

    const modifiedFiles = modifiedOutput
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const untrackedFiles = untrackedOutput
      .split("\n")
      .filter((line) => line.trim().length > 0);

    const allFiles = [...new Set([...modifiedFiles, ...untrackedFiles])];

    if (allFiles.length === 0) {
      return { filesCopied: 0, filesWithConflicts: [] };
    }

    // Process each file from worktree
    let filesCopied = 0;
    const filesWithConflicts: string[] = [];

    for (const filePath of allFiles) {
      const srcPath = path.join(worktreePath, filePath);
      const destPath = path.join(this.repoPath, filePath);

      // Check if source file exists
      if (!fs.existsSync(srcPath)) {
        continue;
      }

      // Create destination directory if needed
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Check if local file has uncommitted changes or is untracked
      // We need to merge if: (1) file exists locally AND (2) either has changes vs HEAD or is untracked
      const localFileExists = fs.existsSync(destPath);
      const localHasChangesVsHead =
        localFileExists && this._hasLocalUncommittedChanges(filePath);
      const localIsUntracked =
        localFileExists && this._isFileUntracked(filePath);
      const needsMerge =
        !overrideLocalChanges && (localHasChangesVsHead || localIsUntracked);

      let hasConflicts = false;

      if (!needsMerge) {
        // No local changes OR override mode - copy directly (overwrites local)
        fs.copyFileSync(srcPath, destPath);
      } else if (this._isJSONLFile(filePath)) {
        // JSONL file with local changes - use UUID-based merge
        await this._mergeJSONLFiles(destPath, srcPath);
      } else {
        // Other file with local changes - use three-way merge
        hasConflicts = this._threeWayMergeFile(filePath, srcPath);
        if (hasConflicts) {
          filesWithConflicts.push(filePath);
        }
      }

      // Stage the file ONLY if it doesn't have conflicts
      // Files with conflict markers should remain unstaged so VS Code can detect them
      if (!hasConflicts) {
        execSync(`git add ${this._escapeShellArg(filePath)}`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      }

      filesCopied++;
    }

    return { filesCopied, filesWithConflicts };
  }

  /**
   * Resolve JSONL merge conflicts in the local repository
   *
   * Checks for git conflict markers in issues.jsonl and specs.jsonl,
   * and resolves them using the merge-resolver logic.
   *
   * @returns Number of files resolved
   */
  private async _resolveJSONLConflicts(): Promise<number> {
    const sudocodePath = path.join(this.repoPath, ".sudocode");
    const issuesPath = path.join(sudocodePath, "issues.jsonl");
    const specsPath = path.join(sudocodePath, "specs.jsonl");

    let filesResolved = 0;

    // Check and resolve issues.jsonl
    if (fs.existsSync(issuesPath) && hasGitConflictMarkers(issuesPath)) {
      await this._resolveJSONLFile(issuesPath);
      filesResolved++;
    }

    // Check and resolve specs.jsonl
    if (fs.existsSync(specsPath) && hasGitConflictMarkers(specsPath)) {
      await this._resolveJSONLFile(specsPath);
      filesResolved++;
    }

    return filesResolved;
  }

  /**
   * Resolve conflicts in a single JSONL file
   *
   * @param filePath - Path to the JSONL file with conflicts
   */
  private async _resolveJSONLFile(filePath: string): Promise<void> {
    // Read file with conflict markers
    const content = fs.readFileSync(filePath, "utf8");

    // Parse conflicts
    const sections = parseMergeConflictFile(content);

    // Separate ours and theirs arrays
    const oursEntities: JSONLEntity[] = [];
    const theirsEntities: JSONLEntity[] = [];

    for (const section of sections) {
      if (section.type === "clean") {
        // Add clean sections to BOTH ours and theirs
        for (const line of section.lines) {
          if (line.trim()) {
            try {
              const entity = JSON.parse(line);
              oursEntities.push(entity);
              theirsEntities.push(entity);
            } catch {
              // Skip malformed lines
            }
          }
        }
      } else {
        // Conflict section - add ours to ours, theirs to theirs
        for (const line of section.ours || []) {
          if (line.trim()) {
            try {
              oursEntities.push(JSON.parse(line));
            } catch {
              // Skip malformed lines
            }
          }
        }
        for (const line of section.theirs || []) {
          if (line.trim()) {
            try {
              theirsEntities.push(JSON.parse(line));
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    }

    // Resolve conflicts using universal three-way merge with empty base
    const { entities: resolved } = mergeThreeWay(
      [],
      oursEntities,
      theirsEntities
    );

    // Write back resolved entities
    await writeJSONL(filePath, resolved);

    // Stage the resolved file
    const relativePath = path.relative(this.repoPath, filePath);
    execSync(`git add ${this._escapeShellArg(relativePath)}`, {
      cwd: this.repoPath,
      stdio: "pipe",
    });
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
   * Squashes all committed worktree changes into a single commit on the target branch.
   * Only includes committed changes - uncommitted changes are excluded.
   * If merge conflicts occur, they are left for the user to resolve manually.
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

    // 2. Validate preconditions (allow JSONL-only changes, they'll be auto-merged)
    await this._validateSyncPreconditions(execution, { allowJsonlOnlyChanges: true });

    // 3. Save uncommitted JSONL files before merge (will be restored after)
    const savedJsonlFiles = await this._saveUncommittedJsonl();
    const hasUncommittedJsonl = savedJsonlFiles.size > 0;

    // 4. Preview sync to get info (we'll proceed even with conflicts)
    const preview = await this.previewSync(executionId);

    // 4. Check if there are any commits to merge
    if (preview.commits.length === 0) {
      return {
        success: false,
        filesChanged: 0,
        error:
          "No commits to merge. Only committed changes are included in sync.",
      };
    }

    // 5. Check if worktree branch is already merged into target
    if (this._isAncestor(execution.branch_name, execution.target_branch)) {
      return {
        success: false,
        filesChanged: 0,
        error:
          "Target branch is already up to date with worktree changes. Nothing to merge.",
      };
    }

    let safetyTag: string | undefined;

    try {
      // 6. Create safety snapshot (before any changes)
      safetyTag = await this._createSafetySnapshot(
        executionId,
        execution.target_branch
      );

      // 7. Perform git merge --squash (may have conflicts)
      const mergeResult = this._performSquashMergeAllowConflicts(
        execution.branch_name,
        execution.target_branch
      );

      // 8. Auto-resolve JSONL conflicts if any (from git merge --squash)
      let filesWithConflicts: string[] = [];
      if (mergeResult.hasConflicts) {
        await this._resolveJSONLConflicts();

        // Re-check for remaining conflicts after JSONL resolution
        try {
          const conflictCheck = execSync(
            "git diff --name-only --diff-filter=U",
            {
              cwd: this.repoPath,
              encoding: "utf8",
              stdio: "pipe",
            }
          );
          filesWithConflicts = conflictCheck
            .trim()
            .split("\n")
            .filter((f) => f.length > 0);
        } catch {
          // If command fails, assume no remaining conflicts
        }

        // If there are still unresolved conflicts, return error
        if (filesWithConflicts.length > 0) {
          return {
            success: false,
            filesChanged: mergeResult.filesChanged,
            hasConflicts: true,
            filesWithConflicts,
            error:
              "Merge conflicts detected. Please resolve them manually and commit.",
            cleanupOffered: false,
          };
        }
      }

      // 9. Generate commit message
      const commitMessage =
        customCommitMessage ||
        this._generateCommitMessage(execution, preview.commits.length);

      // 10. Create commit
      const finalCommit = this._createCommit(commitMessage);

      // 11. Restore uncommitted JSONL files with three-way merge
      if (hasUncommittedJsonl) {
        await this._restoreUncommittedJsonl();
      }

      // 12. Return success result
      return {
        success: true,
        finalCommit,
        filesChanged: mergeResult.filesChanged,
        cleanupOffered: true,
      };
    } catch (error: any) {
      // Restore uncommitted JSONL files even on failure (to avoid losing user changes)
      if (hasUncommittedJsonl) {
        try {
          await this._restoreUncommittedJsonl();
        } catch (restoreError: any) {
          console.error(
            "Failed to restore uncommitted JSONL files:",
            restoreError
          );
        }
      }

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
   * Applies committed worktree changes to the working directory without committing.
   * Changes are left staged, ready for the user to commit manually.
   * Only includes committed changes by default - uncommitted changes are excluded
   * unless includeUncommitted is true.
   *
   * @param executionId - Execution ID to sync
   * @param options - Optional settings
   * @param options.includeUncommitted - If true, also copy uncommitted files from worktree
   * @param options.overrideLocalChanges - If true, overwrite local changes instead of merging
   * @returns Sync result with details
   * @throws WorktreeSyncError if sync fails
   */
  async stageSync(
    executionId: string,
    options?: { includeUncommitted?: boolean; overrideLocalChanges?: boolean }
  ): Promise<SyncResult> {
    const { includeUncommitted = false, overrideLocalChanges = false } =
      options || {};

    // 1. Load and validate execution
    const execution = await this._loadAndValidateExecution(executionId);

    // 2. Validate preconditions (skip dirty working tree check - stage mode doesn't commit)
    await this._validateSyncPreconditions(execution, {
      skipDirtyWorkingTreeCheck: true,
    });

    // 3. Preview sync to get info
    const preview = await this.previewSync(executionId);

    // 4. Check if there's anything to sync
    const hasCommits = preview.commits.length > 0;

    if (!hasCommits && !includeUncommitted) {
      return {
        success: false,
        filesChanged: 0,
        error:
          "No commits to merge. Only committed changes are included in sync.",
      };
    }

    let safetyTag: string | undefined;

    try {
      // 5. Create safety snapshot (before any changes)
      safetyTag = await this._createSafetySnapshot(
        executionId,
        execution.target_branch
      );

      let filesChanged = 0;
      let hasConflicts = false;

      // 6. Perform git merge --squash for committed changes (if any)
      if (hasCommits) {
        const mergeResult = this._performSquashMergeAllowConflicts(
          execution.branch_name,
          execution.target_branch
        );
        filesChanged = mergeResult.filesChanged;
        hasConflicts = mergeResult.hasConflicts;
      }

      // 7. Copy uncommitted files from worktree if requested (with safe merging)
      let uncommittedFilesCopied = 0;
      let filesWithConflicts: string[] = [];
      if (includeUncommitted && execution.worktree_path) {
        const copyResult = await this._copyUncommittedFiles(
          execution.worktree_path,
          { overrideLocalChanges }
        );
        uncommittedFilesCopied = copyResult.filesCopied;
        filesWithConflicts = copyResult.filesWithConflicts;
        filesChanged += uncommittedFilesCopied;

        // If we have conflicts from uncommitted files merge, mark hasConflicts
        if (filesWithConflicts.length > 0) {
          hasConflicts = true;
        }
      }

      // 8. Auto-resolve JSONL conflicts if any (from git merge --squash)
      const jsonlFilesResolved = await this._resolveJSONLConflicts();
      if (jsonlFilesResolved > 0) {
        // Re-check for remaining conflicts after JSONL resolution
        try {
          const conflictCheck = execSync(
            "git diff --name-only --diff-filter=U",
            {
              cwd: this.repoPath,
              encoding: "utf8",
              stdio: "pipe",
            }
          );
          const remainingConflictFiles = conflictCheck
            .trim()
            .split("\n")
            .filter((f) => f.length > 0);
          hasConflicts = remainingConflictFiles.length > 0;

          // Add any remaining conflict files not already tracked
          for (const file of remainingConflictFiles) {
            if (!filesWithConflicts.includes(file)) {
              filesWithConflicts.push(file);
            }
          }
        } catch {
          // If command fails, assume no additional conflicts
        }
      }

      // 9. Check if there are unresolved (non-JSONL) conflicts
      if (hasConflicts) {
        return {
          success: false,
          filesChanged,
          hasConflicts: true,
          filesWithConflicts,
          uncommittedFilesIncluded: uncommittedFilesCopied,
          error: "Merge conflicts detected. Please resolve them manually.",
          cleanupOffered: false,
        };
      }

      // 10. Return success result WITHOUT creating a commit
      // Changes remain staged for user to commit manually
      return {
        success: true,
        filesChanged,
        uncommittedFilesIncluded: uncommittedFilesCopied,
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

  /**
   * Check if worktree branch is an ancestor of target branch
   *
   * If the worktree branch is an ancestor, it means target already has all
   * the commits from the worktree (e.g., via a previous sync).
   *
   * @param worktreeBranch - Worktree branch name
   * @param targetBranch - Target branch name
   * @returns true if worktree branch is an ancestor of target branch
   */
  private _isAncestor(worktreeBranch: string, targetBranch: string): boolean {
    try {
      execSync(
        `git merge-base --is-ancestor ${this._escapeShellArg(worktreeBranch)} ${this._escapeShellArg(targetBranch)}`,
        {
          cwd: this.repoPath,
          stdio: "pipe",
        }
      );
      // Exit code 0 means worktreeBranch IS an ancestor of targetBranch
      return true;
    } catch {
      // Exit code 1 means NOT an ancestor, which is what we want for merging
      return false;
    }
  }

  /**
   * Perform preserve sync operation
   *
   * Merges all commits from worktree branch to target branch, preserving commit history.
   * Only includes committed changes - uncommitted changes are excluded.
   * If merge conflicts occur, they are left for the user to resolve manually.
   *
   * @param executionId - Execution ID to sync
   * @returns Sync result with details
   * @throws WorktreeSyncError if sync fails
   */
  async preserveSync(executionId: string): Promise<SyncResult> {
    // 1. Load and validate execution
    const execution = await this._loadAndValidateExecution(executionId);

    // 2. Validate preconditions (allow JSONL-only changes, they'll be auto-merged)
    await this._validateSyncPreconditions(execution, { allowJsonlOnlyChanges: true });

    // 3. Save uncommitted JSONL files before merge (will be restored after)
    const savedJsonlFiles = await this._saveUncommittedJsonl();
    const hasUncommittedJsonl = savedJsonlFiles.size > 0;

    // 4. Preview sync to get info
    const preview = await this.previewSync(executionId);

    // 4. Check if there are any commits to merge
    if (preview.commits.length === 0) {
      return {
        success: false,
        filesChanged: 0,
        error:
          "No commits to merge. Only committed changes are included in sync.",
      };
    }

    // 5. Check if worktree branch is already merged into target
    // This happens if a previous sync (squash or preserve) already merged these commits
    if (this._isAncestor(execution.branch_name, execution.target_branch)) {
      return {
        success: false,
        filesChanged: 0,
        error:
          "Target branch is already up to date with worktree changes. Nothing to merge.",
      };
    }

    let safetyTag: string | undefined;

    try {
      // 6. Create safety snapshot (before any changes)
      safetyTag = await this._createSafetySnapshot(
        executionId,
        execution.target_branch
      );

      // 7. Checkout target branch
      execSync(
        `git checkout ${this._escapeShellArg(execution.target_branch)}`,
        {
          cwd: this.repoPath,
          stdio: "pipe",
        }
      );

      // 8. Perform regular merge (preserves commit history)
      let hasConflicts = false;
      let filesChanged = 0;

      try {
        execSync(`git merge ${this._escapeShellArg(execution.branch_name)}`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      } catch (error: any) {
        // Merge may have failed due to conflicts
        hasConflicts = true;
      }

      // 9. Count files changed
      try {
        const diffOutput = execSync(
          `git diff --name-only ${this._escapeShellArg(safetyTag)}..HEAD`,
          {
            cwd: this.repoPath,
            encoding: "utf8",
            stdio: "pipe",
          }
        );
        filesChanged = diffOutput
          .split("\n")
          .filter((line) => line.trim().length > 0).length;
      } catch {
        // If merge is in progress, count staged/conflicted files
        const statusOutput = execSync("git diff --name-only --cached", {
          cwd: this.repoPath,
          encoding: "utf8",
          stdio: "pipe",
        });
        filesChanged = statusOutput
          .split("\n")
          .filter((line) => line.trim().length > 0).length;
      }

      // 10. Auto-resolve JSONL conflicts if any
      const jsonlFilesResolved = await this._resolveJSONLConflicts();
      if (jsonlFilesResolved > 0) {
        // Re-check for remaining conflicts
        try {
          const conflictCheck = execSync(
            "git diff --name-only --diff-filter=U",
            {
              cwd: this.repoPath,
              encoding: "utf8",
              stdio: "pipe",
            }
          );
          hasConflicts = conflictCheck.trim().length > 0;
        } catch {
          hasConflicts = false;
        }
      }

      // 11. Check if there are unresolved conflicts
      if (hasConflicts) {
        // Get list of files with conflicts
        let filesWithConflicts: string[] = [];
        try {
          const conflictCheck = execSync(
            "git diff --name-only --diff-filter=U",
            {
              cwd: this.repoPath,
              encoding: "utf8",
              stdio: "pipe",
            }
          );
          filesWithConflicts = conflictCheck
            .trim()
            .split("\n")
            .filter((f) => f.length > 0);
        } catch {
          // If command fails, leave empty
        }

        return {
          success: false,
          filesChanged,
          hasConflicts: true,
          filesWithConflicts,
          error:
            "Merge conflicts detected. Please resolve them manually and commit.",
          cleanupOffered: false,
        };
      }

      // 12. Get the final commit SHA
      const finalCommit = execSync("git rev-parse HEAD", {
        cwd: this.repoPath,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();

      // 13. Restore uncommitted JSONL files with three-way merge
      if (hasUncommittedJsonl) {
        await this._restoreUncommittedJsonl();
      }

      // 14. Return success result
      return {
        success: true,
        finalCommit,
        filesChanged,
        cleanupOffered: true,
      };
    } catch (error: any) {
      // Restore uncommitted JSONL files even on failure (to avoid losing user changes)
      if (hasUncommittedJsonl) {
        try {
          await this._restoreUncommittedJsonl();
        } catch (restoreError: any) {
          console.error(
            "Failed to restore uncommitted JSONL files:",
            restoreError
          );
        }
      }

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
        `Preserve sync failed: ${error.message}`,
        WorktreeSyncErrorCode.MERGE_FAILED,
        error
      );
    }
  }
}
