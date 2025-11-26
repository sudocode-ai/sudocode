/**
 * CRUD operations for Issue Feedback
 */

import * as crypto from "crypto";
import type Database from "better-sqlite3";
import type { IssueFeedback, FeedbackType, FeedbackAnchor } from "../types.js";
import { getEntityTypeFromId } from "../id-generator.js";

export interface CreateFeedbackInput {
  id?: string;
  from_id: string;
  to_id: string;
  feedback_type: FeedbackType;
  content: string;
  agent?: string;
  anchor?: FeedbackAnchor;
  dismissed?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface UpdateFeedbackInput {
  content?: string;
  dismissed?: boolean;
  anchor?: FeedbackAnchor;
}

export interface ListFeedbackOptions {
  from_id?: string;
  to_id?: string;
  feedback_type?: FeedbackType;
  dismissed?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Convert raw database row to IssueFeedback with proper types
 * SQLite stores booleans as integers (0/1), so we need to convert
 */
function convertDbRowToFeedback(row: any): IssueFeedback {
  return {
    ...row,
    dismissed: row.dismissed === 1,
  };
}

/**
 * Generate feedback ID using UUID
 * This provides collision resistance for distributed workflows
 */
export function generateFeedbackId(db: Database.Database): string {
  return crypto.randomUUID();
}

/**
 * Create a new feedback entry
 */
export function createFeedback(
  db: Database.Database,
  input: CreateFeedbackInput
): IssueFeedback {
  const id = input.id || generateFeedbackId(db);
  const anchorJson = input.anchor ? JSON.stringify(input.anchor) : null;
  const agent = input.agent || "user";

  // Get from_uuid (must be an issue)
  const fromIssue = db.prepare(`SELECT uuid FROM issues WHERE id = ?`).get(input.from_id) as { uuid: string } | undefined;
  if (!fromIssue) {
    throw new Error(`Issue not found: ${input.from_id}`);
  }

  // Get to_uuid based on inferred entity type
  const toType = getEntityTypeFromId(input.to_id);
  let toUuid: string;

  if (toType === "spec") {
    const spec = db.prepare(`SELECT uuid FROM specs WHERE id = ?`).get(input.to_id) as { uuid: string } | undefined;
    if (!spec) {
      throw new Error(`Spec not found: ${input.to_id}`);
    }
    toUuid = spec.uuid;
  } else {
    const issue = db.prepare(`SELECT uuid FROM issues WHERE id = ?`).get(input.to_id) as { uuid: string } | undefined;
    if (!issue) {
      throw new Error(`Issue not found: ${input.to_id}`);
    }
    toUuid = issue.uuid;
  }

  // Always include timestamps to ensure ISO 8601 format with timezone info
  // SQLite's CURRENT_TIMESTAMP returns local format without timezone, causing parsing issues
  const now = new Date().toISOString();
  const created_at = input.created_at || now;
  const updated_at = input.updated_at || now;

  const stmt = db.prepare(`
    INSERT INTO issue_feedback (
      id, from_id, from_uuid, to_id, to_uuid, feedback_type, content, agent, anchor, dismissed, created_at, updated_at
    ) VALUES (
      @id, @from_id, @from_uuid, @to_id, @to_uuid, @feedback_type, @content, @agent, @anchor, @dismissed, @created_at, @updated_at
    )
  `);

  try {
    const params: any = {
      id,
      from_id: input.from_id,
      from_uuid: fromIssue.uuid,
      to_id: input.to_id,
      to_uuid: toUuid,
      feedback_type: input.feedback_type,
      content: input.content,
      agent: agent,
      anchor: anchorJson,
      dismissed: input.dismissed !== undefined ? (input.dismissed ? 1 : 0) : 0,
      created_at: created_at,
      updated_at: updated_at,
    };

    stmt.run(params);

    const feedback = getFeedback(db, id);
    if (!feedback) {
      throw new Error(`Failed to create feedback ${id}`);
    }
    return feedback;
  } catch (error: any) {
    if (error.code && error.code.startsWith("SQLITE_CONSTRAINT")) {
      throw new Error(`Constraint violation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get a feedback entry by ID
 */
export function getFeedback(
  db: Database.Database,
  id: string
): IssueFeedback | null {
  const stmt = db.prepare(`
    SELECT * FROM issue_feedback WHERE id = ?
  `);

  const row = stmt.get(id);
  return row ? convertDbRowToFeedback(row) : null;
}

/**
 * Update a feedback entry
 */
export function updateFeedback(
  db: Database.Database,
  id: string,
  input: UpdateFeedbackInput
): IssueFeedback {
  const existing = getFeedback(db, id);
  if (!existing) {
    throw new Error(`Feedback not found: ${id}`);
  }

  const updates: string[] = [];
  const params: Record<string, any> = { id };

  if (input.content !== undefined) {
    updates.push("content = @content");
    params.content = input.content;
  }
  if (input.dismissed !== undefined) {
    updates.push("dismissed = @dismissed");
    params.dismissed = input.dismissed ? 1 : 0;
  }
  if (input.anchor !== undefined) {
    updates.push("anchor = @anchor");
    params.anchor = JSON.stringify(input.anchor);
  }

  // Always use ISO 8601 format with timezone for consistency
  updates.push("updated_at = @updated_at");
  params.updated_at = new Date().toISOString();

  if (updates.length === 1) {
    // Only updated_at changed, return existing
    return existing;
  }

  const stmt = db.prepare(`
    UPDATE issue_feedback SET ${updates.join(", ")} WHERE id = @id
  `);

  try {
    stmt.run(params);
    const updated = getFeedback(db, id);
    if (!updated) {
      throw new Error(`Failed to update feedback ${id}`);
    }
    return updated;
  } catch (error: any) {
    if (error.code && error.code.startsWith("SQLITE_CONSTRAINT")) {
      throw new Error(`Constraint violation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Delete a feedback entry
 */
export function deleteFeedback(db: Database.Database, id: string): boolean {
  const stmt = db.prepare(`DELETE FROM issue_feedback WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Dismiss feedback (convenience method)
 */
export function dismissFeedback(
  db: Database.Database,
  id: string
): IssueFeedback {
  return updateFeedback(db, id, { dismissed: true });
}

/**
 * List feedback entries with optional filters
 */
export function listFeedback(
  db: Database.Database,
  options: ListFeedbackOptions = {}
): IssueFeedback[] {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (options.from_id !== undefined) {
    conditions.push("from_id = @from_id");
    params.from_id = options.from_id;
  }
  if (options.to_id !== undefined) {
    conditions.push("to_id = @to_id");
    params.to_id = options.to_id;
  }
  if (options.feedback_type !== undefined) {
    conditions.push("feedback_type = @feedback_type");
    params.feedback_type = options.feedback_type;
  }
  if (options.dismissed !== undefined) {
    conditions.push("dismissed = @dismissed");
    params.dismissed = options.dismissed ? 1 : 0;
  }

  let query = "SELECT * FROM issue_feedback";
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY created_at DESC";

  if (options.limit !== undefined) {
    query += " LIMIT @limit";
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    query += " OFFSET @offset";
    params.offset = options.offset;
  }

  const stmt = db.prepare(query);
  const rows = stmt.all(params);
  return rows.map(convertDbRowToFeedback);
}

/**
 * Get all feedback FROM a specific issue (issue providing feedback)
 */
export function getFeedbackFromIssue(
  db: Database.Database,
  issue_id: string
): IssueFeedback[] {
  return listFeedback(db, { from_id: issue_id });
}

/**
 * Get all feedback FOR a specific target (spec or issue receiving feedback)
 */
export function getFeedbackForTarget(
  db: Database.Database,
  to_id: string
): IssueFeedback[] {
  return listFeedback(db, { to_id });
}

/**
 * Get all feedback for a specific spec
 */
export function getFeedbackForSpec(
  db: Database.Database,
  spec_id: string
): IssueFeedback[] {
  return listFeedback(db, { to_id: spec_id });
}

/**
 * Get all feedback for a specific issue (feedback provided BY this issue)
 * For backward compatibility, this returns feedback FROM the issue.
 * For feedback TO an issue, use getFeedbackForTarget()
 */
export function getFeedbackForIssue(
  db: Database.Database,
  issue_id: string
): IssueFeedback[] {
  return listFeedback(db, { from_id: issue_id });
}

/**
 * Get active feedback for a spec (not dismissed)
 */
export function getActiveFeedbackForSpec(
  db: Database.Database,
  spec_id: string
): IssueFeedback[] {
  return listFeedback(db, { to_id: spec_id, dismissed: false });
}

/**
 * Get active feedback for an issue (not dismissed)
 */
export function getActiveFeedbackForIssue(
  db: Database.Database,
  issue_id: string
): IssueFeedback[] {
  return listFeedback(db, { to_id: issue_id, dismissed: false });
}

/**
 * Count feedback by dismissed status for a target
 */
export function countFeedbackByDismissed(
  db: Database.Database,
  to_id?: string
): { active: number; dismissed: number } {
  let query = "SELECT dismissed, COUNT(*) as count FROM issue_feedback";
  const params: Record<string, any> = {};
  const conditions: string[] = [];

  if (to_id) {
    conditions.push("to_id = @to_id");
    params.to_id = to_id;
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " GROUP BY dismissed";

  const stmt = db.prepare(query);
  const rows = stmt.all(params) as Array<{ dismissed: number; count: number }>;

  const counts = {
    active: 0,
    dismissed: 0,
  };

  for (const row of rows) {
    if (row.dismissed === 0) {
      counts.active = row.count;
    } else {
      counts.dismissed = row.count;
    }
  }

  return counts;
}
