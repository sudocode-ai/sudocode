/**
 * Tests for migration 003: Add worktree tracking fields
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import Database from "better-sqlite3";
import { migration_003_add_worktree_fields } from "../../../src/migrations.js";
import fs from "fs";
import path from "path";

describe("Migration 003: Add worktree tracking fields", () => {
  let db: Database.Database;
  let testDbPath: string;

  beforeEach(() => {
    // Create temporary test database
    testDbPath = path.join("/tmp", `test-migration-${Date.now()}.db`);
    db = new Database(testDbPath);

    // Create old schema (before migration)
    db.exec(`
      CREATE TABLE executions (
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

      CREATE INDEX idx_executions_issue_id ON executions(issue_id);
      CREATE INDEX idx_executions_status ON executions(status);
      CREATE INDEX idx_executions_session_id ON executions(session_id);
    `);

    // Insert test data
    const now = Math.floor(Date.now() / 1000);
    db.exec(`
      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO issues (id, uuid, title, content, status, priority, created_at, updated_at)
      VALUES ('ISSUE-001', 'uuid-1', 'Test Issue', 'Content', 'open', 2, ${now}, ${now});

      INSERT INTO executions (id, issue_id, agent_type, status, started_at, target_branch, created_at, updated_at)
      VALUES
        ('exec-1', 'ISSUE-001', 'claude-code', 'completed', ${now}, 'main', ${now}, ${now}),
        ('exec-2', 'ISSUE-001', 'claude-code', 'running', ${now}, NULL, ${now}, ${now}),
        ('exec-3', 'ISSUE-001', 'codex', 'failed', ${now}, 'feature', ${now}, ${now});
    `);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("should add branch_name column", () => {
    // Run migration
    migration_003_add_worktree_fields.up(db);

    // Verify column exists
    const tableInfo = db.pragma("table_info(executions)");
    const columns = tableInfo.map((col: any) => col.name);

    expect(columns).toContain("branch_name");
  });

  it("should make target_branch NOT NULL", () => {
    // Run migration
    migration_003_add_worktree_fields.up(db);

    // Verify target_branch is NOT NULL
    const tableInfo = db.pragma("table_info(executions)");
    const targetBranchCol = tableInfo.find(
      (col: any) => col.name === "target_branch"
    );

    expect(targetBranchCol.notnull).toBe(1);
  });

  it("should make branch_name NOT NULL", () => {
    // Run migration
    migration_003_add_worktree_fields.up(db);

    // Verify branch_name is NOT NULL
    const tableInfo = db.pragma("table_info(executions)");
    const branchNameCol = tableInfo.find(
      (col: any) => col.name === "branch_name"
    );

    expect(branchNameCol.notnull).toBe(1);
  });

  it("should set default values for existing rows", () => {
    // Run migration
    migration_003_add_worktree_fields.up(db);

    // Query existing rows
    const rows = db
      .prepare(
        "SELECT id, target_branch, branch_name FROM executions ORDER BY id"
      )
      .all();

    expect(rows).toHaveLength(3);

    // exec-1 had target_branch = 'main'
    expect(rows[0].target_branch).toBe("main");
    expect(rows[0].branch_name).toBe("main");

    // exec-2 had target_branch = NULL, should default to 'main'
    expect(rows[1].target_branch).toBe("main");
    expect(rows[1].branch_name).toBe("main");

    // exec-3 had target_branch = 'feature'
    expect(rows[2].target_branch).toBe("feature");
    expect(rows[2].branch_name).toBe("feature");
  });

  it("should preserve existing data", () => {
    // Get data before migration
    const beforeRows = db
      .prepare(
        "SELECT id, issue_id, agent_type, status FROM executions ORDER BY id"
      )
      .all();

    // Run migration
    migration_003_add_worktree_fields.up(db);

    // Get data after migration
    const afterRows = db
      .prepare(
        "SELECT id, issue_id, agent_type, status FROM executions ORDER BY id"
      )
      .all();

    // Verify data is preserved
    expect(afterRows).toEqual(beforeRows);
  });

  it("should rollback successfully", () => {
    // Run migration up
    migration_003_add_worktree_fields.up(db);

    // Verify new column exists
    let tableInfo = db.pragma("table_info(executions)");
    let columns = tableInfo.map((col: any) => col.name);
    expect(columns).toContain("branch_name");

    // Run migration down
    migration_003_add_worktree_fields.down!(db);

    // Verify new column is removed
    tableInfo = db.pragma("table_info(executions)");
    columns = tableInfo.map((col: any) => col.name);
    expect(columns).not.toContain("branch_name");

    // Verify target_branch is nullable again
    const targetBranchCol = tableInfo.find(
      (col: any) => col.name === "target_branch"
    );
    expect(targetBranchCol.notnull).toBe(0);
  });

  it("should handle empty table", () => {
    // Delete all rows
    db.exec("DELETE FROM executions");

    // Run migration
    migration_003_add_worktree_fields.up(db);

    // Verify migration succeeded
    const tableInfo = db.pragma("table_info(executions)");
    const columns = tableInfo.map((col: any) => col.name);

    expect(columns).toContain("branch_name");
  });
});
