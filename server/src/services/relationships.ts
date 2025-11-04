/**
 * Service layer for Relationships API
 * Wraps CLI operations for managing relationships between specs and issues
 */

import type Database from "better-sqlite3";
import type {
  Relationship,
  EntityType,
  RelationshipType,
} from "@sudocode-ai/types";
import {
  addRelationship,
  getRelationship,
  removeRelationship,
  getOutgoingRelationships,
  getIncomingRelationships,
  getAllRelationships,
  type CreateRelationshipInput,
} from "@sudocode-ai/cli/dist/operations/relationships.js";

/**
 * Create a new relationship between entities
 */
export function createRelationship(
  db: Database.Database,
  input: CreateRelationshipInput
): Relationship {
  return addRelationship(db, input);
}

/**
 * Get a specific relationship
 */
export function getSpecificRelationship(
  db: Database.Database,
  from_id: string,
  from_type: EntityType,
  to_id: string,
  to_type: EntityType,
  relationship_type: RelationshipType
): Relationship | null {
  return getRelationship(
    db,
    from_id,
    from_type,
    to_id,
    to_type,
    relationship_type
  );
}

/**
 * Delete a relationship
 */
export function deleteRelationship(
  db: Database.Database,
  from_id: string,
  from_type: EntityType,
  to_id: string,
  to_type: EntityType,
  relationship_type: RelationshipType
): boolean {
  return removeRelationship(
    db,
    from_id,
    from_type,
    to_id,
    to_type,
    relationship_type
  );
}

/**
 * Get all outgoing relationships from an entity
 */
export function getEntityOutgoingRelationships(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  relationship_type?: RelationshipType
): Relationship[] {
  return getOutgoingRelationships(
    db,
    entity_id,
    entity_type,
    relationship_type
  );
}

/**
 * Get all incoming relationships to an entity
 */
export function getEntityIncomingRelationships(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  relationship_type?: RelationshipType
): Relationship[] {
  return getIncomingRelationships(
    db,
    entity_id,
    entity_type,
    relationship_type
  );
}

/**
 * Get all relationships for an entity (both incoming and outgoing)
 */
export function getEntityRelationships(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): { outgoing: Relationship[]; incoming: Relationship[] } {
  return getAllRelationships(db, entity_id, entity_type);
}
