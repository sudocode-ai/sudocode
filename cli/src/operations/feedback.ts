/**
 * CRUD operations for Issue Feedback
 */

import type Database from "better-sqlite3";
import type { IssueFeedback, FeedbackType, FeedbackAnchor } from "../types.js";

export interface CreateFeedbackInput {
  id?: string;
  issue_id: string;
  spec_id: string;
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
  issue_id?: string;
  spec_id?: string;
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
 * Generate next feedback ID (FB-001, FB-002, etc.)
 */
export function generateFeedbackId(db: Database.Database): string {
  const stmt = db.prepare(`
    SELECT id FROM issue_feedback ORDER BY id DESC LIMIT 1
  `);

  const lastFeedback = stmt.get() as { id: string } | undefined;

  if (!lastFeedback) {
    return "FB-001";
  }

  const match = lastFeedback.id.match(/^FB-(\d+)$/);
  if (!match) {
    return "FB-001";
  }

  const nextNum = parseInt(match[1], 10) + 1;
  return `FB-${String(nextNum).padStart(3, "0")}`;
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

  // Get issue_uuid and spec_uuid
  const issue = db.prepare(`SELECT uuid FROM issues WHERE id = ?`).get(input.issue_id) as { uuid: string } | undefined;
  if (!issue) {
    throw new Error(`Issue not found: ${input.issue_id}`);
  }

  const spec = db.prepare(`SELECT uuid FROM specs WHERE id = ?`).get(input.spec_id) as { uuid: string } | undefined;
  if (!spec) {
    throw new Error(`Spec not found: ${input.spec_id}`);
  }

  // Build SQL statement - include timestamps only if provided
  const hasTimestamps = input.created_at !== undefined || input.updated_at !== undefined;

  const stmt = hasTimestamps
    ? db.prepare(`
        INSERT INTO issue_feedback (
          id, issue_id, issue_uuid, spec_id, spec_uuid, feedback_type, content, agent, anchor, dismissed, created_at, updated_at
        ) VALUES (
          @id, @issue_id, @issue_uuid, @spec_id, @spec_uuid, @feedback_type, @content, @agent, @anchor, @dismissed, @created_at, @updated_at
        )
      `)
    : db.prepare(`
        INSERT INTO issue_feedback (
          id, issue_id, issue_uuid, spec_id, spec_uuid, feedback_type, content, agent, anchor, dismissed
        ) VALUES (
          @id, @issue_id, @issue_uuid, @spec_id, @spec_uuid, @feedback_type, @content, @agent, @anchor, @dismissed
        )
      `);

  try {
    const params: any = {
      id,
      issue_id: input.issue_id,
      issue_uuid: issue.uuid,
      spec_id: input.spec_id,
      spec_uuid: spec.uuid,
      feedback_type: input.feedback_type,
      content: input.content,
      agent: agent,
      anchor: anchorJson,
      dismissed: input.dismissed !== undefined ? (input.dismissed ? 1 : 0) : 0,
    };

    if (hasTimestamps) {
      params.created_at = input.created_at;
      params.updated_at = input.updated_at;
    }

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

  updates.push("updated_at = CURRENT_TIMESTAMP");

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

  if (options.issue_id !== undefined) {
    conditions.push("issue_id = @issue_id");
    params.issue_id = options.issue_id;
  }
  if (options.spec_id !== undefined) {
    conditions.push("spec_id = @spec_id");
    params.spec_id = options.spec_id;
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
 * Get all feedback for a specific issue
 */
export function getFeedbackForIssue(
  db: Database.Database,
  issue_id: string
): IssueFeedback[] {
  return listFeedback(db, { issue_id });
}

/**
 * Get all feedback for a specific spec
 */
export function getFeedbackForSpec(
  db: Database.Database,
  spec_id: string
): IssueFeedback[] {
  return listFeedback(db, { spec_id });
}

/**
 * Get active feedback for a spec (not dismissed)
 */
export function getActiveFeedbackForSpec(
  db: Database.Database,
  spec_id: string
): IssueFeedback[] {
  return listFeedback(db, { spec_id, dismissed: false });
}

/**
 * Count feedback by dismissed status
 */
export function countFeedbackByDismissed(
  db: Database.Database,
  spec_id?: string
): { active: number; dismissed: number } {
  let query = "SELECT dismissed, COUNT(*) as count FROM issue_feedback";
  const params: Record<string, any> = {};

  if (spec_id) {
    query += " WHERE spec_id = @spec_id";
    params.spec_id = spec_id;
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
