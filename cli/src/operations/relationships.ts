/**
 * Operations for Relationships
 */

import type Database from "better-sqlite3";
import type { Relationship, EntityType, RelationshipType } from "../types.js";
import { isValidRelationshipType, getValidRelationshipTypes } from "../validation.js";
import { getIssue } from "./issues.js";

export interface CreateRelationshipInput {
  from_id: string;
  from_type: EntityType;
  to_id: string;
  to_type: EntityType;
  relationship_type: RelationshipType;
  metadata?: string;
}

/**
 * Add a relationship between entities
 */
export function addRelationship(
  db: Database.Database,
  input: CreateRelationshipInput
): Relationship {
  // Validate relationship type
  if (!isValidRelationshipType(input.relationship_type)) {
    throw new Error(
      `Invalid relationship type: ${input.relationship_type}. Valid types: ${getValidRelationshipTypes().join(", ")}`
    );
  }

  // Check if from_id exists and get from_uuid
  const fromTable = input.from_type === "spec" ? "specs" : "issues";
  const fromEntity = db
    .prepare(`SELECT id, uuid FROM ${fromTable} WHERE id = ?`)
    .get(input.from_id) as { id: string; uuid: string } | undefined;
  if (!fromEntity) {
    throw new Error(
      `${input.from_type === "spec" ? "Spec" : "Issue"} not found: ${input.from_id}`
    );
  }

  // Check if to_id exists and get to_uuid
  const toTable = input.to_type === "spec" ? "specs" : "issues";
  const toEntity = db
    .prepare(`SELECT id, uuid FROM ${toTable} WHERE id = ?`)
    .get(input.to_id) as { id: string; uuid: string } | undefined;
  if (!toEntity) {
    throw new Error(
      `${input.to_type === "spec" ? "Spec" : "Issue"} not found: ${input.to_id}`
    );
  }

  // Check if relationship already exists
  const existing = getRelationship(
    db,
    input.from_id,
    input.from_type,
    input.to_id,
    input.to_type,
    input.relationship_type
  );

  if (existing) {
    return existing;
  }

  const stmt = db.prepare(`
    INSERT INTO relationships (
      from_id, from_uuid, from_type, to_id, to_uuid, to_type, relationship_type, metadata
    ) VALUES (
      @from_id, @from_uuid, @from_type, @to_id, @to_uuid, @to_type, @relationship_type, @metadata
    )
  `);

  try {
    stmt.run({
      from_id: input.from_id,
      from_uuid: fromEntity.uuid,
      from_type: input.from_type,
      to_id: input.to_id,
      to_uuid: toEntity.uuid,
      to_type: input.to_type,
      relationship_type: input.relationship_type,
      metadata: input.metadata ?? null,
    });

    const rel = getRelationship(
      db,
      input.from_id,
      input.from_type,
      input.to_id,
      input.to_type,
      input.relationship_type
    );

    if (!rel) {
      throw new Error("Failed to create relationship");
    }

    // Auto-update blocked status when adding a 'blocks' or 'depends-on' relationship
    // Semantics:
    //   - blocks: from_id blocks to_id (from_id is the blocker, to_id gets blocked)
    //   - depends-on: from_id depends-on to_id (from_id gets blocked until to_id is done)
    if (
      (input.relationship_type === "blocks" ||
        input.relationship_type === "depends-on") &&
      input.from_type === "issue" &&
      input.to_type === "issue"
    ) {
      // For 'blocks': to_id is blocked by from_id
      // For 'depends-on': from_id is blocked by to_id
      const blockedId =
        input.relationship_type === "blocks" ? input.to_id : input.from_id;
      const blockerId =
        input.relationship_type === "blocks" ? input.from_id : input.to_id;
      autoUpdateBlockedStatusOnAdd(db, blockedId, blockerId);
    }

    return rel;
  } catch (error: any) {
    if (error.code && error.code.startsWith("SQLITE_CONSTRAINT")) {
      throw new Error(
        `Relationship already exists: ${input.from_id} (${input.from_type}) --[${input.relationship_type}]--> ${input.to_id} (${input.to_type})`
      );
    }
    throw error;
  }
}

/**
 * Auto-update blocked status when adding a 'blocks' or 'depends-on' relationship
 * Semantics:
 *   - blocks: blocker blocks blocked (blocker is the issue doing the blocking)
 *   - depends-on: blocked depends on blocker (blocked needs blocker to be done)
 */
function autoUpdateBlockedStatusOnAdd(
  db: Database.Database,
  blockedIssueId: string,
  blockerIssueId: string
): void {
  const blockerIssue = getIssue(db, blockerIssueId);

  // Only set to 'blocked' if the blocker is not closed
  if (blockerIssue && blockerIssue.status !== "closed") {
    const blockedIssue = getIssue(db, blockedIssueId);

    // Only update if currently open or in_progress (don't override other statuses)
    if (
      blockedIssue &&
      (blockedIssue.status === "open" || blockedIssue.status === "in_progress")
    ) {
      const updateStmt = db.prepare(`
        UPDATE issues
        SET status = 'blocked', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(blockedIssueId);
    }
  }
}

/**
 * Get a specific relationship
 */
export function getRelationship(
  db: Database.Database,
  from_id: string,
  from_type: EntityType,
  to_id: string,
  to_type: EntityType,
  relationship_type: RelationshipType
): Relationship | null {
  const stmt = db.prepare(`
    SELECT * FROM relationships
    WHERE from_id = ? AND from_type = ?
      AND to_id = ? AND to_type = ?
      AND relationship_type = ?
  `);

  return (
    (stmt.get(from_id, from_type, to_id, to_type, relationship_type) as
      | Relationship
      | undefined) ?? null
  );
}

/**
 * Remove a relationship
 */
export function removeRelationship(
  db: Database.Database,
  from_id: string,
  from_type: EntityType,
  to_id: string,
  to_type: EntityType,
  relationship_type: RelationshipType
): boolean {
  const stmt = db.prepare(`
    DELETE FROM relationships
    WHERE from_id = ? AND from_type = ?
      AND to_id = ? AND to_type = ?
      AND relationship_type = ?
  `);

  const result = stmt.run(
    from_id,
    from_type,
    to_id,
    to_type,
    relationship_type
  );
  const removed = result.changes > 0;

  // Auto-update blocked status when removing a 'blocks' or 'depends-on' relationship
  // Semantics:
  //   - blocks: from_id blocks to_id, so to_id is the one being unblocked
  //   - depends-on: from_id depends-on to_id, so from_id is the one being unblocked
  if (
    removed &&
    (relationship_type === "blocks" || relationship_type === "depends-on") &&
    from_type === "issue" &&
    to_type === "issue"
  ) {
    const unblockedId = relationship_type === "blocks" ? to_id : from_id;
    autoUpdateBlockedStatusOnRemove(db, unblockedId);
  }

  return removed;
}

/**
 * Auto-update blocked status when removing a 'blocks' relationship
 */
function autoUpdateBlockedStatusOnRemove(
  db: Database.Database,
  blockedIssueId: string
): void {
  const blockedIssue = getIssue(db, blockedIssueId);

  // Only unblock if currently blocked
  if (blockedIssue && blockedIssue.status === "blocked") {
    // Check if there are any other open blockers
    const hasOtherBlockers = hasOpenBlockers(db, blockedIssueId);

    // If no other blockers, unblock the issue
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
 * Check if an issue has any open blockers
 * Semantics:
 *   - blocks: blocker --[blocks]--> issueId (incoming blocks)
 *   - depends-on: issueId --[depends-on]--> blocker (outgoing depends-on)
 */
function hasOpenBlockers(db: Database.Database, issueId: string): boolean {
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
  `);

  const result = stmt.get(issueId, issueId) as { count: number };
  return result.count > 0;
}

/**
 * Get all outgoing relationships from an entity
 */
export function getOutgoingRelationships(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  relationship_type?: RelationshipType
): Relationship[] {
  let query = `
    SELECT * FROM relationships
    WHERE from_id = @entity_id AND from_type = @entity_type
  `;

  const params: Record<string, any> = {
    entity_id,
    entity_type,
  };

  if (relationship_type !== undefined) {
    query += " AND relationship_type = @relationship_type";
    params.relationship_type = relationship_type;
  }

  query += " ORDER BY created_at DESC";

  const stmt = db.prepare(query);
  return stmt.all(params) as Relationship[];
}

/**
 * Get all incoming relationships to an entity
 */
export function getIncomingRelationships(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  relationship_type?: RelationshipType
): Relationship[] {
  let query = `
    SELECT * FROM relationships
    WHERE to_id = @entity_id AND to_type = @entity_type
  `;

  const params: Record<string, any> = {
    entity_id,
    entity_type,
  };

  if (relationship_type !== undefined) {
    query += " AND relationship_type = @relationship_type";
    params.relationship_type = relationship_type;
  }

  query += " ORDER BY created_at DESC";

  const stmt = db.prepare(query);
  return stmt.all(params) as Relationship[];
}

/**
 * Get all dependencies (what this entity depends on - things that block it)
 */
export function getDependencies(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): Relationship[] {
  return getOutgoingRelationships(db, entity_id, entity_type, "blocks");
}

/**
 * Get all dependents (what depends on this entity - things it blocks)
 */
export function getDependents(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): Relationship[] {
  return getIncomingRelationships(db, entity_id, entity_type, "blocks");
}

/**
 * Get all relationships for an entity (both incoming and outgoing)
 */
export function getAllRelationships(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): { outgoing: Relationship[]; incoming: Relationship[] } {
  return {
    outgoing: getOutgoingRelationships(db, entity_id, entity_type),
    incoming: getIncomingRelationships(db, entity_id, entity_type),
  };
}

/**
 * Check if a relationship exists
 */
export function relationshipExists(
  db: Database.Database,
  from_id: string,
  from_type: EntityType,
  to_id: string,
  to_type: EntityType,
  relationship_type: RelationshipType
): boolean {
  const rel = getRelationship(
    db,
    from_id,
    from_type,
    to_id,
    to_type,
    relationship_type
  );
  return rel !== null;
}

/**
 * Remove all relationships for an entity
 */
export function removeAllRelationships(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): number {
  const stmt = db.prepare(`
    DELETE FROM relationships
    WHERE (from_id = ? AND from_type = ?)
       OR (to_id = ? AND to_type = ?)
  `);

  const result = stmt.run(entity_id, entity_type, entity_id, entity_type);
  return result.changes;
}
