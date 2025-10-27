/**
 * Database migration utilities for sudocode
 */

import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

/**
 * Migration 001: Remove description field and migrate to content
 *
 * This migration removes the description field entirely,
 * merging any existing descriptions into the content field.
 */
export const migration_001_remove_description: Migration = {
  version: 1,
  name: "remove_description",
  up: (db: Database.Database) => {
    // SQLite doesn't support ALTER TABLE DROP COLUMN, so we recreate the table
    db.exec(`
      -- Start transaction
      BEGIN;

      -- Create a new table without the description column
      CREATE TABLE IF NOT EXISTS issues_new (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL CHECK(length(title) <= 500),
          content TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),
          assignee TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          parent_id TEXT,
          FOREIGN KEY (parent_id) REFERENCES issues(id) ON DELETE SET NULL
      );

      -- Copy data from old table to new table
      -- Merge description into content during migration
      INSERT INTO issues_new (
          id, uuid, title, content, status, priority, assignee,
          created_at, updated_at, closed_at, parent_id
      )
      SELECT
          id,
          uuid,
          title,
          CASE
              -- If content is empty or just whitespace, use description
              WHEN TRIM(COALESCE(content, '')) = '' AND TRIM(COALESCE(description, '')) != '' THEN description
              -- If description exists and content exists, merge them
              WHEN TRIM(COALESCE(description, '')) != '' AND TRIM(COALESCE(content, '')) != '' THEN
                  '# Description' || CHAR(10) || CHAR(10) || description || CHAR(10) || CHAR(10) || '# Details' || CHAR(10) || CHAR(10) || content
              -- Otherwise just use content
              ELSE COALESCE(content, '')
          END as content,
          status,
          priority,
          assignee,
          created_at,
          updated_at,
          closed_at,
          parent_id
      FROM issues;

      -- Drop the old table
      DROP TABLE issues;

      -- Rename the new table to the original name
      ALTER TABLE issues_new RENAME TO issues;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
      CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
      CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee);
      CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
      CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at);
      CREATE INDEX IF NOT EXISTS idx_issues_updated_at ON issues(updated_at);
      CREATE INDEX IF NOT EXISTS idx_issues_closed_at ON issues(closed_at);

      -- Commit transaction
      COMMIT;
    `);

    console.log("✓ Removed description field and migrated data to content");
  },
  down: (db: Database.Database) => {
    // Rollback is not possible since we've merged and deleted data
    console.warn("Warning: Cannot rollback description removal migration");
  },
};

/**
 * Get the current migration version from the database
 */
export function getCurrentMigrationVersion(db: Database.Database): number {
  // Check if migrations table exists
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
    )
    .get();

  if (!tableExists) {
    // Create migrations table
    db.exec(`
      CREATE TABLE migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    return 0;
  }

  // Get the latest migration version
  const result = db
    .prepare("SELECT MAX(version) as version FROM migrations")
    .get() as { version: number | null };

  return result.version || 0;
}

/**
 * Record a migration as applied
 */
export function recordMigration(
  db: Database.Database,
  migration: Migration
): void {
  db.prepare(
    "INSERT INTO migrations (version, name) VALUES (?, ?)"
  ).run(migration.version, migration.name);
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = getCurrentMigrationVersion(db);
  const migrations = [migration_001_remove_description];

  const pendingMigrations = migrations.filter(
    (m) => m.version > currentVersion
  );

  if (pendingMigrations.length === 0) {
    console.log("✓ Database is up to date");
    return;
  }

  console.log(
    `Running ${pendingMigrations.length} pending migration(s)...`
  );

  for (const migration of pendingMigrations) {
    try {
      console.log(`Running migration ${migration.version}: ${migration.name}`);
      migration.up(db);
      recordMigration(db, migration);
      console.log(`✓ Migration ${migration.version} completed`);
    } catch (error) {
      console.error(`✗ Migration ${migration.version} failed:`, error);
      throw error;
    }
  }

  console.log("✓ All migrations completed successfully");
}
