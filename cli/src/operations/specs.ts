/**
 * CRUD operations for Specs
 */

import type Database from "better-sqlite3";
import type { Spec } from "../types.js";
import { generateUUID } from "../id-generator.js";

export interface CreateSpecInput {
  id: string;
  uuid?: string;
  title: string;
  file_path: string;
  content?: string;
  priority?: number;
  parent_id?: string;
  archived?: boolean;
  archived_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpdateSpecInput {
  title?: string;
  file_path?: string;
  content?: string;
  priority?: number;
  parent_id?: string;
  archived?: boolean;
  archived_at?: string;
  updated_at?: string;
}

export interface ListSpecsOptions {
  priority?: number;
  parent_id?: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Create a new spec
 */
export function createSpec(
  db: Database.Database,
  input: CreateSpecInput
): Spec {
  // Validate parent_id exists if provided and get parent_uuid
  let parent_uuid: string | null = null;
  if (input.parent_id) {
    const parent = getSpec(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent spec not found: ${input.parent_id}`);
    }
    parent_uuid = parent.uuid;
  }

  const uuid = input.uuid || generateUUID();

  // Build INSERT statement with optional timestamp fields
  const columns = [
    "id",
    "uuid",
    "title",
    "file_path",
    "content",
    "priority",
    "parent_id",
    "parent_uuid",
    "archived",
  ];
  const values = [
    "@id",
    "@uuid",
    "@title",
    "@file_path",
    "@content",
    "@priority",
    "@parent_id",
    "@parent_uuid",
    "@archived",
  ];

  if (input.created_at) {
    columns.push("created_at");
    values.push("@created_at");
  }
  if (input.updated_at) {
    columns.push("updated_at");
    values.push("@updated_at");
  }
  if (input.archived_at !== undefined) {
    columns.push("archived_at");
    values.push("@archived_at");
  }

  const stmt = db.prepare(`
    INSERT INTO specs (
      ${columns.join(", ")}
    ) VALUES (
      ${values.join(", ")}
    )
    ON CONFLICT(id) DO UPDATE SET
      uuid = excluded.uuid,
      title = excluded.title,
      file_path = excluded.file_path,
      content = excluded.content,
      priority = excluded.priority,
      parent_id = excluded.parent_id,
      parent_uuid = excluded.parent_uuid,
      archived = excluded.archived,
      archived_at = excluded.archived_at,
      ${input.created_at ? "created_at = excluded.created_at," : ""}
      ${input.updated_at ? "updated_at = excluded.updated_at" : "updated_at = CURRENT_TIMESTAMP"}
  `);

  try {
    const params: Record<string, any> = {
      id: input.id,
      uuid: uuid,
      title: input.title,
      file_path: input.file_path,
      content: input.content || "",
      priority: input.priority ?? 2,
      parent_id: input.parent_id ?? null,
      parent_uuid: parent_uuid,
      archived: input.archived ? 1 : 0,
    };

    // Add optional timestamp parameters
    if (input.created_at) {
      params.created_at = input.created_at;
    }
    if (input.updated_at) {
      params.updated_at = input.updated_at;
    }
    if (input.archived_at !== undefined) {
      params.archived_at = input.archived_at;
    }

    stmt.run(params);

    const spec = getSpec(db, input.id);
    if (!spec) {
      throw new Error(`Failed to create spec ${input.id}`);
    }
    return spec;
  } catch (error: any) {
    if (error.code && error.code.startsWith("SQLITE_CONSTRAINT")) {
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
export function getSpecByFilePath(
  db: Database.Database,
  filePath: string
): Spec | null {
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

  // Validate parent_id exists if provided
  if (input.parent_id) {
    const parent = getSpec(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent spec not found: ${input.parent_id}`);
    }
  }

  const updates: string[] = [];
  const params: Record<string, any> = { id };

  if (input.title !== undefined && input.title !== existing.title) {
    updates.push("title = @title");
    params.title = input.title;
  }
  if (input.file_path !== undefined && input.file_path !== existing.file_path) {
    updates.push("file_path = @file_path");
    params.file_path = input.file_path;
  }
  if (input.content !== undefined && input.content !== existing.content) {
    updates.push("content = @content");
    params.content = input.content;
  }
  if (input.priority !== undefined && input.priority !== existing.priority) {
    updates.push("priority = @priority");
    params.priority = input.priority;
  }
  if (input.parent_id !== undefined && input.parent_id !== existing.parent_id) {
    updates.push("parent_id = @parent_id");
    params.parent_id = input.parent_id;
  }
  if (input.archived !== undefined && input.archived !== existing.archived) {
    updates.push("archived = @archived");
    params.archived = input.archived ? 1 : 0;

    // Handle archived_at based on archived changes
    // Use input.archived_at if provided, otherwise auto-set based on archived
    if (input.archived_at !== undefined) {
      // Explicit archived_at provided - use it
      updates.push("archived_at = @archived_at");
      params.archived_at = input.archived_at;
    } else if (input.archived && !existing.archived) {
      // Archiving - set timestamp
      updates.push("archived_at = CURRENT_TIMESTAMP");
    } else if (!input.archived && existing.archived) {
      // Unarchiving - clear timestamp
      updates.push("archived_at = NULL");
    }
  } else if (
    input.archived_at !== undefined &&
    input.archived_at !== existing.archived_at
  ) {
    // archived_at provided without archived change
    updates.push("archived_at = @archived_at");
    params.archived_at = input.archived_at;
  }

  // Handle updated_at - use provided value or set to current timestamp
  if (input.updated_at !== undefined) {
    updates.push("updated_at = @updated_at");
    params.updated_at = input.updated_at;
  } else if (updates.length > 0) {
    // Only update timestamp if there are actual changes
    updates.push("updated_at = CURRENT_TIMESTAMP");
  }

  if (updates.length === 0) {
    return existing;
  }

  const stmt = db.prepare(`
    UPDATE specs SET ${updates.join(", ")} WHERE id = @id
  `);

  try {
    stmt.run(params);
    const updated = getSpec(db, id);
    if (!updated) {
      throw new Error(`Failed to update spec ${id}`);
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
 * Delete a spec
 * Also cascades to delete any feedback targeting this spec
 */
export function deleteSpec(db: Database.Database, id: string): boolean {
  // First delete any feedback targeting this spec
  db.prepare(`DELETE FROM issue_feedback WHERE to_id = ?`).run(id);

  // Then delete the spec itself
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
    conditions.push("priority = @priority");
    params.priority = options.priority;
  }
  if (options.parent_id !== undefined) {
    conditions.push("parent_id = @parent_id");
    params.parent_id = options.parent_id;
  }
  if (options.archived !== undefined) {
    conditions.push("archived = @archived");
    params.archived = options.archived ? 1 : 0;
  }

  let query = "SELECT * FROM specs";
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY priority DESC, created_at DESC";

  if (options.limit !== undefined) {
    query += " LIMIT @limit";
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    query += " OFFSET @offset";
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
  options: Omit<ListSpecsOptions, "offset"> = {}
): Spec[] {
  const conditions: string[] = ["(title LIKE @query OR content LIKE @query)"];
  const params: Record<string, any> = { query: `%${query}%` };

  if (options.priority !== undefined) {
    conditions.push("priority = @priority");
    params.priority = options.priority;
  }
  if (options.parent_id !== undefined) {
    conditions.push("parent_id = @parent_id");
    params.parent_id = options.parent_id;
  }
  if (options.archived !== undefined) {
    conditions.push("archived = @archived");
    params.archived = options.archived ? 1 : 0;
  }

  let sql = `SELECT * FROM specs WHERE ${conditions.join(" AND ")} ORDER BY priority DESC, created_at DESC`;

  if (options.limit !== undefined) {
    sql += " LIMIT @limit";
    params.limit = options.limit;
  } else {
    sql += " LIMIT 50";
  }

  const stmt = db.prepare(sql);
  return stmt.all(params) as Spec[];
}
