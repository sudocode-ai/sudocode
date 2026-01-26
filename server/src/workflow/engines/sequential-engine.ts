/**
 * Sequential Workflow Engine
 *
 * Executes workflow steps in topological order with worktree reuse.
 * Supports both sequential and parallel execution modes.
 */

import type Database from "better-sqlite3";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import type {
  Workflow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowStep,
  Issue,
  Execution,
} from "@sudocode-ai/types";
import {
  getIssue,
  updateIssue,
} from "@sudocode-ai/cli/dist/operations/issues.js";
import {
  readJSONLSync,
  writeJSONL,
} from "@sudocode-ai/cli/dist/jsonl.js";
import type { IssueJSONL } from "@sudocode-ai/types";

const execAsync = promisify(exec);

import { BaseWorkflowEngine } from "../base-workflow-engine.js";
import {
  WorkflowCycleError,
  WorkflowStateError,
  WorkflowStepNotFoundError,
} from "../workflow-engine.js";
import type { WorkflowEventEmitter } from "../workflow-event-emitter.js";
import type { ExecutionService } from "../../services/execution-service.js";
import type { ExecutionConfig } from "../../services/execution-service.js";
import { getExecution, updateExecution } from "../../services/executions.js";
import type { ExecutionLifecycleService } from "../../services/execution-lifecycle.js";
import { getDataplaneAdapterSync } from "../../services/dataplane-adapter.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Internal state for tracking active workflows.
 * Used for pause/resume/cancel coordination.
 */
interface WorkflowState {
  workflowId: string;
  isPaused: boolean;
  isCancelled: boolean;
  currentExecutionId?: string;
}

// =============================================================================
// Sequential Workflow Engine
// =============================================================================

/**
 * Sequential Workflow Engine implementation.
 *
 * Executes workflow steps in topological order (respecting dependencies).
 * Features:
 * - Single shared worktree for all steps
 * - Auto-commit after each step (configurable)
 * - Configurable failure handling (stop, pause, skip_dependents, continue)
 * - Support for parallel execution of independent steps
 *
 * @example
 * ```typescript
 * const engine = new SequentialWorkflowEngine(db, executionService, repoPath);
 *
 * // Create workflow from a spec
 * const workflow = await engine.createWorkflow({
 *   type: "spec",
 *   specId: "s-auth"
 * });
 *
 * // Start execution
 * await engine.startWorkflow(workflow.id);
 *
 * // Subscribe to events
 * engine.onWorkflowEvent((event) => {
 *   console.log(event.type, event);
 * });
 * ```
 */
export class SequentialWorkflowEngine extends BaseWorkflowEngine {
  private executionService: ExecutionService;
  private lifecycleService: ExecutionLifecycleService;
  private repoPath: string;
  private activeWorkflows = new Map<string, WorkflowState>();

  constructor(
    db: Database.Database,
    executionService: ExecutionService,
    lifecycleService: ExecutionLifecycleService,
    repoPath: string,
    eventEmitter?: WorkflowEventEmitter
  ) {
    super(db, eventEmitter);
    this.executionService = executionService;
    this.lifecycleService = lifecycleService;
    this.repoPath = repoPath;
  }

  // ===========================================================================
  // Workflow Creation
  // ===========================================================================

  /**
   * Create a new workflow from a source definition.
   *
   * @param source - How to determine workflow scope (spec, issues, root_issue, or goal)
   * @param config - Optional configuration overrides (includes baseBranch, title)
   * @returns The created workflow
   * @throws WorkflowCycleError if dependency cycles are detected
   */
  async createWorkflow(
    source: WorkflowSource,
    config?: Partial<WorkflowConfig>
  ): Promise<Workflow> {
    // 1. Resolve source to issue IDs
    const issueIds = await this.resolveSource(source);

    // 2. Handle goal-based workflows (no initial issues)
    if (source.type === "goal" && issueIds.length === 0) {
      // Goal workflows start with no steps - orchestrator creates them
      const workflow = this.buildWorkflow({
        source,
        steps: [],
        config: config || {},
        repoPath: this.repoPath,
      });
      this.saveWorkflow(workflow);
      return workflow;
    }

    // 3. Build dependency graph
    const graph = this.analyzeDependencies(issueIds);

    // 4. Check for cycles
    if (graph.cycles && graph.cycles.length > 0) {
      throw new WorkflowCycleError(graph.cycles);
    }

    // 5. Create steps from graph
    const steps = this.createStepsFromGraph(graph);

    // 6. Build workflow object
    const workflow = this.buildWorkflow({
      source,
      steps,
      config: config || {},
      repoPath: this.repoPath,
    });

    // 7. Save to database
    this.saveWorkflow(workflow);

    return workflow;
  }

  // ===========================================================================
  // Workflow Recovery
  // ===========================================================================

  /**
   * Recover workflows that were running when the server crashed.
   *
   * This method:
   * 1. Finds all sequential workflows in 'running' or 'paused' status
   * 2. Reconstructs the activeWorkflows Map from database state
   * 3. Handles any steps that were 'running' when the server crashed
   * 4. Resumes execution loops for 'running' workflows
   *
   * Should be called during server startup after engine initialization.
   */
  async recoverWorkflows(): Promise<void> {
    console.log("[SequentialWorkflowEngine] Starting workflow recovery...");

    // Find all sequential workflows that need recovery
    const rows = this.db
      .prepare(
        `
        SELECT * FROM workflows
        WHERE status IN ('running', 'paused')
        AND json_extract(config, '$.engineType') = 'sequential'
      `
      )
      .all() as Array<{
      id: string;
      title: string;
      source: string;
      status: string;
      steps: string;
      worktree_path: string | null;
      branch_name: string | null;
      base_branch: string;
      current_step_index: number;
      orchestrator_execution_id: string | null;
      orchestrator_session_id: string | null;
      config: string;
      created_at: string;
      updated_at: string;
      started_at: string | null;
      completed_at: string | null;
    }>;

    console.log(
      `[SequentialWorkflowEngine] Found ${rows.length} workflows to recover`
    );

    for (const row of rows) {
      try {
        await this.recoverSingleWorkflow(row);
      } catch (error) {
        console.error(
          `[SequentialWorkflowEngine] Failed to recover workflow ${row.id}:`,
          error
        );
        // Continue with other workflows even if one fails
      }
    }

    console.log("[SequentialWorkflowEngine] Workflow recovery complete");
  }

  /**
   * Recover a single workflow from its database row.
   */
  private async recoverSingleWorkflow(row: {
    id: string;
    title: string;
    source: string;
    status: string;
    steps: string;
    worktree_path: string | null;
    branch_name: string | null;
    base_branch: string;
    current_step_index: number;
    orchestrator_execution_id: string | null;
    orchestrator_session_id: string | null;
    config: string;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
  }): Promise<void> {
    const workflowId = row.id;
    const isPaused = row.status === "paused";

    console.log(
      `[SequentialWorkflowEngine] Recovering workflow ${workflowId} (status: ${row.status})`
    );

    // Reconstruct activeWorkflows entry
    this.activeWorkflows.set(workflowId, {
      workflowId,
      isPaused,
      isCancelled: false,
    });

    // Parse steps to find any that were running
    const steps = JSON.parse(row.steps) as WorkflowStep[];
    const runningStep = steps.find((s) => s.status === "running");

    if (runningStep) {
      console.log(
        `[SequentialWorkflowEngine] Found running step ${runningStep.id} (execution: ${runningStep.executionId})`
      );

      await this.handleCrashedStep(workflowId, runningStep, row);
    }

    // Resume execution loop if workflow was running (not paused)
    if (!isPaused) {
      console.log(
        `[SequentialWorkflowEngine] Resuming execution loop for workflow ${workflowId}`
      );

      this.runExecutionLoop(workflowId).catch((error) => {
        console.error(
          `[SequentialWorkflowEngine] Recovered workflow ${workflowId} execution loop failed:`,
          error
        );
        this.failWorkflow(workflowId, error.message).catch(console.error);
      });
    } else {
      console.log(
        `[SequentialWorkflowEngine] Workflow ${workflowId} is paused, not resuming execution loop`
      );
    }
  }

  /**
   * Handle a step that was running when the server crashed.
   */
  private async handleCrashedStep(
    workflowId: string,
    step: WorkflowStep,
    workflowRow: {
      config: string;
      steps: string;
      worktree_path: string | null;
      branch_name: string | null;
      base_branch: string;
      current_step_index: number;
      source: string;
      title: string;
      status: string;
    }
  ): Promise<void> {
    if (!step.executionId) {
      // Step was marked running but no execution was created yet
      // Reset to pending so it can be retried
      console.log(
        `[SequentialWorkflowEngine] Step ${step.id} has no execution, resetting to pending`
      );
      this.updateStep(workflowId, step.id, {
        status: "pending",
        error: undefined,
      });
      return;
    }

    // Check the execution status
    const execution = getExecution(this.db, step.executionId);

    if (!execution) {
      // Execution record doesn't exist - this shouldn't happen but handle it
      console.warn(
        `[SequentialWorkflowEngine] Execution ${step.executionId} not found, marking step as failed`
      );
      this.updateStep(workflowId, step.id, {
        status: "failed",
        error: "Execution record not found after server restart",
      });
      await this.handleRecoveredStepFailure(workflowId, step, workflowRow);
      return;
    }

    // Handle based on execution status
    switch (execution.status) {
      case "completed":
        // Execution completed but we didn't record step success
        console.log(
          `[SequentialWorkflowEngine] Execution ${step.executionId} completed, handling success`
        );
        await this.handleRecoveredStepSuccess(
          workflowId,
          step,
          execution,
          workflowRow
        );
        break;

      case "failed":
      case "cancelled":
      case "stopped":
        // Execution failed/cancelled but we didn't record step failure
        console.log(
          `[SequentialWorkflowEngine] Execution ${step.executionId} ${execution.status}, handling failure`
        );
        this.updateStep(workflowId, step.id, {
          status: "failed",
          error: execution.error_message || `Execution ${execution.status}`,
        });
        await this.handleRecoveredStepFailure(workflowId, step, workflowRow);
        break;

      case "running":
      case "pending":
      case "preparing":
      case "paused":
        // Execution was still in progress - it's now orphaned
        // Mark as failed since the process is gone
        console.log(
          `[SequentialWorkflowEngine] Execution ${step.executionId} was ${execution.status}, marking as failed`
        );
        this.updateStep(workflowId, step.id, {
          status: "failed",
          error: "Server crashed during execution",
        });
        await this.handleRecoveredStepFailure(workflowId, step, workflowRow);
        break;

      default:
        console.warn(
          `[SequentialWorkflowEngine] Unknown execution status: ${execution.status}`
        );
        this.updateStep(workflowId, step.id, {
          status: "failed",
          error: `Unknown execution status: ${execution.status}`,
        });
        await this.handleRecoveredStepFailure(workflowId, step, workflowRow);
    }
  }

  /**
   * Handle step success during recovery.
   */
  private async handleRecoveredStepSuccess(
    workflowId: string,
    step: WorkflowStep,
    execution: Execution,
    workflowRow: { current_step_index: number; worktree_path: string | null }
  ): Promise<void> {
    // Update step status
    this.updateStep(workflowId, step.id, {
      status: "completed",
      commitSha: execution.after_commit ?? undefined,
    });

    // Update workflow progress
    this.updateWorkflow(workflowId, {
      currentStepIndex: workflowRow.current_step_index + 1,
    });

    // Close the issue in the worktree JSONL if available
    await this.closeIssue(
      step.issueId,
      workflowRow.worktree_path ?? undefined
    );
  }

  /**
   * Handle step failure during recovery.
   * Applies the workflow's onFailure strategy.
   */
  private async handleRecoveredStepFailure(
    workflowId: string,
    step: WorkflowStep,
    workflowRow: {
      config: string;
      steps: string;
      worktree_path: string | null;
      branch_name: string | null;
      base_branch: string;
      current_step_index: number;
      source: string;
      title: string;
      status: string;
    }
  ): Promise<void> {
    const config = JSON.parse(workflowRow.config) as WorkflowConfig;
    const steps = JSON.parse(workflowRow.steps) as WorkflowStep[];

    // Build a minimal workflow object for helper methods
    const workflow: Workflow = {
      id: workflowId,
      title: workflowRow.title,
      source: JSON.parse(workflowRow.source),
      status: workflowRow.status as Workflow["status"],
      steps,
      worktreePath: workflowRow.worktree_path ?? undefined,
      branchName: workflowRow.branch_name ?? undefined,
      baseBranch: workflowRow.base_branch,
      currentStepIndex: workflowRow.current_step_index,
      config,
      createdAt: "",
      updatedAt: "",
    };

    // Apply failure strategy
    switch (config.onFailure) {
      case "stop":
        await this.failWorkflow(
          workflowId,
          `Step ${step.id} failed during recovery`
        );
        break;

      case "pause":
        this.updateWorkflow(workflowId, { status: "paused" });
        const state = this.activeWorkflows.get(workflowId);
        if (state) {
          state.isPaused = true;
        }
        break;

      case "skip_dependents":
        await this.skipDependentSteps(
          workflow,
          step,
          `Dependency ${step.issueId} failed during recovery`
        );
        break;

      case "continue":
        await this.blockDependentSteps(workflow, step);
        break;
    }
  }

  // ===========================================================================
  // Workflow Lifecycle
  // ===========================================================================

  /**
   * Start executing a pending workflow.
   *
   * Creates a worktree and begins the execution loop.
   *
   * @param workflowId - The workflow to start
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not in pending state
   */
  async startWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);

    // Validate state
    if (workflow.status !== "pending") {
      throw new WorkflowStateError(workflowId, workflow.status, "start");
    }

    // Create workflow-level worktree if not already present
    if (!workflow.worktreePath) {
      const { worktreePath, branchName } =
        await this.createWorkflowWorktreeHelper(
          workflow,
          this.repoPath,
          this.lifecycleService
        );
      // Update local workflow reference with worktree info
      workflow.worktreePath = worktreePath;
      workflow.branchName = branchName;
    }

    // Initialize workflow state
    this.activeWorkflows.set(workflowId, {
      workflowId,
      isPaused: false,
      isCancelled: false,
    });

    // Update status to running
    const updated = this.updateWorkflow(workflowId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    // Emit workflow started event
    this.eventEmitter.emit({
      type: "workflow_started",
      workflowId,
      workflow: updated,
      timestamp: Date.now(),
    });

    // Start execution loop (non-blocking)
    this.runExecutionLoop(workflowId).catch((error) => {
      console.error(`Workflow ${workflowId} execution loop failed:`, error);
      this.failWorkflow(workflowId, error.message).catch(console.error);
    });
  }

  /**
   * Pause a running workflow, cancelling the current execution.
   *
   * The current step is reset to "pending" so it can be re-executed on resume.
   *
   * @param workflowId - The workflow to pause
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not running
   */
  async pauseWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);

    if (workflow.status !== "running") {
      throw new WorkflowStateError(workflowId, workflow.status, "pause");
    }

    // Set pause flag for execution loop
    const state = this.activeWorkflows.get(workflowId);
    if (state) {
      state.isPaused = true;

      // Cancel current execution if running and reset the step status
      // Keep the executionId so we can resume the session later
      if (state.currentExecutionId) {
        try {
          await this.executionService.cancelExecution(state.currentExecutionId);

          // Find the running step and reset status to pending (keep executionId for resume)
          const runningStep = workflow.steps.find((s) => s.status === "running");
          if (runningStep) {
            this.updateStep(workflowId, runningStep.id, {
              status: "pending",
              // Keep executionId so we can resume the session
              error: undefined,
            });
            console.log(
              `[SequentialWorkflowEngine] Reset step ${runningStep.id} to pending after pause (keeping executionId for resume)`
            );
          }
        } catch (error) {
          console.warn(
            `[SequentialWorkflowEngine] Failed to cancel execution ${state.currentExecutionId}:`,
            error
          );
        }

        state.currentExecutionId = undefined;
      }
    }

    // Update status
    this.updateWorkflow(workflowId, { status: "paused" });

    // Emit event
    this.eventEmitter.emit({
      type: "workflow_paused",
      workflowId,
      timestamp: Date.now(),
    });
  }

  /**
   * Resume a paused workflow.
   *
   * @param workflowId - The workflow to resume
   * @param _message - Optional message (not used in sequential engine, no orchestrator)
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not paused
   */
  async resumeWorkflow(workflowId: string, _message?: string): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);

    if (workflow.status !== "paused") {
      throw new WorkflowStateError(workflowId, workflow.status, "resume");
    }

    // Clear pause flag
    let state = this.activeWorkflows.get(workflowId);
    if (!state) {
      state = {
        workflowId,
        isPaused: false,
        isCancelled: false,
      };
      this.activeWorkflows.set(workflowId, state);
    }
    state.isPaused = false;

    // Update status
    this.updateWorkflow(workflowId, { status: "running" });

    // Emit event
    this.eventEmitter.emit({
      type: "workflow_resumed",
      workflowId,
      timestamp: Date.now(),
    });

    // Restart execution loop
    this.runExecutionLoop(workflowId).catch((error) => {
      console.error(`Workflow ${workflowId} execution loop failed:`, error);
      this.failWorkflow(workflowId, error.message).catch(console.error);
    });
  }

  /**
   * Cancel a workflow, stopping any running executions.
   *
   * @param workflowId - The workflow to cancel
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is already completed/failed/cancelled
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);

    // Check if already in terminal state
    if (["completed", "failed", "cancelled"].includes(workflow.status)) {
      throw new WorkflowStateError(workflowId, workflow.status, "cancel");
    }

    // Set cancel flag
    const state = this.activeWorkflows.get(workflowId);
    if (state) {
      state.isCancelled = true;

      // Cancel current execution if running
      if (state.currentExecutionId) {
        try {
          await this.executionService.cancelExecution(state.currentExecutionId);
        } catch (error) {
          console.warn(
            `Failed to cancel execution ${state.currentExecutionId}:`,
            error
          );
        }
      }
    }

    // Update status
    this.updateWorkflow(workflowId, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
    });

    // Emit event
    this.eventEmitter.emit({
      type: "workflow_cancelled",
      workflowId,
      timestamp: Date.now(),
    });

    // Cleanup
    this.activeWorkflows.delete(workflowId);
  }

  // ===========================================================================
  // Step Control
  // ===========================================================================

  /**
   * Retry a failed step.
   *
   * Resets the step status to pending and unblocks dependent steps.
   * By default, preserves the executionId so the previous session can be resumed.
   * Use freshStart=true to clear the executionId and start a new execution.
   *
   * If the workflow was paused or failed due to the failure, it will be resumed.
   *
   * @param workflowId - The workflow containing the step
   * @param stepId - The step to retry
   * @param options - Optional retry options
   * @param options.freshStart - If true, clears executionId to start fresh instead of resuming
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStepNotFoundError if step doesn't exist
   * @throws WorkflowStateError if step is not in failed state
   */
  async retryStep(
    workflowId: string,
    stepId: string,
    options?: { freshStart?: boolean }
  ): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);
    const step = workflow.steps.find((s) => s.id === stepId);

    if (!step) {
      throw new WorkflowStepNotFoundError(workflowId, stepId);
    }

    if (step.status !== "failed") {
      throw new WorkflowStateError(
        workflowId,
        `step ${stepId} is ${step.status}`,
        "retry"
      );
    }

    // Reset step status
    // Preserve executionId by default so we can resume the session
    // Only clear it if freshStart is explicitly requested
    const stepUpdate: Partial<WorkflowStep> = {
      status: "pending",
      error: undefined,
    };

    if (options?.freshStart) {
      stepUpdate.executionId = undefined;
      console.log(
        `[SequentialWorkflowEngine] Retrying step ${stepId} with fresh start (clearing executionId)`
      );
    } else {
      console.log(
        `[SequentialWorkflowEngine] Retrying step ${stepId} with session resume (preserving executionId: ${step.executionId})`
      );
    }

    this.updateStep(workflowId, stepId, stepUpdate);

    // Unblock dependent steps
    await this.unblockDependentSteps(workflow, step);

    // Resume workflow if paused or failed
    if (workflow.status === "paused") {
      await this.resumeWorkflow(workflowId);
    } else if (workflow.status === "failed") {
      // Recover a failed workflow by changing status to running and restarting execution loop
      console.log(
        `[SequentialWorkflowEngine] Recovering failed workflow ${workflowId}`
      );

      // Initialize workflow state
      let state = this.activeWorkflows.get(workflowId);
      if (!state) {
        state = {
          workflowId,
          isPaused: false,
          isCancelled: false,
        };
        this.activeWorkflows.set(workflowId, state);
      }
      state.isPaused = false;
      state.isCancelled = false;

      // Update status to running
      this.updateWorkflow(workflowId, { status: "running" });

      // Emit event
      this.eventEmitter.emit({
        type: "workflow_resumed",
        workflowId,
        timestamp: Date.now(),
      });

      // Restart execution loop
      this.runExecutionLoop(workflowId).catch((error) => {
        console.error(`Workflow ${workflowId} execution loop failed:`, error);
        this.failWorkflow(workflowId, error.message).catch(console.error);
      });
    }
  }

  /**
   * Skip a step and handle its dependents.
   *
   * @param workflowId - The workflow containing the step
   * @param stepId - The step to skip
   * @param reason - Optional reason for skipping
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStepNotFoundError if step doesn't exist
   */
  async skipStep(
    workflowId: string,
    stepId: string,
    reason?: string
  ): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);
    const step = workflow.steps.find((s) => s.id === stepId);

    if (!step) {
      throw new WorkflowStepNotFoundError(workflowId, stepId);
    }

    const skipReason = reason || "Manually skipped";

    // Mark as skipped
    this.updateStep(workflowId, stepId, {
      status: "skipped",
      error: skipReason,
    });

    // Emit event
    this.eventEmitter.emit({
      type: "step_skipped",
      workflowId,
      step: { ...step, status: "skipped", error: skipReason },
      reason: skipReason,
      timestamp: Date.now(),
    });

    // Handle dependents based on config
    if (workflow.config.onFailure === "skip_dependents") {
      await this.skipDependentSteps(workflow, step, "Dependency skipped");
    } else {
      await this.blockDependentSteps(workflow, step);
    }

    // Resume workflow if paused
    if (workflow.status === "paused") {
      await this.resumeWorkflow(workflowId);
    }
  }

  // ===========================================================================
  // Execution Loop
  // ===========================================================================

  /**
   * Main execution loop for the workflow.
   * Runs steps in topological order, respecting dependencies.
   *
   * @param workflowId - The workflow to execute
   */
  private async runExecutionLoop(workflowId: string): Promise<void> {
    while (true) {
      // Check workflow state
      const state = this.activeWorkflows.get(workflowId);
      if (!state || state.isPaused || state.isCancelled) {
        break;
      }

      // Get current workflow state
      const workflow = await this.getWorkflowOrThrow(workflowId);

      // Check if workflow is complete
      if (this.isWorkflowComplete(workflow)) {
        await this.completeWorkflow(workflowId);
        break;
      }

      // Get ready steps (dependencies satisfied)
      const readySteps = await this.getReadySteps(workflowId);

      if (readySteps.length === 0) {
        // No ready steps but workflow not complete - likely all remaining steps are blocked
        // This can happen if a step fails and dependents are blocked
        const hasBlockedOrFailed = workflow.steps.some(
          (s) => s.status === "blocked" || s.status === "failed"
        );
        if (hasBlockedOrFailed) {
          // Workflow is stuck, wait for user intervention (retry/skip)
          break;
        }
        // Should not happen - safeguard against infinite loop
        console.warn(
          `Workflow ${workflowId}: No ready steps but workflow not complete`
        );
        break;
      }

      // Execute steps based on parallelism config
      if (workflow.config.parallelism === "sequential") {
        // Execute one step at a time
        await this.executeStep(workflow, readySteps[0]);
      } else {
        // Execute multiple ready steps in parallel mode
        // Note: For Phase 4, this uses shared worktree with sequential commits
        // True parallel execution with separate branches is a future enhancement
        await this.executeParallel(workflow, readySteps);
      }
    }
  }

  /**
   * Execute multiple steps in parallel mode.
   *
   * For Phase 4, this uses a shared worktree with sequential commits.
   * Steps are executed one after another but all ready steps in the batch
   * are processed before re-checking dependencies.
   *
   * Future enhancement: True parallel execution with separate branches
   * and merge handling.
   *
   * @param workflow - The workflow containing the steps
   * @param steps - The ready steps to execute
   */
  private async executeParallel(
    workflow: Workflow,
    steps: WorkflowStep[]
  ): Promise<void> {
    // Respect maxConcurrency limit
    const maxConcurrency = workflow.config.maxConcurrency ?? steps.length;
    const toExecute = steps.slice(0, maxConcurrency);

    // Track failed steps for batch failure handling
    const failedSteps: WorkflowStep[] = [];

    // Execute steps sequentially within the batch
    // (shared worktree requires sequential commits)
    for (const step of toExecute) {
      // Check for pause/cancel between steps
      const state = this.activeWorkflows.get(workflow.id);
      if (!state || state.isPaused || state.isCancelled) {
        break;
      }

      try {
        await this.executeStep(workflow, step);

        // Refresh workflow state to check if step succeeded
        const updatedWorkflow = await this.getWorkflowOrThrow(workflow.id);
        const updatedStep = updatedWorkflow.steps.find((s) => s.id === step.id);

        if (updatedStep?.status === "failed") {
          failedSteps.push(updatedStep);

          // For "stop" strategy, break immediately
          if (workflow.config.onFailure === "stop") {
            break;
          }
          // For "pause" strategy, the workflow is already paused by handleStepFailure
          if (updatedWorkflow.status === "paused") {
            break;
          }
        }
      } catch (error) {
        // Unexpected error during step execution
        console.error(`Error executing step ${step.id}:`, error);
        failedSteps.push(step);

        if (workflow.config.onFailure === "stop") {
          throw error;
        }
      }
    }
  }

  /**
   * Execute a single workflow step.
   *
   * If the step has a previous execution (from a pause), attempts to resume
   * the session. Otherwise creates a new execution.
   *
   * @param workflow - The workflow containing the step
   * @param step - The step to execute
   */
  private async executeStep(
    workflow: Workflow,
    step: WorkflowStep
  ): Promise<void> {
    const state = this.activeWorkflows.get(workflow.id);

    // 1. Get issue details for prompt
    const issue = getIssue(this.db, step.issueId);
    if (!issue) {
      throw new Error(`Issue ${step.issueId} not found`);
    }

    // 2. Check if we should resume a previous execution
    let sessionIdToResume: string | undefined;
    let parentExecutionId: string | undefined;
    if (step.executionId) {
      const previousExecution = getExecution(this.db, step.executionId);
      if (previousExecution?.session_id) {
        sessionIdToResume = previousExecution.session_id;
        parentExecutionId = step.executionId; // Link to previous execution
        console.log(
          `[SequentialWorkflowEngine] Resuming step ${step.id} with session ${sessionIdToResume} (parent: ${parentExecutionId})`
        );
      }
    }

    // 3. Build execution config - always use workflow's worktree
    // Workflow-spawned executions run autonomously without terminal interaction
    const config: ExecutionConfig = {
      mode: "worktree",
      baseBranch: workflow.baseBranch,
      createBaseBranch: workflow.config.createBaseBranch,
      reuseWorktreePath: workflow.worktreePath,
      // Workflow step executions run autonomously - must skip permission prompts
      dangerouslySkipPermissions: true,
      // Use workflow's orchestrator model for consistency if available
      model: workflow.config.orchestratorModel,
      // Resume previous session if available
      resume: sessionIdToResume,
      // Link to parent execution for chain tracking
      parentExecutionId,
    };

    // 4. Build prompt - use resume message if resuming, otherwise full prompt
    const prompt = sessionIdToResume
      ? "Workflow resumed. Continue where you left off."
      : this.buildPrompt(issue, workflow);

    // 5. Update step status to running
    this.updateStep(workflow.id, step.id, {
      status: "running",
    });

    // 6. Emit step started event
    this.eventEmitter.emit({
      type: "step_started",
      workflowId: workflow.id,
      step: { ...step, status: "running" },
      timestamp: Date.now(),
    });

    // 7. Create execution (will resume session if config.resume is set)
    const execution = await this.executionService.createExecution(
      step.issueId,
      config,
      prompt,
      workflow.config.defaultAgentType
    );

    // Track current execution
    if (state) {
      state.currentExecutionId = execution.id;
    }

    // Update step with new execution ID
    this.updateStep(workflow.id, step.id, {
      executionId: execution.id,
    });

    // 8. Wait for execution to complete
    const completedExecution = await this.waitForExecution(execution.id);

    // Clear current execution tracking
    if (state) {
      state.currentExecutionId = undefined;
    }

    // 9. Check if workflow was paused/cancelled during execution
    // If so, don't treat the cancelled execution as a failure
    if (state?.isPaused || state?.isCancelled) {
      console.log(
        `[SequentialWorkflowEngine] Step ${step.id} execution ended due to workflow ${state.isPaused ? "pause" : "cancel"}, not treating as failure`
      );
      return;
    }

    // 10. Handle result
    if (completedExecution.status === "completed") {
      await this.handleStepSuccess(workflow, step, completedExecution);
    } else {
      await this.handleStepFailure(workflow, step, completedExecution);
    }
  }

  /**
   * Wait for an execution to complete by polling.
   *
   * @param executionId - The execution to wait for
   * @returns The completed execution
   */
  private async waitForExecution(executionId: string): Promise<Execution> {
    const pollIntervalMs = 1000; // 1 second
    const maxWaitMs = 60 * 60 * 1000; // 1 hour max
    const startTime = Date.now();

    while (true) {
      const execution = getExecution(this.db, executionId);
      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      // Check if execution is in a terminal state
      if (
        execution.status === "completed" ||
        execution.status === "failed" ||
        execution.status === "stopped" ||
        execution.status === "cancelled"
      ) {
        return execution;
      }

      // Check timeout
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(
          `Execution ${executionId} timed out after ${maxWaitMs}ms`
        );
      }

      // Wait before next poll
      await this.sleep(pollIntervalMs);
    }
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build the prompt for executing an issue.
   *
   * @param issue - The issue to execute
   * @param workflow - The workflow context
   * @returns The prompt string
   */
  private buildPrompt(issue: Issue, workflow: Workflow): string {
    // Build a basic prompt from issue details
    const parts: string[] = [];

    parts.push(`# Task: ${issue.title}`);
    parts.push("");

    if (issue.content) {
      parts.push("## Description");
      parts.push(issue.content);
      parts.push("");
    }

    // Add workflow context
    parts.push("## Workflow Context");
    parts.push(
      `This is step ${workflow.currentStepIndex + 1} of ${workflow.steps.length} in workflow "${workflow.title}".`
    );

    return parts.join("\n");
  }

  /**
   * Handle successful step completion.
   *
   * @param workflow - The workflow containing the step
   * @param step - The completed step
   * @param execution - The execution result
   */
  private async handleStepSuccess(
    workflow: Workflow,
    step: WorkflowStep,
    execution: Execution
  ): Promise<void> {
    console.log(
      `[SequentialWorkflowEngine] handleStepSuccess called for step ${step.index + 1}, execution ${execution.id}, stream_id: ${execution.stream_id}`
    );
    // Convert null to undefined for type compatibility
    let commitSha = execution.after_commit ?? undefined;

    // Close the issue BEFORE auto-commit so the status change is included
    // Use worktree path to keep changes isolated until explicit sync
    await this.closeIssue(step.issueId, workflow.worktreePath);

    // Auto-commit if configured and we have a worktree
    // This now includes the issue status change from closeIssue above
    if (workflow.config.autoCommitAfterStep && workflow.worktreePath) {
      const newCommitSha = await this.commitStepChanges(workflow, step);
      if (newCommitSha) {
        commitSha = newCommitSha;
        // Update execution's after_commit since the commit happened after handleSuccess captured it
        updateExecution(this.db, execution.id, {
          after_commit: newCommitSha,
        });
      }
    }

    // Create dataplane checkpoint for this execution (if dataplane is enabled)
    // This ensures workflow step completions are tracked in stacks/queues
    const dataplaneAdapter = getDataplaneAdapterSync(this.repoPath);
    console.log(
      `[SequentialWorkflowEngine] Checkpoint check - adapter: ${!!dataplaneAdapter}, initialized: ${dataplaneAdapter?.isInitialized}, stream_id: ${execution.stream_id}, checkpointsModule: ${!!dataplaneAdapter?.checkpointsModule}, diffStacksModule: ${!!dataplaneAdapter?.diffStacksModule}`
    );
    if (dataplaneAdapter?.isInitialized && execution.stream_id) {
      try {
        const checkpointResult = await dataplaneAdapter.checkpointSync(
          execution.id,
          this.db,
          {
            message: `Workflow checkpoint: ${step.issueId} (step ${step.index + 1}/${workflow.steps.length})`,
            targetBranch: workflow.baseBranch,
            autoEnqueue: true, // Auto-add to merge queue
            worktreePath: workflow.worktreePath, // Pass workflow's worktree since it's not registered in dataplane
          }
        );

        if (checkpointResult.success) {
          console.log(
            `[SequentialWorkflowEngine] Created checkpoint for execution ${execution.id}: ${checkpointResult.checkpoint?.id}`
          );
        } else {
          console.warn(
            `[SequentialWorkflowEngine] Failed to create checkpoint for execution ${execution.id}: ${checkpointResult.error}`
          );
        }
      } catch (error) {
        console.warn(
          `[SequentialWorkflowEngine] Error creating checkpoint for execution ${execution.id}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue - checkpoint creation is non-fatal
      }
    }

    // Update step status
    this.updateStep(workflow.id, step.id, {
      status: "completed",
      commitSha,
    });

    // Emit event
    this.eventEmitter.emit({
      type: "step_completed",
      workflowId: workflow.id,
      step: { ...step, status: "completed", commitSha },
      executionId: execution.id,
      timestamp: Date.now(),
    });

    // Update workflow progress
    this.updateWorkflow(workflow.id, {
      currentStepIndex: workflow.currentStepIndex + 1,
    });
  }

  /**
   * Commit step changes to git.
   *
   * @param workflow - The workflow containing the step
   * @param step - The completed step
   * @returns The commit SHA if successful, null otherwise
   */
  private async commitStepChanges(
    workflow: Workflow,
    step: WorkflowStep
  ): Promise<string | null> {
    if (!workflow.worktreePath) {
      return null;
    }

    const issue = getIssue(this.db, step.issueId);
    const message = this.buildCommitMessage(workflow, step, issue);

    try {
      // Check if there are changes to commit
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: workflow.worktreePath,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (!status.trim()) {
        // No changes to commit
        return null;
      }

      // Stage all changes and commit
      // Escape double quotes in message for shell safety
      const escapedMessage = message.replace(/"/g, '\\"');
      await execAsync(`git add -A && git commit --no-verify -m "${escapedMessage}"`, {
        cwd: workflow.worktreePath,
        maxBuffer: 10 * 1024 * 1024,
      });

      // Get new commit SHA
      const { stdout: sha } = await execAsync("git rev-parse HEAD", {
        cwd: workflow.worktreePath,
      });

      return sha.trim();
    } catch (error) {
      console.error("Failed to commit step changes:", error);
      return null;
    }
  }

  /**
   * Build commit message for a step.
   *
   * @param workflow - The workflow
   * @param step - The completed step
   * @param issue - The issue (may be null)
   * @returns The commit message
   */
  private buildCommitMessage(
    workflow: Workflow,
    step: WorkflowStep,
    issue: Issue | null
  ): string {
    const issueTitle = issue?.title || "Unknown issue";
    const stepNum = step.index + 1;
    const totalSteps = workflow.steps.length;

    return `[Workflow ${stepNum}/${totalSteps}] ${step.issueId}: ${issueTitle}

Workflow: ${workflow.title}
Step: ${stepNum} of ${totalSteps}`;
  }

  /**
   * Update an issue directly in the worktree's JSONL file.
   * This keeps changes isolated to the worktree until explicitly synced.
   *
   * @param worktreePath - Path to the worktree
   * @param issueId - The issue ID to update
   * @param updates - Partial issue updates to apply
   */
  private async updateIssueInWorktree(
    worktreePath: string,
    issueId: string,
    updates: Partial<IssueJSONL>
  ): Promise<void> {
    const issuesPath = path.join(worktreePath, ".sudocode", "issues.jsonl");

    // Read current issues from worktree JSONL
    const issues = readJSONLSync<IssueJSONL>(issuesPath);

    // Find and update the issue
    const issueIndex = issues.findIndex((issue) => issue.id === issueId);
    if (issueIndex === -1) {
      console.warn(
        `[SequentialWorkflowEngine] Issue ${issueId} not found in worktree JSONL`
      );
      return;
    }

    // Apply updates
    const updatedIssue: IssueJSONL = {
      ...issues[issueIndex],
      ...updates,
      updated_at: new Date().toISOString(),
    };

    // Handle closed_at for status changes
    if (updates.status === "closed" && issues[issueIndex].status !== "closed") {
      updatedIssue.closed_at = new Date().toISOString();
    } else if (updates.status && updates.status !== "closed" && issues[issueIndex].status === "closed") {
      updatedIssue.closed_at = undefined;
    }

    issues[issueIndex] = updatedIssue;

    // Write back to JSONL
    await writeJSONL(issuesPath, issues);

    console.log(
      `[SequentialWorkflowEngine] Updated issue ${issueId} in worktree JSONL:`,
      updates
    );
  }

  /**
   * Close an issue after successful step completion.
   * If a worktree path is provided, updates the worktree's JSONL directly.
   * Otherwise, updates the main database.
   *
   * @param issueId - The issue ID to close
   * @param worktreePath - Optional path to the worktree for isolated updates
   */
  private async closeIssue(
    issueId: string,
    worktreePath?: string
  ): Promise<void> {
    try {
      if (worktreePath) {
        // Update the worktree's JSONL file directly
        await this.updateIssueInWorktree(worktreePath, issueId, {
          status: "closed",
        });
      } else {
        // Fall back to main database
        updateIssue(this.db, issueId, { status: "closed" });
      }
    } catch (error) {
      // Non-fatal - log but don't fail
      console.warn(`Failed to close issue ${issueId}:`, error);
    }
  }

  /**
   * Handle step failure.
   *
   * @param workflow - The workflow containing the step
   * @param step - The failed step
   * @param execution - The execution result
   */
  private async handleStepFailure(
    workflow: Workflow,
    step: WorkflowStep,
    execution: Execution
  ): Promise<void> {
    const errorMessage = execution.error_message || "Unknown error";

    // Handle based on failure strategy
    // For "pause" strategy, we keep the step in "pending" state so it can be resumed
    // For other strategies, we mark it as "failed"
    switch (workflow.config.onFailure) {
      case "pause":
        // Reset step to pending so it can be resumed when workflow resumes
        // Keep executionId so we can resume the Claude session
        this.updateStep(workflow.id, step.id, {
          status: "pending",
          // Keep executionId for session resume
          error: undefined,
        });

        console.log(
          `[SequentialWorkflowEngine] Step ${step.id} failed but keeping pending for resume (executionId: ${step.executionId})`
        );

        // Emit a workflow_paused event (not step_failed since it's resumable)
        await this.pauseWorkflow(workflow.id);
        break;

      case "stop":
        // Mark step as failed
        this.updateStep(workflow.id, step.id, {
          status: "failed",
          error: errorMessage,
        });

        // Emit event
        this.eventEmitter.emit({
          type: "step_failed",
          workflowId: workflow.id,
          step: { ...step, status: "failed", error: errorMessage },
          error: errorMessage,
          timestamp: Date.now(),
        });

        await this.failWorkflow(
          workflow.id,
          `Step ${step.id} failed: ${errorMessage}`
        );
        break;

      case "skip_dependents":
        // Mark step as failed
        this.updateStep(workflow.id, step.id, {
          status: "failed",
          error: errorMessage,
        });

        // Emit event
        this.eventEmitter.emit({
          type: "step_failed",
          workflowId: workflow.id,
          step: { ...step, status: "failed", error: errorMessage },
          error: errorMessage,
          timestamp: Date.now(),
        });

        await this.skipDependentSteps(
          workflow,
          step,
          `Dependency ${step.issueId} failed`
        );
        break;

      case "continue":
        // Mark step as failed
        this.updateStep(workflow.id, step.id, {
          status: "failed",
          error: errorMessage,
        });

        // Emit event
        this.eventEmitter.emit({
          type: "step_failed",
          workflowId: workflow.id,
          step: { ...step, status: "failed", error: errorMessage },
          error: errorMessage,
          timestamp: Date.now(),
        });

        // Mark dependents as blocked, continue with other steps
        await this.blockDependentSteps(workflow, step);
        break;
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Mark workflow as failed.
   */
  private async failWorkflow(workflowId: string, error: string): Promise<void> {
    this.updateWorkflow(workflowId, {
      status: "failed",
      completedAt: new Date().toISOString(),
    });

    this.eventEmitter.emit({
      type: "workflow_failed",
      workflowId,
      error,
      timestamp: Date.now(),
    });

    this.activeWorkflows.delete(workflowId);
  }

  /**
   * Mark workflow as completed.
   */
  protected async completeWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);

    this.updateWorkflow(workflowId, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    this.eventEmitter.emit({
      type: "workflow_completed",
      workflowId,
      workflow: { ...workflow, status: "completed" },
      timestamp: Date.now(),
    });

    this.activeWorkflows.delete(workflowId);
  }

  /**
   * Check if workflow is complete (all steps done or skipped).
   */
  protected isWorkflowComplete(workflow: Workflow): boolean {
    return workflow.steps.every(
      (step) =>
        step.status === "completed" ||
        step.status === "skipped" ||
        step.status === "blocked"
    );
  }

  /**
   * Find all steps that transitively depend on a given step.
   */
  protected findDependentSteps(
    workflow: Workflow,
    stepId: string
  ): WorkflowStep[] {
    const dependents: WorkflowStep[] = [];
    const visited = new Set<string>();
    const queue = [stepId];

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const step of workflow.steps) {
        if (step.dependencies.includes(current) && !visited.has(step.id)) {
          visited.add(step.id);
          dependents.push(step);
          queue.push(step.id);
        }
      }
    }

    return dependents;
  }

  /**
   * Skip all steps that depend on a failed/skipped step.
   */
  protected async skipDependentSteps(
    workflow: Workflow,
    failedStep: WorkflowStep,
    reason: string
  ): Promise<void> {
    const dependents = this.findDependentSteps(workflow, failedStep.id);

    for (const step of dependents) {
      if (step.status === "pending" || step.status === "ready") {
        this.updateStep(workflow.id, step.id, {
          status: "skipped",
          error: reason,
        });

        this.eventEmitter.emit({
          type: "step_skipped",
          workflowId: workflow.id,
          step: { ...step, status: "skipped", error: reason },
          reason,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Block all steps that depend on a failed step.
   */
  protected async blockDependentSteps(
    workflow: Workflow,
    failedStep: WorkflowStep
  ): Promise<void> {
    const dependents = this.findDependentSteps(workflow, failedStep.id);

    for (const step of dependents) {
      if (step.status === "pending" || step.status === "ready") {
        this.updateStep(workflow.id, step.id, {
          status: "blocked",
        });
      }
    }
  }

  /**
   * Unblock steps that were blocked due to a failed dependency.
   */
  protected async unblockDependentSteps(
    workflow: Workflow,
    retriedStep: WorkflowStep
  ): Promise<void> {
    const dependents = this.findDependentSteps(workflow, retriedStep.id);

    for (const step of dependents) {
      if (step.status === "blocked") {
        this.updateStep(workflow.id, step.id, {
          status: "pending",
        });
      }
    }
  }
}
