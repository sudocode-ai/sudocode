/**
 * Operations for Events (audit trail)
 */

import type Database from 'better-sqlite3';
import type { Event, EntityType, EventType } from '../types.js';

export interface CreateEventInput {
  entity_id: string;
  entity_type: EntityType;
  event_type: EventType;
  actor: string;
  old_value?: string | null;
  new_value?: string | null;
  comment?: string | null;
  git_commit_sha?: string | null;
  source?: string;
}

export interface QueryEventsOptions {
  entity_id?: string;
  entity_type?: EntityType;
  event_type?: EventType;
  actor?: string;
  limit?: number;
  offset?: number;
}

/**
 * Insert an event
 */
export function insertEvent(
  db: Database.Database,
  input: CreateEventInput
): Event {
  const stmt = db.prepare(`
    INSERT INTO events (
      entity_id, entity_type, event_type, actor,
      old_value, new_value, comment, git_commit_sha, source
    ) VALUES (
      @entity_id, @entity_type, @event_type, @actor,
      @old_value, @new_value, @comment, @git_commit_sha, @source
    )
  `);

  const result = stmt.run({
    entity_id: input.entity_id,
    entity_type: input.entity_type,
    event_type: input.event_type,
    actor: input.actor,
    old_value: input.old_value || null,
    new_value: input.new_value || null,
    comment: input.comment || null,
    git_commit_sha: input.git_commit_sha || null,
    source: input.source || null,
  });

  const event = getEvent(db, Number(result.lastInsertRowid));
  if (!event) {
    throw new Error('Failed to create event');
  }

  return event;
}

/**
 * Get an event by ID
 */
export function getEvent(db: Database.Database, id: number): Event | null {
  const stmt = db.prepare('SELECT * FROM events WHERE id = ?');
  return (stmt.get(id) as Event | undefined) ?? null;
}

/**
 * Query events with filters
 */
export function queryEvents(
  db: Database.Database,
  options: QueryEventsOptions = {}
): Event[] {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (options.entity_id !== undefined) {
    conditions.push('entity_id = @entity_id');
    params.entity_id = options.entity_id;
  }
  if (options.entity_type !== undefined) {
    conditions.push('entity_type = @entity_type');
    params.entity_type = options.entity_type;
  }
  if (options.event_type !== undefined) {
    conditions.push('event_type = @event_type');
    params.event_type = options.event_type;
  }
  if (options.actor !== undefined) {
    conditions.push('actor = @actor');
    params.actor = options.actor;
  }

  let query = 'SELECT * FROM events';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC';

  if (options.limit !== undefined) {
    query += ' LIMIT @limit';
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    query += ' OFFSET @offset';
    params.offset = options.offset;
  }

  const stmt = db.prepare(query);
  return stmt.all(params) as Event[];
}

/**
 * Get all events for a specific entity
 */
export function getEntityEvents(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType,
  limit?: number
): Event[] {
  return queryEvents(db, { entity_id, entity_type, limit });
}

/**
 * Get recent events across all entities
 */
export function getRecentEvents(
  db: Database.Database,
  limit: number = 50
): Event[] {
  return queryEvents(db, { limit });
}

/**
 * Get events by actor
 */
export function getEventsByActor(
  db: Database.Database,
  actor: string,
  limit?: number
): Event[] {
  return queryEvents(db, { actor, limit });
}

/**
 * Delete events for an entity (cleanup)
 */
export function deleteEntityEvents(
  db: Database.Database,
  entity_id: string,
  entity_type: EntityType
): number {
  const stmt = db.prepare(`
    DELETE FROM events
    WHERE entity_id = ? AND entity_type = ?
  `);

  const result = stmt.run(entity_id, entity_type);
  return result.changes;
}
