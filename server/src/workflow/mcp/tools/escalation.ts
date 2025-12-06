/**
 * Escalation MCP Tools
 *
 * Implements escalate_to_user and notify_user tools for
 * human-in-the-loop workflow orchestration.
 *
 * All operations go through the HTTP API client.
 */

import type {
  WorkflowMCPContext,
  EscalateToUserParams,
  EscalateToUserResult,
  NotifyUserParams,
  NotifyUserResult,
} from "../types.js";

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Handle escalate_to_user tool call.
 *
 * Creates an escalation request for user input. The orchestrator's session
 * ends naturally after this call - no blocking wait.
 *
 * If autonomyLevel is "full_auto", immediately returns auto_approved
 * without creating an actual escalation.
 *
 * @param context - Workflow MCP context
 * @param params - Escalation parameters (message, options, context)
 * @returns Escalation result with status and optional escalation_id
 */
export async function handleEscalateToUser(
  context: WorkflowMCPContext,
  params: EscalateToUserParams
): Promise<EscalateToUserResult> {
  const result = await context.apiClient.escalateToUser(params);

  console.error(
    `[escalate_to_user] Escalation result for workflow ${context.workflowId}: ${result.status}`
  );

  return result;
}

/**
 * Handle notify_user tool call.
 *
 * Sends a non-blocking notification to the user. Does not wait for
 * acknowledgment or response. Useful for progress updates and informational
 * messages.
 *
 * @param context - Workflow MCP context
 * @param params - Notification parameters (message, level)
 * @returns Notification result with success and delivered status
 */
export async function handleNotifyUser(
  context: WorkflowMCPContext,
  params: NotifyUserParams
): Promise<NotifyUserResult> {
  const { message, level = "info" } = params;

  const result = await context.apiClient.notifyUser(params);

  console.error(
    `[notify_user] [${level.toUpperCase()}] Workflow ${context.workflowId}: ${message}`
  );

  return result;
}
