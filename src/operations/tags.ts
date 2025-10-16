/**
 * Operations for Tags
 */

import type Database from 'better-sqlite3';
import type { Tag, EntityType } from '../types.js';

/**
 * Add a tag to an entity
 */
export function addTag(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  tag: string
): Tag {
  const stmt = db.prepare(`
    INSERT INTO tags (entity_id, entity_type, tag)
    VALUES (@entity_id, @entity_type, @tag)
  `);

  try {
    stmt.run({ entity_id, entity_type, tag });

    return { entity_id, entity_type, tag };
  } catch (error: any) {
    if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
      // Tag already exists, return it
      return { entity_id, entity_type, tag };
    }
    throw error;
  }
}

/**
 * Add multiple tags to an entity
 */
export function addTags(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  tags: string[]
): Tag[] {
  const results: Tag[] = [];

  for (const tag of tags) {
    results.push(addTag(db, entity_id, entity_type, tag));
  }

  return results;
}

/**
 * Remove a tag from an entity
 */
export function removeTag(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  tag: string
): boolean {
  const stmt = db.prepare(`
    DELETE FROM tags
    WHERE entity_id = ? AND entity_type = ? AND tag = ?
  `);

  const result = stmt.run(entity_id, entity_type, tag);
  return result.changes > 0;
}

/**
 * Get all tags for an entity
 */
export function getTags(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): string[] {
  const stmt = db.prepare(`
    SELECT tag FROM tags
    WHERE entity_id = ? AND entity_type = ?
    ORDER BY tag
  `);

  const rows = stmt.all(entity_id, entity_type) as Array<{ tag: string }>;
  return rows.map((row) => row.tag);
}

/**
 * Get all entities with a specific tag
 */
export function getEntitiesByTag(
  db: Database.Database,
  tag: string,
  entity_type?: EntityType
): Tag[] {
  let query = 'SELECT * FROM tags WHERE tag = @tag';
  const params: Record<string, any> = { tag };

  if (entity_type !== undefined) {
    query += ' AND entity_type = @entity_type';
    params.entity_type = entity_type;
  }

  query += ' ORDER BY entity_id';

  const stmt = db.prepare(query);
  return stmt.all(params) as Tag[];
}

/**
 * Remove all tags from an entity
 */
export function removeAllTags(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): number {
  const stmt = db.prepare(`
    DELETE FROM tags
    WHERE entity_id = ? AND entity_type = ?
  `);

  const result = stmt.run(entity_id, entity_type);
  return result.changes;
}

/**
 * Check if an entity has a specific tag
 */
export function hasTag(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  tag: string
): boolean {
  const stmt = db.prepare(`
    SELECT 1 FROM tags
    WHERE entity_id = ? AND entity_type = ? AND tag = ?
  `);

  return stmt.get(entity_id, entity_type, tag) !== undefined;
}

/**
 * Get all unique tags in the system
 */
export function getAllTags(
  db: Database.Database,
  entity_type?: EntityType
): string[] {
  let query = 'SELECT DISTINCT tag FROM tags';
  const params: Record<string, any> = {};

  if (entity_type !== undefined) {
    query += ' WHERE entity_type = @entity_type';
    params.entity_type = entity_type;
  }

  query += ' ORDER BY tag';

  const stmt = db.prepare(query);
  const rows = stmt.all(params) as Array<{ tag: string }>;
  return rows.map((row) => row.tag);
}

/**
 * Replace all tags for an entity
 */
export function setTags(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  tags: string[]
): string[] {
  // Remove existing tags
  removeAllTags(db, entity_id, entity_type);

  // Add new tags
  if (tags.length > 0) {
    addTags(db, entity_id, entity_type, tags);
  }

  return tags;
}
