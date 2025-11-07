/**
 * Cross-repository reference operations (CLI-side)
 *
 * Parses markdown content for cross-repo references and stores them in the database.
 * Does not fetch remote data (that's done by the server/background job).
 */

import type Database from "better-sqlite3";

export interface ParsedReference {
  fullMatch: string;
  repo: string;
  entityId: string;
  entityType: "issue" | "spec";
  displayText?: string;
}

/**
 * Parse cross-repo references from markdown content
 *
 * Supports formats:
 * - [[org/repo#issue-042]]
 * - [[github.com/org/repo#spec-123]]
 * - [[https://example.com/repo#issue-001]]
 * - [[org/repo#issue-042|Custom Display Text]]
 */
export function parseCrossRepoReferences(content: string): ParsedReference[] {
  const references: ParsedReference[] = [];

  // Pattern: [[repo#entity-id]] or [[repo#entity-id|display]]
  // Supports: org/repo, github.com/org/repo, https://example.com/repo
  const pattern = /\[\[([^\]#|]+)#((?:issue|spec)-[a-zA-Z0-9]+)(?:\|([^\]]+))?\]\]/g;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    const [fullMatch, repo, entityId, displayText] = match;

    // Determine entity type from ID prefix
    const entityType = entityId.startsWith("issue-") ? "issue" : "spec";

    references.push({
      fullMatch,
      repo: normalizeRepoUrl(repo),
      entityId,
      entityType,
      displayText,
    });
  }

  return references;
}

/**
 * Normalize repository URL to canonical form
 */
function normalizeRepoUrl(repo: string): string {
  // Remove protocol if present
  repo = repo.replace(/^https?:\/\//, "");

  // If it's just "org/repo", assume github.com
  if (repo.split("/").length === 2 && !repo.includes(".")) {
    return `github.com/${repo}`;
  }

  return repo;
}

/**
 * Update cross-repo references for an entity
 *
 * Parses content and stores references in the database.
 * This is called automatically by the file watcher when content changes.
 */
export function updateCrossRepoReferences(
  db: Database.Database,
  localEntityId: string,
  localEntityType: "issue" | "spec",
  content: string
): number {
  const parsed = parseCrossRepoReferences(content);

  // Get the UUID for the local entity
  const entityTable = localEntityType === "issue" ? "issues" : "specs";
  const entity = db.prepare(`SELECT uuid FROM ${entityTable} WHERE id = ?`).get(localEntityId) as any;

  if (!entity) {
    throw new Error(`${localEntityType} ${localEntityId} not found`);
  }

  const localUuid = entity.uuid;

  // Delete all existing references for this entity
  db.prepare(`
    DELETE FROM cross_repo_references
    WHERE local_uuid = ? AND local_entity_type = ?
  `).run(localUuid, localEntityType);

  const now = new Date().toISOString();
  let inserted = 0;

  // Insert new references
  const stmt = db.prepare(`
    INSERT INTO cross_repo_references (
      local_uuid, local_entity_type,
      remote_repo_url, remote_id, remote_entity_type,
      canonical_ref, relationship_type,
      created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const ref of parsed) {
    const canonicalRef = `${ref.repo}#${ref.entityId}`;

    stmt.run(
      localUuid,
      localEntityType,
      ref.repo,
      ref.entityId,
      ref.entityType,
      canonicalRef,
      "related",  // default relationship type
      now,
      "watcher"  // created_by
    );
    inserted++;
  }

  return inserted;
}

/**
 * Get all cross-repo references for an entity
 */
export function getCrossRepoReferences(
  db: Database.Database,
  localEntityId: string,
  localEntityType: "issue" | "spec"
): any[] {
  // Get the UUID for the local entity
  const entityTable = localEntityType === "issue" ? "issues" : "specs";
  const entity = db.prepare(`SELECT uuid FROM ${entityTable} WHERE id = ?`).get(localEntityId) as any;

  if (!entity) {
    return [];
  }

  const rows = db.prepare(`
    SELECT * FROM cross_repo_references
    WHERE local_uuid = ? AND local_entity_type = ?
    ORDER BY created_at DESC
  `).all(entity.uuid, localEntityType);

  return rows;
}

/**
 * Get all references to a specific remote repo
 */
export function getReferencesByRemoteRepo(
  db: Database.Database,
  remoteRepo: string
): any[] {
  const rows = db.prepare(`
    SELECT * FROM cross_repo_references
    WHERE remote_repo_url = ?
    ORDER BY created_at DESC
  `).all(remoteRepo);

  return rows;
}

/**
 * Delete all references to a remote repo
 * Useful when removing a remote repository
 */
export function deleteReferencesByRemoteRepo(
  db: Database.Database,
  remoteRepo: string
): number {
  const result = db.prepare(`
    DELETE FROM cross_repo_references
    WHERE remote_repo_url = ?
  `).run(remoteRepo);

  return result.changes;
}

/**
 * Check if content contains cross-repo references
 */
export function hasAnyReferences(content: string): boolean {
  return /\[\[[^\]#|]+#(?:issue|spec)-[a-zA-Z0-9]+/.test(content);
}
