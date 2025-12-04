/**
 * Execution MCP Tools
 *
 * Implements execute_issue, execution_status, and execution_cancel tools
 * for the orchestrator agent to manage step executions.
 *
 * All operations go through the HTTP API client.
 */

import type { ExecutionStatus } from "@sudocode-ai/types";

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
  const result = await context.apiClient.executeIssue(params);

  console.error(
    `[execute_issue] Started execution ${result.execution_id} for issue ${params.issue_id} in workflow ${context.workflowId}`
  );

  return {
    success: true,
    execution_id: result.execution_id,
    worktree_path: result.worktree_path || "",
    branch_name: result.branch_name || "",
    status: result.status as "pending" | "running",
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
  const result = await context.apiClient.getExecutionStatus(params);

  return {
    id: result.id,
    status: result.status as ExecutionStatus,
    exit_code: result.exit_code,
    error: result.error,
    summary: result.summary,
    files_changed: result.files_changed?.map((f) => f.path),
    started_at: result.started_at,
    completed_at: result.completed_at,
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
  const { execution_id, reason } = params;

  const result = await context.apiClient.cancelExecution(params);

  if (reason) {
    console.error(
      `[execution_cancel] Cancelled execution ${execution_id}: ${reason}`
    );
  } else {
    console.error(`[execution_cancel] Cancelled execution ${execution_id}`);
  }

  return {
    success: result.success,
    message: result.message,
    final_status: result.final_status as ExecutionStatus,
  };
}
