/**
 * Executions service - database operations for agent executions
 */

import type Database from "better-sqlite3";
import type { Execution, AgentType, ExecutionStatus } from "@sudocode-ai/types";
import { randomUUID } from "crypto";

/**
 * Input for creating a new execution
 */
export interface CreateExecutionInput {
  id?: string; // Optional, auto-generated if not provided
  issue_id: string | null; // Optional, can be null for executions not tied to an issue
  agent_type: AgentType;
  mode?: string; // Execution mode ('worktree' | 'local')
  prompt?: string; // Rendered prompt
  config?: string; // JSON string of execution configuration
  before_commit?: string;
  target_branch: string; // Required for worktree integration
  branch_name: string; // Required for worktree integration
  worktree_path?: string; // Optional, set after worktree creation
}

/**
 * Input for updating an execution
 */
export interface UpdateExecutionInput {
  status?: ExecutionStatus;
  completed_at?: string | null;
  exit_code?: number | null;
  error_message?: string | null;
  after_commit?: string | null;
  target_branch?: string | null;
  worktree_path?: string | null;
  session_id?: string | null;
  summary?: string | null;
}

/**
 * Create a new execution
 */
export function createExecution(
  db: Database.Database,
  input: CreateExecutionInput
): Execution {
  const id = input.id || randomUUID();
  const now = new Date().toISOString();

  // Get issue_uuid if issue_id is provided
  let issue_uuid: string | null = null;
  if (input.issue_id) {
    const issue = db
      .prepare(`SELECT uuid FROM issues WHERE id = ?`)
      .get(input.issue_id) as { uuid: string } | undefined;
    if (issue) {
      issue_uuid = issue.uuid;
    }
  }

  const stmt = db.prepare(`
    INSERT INTO executions (
      id,
      issue_id,
      issue_uuid,
      agent_type,
      mode,
      prompt,
      config,
      status,
      started_at,
      before_commit,
      target_branch,
      branch_name,
      worktree_path,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.issue_id,
    issue_uuid,
    input.agent_type,
    input.mode || null,
    input.prompt || null,
    input.config || null,
    "running" as ExecutionStatus,
    now,
    input.before_commit || null,
    input.target_branch,
    input.branch_name,
    input.worktree_path || null,
    now,
    now
  );

  const execution = getExecution(db, id);
  if (!execution) {
    throw new Error(`Failed to create execution with id ${id}`);
  }

  return execution;
}

/**
 * Get an execution by ID
 */
export function getExecution(
  db: Database.Database,
  id: string
): Execution | null {
  const stmt = db.prepare(`
    SELECT * FROM executions WHERE id = ?
  `);

  const row = stmt.get(id) as Execution | undefined;
  return row || null;
}

/**
 * Get all executions for an issue
 */
export function getExecutionsByIssueId(
  db: Database.Database,
  issue_id: string
): Execution[] {
  const stmt = db.prepare(`
    SELECT * FROM executions
    WHERE issue_id = ?
    ORDER BY started_at DESC
  `);

  return stmt.all(issue_id) as Execution[];
}

/**
 * Update an execution
 */
export function updateExecution(
  db: Database.Database,
  id: string,
  input: UpdateExecutionInput
): Execution {
  const execution = getExecution(db, id);
  if (!execution) {
    throw new Error(`Execution not found: ${id}`);
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.status !== undefined) {
    updates.push("status = ?");
    values.push(input.status);
  }

  if (input.completed_at !== undefined) {
    updates.push("completed_at = ?");
    values.push(input.completed_at);
  }

  if (input.exit_code !== undefined) {
    updates.push("exit_code = ?");
    values.push(input.exit_code);
  }

  if (input.error_message !== undefined) {
    updates.push("error_message = ?");
    values.push(input.error_message);
  }

  if (input.after_commit !== undefined) {
    updates.push("after_commit = ?");
    values.push(input.after_commit);
  }

  if (input.target_branch !== undefined) {
    updates.push("target_branch = ?");
    values.push(input.target_branch);
  }

  if (input.worktree_path !== undefined) {
    updates.push("worktree_path = ?");
    values.push(input.worktree_path);
  }

  if (input.session_id !== undefined) {
    updates.push("session_id = ?");
    values.push(input.session_id);
  }

  if (input.summary !== undefined) {
    updates.push("summary = ?");
    values.push(input.summary);
  }

  // Always update updated_at
  updates.push("updated_at = ?");
  values.push(new Date().toISOString());

  if (updates.length === 1) {
    // Only updated_at, no other changes
    return execution;
  }

  values.push(id);

  const stmt = db.prepare(`
    UPDATE executions
    SET ${updates.join(", ")}
    WHERE id = ?
  `);

  stmt.run(...values);

  const updated = getExecution(db, id);
  if (!updated) {
    throw new Error(`Failed to update execution ${id}`);
  }

  return updated;
}

/**
 * Delete an execution
 */
export function deleteExecution(db: Database.Database, id: string): boolean {
  const stmt = db.prepare(`
    DELETE FROM executions WHERE id = ?
  `);

  const result = stmt.run(id);

  return result.changes > 0;
}

/**
 * Get all executions with optional status filter
 */
export function getAllExecutions(
  db: Database.Database,
  status?: ExecutionStatus
): Execution[] {
  if (status) {
    const stmt = db.prepare(`
      SELECT * FROM executions
      WHERE status = ?
      ORDER BY started_at DESC
    `);
    return stmt.all(status) as Execution[];
  } else {
    const stmt = db.prepare(`
      SELECT * FROM executions
      ORDER BY started_at DESC
    `);
    return stmt.all() as Execution[];
  }
}
