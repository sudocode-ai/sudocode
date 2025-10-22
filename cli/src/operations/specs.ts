/**
 * CRUD operations for Specs
 */

import type Database from 'better-sqlite3';
import type { Spec } from '../types.js';
import { generateUUID } from '../id-generator.js';

export interface CreateSpecInput {
  id: string;
  uuid?: string;
  title: string;
  file_path: string;
  content?: string;
  priority?: number;
  parent_id?: string | null;
}

export interface UpdateSpecInput {
  title?: string;
  file_path?: string;
  content?: string;
  priority?: number;
  parent_id?: string | null;
}

export interface ListSpecsOptions {
  priority?: number;
  parent_id?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Create a new spec
 */
export function createSpec(db: Database.Database, input: CreateSpecInput): Spec {
  // Validate parent_id exists if provided
  if (input.parent_id) {
    const parent = getSpec(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent spec not found: ${input.parent_id}`);
    }
  }

  const uuid = input.uuid || generateUUID();

  const stmt = db.prepare(`
    INSERT INTO specs (
      id, uuid, title, file_path, content, priority, parent_id
    ) VALUES (
      @id, @uuid, @title, @file_path, @content, @priority, @parent_id
    )
  `);

  try {
    stmt.run({
      id: input.id,
      uuid: uuid,
      title: input.title,
      file_path: input.file_path,
      content: input.content || '',
      priority: input.priority ?? 2,
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
 * Get a spec by file path
 */
export function getSpecByFilePath(db: Database.Database, filePath: string): Spec | null {
  const stmt = db.prepare(`
    SELECT * FROM specs WHERE file_path = ?
  `);

  return (stmt.get(filePath) as Spec | undefined) ?? null;
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

  // Validate parent_id exists if provided (and not null)
  if (input.parent_id !== undefined && input.parent_id !== null) {
    const parent = getSpec(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent spec not found: ${input.parent_id}`);
    }
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
  if (input.priority !== undefined) {
    updates.push('priority = @priority');
    params.priority = input.priority;
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
 * Search specs by title or content
 */
export function searchSpecs(
  db: Database.Database,
  query: string,
  options: Omit<ListSpecsOptions, 'offset'> = {}
): Spec[] {
  const conditions: string[] = ['(title LIKE @query OR content LIKE @query)'];
  const params: Record<string, any> = { query: `%${query}%` };

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

  let sql = `SELECT * FROM specs WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, created_at DESC`;

  if (options.limit !== undefined) {
    sql += ' LIMIT @limit';
    params.limit = options.limit;
  } else {
    sql += ' LIMIT 50';
  }

  const stmt = db.prepare(sql);
  return stmt.all(params) as Spec[];
}
