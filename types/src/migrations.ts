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
  {
    version: 2,
    name: "add-normalized-entry-support",
    up: (db: Database.Database) => {
      // Check if normalized_entry column already exists
      const tableInfo = db.pragma("table_info(execution_logs)") as Array<{
        name: string;
      }>;
      const hasNormalizedColumn = tableInfo.some(
        (col) => col.name === "normalized_entry"
      );

      if (hasNormalizedColumn) {
        // Already migrated
        return;
      }

      // Check if table exists
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='execution_logs'"
        )
        .all() as Array<{ name: string }>;

      if (tables.length === 0) {
        // Table doesn't exist yet, will be created with new schema
        return;
      }

      // Create new table with updated schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_logs_new (
          execution_id TEXT PRIMARY KEY,
          raw_logs TEXT,
          normalized_entry TEXT,
          byte_size INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
          CHECK (raw_logs IS NOT NULL OR normalized_entry IS NOT NULL)
        );
      `);

      // Copy existing data (raw_logs will preserve their values, normalized_entry will be NULL)
      db.exec(`
        INSERT INTO execution_logs_new (
          execution_id, raw_logs, normalized_entry, byte_size, line_count,
          created_at, updated_at
        )
        SELECT
          execution_id, raw_logs, NULL, byte_size, line_count,
          created_at, updated_at
        FROM execution_logs;
      `);

      // Drop old table
      db.exec(`DROP TABLE execution_logs;`);

      // Rename new table
      db.exec(`ALTER TABLE execution_logs_new RENAME TO execution_logs;`);

      console.log("  ✓ Added normalized_entry column to execution_logs table");
    },
    down: (db: Database.Database) => {
      // Rollback: remove normalized_entry column
      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_logs_old (
          execution_id TEXT PRIMARY KEY,
          raw_logs TEXT NOT NULL DEFAULT '',
          byte_size INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
        );
      `);

      db.exec(`
        INSERT INTO execution_logs_old (
          execution_id, raw_logs, byte_size, line_count,
          created_at, updated_at
        )
        SELECT
          execution_id, COALESCE(raw_logs, ''), byte_size, line_count,
          created_at, updated_at
        FROM execution_logs;
      `);

      db.exec(`DROP TABLE execution_logs;`);
      db.exec(`ALTER TABLE execution_logs_old RENAME TO execution_logs;`);
    },
  },
  {
    version: 3,
    name: "remove-agent-type-constraints",
    up: (db: Database.Database) => {
      // Check if executions table exists
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='executions'"
        )
        .all() as Array<{ name: string }>;

      if (tables.length === 0) {
        // Table doesn't exist yet, will be created with new schema
        return;
      }

      // Check if table has CHECK constraint on agent_type
      // Get the CREATE TABLE statement to check for constraints
      const tableSchema = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='executions'"
        )
        .get() as { sql: string } | undefined;

      if (!tableSchema) {
        return; // Table doesn't exist
      }

      // Check if already migrated (no CHECK constraint on agent_type)
      const hasCheckConstraint =
        tableSchema.sql.includes("agent_type") &&
        tableSchema.sql.match(/agent_type[^,]*CHECK/i);
      const hasDefaultValue = tableSchema.sql.match(/agent_type[^,]*DEFAULT/i);
      const hasNotNull = tableSchema.sql.match(/agent_type[^,]*NOT NULL/i);

      // If no constraints on agent_type, already migrated
      if (!hasCheckConstraint && !hasDefaultValue && !hasNotNull) {
        return;
      }

      // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
      // Disable foreign keys temporarily for table recreation
      db.exec(`PRAGMA foreign_keys = OFF;`);

      // Create new table with nullable agent_type and no constraints
      db.exec(`
        CREATE TABLE executions_new (
          id TEXT PRIMARY KEY,
          issue_id TEXT,
          issue_uuid TEXT,
          mode TEXT CHECK(mode IN ('worktree', 'local')),
          prompt TEXT,
          config TEXT,
          agent_type TEXT,
          session_id TEXT,
          workflow_execution_id TEXT,
          target_branch TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          before_commit TEXT,
          after_commit TEXT,
          worktree_path TEXT,
          status TEXT NOT NULL CHECK(status IN (
            'preparing', 'pending', 'running', 'paused',
            'completed', 'failed', 'cancelled', 'stopped'
          )),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          cancelled_at DATETIME,
          exit_code INTEGER,
          error_message TEXT,
          error TEXT,
          model TEXT,
          summary TEXT,
          files_changed TEXT,
          parent_execution_id TEXT,
          step_type TEXT,
          step_index INTEGER,
          step_config TEXT,
          FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL,
          FOREIGN KEY (issue_uuid) REFERENCES issues(uuid) ON DELETE SET NULL,
          FOREIGN KEY (parent_execution_id) REFERENCES executions(id) ON DELETE SET NULL
        );
      `);

      // Copy data from old table as-is (preserve NULL values)
      db.exec(`
        INSERT INTO executions_new
        SELECT
          id, issue_id, issue_uuid, mode, prompt, config,
          agent_type,
          session_id, workflow_execution_id,
          target_branch, branch_name, before_commit, after_commit, worktree_path,
          status, created_at, updated_at, started_at, completed_at, cancelled_at,
          exit_code, error_message, error, model, summary, files_changed,
          parent_execution_id, step_type, step_index, step_config
        FROM executions;
      `);

      // Drop old table
      db.exec(`DROP TABLE executions;`);

      // Rename new table
      db.exec(`ALTER TABLE executions_new RENAME TO executions;`);

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_executions_issue_id ON executions(issue_id);
        CREATE INDEX IF NOT EXISTS idx_executions_issue_uuid ON executions(issue_uuid);
        CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
        CREATE INDEX IF NOT EXISTS idx_executions_session_id ON executions(session_id);
        CREATE INDEX IF NOT EXISTS idx_executions_parent ON executions(parent_execution_id);
        CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at);
        CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_execution_id);
        CREATE INDEX IF NOT EXISTS idx_executions_workflow_step ON executions(workflow_execution_id, step_index);
        CREATE INDEX IF NOT EXISTS idx_executions_step_type ON executions(step_type);
      `);

      // Re-enable foreign keys
      db.exec(`PRAGMA foreign_keys = ON;`);

      console.log(
        "  ✓ Removed agent_type constraints (nullable, no default, validation handled by application)"
      );
    },
    down: (db: Database.Database) => {
      // Rollback: restore old schema (nullable agent_type without default)
      db.exec(`
        CREATE TABLE executions_old (
          id TEXT PRIMARY KEY,
          issue_id TEXT,
          issue_uuid TEXT,
          mode TEXT CHECK(mode IN ('worktree', 'local')),
          prompt TEXT,
          config TEXT,
          agent_type TEXT,
          session_id TEXT,
          workflow_execution_id TEXT,
          target_branch TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          before_commit TEXT,
          after_commit TEXT,
          worktree_path TEXT,
          status TEXT NOT NULL CHECK(status IN (
            'preparing', 'pending', 'running', 'paused',
            'completed', 'failed', 'cancelled', 'stopped'
          )),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          cancelled_at DATETIME,
          exit_code INTEGER,
          error_message TEXT,
          error TEXT,
          model TEXT,
          summary TEXT,
          files_changed TEXT,
          parent_execution_id TEXT,
          step_type TEXT,
          step_index INTEGER,
          step_config TEXT,
          FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL,
          FOREIGN KEY (issue_uuid) REFERENCES issues(uuid) ON DELETE SET NULL,
          FOREIGN KEY (parent_execution_id) REFERENCES executions(id) ON DELETE SET NULL
        );
      `);

      db.exec(`
        INSERT INTO executions_old
        SELECT * FROM executions;
      `);

      db.exec(`DROP TABLE executions;`);
      db.exec(`ALTER TABLE executions_old RENAME TO executions;`);

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_executions_issue_id ON executions(issue_id);
        CREATE INDEX IF NOT EXISTS idx_executions_issue_uuid ON executions(issue_uuid);
        CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
        CREATE INDEX IF NOT EXISTS idx_executions_session_id ON executions(session_id);
        CREATE INDEX IF NOT EXISTS idx_executions_parent ON executions(parent_execution_id);
        CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at);
        CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_execution_id);
        CREATE INDEX IF NOT EXISTS idx_executions_workflow_step ON executions(workflow_execution_id, step_index);
        CREATE INDEX IF NOT EXISTS idx_executions_step_type ON executions(step_type);
      `);
    },
  },
  {
    version: 4,
    name: "add-external-links-column",
    up: (db: Database.Database) => {
      console.log(
        "  [migration-4] Starting add-external-links-column migration"
      );

      // Check if specs table exists
      const specsTables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='specs'"
        )
        .all() as Array<{ name: string }>;

      console.log(
        `  [migration-4] specs table exists: ${specsTables.length > 0}`
      );

      if (specsTables.length > 0) {
        // Add external_links column to specs table if it doesn't exist
        const specsInfo = db.pragma("table_info(specs)") as Array<{
          name: string;
        }>;
        const specsHasColumn = specsInfo.some(
          (col) => col.name === "external_links"
        );
        console.log(
          `  [migration-4] specs.external_links column exists: ${specsHasColumn}`
        );

        if (!specsHasColumn) {
          db.exec(`ALTER TABLE specs ADD COLUMN external_links TEXT;`);
          console.log("  ✓ Added external_links column to specs table");
        }
      }

      // Check if issues table exists
      const issuesTables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='issues'"
        )
        .all() as Array<{ name: string }>;

      console.log(
        `  [migration-4] issues table exists: ${issuesTables.length > 0}`
      );

      if (issuesTables.length > 0) {
        // Add external_links column to issues table if it doesn't exist
        const issuesInfo = db.pragma("table_info(issues)") as Array<{
          name: string;
        }>;
        const issuesHasColumn = issuesInfo.some(
          (col) => col.name === "external_links"
        );
        console.log(
          `  [migration-4] issues.external_links column exists: ${issuesHasColumn}`
        );

        if (!issuesHasColumn) {
          db.exec(`ALTER TABLE issues ADD COLUMN external_links TEXT;`);
          console.log("  ✓ Added external_links column to issues table");
        }
      }

      console.log("  [migration-4] Migration complete");
    },
    down: (db: Database.Database) => {
      // SQLite doesn't support DROP COLUMN in older versions
      // For rollback, we'd need to recreate the tables without the column
      // This is a non-destructive migration, so rollback is optional
      console.log(
        "  Note: external_links column cannot be removed (SQLite limitation)"
      );
    },
  },
  {
    version: 5,
    name: "make-feedback-from-id-nullable",
    up: (db: Database.Database) => {
      // Check if issue_feedback table exists
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='issue_feedback'"
        )
        .all() as Array<{ name: string }>;

      if (tables.length === 0) {
        // Table doesn't exist yet, will be created with new schema
        return;
      }

      // Check if from_id is already nullable (already migrated)
      const tableInfo = db.pragma("table_info(issue_feedback)") as Array<{
        name: string;
        notnull: number;
      }>;
      const fromIdColumn = tableInfo.find((col) => col.name === "from_id");

      if (fromIdColumn && fromIdColumn.notnull === 0) {
        // Already migrated (from_id is nullable)
        return;
      }

      // SQLite doesn't support ALTER COLUMN or DROP CONSTRAINT
      // We need to recreate the table to make from_id/from_uuid nullable
      db.exec(`PRAGMA foreign_keys = OFF;`);

      // Create new table with nullable from_id/from_uuid and no FK constraints
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback_new (
          id TEXT PRIMARY KEY,
          from_id TEXT,
          from_uuid TEXT,
          to_id TEXT NOT NULL,
          to_uuid TEXT NOT NULL,
          feedback_type TEXT NOT NULL CHECK(feedback_type IN ('comment', 'suggestion', 'request')),
          content TEXT NOT NULL,
          agent TEXT,
          anchor TEXT,
          dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Copy data from old table
      db.exec(`
        INSERT INTO issue_feedback_new (
          id, from_id, from_uuid, to_id, to_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        )
        SELECT
          id, from_id, from_uuid, to_id, to_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        FROM issue_feedback;
      `);

      // Drop old table
      db.exec(`DROP TABLE issue_feedback;`);

      // Rename new table
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

      db.exec(`PRAGMA foreign_keys = ON;`);

      console.log(
        "  ✓ Made from_id/from_uuid nullable in issue_feedback"
      );
    },
    down: (db: Database.Database) => {
      // Rollback: restore required from_id/from_uuid
      // Note: This will fail if there's feedback without from_id
      db.exec(`PRAGMA foreign_keys = OFF;`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback_old (
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

      // Only copy feedback that has from_id (anonymous feedback would be lost)
      db.exec(`
        INSERT INTO issue_feedback_old (
          id, from_id, from_uuid, to_id, to_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        )
        SELECT
          id, from_id, from_uuid, to_id, to_uuid, feedback_type,
          content, agent, anchor, dismissed, created_at, updated_at
        FROM issue_feedback
        WHERE from_id IS NOT NULL;
      `);

      db.exec(`DROP TABLE issue_feedback;`);
      db.exec(`ALTER TABLE issue_feedback_old RENAME TO issue_feedback;`);

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

      db.exec(`PRAGMA foreign_keys = ON;`);

      console.log(
        "  Note: Anonymous feedback (without from_id) was removed during rollback"
      );
    },
  },
  {
    version: 6,
    name: "add-code-graph-cache-table",
    up: (db: Database.Database) => {
      // Check if table already exists
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='code_graph_cache'"
        )
        .all() as Array<{ name: string }>;

      if (tables.length > 0) {
        // Already migrated
        return;
      }

      // Create the code_graph_cache table
      db.exec(`
        CREATE TABLE IF NOT EXISTS code_graph_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          git_sha TEXT NOT NULL UNIQUE,
          code_graph TEXT NOT NULL,
          file_tree TEXT NOT NULL,
          analyzed_at DATETIME NOT NULL,
          file_count INTEGER NOT NULL DEFAULT 0,
          symbol_count INTEGER NOT NULL DEFAULT 0,
          analysis_duration_ms INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_code_graph_cache_sha ON code_graph_cache(git_sha);
        CREATE INDEX IF NOT EXISTS idx_code_graph_cache_analyzed_at ON code_graph_cache(analyzed_at);
      `);

      console.log("  ✓ Added code_graph_cache table for CodeViz caching");
    },
    down: (db: Database.Database) => {
      db.exec(`DROP TABLE IF EXISTS code_graph_cache;`);
      console.log("  ✓ Removed code_graph_cache table");
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
