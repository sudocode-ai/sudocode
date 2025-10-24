/**
 * Database service for sudocode server
 * Extends CLI schema with server-specific tables
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

/**
 * Server-specific table schemas
 */

export const EXECUTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    target_branch TEXT NOT NULL,
    worktree_path TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
`;

/**
 * Indexes for server tables
 */
export const SERVER_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_executions_issue ON executions(issue_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at);
`;

/**
 * Database configuration
 */
export interface DatabaseConfig {
  path: string;
  readOnly?: boolean;
}

/**
 * Initialize database with CLI schema + server extensions
 */
export function initDatabase(config: DatabaseConfig): Database.Database {
  const { path: dbPath, readOnly = false } = config;

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Open database
  const db = new Database(dbPath, {
    readonly: readOnly,
    fileMustExist: false,
  });

  // Don't modify schema if read-only
  if (readOnly) {
    return db;
  }

  // Configure database
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");

  // Create server-specific tables
  db.exec(EXECUTIONS_TABLE);

  // Create indexes
  db.exec(SERVER_INDEXES);

  return db;
}

/**
 * Check if database has CLI tables
 */
export function hasCliTables(db: Database.Database): boolean {
  const result = db
    .prepare(
      `
    SELECT COUNT(*) as count
    FROM sqlite_master
    WHERE type='table'
    AND name IN ('specs', 'issues', 'relationships', 'tags')
  `
    )
    .get() as { count: number };

  return result.count === 4;
}

/**
 * Get database info
 */
export function getDatabaseInfo(db: Database.Database) {
  const tables = db
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type='table'
    ORDER BY name
  `
    )
    .all() as { name: string }[];

  const version = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };

  return {
    tables: tables.map((t) => t.name),
    version: version.user_version,
    hasCliTables: hasCliTables(db),
  };
}

/**
 * Close database connection
 */
export function closeDatabase(db: Database.Database): void {
  db.close();
}
