/**
 * Execution MCP Tools
 *
 * Implements execute_issue, execution_status, and execution_cancel tools
 * for the orchestrator agent to manage step executions.
 */

import type Database from "better-sqlite3";
import type {
  Execution,
  ExecutionStatus,
  WorkflowStep,
  WorkflowRow,
} from "@sudocode-ai/types";
import type { AgentType } from "@sudocode-ai/types/agents";

import type {
  WorkflowMCPContext,
  ExecuteIssueParams,
  ExecutionStatusParams,
  ExecutionCancelParams,
  ToolResult,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * execute_issue response structure
 */
export interface ExecuteIssueResponse extends ToolResult {
  execution_id: string;
  worktree_path: string;
  branch_name: string;
  status: "pending" | "running";
}

/**
 * execution_status response structure
 */
export interface ExecutionStatusResponse {
  id: string;
  status: ExecutionStatus;
  exit_code?: number;
  error?: string;
  summary?: string;
  files_changed?: string[];
  started_at?: string;
  completed_at?: string;
}

/**
 * execution_cancel response structure
 */
export interface ExecutionCancelResponse extends ToolResult {
  message: string;
  final_status: ExecutionStatus;
}

// =============================================================================
// Queries
// =============================================================================

interface IssueRow {
  id: string;
  title: string;
  content: string;
}

/**
 * Get workflow by ID
 */
function getWorkflow(db: Database.Database, workflowId: string): WorkflowRow | null {
  const stmt = db.prepare(`SELECT * FROM workflows WHERE id = ?`);
  return stmt.get(workflowId) as WorkflowRow | null;
}

/**
 * Get issue by ID
 */
function getIssue(db: Database.Database, issueId: string): IssueRow | null {
  const stmt = db.prepare(`SELECT id, title, content FROM issues WHERE id = ?`);
  return stmt.get(issueId) as IssueRow | null;
}

/**
 * Get execution by ID
 */
function getExecution(db: Database.Database, executionId: string): Execution | null {
  const stmt = db.prepare(`SELECT * FROM executions WHERE id = ?`);
  return stmt.get(executionId) as Execution | null;
}

/**
 * Update workflow steps
 */
function updateWorkflowSteps(
  db: Database.Database,
  workflowId: string,
  steps: WorkflowStep[]
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE workflows SET steps = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(JSON.stringify(steps), now, workflowId);
}

/**
 * Update workflow worktree path (for create_root mode)
 */
function updateWorkflowWorktreePath(
  db: Database.Database,
  workflowId: string,
  worktreePath: string,
  branchName: string
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE workflows SET worktree_path = ?, branch_name = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(worktreePath, branchName, now, workflowId);
}

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Handle execute_issue tool call.
 *
 * Starts an execution for an issue within the workflow.
 * Supports multiple worktree modes for different isolation strategies.
 */
export async function handleExecuteIssue(
  context: WorkflowMCPContext,
  params: ExecuteIssueParams
): Promise<ExecuteIssueResponse> {
  const { db, workflowId, executionService } = context;
  const { issue_id, agent_type, model, worktree_mode, worktree_id } = params;

  // Get workflow
  const workflowRow = getWorkflow(db, workflowId);
  if (!workflowRow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  // Validate workflow is running
  if (workflowRow.status !== "running") {
    throw new Error(
      `Cannot execute issue: workflow is ${workflowRow.status}, expected running`
    );
  }

  // Parse workflow data
  const steps = JSON.parse(workflowRow.steps) as WorkflowStep[];
  const config = JSON.parse(workflowRow.config);

  // Find step for this issue
  const step = steps.find((s) => s.issueId === issue_id);
  if (!step) {
    throw new Error(
      `Issue ${issue_id} is not part of workflow ${workflowId}`
    );
  }

  // Validate step status
  if (step.status !== "pending" && step.status !== "ready") {
    throw new Error(
      `Cannot execute step: status is ${step.status}, expected pending or ready`
    );
  }

  // Get issue
  const issue = getIssue(db, issue_id);
  if (!issue) {
    throw new Error(`Issue not found: ${issue_id}`);
  }

  // Determine worktree configuration
  let reuseWorktreeId: string | undefined;

  switch (worktree_mode) {
    case "create_root":
      // Create new worktree for workflow (first execution)
      // No reuseWorktreeId needed
      break;

    case "use_root":
      // Reuse workflow's root worktree
      if (!worktree_id) {
        throw new Error("worktree_id is required for use_root mode");
      }
      reuseWorktreeId = worktree_id;
      break;

    case "create_branch":
      // Create new branch/worktree (parallel execution)
      // No reuseWorktreeId, but unique branch will be created
      break;

    case "use_branch":
      // Continue on existing execution's worktree
      if (!worktree_id) {
        throw new Error("worktree_id is required for use_branch mode");
      }
      reuseWorktreeId = worktree_id;
      break;

    default:
      throw new Error(`Unknown worktree_mode: ${worktree_mode}`);
  }

  // Build execution config
  const agentTypeToUse: AgentType = (agent_type as AgentType) || config.agentType || "claude-code";
  const executionConfig = {
    mode: "worktree" as const,
    model: model || config.model,
    baseBranch: workflowRow.base_branch,
    reuseWorktreeId,
  };

  // Create prompt from issue content
  const prompt = issue.content || `Implement issue: ${issue.title}`;

  // Create execution with workflow context
  const execution = await executionService.createExecution(
    issue_id,
    executionConfig,
    prompt,
    agentTypeToUse,
    { workflowId, stepId: step.id }
  );

  // Update step status and execution ID
  step.status = "running";
  step.executionId = execution.id;
  updateWorkflowSteps(db, workflowId, steps);

  // Store worktree path on workflow for create_root mode
  if (worktree_mode === "create_root" && execution.worktree_path) {
    updateWorkflowWorktreePath(
      db,
      workflowId,
      execution.worktree_path,
      execution.branch_name
    );
  }

  // Start execution timeout if configured
  const timeoutMs = config.executionTimeoutMs;
  if (timeoutMs && context.wakeupService) {
    context.wakeupService.startExecutionTimeout(
      execution.id,
      workflowId,
      step.id,
      timeoutMs
    );
  }

  console.error(
    `[execute_issue] Started execution ${execution.id} for issue ${issue_id} in workflow ${workflowId}`
  );

  return {
    success: true,
    execution_id: execution.id,
    worktree_path: execution.worktree_path || "",
    branch_name: execution.branch_name,
    status: execution.status as "pending" | "running",
  };
}

/**
 * Handle execution_status tool call.
 *
 * Returns current status and details of an execution.
 */
export async function handleExecutionStatus(
  context: WorkflowMCPContext,
  params: ExecutionStatusParams
): Promise<ExecutionStatusResponse> {
  const { db } = context;
  const { execution_id } = params;

  // Get execution
  const execution = getExecution(db, execution_id);
  if (!execution) {
    throw new Error(`Execution not found: ${execution_id}`);
  }

  // Parse files changed if present
  let filesChanged: string[] | undefined;
  if (execution.files_changed) {
    try {
      filesChanged = JSON.parse(execution.files_changed);
    } catch {
      filesChanged = [execution.files_changed];
    }
  }

  return {
    id: execution.id,
    status: execution.status,
    exit_code: execution.exit_code ?? undefined,
    error: execution.error_message ?? undefined,
    summary: execution.summary ?? undefined,
    files_changed: filesChanged,
    started_at: execution.started_at ?? undefined,
    completed_at: execution.completed_at ?? undefined,
  };
}

/**
 * Handle execution_cancel tool call.
 *
 * Cancels a running execution.
 */
export async function handleExecutionCancel(
  context: WorkflowMCPContext,
  params: ExecutionCancelParams
): Promise<ExecutionCancelResponse> {
  const { db, executionService } = context;
  const { execution_id, reason } = params;

  // Get execution
  const execution = getExecution(db, execution_id);
  if (!execution) {
    throw new Error(`Execution not found: ${execution_id}`);
  }

  // Validate status
  if (execution.status !== "running" && execution.status !== "pending") {
    throw new Error(
      `Cannot cancel execution: status is ${execution.status}, expected running or pending`
    );
  }

  // Cancel via service
  await executionService.cancelExecution(execution_id);

  // Log cancellation
  if (reason) {
    console.error(
      `[execution_cancel] Cancelled execution ${execution_id}: ${reason}`
    );
  } else {
    console.error(`[execution_cancel] Cancelled execution ${execution_id}`);
  }

  // Get updated status
  const updatedExecution = getExecution(db, execution_id);
  const finalStatus = updatedExecution?.status || "cancelled";

  return {
    success: true,
    message: reason || "Execution cancelled",
    final_status: finalStatus,
  };
}
