/**
 * Orchestrator Workflow Engine
 *
 * Agent-managed workflow execution. The orchestrator is itself an execution
 * (Claude Code agent) that controls workflow steps via MCP tools.
 *
 * Key differences from SequentialWorkflowEngine:
 * - No internal execution loop - orchestrator agent handles execution
 * - Wakeup mechanism - events trigger follow-up executions
 * - MCP tools for step control - orchestrator uses workflow_* and execute_* tools
 */

import path from "path";
import { fileURLToPath } from "url";
import type Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type {
  Workflow,
  WorkflowRow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowStep,
  WorkflowStepStatus,
  Issue,
} from "@sudocode-ai/types";
import { getIssue } from "@sudocode-ai/cli/dist/operations/issues.js";

import { BaseWorkflowEngine } from "../base-workflow-engine.js";
import {
  WorkflowCycleError,
  WorkflowStateError,
  WorkflowStepNotFoundError,
} from "../workflow-engine.js";
import type { WorkflowEventEmitter } from "../workflow-event-emitter.js";
import type {
  ExecutionService,
  McpServerConfig,
} from "../../services/execution-service.js";
import type { WorkflowWakeupService } from "../services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../services/prompt-builder.js";
import {
  registerExecutionCallback,
  type ExecutionEventType,
  type ExecutionEventData,
} from "../../services/execution-event-callbacks.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the orchestrator engine.
 */
export interface OrchestratorEngineConfig {
  /** Path to the repository root */
  repoPath: string;
  /** Path to the database file */
  dbPath: string;
  /** Path to the MCP server entry point */
  mcpServerPath?: string;
  /** Base URL of the server for MCP API calls (e.g., http://localhost:3000) */
  serverUrl: string;
  /** Project ID for API calls */
  projectId: string;
}

// =============================================================================
// Orchestrator Workflow Engine
// =============================================================================

/**
 * Orchestrator Workflow Engine implementation.
 *
 * This engine spawns an orchestrator agent (Claude Code execution) that controls
 * the workflow using MCP tools. The orchestrator makes decisions about:
 * - Which issues to execute
 * - How to handle failures
 * - When to escalate to the user
 *
 * Events from step executions trigger "wakeups" - follow-up messages to the
 * orchestrator that inform it of completed work.
 *
 * @example
 * ```typescript
 * const engine = new OrchestratorWorkflowEngine({
 *   db,
 *   executionService,
 *   wakeupService,
 *   config: {
 *     repoPath: '/path/to/repo',
 *     dbPath: '/path/to/.sudocode/cache.db',
 *   },
 * });
 *
 * // Create workflow from a goal
 * const workflow = await engine.createWorkflow({
 *   type: "goal",
 *   goal: "Implement user authentication with OAuth"
 * });
 *
 * // Start orchestrator
 * await engine.startWorkflow(workflow.id);
 * ```
 */
export class OrchestratorWorkflowEngine extends BaseWorkflowEngine {
  private executionService: ExecutionService;
  private wakeupService: WorkflowWakeupService;
  private promptBuilder: WorkflowPromptBuilder;
  private config: OrchestratorEngineConfig;
  private unregisterExecutionCallback?: () => void;

  constructor(deps: {
    db: Database.Database;
    executionService: ExecutionService;
    wakeupService: WorkflowWakeupService;
    eventEmitter?: WorkflowEventEmitter;
    config: OrchestratorEngineConfig;
  }) {
    super(deps.db, deps.eventEmitter);
    this.executionService = deps.executionService;
    this.wakeupService = deps.wakeupService;
    this.promptBuilder = new WorkflowPromptBuilder();
    this.config = deps.config;

    // Register callback to record workflow events when executions complete
    this.setupExecutionCallbacks();
  }

  // ===========================================================================
  // Execution Event Callbacks
  // ===========================================================================

  /**
   * Set up callbacks to record workflow events when executions complete/fail.
   *
   * When an execution that belongs to a workflow completes or fails, we need to:
   * 1. Find the corresponding workflow step
   * 2. Update the step status
   * 3. Record a workflow event (step_completed or step_failed)
   * 4. Trigger a wakeup so the orchestrator can react
   */
  private setupExecutionCallbacks(): void {
    this.unregisterExecutionCallback = registerExecutionCallback(
      async (event: ExecutionEventType, data: ExecutionEventData) => {
        // Only handle events from workflow executions
        if (!data.workflowId) {
          return;
        }

        // Get the workflow
        const workflow = await this.getWorkflow(data.workflowId);
        if (!workflow) {
          console.warn(
            `[OrchestratorEngine] Workflow not found for execution event: ${data.workflowId}`
          );
          return;
        }

        // Find the step for this execution
        const step = workflow.steps.find(
          (s: WorkflowStep) => s.executionId === data.executionId
        );
        if (!step) {
          // Might be the orchestrator execution itself, not a step
          console.debug(
            `[OrchestratorEngine] No step found for execution ${data.executionId} in workflow ${data.workflowId}`
          );
          return;
        }

        // Clear any pending timeout for this execution
        this.wakeupService.clearExecutionTimeout(data.executionId);

        // Determine event type and update step status
        const eventType =
          event === "completed" ? "step_completed" : "step_failed";
        const newStepStatus = event === "completed" ? "completed" : "failed";

        // Update step status in workflow
        const updatedSteps = workflow.steps.map((s: WorkflowStep) =>
          s.id === step.id
            ? { ...s, status: newStepStatus as WorkflowStepStatus }
            : s
        );
        this.updateWorkflow(data.workflowId, { steps: updatedSteps });

        // Record workflow event for orchestrator
        await this.wakeupService.recordEvent({
          workflowId: data.workflowId,
          type: eventType,
          executionId: data.executionId,
          stepId: step.id,
          payload: {
            issueId: step.issueId,
            error: data.error,
          },
        });

        // Trigger wakeup so orchestrator can react
        await this.wakeupService.triggerWakeup(data.workflowId);

        console.log(
          `[OrchestratorEngine] Recorded ${eventType} for step ${step.id} in workflow ${data.workflowId}`
        );
      }
    );
  }

  /**
   * Clean up the execution callback when the engine is disposed.
   */
  dispose(): void {
    if (this.unregisterExecutionCallback) {
      this.unregisterExecutionCallback();
      this.unregisterExecutionCallback = undefined;
    }
  }

  // ===========================================================================
  // Workflow Creation
  // ===========================================================================

  /**
   * Create a new workflow from a source definition.
   *
   * For orchestrator workflows, goal-based sources create empty workflows
   * that the orchestrator populates dynamically.
   *
   * @param source - How to determine workflow scope (spec, issues, root_issue, or goal)
   * @param config - Optional configuration overrides
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
      const workflow = this.buildWorkflow({
        source,
        steps: [],
        config: config || {},
        repoPath: this.config.repoPath,
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
      repoPath: this.config.repoPath,
    });

    // 7. Save to database
    this.saveWorkflow(workflow);

    return workflow;
  }

  // ===========================================================================
  // Workflow Lifecycle
  // ===========================================================================

  /**
   * Start executing a pending workflow.
   *
   * Spawns an orchestrator execution (Claude Code agent) with workflow MCP tools.
   * The orchestrator will use these tools to control step execution.
   *
   * @param workflowId - The workflow to start
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not in pending state
   */
  async startWorkflow(workflowId: string): Promise<void> {
    console.log(
      `[OrchestratorWorkflowEngine] startWorkflow called for ${workflowId}`
    );
    const workflow = await this.getWorkflowOrThrow(workflowId);

    // Validate state
    if (workflow.status !== "pending") {
      throw new WorkflowStateError(workflowId, workflow.status, "start");
    }

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

    // Spawn orchestrator execution
    console.log(
      `[OrchestratorWorkflowEngine] Spawning orchestrator for workflow ${workflowId}`
    );
    await this.spawnOrchestrator(updated);
  }

  /**
   * Pause a running workflow.
   *
   * Sets pause status and records an event. The orchestrator will be notified
   * via wakeup when it checks workflow status.
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

    // Update status
    this.updateWorkflow(workflowId, { status: "paused" });

    // Record pause event for orchestrator
    await this.wakeupService.recordEvent({
      workflowId,
      type: "workflow_paused",
      payload: {},
    });

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
   * Updates status and triggers immediate wakeup to notify orchestrator.
   *
   * @param workflowId - The workflow to resume
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStateError if workflow is not paused
   */
  async resumeWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);

    if (workflow.status !== "paused") {
      throw new WorkflowStateError(workflowId, workflow.status, "resume");
    }

    // Update status
    this.updateWorkflow(workflowId, { status: "running" });

    // Record resume event and trigger immediate wakeup
    await this.wakeupService.recordEvent({
      workflowId,
      type: "workflow_resumed",
      payload: {},
    });

    // Trigger immediate wakeup
    await this.wakeupService.triggerWakeup(workflowId);

    // Emit event
    this.eventEmitter.emit({
      type: "workflow_resumed",
      workflowId,
      timestamp: Date.now(),
    });
  }

  /**
   * Cancel a workflow, stopping the orchestrator and any running executions.
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

    // Cancel orchestrator execution if running
    if (workflow.orchestratorExecutionId) {
      try {
        await this.executionService.cancelExecution(
          workflow.orchestratorExecutionId
        );
      } catch (error) {
        console.warn(
          `Failed to cancel orchestrator execution ${workflow.orchestratorExecutionId}:`,
          error
        );
      }
    }

    // Cancel pending wakeup
    this.wakeupService.cancelPendingWakeup(workflowId);

    // Find and cancel any running step executions
    await this.cancelRunningExecutions(workflow);

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
  }

  // ===========================================================================
  // Step Control
  // ===========================================================================

  /**
   * Retry a failed step.
   *
   * Records an event for the orchestrator to handle.
   * The orchestrator decides how to actually retry.
   *
   * @param workflowId - The workflow containing the step
   * @param stepId - The step to retry
   * @throws WorkflowNotFoundError if workflow doesn't exist
   * @throws WorkflowStepNotFoundError if step doesn't exist
   */
  async retryStep(workflowId: string, stepId: string): Promise<void> {
    const workflow = await this.getWorkflowOrThrow(workflowId);
    const step = workflow.steps.find((s) => s.id === stepId);

    if (!step) {
      throw new WorkflowStepNotFoundError(workflowId, stepId);
    }

    // Record event for orchestrator
    await this.wakeupService.recordEvent({
      workflowId,
      type: "step_started", // Re-use step_started as retry signal
      stepId,
      payload: {
        action: "retry",
        issueId: step.issueId,
      },
    });
  }

  /**
   * Skip a step.
   *
   * Records an event for the orchestrator to handle.
   * The orchestrator decides how to handle dependents.
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

    // Record event for orchestrator
    await this.wakeupService.recordEvent({
      workflowId,
      type: "step_skipped",
      stepId,
      payload: {
        action: "skip",
        issueId: step.issueId,
        reason: reason || "Manually skipped",
      },
    });
  }

  // ===========================================================================
  // Escalation
  // ===========================================================================

  /**
   * Trigger a wakeup for an escalation response.
   *
   * Called by the API when a user responds to an escalation.
   * Immediately triggers the orchestrator to resume with the response.
   *
   * @param workflowId - The workflow to wake up
   */
  async triggerEscalationWakeup(workflowId: string): Promise<void> {
    await this.wakeupService.triggerWakeup(workflowId);
  }

  // ===========================================================================
  // Private: Orchestrator Spawning
  // ===========================================================================

  /**
   * Spawn an orchestrator execution (Claude Code agent).
   *
   * The orchestrator is given:
   * - Workflow MCP tools for control
   * - Initial prompt with workflow context
   * - Access to sudocode MCP tools for issue management
   */
  private async spawnOrchestrator(workflow: Workflow): Promise<void> {
    // Get issues for initial prompt
    const issues = this.getIssuesForWorkflow(workflow);

    // Build initial prompt
    const prompt = this.promptBuilder.buildInitialPrompt(workflow, issues);

    // Build agent config with MCP servers
    const agentConfig = this.buildOrchestratorConfig(workflow);

    // Determine agent type (default to claude-code)
    const agentType = workflow.config.orchestratorAgentType ?? "claude-code";

    // Log the full config being passed to createExecution
    const fullConfig = {
      mode: "local" as const,
      baseBranch: workflow.baseBranch,
      ...agentConfig,
    };
    console.log(
      "[OrchestratorWorkflowEngine] Creating execution with config:",
      JSON.stringify(fullConfig, null, 2)
    );

    // Create orchestrator execution
    const execution = await this.executionService.createExecution(
      null, // No issue - this is the orchestrator itself
      fullConfig,
      prompt,
      agentType
    );

    // Store orchestrator execution ID and session ID on workflow
    this.updateWorkflow(workflow.id, {
      orchestratorExecutionId: execution.id,
      orchestratorSessionId: execution.session_id,
    });
  }

  /**
   * Build the orchestrator agent configuration.
   *
   * Configures MCP servers for workflow control and sudocode access.
   * Enables dangerouslySkipPermissions for automated workflow execution.
   */
  private buildOrchestratorConfig(workflow: Workflow): {
    mcpServers?: Record<string, McpServerConfig>;
    model?: string;
    appendSystemPrompt?: string;
    dangerouslySkipPermissions?: boolean;
  } {
    const config: {
      mcpServers?: Record<string, McpServerConfig>;
      model?: string;
      appendSystemPrompt?: string;
      dangerouslySkipPermissions?: boolean;
    } = {
      // Orchestrator runs autonomously - must skip permission prompts
      dangerouslySkipPermissions: true,
    };

    // Add workflow MCP server
    // Note: When running in dev mode (tsx/ts-node), __dirname points to src/
    // but we need the compiled dist/ path. Detect and fix this.
    let mcpServerPath = this.config.mcpServerPath;
    if (!mcpServerPath) {
      const defaultPath = path.join(__dirname, "../mcp/index.js");
      // If path contains /src/, replace with /dist/ to get compiled version
      mcpServerPath = defaultPath.includes("/src/")
        ? defaultPath.replace("/src/", "/dist/")
        : defaultPath;
    }

    console.log("[OrchestratorWorkflowEngine] MCP server path:", mcpServerPath);

    const mcpArgs = [
      mcpServerPath,
      "--workflow-id",
      workflow.id,
      "--server-url",
      this.config.serverUrl,
      "--project-id",
      this.config.projectId,
      "--repo-path",
      this.config.repoPath,
    ];

    config.mcpServers = {
      "sudocode-workflow": {
        command: "node",
        args: mcpArgs,
      },
    };

    // Log the MCP run command for local testing
    console.log(
      "[OrchestratorWorkflowEngine] MCP server config for workflow",
      workflow.id
    );
    console.log(
      "[OrchestratorWorkflowEngine] To test MCP locally, run:\n" +
        `  node ${mcpArgs.join(" ")}`
    );

    // Set model if specified
    if (workflow.config.orchestratorModel) {
      config.model = workflow.config.orchestratorModel;
    }

    // Add system prompt extension for orchestrator role
    config.appendSystemPrompt = `
You are a workflow orchestrator managing the execution of coding tasks.
You have access to workflow MCP tools to control execution flow.

IMPORTANT: You are orchestrating workflow "${workflow.id}".
Use the workflow tools to:
- Check workflow status with workflow_status
- Execute issues with execute_issue
- Inspect results with execution_trajectory and execution_changes
- Handle failures appropriately based on the workflow config
- Mark the workflow complete when done with workflow_complete
`;

    return config;
  }

  /**
   * Get issues for the workflow (for initial prompt).
   */
  private getIssuesForWorkflow(workflow: Workflow): Issue[] {
    const issues: Issue[] = [];

    for (const step of workflow.steps) {
      const issue = getIssue(this.db, step.issueId);
      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  }

  /**
   * Cancel all running step executions for a workflow.
   */
  private async cancelRunningExecutions(workflow: Workflow): Promise<void> {
    // Find executions linked to this workflow
    const executions = this.db
      .prepare(
        `
        SELECT id FROM executions
        WHERE workflow_execution_id = ?
          AND status IN ('pending', 'running', 'preparing')
      `
      )
      .all(workflow.id) as Array<{ id: string }>;

    for (const { id } of executions) {
      try {
        await this.executionService.cancelExecution(id);
      } catch (error) {
        console.warn(`Failed to cancel execution ${id}:`, error);
      }
    }
  }

  // ===========================================================================
  // Recovery
  // ===========================================================================

  /**
   * Recover orphaned workflows on server restart.
   *
   * Finds workflows in 'running' status whose orchestrator execution
   * is no longer running, and triggers a wakeup to resume them.
   */
  async recoverOrphanedWorkflows(): Promise<void> {
    console.log("[OrchestratorEngine] Checking for orphaned workflows...");

    // Find workflows in 'running' status
    const runningWorkflows = this.db
      .prepare(`SELECT * FROM workflows WHERE status = 'running'`)
      .all() as WorkflowRow[];

    let recoveredCount = 0;

    for (const row of runningWorkflows) {
      // Parse the workflow row
      const workflow: Workflow = {
        id: row.id,
        title: row.title,
        source: JSON.parse(row.source),
        status: row.status as Workflow["status"],
        steps: JSON.parse(row.steps),
        worktreePath: row.worktree_path ?? undefined,
        branchName: row.branch_name ?? undefined,
        baseBranch: row.base_branch,
        currentStepIndex: row.current_step_index,
        orchestratorExecutionId: row.orchestrator_execution_id ?? undefined,
        orchestratorSessionId: row.orchestrator_session_id ?? undefined,
        config: JSON.parse(row.config),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
      };

      // Skip if no orchestrator execution
      if (!workflow.orchestratorExecutionId) {
        console.warn(
          `[OrchestratorEngine] Workflow ${workflow.id} running but no orchestrator`
        );
        continue;
      }

      // Check orchestrator execution status
      const orchestrator = this.db
        .prepare(`SELECT status FROM executions WHERE id = ?`)
        .get(workflow.orchestratorExecutionId) as
        | { status: string }
        | undefined;

      // If orchestrator is not running, trigger recovery
      if (!orchestrator || orchestrator.status !== "running") {
        console.log(
          `[OrchestratorEngine] Recovering workflow ${workflow.id} ` +
            `(orchestrator status: ${orchestrator?.status ?? "not found"})`
        );

        try {
          // Record recovery event
          await this.wakeupService.recordEvent({
            workflowId: workflow.id,
            type: "orchestrator_wakeup",
            payload: {
              reason: "recovery",
              previousStatus: orchestrator?.status,
            },
          });

          // Trigger wakeup to resume
          await this.wakeupService.triggerWakeup(workflow.id);
          recoveredCount++;
        } catch (err) {
          console.error(
            `[OrchestratorEngine] Failed to recover workflow ${workflow.id}:`,
            err
          );
        }
      }
    }

    console.log(
      `[OrchestratorEngine] Recovery complete: ${recoveredCount}/${runningWorkflows.length} workflows recovered`
    );
  }

  /**
   * Mark stale running executions as failed.
   *
   * Called during recovery to clean up executions that were running
   * when the server crashed.
   */
  async markStaleExecutionsAsFailed(): Promise<void> {
    console.log("[OrchestratorEngine] Checking for stale executions...");

    const staleExecutions = this.db
      .prepare(
        `
        SELECT id, workflow_execution_id FROM executions
        WHERE status = 'running'
          AND workflow_execution_id IS NOT NULL
      `
      )
      .all() as Array<{ id: string; workflow_execution_id: string }>;

    for (const exec of staleExecutions) {
      console.log(
        `[OrchestratorEngine] Marking stale execution ${exec.id} as failed`
      );

      this.db
        .prepare(
          `
          UPDATE executions
          SET status = 'failed',
              error_message = 'Execution was running when server restarted',
              completed_at = ?
          WHERE id = ?
        `
        )
        .run(new Date().toISOString(), exec.id);
    }

    if (staleExecutions.length > 0) {
      console.log(
        `[OrchestratorEngine] Marked ${staleExecutions.length} stale executions as failed`
      );
    }
  }
}
