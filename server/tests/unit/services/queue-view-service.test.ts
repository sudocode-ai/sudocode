/**
 * Tests for Queue View Service
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getEnrichedQueue,
  validateReorder,
  getQueueStats,
  getQueueWithStats,
  type QueueStatus,
} from "../../../src/services/queue-view-service.js";
import { STACKS_TABLE, STACKS_INDEXES } from "@sudocode-ai/types/schema";

// Mock DataplaneAdapter
function createMockAdapter(queueEntries: any[] = []) {
  return {
    getQueue: vi.fn().mockResolvedValue(queueEntries),
  };
}

describe("Queue View Service", () => {
  let db: Database.Database;
  let testDir: string;

  beforeAll(() => {
    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-queue-test-"));

    // Create in-memory database
    db = new Database(":memory:");

    // Disable foreign keys for basic tests
    db.exec("PRAGMA foreign_keys=OFF;");

    // Create required tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        priority INTEGER DEFAULT 2,
        assignee TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        parent_id TEXT,
        parent_uuid TEXT,
        external_links TEXT
      );

      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        issue_id TEXT,
        agent_type TEXT NOT NULL,
        prompt TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        config TEXT,
        mode TEXT DEFAULT 'worktree',
        worktree_path TEXT,
        branch_name TEXT,
        before_commit TEXT,
        after_commit TEXT,
        exit_code INTEGER,
        session_id TEXT,
        agent_pid INTEGER,
        parent_execution_id TEXT,
        workflow_execution_id TEXT,
        step_type TEXT,
        step_index INTEGER,
        step_config TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id TEXT NOT NULL,
        from_uuid TEXT,
        from_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        to_uuid TEXT,
        to_type TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        execution_id TEXT,
        commit_sha TEXT NOT NULL,
        message TEXT,
        changed_files INTEGER DEFAULT 0,
        additions INTEGER DEFAULT 0,
        deletions INTEGER DEFAULT 0,
        review_status TEXT DEFAULT 'pending',
        reviewed_at TEXT,
        reviewed_by TEXT,
        checkpointed_at TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
      );
    `);

    // Create stacks table
    db.exec(STACKS_TABLE);
    db.exec(STACKS_INDEXES);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Clear all tables before each test
    db.exec(`
      DELETE FROM stacks;
      DELETE FROM checkpoints;
      DELETE FROM relationships;
      DELETE FROM executions;
      DELETE FROM issues;
    `);
  });

  // Helper to insert test data
  function insertIssue(id: string, title: string) {
    db.prepare(
      `INSERT INTO issues (id, uuid, title) VALUES (?, ?, ?)`
    ).run(id, `uuid-${id}`, title);
  }

  function insertExecution(id: string, issueId: string) {
    db.prepare(
      `INSERT INTO executions (id, uuid, issue_id, agent_type, status) VALUES (?, ?, ?, ?, ?)`
    ).run(id, `uuid-${id}`, issueId, "claude-code", "completed");
  }

  function insertCheckpoint(id: string, issueId: string, status: string) {
    db.prepare(
      `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, issueId, `sha-${id}`, status, new Date().toISOString());
  }

  function insertDependency(fromId: string, toId: string) {
    db.prepare(
      `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type) VALUES (?, ?, ?, ?, ?)`
    ).run(fromId, "issue", toId, "issue", "depends-on");
  }

  function insertBlocks(fromId: string, toId: string) {
    db.prepare(
      `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type) VALUES (?, ?, ?, ?, ?)`
    ).run(fromId, "issue", toId, "issue", "blocks");
  }

  function insertStack(id: string, name: string, issueOrder: string[]) {
    db.prepare(
      `INSERT INTO stacks (id, name, issue_order, is_auto, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, name, JSON.stringify(issueOrder), 0, new Date().toISOString(), new Date().toISOString());
  }

  describe("getEnrichedQueue", () => {
    it("should return empty array for empty queue", async () => {
      const adapter = createMockAdapter([]);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result).toEqual([]);
    });

    it("should enrich queue entries with issue info", async () => {
      // Setup data
      insertIssue("i-001", "Test Issue 1");
      insertExecution("exec-001", "i-001");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result.length).toBe(1);
      expect(result[0].issueId).toBe("i-001");
      expect(result[0].issueTitle).toBe("Test Issue 1");
      expect(result[0].position).toBe(1);
    });

    it("should filter by status", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "merged",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);

      // Filter to exclude merged
      const result = await getEnrichedQueue(db, adapter as any, {
        excludeStatuses: ["merged"],
      });

      expect(result.length).toBe(1);
      expect(result[0].status).toBe("pending");
    });

    it("should include dependencies", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertDependency("i-001", "i-002"); // i-001 depends on i-002

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].dependencies).toEqual(["i-002"]);
    });

    it("should compute canPromote correctly", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertExecution("exec-001", "i-001");
      insertCheckpoint("cp-001", "i-001", "approved");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].canPromote).toBe(true);
    });

    it("should set canPromote false when checkpoint is pending", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertExecution("exec-001", "i-001");
      insertCheckpoint("cp-001", "i-001", "pending");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].canPromote).toBe(false);
    });

    it("should set canPromote false when dependencies not merged", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertCheckpoint("cp-001", "i-001", "approved");
      insertDependency("i-001", "i-002"); // i-001 depends on i-002 which is not merged

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].canPromote).toBe(false);
    });

    it("should set canPromote true when dependencies are merged", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertCheckpoint("cp-001", "i-001", "approved");
      insertCheckpoint("cp-002", "i-002", "merged"); // i-002 is merged
      insertDependency("i-001", "i-002");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].canPromote).toBe(true);
    });

    it("should filter by includeStatuses", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "ready",
          addedAt: Date.now(),
        },
        {
          id: "q-003",
          executionId: "exec-003",
          streamId: "stream-003",
          targetBranch: "main",
          priority: 30,
          status: "merged",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);

      // Filter to only include ready
      const result = await getEnrichedQueue(db, adapter as any, {
        includeStatuses: ["ready"],
      });

      expect(result.length).toBe(1);
      expect(result[0].status).toBe("ready");
    });

    it("should include stack membership info", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertExecution("exec-001", "i-001");
      insertStack("stk-001", "Test Stack", ["i-001"]);

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].stackId).toBe("stk-001");
      expect(result[0].stackName).toBe("Test Stack");
      expect(result[0].stackDepth).toBe(0);
    });

    it("should handle blocks relationship for dependencies", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertBlocks("i-002", "i-001"); // i-002 blocks i-001 → i-001 depends on i-002

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].dependencies).toContain("i-002");
    });

    it("should handle multiple dependencies", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertDependency("i-001", "i-002");
      insertDependency("i-001", "i-003");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].dependencies).toHaveLength(2);
      expect(result[0].dependencies).toContain("i-002");
      expect(result[0].dependencies).toContain("i-003");
    });

    it("should handle unknown issue gracefully", async () => {
      // Execution exists but issue does not
      insertExecution("exec-001", "i-nonexistent");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any);

      expect(result[0].issueId).toBe("i-nonexistent");
      expect(result[0].issueTitle).toBe("Unknown Issue");
    });

    it("should correctly assign positions based on filtered results", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "merged", // Will be filtered out
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-003",
          executionId: "exec-003",
          streamId: "stream-003",
          targetBranch: "main",
          priority: 30,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getEnrichedQueue(db, adapter as any, {
        excludeStatuses: ["merged"],
      });

      // Positions should be 1-indexed based on filtered results
      expect(result[0].position).toBe(1);
      expect(result[1].position).toBe(2);
    });
  });

  describe("validateReorder", () => {
    it("should return valid for same position", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertExecution("exec-001", "i-001");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await validateReorder(
        db,
        adapter as any,
        "exec-001",
        1,
        "main"
      );

      expect(result.valid).toBe(true);
    });

    it("should return invalid for non-existent execution", async () => {
      const adapter = createMockAdapter([]);
      const result = await validateReorder(
        db,
        adapter as any,
        "exec-nonexistent",
        1,
        "main"
      );

      expect(result.valid).toBe(false);
      expect(result.warning).toContain("not found");
    });

    it("should block moving ahead of dependency", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertDependency("i-001", "i-002"); // i-001 depends on i-002

      const queueEntries = [
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);

      // Try to move i-001 (which depends on i-002) to position 1 (before i-002)
      const result = await validateReorder(
        db,
        adapter as any,
        "exec-001",
        1,
        "main"
      );

      expect(result.valid).toBe(false);
      expect(result.blockedBy).toContain("i-002");
    });

    it("should allow moving backward (to later position)", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertDependency("i-002", "i-001"); // i-002 depends on i-001

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);

      // Move i-001 to position 2 (after i-002) - this is moving backward, should be allowed
      // even though i-002 depends on i-001, because we're moving i-001 further back
      const result = await validateReorder(
        db,
        adapter as any,
        "exec-001",
        2,
        "main"
      );

      expect(result.valid).toBe(true);
    });

    it("should allow moving forward when no dependency conflict", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");
      // No dependencies

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-003",
          executionId: "exec-003",
          streamId: "stream-003",
          targetBranch: "main",
          priority: 30,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);

      // Move i-003 from position 3 to position 1
      const result = await validateReorder(
        db,
        adapter as any,
        "exec-003",
        1,
        "main"
      );

      expect(result.valid).toBe(true);
    });

    it("should block when multiple dependencies would be violated", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");
      insertDependency("i-003", "i-001");
      insertDependency("i-003", "i-002");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-003",
          executionId: "exec-003",
          streamId: "stream-003",
          targetBranch: "main",
          priority: 30,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);

      // Try to move i-003 (depends on i-001 and i-002) to position 1
      const result = await validateReorder(
        db,
        adapter as any,
        "exec-003",
        1,
        "main"
      );

      expect(result.valid).toBe(false);
      expect(result.blockedBy).toHaveLength(2);
      expect(result.blockedBy).toContain("i-001");
      expect(result.blockedBy).toContain("i-002");
    });

    it("should include warning message when blocked", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertDependency("i-001", "i-002");

      const queueEntries = [
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await validateReorder(
        db,
        adapter as any,
        "exec-001",
        1,
        "main"
      );

      expect(result.valid).toBe(false);
      expect(result.warning).toContain("Cannot move ahead of dependencies");
      expect(result.warning).toContain("i-002");
    });
  });

  describe("getQueueStats", () => {
    it("should return correct statistics", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "ready",
          addedAt: Date.now(),
        },
        {
          id: "q-003",
          executionId: "exec-003",
          streamId: "stream-003",
          targetBranch: "main",
          priority: 30,
          status: "merged",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const stats = await getQueueStats(db, adapter as any, "main");

      expect(stats.total).toBe(3);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byStatus.ready).toBe(1);
      expect(stats.byStatus.merged).toBe(1);
    });

    it("should return empty stats for empty queue", async () => {
      const adapter = createMockAdapter([]);
      const stats = await getQueueStats(db, adapter as any, "main");

      expect(stats.total).toBe(0);
      expect(stats.byStatus.pending).toBe(0);
      expect(stats.byStatus.ready).toBe(0);
      expect(stats.byStatus.merged).toBe(0);
      expect(stats.byStatus.failed).toBe(0);
      expect(stats.byStatus.cancelled).toBe(0);
      expect(stats.byStatus.merging).toBe(0);
    });

    it("should count by stack", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");
      insertStack("stk-001", "Stack A", ["i-001", "i-002"]);
      // i-003 is standalone

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-003",
          executionId: "exec-003",
          streamId: "stream-003",
          targetBranch: "main",
          priority: 30,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const stats = await getQueueStats(db, adapter as any, "main");

      expect(stats.byStack["stk-001"]).toBe(2);
      expect(stats.byStack["standalone"]).toBe(1);
    });

    it("should handle all status types", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertIssue("i-004", "Test Issue 4");
      insertIssue("i-005", "Test Issue 5");
      insertIssue("i-006", "Test Issue 6");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");
      insertExecution("exec-004", "i-004");
      insertExecution("exec-005", "i-005");
      insertExecution("exec-006", "i-006");

      const queueEntries = [
        { id: "q-001", executionId: "exec-001", streamId: "s1", targetBranch: "main", priority: 10, status: "pending", addedAt: Date.now() },
        { id: "q-002", executionId: "exec-002", streamId: "s2", targetBranch: "main", priority: 20, status: "ready", addedAt: Date.now() },
        { id: "q-003", executionId: "exec-003", streamId: "s3", targetBranch: "main", priority: 30, status: "merging", addedAt: Date.now() },
        { id: "q-004", executionId: "exec-004", streamId: "s4", targetBranch: "main", priority: 40, status: "merged", addedAt: Date.now() },
        { id: "q-005", executionId: "exec-005", streamId: "s5", targetBranch: "main", priority: 50, status: "failed", addedAt: Date.now() },
        { id: "q-006", executionId: "exec-006", streamId: "s6", targetBranch: "main", priority: 60, status: "cancelled", addedAt: Date.now() },
      ];

      const adapter = createMockAdapter(queueEntries);
      const stats = await getQueueStats(db, adapter as any, "main");

      expect(stats.total).toBe(6);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byStatus.ready).toBe(1);
      expect(stats.byStatus.merging).toBe(1);
      expect(stats.byStatus.merged).toBe(1);
      expect(stats.byStatus.failed).toBe(1);
      expect(stats.byStatus.cancelled).toBe(1);
    });
  });

  describe("getQueueWithStats", () => {
    it("should return entries and stats together", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "merged",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getQueueWithStats(db, adapter as any, {
        excludeStatuses: ["merged"],
      });

      // Stats should include all entries
      expect(result.stats.total).toBe(2);
      expect(result.stats.byStatus.pending).toBe(1);
      expect(result.stats.byStatus.merged).toBe(1);

      // Entries should be filtered
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].status).toBe("pending");
    });

    it("should recalculate positions after filtering", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "merged",
          addedAt: Date.now(),
        },
        {
          id: "q-002",
          executionId: "exec-002",
          streamId: "stream-002",
          targetBranch: "main",
          priority: 20,
          status: "pending",
          addedAt: Date.now(),
        },
        {
          id: "q-003",
          executionId: "exec-003",
          streamId: "stream-003",
          targetBranch: "main",
          priority: 30,
          status: "ready",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getQueueWithStats(db, adapter as any, {
        excludeStatuses: ["merged"],
      });

      // Positions should be recalculated to 1, 2 (not 2, 3)
      expect(result.entries[0].position).toBe(1);
      expect(result.entries[0].issueId).toBe("i-002");
      expect(result.entries[1].position).toBe(2);
      expect(result.entries[1].issueId).toBe("i-003");
    });

    it("should use includeStatuses filter correctly", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertIssue("i-002", "Test Issue 2");
      insertIssue("i-003", "Test Issue 3");
      insertExecution("exec-001", "i-001");
      insertExecution("exec-002", "i-002");
      insertExecution("exec-003", "i-003");

      const queueEntries = [
        { id: "q-001", executionId: "exec-001", streamId: "s1", targetBranch: "main", priority: 10, status: "pending", addedAt: Date.now() },
        { id: "q-002", executionId: "exec-002", streamId: "s2", targetBranch: "main", priority: 20, status: "ready", addedAt: Date.now() },
        { id: "q-003", executionId: "exec-003", streamId: "s3", targetBranch: "main", priority: 30, status: "merged", addedAt: Date.now() },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getQueueWithStats(db, adapter as any, {
        includeStatuses: ["pending", "ready"],
      });

      // Stats should still include all
      expect(result.stats.total).toBe(3);

      // Entries should only include pending and ready
      expect(result.entries.length).toBe(2);
      expect(result.entries.every((e) => e.status === "pending" || e.status === "ready")).toBe(true);
    });

    it("should handle empty result after filtering", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertExecution("exec-001", "i-001");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "merged",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getQueueWithStats(db, adapter as any, {
        excludeStatuses: ["merged"],
      });

      // Stats should still show the merged entry
      expect(result.stats.total).toBe(1);
      expect(result.stats.byStatus.merged).toBe(1);

      // But entries should be empty
      expect(result.entries.length).toBe(0);
    });

    it("should use default target branch when not specified", async () => {
      insertIssue("i-001", "Test Issue 1");
      insertExecution("exec-001", "i-001");

      const queueEntries = [
        {
          id: "q-001",
          executionId: "exec-001",
          streamId: "stream-001",
          targetBranch: "main",
          priority: 10,
          status: "pending",
          addedAt: Date.now(),
        },
      ];

      const adapter = createMockAdapter(queueEntries);
      const result = await getQueueWithStats(db, adapter as any);

      // Should use "main" as default
      expect(adapter.getQueue).toHaveBeenCalledWith("main");
      expect(result.entries.length).toBe(1);
    });
  });
});
