/**
 * CRUD operations for Issues
 */

import type Database from 'better-sqlite3';
import type { Issue, IssueStatus } from '../types.js';

export interface CreateIssueInput {
  id: string;
  title: string;
  description?: string;
  content?: string;
  status?: IssueStatus;
  priority?: number;
  assignee?: string | null;
  created_by: string;
  parent_id?: string | null;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  content?: string;
  status?: IssueStatus;
  priority?: number;
  assignee?: string | null;
  parent_id?: string | null;
}

export interface ListIssuesOptions {
  status?: IssueStatus;
  priority?: number;
  assignee?: string | null;
  parent_id?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Create a new issue
 */
export function createIssue(db: Database.Database, input: CreateIssueInput): Issue {
  const stmt = db.prepare(`
    INSERT INTO issues (
      id, title, description, content, status, priority,
      assignee, created_by, parent_id
    ) VALUES (
      @id, @title, @description, @content, @status, @priority,
      @assignee, @created_by, @parent_id
    )
  `);

  try {
    stmt.run({
      id: input.id,
      title: input.title,
      description: input.description || '',
      content: input.content || '',
      status: input.status || 'open',
      priority: input.priority ?? 2,
      assignee: input.assignee || null,
      created_by: input.created_by,
      parent_id: input.parent_id || null,
    });

    const issue = getIssue(db, input.id);
    if (!issue) {
      throw new Error(`Failed to create issue ${input.id}`);
    }
    return issue;
  } catch (error: any) {
    if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
      throw new Error(`Constraint violation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get an issue by ID
 */
export function getIssue(db: Database.Database, id: string): Issue | null {
  const stmt = db.prepare(`
    SELECT * FROM issues WHERE id = ?
  `);

  return (stmt.get(id) as Issue | undefined) ?? null;
}

/**
 * Update an issue
 */
export function updateIssue(
  db: Database.Database,
  id: string,
  input: UpdateIssueInput
): Issue {
  const existing = getIssue(db, id);
  if (!existing) {
    throw new Error(`Issue not found: ${id}`);
  }

  const updates: string[] = [];
  const params: Record<string, any> = { id };

  if (input.title !== undefined) {
    updates.push('title = @title');
    params.title = input.title;
  }
  if (input.description !== undefined) {
    updates.push('description = @description');
    params.description = input.description;
  }
  if (input.content !== undefined) {
    updates.push('content = @content');
    params.content = input.content;
  }
  if (input.status !== undefined) {
    updates.push('status = @status');
    params.status = input.status;

    // Set closed_at when status becomes 'closed'
    if (input.status === 'closed') {
      updates.push('closed_at = CURRENT_TIMESTAMP');
    } else if (existing.status === 'closed') {
      // Clear closed_at when reopening
      updates.push('closed_at = NULL');
    }
  }
  if (input.priority !== undefined) {
    updates.push('priority = @priority');
    params.priority = input.priority;
  }
  if (input.assignee !== undefined) {
    updates.push('assignee = @assignee');
    params.assignee = input.assignee;
  }
  if (input.parent_id !== undefined) {
    updates.push('parent_id = @parent_id');
    params.parent_id = input.parent_id;
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');

  if (updates.length === 0) {
    return existing;
  }

  const stmt = db.prepare(`
    UPDATE issues SET ${updates.join(', ')} WHERE id = @id
  `);

  try {
    stmt.run(params);
    const updated = getIssue(db, id);
    if (!updated) {
      throw new Error(`Failed to update issue ${id}`);
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
 * Delete an issue
 */
export function deleteIssue(db: Database.Database, id: string): boolean {
  const stmt = db.prepare(`DELETE FROM issues WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Close an issue (convenience method)
 */
export function closeIssue(db: Database.Database, id: string): Issue {
  return updateIssue(db, id, { status: 'closed' });
}

/**
 * Reopen an issue (convenience method)
 */
export function reopenIssue(db: Database.Database, id: string): Issue {
  return updateIssue(db, id, { status: 'open' });
}

/**
 * List issues with optional filters
 */
export function listIssues(
  db: Database.Database,
  options: ListIssuesOptions = {}
): Issue[] {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (options.status !== undefined) {
    conditions.push('status = @status');
    params.status = options.status;
  }
  if (options.priority !== undefined) {
    conditions.push('priority = @priority');
    params.priority = options.priority;
  }
  if (options.assignee !== undefined) {
    if (options.assignee === null) {
      conditions.push('assignee IS NULL');
    } else {
      conditions.push('assignee = @assignee');
      params.assignee = options.assignee;
    }
  }
  if (options.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push('parent_id IS NULL');
    } else {
      conditions.push('parent_id = @parent_id');
      params.parent_id = options.parent_id;
    }
  }

  let query = 'SELECT * FROM issues';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY priority DESC, created_at DESC';

  if (options.limit !== undefined) {
    query += ' LIMIT @limit';
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    query += ' OFFSET @offset';
    params.offset = options.offset;
  }

  const stmt = db.prepare(query);
  return stmt.all(params) as Issue[];
}

/**
 * Get ready issues (no blockers)
 */
export function getReadyIssues(db: Database.Database): Issue[] {
  const stmt = db.prepare('SELECT * FROM ready_issues ORDER BY priority DESC, created_at DESC');
  return stmt.all() as Issue[];
}

/**
 * Get blocked issues
 */
export function getBlockedIssues(db: Database.Database): any[] {
  const stmt = db.prepare('SELECT * FROM blocked_issues ORDER BY priority DESC, created_at DESC');
  return stmt.all();
}

/**
 * Search issues by title, description, or content
 */
export function searchIssues(
  db: Database.Database,
  query: string,
  options: { limit?: number } = {}
): Issue[] {
  const stmt = db.prepare(`
    SELECT * FROM issues
    WHERE title LIKE @query OR description LIKE @query OR content LIKE @query
    ORDER BY priority DESC, created_at DESC
    LIMIT @limit
  `);

  return stmt.all({
    query: `%${query}%`,
    limit: options.limit || 50,
  }) as Issue[];
}
