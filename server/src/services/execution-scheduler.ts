/**
 * Execution Scheduler Service
 *
 * Autonomous issue execution system that:
 * - Polls for ready issues (no blockers, status='open')
 * - Enforces max concurrency limit
 * - Automatically executes issues in priority order
 * - Transitions issues through their lifecycle
 * - Handles execution failures and success
 *
 * @module services/execution-scheduler
 */

import type Database from "better-sqlite3";
import type { Issue, Execution } from "@sudocode-ai/types";
import { getReadyIssues } from "@sudocode-ai/cli/dist/operations/index.js";
import { getSchedulerConfig } from "./scheduler-config.js";
import { ExecutionService } from "./execution-service.js";
import { getExecution, getAllExecutions } from "./executions.js";
import { updateIssue } from "@sudocode-ai/cli/dist/operations/index.js";
import { getGroupForIssue } from "./issue-groups.js";
import { QualityGateService } from "./quality-gate.js";

/**
 * Active execution tracking
 */
interface ActiveExecution {
  executionId: string;
  issueId: string;
  issueTitle: string;
  groupId?: string; // Track group for coordination
  startedAt: Date;
}

/**
 * ExecutionScheduler - Autonomous issue execution orchestration
 *
 * This service manages the autonomous execution of issues:
 * - Runs on a configurable poll interval (default: 5 seconds)
 * - Respects max concurrency limit (default: 5)
 * - Selects highest priority ready issues
 * - Creates and starts executions automatically
 * - Monitors execution lifecycle and updates issue status
 */
export class ExecutionScheduler {
  private db: Database.Database;
  private executionService: ExecutionService;
  private qualityGateService: QualityGateService;
  private enabled: boolean = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private activeExecutions = new Map<string, ActiveExecution>();

  /**
   * Create a new ExecutionScheduler
   *
   * @param db - Database instance
   * @param executionService - Execution service for creating/managing executions
   * @param repoRoot - Repository root path for running quality gate commands
   */
  constructor(
    db: Database.Database,
    executionService: ExecutionService,
    repoRoot: string
  ) {
    this.db = db;
    this.executionService = executionService;
    this.qualityGateService = new QualityGateService(db, repoRoot);
  }

  /**
   * Start the scheduler
   *
   * Begins polling for ready issues and executing them automatically.
   * Updates scheduler config to mark as enabled.
   */
  async start(): Promise<void> {
    if (this.enabled) {
      console.log("[Scheduler] Already running");
      return;
    }

    console.log("[Scheduler] Starting autonomous execution scheduler");
    this.enabled = true;

    // Load configuration
    const config = getSchedulerConfig(this.db);

    // Start tick loop
    this.scheduleNextTick(config.pollInterval);
  }

  /**
   * Stop the scheduler
   *
   * Stops polling for new issues. Does NOT cancel active executions.
   * Updates scheduler config to mark as disabled.
   */
  async stop(): Promise<void> {
    if (!this.enabled) {
      console.log("[Scheduler] Already stopped");
      return;
    }

    console.log("[Scheduler] Stopping autonomous execution scheduler");
    this.enabled = false;

    // Clear tick timer
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Get current scheduler status
   */
  getStatus(): {
    enabled: boolean;
    activeExecutions: number;
    activeExecutionDetails: ActiveExecution[];
  } {
    return {
      enabled: this.enabled,
      activeExecutions: this.activeExecutions.size,
      activeExecutionDetails: Array.from(this.activeExecutions.values()),
    };
  }

  /**
   * Schedule next tick
   */
  private scheduleNextTick(interval: number): void {
    if (!this.enabled) {
      return;
    }

    this.tickTimer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (error) {
        console.error("[Scheduler] Tick error:", error);
      }

      // Schedule next tick (reload config in case it changed)
      const config = getSchedulerConfig(this.db);
      this.scheduleNextTick(config.pollInterval);
    }, interval);
  }

  /**
   * Main scheduler tick
   *
   * 1. Clean up completed executions
   * 2. Check if we have capacity for more executions
   * 3. Select next issues to execute
   * 4. Start executions
   */
  private async tick(): Promise<void> {
    // 1. Clean up completed executions
    await this.cleanupCompletedExecutions();

    // 2. Load config and check capacity
    const config = getSchedulerConfig(this.db);

    if (this.activeExecutions.size >= config.maxConcurrency) {
      // At capacity, skip this tick
      return;
    }

    // 3. Select and start new executions
    const slotsAvailable = config.maxConcurrency - this.activeExecutions.size;

    for (let i = 0; i < slotsAvailable; i++) {
      const nextIssue = await this.selectNextIssue();

      if (!nextIssue) {
        // No more issues ready to execute
        break;
      }

      try {
        await this.startExecution(nextIssue);
      } catch (error) {
        console.error(
          `[Scheduler] Failed to start execution for issue ${nextIssue.id}:`,
          error
        );
        // Mark issue as needs_review so it doesn't get stuck
        await updateIssue(this.db, nextIssue.id, {
          status: "needs_review",
        });
      }
    }
  }

  /**
   * Select next issue to execute
   *
   * Algorithm:
   * 1. Get all ready issues (no blockers, status='open')
   * 2. Filter out issues already executing
   * 3. Filter out issues in groups that have active executions
   * 4. Sort by priority (0=highest, 4=lowest)
   * 5. Return highest priority issue
   */
  private async selectNextIssue(): Promise<Issue | null> {
    // 1. Get ready issues
    const readyIssues = getReadyIssues(this.db);

    if (readyIssues.length === 0) {
      return null;
    }

    // 2. Filter out issues already executing
    const activeIssueIds = new Set(
      Array.from(this.activeExecutions.values()).map((e) => e.issueId)
    );

    const notExecuting = readyIssues.filter(
      (issue) => !activeIssueIds.has(issue.id)
    );

    if (notExecuting.length === 0) {
      return null;
    }

    // 3. Filter out issues in groups that have active executions
    // (only one execution per group at a time to avoid branch conflicts)
    const activeGroupIds = new Set(
      Array.from(this.activeExecutions.values())
        .map((e) => e.groupId)
        .filter((id): id is string => id !== undefined)
    );

    const available = notExecuting.filter((issue) => {
      const group = getGroupForIssue(this.db, issue.id);
      // Allow if:
      // - Issue has no group (ungrouped issues execute independently)
      // - Issue's group is not currently executing
      return !group || !activeGroupIds.has(group.id);
    });

    if (available.length === 0) {
      return null;
    }

    // 4. Sort by priority (ascending - 0 is highest priority)
    const sorted = available.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Tie-breaker: older issues first
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });

    return sorted[0];
  }

  /**
   * Start execution for an issue
   */
  private async startExecution(issue: Issue): Promise<void> {
    console.log(`[Scheduler] Starting execution for issue ${issue.id}: ${issue.title}`);

    // 1. Get group if issue is in one
    const group = getGroupForIssue(this.db, issue.id);

    // Check if group is paused
    if (group && group.status === "paused") {
      console.log(`[Scheduler] Skipping issue ${issue.id} - group ${group.id} is paused`);
      return;
    }

    // 2. Mark issue as in_progress
    await updateIssue(this.db, issue.id, {
      status: "in_progress",
    });

    // 3. Create execution
    // If issue is in a group, use group's working branch as base
    // Otherwise use default base branch
    const executionId = await this.executionService.createExecution(issue.id, {
      mode: "worktree",
      baseBranch: group ? group.workingBranch : "main",
      branchName: group ? group.workingBranch : undefined, // Reuse group branch
    });

    // 4. Track active execution
    this.activeExecutions.set(executionId, {
      executionId,
      issueId: issue.id,
      issueTitle: issue.title,
      groupId: group?.id,
      startedAt: new Date(),
    });

    console.log(
      `[Scheduler] Started execution ${executionId} for issue ${issue.id}` +
        (group ? ` (group: ${group.name})` : "")
    );
  }

  /**
   * Clean up completed executions
   *
   * Checks all active executions and:
   * - Removes completed/failed/cancelled executions from active set
   * - Updates issue status based on execution result
   */
  private async cleanupCompletedExecutions(): Promise<void> {
    for (const [execId, info] of this.activeExecutions.entries()) {
      const execution = getExecution(this.db, execId);

      if (!execution) {
        // Execution not found, remove from tracking
        this.activeExecutions.delete(execId);
        continue;
      }

      // Check if execution completed
      if (["completed", "failed", "cancelled"].includes(execution.status)) {
        console.log(`[Scheduler] Execution ${execId} ${execution.status}`);

        // Handle completion
        await this.onExecutionComplete(execution);

        // Remove from active set
        this.activeExecutions.delete(execId);
      }
    }
  }

  /**
   * Handle execution completion
   *
   * Updates issue status based on execution result:
   * - completed → mark issue as closed
   * - failed → mark issue as needs_review
   * - cancelled → mark issue as open (so it can be retried)
   */
  private async onExecutionComplete(execution: Execution): Promise<void> {
    if (!execution.issue_id) {
      // Execution not tied to an issue, nothing to update
      return;
    }

    try {
      if (execution.status === "completed") {
        // Success - run quality gates before closing
        const config = getSchedulerConfig(this.db);

        if (config.qualityGatesEnabled && config.qualityGatesConfig) {
          console.log(`[Scheduler] Running quality gates for issue ${execution.issue_id}`);

          // Run quality gates in the execution's worktree directory
          const workingDir = execution.worktree_path || execution.project_root;
          const result = await this.qualityGateService.runChecks(
            execution.id,
            config.qualityGatesConfig,
            workingDir
          );

          if (result.passed) {
            console.log(`[Scheduler] Quality gates passed for issue ${execution.issue_id}`);
            await updateIssue(this.db, execution.issue_id, {
              status: "closed",
            });
          } else {
            console.log(`[Scheduler] Quality gates failed for issue ${execution.issue_id}`);
            await updateIssue(this.db, execution.issue_id, {
              status: "needs_review",
            });
          }
        } else {
          // No quality gates - close the issue directly
          console.log(`[Scheduler] Closing issue ${execution.issue_id} (execution succeeded, no quality gates)`);
          await updateIssue(this.db, execution.issue_id, {
            status: "closed",
          });
        }
      } else if (execution.status === "failed") {
        // Failure - mark as needs_review
        console.log(`[Scheduler] Marking issue ${execution.issue_id} as needs_review (execution failed)`);
        await updateIssue(this.db, execution.issue_id, {
          status: "needs_review",
        });
      } else if (execution.status === "cancelled") {
        // Cancelled - return to open so it can be retried
        console.log(`[Scheduler] Returning issue ${execution.issue_id} to open (execution cancelled)`);
        await updateIssue(this.db, execution.issue_id, {
          status: "open",
        });
      }
    } catch (error) {
      console.error(
        `[Scheduler] Failed to update issue ${execution.issue_id} after execution:`,
        error
      );
    }
  }
}
