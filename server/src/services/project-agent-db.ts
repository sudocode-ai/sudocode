/**
 * Database operations for project agent
 */

import type Database from "better-sqlite3";
import type {
  ProjectAgentExecution,
  ProjectAgentAction,
  ProjectAgentEvent,
  ProjectAgentConfig,
  ProjectAgentActionType,
  ProjectAgentActionStatus,
  ProjectAgentActionPriority,
} from "@sudocode-ai/types";
import { randomUUID } from "crypto";

/**
 * Create a new project agent execution
 */
export function createProjectAgentExecution(
  db: Database.Database,
  params: {
    executionId: string;
    mode: "monitoring" | "planning" | "full";
    useWorktree: boolean;
    worktreePath?: string;
    config: ProjectAgentConfig;
  }
): ProjectAgentExecution {
  const id = `pa_${randomUUID()}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO project_agent_executions (
      id, execution_id, status, mode, use_worktree, worktree_path, config_json,
      started_at, last_activity_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.executionId,
    "running",
    params.mode,
    params.useWorktree ? 1 : 0,
    params.worktreePath || null,
    JSON.stringify(params.config),
    now,
    now
  );

  return getProjectAgentExecution(db, id)!;
}

/**
 * Get project agent execution by ID
 */
export function getProjectAgentExecution(
  db: Database.Database,
  id: string
): ProjectAgentExecution | null {
  const stmt = db.prepare(`
    SELECT * FROM project_agent_executions WHERE id = ?
  `);

  const row = stmt.get(id) as any;
  if (!row) return null;

  return {
    ...row,
    use_worktree: Boolean(row.use_worktree),
  };
}

/**
 * Get project agent execution by execution ID
 */
export function getProjectAgentExecutionByExecutionId(
  db: Database.Database,
  executionId: string
): ProjectAgentExecution | null {
  const stmt = db.prepare(`
    SELECT * FROM project_agent_executions WHERE execution_id = ?
  `);

  const row = stmt.get(executionId) as any;
  if (!row) return null;

  return {
    ...row,
    use_worktree: Boolean(row.use_worktree),
  };
}

/**
 * Get currently running project agent execution
 */
export function getRunningProjectAgentExecution(
  db: Database.Database
): ProjectAgentExecution | null {
  const stmt = db.prepare(`
    SELECT * FROM project_agent_executions
    WHERE status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `);

  const row = stmt.get() as any;
  if (!row) return null;

  return {
    ...row,
    use_worktree: Boolean(row.use_worktree),
  };
}

/**
 * Update project agent execution status
 */
export function updateProjectAgentExecutionStatus(
  db: Database.Database,
  id: string,
  status: "running" | "stopped" | "error"
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE project_agent_executions
    SET status = ?, stopped_at = ?, last_activity_at = ?
    WHERE id = ?
  `);

  stmt.run(status, status !== "running" ? now : null, now, id);
}

/**
 * Update project agent execution activity timestamp
 */
export function updateProjectAgentExecutionActivity(
  db: Database.Database,
  id: string
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE project_agent_executions
    SET last_activity_at = ?
    WHERE id = ?
  `);

  stmt.run(now, id);
}

/**
 * Increment project agent execution metrics
 */
export function incrementProjectAgentMetric(
  db: Database.Database,
  id: string,
  metric: "events_processed" | "actions_proposed" | "actions_approved" | "actions_rejected"
): void {
  const stmt = db.prepare(`
    UPDATE project_agent_executions
    SET ${metric} = ${metric} + 1, last_activity_at = ?
    WHERE id = ?
  `);

  stmt.run(new Date().toISOString(), id);
}

/**
 * Create a new project agent action
 */
export function createProjectAgentAction(
  db: Database.Database,
  params: {
    projectAgentExecutionId: string;
    actionType: ProjectAgentActionType;
    priority?: ProjectAgentActionPriority;
    targetId?: string;
    targetType?: "spec" | "issue" | "execution";
    payload: any;
    justification: string;
  }
): ProjectAgentAction {
  const id = `action_${randomUUID()}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO project_agent_actions (
      id, project_agent_execution_id, action_type, status, priority,
      target_id, target_type, payload_json, justification, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.projectAgentExecutionId,
    params.actionType,
    "proposed",
    params.priority || null,
    params.targetId || null,
    params.targetType || null,
    JSON.stringify(params.payload),
    params.justification,
    now
  );

  return getProjectAgentAction(db, id)!;
}

/**
 * Get project agent action by ID
 */
export function getProjectAgentAction(
  db: Database.Database,
  id: string
): ProjectAgentAction | null {
  const stmt = db.prepare(`
    SELECT * FROM project_agent_actions WHERE id = ?
  `);

  return stmt.get(id) as ProjectAgentAction | null;
}

/**
 * List project agent actions
 */
export function listProjectAgentActions(
  db: Database.Database,
  params?: {
    projectAgentExecutionId?: string;
    status?: ProjectAgentActionStatus;
    limit?: number;
  }
): ProjectAgentAction[] {
  let query = "SELECT * FROM project_agent_actions WHERE 1=1";
  const args: any[] = [];

  if (params?.projectAgentExecutionId) {
    query += " AND project_agent_execution_id = ?";
    args.push(params.projectAgentExecutionId);
  }

  if (params?.status) {
    query += " AND status = ?";
    args.push(params.status);
  }

  query += " ORDER BY created_at DESC";

  if (params?.limit) {
    query += " LIMIT ?";
    args.push(params.limit);
  }

  const stmt = db.prepare(query);
  return stmt.all(...args) as ProjectAgentAction[];
}

/**
 * Update project agent action status
 */
export function updateProjectAgentActionStatus(
  db: Database.Database,
  id: string,
  status: ProjectAgentActionStatus,
  error?: string
): void {
  const now = new Date().toISOString();
  let query = "UPDATE project_agent_actions SET status = ?";
  const args: any[] = [status];

  // Set timestamp based on status
  if (status === "approved") {
    query += ", approved_at = ?";
    args.push(now);
  } else if (status === "rejected") {
    query += ", rejected_at = ?";
    args.push(now);
  } else if (status === "executing") {
    query += ", executed_at = ?";
    args.push(now);
  } else if (status === "completed") {
    query += ", completed_at = ?";
    args.push(now);
  }

  if (error) {
    query += ", error_message = ?";
    args.push(error);
  }

  query += " WHERE id = ?";
  args.push(id);

  const stmt = db.prepare(query);
  stmt.run(...args);
}

/**
 * Update project agent action result
 */
export function updateProjectAgentActionResult(
  db: Database.Database,
  id: string,
  result: any
): void {
  const stmt = db.prepare(`
    UPDATE project_agent_actions
    SET result_json = ?
    WHERE id = ?
  `);

  stmt.run(JSON.stringify(result), id);
}

/**
 * Create a new project agent event
 */
export function createProjectAgentEvent(
  db: Database.Database,
  params: {
    projectAgentExecutionId: string;
    eventType: string;
    eventPayload: any;
    processingDurationMs?: number;
    actionId?: string;
  }
): ProjectAgentEvent {
  const id = `event_${randomUUID()}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO project_agent_events (
      id, project_agent_execution_id, event_type, event_payload_json,
      processed_at, processing_duration_ms, action_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.projectAgentExecutionId,
    params.eventType,
    JSON.stringify(params.eventPayload),
    now,
    params.processingDurationMs || null,
    params.actionId || null
  );

  return getProjectAgentEvent(db, id)!;
}

/**
 * Get project agent event by ID
 */
export function getProjectAgentEvent(
  db: Database.Database,
  id: string
): ProjectAgentEvent | null {
  const stmt = db.prepare(`
    SELECT * FROM project_agent_events WHERE id = ?
  `);

  return stmt.get(id) as ProjectAgentEvent | null;
}

/**
 * List project agent events
 */
export function listProjectAgentEvents(
  db: Database.Database,
  params?: {
    projectAgentExecutionId?: string;
    eventType?: string;
    limit?: number;
  }
): ProjectAgentEvent[] {
  let query = "SELECT * FROM project_agent_events WHERE 1=1";
  const args: any[] = [];

  if (params?.projectAgentExecutionId) {
    query += " AND project_agent_execution_id = ?";
    args.push(params.projectAgentExecutionId);
  }

  if (params?.eventType) {
    query += " AND event_type = ?";
    args.push(params.eventType);
  }

  query += " ORDER BY processed_at DESC";

  if (params?.limit) {
    query += " LIMIT ?";
    args.push(params.limit);
  }

  const stmt = db.prepare(query);
  return stmt.all(...args) as ProjectAgentEvent[];
}
