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
      db.prepare("INSERT INTO issues (id, uuid, title) VALUES (?, ?, ?)").run(
        "i-test",
        "uuid-issue",
        "Test Issue"
      );

      db.prepare("INSERT INTO specs (id, uuid, title) VALUES (?, ?, ?)").run(
        "s-test",
        "uuid-spec",
        "Test Spec"
      );

      db.prepare(
        `
        INSERT INTO issue_feedback (id, issue_id, issue_uuid, spec_id, spec_uuid, feedback_type, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
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
      // Need full executions schema for migration 6 compatibility
      db.exec(`
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
      db.prepare(
        `
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type
        ) VALUES (?, ?, ?, ?, ?)
      `
      ).run("exec-1", "main", "test-branch-1", "running", "claude-code");

      db.prepare(
        `
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type
        ) VALUES (?, ?, ?, ?, ?)
      `
      ).run("exec-2", "main", "test-branch-2", "completed", null);
    });

    it("should make agent_type nullable", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(executions)") as Array<{
        name: string;
        notnull: number;
      }>;

      const agentTypeColumn = tableInfo.find(
        (col) => col.name === "agent_type"
      );
      expect(agentTypeColumn).toBeDefined();
      expect(agentTypeColumn!.notnull).toBe(0); // 0 means nullable
    });

    it("should remove default value from agent_type", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(executions)") as Array<{
        name: string;
        dflt_value: string | null;
      }>;

      const agentTypeColumn = tableInfo.find(
        (col) => col.name === "agent_type"
      );
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
        db.prepare(
          `
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type
          ) VALUES (?, ?, ?, ?, ?)
        `
        ).run("exec-3", "main", "test-branch-3", "running", "custom-agent");
      }).not.toThrow();

      // Should allow NULL
      expect(() => {
        db.prepare(
          `
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type
          ) VALUES (?, ?, ?, ?, ?)
        `
        ).run("exec-4", "main", "test-branch-4", "running", null);
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

  describe("Migration 4: add-external-links-column", () => {
    beforeEach(() => {
      // Create old schema without external_links columns
      db.exec(`
        CREATE TABLE IF NOT EXISTS specs (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 2,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          parent_id TEXT,
          parent_uuid TEXT
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          priority INTEGER NOT NULL DEFAULT 2,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          parent_id TEXT,
          parent_uuid TEXT
        )
      `);

      // Insert test data
      db.prepare(
        "INSERT INTO specs (id, uuid, title, file_path) VALUES (?, ?, ?, ?)"
      ).run("s-test", "uuid-spec", "Test Spec", "specs/test.md");

      db.prepare("INSERT INTO issues (id, uuid, title) VALUES (?, ?, ?)").run(
        "i-test",
        "uuid-issue",
        "Test Issue"
      );
    });

    it("should add external_links column to specs table", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(specs)") as Array<{
        name: string;
      }>;

      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain("external_links");
    });

    it("should add external_links column to issues table", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(issues)") as Array<{
        name: string;
      }>;

      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain("external_links");
    });

    it("should preserve existing data", () => {
      runMigrations(db);

      const spec = db
        .prepare("SELECT * FROM specs WHERE id = ?")
        .get("s-test") as {
        id: string;
        title: string;
        external_links: string | null;
      };

      expect(spec).toBeDefined();
      expect(spec.id).toBe("s-test");
      expect(spec.title).toBe("Test Spec");
      expect(spec.external_links).toBeNull();

      const issue = db
        .prepare("SELECT * FROM issues WHERE id = ?")
        .get("i-test") as {
        id: string;
        title: string;
        external_links: string | null;
      };

      expect(issue).toBeDefined();
      expect(issue.id).toBe("i-test");
      expect(issue.title).toBe("Test Issue");
      expect(issue.external_links).toBeNull();
    });

    it("should allow storing JSON in external_links column", () => {
      runMigrations(db);

      const externalLinks = JSON.stringify([
        {
          provider: "beads",
          external_id: "beads-123",
          url: "https://example.com",
        },
      ]);

      db.prepare("UPDATE specs SET external_links = ? WHERE id = ?").run(
        externalLinks,
        "s-test"
      );

      const spec = db
        .prepare("SELECT external_links FROM specs WHERE id = ?")
        .get("s-test") as { external_links: string };

      expect(spec.external_links).toBe(externalLinks);
      expect(JSON.parse(spec.external_links)).toEqual([
        {
          provider: "beads",
          external_id: "beads-123",
          url: "https://example.com",
        },
      ]);
    });

    it("should be idempotent (safe to run multiple times)", () => {
      runMigrations(db);
      runMigrations(db); // Run again

      // Should not throw and data should still be intact
      const spec = db
        .prepare("SELECT * FROM specs WHERE id = ?")
        .get("s-test") as { id: string };

      expect(spec).toBeDefined();
      expect(spec.id).toBe("s-test");
    });

    it("should handle new databases without specs/issues tables", () => {
      // Create a new database without tables
      const newDb = new Database(":memory:");

      // Should not throw when running migration on database without tables
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });

    it("should handle databases that already have external_links column", () => {
      // Create database with new schema already in place
      const newDb = new Database(":memory:");

      newDb.exec(`
        CREATE TABLE IF NOT EXISTS specs (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL,
          external_links TEXT
        )
      `);

      newDb.exec(`
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          external_links TEXT
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });
  });

  describe("Migration 5: make-feedback-from-id-nullable", () => {
    beforeEach(() => {
      // Create schema with required from_id/from_uuid (pre-migration state)
      db.exec(`
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
        PRAGMA foreign_keys = OFF;
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
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (from_id) REFERENCES issues(id) ON DELETE CASCADE,
          FOREIGN KEY (from_uuid) REFERENCES issues(uuid) ON DELETE CASCADE
        )
      `);

      // Insert test data
      db.prepare("INSERT INTO issues (id, uuid, title) VALUES (?, ?, ?)").run(
        "i-test",
        "uuid-issue",
        "Test Issue"
      );

      db.prepare("INSERT INTO specs (id, uuid, title) VALUES (?, ?, ?)").run(
        "s-test",
        "uuid-spec",
        "Test Spec"
      );

      db.prepare(
        `
        INSERT INTO issue_feedback (id, from_id, from_uuid, to_id, to_uuid, feedback_type, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        "fb-1",
        "i-test",
        "uuid-issue",
        "s-test",
        "uuid-spec",
        "comment",
        "Test feedback"
      );
    });

    it("should make from_id nullable", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(issue_feedback)") as Array<{
        name: string;
        notnull: number;
      }>;

      const fromIdColumn = tableInfo.find((col) => col.name === "from_id");
      expect(fromIdColumn).toBeDefined();
      expect(fromIdColumn!.notnull).toBe(0); // 0 means nullable
    });

    it("should make from_uuid nullable", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(issue_feedback)") as Array<{
        name: string;
        notnull: number;
      }>;

      const fromUuidColumn = tableInfo.find((col) => col.name === "from_uuid");
      expect(fromUuidColumn).toBeDefined();
      expect(fromUuidColumn!.notnull).toBe(0); // 0 means nullable
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

    it("should allow inserting feedback without from_id", () => {
      runMigrations(db);

      // Should allow insert with NULL from_id (anonymous feedback)
      expect(() => {
        db.prepare(
          `
          INSERT INTO issue_feedback (id, from_id, from_uuid, to_id, to_uuid, feedback_type, content)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          "fb-anonymous",
          null,
          null,
          "s-test",
          "uuid-spec",
          "comment",
          "Anonymous feedback"
        );
      }).not.toThrow();

      // Verify the anonymous feedback was stored
      const feedback = db
        .prepare("SELECT * FROM issue_feedback WHERE id = ?")
        .get("fb-anonymous") as {
        id: string;
        from_id: string | null;
        content: string;
      };

      expect(feedback.from_id).toBeNull();
      expect(feedback.content).toBe("Anonymous feedback");
    });

    it("should remove FK constraint on from_id", () => {
      runMigrations(db);

      // Enable foreign keys to test
      db.exec("PRAGMA foreign_keys = ON");

      // Should allow inserting feedback with from_id that doesn't reference issues table
      // (because FK constraint was removed)
      expect(() => {
        db.prepare(
          `
          INSERT INTO issue_feedback (id, from_id, from_uuid, to_id, to_uuid, feedback_type, content)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          "fb-no-fk",
          "i-nonexistent",
          "uuid-nonexistent",
          "s-test",
          "uuid-spec",
          "comment",
          "Feedback without FK constraint"
        );
      }).not.toThrow();
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

    it("should handle new databases without issue_feedback table", () => {
      // Create a new database without issue_feedback table
      const newDb = new Database(":memory:");

      // Should not throw when running migration on database without table
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });

    it("should handle databases that already have nullable from_id", () => {
      // Create database with new schema already in place
      const newDb = new Database(":memory:");

      newDb.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback (
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
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });
  });

  describe("Migration 6: add-waiting-status-to-executions", () => {
    beforeEach(() => {
      // Create schema without 'waiting' in status CHECK constraint
      db.exec(`
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL
        )
      `);

      db.exec(`
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
        )
      `);

      // Insert test data with various statuses
      db.prepare(
        `
        INSERT INTO executions (
          id, mode, target_branch, branch_name, status
        ) VALUES (?, ?, ?, ?, ?)
      `
      ).run("exec-1", "local", "main", "test-branch-1", "running");

      db.prepare(
        `
        INSERT INTO executions (
          id, mode, target_branch, branch_name, status
        ) VALUES (?, ?, ?, ?, ?)
      `
      ).run("exec-2", "worktree", "main", "test-branch-2", "paused");
    });

    it("should add 'waiting' to status CHECK constraint", () => {
      runMigrations(db);

      // Disable foreign keys for testing
      db.exec("PRAGMA foreign_keys = OFF");

      // Should allow inserting with 'waiting' status
      expect(() => {
        db.prepare(
          `
          INSERT INTO executions (
            id, mode, target_branch, branch_name, status
          ) VALUES (?, ?, ?, ?, ?)
        `
        ).run("exec-waiting", "local", "main", "waiting-branch", "waiting");
      }).not.toThrow();

      // Verify the waiting execution was stored
      const exec = db
        .prepare("SELECT status FROM executions WHERE id = ?")
        .get("exec-waiting") as { status: string };

      expect(exec.status).toBe("waiting");
    });

    it("should preserve existing execution data", () => {
      runMigrations(db);

      const exec1 = db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get("exec-1") as {
        id: string;
        mode: string;
        status: string;
        target_branch: string;
      };

      const exec2 = db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get("exec-2") as {
        id: string;
        mode: string;
        status: string;
        target_branch: string;
      };

      expect(exec1).toBeDefined();
      expect(exec1.id).toBe("exec-1");
      expect(exec1.mode).toBe("local");
      expect(exec1.status).toBe("running");
      expect(exec1.target_branch).toBe("main");

      expect(exec2).toBeDefined();
      expect(exec2.id).toBe("exec-2");
      expect(exec2.mode).toBe("worktree");
      expect(exec2.status).toBe("paused");
    });

    it("should still reject invalid status values", () => {
      runMigrations(db);

      // Disable foreign keys for testing
      db.exec("PRAGMA foreign_keys = OFF");

      // Should reject invalid status
      expect(() => {
        db.prepare(
          `
          INSERT INTO executions (
            id, mode, target_branch, branch_name, status
          ) VALUES (?, ?, ?, ?, ?)
        `
        ).run("exec-invalid", "local", "main", "invalid-branch", "invalid-status");
      }).toThrow();
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
        .get("exec-1") as { id: string; status: string };

      expect(exec1).toBeDefined();
      expect(exec1.id).toBe("exec-1");
      expect(exec1.status).toBe("running");
    });

    it("should handle new databases without executions table", () => {
      // Create a new database without executions table
      const newDb = new Database(":memory:");

      // Should not throw when running migration on database without table
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });

    it("should handle databases that already have 'waiting' in status CHECK", () => {
      // Create database with new schema already in place
      const newDb = new Database(":memory:");

      newDb.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          mode TEXT CHECK(mode IN ('worktree', 'local')),
          target_branch TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN (
            'preparing', 'pending', 'running', 'paused', 'waiting',
            'completed', 'failed', 'cancelled', 'stopped'
          )),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });
  });

  describe("Migration 7: add-stream-id-to-executions", () => {
    beforeEach(() => {
      // Create old schema without stream_id column (but with waiting status from migration 6)
      db.exec(`
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
          before_commit TEXT,
          after_commit TEXT,
          worktree_path TEXT,
          status TEXT NOT NULL CHECK(status IN (
            'preparing', 'pending', 'running', 'paused', 'waiting',
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

      // Insert test data
      db.prepare(
        `
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type
        ) VALUES (?, ?, ?, ?, ?)
      `
      ).run("exec-1", "main", "test-branch-1", "running", "claude-code");
    });

    it("should add stream_id column", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(executions)") as Array<{
        name: string;
      }>;

      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain("stream_id");
    });

    it("should preserve existing execution data", () => {
      runMigrations(db);

      const exec = db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get("exec-1") as {
        id: string;
        agent_type: string;
        status: string;
        stream_id: string | null;
      };

      expect(exec).toBeDefined();
      expect(exec.id).toBe("exec-1");
      expect(exec.agent_type).toBe("claude-code");
      expect(exec.status).toBe("running");
      expect(exec.stream_id).toBeNull();
    });

    it("should create index for stream_id", () => {
      runMigrations(db);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='executions'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((idx) => idx.name);
      expect(indexNames).toContain("idx_executions_stream_id");
    });

    it("should be idempotent (safe to run multiple times)", () => {
      runMigrations(db);
      runMigrations(db); // Run again

      // Should not throw and data should still be intact
      const exec = db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get("exec-1") as { id: string; agent_type: string };

      expect(exec).toBeDefined();
      expect(exec.id).toBe("exec-1");
      expect(exec.agent_type).toBe("claude-code");
    });

    it("should handle databases that already have stream_id column", () => {
      // Create database with new schema already in place
      const newDb = new Database(":memory:");

      // Record previous migrations as already applied
      newDb.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      newDb.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        1,
        "generalize-feedback-table"
      );
      newDb.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        2,
        "add-normalized-entry-support"
      );
      newDb.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        3,
        "remove-agent-type-constraints"
      );
      newDb.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        4,
        "add-external-links-column"
      );
      newDb.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        5,
        "make-feedback-from-id-nullable"
      );
      newDb.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        6,
        "add-waiting-status-to-executions"
      );

      // Create issues table (required for FK constraints)
      newDb.exec(`
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL
        )
      `);

      // Create executions table with stream_id already present
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
          before_commit TEXT,
          after_commit TEXT,
          worktree_path TEXT,
          status TEXT NOT NULL CHECK(status IN (
            'preparing', 'pending', 'running', 'paused', 'waiting',
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
          stream_id TEXT
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });
  });

  describe("Migration 8: add-checkpoints-table", () => {
    beforeEach(() => {
      // Create required tables for foreign key constraints
      db.exec(`
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          issue_id TEXT,
          target_branch TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN (
            'preparing', 'pending', 'running', 'paused', 'waiting',
            'completed', 'failed', 'cancelled', 'stopped'
          )),
          stream_id TEXT,
          FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL
        )
      `);

      // Insert test data
      db.prepare("INSERT INTO issues (id, uuid, title) VALUES (?, ?, ?)").run(
        "i-test",
        "uuid-issue",
        "Test Issue"
      );

      db.prepare(
        "INSERT INTO executions (id, issue_id, target_branch, branch_name, status, stream_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("exec-1", "i-test", "main", "test-branch", "completed", "stream-1");
    });

    it("should create checkpoints table", () => {
      runMigrations(db);

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'"
        )
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe("checkpoints");
    });

    it("should create correct columns for checkpoints table", () => {
      runMigrations(db);

      const tableInfo = db.pragma("table_info(checkpoints)") as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;

      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("issue_id");
      expect(columnNames).toContain("execution_id");
      expect(columnNames).toContain("stream_id");
      expect(columnNames).toContain("commit_sha");
      expect(columnNames).toContain("parent_commit");
      expect(columnNames).toContain("changed_files");
      expect(columnNames).toContain("additions");
      expect(columnNames).toContain("deletions");
      expect(columnNames).toContain("message");
      expect(columnNames).toContain("checkpointed_at");
      expect(columnNames).toContain("checkpointed_by");
      expect(columnNames).toContain("review_status");
      expect(columnNames).toContain("reviewed_at");
      expect(columnNames).toContain("reviewed_by");
      expect(columnNames).toContain("review_notes");
    });

    it("should create indexes for checkpoints table", () => {
      runMigrations(db);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='checkpoints'"
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((idx) => idx.name);
      expect(indexNames).toContain("idx_checkpoints_issue_id");
      expect(indexNames).toContain("idx_checkpoints_execution_id");
      expect(indexNames).toContain("idx_checkpoints_stream_id");
      expect(indexNames).toContain("idx_checkpoints_review_status");
      expect(indexNames).toContain("idx_checkpoints_checkpointed_at");
    });

    it("should allow inserting checkpoints", () => {
      runMigrations(db);

      expect(() => {
        db.prepare(
          `
          INSERT INTO checkpoints (
            id, issue_id, execution_id, stream_id, commit_sha, parent_commit,
            changed_files, additions, deletions, message, checkpointed_at,
            checkpointed_by, review_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          "cp-1",
          "i-test",
          "exec-1",
          "stream-1",
          "abc123",
          "def456",
          5,
          100,
          20,
          "Initial checkpoint",
          new Date().toISOString(),
          "user-1",
          "pending"
        );
      }).not.toThrow();

      const checkpoint = db
        .prepare("SELECT * FROM checkpoints WHERE id = ?")
        .get("cp-1") as {
        id: string;
        issue_id: string;
        execution_id: string;
        stream_id: string;
        commit_sha: string;
        changed_files: number;
        review_status: string;
      };

      expect(checkpoint).toBeDefined();
      expect(checkpoint.id).toBe("cp-1");
      expect(checkpoint.issue_id).toBe("i-test");
      expect(checkpoint.execution_id).toBe("exec-1");
      expect(checkpoint.stream_id).toBe("stream-1");
      expect(checkpoint.commit_sha).toBe("abc123");
      expect(checkpoint.changed_files).toBe(5);
      expect(checkpoint.review_status).toBe("pending");
    });

    it("should enforce review_status CHECK constraint", () => {
      runMigrations(db);

      // Should reject invalid status
      expect(() => {
        db.prepare(
          `
          INSERT INTO checkpoints (
            id, issue_id, execution_id, stream_id, commit_sha,
            changed_files, additions, deletions, message, checkpointed_at, review_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          "cp-invalid",
          "i-test",
          "exec-1",
          "stream-1",
          "abc123",
          1,
          10,
          5,
          "Test",
          new Date().toISOString(),
          "invalid_status"
        );
      }).toThrow();

      // Should allow all valid statuses
      const validStatuses = ["pending", "approved", "rejected", "merged"];
      for (let i = 0; i < validStatuses.length; i++) {
        expect(() => {
          db.prepare(
            `
            INSERT INTO checkpoints (
              id, issue_id, execution_id, stream_id, commit_sha,
              changed_files, additions, deletions, message, checkpointed_at, review_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          ).run(
            `cp-valid-${i}`,
            "i-test",
            "exec-1",
            "stream-1",
            `commit-${i}`,
            1,
            10,
            5,
            "Test",
            new Date().toISOString(),
            validStatuses[i]
          );
        }).not.toThrow();
      }
    });

    it("should be idempotent (safe to run multiple times)", () => {
      runMigrations(db);
      runMigrations(db); // Run again

      // Should not throw
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'"
        )
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(1);
    });

    it("should handle databases that already have checkpoints table", () => {
      const newDb = new Database(":memory:");

      // Record all previous migrations as applied
      newDb.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      for (let i = 1; i <= 7; i++) {
        newDb.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
          i,
          `migration-${i}`
        );
      }

      // Create checkpoints table
      newDb.exec(`
        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          issue_id TEXT NOT NULL,
          execution_id TEXT NOT NULL,
          stream_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          message TEXT NOT NULL,
          checkpointed_at TEXT NOT NULL,
          review_status TEXT NOT NULL DEFAULT 'pending'
        )
      `);

      // Should not throw when running migration on already-migrated database
      expect(() => runMigrations(newDb)).not.toThrow();

      newDb.close();
    });

    it("should cascade delete when issue is deleted", () => {
      runMigrations(db);
      db.exec("PRAGMA foreign_keys = ON");

      // Insert a checkpoint
      db.prepare(
        `
        INSERT INTO checkpoints (
          id, issue_id, execution_id, stream_id, commit_sha,
          changed_files, additions, deletions, message, checkpointed_at, review_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        "cp-cascade",
        "i-test",
        "exec-1",
        "stream-1",
        "abc123",
        1,
        10,
        5,
        "Test",
        new Date().toISOString(),
        "pending"
      );

      // Verify checkpoint exists
      let checkpoint = db
        .prepare("SELECT * FROM checkpoints WHERE id = ?")
        .get("cp-cascade");
      expect(checkpoint).toBeDefined();

      // Delete the issue
      db.prepare("DELETE FROM issues WHERE id = ?").run("i-test");

      // Checkpoint should be deleted due to CASCADE
      checkpoint = db
        .prepare("SELECT * FROM checkpoints WHERE id = ?")
        .get("cp-cascade");
      expect(checkpoint).toBeUndefined();
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

      // Should have run all eleven migrations
      expect(getCurrentMigrationVersion(db)).toBe(11);

      // Verify all migrations were applied
      const migrations = db
        .prepare("SELECT * FROM migrations ORDER BY version")
        .all() as Array<{ version: number; name: string }>;

      expect(migrations).toHaveLength(11);
      expect(migrations[0].version).toBe(1);
      expect(migrations[0].name).toBe("generalize-feedback-table");
      expect(migrations[1].version).toBe(2);
      expect(migrations[1].name).toBe("add-normalized-entry-support");
      expect(migrations[2].version).toBe(3);
      expect(migrations[2].name).toBe("remove-agent-type-constraints");
      expect(migrations[3].version).toBe(4);
      expect(migrations[3].name).toBe("add-external-links-column");
      expect(migrations[4].version).toBe(5);
      expect(migrations[4].name).toBe("make-feedback-from-id-nullable");
      expect(migrations[5].version).toBe(6);
      expect(migrations[5].name).toBe("add-waiting-status-to-executions");
      expect(migrations[6].version).toBe(7);
      expect(migrations[6].name).toBe("add-stream-id-to-executions");
      expect(migrations[7].version).toBe(8);
      expect(migrations[7].name).toBe("add-checkpoints-table");
      expect(migrations[8].version).toBe(9);
      expect(migrations[8].name).toBe("add-stacks-table");
      expect(migrations[9].version).toBe(10);
      expect(migrations[9].name).toBe("add-batches-table");
      expect(migrations[10].version).toBe(11);
      expect(migrations[10].name).toBe("add-checkpoint-queue-columns");
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

      // Create schema for migration 2 and 6
      db.exec(`
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

      // Create specs and issues tables for migration 4
      db.exec(`
        CREATE TABLE IF NOT EXISTS specs (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL
        )
      `);

      // Create issue_feedback table for migration 5 (with NOT NULL from_id/from_uuid)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_feedback (
          id TEXT PRIMARY KEY,
          from_id TEXT NOT NULL,
          from_uuid TEXT NOT NULL,
          to_id TEXT NOT NULL,
          to_uuid TEXT NOT NULL,
          feedback_type TEXT NOT NULL,
          content TEXT NOT NULL,
          agent TEXT,
          anchor TEXT,
          dismissed INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      runMigrations(db);

      // Should run migrations 2-11
      expect(getCurrentMigrationVersion(db)).toBe(11);

      const migrations = db
        .prepare("SELECT * FROM migrations ORDER BY version")
        .all() as Array<{ version: number; name: string }>;

      expect(migrations).toHaveLength(11);
      expect(migrations[1].version).toBe(2);
      expect(migrations[2].version).toBe(3);
      expect(migrations[3].version).toBe(4);
      expect(migrations[4].version).toBe(5);
      expect(migrations[5].version).toBe(6);
      expect(migrations[6].version).toBe(7);
      expect(migrations[7].version).toBe(8);
      expect(migrations[8].version).toBe(9);
      expect(migrations[9].version).toBe(10);
      expect(migrations[10].version).toBe(11);
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
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        4,
        "add-external-links-column"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        5,
        "make-feedback-from-id-nullable"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        6,
        "add-waiting-status-to-executions"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        7,
        "add-stream-id-to-executions"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        8,
        "add-checkpoints-table"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        9,
        "add-stacks-table"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        10,
        "add-batches-table"
      );
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        11,
        "add-checkpoint-queue-columns"
      );

      expect(getCurrentMigrationVersion(db)).toBe(11);

      // Should not throw, just skip
      expect(() => runMigrations(db)).not.toThrow();

      expect(getCurrentMigrationVersion(db)).toBe(11);
    });
  });
});
