/**
 * Operations for Relationships
 */

import type Database from 'better-sqlite3';
import type { Relationship, EntityType, RelationshipType } from '../types.js';

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
  // Check if from_id exists
  const fromTable = input.from_type === 'spec' ? 'specs' : 'issues';
  const fromExists = db.prepare(`SELECT 1 FROM ${fromTable} WHERE id = ?`).get(input.from_id);
  if (!fromExists) {
    throw new Error(`${input.from_type === 'spec' ? 'Spec' : 'Issue'} not found: ${input.from_id}`);
  }

  // Check if to_id exists
  const toTable = input.to_type === 'spec' ? 'specs' : 'issues';
  const toExists = db.prepare(`SELECT 1 FROM ${toTable} WHERE id = ?`).get(input.to_id);
  if (!toExists) {
    throw new Error(`${input.to_type === 'spec' ? 'Spec' : 'Issue'} not found: ${input.to_id}`);
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
    throw new Error(
      `Relationship already exists: ${input.from_id} (${input.from_type}) --[${input.relationship_type}]--> ${input.to_id} (${input.to_type})`
    );
  }

  const stmt = db.prepare(`
    INSERT INTO relationships (
      from_id, from_type, to_id, to_type, relationship_type, metadata
    ) VALUES (
      @from_id, @from_type, @to_id, @to_type, @relationship_type, @metadata
    )
  `);

  try {
    stmt.run({
      from_id: input.from_id,
      from_type: input.from_type,
      to_id: input.to_id,
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
      throw new Error('Failed to create relationship');
    }

    return rel;
  } catch (error: any) {
    if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
      throw new Error(
        `Relationship already exists: ${input.from_id} (${input.from_type}) --[${input.relationship_type}]--> ${input.to_id} (${input.to_type})`
      );
    }
    throw error;
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

  return (stmt.get(from_id, from_type, to_id, to_type, relationship_type) as Relationship | undefined) ?? null;
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

  const result = stmt.run(from_id, from_type, to_id, to_type, relationship_type);
  return result.changes > 0;
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
    query += ' AND relationship_type = @relationship_type';
    params.relationship_type = relationship_type;
  }

  query += ' ORDER BY created_at DESC';

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
    query += ' AND relationship_type = @relationship_type';
    params.relationship_type = relationship_type;
  }

  query += ' ORDER BY created_at DESC';

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
  return getOutgoingRelationships(db, entity_id, entity_type, 'blocks');
}

/**
 * Get all dependents (what depends on this entity - things it blocks)
 */
export function getDependents(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): Relationship[] {
  return getIncomingRelationships(db, entity_id, entity_type, 'blocks');
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
  const rel = getRelationship(db, from_id, from_type, to_id, to_type, relationship_type);
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
