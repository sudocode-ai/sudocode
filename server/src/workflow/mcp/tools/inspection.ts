/**
 * Inspection MCP Tools
 *
 * Implements execution_trajectory and execution_changes tools
 * for the orchestrator agent to inspect execution results.
 *
 * All operations go through the HTTP API client.
 */

import type {
  WorkflowMCPContext,
  ExecutionTrajectoryParams,
  ExecutionChangesParams,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Individual trajectory entry
 */
export interface TrajectoryEntry {
  type: "tool_call" | "tool_result" | "message" | "error";
  timestamp: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  content?: string;
}

/**
 * Trajectory summary statistics
 */
export interface TrajectorySummary {
  total_entries: number;
  tool_calls: number;
  errors: number;
  duration_ms?: number;
}

/**
 * execution_trajectory response structure
 */
export interface ExecutionTrajectoryResponse {
  execution_id: string;
  entries: TrajectoryEntry[];
  summary: TrajectorySummary;
}

/**
 * File change info for response
 */
export interface FileChangeInfo {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff?: string;
}

/**
 * Commit info for response
 */
export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
}

/**
 * execution_changes response structure
 */
export interface ExecutionChangesResponse {
  execution_id: string;
  files: FileChangeInfo[];
  commits: CommitInfo[];
  summary: {
    files_changed: number;
    total_additions: number;
    total_deletions: number;
  };
}

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Handle execution_trajectory tool call.
 *
 * Returns agent actions and tool calls from an execution.
 * Useful for understanding what the agent did and debugging issues.
 */
export async function handleExecutionTrajectory(
  context: WorkflowMCPContext,
  params: ExecutionTrajectoryParams
): Promise<ExecutionTrajectoryResponse> {
  const result = await context.apiClient.getExecutionTrajectory(params);

  return {
    execution_id: result.execution_id,
    entries: result.entries.map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      tool_name: e.tool_name,
      tool_args: e.tool_args,
      content: e.content,
    })),
    summary: result.summary,
  };
}

/**
 * Handle execution_changes tool call.
 *
 * Returns code changes made by an execution including files modified and commits.
 */
export async function handleExecutionChanges(
  context: WorkflowMCPContext,
  params: ExecutionChangesParams
): Promise<ExecutionChangesResponse> {
  const result = await context.apiClient.getExecutionChanges(params);

  return {
    execution_id: result.execution_id,
    files: result.files.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      diff: f.diff,
    })),
    commits: result.commits.map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author,
      timestamp: c.timestamp,
    })),
    summary: result.summary,
  };
}
