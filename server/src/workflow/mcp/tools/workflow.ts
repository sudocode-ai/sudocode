/**
 * Workflow Control MCP Tools
 *
 * Implements workflow_status and workflow_complete tools
 * for the orchestrator agent to manage workflow state.
 *
 * All operations go through the HTTP API client.
 */

import type { ExecutionStatus } from "@sudocode-ai/types";

import type {
  WorkflowMCPContext,
  WorkflowCompleteParams,
  ToolResult,
  WorkflowStatusResult,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Step info returned in workflow_status response
 */
export interface StepInfo {
  id: string;
  issueId: string;
  issueTitle: string;
  status: string;
  executionId?: string;
  dependsOn: string[];
}

/**
 * Active execution info returned in workflow_status response
 */
export interface ActiveExecutionInfo {
  id: string;
  stepId: string;
  status: ExecutionStatus;
  startedAt: string;
}

/**
 * workflow_status response structure
 */
export type WorkflowStatusResponse = WorkflowStatusResult;

/**
 * workflow_complete response structure
 */
export interface WorkflowCompleteResponse extends ToolResult {
  workflow_status: string;
  completed_at: string;
}

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Handle workflow_status tool call.
 *
 * Returns current workflow state including:
 * - Workflow metadata
 * - Step statuses with issue titles
 * - Active executions
 * - Ready steps (dependencies met, not started)
 */
export async function handleWorkflowStatus(
  context: WorkflowMCPContext
): Promise<WorkflowStatusResponse> {
  return context.apiClient.getWorkflowStatus();
}

/**
 * Handle workflow_complete tool call.
 *
 * Marks the workflow as completed or failed with a summary.
 * Validates that workflow is in a completable state.
 */
export async function handleWorkflowComplete(
  context: WorkflowMCPContext,
  params: WorkflowCompleteParams
): Promise<WorkflowCompleteResponse> {
  const { summary, status = "completed" } = params;

  const result = await context.apiClient.completeWorkflow({ summary, status });

  console.error(
    `[workflow_complete] Workflow ${context.workflowId} marked as ${result.workflow_status}: ${summary}`
  );

  return {
    success: true,
    workflow_status: result.workflow_status,
    completed_at: result.completed_at,
  };
}
