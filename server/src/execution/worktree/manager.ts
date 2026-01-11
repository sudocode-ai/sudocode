/**
 * Worktree Manager
 *
 * Manages git worktrees for session isolation.
 *
 * @deprecated This module is being replaced by DataplaneAdapter which provides
 * stream-based worktree management with conflict tracking and merge queue support.
 * When dataplane is enabled in config (.sudocode/config.json), ExecutionLifecycleService
 * will use DataplaneAdapter instead of WorktreeManager for worktree operations.
 *
 * Migration path:
 * 1. Enable dataplane in .sudocode/config.json: { "dataplane": { "enabled": true } }
 * 2. Services will automatically use DataplaneAdapter when initialized
 * 3. WorktreeManager remains available as fallback for non-dataplane projects
 *
 * WORKTREE ISOLATION:
 * ===================
 * Each worktree created by this manager is completely isolated from the main
 * repository. This prevents race conditions and unexpected modifications during
 * concurrent executions.
 *
 * Isolation is achieved through:
 * 1. Local database (.sudocode/cache.db) in each worktree
 * 2. Synced JSONL files with latest state (including uncommitted changes)
 * 3. Claude config (.claude/config.json) that forces MCP to use local database
 *
 * Key Benefit: Multiple executions can run concurrently without interfering
 * with each other or the main repository. All MCP/CLI operations in a worktree
 * stay contained within that worktree.
 *
 * See setupWorktreeEnvironment() method for detailed implementation.
 *
 * @module execution/worktree/manager
 */

import { Mutex } from "async-mutex";
import fs from "fs";
import path from "path";
import type {
  WorktreeCreateParams,
  WorktreeConfig,
  WorktreeInfo,
} from "./types.js";
import { WorktreeError, WorktreeErrorCode } from "./types.js";
import { GitCli, type IGitCli } from "./git-cli.js";
import { initDatabase } from "@sudocode-ai/cli/dist/db.js";
import { importFromJSONL } from "@sudocode-ai/cli/dist/import.js";
import { execSync } from "child_process";

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

  /**
   * Check if a path is a valid git repository
   *
   * @param repoPath - Path to check
   * @returns Promise resolving to true if valid repo, false otherwise
   */
  isValidRepo(repoPath: string): Promise<boolean>;

  /**
   * List all branches in a repository
   *
   * @param repoPath - Path to the git repository
   * @returns Promise resolving to array of branch names
   */
  listBranches(repoPath: string): Promise<string[]>;

  /**
   * Get the current branch name
   *
   * @param repoPath - Path to the git repository
   * @returns Promise resolving to current branch name
   */
  getCurrentBranch(repoPath: string): Promise<string>;

  /**
   * Create a new branch
   *
   * @param repoPath - Path to the git repository
   * @param branchName - Name of the branch to create
   * @param baseBranch - Branch or commit to base the new branch on
   * @returns Promise that resolves when branch is created
   */
  createBranch(
    repoPath: string,
    branchName: string,
    baseBranch: string
  ): Promise<void>;
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
    const {
      repoPath,
      branchName,
      worktreePath,
      baseBranch,
      createBranch,
      commitSha,
    } = params;

    try {
      // 1. Create branch if requested
      if (createBranch) {
        // Use the specified commit SHA, or base branch, or current HEAD commit to branch from
        const targetCommit =
          commitSha || baseBranch || (await this.git.getCurrentCommit(repoPath));
        await this.git.createBranch(repoPath, branchName, targetCommit);
      }

      // 2. Create parent directory if needed
      const parentDir = path.dirname(worktreePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // 3. Call git worktree add
      await this.git.worktreeAdd(repoPath, worktreePath, branchName);

      // 4. Apply sparse-checkout if configured
      if (
        this.config.enableSparseCheckout &&
        this.config.sparseCheckoutPatterns
      ) {
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

      // 6. Setup isolated worktree environment
      // This is critical for preventing the worktree from modifying the main repository.
      // It creates a local database, syncs JSONL files, and configures Claude to use
      // the local environment. See setupWorktreeEnvironment() for detailed explanation.
      await this.setupWorktreeEnvironment(repoPath, worktreePath);
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

  /**
   * Setup isolated environment for worktree
   *
   * WORKTREE ISOLATION ARCHITECTURE:
   * ================================
   * Problem: Previously, MCP/CLI tools running in worktrees would search upward
   * and find the main repository's database, causing race conditions and
   * unexpected modifications to the main repo during execution.
   *
   * Solution: Each worktree gets its own isolated environment:
   * - Local database (.sudocode/cache.db in worktree)
   * - Synced JSONL files with latest state (including uncommitted changes)
   * - Claude config that forces MCP to use the local database
   *
   * Benefits:
   * - Worktree operations never affect main repository
   * - Multiple executions can run concurrently without conflicts
   * - Worktree gets consistent state (newly created issues are available)
   * - Easy to inspect/debug worktree state after execution
   *
   * Flow:
   * 1. Git creates worktree → checks out files from committed git tree
   * 2. This method runs → copies latest JSONL (including uncommitted changes)
   * 3. Initializes local DB from JSONL → worktree has complete state
   * 4. Creates .claude/config.json → MCP uses local DB via env vars
   * 5. Claude runs → all MCP operations stay in worktree
   * 6. (Future) Merge worktree changes back to main after execution
   *
   * @param repoPath - Path to the main git repository
   * @param worktreePath - Path to the worktree directory
   */
  private async setupWorktreeEnvironment(
    repoPath: string,
    worktreePath: string
  ): Promise<void> {
    console.debug(
      "[WorktreeManager] Setting up isolated worktree environment",
      {
        repoPath,
        worktreePath,
      }
    );

    const mainSudocodeDir = path.join(repoPath, ".sudocode");
    const worktreeSudocodeDir = path.join(worktreePath, ".sudocode");

    console.debug("[WorktreeManager] Directory paths", {
      mainSudocodeDir,
      worktreeSudocodeDir,
    });

    // Ensure .sudocode directory exists in worktree
    if (!fs.existsSync(worktreeSudocodeDir)) {
      fs.mkdirSync(worktreeSudocodeDir, { recursive: true });
      console.debug(
        `[WorktreeManager] Created .sudocode directory in worktree: ${worktreeSudocodeDir}`
      );
    } else {
      console.debug(
        `[WorktreeManager] .sudocode directory already exists in worktree`
      );
    }

    // STEP 1: Copy uncommitted JSONL files from main repo to worktree
    // ================================================================
    // Why: Git worktree checkout only gets committed files from git history.
    // If the user created new issues/specs before starting the execution,
    // those changes are in the main repo's JSONL files but not committed.
    // We need to copy them so the worktree has the complete, up-to-date state.
    //
    // Example: User creates ISSUE-144, starts execution immediately.
    // - Git tree: has 138 issues (old state)
    // - Main JSONL: has 140 issues (includes ISSUE-144, uncommitted)
    // - Without this copy: worktree would only have 138 issues, ISSUE-144 missing!
    // - With this copy: worktree gets all 140 issues, execution can reference ISSUE-144
    const jsonlFiles = ["issues.jsonl", "specs.jsonl"];
    for (const file of jsonlFiles) {
      const mainFile = path.join(mainSudocodeDir, file);
      const worktreeFile = path.join(worktreeSudocodeDir, file);

      console.debug(`[WorktreeManager] Processing ${file}`, {
        mainFile,
        worktreeFile,
        mainFileExists: fs.existsSync(mainFile),
      });

      if (fs.existsSync(mainFile)) {
        const mainStats = fs.statSync(mainFile);
        fs.copyFileSync(mainFile, worktreeFile);
        const worktreeStats = fs.statSync(worktreeFile);
        console.debug(
          `[WorktreeManager] Synced ${file} from main repo to worktree`,
          {
            mainFileSize: mainStats.size,
            worktreeFileSize: worktreeStats.size,
          }
        );
      } else {
        console.debug(
          `[WorktreeManager] Main file does not exist: ${mainFile}`
        );
      }
    }

    // STEP 2: Copy config.json
    // ========================
    // Copy sudocode configuration to maintain consistency
    const mainConfig = path.join(mainSudocodeDir, "config.json");
    const worktreeConfig = path.join(worktreeSudocodeDir, "config.json");
    if (fs.existsSync(mainConfig)) {
      fs.copyFileSync(mainConfig, worktreeConfig);
      console.debug(
        `[WorktreeManager] Copied config.json from main repo to worktree`
      );
    } else {
      console.debug(`[WorktreeManager] No config.json to copy from main repo`);
    }

    // STEP 2.5: Copy .cursor/mcp.json
    // =================================
    // Propagate Cursor MCP configuration to worktree (if present in main repo).
    // This ensures Cursor agent executions in worktrees have access to MCP tools.
    // Note: .cursor/mcp.json is often gitignored, so it won't be in the worktree
    // by default. We explicitly copy it regardless of git tracking status.
    await this.propagateCursorConfig(repoPath, worktreePath);

    // STEP 3: Initialize local database in worktree
    // ==============================================
    // Create a brand new SQLite database in the worktree and import the JSONL
    // files we just copied. This gives the worktree its own isolated database
    // with the complete current state.
    //
    // Important: This database is completely separate from the main repo's DB.
    // All MCP/CLI operations in the worktree will use THIS database, not the main one.

    const worktreeDbPath = path.join(worktreeSudocodeDir, "cache.db");

    // Initialize database with CLI's initDatabase (creates all tables)
    const db = initDatabase({ path: worktreeDbPath, verbose: false });

    try {
      await importFromJSONL(db, {
        inputDir: worktreeSudocodeDir,
      });
      console.debug(
        `[WorktreeManager] Successfully initialized local database in worktree at ${worktreeDbPath}`
      );

      // Verify database was created
      if (fs.existsSync(worktreeDbPath)) {
        const dbStats = fs.statSync(worktreeDbPath);
        console.debug("[WorktreeManager] Database file created", {
          path: worktreeDbPath,
          size: dbStats.size,
        });
      } else {
        console.error(
          "[WorktreeManager] ERROR: Database file was not created!"
        );
      }
    } catch (error) {
      console.error("[WorktreeManager] Failed to initialize database", error);
      throw error;
    } finally {
      db.close();
    }
    console.debug("[WorktreeManager] Worktree environment setup complete");
  }

  /**
   * Propagate .cursor/mcp.json from main repo to worktree
   *
   * Cursor agent requires MCP configuration to be present in .cursor/mcp.json
   * in the project root. When executions run in isolated worktrees, this file
   * must be present for the Cursor agent to access MCP tools like sudocode-mcp.
   *
   * Since .cursor/mcp.json is often gitignored, it won't be automatically
   * copied to worktrees. We explicitly propagate this file on worktree creation.
   *
   * This propagation happens for ALL agent types (not just Cursor) because:
   * - .cursor/mcp.json is a project-level configuration
   * - User might switch agent types mid-execution chain
   * - Propagating for all agents is simpler and more robust
   *
   * @param repoPath - Path to the main git repository
   * @param worktreePath - Path to the worktree directory
   */
  private async propagateCursorConfig(
    repoPath: string,
    worktreePath: string
  ): Promise<void> {
    try {
      const sourcePath = path.join(repoPath, ".cursor", "mcp.json");
      const destPath = path.join(worktreePath, ".cursor", "mcp.json");

      // Check if source file exists
      try {
        await fs.promises.access(sourcePath, fs.constants.R_OK);
      } catch {
        // Source doesn't exist, skip silently
        console.debug(
          "[WorktreeManager] .cursor/mcp.json not found in main repo, skipping propagation"
        );
        return;
      }

      // Ensure .cursor directory exists in worktree
      const destDir = path.dirname(destPath);
      await fs.promises.mkdir(destDir, { recursive: true });

      // Copy file
      await fs.promises.copyFile(sourcePath, destPath);

      console.info(
        `[WorktreeManager] Propagated .cursor/mcp.json to worktree: ${worktreePath}`
      );
    } catch (error) {
      // Log warning but don't fail worktree creation
      console.warn(
        "[WorktreeManager] Failed to propagate .cursor/mcp.json to worktree:",
        error instanceof Error ? error.message : String(error)
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

  async cleanupWorktree(
    worktreePath: string,
    repoPath?: string
  ): Promise<void> {
    // Get lock for this specific path
    const lock = this.getLock(worktreePath);
    const release = await lock.acquire();

    try {
      // Infer repoPath if not provided (try to find from worktree)
      const effectiveRepoPath =
        repoPath || (await this.inferRepoPath(worktreePath));

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

        // Normalize paths for comparison (resolves symlinks like /var -> /private/var on macOS)
        const normalizedWorktreePath = fs.realpathSync(worktreePath);
        const worktreeInfo = worktrees.find((w) => {
          try {
            const normalizedGitPath = fs.realpathSync(w.path);
            return normalizedGitPath === normalizedWorktreePath;
          } catch {
            // If path doesn't exist, try direct comparison
            return w.path === worktreePath;
          }
        });

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
        ".git",
        "worktrees",
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
      if (
        this.config.autoDeleteBranches &&
        branchName &&
        branchName !== "(detached)"
      ) {
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

  async isWorktreeValid(
    repoPath: string,
    worktreePath: string
  ): Promise<boolean> {
    try {
      // 1. Check filesystem path exists
      if (!fs.existsSync(worktreePath)) {
        return false;
      }

      // 2. Check worktree is registered in git metadata
      const worktrees = await this.git.worktreeList(repoPath);

      // Normalize paths for comparison (resolves symlinks like /var -> /private/var on macOS)
      const normalizedWorktreePath = fs.realpathSync(worktreePath);
      const isRegistered = worktrees.some((w) => {
        try {
          const normalizedGitPath = fs.realpathSync(w.path);
          return normalizedGitPath === normalizedWorktreePath;
        } catch {
          // If path doesn't exist, try direct comparison
          return w.path === worktreePath;
        }
      });

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

  async isValidRepo(repoPath: string): Promise<boolean> {
    return this.git.isValidRepo(repoPath);
  }

  async listBranches(repoPath: string): Promise<string[]> {
    return this.git.listBranches(repoPath);
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    return this.git.getCurrentBranch(repoPath);
  }

  async createBranch(
    repoPath: string,
    branchName: string,
    baseBranch: string
  ): Promise<void> {
    return this.git.createBranch(repoPath, branchName, baseBranch);
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
        if (
          this.config.enableSparseCheckout &&
          this.config.sparseCheckoutPatterns
        ) {
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

        // Setup isolated worktree environment (see setupWorktreeEnvironment for details)
        await this.setupWorktreeEnvironment(repoPath, worktreePath);

        return; // Success!
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          // Cleanup metadata and try again
          const worktreeName = path.basename(worktreePath);
          const metadataPath = path.join(
            repoPath,
            ".git",
            "worktrees",
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
  private async inferRepoPath(
    worktreePath: string
  ): Promise<string | undefined> {
    try {
      if (!fs.existsSync(worktreePath)) {
        return undefined;
      }

      // Try to use git to find the common git directory
      const gitCommonDir = execSync("git rev-parse --git-common-dir", {
        cwd: worktreePath,
        encoding: "utf8",
      }).trim();

      // git-common-dir gives us the .git directory
      // We need the working directory (parent of .git)
      const gitDirPath = path.resolve(worktreePath, gitCommonDir);
      if (path.basename(gitDirPath) === ".git") {
        return path.dirname(gitDirPath);
      }

      return gitDirPath;
    } catch (error) {
      return undefined;
    }
  }
}
