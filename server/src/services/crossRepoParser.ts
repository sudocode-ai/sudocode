/**
 * Cross-repository reference parser
 *
 * Parses markdown content for cross-repo references like:
 * - [[org/repo#issue-042]]
 * - [[github.com/org/repo#spec-123]]
 * - [[https://example.com/repo#issue-001]]
 *
 * Extracts references, fetches remote entity data, and caches locally.
 */

import type Database from "better-sqlite3";
import axios from "axios";

export interface CrossRepoReference {
  local_entity_id: string;
  local_entity_type: "issue" | "spec";
  remote_repo: string;
  remote_entity_id: string;
  remote_entity_type: "issue" | "spec";
  remote_entity_uuid?: string;
  display_text?: string;
  cached_title?: string;
  cached_status?: string;
  cached_at?: string;
  created_at: string;
}

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
 *
 * Examples:
 * - "org/repo" -> "github.com/org/repo"
 * - "github.com/org/repo" -> "github.com/org/repo"
 * - "https://example.com/repo" -> "example.com/repo"
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
 * Store cross-repo reference in database
 */
export function storeCrossRepoReference(
  db: Database.Database,
  ref: Omit<CrossRepoReference, "created_at">
): void {
  const now = new Date().toISOString();

  // Check if reference already exists
  const existing = db.prepare(`
    SELECT * FROM cross_repo_references
    WHERE local_entity_id = ? AND local_entity_type = ?
      AND remote_repo = ? AND remote_entity_id = ?
  `).get(
    ref.local_entity_id,
    ref.local_entity_type,
    ref.remote_repo,
    ref.remote_entity_id
  );

  if (existing) {
    // Update existing reference
    db.prepare(`
      UPDATE cross_repo_references
      SET display_text = ?,
          cached_title = ?,
          cached_status = ?,
          cached_at = ?
      WHERE local_entity_id = ? AND local_entity_type = ?
        AND remote_repo = ? AND remote_entity_id = ?
    `).run(
      ref.display_text || null,
      ref.cached_title || null,
      ref.cached_status || null,
      ref.cached_at || null,
      ref.local_entity_id,
      ref.local_entity_type,
      ref.remote_repo,
      ref.remote_entity_id
    );
  } else {
    // Insert new reference
    db.prepare(`
      INSERT INTO cross_repo_references (
        local_entity_id, local_entity_type,
        remote_repo, remote_entity_id, remote_entity_type, remote_entity_uuid,
        display_text, cached_title, cached_status, cached_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ref.local_entity_id,
      ref.local_entity_type,
      ref.remote_repo,
      ref.remote_entity_id,
      ref.remote_entity_type,
      ref.remote_entity_uuid || null,
      ref.display_text || null,
      ref.cached_title || null,
      ref.cached_status || null,
      ref.cached_at || null,
      now
    );
  }
}

/**
 * Fetch remote entity data and cache it
 */
export async function fetchAndCacheRemoteEntity(
  db: Database.Database,
  remoteRepo: string,
  entityId: string,
  entityType: "issue" | "spec"
): Promise<{ title: string; status: string; uuid?: string } | null> {
  try {
    // Get remote repo REST endpoint
    const remote = db.prepare(`
      SELECT rest_endpoint FROM remote_repos WHERE url = ?
    `).get(remoteRepo) as any;

    if (!remote || !remote.rest_endpoint) {
      console.warn(`No REST endpoint configured for remote: ${remoteRepo}`);
      return null;
    }

    // Query remote for entity data
    const response = await axios.post(
      `${remote.rest_endpoint}/federation/query`,
      {
        type: "query",
        from: "local",
        to: remoteRepo,
        timestamp: new Date().toISOString(),
        query: {
          entity: entityType,
          filters: { id: entityId },
          limit: 1,
        },
      },
      {
        timeout: 5000,
      }
    );

    const results = response.data.results;
    if (results && results.length > 0) {
      const entity = results[0];
      return {
        title: entity.title,
        status: entity.status,
        uuid: entity.uuid,
      };
    }

    return null;
  } catch (error) {
    console.warn(`Failed to fetch remote entity ${entityId} from ${remoteRepo}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Process cross-repo references in an entity's content
 *
 * Parses content, stores references, and optionally fetches remote data
 */
export async function processCrossRepoReferences(
  db: Database.Database,
  localEntityId: string,
  localEntityType: "issue" | "spec",
  content: string,
  fetchRemote: boolean = true
): Promise<CrossRepoReference[]> {
  const parsed = parseCrossRepoReferences(content);
  const references: CrossRepoReference[] = [];

  // First, delete all existing references for this entity
  db.prepare(`
    DELETE FROM cross_repo_references
    WHERE local_entity_id = ? AND local_entity_type = ?
  `).run(localEntityId, localEntityType);

  // Process each reference
  for (const ref of parsed) {
    let cachedData: { title: string; status: string; uuid?: string } | null = null;

    if (fetchRemote) {
      cachedData = await fetchAndCacheRemoteEntity(
        db,
        ref.repo,
        ref.entityId,
        ref.entityType
      );
    }

    const crossRepoRef: Omit<CrossRepoReference, "created_at"> = {
      local_entity_id: localEntityId,
      local_entity_type: localEntityType,
      remote_repo: ref.repo,
      remote_entity_id: ref.entityId,
      remote_entity_type: ref.entityType,
      remote_entity_uuid: cachedData?.uuid,
      display_text: ref.displayText,
      cached_title: cachedData?.title,
      cached_status: cachedData?.status,
      cached_at: cachedData ? new Date().toISOString() : undefined,
    };

    storeCrossRepoReference(db, crossRepoRef);
    references.push({
      ...crossRepoRef,
      created_at: new Date().toISOString(),
    });
  }

  return references;
}

/**
 * Get all cross-repo references for an entity
 */
export function getCrossRepoReferences(
  db: Database.Database,
  localEntityId: string,
  localEntityType: "issue" | "spec"
): CrossRepoReference[] {
  const rows = db.prepare(`
    SELECT * FROM cross_repo_references
    WHERE local_entity_id = ? AND local_entity_type = ?
    ORDER BY created_at DESC
  `).all(localEntityId, localEntityType) as any[];

  return rows;
}

/**
 * Refresh cached data for all references to a remote repo
 */
export async function refreshRemoteRepoCache(
  db: Database.Database,
  remoteRepo: string
): Promise<number> {
  const refs = db.prepare(`
    SELECT * FROM cross_repo_references
    WHERE remote_repo = ?
  `).all(remoteRepo) as any[];

  let refreshed = 0;

  for (const ref of refs) {
    const cachedData = await fetchAndCacheRemoteEntity(
      db,
      ref.remote_repo,
      ref.remote_entity_id,
      ref.remote_entity_type
    );

    if (cachedData) {
      db.prepare(`
        UPDATE cross_repo_references
        SET cached_title = ?,
            cached_status = ?,
            cached_at = ?,
            remote_entity_uuid = ?
        WHERE local_entity_id = ? AND local_entity_type = ?
          AND remote_repo = ? AND remote_entity_id = ?
      `).run(
        cachedData.title,
        cachedData.status,
        new Date().toISOString(),
        cachedData.uuid || null,
        ref.local_entity_id,
        ref.local_entity_type,
        ref.remote_repo,
        ref.remote_entity_id
      );
      refreshed++;
    }
  }

  return refreshed;
}

/**
 * Get stale references (not cached recently)
 */
export function getStaleReferences(
  db: Database.Database,
  maxAgeMinutes: number = 60
): CrossRepoReference[] {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT * FROM cross_repo_references
    WHERE cached_at IS NULL OR cached_at < ?
    ORDER BY cached_at ASC
  `).all(cutoff) as any[];

  return rows;
}
