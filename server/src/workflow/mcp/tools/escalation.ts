/**
 * Escalation MCP Tools
 *
 * Implements escalate_to_user and notify_user tools for
 * human-in-the-loop workflow orchestration.
 *
 * Escalations are stored as workflow events, not as workflow fields.
 * This allows full history of escalations and simpler schema.
 */

import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  WorkflowRow,
  WorkflowConfig,
  EscalationData,
} from "@sudocode-ai/types";

import type {
  WorkflowMCPContext,
  EscalateToUserParams,
  EscalateToUserResult,
  NotifyUserParams,
  NotifyUserResult,
} from "../types.js";

// =============================================================================
// Queries
// =============================================================================

/**
 * Get workflow by ID
 */
function getWorkflow(
  db: Database.Database,
  workflowId: string
): WorkflowRow | null {
  const stmt = db.prepare(`SELECT * FROM workflows WHERE id = ?`);
  return stmt.get(workflowId) as WorkflowRow | null;
}

/**
 * Get pending escalation for a workflow by querying events.
 * Returns the most recent escalation_requested event that has no matching escalation_resolved event.
 */
function getPendingEscalation(
  db: Database.Database,
  workflowId: string
): EscalationData | null {
  // Find escalation_requested events that don't have a matching escalation_resolved
  const stmt = db.prepare(`
    SELECT payload FROM workflow_events
    WHERE workflow_id = ?
      AND type = 'escalation_requested'
      AND json_extract(payload, '$.escalation_id') NOT IN (
        SELECT json_extract(payload, '$.escalation_id')
        FROM workflow_events
        WHERE workflow_id = ?
          AND type = 'escalation_resolved'
      )
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const row = stmt.get(workflowId, workflowId) as { payload: string } | undefined;
  if (!row) {
    return null;
  }

  const payload = JSON.parse(row.payload) as {
    escalation_id: string;
    message: string;
    options?: string[];
    context?: Record<string, unknown>;
  };

  return {
    requestId: payload.escalation_id,
    message: payload.message,
    options: payload.options,
    context: payload.context,
  };
}

/**
 * Record a workflow event
 */
function recordWorkflowEvent(
  db: Database.Database,
  workflowId: string,
  type: string,
  payload: Record<string, unknown>
): string {
  const eventId = randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(eventId, workflowId, type, JSON.stringify(payload), now);

  return eventId;
}

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
  const { db, workflowId } = context;
  const { message, options, context: escalationContext } = params;

  // Get workflow
  const workflowRow = getWorkflow(db, workflowId);
  if (!workflowRow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  // Parse config to check autonomy level
  const config = JSON.parse(workflowRow.config) as WorkflowConfig;

  // If full_auto mode, bypass escalation
  if (config.autonomyLevel === "full_auto") {
    console.error(
      `[escalate_to_user] Workflow ${workflowId} is in full_auto mode, auto-approving`
    );

    return {
      status: "auto_approved",
      message:
        "Escalation auto-approved (workflow is in full_auto mode). " +
        "Proceed with your decision.",
    };
  }

  // Check for existing pending escalation by querying events
  const pendingEscalation = getPendingEscalation(db, workflowId);
  if (pendingEscalation) {
    throw new Error(
      `Workflow already has a pending escalation (ID: ${pendingEscalation.requestId}). ` +
      `Wait for user response or resolve the existing escalation first.`
    );
  }

  // Generate unique escalation ID
  const escalationId = randomUUID();

  // Record escalation_requested event
  recordWorkflowEvent(db, workflowId, "escalation_requested", {
    escalation_id: escalationId,
    message,
    options,
    context: escalationContext,
  });

  console.error(
    `[escalate_to_user] Escalation created for workflow ${workflowId}: ${escalationId}`
  );

  // Notify main server for WebSocket broadcast (if serverUrl is configured)
  if (context.serverUrl) {
    try {
      const notifyUrl = `${context.serverUrl}/api/workflows/${workflowId}/escalation/notify`;
      await fetch(notifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escalation_id: escalationId,
          message,
          options,
          context: escalationContext,
        }),
      });
      console.error(`[escalate_to_user] Notified server at ${notifyUrl}`);
    } catch (notifyError) {
      // Don't fail the escalation if notification fails
      console.error(`[escalate_to_user] Failed to notify server:`, notifyError);
    }
  }

  return {
    status: "pending",
    escalation_id: escalationId,
    message:
      "Escalation request created. Your session will end here. " +
      "When the user responds, you will receive a follow-up message with their response. " +
      "The workflow will resume automatically.",
  };
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
  const { workflowId } = context;
  const { message, level = "info" } = params;

  // Log the notification (in production, this would broadcast via WebSocket)
  console.error(
    `[notify_user] [${level.toUpperCase()}] Workflow ${workflowId}: ${message}`
  );

  // Record notification event (for audit trail)
  // Use a different event type to distinguish from escalations
  recordWorkflowEvent(context.db, workflowId, "user_notification", {
    level,
    message,
  });

  // In the real implementation, we would:
  // 1. Broadcast via WebSocket to connected clients
  // 2. Check if any clients are connected to determine 'delivered'
  //
  // For now, we assume success and unknown delivery
  return {
    success: true,
    delivered: false, // We don't know if user received it
  };
}
