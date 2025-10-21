/**
 * CRUD operations for Issue Feedback
 */

import type Database from 'better-sqlite3';
import type { IssueFeedback, FeedbackType, FeedbackStatus, FeedbackAnchor } from '../types.js';

export interface CreateFeedbackInput {
  id?: string;
  issue_id: string;
  spec_id: string;
  feedback_type: FeedbackType;
  content: string;
  agent: string;
  anchor: FeedbackAnchor;
  status?: FeedbackStatus;
  resolution?: string | null;
}

export interface UpdateFeedbackInput {
  content?: string;
  status?: FeedbackStatus;
  resolution?: string | null;
  anchor?: FeedbackAnchor;
}

export interface ListFeedbackOptions {
  issue_id?: string;
  spec_id?: string;
  feedback_type?: FeedbackType;
  status?: FeedbackStatus;
  limit?: number;
  offset?: number;
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
    return 'FB-001';
  }

  const match = lastFeedback.id.match(/^FB-(\d+)$/);
  if (!match) {
    return 'FB-001';
  }

  const nextNum = parseInt(match[1], 10) + 1;
  return `FB-${String(nextNum).padStart(3, '0')}`;
}

/**
 * Create a new feedback entry
 */
export function createFeedback(db: Database.Database, input: CreateFeedbackInput): IssueFeedback {
  const id = input.id || generateFeedbackId(db);
  const anchorJson = JSON.stringify(input.anchor);

  const stmt = db.prepare(`
    INSERT INTO issue_feedback (
      id, issue_id, spec_id, feedback_type, content, agent, anchor, status, resolution
    ) VALUES (
      @id, @issue_id, @spec_id, @feedback_type, @content, @agent, @anchor, @status, @resolution
    )
  `);

  try {
    stmt.run({
      id,
      issue_id: input.issue_id,
      spec_id: input.spec_id,
      feedback_type: input.feedback_type,
      content: input.content,
      agent: input.agent,
      anchor: anchorJson,
      status: input.status || 'open',
      resolution: input.resolution || null,
    });

    const feedback = getFeedback(db, id);
    if (!feedback) {
      throw new Error(`Failed to create feedback ${id}`);
    }
    return feedback;
  } catch (error: any) {
    if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
      throw new Error(`Constraint violation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get a feedback entry by ID
 */
export function getFeedback(db: Database.Database, id: string): IssueFeedback | null {
  const stmt = db.prepare(`
    SELECT * FROM issue_feedback WHERE id = ?
  `);

  return (stmt.get(id) as IssueFeedback | undefined) ?? null;
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
    updates.push('content = @content');
    params.content = input.content;
  }
  if (input.status !== undefined) {
    updates.push('status = @status');
    params.status = input.status;
  }
  if (input.resolution !== undefined) {
    updates.push('resolution = @resolution');
    params.resolution = input.resolution;
  }
  if (input.anchor !== undefined) {
    updates.push('anchor = @anchor');
    params.anchor = JSON.stringify(input.anchor);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');

  if (updates.length === 1) {
    // Only updated_at changed, return existing
    return existing;
  }

  const stmt = db.prepare(`
    UPDATE issue_feedback SET ${updates.join(', ')} WHERE id = @id
  `);

  try {
    stmt.run(params);
    const updated = getFeedback(db, id);
    if (!updated) {
      throw new Error(`Failed to update feedback ${id}`);
    }
    return updated;
  } catch (error: any) {
    if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
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
 * Update feedback status (convenience method)
 */
export function updateFeedbackStatus(
  db: Database.Database,
  id: string,
  status: FeedbackStatus,
  resolution?: string
): IssueFeedback {
  return updateFeedback(db, id, { status, resolution: resolution || null });
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
    conditions.push('issue_id = @issue_id');
    params.issue_id = options.issue_id;
  }
  if (options.spec_id !== undefined) {
    conditions.push('spec_id = @spec_id');
    params.spec_id = options.spec_id;
  }
  if (options.feedback_type !== undefined) {
    conditions.push('feedback_type = @feedback_type');
    params.feedback_type = options.feedback_type;
  }
  if (options.status !== undefined) {
    conditions.push('status = @status');
    params.status = options.status;
  }

  let query = 'SELECT * FROM issue_feedback';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC';

  if (options.limit !== undefined) {
    query += ' LIMIT @limit';
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    query += ' OFFSET @offset';
    params.offset = options.offset;
  }

  const stmt = db.prepare(query);
  return stmt.all(params) as IssueFeedback[];
}

/**
 * Get all feedback for a specific issue
 */
export function getFeedbackForIssue(db: Database.Database, issue_id: string): IssueFeedback[] {
  return listFeedback(db, { issue_id });
}

/**
 * Get all feedback for a specific spec
 */
export function getFeedbackForSpec(db: Database.Database, spec_id: string): IssueFeedback[] {
  return listFeedback(db, { spec_id });
}

/**
 * Get open feedback for a spec
 */
export function getOpenFeedbackForSpec(db: Database.Database, spec_id: string): IssueFeedback[] {
  return listFeedback(db, { spec_id, status: 'open' });
}

/**
 * Count feedback by status
 */
export function countFeedbackByStatus(db: Database.Database, spec_id?: string): Record<FeedbackStatus, number> {
  let query = 'SELECT status, COUNT(*) as count FROM issue_feedback';
  const params: Record<string, any> = {};

  if (spec_id) {
    query += ' WHERE spec_id = @spec_id';
    params.spec_id = spec_id;
  }

  query += ' GROUP BY status';

  const stmt = db.prepare(query);
  const rows = stmt.all(params) as Array<{ status: FeedbackStatus; count: number }>;

  const counts: Record<FeedbackStatus, number> = {
    open: 0,
    acknowledged: 0,
    resolved: 0,
    wont_fix: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
}
