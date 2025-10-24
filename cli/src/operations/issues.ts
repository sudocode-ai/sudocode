/**
 * CRUD operations for Issues
 */

import type Database from "better-sqlite3";
import type { Issue, IssueStatus } from "../types.js";
import { generateUUID } from "../id-generator.js";

export interface CreateIssueInput {
  id: string;
  uuid?: string;
  title: string;
  description?: string;
  content?: string;
  status?: IssueStatus;
  priority?: number;
  assignee?: string | null;
  parent_id?: string | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  content?: string;
  status?: IssueStatus;
  priority?: number;
  assignee?: string | null;
  parent_id?: string | null;
  updated_at?: string;
  closed_at?: string | null;
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
export function createIssue(
  db: Database.Database,
  input: CreateIssueInput
): Issue {
  // Validate parent_id exists if provided
  if (input.parent_id) {
    const parent = getIssue(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent issue not found: ${input.parent_id}`);
    }
  }

  const uuid = input.uuid || generateUUID();

  // Build INSERT statement with optional timestamp fields
  const columns = [
    "id",
    "uuid",
    "title",
    "description",
    "content",
    "status",
    "priority",
    "assignee",
    "parent_id",
  ];
  const values = [
    "@id",
    "@uuid",
    "@title",
    "@description",
    "@content",
    "@status",
    "@priority",
    "@assignee",
    "@parent_id",
  ];

  if (input.created_at) {
    columns.push("created_at");
    values.push("@created_at");
  }
  if (input.updated_at) {
    columns.push("updated_at");
    values.push("@updated_at");
  }
  if (input.closed_at !== undefined) {
    columns.push("closed_at");
    values.push("@closed_at");
  }

  const stmt = db.prepare(`
    INSERT INTO issues (
      ${columns.join(", ")}
    ) VALUES (
      ${values.join(", ")}
    )
  `);

  try {
    const params: Record<string, any> = {
      id: input.id,
      uuid: uuid,
      title: input.title,
      description: input.description || "",
      content: input.content || "",
      status: input.status || "open",
      priority: input.priority ?? 2,
      assignee: input.assignee || null,
      parent_id: input.parent_id || null,
    };

    // Add optional timestamp parameters
    if (input.created_at) {
      params.created_at = input.created_at;
    }
    if (input.updated_at) {
      params.updated_at = input.updated_at;
    }
    if (input.closed_at !== undefined) {
      params.closed_at = input.closed_at;
    }

    stmt.run(params);

    const issue = getIssue(db, input.id);
    if (!issue) {
      throw new Error(`Failed to create issue ${input.id}`);
    }
    return issue;
  } catch (error: any) {
    if (error.code && error.code.startsWith("SQLITE_CONSTRAINT")) {
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

  // Validate parent_id exists if provided (and not null)
  if (input.parent_id !== undefined && input.parent_id !== null) {
    const parent = getIssue(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent issue not found: ${input.parent_id}`);
    }
  }

  const updates: string[] = [];
  const params: Record<string, any> = { id };

  if (input.title !== undefined) {
    updates.push("title = @title");
    params.title = input.title;
  }
  if (input.description !== undefined) {
    updates.push("description = @description");
    params.description = input.description;
  }
  if (input.content !== undefined) {
    updates.push("content = @content");
    params.content = input.content;
  }
  if (input.status !== undefined) {
    updates.push("status = @status");
    params.status = input.status;

    // Handle closed_at based on status changes
    // Use input.closed_at if provided, otherwise auto-set based on status
    if (input.closed_at !== undefined) {
      // Explicit closed_at provided - use it
      updates.push("closed_at = @closed_at");
      params.closed_at = input.closed_at;
    } else if (input.status === "closed" && existing.status !== "closed") {
      // Status changing to 'closed' - set timestamp
      updates.push("closed_at = CURRENT_TIMESTAMP");
    } else if (input.status !== "closed" && existing.status === "closed") {
      // Reopening - clear timestamp
      updates.push("closed_at = NULL");
    }
  } else if (input.closed_at !== undefined) {
    // closed_at provided without status change
    updates.push("closed_at = @closed_at");
    params.closed_at = input.closed_at;
  }
  if (input.priority !== undefined) {
    updates.push("priority = @priority");
    params.priority = input.priority;
  }
  if (input.assignee !== undefined) {
    updates.push("assignee = @assignee");
    params.assignee = input.assignee;
  }
  if (input.parent_id !== undefined) {
    updates.push("parent_id = @parent_id");
    params.parent_id = input.parent_id;
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
    UPDATE issues SET ${updates.join(", ")} WHERE id = @id
  `);

  try {
    stmt.run(params);
    const updated = getIssue(db, id);
    if (!updated) {
      throw new Error(`Failed to update issue ${id}`);
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
  return updateIssue(db, id, { status: "closed" });
}

/**
 * Reopen an issue (convenience method)
 */
export function reopenIssue(db: Database.Database, id: string): Issue {
  return updateIssue(db, id, { status: "open" });
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
    conditions.push("status = @status");
    params.status = options.status;
  }
  if (options.priority !== undefined) {
    conditions.push("priority = @priority");
    params.priority = options.priority;
  }
  if (options.assignee !== undefined) {
    if (options.assignee === null) {
      conditions.push("assignee IS NULL");
    } else {
      conditions.push("assignee = @assignee");
      params.assignee = options.assignee;
    }
  }
  if (options.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = @parent_id");
      params.parent_id = options.parent_id;
    }
  }

  let query = "SELECT * FROM issues";
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
  return stmt.all(params) as Issue[];
}

/**
 * Get ready issues (no blockers)
 */
export function getReadyIssues(db: Database.Database): Issue[] {
  const stmt = db.prepare(
    "SELECT * FROM ready_issues ORDER BY priority DESC, created_at DESC"
  );
  return stmt.all() as Issue[];
}

/**
 * Get blocked issues
 */
export function getBlockedIssues(db: Database.Database): any[] {
  const stmt = db.prepare(
    "SELECT * FROM blocked_issues ORDER BY priority DESC, created_at DESC"
  );
  return stmt.all();
}

/**
 * Search issues by title, description, or content
 */
export function searchIssues(
  db: Database.Database,
  query: string,
  options: Omit<ListIssuesOptions, "offset"> = {}
): Issue[] {
  const conditions: string[] = [
    "(title LIKE @query OR description LIKE @query OR content LIKE @query)",
  ];
  const params: Record<string, any> = { query: `%${query}%` };

  if (options.status !== undefined) {
    conditions.push("status = @status");
    params.status = options.status;
  }
  if (options.priority !== undefined) {
    conditions.push("priority = @priority");
    params.priority = options.priority;
  }
  if (options.assignee !== undefined) {
    if (options.assignee === null) {
      conditions.push("assignee IS NULL");
    } else {
      conditions.push("assignee = @assignee");
      params.assignee = options.assignee;
    }
  }
  if (options.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = @parent_id");
      params.parent_id = options.parent_id;
    }
  }

  let sql = `SELECT * FROM issues WHERE ${conditions.join(
    " AND "
  )} ORDER BY priority DESC, created_at DESC`;

  if (options.limit !== undefined) {
    sql += " LIMIT @limit";
    params.limit = options.limit;
  } else {
    sql += " LIMIT 50";
  }

  const stmt = db.prepare(sql);
  return stmt.all(params) as Issue[];
}
