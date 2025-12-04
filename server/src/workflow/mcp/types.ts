/**
 * Workflow MCP Server Types
 *
 * Type definitions for MCP tool parameters, results, and context.
 */

import type { AgentType, Workflow, WorkflowStep } from "@sudocode-ai/types";

// =============================================================================
// Tool Parameter Types
// =============================================================================

/**
 * Worktree isolation strategy for executions.
 */
export type WorktreeMode =
  | "create_root" // Create new root worktree for workflow
  | "use_root" // Use existing root worktree (sequential)
  | "create_branch" // Create branch off base (parallel)
  | "use_branch"; // Use existing branch

/**
 * Parameters for execute_issue tool.
 */
export interface ExecuteIssueParams {
  /** Issue ID to execute */
  issue_id: string;
  /** Agent type to use (defaults to workflow config) */
  agent_type?: AgentType;
  /** Model override */
  model?: string;
  /** Worktree isolation strategy */
  worktree_mode: WorktreeMode;
  /** Execution ID to reuse worktree from (for use_root/use_branch) */
  worktree_id?: string;
}

/**
 * Parameters for execution_status tool.
 */
export interface ExecutionStatusParams {
  /** Execution ID to check */
  execution_id: string;
}

/**
 * Parameters for execution_cancel tool.
 */
export interface ExecutionCancelParams {
  /** Execution ID to cancel */
  execution_id: string;
  /** Optional reason for cancellation */
  reason?: string;
}

/**
 * Parameters for execution_trajectory tool.
 */
export interface ExecutionTrajectoryParams {
  /** Execution ID to get trajectory for */
  execution_id: string;
  /** Maximum entries to return (default: 50) */
  max_entries?: number;
}

/**
 * Parameters for execution_changes tool.
 */
export interface ExecutionChangesParams {
  /** Execution ID to get changes for */
  execution_id: string;
  /** Include full diff content (default: false) */
  include_diff?: boolean;
}

/**
 * Parameters for workflow_complete tool.
 */
export interface WorkflowCompleteParams {
  /** Summary of work completed */
  summary: string;
  /** Final status (default: completed) */
  status?: "completed" | "failed";
}

/**
 * Notification level for notify_user tool.
 */
export type NotificationLevel = "info" | "warning" | "error";

/**
 * Parameters for escalate_to_user tool.
 */
export interface EscalateToUserParams {
  /** Message displayed to user explaining what input is needed */
  message: string;
  /** Optional predefined options for user to choose from */
  options?: string[];
  /** Additional context for the escalation (passed back in response) */
  context?: Record<string, unknown>;
}

/**
 * Parameters for notify_user tool.
 */
export interface NotifyUserParams {
  /** Notification message */
  message: string;
  /** Notification level (default: info) */
  level?: NotificationLevel;
}

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * Result from workflow_status tool.
 */
export interface WorkflowStatusResult {
  workflow: {
    id: string;
    title: string;
    status: Workflow["status"];
    source: Workflow["source"];
    config: Workflow["config"];
    worktreePath?: string;
  };
  steps: Array<{
    id: string;
    issueId: string;
    issueTitle: string;
    status: WorkflowStep["status"];
    executionId?: string;
    dependsOn: string[];
  }>;
  activeExecutions: Array<{
    id: string;
    stepId: string;
    status: string;
    startedAt: string;
  }>;
  readySteps: string[];
}

/**
 * Result from execute_issue tool.
 */
export interface ExecuteIssueResult {
  execution_id: string;
  worktree_path?: string;
  branch_name?: string;
  status: string;
}

/**
 * Result from execution_status tool.
 */
export interface ExecutionStatusResult {
  id: string;
  status: string;
  exit_code?: number;
  error?: string;
  summary?: string;
  files_changed?: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  started_at?: string;
  completed_at?: string;
}

/**
 * Result from execution_cancel tool.
 */
export interface ExecutionCancelResult {
  success: boolean;
  message: string;
  final_status: string;
}

/**
 * Result from execution_trajectory tool.
 */
export interface ExecutionTrajectoryResult {
  execution_id: string;
  entries: Array<{
    type: "tool_call" | "tool_result" | "message" | "error";
    timestamp: string;
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    content?: string;
  }>;
  summary: {
    total_entries: number;
    tool_calls: number;
    errors: number;
    duration_ms?: number;
  };
}

/**
 * Result from execution_changes tool.
 */
export interface ExecutionChangesResult {
  execution_id: string;
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed";
    additions: number;
    deletions: number;
    diff?: string;
  }>;
  commits: Array<{
    hash: string;
    message: string;
    author: string;
    timestamp: string;
  }>;
  summary: {
    files_changed: number;
    total_additions: number;
    total_deletions: number;
  };
}

/**
 * Result from workflow_complete tool.
 */
export interface WorkflowCompleteResult {
  success: boolean;
  workflow_status: Workflow["status"];
  completed_at: string;
}

/**
 * Status of escalation request.
 */
export type EscalationResultStatus = "pending" | "auto_approved";

/**
 * Result from escalate_to_user tool.
 */
export interface EscalateToUserResult {
  /** Status of the escalation */
  status: EscalationResultStatus;
  /** Escalation ID (for pending status) */
  escalation_id?: string;
  /** Message for orchestrator */
  message: string;
}

/**
 * Result from notify_user tool.
 */
export interface NotifyUserResult {
  /** Whether notification was successfully queued */
  success: boolean;
  /** Whether notification was delivered (may be false if user not connected) */
  delivered: boolean;
}

// =============================================================================
// Context and Handler Types
// =============================================================================

/**
 * API client interface for tool handlers.
 * Matches the WorkflowAPIClient class interface.
 */
export interface WorkflowAPIClientInterface {
  getWorkflowStatus(): Promise<WorkflowStatusResult>;
  completeWorkflow(params: WorkflowCompleteParams): Promise<WorkflowCompleteResult>;
  executeIssue(params: ExecuteIssueParams): Promise<ExecuteIssueResult>;
  getExecutionStatus(params: ExecutionStatusParams): Promise<ExecutionStatusResult>;
  cancelExecution(params: ExecutionCancelParams): Promise<ExecutionCancelResult>;
  getExecutionTrajectory(params: ExecutionTrajectoryParams): Promise<ExecutionTrajectoryResult>;
  getExecutionChanges(params: ExecutionChangesParams): Promise<ExecutionChangesResult>;
  escalateToUser(params: EscalateToUserParams): Promise<EscalateToUserResult>;
  notifyUser(params: NotifyUserParams): Promise<NotifyUserResult>;
}

/**
 * Context passed to tool handlers.
 *
 * All communication with the main server goes through the API client.
 * The MCP server does not have direct database access.
 */
export interface WorkflowMCPContext {
  /** The workflow ID this server is managing */
  workflowId: string;
  /** API client for communicating with main server */
  apiClient: WorkflowAPIClientInterface;
  /** Path to the repository root */
  repoPath: string;
}

/**
 * Generic tool result wrapper.
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Tool definition for registration.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool handler function signature.
 */
export type ToolHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
  context: WorkflowMCPContext
) => Promise<ToolResult<TResult>>;
