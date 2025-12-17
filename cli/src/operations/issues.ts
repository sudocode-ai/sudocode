/**
 * CRUD operations for Issues
 */

import type Database from "better-sqlite3";
import type { Issue, IssueStatus } from "../types.js";
import { generateUUID } from "../id-generator.js";
import {
  getIncomingRelationships,
  getOutgoingRelationships,
} from "./relationships.js";

/**
 * Parse external_links JSON field from SQLite row
 */
function parseExternalLinks(row: any): Issue | null {
  if (!row) return null;
  if (typeof row.external_links === "string") {
    try {
      row.external_links = JSON.parse(row.external_links);
    } catch {
      row.external_links = undefined;
    }
  }
  return row as Issue;
}

export interface CreateIssueInput {
  id: string;
  uuid?: string;
  title: string;
  content?: string;
  status?: IssueStatus;
  priority?: number;
  assignee?: string;
  parent_id?: string;
  archived?: boolean;
  archived_at?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  external_links?: string | null; // JSON string of ExternalLink[], null to clear
}

export interface UpdateIssueInput {
  title?: string;
  content?: string;
  status?: IssueStatus;
  priority?: number;
  assignee?: string;
  parent_id?: string;
  archived?: boolean;
  archived_at?: string;
  updated_at?: string;
  closed_at?: string;
  external_links?: string | null; // JSON string of ExternalLink[], null to clear
}

export interface ListIssuesOptions {
  status?: IssueStatus;
  priority?: number;
  assignee?: string;
  parent_id?: string;
  archived?: boolean;
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
  // Validate parent_id exists if provided and get parent_uuid
  let parent_uuid: string | null = null;
  if (input.parent_id) {
    const parent = getIssue(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent issue not found: ${input.parent_id}`);
    }
    parent_uuid = parent.uuid;
  }

  const uuid = input.uuid || generateUUID();

  // Build INSERT statement with optional timestamp fields
  const columns = [
    "id",
    "uuid",
    "title",
    "content",
    "status",
    "priority",
    "assignee",
    "parent_id",
    "parent_uuid",
    "archived",
    "external_links",
  ];
  const values = [
    "@id",
    "@uuid",
    "@title",
    "@content",
    "@status",
    "@priority",
    "@assignee",
    "@parent_id",
    "@parent_uuid",
    "@archived",
    "@external_links",
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
  if (input.archived_at !== undefined) {
    columns.push("archived_at");
    values.push("@archived_at");
  }

  const stmt = db.prepare(`
    INSERT INTO issues (
      ${columns.join(", ")}
    ) VALUES (
      ${values.join(", ")}
    )
    ON CONFLICT(id) DO UPDATE SET
      uuid = excluded.uuid,
      title = excluded.title,
      content = excluded.content,
      status = excluded.status,
      priority = excluded.priority,
      assignee = excluded.assignee,
      parent_id = excluded.parent_id,
      parent_uuid = excluded.parent_uuid,
      archived = excluded.archived,
      archived_at = excluded.archived_at,
      external_links = excluded.external_links,
      ${input.created_at ? "created_at = excluded.created_at," : ""}
      ${input.updated_at ? "updated_at = excluded.updated_at" : "updated_at = CURRENT_TIMESTAMP"}
  `);

  try {
    const params: Record<string, any> = {
      id: input.id,
      uuid: uuid,
      title: input.title,
      content: input.content || "",
      status: input.status || "open",
      priority: input.priority ?? 2,
      assignee: input.assignee ?? null,
      parent_id: input.parent_id ?? null,
      parent_uuid: parent_uuid,
      archived: input.archived ? 1 : 0,
      external_links: input.external_links ?? null,
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
    if (input.archived_at !== undefined) {
      params.archived_at = input.archived_at;
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

  const row = stmt.get(id);
  return parseExternalLinks(row);
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

  // Validate parent_id exists if provided
  if (input.parent_id) {
    const parent = getIssue(db, input.parent_id);
    if (!parent) {
      throw new Error(`Parent issue not found: ${input.parent_id}`);
    }
  }

  const updates: string[] = [];
  const params: Record<string, any> = { id };

  if (input.title !== undefined && input.title !== existing.title) {
    updates.push("title = @title");
    params.title = input.title;
  }
  if (input.content !== undefined && input.content !== existing.content) {
    updates.push("content = @content");
    params.content = input.content;
  }
  if (input.status !== undefined && input.status !== existing.status) {
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
  } else if (
    input.closed_at !== undefined &&
    input.closed_at !== existing.closed_at
  ) {
    // closed_at provided without status change
    updates.push("closed_at = @closed_at");
    params.closed_at = input.closed_at;
  }
  if (input.priority !== undefined && input.priority !== existing.priority) {
    updates.push("priority = @priority");
    params.priority = input.priority;
  }
  if (input.assignee !== undefined && input.assignee !== existing.assignee) {
    updates.push("assignee = @assignee");
    params.assignee = input.assignee;
  }
  if (input.parent_id !== undefined && input.parent_id !== existing.parent_id) {
    updates.push("parent_id = @parent_id");
    params.parent_id = input.parent_id;
  }
  if (
    input.archived !== undefined &&
    (input.archived ? 1 : 0) !== (existing.archived as unknown as number)
  ) {
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
  if (input.external_links !== undefined) {
    updates.push("external_links = @external_links");
    params.external_links = input.external_links;
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

    // If status changed to 'closed', update any dependent blocked issues
    if (input.status === "closed" && existing.status !== "closed") {
      updateDependentBlockedIssues(db, id);
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
 * Update status of issues that were blocked by the given issue
 * Called when a blocker issue is closed
 * Semantics:
 *   - blocks: closedIssueId --[blocks]--> blocked (outgoing blocks)
 *   - depends-on: blocked --[depends-on]--> closedIssueId (incoming depends-on)
 */
function updateDependentBlockedIssues(
  db: Database.Database,
  closedIssueId: string
): void {
  // Find all issues that are blocked by this issue
  // Check both outgoing 'blocks' and incoming 'depends-on' relationships
  const blocksRelationships = getOutgoingRelationships(
    db,
    closedIssueId,
    "issue",
    "blocks"
  );
  const dependsOnRelationships = getIncomingRelationships(
    db,
    closedIssueId,
    "issue",
    "depends-on"
  );

  const allDependentRelationships = [
    ...blocksRelationships,
    ...dependsOnRelationships,
  ];

  for (const rel of allDependentRelationships) {
    // For 'blocks': closedIssueId blocks to_id
    // For 'depends-on': from_id depends-on closedIssueId
    const blockedIssueId =
      rel.relationship_type === "blocks" ? rel.to_id : rel.from_id;
    const blockedIssue = getIssue(db, blockedIssueId);

    // Only update if the issue is currently marked as 'blocked'
    if (!blockedIssue || blockedIssue.status !== "blocked") {
      continue;
    }

    // Check if this issue has any other open/in_progress/blocked blockers
    const hasOtherBlockers = hasOpenBlockers(db, blockedIssueId, closedIssueId);

    // If no other blockers, update status from 'blocked' to 'open'
    if (!hasOtherBlockers) {
      const updateStmt = db.prepare(`
        UPDATE issues
        SET status = 'open', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(blockedIssueId);
    }
  }
}

/**
 * Check if an issue has any open blockers (excluding the specified blocker)
 * Semantics:
 *   - blocks: blocker --[blocks]--> issueId (incoming blocks)
 *   - depends-on: issueId --[depends-on]--> blocker (outgoing depends-on)
 */
function hasOpenBlockers(
  db: Database.Database,
  issueId: string,
  excludeBlockerId?: string
): boolean {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM relationships r
    JOIN issues blocker ON (
      (r.relationship_type = 'blocks' AND r.from_id = blocker.id AND r.from_type = 'issue') OR
      (r.relationship_type = 'depends-on' AND r.to_id = blocker.id AND r.to_type = 'issue')
    )
    WHERE (
      (r.relationship_type = 'blocks' AND r.to_id = ? AND r.to_type = 'issue') OR
      (r.relationship_type = 'depends-on' AND r.from_id = ? AND r.from_type = 'issue')
    )
      AND blocker.status IN ('open', 'in_progress', 'blocked')
      ${excludeBlockerId ? "AND blocker.id != ?" : ""}
  `);

  const params = excludeBlockerId
    ? [issueId, issueId, excludeBlockerId]
    : [issueId, issueId];
  const result = stmt.get(...params) as { count: number };
  return result.count > 0;
}

/**
 * Delete an issue
 * Cascades to delete:
 * - Any feedback FROM this issue
 * - Any feedback targeting this issue
 * - All relationships involving this issue (both incoming and outgoing)
 */
export function deleteIssue(db: Database.Database, id: string): boolean {
  // Delete any feedback FROM this issue (no longer handled by FK CASCADE since from_id is nullable)
  db.prepare(`DELETE FROM issue_feedback WHERE from_id = ?`).run(id);
  // Delete any feedback targeting this issue
  db.prepare(`DELETE FROM issue_feedback WHERE to_id = ?`).run(id);

  // Delete all relationships involving this issue (both directions)
  db.prepare(`
    DELETE FROM relationships
    WHERE (from_id = ? AND from_type = 'issue')
       OR (to_id = ? AND to_type = 'issue')
  `).run(id, id);

  // Then delete the issue itself
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
    conditions.push("assignee = @assignee");
    params.assignee = options.assignee;
  }
  if (options.parent_id !== undefined) {
    conditions.push("parent_id = @parent_id");
    params.parent_id = options.parent_id;
  }
  if (options.archived !== undefined) {
    conditions.push("archived = @archived");
    params.archived = options.archived ? 1 : 0;
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
  const rows = stmt.all(params) as any[];
  return rows.map((row) => parseExternalLinks(row)!);
}

/**
 * Get ready issues (no blockers)
 */
export function getReadyIssues(db: Database.Database): Issue[] {
  const stmt = db.prepare(
    "SELECT * FROM ready_issues ORDER BY priority DESC, created_at DESC"
  );
  const rows = stmt.all() as any[];
  return rows.map((row) => parseExternalLinks(row)!);
}

/**
 * Get blocked issues
 */
export function getBlockedIssues(db: Database.Database): any[] {
  const stmt = db.prepare(
    "SELECT * FROM blocked_issues ORDER BY priority DESC, created_at DESC"
  );
  const rows = stmt.all() as any[];
  return rows.map((row) => parseExternalLinks(row)!);
}

/**
 * Search issues by title or content
 */
export function searchIssues(
  db: Database.Database,
  query: string,
  options: Omit<ListIssuesOptions, "offset"> = {}
): Issue[] {
  const conditions: string[] = ["(title LIKE @query OR content LIKE @query)"];
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
    conditions.push("assignee = @assignee");
    params.assignee = options.assignee;
  }
  if (options.parent_id !== undefined) {
    conditions.push("parent_id = @parent_id");
    params.parent_id = options.parent_id;
  }
  if (options.archived !== undefined) {
    conditions.push("archived = @archived");
    params.archived = options.archived ? 1 : 0;
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
  const rows = stmt.all(params) as any[];
  return rows.map((row) => parseExternalLinks(row)!);
}
