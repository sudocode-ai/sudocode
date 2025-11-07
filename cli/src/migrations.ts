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
    name: "add_completion_summary_columns",
    up: (db: Database.Database) => {
      // Check if columns already exist before adding them
      const specsInfo = db.pragma("table_info(specs)") as Array<{
        name: string;
      }>;
      const issuesInfo = db.pragma("table_info(issues)") as Array<{
        name: string;
      }>;

      const hasSpecsColumn = specsInfo.some(
        (col) => col.name === "completion_summary"
      );
      const hasIssuesColumn = issuesInfo.some(
        (col) => col.name === "completion_summary"
      );

      if (!hasSpecsColumn) {
        db.exec("ALTER TABLE specs ADD COLUMN completion_summary TEXT");
      }

      if (!hasIssuesColumn) {
        db.exec("ALTER TABLE issues ADD COLUMN completion_summary TEXT");
      }
    },
    down: (db: Database.Database) => {
      // SQLite doesn't support DROP COLUMN easily, so we'd need to recreate tables
      // For now, we'll leave the columns in place if we ever need to rollback
      console.log(
        "Note: SQLite doesn't support dropping columns. completion_summary columns will remain."
      );
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
