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
 * All migrations in order
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "generalize-feedback-table",
    up: (db: Database.Database) => {
      // Check if old columns exist
      const tableInfo = db.pragma("table_info(issue_feedback)") as Array<{
        name: string;
      }>;
      const hasOldColumns = tableInfo.some((col) => col.name === "issue_id");

      if (!hasOldColumns) {
        // Already migrated or new database
        return;
      }

      // Create new table with updated schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback_new (
          id TEXT PRIMARY KEY,
          from_id TEXT NOT NULL,
          from_uuid TEXT NOT NULL,
          to_id TEXT NOT NULL,
          to_uuid TEXT NOT NULL,
          feedback_type TEXT NOT NULL CHECK(feedback_type IN ('comment', 'suggestion', 'request')),
          content TEXT NOT NULL,
          agent TEXT,
          anchor TEXT,
          dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (from_id) REFERENCES issues(id) ON DELETE CASCADE,
          FOREIGN KEY (from_uuid) REFERENCES issues(uuid) ON DELETE CASCADE
        );
      `);

      // Copy data from old table to new table
      db.exec(`
        INSERT INTO issue_feedback_new (
          id, from_id, from_uuid, to_id, to_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        )
        SELECT
          id, issue_id, issue_uuid, spec_id, spec_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        FROM issue_feedback;
      `);

      // Drop old table
      db.exec(`DROP TABLE issue_feedback;`);

      // Rename new table to original name
      db.exec(`ALTER TABLE issue_feedback_new RENAME TO issue_feedback;`);

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_feedback_from_id ON issue_feedback(from_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_from_uuid ON issue_feedback(from_uuid);
        CREATE INDEX IF NOT EXISTS idx_feedback_to_id ON issue_feedback(to_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_to_uuid ON issue_feedback(to_uuid);
        CREATE INDEX IF NOT EXISTS idx_feedback_dismissed ON issue_feedback(dismissed);
        CREATE INDEX IF NOT EXISTS idx_feedback_type ON issue_feedback(feedback_type);
        CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON issue_feedback(created_at);
      `);
    },
    down: (db: Database.Database) => {
      // Rollback: rename columns back
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback_old (
          id TEXT PRIMARY KEY,
          issue_id TEXT NOT NULL,
          issue_uuid TEXT NOT NULL,
          spec_id TEXT NOT NULL,
          spec_uuid TEXT NOT NULL,
          feedback_type TEXT NOT NULL CHECK(feedback_type IN ('comment', 'suggestion', 'request')),
          content TEXT NOT NULL,
          agent TEXT,
          anchor TEXT,
          dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
          FOREIGN KEY (issue_uuid) REFERENCES issues(uuid) ON DELETE CASCADE,
          FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE,
          FOREIGN KEY (spec_uuid) REFERENCES specs(uuid) ON DELETE CASCADE
        );
      `);

      db.exec(`
        INSERT INTO issue_feedback_old (
          id, issue_id, issue_uuid, spec_id, spec_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        )
        SELECT
          id, from_id, from_uuid, to_id, to_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        FROM issue_feedback;
      `);

      db.exec(`DROP TABLE issue_feedback;`);
      db.exec(`ALTER TABLE issue_feedback_old RENAME TO issue_feedback;`);
    },
  },
];

/**
 * Get the current migration version from the database
 */
export function getCurrentMigrationVersion(db: Database.Database): number {
  // Create migrations table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const stmt = db.prepare("SELECT MAX(version) as version FROM migrations");
  const result = stmt.get() as { version: number | null };
  return result.version ?? 0;
}

/**
 * Record a migration as applied
 */
export function recordMigration(
  db: Database.Database,
  migration: Migration
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO migrations (version, name)
    VALUES (?, ?)
  `);
  stmt.run(migration.version, migration.name);
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = getCurrentMigrationVersion(db);

  const pendingMigrations = MIGRATIONS.filter(
    (m) => m.version > currentVersion
  );

  if (pendingMigrations.length === 0) {
    return;
  }

  console.log(`Running ${pendingMigrations.length} pending migration(s)...`);

  for (const migration of pendingMigrations) {
    console.log(`  Applying migration ${migration.version}: ${migration.name}`);
    try {
      migration.up(db);
      recordMigration(db, migration);
      console.log(`  ✓ Migration ${migration.version} applied successfully`);
    } catch (error) {
      console.error(`  ✗ Migration ${migration.version} failed:`, error);
      throw error;
    }
  }
}
