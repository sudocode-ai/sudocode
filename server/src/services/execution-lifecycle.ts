/**
 * Execution Lifecycle Service
 *
 * Centralized service for managing execution lifecycle with worktree integration.
 * Coordinates between WorktreeManager and execution database services.
 *
 * @module services/execution-lifecycle
 */

import path from "path";
import type Database from "better-sqlite3";
import type { AgentType, Execution } from "@sudocode-ai/types";
import { execSync } from "child_process";
import {
  WorktreeManager,
  type IWorktreeManager,
} from "../execution/worktree/manager.js";
import { getWorktreeConfig } from "../execution/worktree/config.js";
import { createExecution, getExecution } from "./executions.js";
import { randomUUID } from "crypto";

/**
 * Parameters for creating an execution with worktree
 */
export interface CreateExecutionWithWorktreeParams {
  issueId: string;
  issueTitle: string;
  agentType: AgentType;
  targetBranch: string;
  repoPath: string;
  mode?: string;
  prompt?: string;
  config?: string; // JSON string of execution configuration
  createTargetBranch?: boolean; // If true, create targetBranch from current HEAD
}

/**
 * Result of creating an execution with worktree
 */
export interface CreateExecutionWithWorktreeResult {
  execution: Execution;
  worktreePath: string;
  branchName: string;
}

/**
 * ExecutionLifecycleService
 *
 * Manages the full lifecycle of executions with worktree support:
 * - Creating executions with isolated worktrees
 * - Cleaning up executions and associated worktrees
 * - Handling orphaned worktrees
 */
export class ExecutionLifecycleService {
  private worktreeManager: IWorktreeManager;
  private db: Database.Database;
  private repoPath: string;

  /**
   * Create a new ExecutionLifecycleService
   *
   * @param db - Database instance
   * @param repoPath - Path to the git repository
   * @param worktreeManager - Optional worktree manager (defaults to new instance)
   */
  constructor(
    db: Database.Database,
    repoPath: string,
    worktreeManager?: IWorktreeManager
  ) {
    this.db = db;
    this.repoPath = repoPath;

    // Load config and create worktree manager if not provided
    if (worktreeManager) {
      this.worktreeManager = worktreeManager;
    } else {
      const config = getWorktreeConfig(repoPath);
      this.worktreeManager = new WorktreeManager(config);
    }
  }

  /**
   * Create an execution with an isolated worktree
   *
   * Creates a worktree first, then creates the execution record.
   * If worktree creation fails, no execution is created.
   * If execution creation fails, the worktree is cleaned up.
   *
   * @param params - Execution creation parameters
   * @returns Execution with worktree information
   * @throws Error if creation fails
   */
  async createExecutionWithWorktree(
    params: CreateExecutionWithWorktreeParams
  ): Promise<CreateExecutionWithWorktreeResult> {
    const {
      issueId,
      issueTitle,
      agentType,
      targetBranch,
      repoPath,
      createTargetBranch,
    } = params;

    // Validation 1: Check for existing active execution for this issue
    const existingExecution = this.db
      .prepare(
        `SELECT id FROM executions
         WHERE issue_id = ?
         AND status = 'running'
         AND worktree_path IS NOT NULL`
      )
      .get(issueId) as { id: string } | undefined;

    if (existingExecution) {
      throw new Error(
        `Active execution already exists for issue ${issueId}: ${existingExecution.id}`
      );
    }

    // Validation 2: Validate git repository
    const isValidRepo = await this.worktreeManager.isValidRepo(repoPath);
    if (!isValidRepo) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }

    // Validation 3: Validate target branch exists (or create it if requested)
    const branches = await this.worktreeManager.listBranches(repoPath);
    if (!branches.includes(targetBranch)) {
      if (createTargetBranch) {
        // Create the branch from current HEAD
        const currentBranch = await this.worktreeManager.getCurrentBranch(
          repoPath
        );
        await this.worktreeManager.createBranch(
          repoPath,
          targetBranch,
          currentBranch
        );
        console.log(
          `[ExecutionLifecycle] Created new branch '${targetBranch}' from '${currentBranch}'`
        );
      } else {
        throw new Error(`Target branch does not exist: ${targetBranch}`);
      }
    }

    const config = this.worktreeManager.getConfig();

    // Generate execution ID
    const executionId = randomUUID();

    // Determine branch name based on autoCreateBranches setting
    let branchName: string;
    if (config.autoCreateBranches) {
      // Generate branch name: {branchPrefix}/{execution-id}/{sanitized-issue-title}
      const sanitizedTitle = sanitizeForBranchName(issueTitle);
      branchName = `${config.branchPrefix}/${executionId.substring(0, 8)}/${sanitizedTitle}`;
    } else {
      // Use target branch directly when not auto-creating branches
      branchName = targetBranch;
    }

    // Generate worktree path: {repoPath}/{worktreeStoragePath}/{execution-id}
    const worktreePath = path.join(
      repoPath,
      config.worktreeStoragePath,
      executionId
    );

    let worktreeCreated = false;

    try {
      // Step 1: Capture current commit before creating worktree
      let beforeCommit: string | undefined;
      try {
        beforeCommit = execSync("git rev-parse HEAD", {
          cwd: repoPath,
          encoding: "utf-8",
        }).trim();
        console.log(`[ExecutionLifecycle] Captured before_commit: ${beforeCommit}`);
      } catch (error) {
        console.warn(
          "[ExecutionLifecycle] Failed to capture before_commit:",
          error instanceof Error ? error.message : String(error)
        );
        // Continue - this is supplementary data
      }

      // Step 2: Create worktree
      await this.worktreeManager.createWorktree({
        repoPath,
        branchName,
        worktreePath,
        baseBranch: targetBranch,
        createBranch: config.autoCreateBranches,
      });

      worktreeCreated = true;

      // Step 3: Create execution record in database
      const execution = createExecution(this.db, {
        id: executionId,
        issue_id: issueId,
        agent_type: agentType,
        mode: params.mode,
        prompt: params.prompt,
        config: params.config,
        before_commit: beforeCommit,
        target_branch: targetBranch,
        branch_name: branchName,
        worktree_path: worktreePath,
      });

      return {
        execution,
        worktreePath,
        branchName,
      };
    } catch (error) {
      // If worktree was created but execution creation failed, cleanup worktree
      if (worktreeCreated) {
        try {
          await this.worktreeManager.cleanupWorktree(worktreePath, repoPath);
        } catch (cleanupError) {
          // Log cleanup error but throw original error
          console.error(
            `Failed to cleanup worktree after execution creation failure:`,
            cleanupError
          );
        }
      }

      // Re-throw the original error
      throw error;
    }
  }

  /**
   * Check if an execution should be cleaned up based on its config
   *
   * @param executionId - ID of execution to check
   * @returns true if should cleanup, false otherwise
   */
  shouldCleanupExecution(executionId: string): boolean {
    const execution = getExecution(this.db, executionId);

    if (!execution) {
      return false;
    }

    // Check if cleanupMode is set to 'manual'
    if (execution.config) {
      try {
        const config = JSON.parse(execution.config);
        if (config.cleanupMode === "manual" || config.cleanupMode === "never") {
          return false;
        }
      } catch (error) {
        console.error(
          `Failed to parse execution config for ${executionId}:`,
          error
        );
        // Default to cleanup on parse error
      }
    }

    return true;
  }

  /**
   * Clean up an execution and its associated worktree
   *
   * Removes the worktree from filesystem and git metadata.
   * Branch deletion is controlled by autoDeleteBranches config.
   * Respects the cleanupMode configuration from execution config.
   *
   * IMPORTANT: The worktree_path is NEVER cleared from the database.
   * This allows follow-up executions to find and reuse the same worktree path.
   * The filesystem worktree is deleted, but the path remains in the DB as a historical record.
   *
   * @param executionId - ID of execution to cleanup
   * @throws Error if cleanup fails
   */
  async cleanupExecution(executionId: string): Promise<void> {
    // Check if we should cleanup based on config
    if (!this.shouldCleanupExecution(executionId)) {
      return;
    }

    // Get execution from database
    const execution = getExecution(this.db, executionId);

    if (!execution) {
      // Execution doesn't exist, nothing to cleanup
      return;
    }

    // If execution has a worktree path, clean up the filesystem worktree
    // but KEEP the worktree_path in the database for follow-up executions
    if (execution.worktree_path) {
      try {
        await this.worktreeManager.cleanupWorktree(
          execution.worktree_path,
          this.repoPath
        );
        console.log(
          `Successfully cleaned up worktree for execution ${executionId}`
        );
        // NOTE: We do NOT set worktree_path to null in the database
        // Follow-up executions need this path to recreate the worktree
      } catch (error: any) {
        // Check if error is due to worktree already being deleted
        if (error.code === "ENOENT" || error.message?.includes("does not exist")) {
          console.log(
            `Worktree already deleted for execution ${executionId}, skipping cleanup`
          );
        } else {
          // Log other errors but don't fail - cleanup is best-effort
          console.error(
            `Failed to cleanup worktree for execution ${executionId}:`,
            error
          );
        }
      }
    }
  }

  /**
   * Clean up orphaned worktrees
   *
   * Finds worktrees that are registered in git but don't have
   * corresponding execution records, or vice versa.
   * Also cleans up worktrees for finished executions (completed/failed/stopped).
   */
  async cleanupOrphanedWorktrees(): Promise<void> {
    const repoPath = this.repoPath;
    const config = this.worktreeManager.getConfig();

    try {
      // Check if this is a valid git repository first
      const isValidRepo = await this.worktreeManager.isValidRepo(repoPath);
      if (!isValidRepo) {
        return;
      }

      // List all worktrees from git
      const worktrees = await this.worktreeManager.listWorktrees(repoPath);

      // Filter to worktrees in our storage path
      const managedWorktrees = worktrees.filter((w) =>
        w.path.includes(config.worktreeStoragePath)
      );

      // For each managed worktree, check if it has a corresponding execution
      for (const worktree of managedWorktrees) {
        const worktreePath = worktree.path;

        // Try to extract execution ID from path
        const executionId = path.basename(worktreePath);

        // Check if execution exists in database
        const execution = getExecution(this.db, executionId);

        if (!execution) {
          // Orphaned worktree - cleanup
          console.log(
            `Cleaning up orphaned worktree: ${worktreePath} (no execution found)`
          );
          try {
            await this.worktreeManager.cleanupWorktree(worktreePath, repoPath);
          } catch (error) {
            console.error(
              `Failed to cleanup orphaned worktree ${worktreePath}:`,
              error
            );
          }
        } else if (
          execution.status === "completed" ||
          execution.status === "failed" ||
          execution.status === "stopped"
        ) {
          // Execution is finished but worktree still exists
          // Check if we should cleanup based on execution config
          if (!this.shouldCleanupExecution(executionId)) {
            console.log(
              `Skipping cleanup for finished execution ${executionId} (manual cleanup mode)`
            );
            continue;
          }

          console.log(
            `Cleaning up worktree for finished execution ${executionId} (status: ${execution.status})`
          );
          try {
            await this.worktreeManager.cleanupWorktree(worktreePath, repoPath);
            // NOTE: We do NOT set worktree_path to null in the database
            // Follow-up executions need this path to recreate the worktree
          } catch (error) {
            console.error(
              `Failed to cleanup worktree for finished execution ${executionId}:`,
              error
            );
          }
        }
      }
    } catch (error) {
      console.error(
        `Failed to cleanup orphaned worktrees in ${repoPath}:`,
        error
      );
    }
  }
}

/**
 * Sanitize a string to be safe for use in git branch names
 *
 * - Converts to lowercase
 * - Replaces spaces and slashes with hyphens
 * - Removes special characters
 * - Limits length to 50 characters
 *
 * @param str - String to sanitize
 * @returns Sanitized string safe for branch names
 */
export function sanitizeForBranchName(str: string): string {
  return (
    str
      .toLowerCase()
      // Replace spaces and slashes with hyphens
      .replace(/[\s/]+/g, "-")
      // Remove special characters (keep alphanumeric, hyphens, underscores)
      .replace(/[^a-z0-9\-_]/g, "")
      // Remove consecutive hyphens
      .replace(/-+/g, "-")
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, "")
      // Limit length
      .substring(0, 50)
  );
}
