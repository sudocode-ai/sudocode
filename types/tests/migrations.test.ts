/**
 * Unit Tests for Database Migrations
 *
 * Tests that migrations are properly applied and rolled back.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  runMigrations,
  getCurrentMigrationVersion,
  recordMigration,
} from "../src/migrations.js";

describe("Database Migrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("Migration Infrastructure", () => {
    it("should create migrations table on first run", () => {
      const version = getCurrentMigrationVersion(db);
      expect(version).toBe(0);

      // Verify migrations table exists
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
        )
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe("migrations");
    });

    it("should track current migration version", () => {
      expect(getCurrentMigrationVersion(db)).toBe(0);

      // Manually record a migration
      db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        1,
        "test-migration"
      );

      expect(getCurrentMigrationVersion(db)).toBe(1);
    });

    it("should record migration application", () => {
      // Ensure migrations table exists first
      getCurrentMigrationVersion(db);

      const migration = {
        version: 1,
        name: "test-migration",
        up: (db: Database.Database) => {
          db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
        },
      };

      recordMigration(db, migration);

      const version = getCurrentMigrationVersion(db);
      expect(version).toBe(1);

      // Verify migration record exists
      const record = db
        .prepare("SELECT * FROM migrations WHERE version = ?")
        .get(1) as { version: number; name: string; applied_at: string };

      expect(record).toBeDefined();
      expect(record.version).toBe(1);
      expect(record.name).toBe("test-migration");
      expect(record.applied_at).toBeDefined();
    });
  });

  describe("Migration 1: generalize-feedback-table", () => {
    beforeEach(() => {
      // Create old schema with issue_id and spec_id columns
      db.exec(`
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          priority INTEGER NOT NULL DEFAULT 2,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS specs (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 2,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE IF NOT EXISTS issue_feedback (
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
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert test data
      db.prepare(
        "INSERT INTO issues (id, uuid, title) VALUES (?, ?, ?)"
      ).run("i-test", "uuid-issue", "Test Issue");

      db.prepare(
        "INSERT INTO specs (id, uuid, title) VALUES (?, ?, ?)"
      ).run("s-test", "uuid-spec", "Test Spec");

      db.prepare(`
        INSERT INTO issue_feedback (id, issue_id, issue_uuid, spec_id, spec_uuid, feedback_type, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "fb-1",
        "i-test",
        "uuid-issue",
        "s-test",
        "uuid-spec",
        "comment",
        "Test feedback"
      );
    });

    it("should migrate issue_feedback table to use from_id/to_id", () => {
      runMigrations(db);

      // Verify table structure changed
      const tableInfo = db.pragma("table_info(issue_feedback)") as Array<{
        name: string;
      }>;

      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain("from_id");
      expect(columnNames).toContain("from_uuid");
      expect(columnNames).toContain("to_id");
      expect(columnNames).toContain("to_uuid");
      expect(columnNames).not.toContain("issue_id");
      expect(columnNames).not.toContain("spec_id");
    });

    it("should preserve existing feedback data", () => {
      runMigrations(db);

      const feedback = db
        .prepare("SELECT * FROM issue_feedback WHERE id = ?")
        .get("fb-1") as {
        id: string;
        from_id: string;
        from_uuid: string;
        to_id: string;
        to_uuid: string;
        content: string;
      };

      expect(feedback).toBeDefined();
      expect(feedback.from_id).toBe("i-test");
      expect(feedback.from_uuid).toBe("uuid-issue");
      expect(feedback.to_id).toBe("s-test");
      expect(feedback.to_uuid).toBe("uuid-spec");
      expect(feedback.content).toBe("Test feedback");
    });

    it("should be idempotent (safe to run multiple times)", () => {
      runMigrations(db);
      runMigrations(db); // Run again

      // Should not throw and data should still be intact
      const feedback = db
        .prepare("SELECT * FROM issue_feedback WHERE id = ?")
        .get("fb-1") as { id: string };

      expect(feedback).toBeDefined();
      expect(feedback.id).toBe("fb-1");
    });

    it("should recreate indexes", () => {
      runMigrations(db);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='issue_feedback'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((idx) => idx.name);
      expect(indexNames).toContain("idx_feedback_from_id");
      expect(indexNames).toContain("idx_feedback_from_uuid");
      expect(indexNames).toContain("idx_feedback_to_id");
      expect(indexNames).toContain("idx_feedback_to_uuid");
      expect(indexNames).toContain("idx_feedback_dismissed");
      expect(indexNames).toContain("idx_feedback_type");
      expect(indexNames).toContain("idx_feedback_created_at");
    });

    it("should handle new databases without old columns", () => {
      // Create a new database with already-migrated schema
      const newDb = new Database(":memory:");

      newDb.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback (
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
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });
  });

  describe("Migration 2: add-normalized-entry-support", () => {
    beforeEach(() => {
      // Create old schema without normalized_entry column
      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          target_branch TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_logs (
          execution_id TEXT PRIMARY KEY,
          raw_logs TEXT NOT NULL DEFAULT '',
          byte_size INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
        )
      `);

      // Insert test execution and logs
      db.prepare(
        "INSERT INTO executions (id, target_branch, branch_name, status) VALUES (?, ?, ?, ?)"
      ).run("exec-1", "main", "test-branch", "running");

      db.prepare(
        "INSERT INTO execution_logs (execution_id, raw_logs, byte_size, line_count) VALUES (?, ?, ?, ?)"
      ).run("exec-1", '{"type":"test"}\n{"type":"test2"}', 42, 2);
    });

    it("should add normalized_entry column", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(execution_logs)") as Array<{
        name: string;
      }>;

      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain("normalized_entry");
    });

    it("should make raw_logs nullable", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(execution_logs)") as Array<{
        name: string;
        notnull: number;
      }>;

      const rawLogsColumn = tableInfo.find((col) => col.name === "raw_logs");
      expect(rawLogsColumn).toBeDefined();
      expect(rawLogsColumn!.notnull).toBe(0); // 0 means nullable
    });

    it("should preserve existing raw_logs data", () => {
      runMigrations(db);

      const logs = db
        .prepare("SELECT * FROM execution_logs WHERE execution_id = ?")
        .get("exec-1") as {
        execution_id: string;
        raw_logs: string;
        normalized_entry: string | null;
        byte_size: number;
        line_count: number;
      };

      expect(logs).toBeDefined();
      expect(logs.execution_id).toBe("exec-1");
      expect(logs.raw_logs).toBe('{"type":"test"}\n{"type":"test2"}');
      expect(logs.normalized_entry).toBeNull();
      expect(logs.byte_size).toBe(42);
      expect(logs.line_count).toBe(2);
    });

    it("should add CHECK constraint for at least one format", () => {
      runMigrations(db);

      // Disable foreign keys for this test
      db.exec("PRAGMA foreign_keys = OFF");

      // Should allow insert with only raw_logs
      expect(() => {
        db.prepare(
          "INSERT INTO execution_logs (execution_id, raw_logs, normalized_entry, byte_size, line_count) VALUES (?, ?, ?, ?, ?)"
        ).run("exec-2", '{"type":"test"}', null, 14, 1);
      }).not.toThrow();

      // Should allow insert with only normalized_entry
      expect(() => {
        db.prepare(
          "INSERT INTO execution_logs (execution_id, raw_logs, normalized_entry, byte_size, line_count) VALUES (?, ?, ?, ?, ?)"
        ).run("exec-3", null, '{"index":0}', 12, 0);
      }).not.toThrow();

      // Should reject insert with both NULL
      expect(() => {
        db.prepare(
          "INSERT INTO execution_logs (execution_id, raw_logs, normalized_entry, byte_size, line_count) VALUES (?, ?, ?, ?, ?)"
        ).run("exec-4", null, null, 0, 0);
      }).toThrow();
    });

    it("should be idempotent (safe to run multiple times)", () => {
      runMigrations(db);
      runMigrations(db); // Run again

      // Should not throw and data should still be intact
      const logs = db
        .prepare("SELECT * FROM execution_logs WHERE execution_id = ?")
        .get("exec-1") as { execution_id: string; raw_logs: string };

      expect(logs).toBeDefined();
      expect(logs.execution_id).toBe("exec-1");
      expect(logs.raw_logs).toBe('{"type":"test"}\n{"type":"test2"}');
    });

    it("should handle new databases without execution_logs table", () => {
      // Create a new database without execution_logs table
      const newDb = new Database(":memory:");

      // Should not throw when running migration on database without table
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });

    it("should handle databases that already have normalized_entry column", () => {
      // Create database with new schema already in place
      const newDb = new Database(":memory:");

      newDb.exec(`
        CREATE TABLE IF NOT EXISTS execution_logs (
          execution_id TEXT PRIMARY KEY,
          raw_logs TEXT,
          normalized_entry TEXT,
          byte_size INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (raw_logs IS NOT NULL OR normalized_entry IS NOT NULL)
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });
  });

  describe("Migration 3: remove-agent-type-constraints", () => {
    beforeEach(() => {
      // Create old schema with agent_type constraints
      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          issue_id TEXT,
          issue_uuid TEXT,
          mode TEXT CHECK(mode IN ('worktree', 'local')),
          prompt TEXT,
          config TEXT,
          agent_type TEXT CHECK(agent_type IN ('claude-code', 'codex')),
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
          step_config TEXT
        )
      `);

      // Insert test data with various agent_type values
      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type
        ) VALUES (?, ?, ?, ?, ?)
      `).run("exec-1", "main", "test-branch-1", "running", "claude-code");

      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type
        ) VALUES (?, ?, ?, ?, ?)
      `).run("exec-2", "main", "test-branch-2", "completed", null);
    });

    it("should make agent_type nullable", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(executions)") as Array<{
        name: string;
        notnull: number;
      }>;

      const agentTypeColumn = tableInfo.find((col) => col.name === "agent_type");
      expect(agentTypeColumn).toBeDefined();
      expect(agentTypeColumn!.notnull).toBe(0); // 0 means nullable
    });

    it("should remove default value from agent_type", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(executions)") as Array<{
        name: string;
        dflt_value: string | null;
      }>;

      const agentTypeColumn = tableInfo.find((col) => col.name === "agent_type");
      expect(agentTypeColumn).toBeDefined();
      expect(agentTypeColumn!.dflt_value).toBeNull();
    });

    it("should preserve existing agent_type values including NULL", () => {
      runMigrations(db);

      const exec1 = db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get("exec-1") as {
        id: string;
        agent_type: string | null;
        status: string;
      };

      const exec2 = db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get("exec-2") as {
        id: string;
        agent_type: string | null;
        status: string;
      };

      expect(exec1).toBeDefined();
      expect(exec1.agent_type).toBe("claude-code");
      expect(exec1.status).toBe("running");

      expect(exec2).toBeDefined();
      expect(exec2.agent_type).toBeNull();
      expect(exec2.status).toBe("completed");
    });

    it("should allow any string value for agent_type after migration", () => {
      runMigrations(db);

      // Disable foreign keys for testing (since issues table doesn't exist)
      db.exec("PRAGMA foreign_keys = OFF");

      // Should allow inserting with custom agent types
      expect(() => {
        db.prepare(`
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type
          ) VALUES (?, ?, ?, ?, ?)
        `).run("exec-3", "main", "test-branch-3", "running", "custom-agent");
      }).not.toThrow();

      // Should allow NULL
      expect(() => {
        db.prepare(`
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type
          ) VALUES (?, ?, ?, ?, ?)
        `).run("exec-4", "main", "test-branch-4", "running", null);
      }).not.toThrow();

      // Verify the custom agent type was stored
      const exec3 = db
        .prepare("SELECT agent_type FROM executions WHERE id = ?")
        .get("exec-3") as { agent_type: string };

      expect(exec3.agent_type).toBe("custom-agent");
    });

    it("should recreate indexes", () => {
      runMigrations(db);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='executions'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((idx) => idx.name);
      expect(indexNames).toContain("idx_executions_issue_id");
      expect(indexNames).toContain("idx_executions_issue_uuid");
      expect(indexNames).toContain("idx_executions_status");
      expect(indexNames).toContain("idx_executions_session_id");
      expect(indexNames).toContain("idx_executions_parent");
      expect(indexNames).toContain("idx_executions_created_at");
      expect(indexNames).toContain("idx_executions_workflow");
      expect(indexNames).toContain("idx_executions_workflow_step");
      expect(indexNames).toContain("idx_executions_step_type");
    });

    it("should be idempotent (safe to run multiple times)", () => {
      runMigrations(db);
      runMigrations(db); // Run again

      // Should not throw and data should still be intact
      const exec1 = db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get("exec-1") as { id: string; agent_type: string };

      expect(exec1).toBeDefined();
      expect(exec1.id).toBe("exec-1");
      expect(exec1.agent_type).toBe("claude-code");
    });

    it("should handle new databases without executions table", () => {
      // Create a new database without executions table
      const newDb = new Database(":memory:");

      // Should not throw when running migration on database without table
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });

    it("should handle databases that already have nullable agent_type", () => {
      // Create database with new schema already in place
      const newDb = new Database(":memory:");

      newDb.exec(`
        CREATE TABLE IF NOT EXISTS executions (
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
          status TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });
  });

  describe("runMigrations", () => {
    it("should run all pending migrations in order", () => {
      // Create old schema for both migrations
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS specs (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback (
          id TEXT PRIMARY KEY,
          issue_id TEXT NOT NULL,
          issue_uuid TEXT NOT NULL,
          spec_id TEXT NOT NULL,
          spec_uuid TEXT NOT NULL,
          feedback_type TEXT NOT NULL,
          content TEXT NOT NULL,
          agent TEXT,
          anchor TEXT,
          dismissed INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          target_branch TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          status TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_logs (
          execution_id TEXT PRIMARY KEY,
          raw_logs TEXT NOT NULL DEFAULT '',
          byte_size INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      expect(getCurrentMigrationVersion(db)).toBe(0);

      runMigrations(db);

      // Should have run all three migrations
      expect(getCurrentMigrationVersion(db)).toBe(3);

      // Verify all migrations were applied
      const migrations = db
        .prepare("SELECT * FROM migrations ORDER BY version")
        .all() as Array<{ version: number; name: string }>;

      expect(migrations).toHaveLength(3);
      expect(migrations[0].version).toBe(1);
      expect(migrations[0].name).toBe("generalize-feedback-table");
      expect(migrations[1].version).toBe(2);
      expect(migrations[1].name).toBe("add-normalized-entry-support");
      expect(migrations[2].version).toBe(3);
      expect(migrations[2].name).toBe("remove-agent-type-constraints");
    });

    it("should skip already-applied migrations", () => {
      // Manually record migration 1 as already applied
      db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        1,
        "generalize-feedback-table"
      );

      // Create schema for migration 2
      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          target_branch TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          status TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_logs (
          execution_id TEXT PRIMARY KEY,
          raw_logs TEXT NOT NULL DEFAULT '',
          byte_size INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      runMigrations(db);

      // Should run migrations 2 and 3
      expect(getCurrentMigrationVersion(db)).toBe(3);

      const migrations = db
        .prepare("SELECT * FROM migrations ORDER BY version")
        .all() as Array<{ version: number; name: string }>;

      expect(migrations).toHaveLength(3);
      expect(migrations[1].version).toBe(2);
      expect(migrations[2].version).toBe(3);
    });

    it("should not run if no pending migrations", () => {
      // Manually record all migrations as applied
      db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        1,
        "generalize-feedback-table"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        2,
        "add-normalized-entry-support"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        3,
        "remove-agent-type-constraints"
      );

      expect(getCurrentMigrationVersion(db)).toBe(3);

      // Should not throw, just skip
      expect(() => runMigrations(db)).not.toThrow();

      expect(getCurrentMigrationVersion(db)).toBe(3);
    });
  });
});
