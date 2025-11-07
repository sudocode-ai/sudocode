/**
 * MCP tools for project agent action management
 */

import { SudocodeClient } from "../client.js";

// Tool parameter types

export type ActionType =
  | "create_issues_from_spec"
  | "start_execution"
  | "pause_execution"
  | "resume_execution"
  | "add_feedback"
  | "modify_spec"
  | "create_relationship"
  | "update_issue_status";

export interface ProposeActionParams {
  action_type: ActionType;
  target_id?: string;
  payload: any;
  justification: string;
  priority?: "high" | "medium" | "low";
}

export interface ListActionsParams {
  status?: "proposed" | "approved" | "rejected" | "executing" | "completed" | "failed";
  limit?: number;
}

// Tool implementations

/**
 * Propose an action for user approval
 */
export async function proposeAction(
  client: SudocodeClient,
  params: ProposeActionParams
): Promise<string> {
  // TODO: Implement API call to create project agent action
  // For now, log and return mock action ID

  console.log(`[MCP] Proposing action: ${params.action_type}`);
  console.log(`[MCP] Justification: ${params.justification}`);
  console.log(`[MCP] Payload:`, params.payload);

  const actionId = `action_${Date.now()}`;

  return actionId;
}

/**
 * List proposed actions
 */
export async function listActions(
  client: SudocodeClient,
  params: ListActionsParams = {}
): Promise<any[]> {
  // TODO: Implement API call to list project agent actions
  // For now, return empty array

  return [];
}
