/**
 * CRUD operations for Specs
 */

import type Database from 'better-sqlite3';
import type { Spec, SpecStatus, SpecType } from '../types.js';

export interface CreateSpecInput {
  id: string;
  title: string;
  file_path: string;
  content?: string;
  type?: SpecType;
  status?: SpecStatus;
  priority?: number;
  created_by: string;
  parent_id?: string | null;
}

export interface UpdateSpecInput {
  title?: string;
  file_path?: string;
  content?: string;
  type?: SpecType;
  status?: SpecStatus;
  priority?: number;
  updated_by: string;
  parent_id?: string | null;
}

export interface ListSpecsOptions {
  status?: SpecStatus;
  type?: SpecType;
  priority?: number;
  parent_id?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Create a new spec
 */
export function createSpec(db: Database.Database, input: CreateSpecInput): Spec {
  const stmt = db.prepare(`
    INSERT INTO specs (
      id, title, file_path, content, type, status, priority,
      created_by, updated_by, parent_id
    ) VALUES (
      @id, @title, @file_path, @content, @type, @status, @priority,
      @created_by, @updated_by, @parent_id
    )
  `);

  try {
    stmt.run({
      id: input.id,
      title: input.title,
      file_path: input.file_path,
      content: input.content || '',
      type: input.type || 'feature',
      status: input.status || 'draft',
      priority: input.priority ?? 2,
      created_by: input.created_by,
      updated_by: input.created_by,
      parent_id: input.parent_id || null,
    });

    const spec = getSpec(db, input.id);
    if (!spec) {
      throw new Error(`Failed to create spec ${input.id}`);
    }
    return spec;
  } catch (error: any) {
    if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
      throw new Error(`Constraint violation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get a spec by ID
 */
export function getSpec(db: Database.Database, id: string): Spec | null {
  const stmt = db.prepare(`
    SELECT * FROM specs WHERE id = ?
  `);

  return (stmt.get(id) as Spec | undefined) ?? null;
}

/**
 * Update a spec
 */
export function updateSpec(
  db: Database.Database,
  id: string,
  input: UpdateSpecInput
): Spec {
  const existing = getSpec(db, id);
  if (!existing) {
    throw new Error(`Spec not found: ${id}`);
  }

  const updates: string[] = [];
  const params: Record<string, any> = { id };

  if (input.title !== undefined) {
    updates.push('title = @title');
    params.title = input.title;
  }
  if (input.file_path !== undefined) {
    updates.push('file_path = @file_path');
    params.file_path = input.file_path;
  }
  if (input.content !== undefined) {
    updates.push('content = @content');
    params.content = input.content;
  }
  if (input.type !== undefined) {
    updates.push('type = @type');
    params.type = input.type;
  }
  if (input.status !== undefined) {
    updates.push('status = @status');
    params.status = input.status;
  }
  if (input.priority !== undefined) {
    updates.push('priority = @priority');
    params.priority = input.priority;
  }
  if (input.parent_id !== undefined) {
    updates.push('parent_id = @parent_id');
    params.parent_id = input.parent_id;
  }

  updates.push('updated_by = @updated_by');
  params.updated_by = input.updated_by;

  updates.push('updated_at = CURRENT_TIMESTAMP');

  if (updates.length === 0) {
    return existing;
  }

  const stmt = db.prepare(`
    UPDATE specs SET ${updates.join(', ')} WHERE id = @id
  `);

  try {
    stmt.run(params);
    const updated = getSpec(db, id);
    if (!updated) {
      throw new Error(`Failed to update spec ${id}`);
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
 * Delete a spec
 */
export function deleteSpec(db: Database.Database, id: string): boolean {
  const stmt = db.prepare(`DELETE FROM specs WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * List specs with optional filters
 */
export function listSpecs(
  db: Database.Database,
  options: ListSpecsOptions = {}
): Spec[] {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (options.status !== undefined) {
    conditions.push('status = @status');
    params.status = options.status;
  }
  if (options.type !== undefined) {
    conditions.push('type = @type');
    params.type = options.type;
  }
  if (options.priority !== undefined) {
    conditions.push('priority = @priority');
    params.priority = options.priority;
  }
  if (options.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push('parent_id IS NULL');
    } else {
      conditions.push('parent_id = @parent_id');
      params.parent_id = options.parent_id;
    }
  }

  let query = 'SELECT * FROM specs';
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
  return stmt.all(params) as Spec[];
}

/**
 * Get ready specs (no blockers)
 */
export function getReadySpecs(db: Database.Database): Spec[] {
  const stmt = db.prepare('SELECT * FROM ready_specs ORDER BY priority DESC, created_at DESC');
  return stmt.all() as Spec[];
}

/**
 * Search specs by title or content
 */
export function searchSpecs(
  db: Database.Database,
  query: string,
  options: { limit?: number } = {}
): Spec[] {
  const stmt = db.prepare(`
    SELECT * FROM specs
    WHERE title LIKE @query OR content LIKE @query
    ORDER BY priority DESC, created_at DESC
    LIMIT @limit
  `);

  return stmt.all({
    query: `%${query}%`,
    limit: options.limit || 50,
  }) as Spec[];
}
