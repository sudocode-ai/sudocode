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
  name: "remove_description_field",
  up: (db: Database.Database) => {
    // This migration was applied in the past
    // Kept for historical reference
  },
};

/**
 * Migration 002: Make agent and anchor nullable in issue_feedback
 *
 * This migration updates the issue_feedback table to allow NULL values
 * for agent and anchor fields, aligning with the optional type definitions.
 */
export const migration_002_nullable_feedback_fields: Migration = {
  version: 2,
  name: "nullable_feedback_fields",
  up: (db: Database.Database) => {
    // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
    db.exec(`
      BEGIN TRANSACTION;

      -- Create new table with nullable agent and anchor
      CREATE TABLE IF NOT EXISTS issue_feedback_new (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        spec_id TEXT NOT NULL,
        feedback_type TEXT NOT NULL CHECK(feedback_type IN ('comment', 'suggestion', 'request')),
        content TEXT NOT NULL,
        agent TEXT,
        anchor TEXT,
        dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
        FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
      );

      -- Copy data from old table to new table
      INSERT INTO issue_feedback_new
      SELECT * FROM issue_feedback;

      -- Drop old table
      DROP TABLE issue_feedback;

      -- Rename new table to original name
      ALTER TABLE issue_feedback_new RENAME TO issue_feedback;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_feedback_issue ON issue_feedback(issue_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_spec ON issue_feedback(spec_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_dismissed ON issue_feedback(dismissed);
      CREATE INDEX IF NOT EXISTS idx_feedback_type ON issue_feedback(feedback_type);
      CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON issue_feedback(created_at);

      COMMIT;
    `);
  },
  down: (db: Database.Database) => {
    // Rollback: make agent and anchor NOT NULL again
    db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE IF NOT EXISTS issue_feedback_old (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        spec_id TEXT NOT NULL,
        feedback_type TEXT NOT NULL CHECK(feedback_type IN ('comment', 'suggestion', 'request')),
        content TEXT NOT NULL,
        agent TEXT NOT NULL,
        anchor TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
        FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
      );

      -- Copy data (this will fail if there are NULL values)
      INSERT INTO issue_feedback_old
      SELECT * FROM issue_feedback;

      DROP TABLE issue_feedback;
      ALTER TABLE issue_feedback_old RENAME TO issue_feedback;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_feedback_issue ON issue_feedback(issue_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_spec ON issue_feedback(spec_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_dismissed ON issue_feedback(dismissed);
      CREATE INDEX IF NOT EXISTS idx_feedback_type ON issue_feedback(feedback_type);
      CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON issue_feedback(created_at);

      COMMIT;
    `);
  },
};

/**
 * Migration 003: Add branch_name field to executions
 *
 * This migration adds the branch_name field to track which branch
 * an execution is running on, and makes target_branch NOT NULL.
 */
export const migration_003_add_worktree_fields: Migration = {
  version: 3,
  name: "add_worktree_tracking_fields",
  up: (db: Database.Database) => {
    db.exec(`
      BEGIN TRANSACTION;

      -- Create new table with branch_name field
      CREATE TABLE IF NOT EXISTS executions_new (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex')),
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'stopped')),

        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        exit_code INTEGER,
        error_message TEXT,

        before_commit TEXT,
        after_commit TEXT,
        target_branch TEXT NOT NULL,
        worktree_path TEXT,

        branch_name TEXT NOT NULL,

        session_id TEXT,
        summary TEXT,

        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

        FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
      );

      -- Copy data from old table to new table
      -- Use COALESCE to provide default values for new NOT NULL fields
      INSERT INTO executions_new (
        id, issue_id, agent_type, status,
        started_at, completed_at, exit_code, error_message,
        before_commit, after_commit, target_branch, worktree_path,
        branch_name,
        session_id, summary,
        created_at, updated_at
      )
      SELECT
        id, issue_id, agent_type, status,
        started_at, completed_at, exit_code, error_message,
        before_commit, after_commit,
        COALESCE(target_branch, 'main') as target_branch,
        worktree_path,
        COALESCE(target_branch, 'main') as branch_name,
        session_id, summary,
        created_at, updated_at
      FROM executions;

      -- Drop old table
      DROP TABLE executions;

      -- Rename new table to original name
      ALTER TABLE executions_new RENAME TO executions;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_executions_issue_id ON executions(issue_id);
      CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
      CREATE INDEX IF NOT EXISTS idx_executions_session_id ON executions(session_id);

      COMMIT;
    `);
  },
  down: (db: Database.Database) => {
    // Rollback: remove branch_name field and make target_branch nullable again
    db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE IF NOT EXISTS executions_old (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex')),
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'stopped')),

        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        exit_code INTEGER,
        error_message TEXT,

        before_commit TEXT,
        after_commit TEXT,
        target_branch TEXT,
        worktree_path TEXT,

        session_id TEXT,
        summary TEXT,

        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

        FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
      );

      -- Copy data back (dropping branch_name field)
      INSERT INTO executions_old (
        id, issue_id, agent_type, status,
        started_at, completed_at, exit_code, error_message,
        before_commit, after_commit, target_branch, worktree_path,
        session_id, summary,
        created_at, updated_at
      )
      SELECT
        id, issue_id, agent_type, status,
        started_at, completed_at, exit_code, error_message,
        before_commit, after_commit, target_branch, worktree_path,
        session_id, summary,
        created_at, updated_at
      FROM executions;

      DROP TABLE executions;
      ALTER TABLE executions_old RENAME TO executions;

      -- Recreate original indexes
      CREATE INDEX IF NOT EXISTS idx_executions_issue_id ON executions(issue_id);
      CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
      CREATE INDEX IF NOT EXISTS idx_executions_session_id ON executions(session_id);

      COMMIT;
    `);
  },
};

/**
 * All migrations in order
 */
const MIGRATIONS: Migration[] = [
  migration_001_remove_description,
  migration_002_nullable_feedback_fields,
  migration_003_add_worktree_fields,
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
