/**
 * CRUD operations for Sessions
 */

import type Database from "better-sqlite3";
import type { Session } from "../types.js";
import { generateUUID } from "../id-generator.js";

export interface CreateSessionInput {
  id: string;
  uuid?: string;
  session_id: string;
  title: string;
  description?: string;
  agent_type: "claude-code" | "codex";
  archived?: boolean;
  archived_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpdateSessionInput {
  title?: string;
  description?: string;
  agent_type?: "claude-code" | "codex";
  archived?: boolean;
  archived_at?: string;
  updated_at?: string;
}

export interface ListSessionsOptions {
  agent_type?: "claude-code" | "codex";
  archived?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Create a new session
 */
export function createSession(
  db: Database.Database,
  input: CreateSessionInput
): Session {
  const uuid = input.uuid || generateUUID();

  // Build INSERT statement with optional timestamp fields
  const columns = [
    "id",
    "uuid",
    "session_id",
    "title",
    "description",
    "agent_type",
    "archived",
  ];
  const values = [
    "@id",
    "@uuid",
    "@session_id",
    "@title",
    "@description",
    "@agent_type",
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
    INSERT INTO sessions (
      ${columns.join(", ")}
    ) VALUES (
      ${values.join(", ")}
    )
    ON CONFLICT(id) DO UPDATE SET
      uuid = excluded.uuid,
      session_id = excluded.session_id,
      title = excluded.title,
      description = excluded.description,
      agent_type = excluded.agent_type,
      archived = excluded.archived,
      archived_at = excluded.archived_at,
      ${input.created_at ? "created_at = excluded.created_at," : ""}
      ${input.updated_at ? "updated_at = excluded.updated_at" : "updated_at = CURRENT_TIMESTAMP"}
  `);

  try {
    const params: Record<string, any> = {
      id: input.id,
      uuid: uuid,
      session_id: input.session_id,
      title: input.title,
      description: input.description ?? null,
      agent_type: input.agent_type,
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

    const session = getSession(db, input.id);
    if (!session) {
      throw new Error(`Failed to create session ${input.id}`);
    }
    return session;
  } catch (error: any) {
    if (error.code && error.code.startsWith("SQLITE_CONSTRAINT")) {
      throw new Error(`Constraint violation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get a session by ID
 */
export function getSession(db: Database.Database, id: string): Session | null {
  const stmt = db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `);

  return (stmt.get(id) as Session | undefined) ?? null;
}

/**
 * Get a session by Claude session_id
 */
export function getSessionBySessionId(
  db: Database.Database,
  sessionId: string
): Session | null {
  const stmt = db.prepare(`
    SELECT * FROM sessions WHERE session_id = ?
  `);

  return (stmt.get(sessionId) as Session | undefined) ?? null;
}

/**
 * Update a session
 */
export function updateSession(
  db: Database.Database,
  id: string,
  input: UpdateSessionInput
): Session {
  const existing = getSession(db, id);
  if (!existing) {
    throw new Error(`Session not found: ${id}`);
  }

  const updates: string[] = [];
  const params: Record<string, any> = { id };

  if (input.title !== undefined && input.title !== existing.title) {
    updates.push("title = @title");
    params.title = input.title;
  }
  if (input.description !== undefined && input.description !== existing.description) {
    updates.push("description = @description");
    params.description = input.description;
  }
  if (input.agent_type !== undefined && input.agent_type !== existing.agent_type) {
    updates.push("agent_type = @agent_type");
    params.agent_type = input.agent_type;
  }
  if (input.archived !== undefined && input.archived !== existing.archived) {
    updates.push("archived = @archived");
    params.archived = input.archived ? 1 : 0;

    // Handle archived_at based on archived changes
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
    UPDATE sessions SET ${updates.join(", ")} WHERE id = @id
  `);

  try {
    stmt.run(params);
    const updated = getSession(db, id);
    if (!updated) {
      throw new Error(`Failed to update session ${id}`);
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
 * Delete a session
 */
export function deleteSession(db: Database.Database, id: string): boolean {
  const stmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * List sessions with optional filters
 */
export function listSessions(
  db: Database.Database,
  options: ListSessionsOptions = {}
): Session[] {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (options.agent_type !== undefined) {
    conditions.push("agent_type = @agent_type");
    params.agent_type = options.agent_type;
  }
  if (options.archived !== undefined) {
    conditions.push("archived = @archived");
    params.archived = options.archived ? 1 : 0;
  }

  let query = "SELECT * FROM sessions";
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
  return stmt.all(params) as Session[];
}

/**
 * Search sessions by title or description
 */
export function searchSessions(
  db: Database.Database,
  query: string,
  options: Omit<ListSessionsOptions, "offset"> = {}
): Session[] {
  const conditions: string[] = ["(title LIKE @query OR description LIKE @query)"];
  const params: Record<string, any> = { query: `%${query}%` };

  if (options.agent_type !== undefined) {
    conditions.push("agent_type = @agent_type");
    params.agent_type = options.agent_type;
  }
  if (options.archived !== undefined) {
    conditions.push("archived = @archived");
    params.archived = options.archived ? 1 : 0;
  }

  let sql = `SELECT * FROM sessions WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;

  if (options.limit !== undefined) {
    sql += " LIMIT @limit";
    params.limit = options.limit;
  } else {
    sql += " LIMIT 50";
  }

  const stmt = db.prepare(sql);
  return stmt.all(params) as Session[];
}
