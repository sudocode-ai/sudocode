/**
 * Base Workflow Engine
 *
 * Abstract base class with shared logic for workflow engine implementations.
 * Both SequentialWorkflowEngine and OrchestratorWorkflowEngine extend this class.
 */

import { randomUUID } from "crypto";
import { execSync } from "child_process";
import type Database from "better-sqlite3";
import type {
  Workflow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowStep,
  WorkflowRow,
  WorkflowStatus,
  WorkflowStepStatus,
  DependencyGraph,
} from "@sudocode-ai/types";
import { getIncomingRelationships } from "@sudocode-ai/cli/dist/operations/relationships.js";
import { getIssue } from "@sudocode-ai/cli/dist/operations/issues.js";

import type { IWorkflowEngine } from "./workflow-engine.js";
import {
  WorkflowNotFoundError,
  WorkflowStepNotFoundError,
  DEFAULT_WORKFLOW_CONFIG,
} from "./workflow-engine.js";
import {
  WorkflowEventEmitter,
  type WorkflowEventListener,
  createEscalationRequestedEvent,
  createEscalationResolvedEvent,
  createStepStartedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createWorkflowCompletedEvent,
  createWorkflowFailedEvent,
} from "./workflow-event-emitter.js";
import { analyzeDependencies } from "./dependency-analyzer.js";
import type { ExecutionLifecycleService } from "../services/execution-lifecycle.js";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique workflow ID.
 */
function generateWorkflowId(): string {
  return `wf-${randomUUID().slice(0, 8)}`;
}

/**
 * Generate a unique step ID.
 */
function generateStepId(): string {
  return `step-${randomUUID().slice(0, 8)}`;
}

/**
 * Convert a database row to a Workflow object.
 */
function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    title: row.title,
    source: JSON.parse(row.source) as WorkflowSource,
    status: row.status,
    steps: JSON.parse(row.steps) as WorkflowStep[],
    worktreePath: row.worktree_path ?? undefined,
    branchName: row.branch_name ?? undefined,
    baseBranch: row.base_branch,
    currentStepIndex: row.current_step_index,
    orchestratorExecutionId: row.orchestrator_execution_id ?? undefined,
    orchestratorSessionId: row.orchestrator_session_id ?? undefined,
    config: JSON.parse(row.config) as WorkflowConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

/**
 * Merge partial config with defaults.
 */
function mergeConfig(partial?: Partial<WorkflowConfig>): WorkflowConfig {
  return {
    ...DEFAULT_WORKFLOW_CONFIG,
    ...partial,
  };
}

// =============================================================================
// Base Workflow Engine
// =============================================================================

/**
 * Abstract base class for workflow engine implementations.
 *
 * Provides shared functionality for:
 * - Database CRUD operations
 * - Source resolution (spec, issues, root_issue, goal)
 * - Step creation from dependency graph
 * - Ready step detection
 * - Event subscription
 *
 * Subclasses must implement:
 * - createWorkflow()
 * - startWorkflow()
 * - pauseWorkflow()
 * - resumeWorkflow()
 * - cancelWorkflow()
 * - retryStep()
 * - skipStep()
 */
export abstract class BaseWorkflowEngine implements IWorkflowEngine {
  protected db: Database.Database;
  protected eventEmitter: WorkflowEventEmitter;

  constructor(db: Database.Database, eventEmitter?: WorkflowEventEmitter) {
    this.db = db;
    this.eventEmitter = eventEmitter ?? new WorkflowEventEmitter();
  }

  // ===========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ===========================================================================

  abstract createWorkflow(
    source: WorkflowSource,
    config?: Partial<WorkflowConfig>
  ): Promise<Workflow>;

  /**
   * Generate a title from the workflow source.
   */
  protected generateTitle(source: WorkflowSource): string {
    switch (source.type) {
      case "spec":
        return `Workflow for spec ${source.specId}`;
      case "issues":
        return `Workflow for ${source.issueIds.length} issues`;
      case "root_issue":
        return `Workflow for issue ${source.issueId}`;
      case "goal":
        return source.goal.slice(0, 100);
      default:
        return "Workflow";
    }
  }

  abstract startWorkflow(workflowId: string): Promise<void>;
  abstract pauseWorkflow(workflowId: string): Promise<void>;
  abstract resumeWorkflow(workflowId: string, message?: string): Promise<void>;
  abstract cancelWorkflow(workflowId: string): Promise<void>;
  abstract retryStep(
    workflowId: string,
    stepId: string,
    options?: { freshStart?: boolean }
  ): Promise<void>;
  abstract skipStep(
    workflowId: string,
    stepId: string,
    reason?: string
  ): Promise<void>;

  // ===========================================================================
  // Query Methods (public)
  // ===========================================================================

  /**
   * Get a workflow by ID.
   */
  async getWorkflow(workflowId: string): Promise<Workflow | null> {
    const row = this.db
      .prepare("SELECT * FROM workflows WHERE id = ?")
      .get(workflowId) as WorkflowRow | undefined;

    if (!row) {
      return null;
    }

    return rowToWorkflow(row);
  }

  /**
   * Get a workflow by ID, throwing if not found.
   */
  protected async getWorkflowOrThrow(workflowId: string): Promise<Workflow> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }
    return workflow;
  }

  /**
   * Get steps that are ready to execute.
   * A step is ready if:
   * - Its status is "pending" or "ready"
   * - All its dependencies are "completed"
   */
  async getReadySteps(workflowId: string): Promise<WorkflowStep[]> {
    const workflow = await this.getWorkflowOrThrow(workflowId);

    // Build a map of step ID to status for quick lookup
    const stepStatusMap = new Map<string, WorkflowStepStatus>();
    for (const step of workflow.steps) {
      stepStatusMap.set(step.id, step.status);
    }

    // Find steps that are ready
    const readySteps: WorkflowStep[] = [];
    for (const step of workflow.steps) {
      // Only consider pending or ready steps
      if (step.status !== "pending" && step.status !== "ready") {
        continue;
      }

      // Check if all dependencies are completed
      const allDepsCompleted = step.dependencies.every((depId) => {
        const depStatus = stepStatusMap.get(depId);
        return depStatus === "completed";
      });

      if (allDepsCompleted) {
        readySteps.push(step);
      }
    }

    return readySteps;
  }

  /**
   * List all workflows with optional filtering.
   */
  async listWorkflows(options?: {
    status?: WorkflowStatus;
    limit?: number;
    offset?: number;
  }): Promise<Workflow[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let query = "SELECT * FROM workflows";
    const params: (string | number)[] = [];

    if (options?.status) {
      query += " WHERE status = ?";
      params.push(options.status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params) as WorkflowRow[];
    return rows.map(rowToWorkflow);
  }

  // ===========================================================================
  // Event Methods (public)
  // ===========================================================================

  /**
   * Subscribe to workflow events.
   */
  onWorkflowEvent(listener: WorkflowEventListener): () => void {
    return this.eventEmitter.on(listener);
  }

  /**
   * Emit an escalation requested event.
   */
  emitEscalationRequested(
    workflowId: string,
    escalationId: string,
    message: string,
    options?: string[],
    context?: Record<string, unknown>
  ): void {
    this.eventEmitter.emit(
      createEscalationRequestedEvent(
        workflowId,
        escalationId,
        message,
        options,
        context
      )
    );
  }

  /**
   * Emit an escalation resolved event.
   */
  emitEscalationResolved(
    workflowId: string,
    escalationId: string,
    action: "approve" | "reject" | "custom",
    message?: string
  ): void {
    this.eventEmitter.emit(
      createEscalationResolvedEvent(workflowId, escalationId, action, message)
    );
  }

  /**
   * Emit a step started event.
   */
  emitStepStarted(workflowId: string, step: WorkflowStep): void {
    this.eventEmitter.emit(createStepStartedEvent(workflowId, step));
  }

  /**
   * Emit a step completed event.
   */
  emitStepCompleted(
    workflowId: string,
    step: WorkflowStep,
    executionId: string
  ): void {
    this.eventEmitter.emit(
      createStepCompletedEvent(workflowId, step, executionId)
    );
  }

  /**
   * Emit a step failed event.
   */
  emitStepFailed(workflowId: string, step: WorkflowStep, error: string): void {
    this.eventEmitter.emit(createStepFailedEvent(workflowId, step, error));
  }

  /**
   * Emit a workflow completed event.
   */
  emitWorkflowCompleted(workflowId: string, workflow: Workflow): void {
    this.eventEmitter.emit(createWorkflowCompletedEvent(workflowId, workflow));
  }

  /**
   * Emit a workflow failed event.
   */
  emitWorkflowFailed(workflowId: string, error: string): void {
    this.eventEmitter.emit(createWorkflowFailedEvent(workflowId, error));
  }

  // ===========================================================================
  // Database Operations (protected)
  // ===========================================================================

  /**
   * Save a new workflow to the database.
   */
  protected saveWorkflow(workflow: Workflow): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
      INSERT INTO workflows (
        id, title, source, status, steps,
        worktree_path, branch_name, base_branch,
        current_step_index, orchestrator_execution_id, orchestrator_session_id,
        config, created_at, updated_at, started_at, completed_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `
      )
      .run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.worktreePath ?? null,
        workflow.branchName ?? null,
        workflow.baseBranch,
        workflow.currentStepIndex,
        workflow.orchestratorExecutionId ?? null,
        workflow.orchestratorSessionId ?? null,
        JSON.stringify(workflow.config),
        workflow.createdAt ?? now,
        workflow.updatedAt ?? now,
        workflow.startedAt ?? null,
        workflow.completedAt ?? null
      );
  }

  /**
   * Update a workflow in the database.
   * Uses dynamic field builder for partial updates.
   */
  protected updateWorkflow(
    workflowId: string,
    updates: Partial<{
      title: string;
      status: WorkflowStatus;
      steps: WorkflowStep[];
      worktreePath: string | null;
      branchName: string | null;
      currentStepIndex: number;
      orchestratorExecutionId: string | null;
      orchestratorSessionId: string | null;
      config: WorkflowConfig;
      startedAt: string | null;
      completedAt: string | null;
    }>
  ): Workflow {
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.title !== undefined) {
      setClauses.push("title = ?");
      values.push(updates.title);
    }

    if (updates.status !== undefined) {
      setClauses.push("status = ?");
      values.push(updates.status);
    }

    if (updates.steps !== undefined) {
      setClauses.push("steps = ?");
      values.push(JSON.stringify(updates.steps));
    }

    if (updates.worktreePath !== undefined) {
      setClauses.push("worktree_path = ?");
      values.push(updates.worktreePath);
    }

    if (updates.branchName !== undefined) {
      setClauses.push("branch_name = ?");
      values.push(updates.branchName);
    }

    if (updates.currentStepIndex !== undefined) {
      setClauses.push("current_step_index = ?");
      values.push(updates.currentStepIndex);
    }

    if (updates.orchestratorExecutionId !== undefined) {
      setClauses.push("orchestrator_execution_id = ?");
      values.push(updates.orchestratorExecutionId);
    }

    if (updates.orchestratorSessionId !== undefined) {
      setClauses.push("orchestrator_session_id = ?");
      values.push(updates.orchestratorSessionId);
    }

    if (updates.config !== undefined) {
      setClauses.push("config = ?");
      values.push(JSON.stringify(updates.config));
    }

    if (updates.startedAt !== undefined) {
      setClauses.push("started_at = ?");
      values.push(updates.startedAt);
    }

    if (updates.completedAt !== undefined) {
      setClauses.push("completed_at = ?");
      values.push(updates.completedAt);
    }

    // Always update updated_at
    setClauses.push("updated_at = ?");
    values.push(new Date().toISOString());

    // Add workflowId for WHERE clause
    values.push(workflowId);

    this.db
      .prepare(`UPDATE workflows SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values);

    // Return the updated workflow
    const workflow = this.db
      .prepare("SELECT * FROM workflows WHERE id = ?")
      .get(workflowId) as WorkflowRow;

    return rowToWorkflow(workflow);
  }

  /**
   * Update a specific step within a workflow.
   */
  protected updateStep(
    workflowId: string,
    stepId: string,
    updates: Partial<WorkflowStep>
  ): void {
    const workflow = this.db
      .prepare("SELECT steps FROM workflows WHERE id = ?")
      .get(workflowId) as { steps: string } | undefined;

    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const steps = JSON.parse(workflow.steps) as WorkflowStep[];
    const stepIndex = steps.findIndex((s) => s.id === stepId);

    if (stepIndex === -1) {
      throw new WorkflowStepNotFoundError(workflowId, stepId);
    }

    // Merge updates into the step
    steps[stepIndex] = { ...steps[stepIndex], ...updates };

    // Update the steps array
    this.db
      .prepare("UPDATE workflows SET steps = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(steps), new Date().toISOString(), workflowId);
  }

  /**
   * Delete a workflow from the database.
   */
  protected deleteWorkflow(workflowId: string): void {
    this.db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);
  }

  // ===========================================================================
  // Source Resolution (protected)
  // ===========================================================================

  /**
   * Resolve a WorkflowSource to a list of issue IDs.
   *
   * @param source - The workflow source definition
   * @returns Array of issue IDs
   */
  protected async resolveSource(source: WorkflowSource): Promise<string[]> {
    switch (source.type) {
      case "spec":
        return this.resolveSpecSource(source.specId);

      case "issues":
        return source.issueIds;

      case "root_issue":
        return this.resolveRootIssueSource(source.issueId);

      case "goal":
        // Goal-based workflows start with no issues
        // The orchestrator creates them dynamically
        return [];

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = source;
        throw new Error(`Unknown source type: ${(_exhaustive as any).type}`);
    }
  }

  /**
   * Resolve a spec source to issue IDs.
   * Finds all issues that implement the spec.
   */
  private resolveSpecSource(specId: string): string[] {
    // Find issues that have "implements" relationship to this spec
    const relationships = getIncomingRelationships(
      this.db,
      specId,
      "spec",
      "implements"
    );

    // Filter to only issue sources
    return relationships
      .filter((rel) => rel.from_type === "issue")
      .map((rel) => rel.from_id);
  }

  /**
   * Resolve a root issue source to issue IDs.
   * Returns the root issue plus all issues that block it (recursively).
   */
  private resolveRootIssueSource(rootIssueId: string): string[] {
    const issueIds = new Set<string>();
    const queue = [rootIssueId];

    while (queue.length > 0) {
      const issueId = queue.shift()!;

      if (issueIds.has(issueId)) {
        continue;
      }

      issueIds.add(issueId);

      // Find issues that block this issue
      // "blocks" relationship: from_id blocks to_id
      const blocksRels = getIncomingRelationships(
        this.db,
        issueId,
        "issue",
        "blocks"
      );

      for (const rel of blocksRels) {
        if (rel.from_type === "issue" && !issueIds.has(rel.from_id)) {
          queue.push(rel.from_id);
        }
      }

      // Find issues this issue depends on
      // "depends-on" relationship: from_id depends on to_id
      // We need outgoing depends-on relationships
      const dependsOnRels = this.db
        .prepare(
          `
          SELECT * FROM relationships
          WHERE from_id = ? AND from_type = 'issue' AND relationship_type = 'depends-on'
        `
        )
        .all(issueId) as Array<{
        from_id: string;
        to_id: string;
        to_type: string;
      }>;

      for (const rel of dependsOnRels) {
        if (rel.to_type === "issue" && !issueIds.has(rel.to_id)) {
          queue.push(rel.to_id);
        }
      }
    }

    return Array.from(issueIds);
  }

  // ===========================================================================
  // Step Creation (protected)
  // ===========================================================================

  /**
   * Create workflow steps from a dependency graph.
   *
   * @param graph - The analyzed dependency graph
   * @returns Array of WorkflowStep objects
   */
  protected createStepsFromGraph(graph: DependencyGraph): WorkflowStep[] {
    // Create a map from issue ID to step ID
    const issueToStepId = new Map<string, string>();
    for (const issueId of graph.issueIds) {
      issueToStepId.set(issueId, generateStepId());
    }

    // Build steps based on topological order
    const steps: WorkflowStep[] = [];

    for (let i = 0; i < graph.topologicalOrder.length; i++) {
      const issueId = graph.topologicalOrder[i];
      const stepId = issueToStepId.get(issueId)!;

      // Find dependencies for this step
      // Dependencies are issues that block this one (edges ending at this issue)
      const dependencies: string[] = [];
      for (const [fromId, toId] of graph.edges) {
        if (toId === issueId) {
          const depStepId = issueToStepId.get(fromId);
          if (depStepId) {
            dependencies.push(depStepId);
          }
        }
      }

      // Check if the issue is already closed - if so, mark step as completed
      const issue = getIssue(this.db, issueId);
      const isAlreadyClosed = issue?.status === "closed";

      const step: WorkflowStep = {
        id: stepId,
        issueId,
        index: i,
        dependencies,
        status: isAlreadyClosed
          ? "completed"
          : dependencies.length === 0
            ? "ready"
            : "pending",
      };

      steps.push(step);
    }

    return steps;
  }

  // ===========================================================================
  // Workflow Creation Helpers (protected)
  // ===========================================================================

  /**
   * Create a workflow object (without saving to database).
   * Used by subclasses to build the workflow before saving.
   */
  protected buildWorkflow(options: {
    source: WorkflowSource;
    steps: WorkflowStep[];
    config: Partial<WorkflowConfig>;
    repoPath?: string;
  }): Workflow {
    const now = new Date().toISOString();

    // Get title from config, or generate from source
    const title = options.config.title || this.generateTitle(options.source);

    // Get baseBranch from config, or default to current branch
    let baseBranch = options.config.baseBranch;
    if (!baseBranch && options.repoPath) {
      try {
        baseBranch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: options.repoPath,
          encoding: "utf-8",
        }).trim();
      } catch {
        // Fall back to "main" if we can't determine current branch
      }
    }
    baseBranch = baseBranch || "main";

    return {
      id: generateWorkflowId(),
      title,
      source: options.source,
      status: "pending",
      steps: options.steps,
      baseBranch,
      currentStepIndex: 0,
      config: mergeConfig(options.config),
      createdAt: now,
      updatedAt: now,
    };
  }

  // ===========================================================================
  // Dependency Analysis (protected)
  // ===========================================================================

  /**
   * Analyze dependencies for a set of issues.
   * Convenience wrapper around analyzeDependencies().
   */
  protected analyzeDependencies(issueIds: string[]): DependencyGraph {
    return analyzeDependencies(this.db, issueIds);
  }

  // ===========================================================================
  // Worktree Management (protected)
  // ===========================================================================

  /**
   * Create a workflow-level worktree.
   *
   * Creates a worktree that will be shared across all executions in the workflow.
   * This ensures the orchestrator and all step executions run in the same isolated
   * environment and can see each other's changes.
   *
   * @param workflow - The workflow to create the worktree for
   * @param repoPath - Path to the git repository
   * @param lifecycleService - Execution lifecycle service for worktree creation
   * @returns Object with worktreePath and branchName
   */
  protected async createWorkflowWorktreeHelper(
    workflow: Workflow,
    repoPath: string,
    lifecycleService: ExecutionLifecycleService
  ): Promise<{ worktreePath: string; branchName: string }> {
    // Check if reuseWorktreePath is specified in config
    const reuseWorktreePath = workflow.config.reuseWorktreePath;

    // Create the workflow worktree
    const result = await lifecycleService.createWorkflowWorktree({
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      baseBranch: workflow.baseBranch,
      repoPath,
      reuseWorktreePath,
    });

    // Update workflow with worktree info
    this.updateWorkflow(workflow.id, {
      worktreePath: result.worktreePath,
      branchName: result.branchName,
    });

    console.log(
      `[BaseWorkflowEngine] Created workflow worktree for ${workflow.id}: ${result.worktreePath} (branch: ${result.branchName})`
    );

    return result;
  }
}
