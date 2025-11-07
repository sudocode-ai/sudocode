/**
 * Remote Repository Management Service
 * Handles CRUD operations for remote repositories
 */

import Database from "better-sqlite3";
import type { RemoteRepo, TrustLevel } from "../types/federation.js";

/**
 * Add a new remote repository
 */
export function addRemoteRepo(
  db: Database.Database,
  repo: Omit<RemoteRepo, "added_at" | "last_synced_at" | "sync_status">
): RemoteRepo {
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO remote_repos (
      url, display_name, description, trust_level,
      capabilities, rest_endpoint, ws_endpoint, git_url,
      added_at, added_by, auto_sync, sync_interval_minutes,
      sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    repo.url,
    repo.display_name,
    repo.description || null,
    repo.trust_level,
    repo.capabilities || null,
    repo.rest_endpoint || null,
    repo.ws_endpoint || null,
    repo.git_url || null,
    now,
    repo.added_by,
    repo.auto_sync ? 1 : 0,
    repo.sync_interval_minutes,
    "unknown"
  );

  return getRemoteRepo(db, repo.url)!;
}

/**
 * Get a remote repository by URL
 */
export function getRemoteRepo(
  db: Database.Database,
  url: string
): RemoteRepo | undefined {
  const repo = db
    .prepare<[string]>(
      `
    SELECT * FROM remote_repos WHERE url = ?
  `
    )
    .get(url) as any;

  if (!repo) return undefined;

  return {
    ...repo,
    auto_sync: Boolean(repo.auto_sync),
  };
}

/**
 * List all remote repositories
 */
export function listRemoteRepos(
  db: Database.Database,
  filters?: {
    trust_level?: TrustLevel;
    sync_status?: string;
  }
): RemoteRepo[] {
  let query = "SELECT * FROM remote_repos";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.trust_level) {
    conditions.push("trust_level = ?");
    params.push(filters.trust_level);
  }

  if (filters?.sync_status) {
    conditions.push("sync_status = ?");
    params.push(filters.sync_status);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY added_at DESC";

  const repos = db.prepare<any[]>(query).all(...params) as any[];

  return repos.map((repo) => ({
    ...repo,
    auto_sync: Boolean(repo.auto_sync),
  }));
}

/**
 * Update a remote repository
 */
export function updateRemoteRepo(
  db: Database.Database,
  url: string,
  updates: Partial<
    Omit<RemoteRepo, "url" | "added_at" | "added_by">
  >
): RemoteRepo | undefined {
  const existing = getRemoteRepo(db, url);
  if (!existing) {
    throw new Error(`Remote repository ${url} not found`);
  }

  const fields: string[] = [];
  const params: any[] = [];

  if (updates.display_name !== undefined) {
    fields.push("display_name = ?");
    params.push(updates.display_name);
  }

  if (updates.description !== undefined) {
    fields.push("description = ?");
    params.push(updates.description);
  }

  if (updates.trust_level !== undefined) {
    fields.push("trust_level = ?");
    params.push(updates.trust_level);
  }

  if (updates.capabilities !== undefined) {
    fields.push("capabilities = ?");
    params.push(updates.capabilities);
  }

  if (updates.rest_endpoint !== undefined) {
    fields.push("rest_endpoint = ?");
    params.push(updates.rest_endpoint);
  }

  if (updates.ws_endpoint !== undefined) {
    fields.push("ws_endpoint = ?");
    params.push(updates.ws_endpoint);
  }

  if (updates.git_url !== undefined) {
    fields.push("git_url = ?");
    params.push(updates.git_url);
  }

  if (updates.auto_sync !== undefined) {
    fields.push("auto_sync = ?");
    params.push(updates.auto_sync ? 1 : 0);
  }

  if (updates.sync_interval_minutes !== undefined) {
    fields.push("sync_interval_minutes = ?");
    params.push(updates.sync_interval_minutes);
  }

  if (updates.sync_status !== undefined) {
    fields.push("sync_status = ?");
    params.push(updates.sync_status);
  }

  if (updates.last_synced_at !== undefined) {
    fields.push("last_synced_at = ?");
    params.push(updates.last_synced_at);
  }

  if (fields.length === 0) {
    return existing;
  }

  params.push(url);

  db.prepare(
    `
    UPDATE remote_repos
    SET ${fields.join(", ")}
    WHERE url = ?
  `
  ).run(...params);

  return getRemoteRepo(db, url);
}

/**
 * Remove a remote repository
 */
export function removeRemoteRepo(
  db: Database.Database,
  url: string
): boolean {
  const result = db
    .prepare<[string]>(
      `
    DELETE FROM remote_repos WHERE url = ?
  `
    )
    .run(url);

  return result.changes > 0;
}

/**
 * Check if remote repo exists
 */
export function remoteRepoExists(
  db: Database.Database,
  url: string
): boolean {
  const count = db
    .prepare<[string]>(
      `
    SELECT COUNT(*) as count FROM remote_repos WHERE url = ?
  `
    )
    .get(url) as { count: number };

  return count.count > 0;
}
