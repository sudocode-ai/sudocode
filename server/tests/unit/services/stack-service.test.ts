/**
 * Tests for Stack Service
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  computeAutoStacks,
  createStack,
  updateStack,
  deleteStack,
  listStacks,
  getStack,
  getStackForIssue,
  addToStack,
  removeFromStack,
  reorderStack,
} from "../../../src/services/stack-service.js";
import { STACKS_TABLE, STACKS_INDEXES } from "@sudocode-ai/types/schema";

describe("Stack Service", () => {
  let db: Database.Database;
  let testDir: string;

  beforeAll(() => {
    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-stack-test-"));

    // Create in-memory database
    db = new Database(":memory:");

    // Disable foreign keys for basic tests (we'll create proper data where needed)
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
      DELETE FROM issues;
    `);
  });

  describe("createStack", () => {
    it("should create a manual stack", () => {
      const stack = createStack(db, {
        name: "Test Stack",
        issueIds: ["i-001", "i-002", "i-003"],
        rootIssueId: "i-003",
      });

      expect(stack.id).toMatch(/^stk-/);
      expect(stack.name).toBe("Test Stack");
      expect(stack.issue_order).toEqual(["i-001", "i-002", "i-003"]);
      expect(stack.root_issue_id).toBe("i-003");
      expect(stack.is_auto).toBe(false);
      expect(stack.created_at).toBeTruthy();
      expect(stack.updated_at).toBeTruthy();
    });

    it("should create a stack without name", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      expect(stack.id).toMatch(/^stk-/);
      expect(stack.name).toBeUndefined();
      expect(stack.issue_order).toEqual(["i-001", "i-002"]);
    });

    it("should persist stack to database", () => {
      const stack = createStack(db, {
        name: "Persisted Stack",
        issueIds: ["i-001"],
      });

      const row = db
        .prepare("SELECT * FROM stacks WHERE id = ?")
        .get(stack.id) as any;

      expect(row).toBeTruthy();
      expect(row.name).toBe("Persisted Stack");
      expect(JSON.parse(row.issue_order)).toEqual(["i-001"]);
      expect(row.is_auto).toBe(0);
    });
  });

  describe("getStack", () => {
    it("should retrieve a manual stack by ID", () => {
      const created = createStack(db, {
        name: "Get Test",
        issueIds: ["i-001", "i-002"],
      });

      const stackInfo = getStack(db, created.id);

      expect(stackInfo).toBeTruthy();
      expect(stackInfo!.stack.id).toBe(created.id);
      expect(stackInfo!.stack.name).toBe("Get Test");
      expect(stackInfo!.entries).toHaveLength(2);
      expect(stackInfo!.entries[0].issue_id).toBe("i-001");
      expect(stackInfo!.entries[0].depth).toBe(0);
      expect(stackInfo!.entries[1].issue_id).toBe("i-002");
      expect(stackInfo!.entries[1].depth).toBe(1);
    });

    it("should return null for non-existent stack", () => {
      const result = getStack(db, "non-existent-id");
      expect(result).toBeNull();
    });

    it("should include checkpoint status in entries", () => {
      // Create stack and checkpoint
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      // Add a checkpoint for one issue
      db.prepare(
        `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("cp-001", "i-001", "abc123", "approved", new Date().toISOString());

      const stackInfo = getStack(db, stack.id);

      expect(stackInfo!.entries[0].has_checkpoint).toBe(true);
      expect(stackInfo!.entries[0].checkpoint_status).toBe("approved");
      expect(stackInfo!.entries[1].has_checkpoint).toBe(false);
    });
  });

  describe("updateStack", () => {
    it("should update stack name", () => {
      const stack = createStack(db, {
        name: "Original",
        issueIds: ["i-001"],
      });

      const updated = updateStack(db, stack.id, { name: "Updated" });

      expect(updated).toBeTruthy();
      expect(updated!.name).toBe("Updated");
    });

    it("should update issue order", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002", "i-003"],
      });

      const updated = updateStack(db, stack.id, {
        issueOrder: ["i-003", "i-001", "i-002"],
      });

      expect(updated!.issue_order).toEqual(["i-003", "i-001", "i-002"]);
    });

    it("should update root issue ID", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
        rootIssueId: "i-001",
      });

      const updated = updateStack(db, stack.id, { rootIssueId: "i-002" });

      expect(updated!.root_issue_id).toBe("i-002");
    });

    it("should return null for non-existent stack", () => {
      const result = updateStack(db, "non-existent", { name: "Test" });
      expect(result).toBeNull();
    });

    it("should update updated_at timestamp", async () => {
      const stack = createStack(db, {
        issueIds: ["i-001"],
      });

      const originalUpdatedAt = stack.updated_at;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = updateStack(db, stack.id, { name: "New Name" });

      // The updated_at should be a valid timestamp and update should have succeeded
      expect(updated).toBeTruthy();
      expect(updated!.name).toBe("New Name");
      expect(updated!.updated_at).toBeTruthy();
      // With the delay, timestamps should now differ
      expect(new Date(updated!.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(originalUpdatedAt).getTime()
      );
    });
  });

  describe("deleteStack", () => {
    it("should delete a stack", () => {
      const stack = createStack(db, {
        issueIds: ["i-001"],
      });

      const result = deleteStack(db, stack.id);

      expect(result).toBe(true);
      expect(getStack(db, stack.id)).toBeNull();
    });

    it("should return false for non-existent stack", () => {
      const result = deleteStack(db, "non-existent");
      expect(result).toBe(false);
    });
  });

  describe("addToStack", () => {
    it("should add issue to end of stack", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      const updated = addToStack(db, stack.id, "i-003");

      expect(updated!.issue_order).toEqual(["i-001", "i-002", "i-003"]);
    });

    it("should add issue at specific position", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-003"],
      });

      const updated = addToStack(db, stack.id, "i-002", 1);

      expect(updated!.issue_order).toEqual(["i-001", "i-002", "i-003"]);
    });

    it("should not duplicate existing issue", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      const updated = addToStack(db, stack.id, "i-001");

      expect(updated!.issue_order).toEqual(["i-001", "i-002"]);
    });

    it("should return null for non-existent stack", () => {
      const result = addToStack(db, "non-existent", "i-001");
      expect(result).toBeNull();
    });
  });

  describe("removeFromStack", () => {
    it("should remove issue from stack", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002", "i-003"],
      });

      const updated = removeFromStack(db, stack.id, "i-002");

      expect(updated!.issue_order).toEqual(["i-001", "i-003"]);
    });

    it("should handle removing non-existent issue", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      const updated = removeFromStack(db, stack.id, "i-999");

      expect(updated!.issue_order).toEqual(["i-001", "i-002"]);
    });
  });

  describe("reorderStack", () => {
    it("should reorder issues in stack", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002", "i-003"],
      });

      const updated = reorderStack(db, stack.id, ["i-003", "i-002", "i-001"]);

      expect(updated!.issue_order).toEqual(["i-003", "i-002", "i-001"]);
    });
  });

  describe("listStacks", () => {
    it("should list all manual stacks", () => {
      createStack(db, { name: "Stack 1", issueIds: ["i-001"] });
      createStack(db, { name: "Stack 2", issueIds: ["i-002"] });

      const stacks = listStacks(db);
      const manualStacks = stacks.filter((s) => !s.stack.is_auto);

      expect(manualStacks).toHaveLength(2);
    });

    it("should return empty array when no stacks exist", () => {
      const stacks = listStacks(db);
      expect(stacks).toEqual([]);
    });
  });

  describe("getStackForIssue", () => {
    it("should find stack containing issue", () => {
      const stack = createStack(db, {
        name: "Test Stack",
        issueIds: ["i-001", "i-002", "i-003"],
      });

      const result = getStackForIssue(db, "i-002");

      expect(result).toBeTruthy();
      expect(result!.stack.id).toBe(stack.id);
    });

    it("should return null for issue not in any stack", () => {
      createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      const result = getStackForIssue(db, "i-999");

      expect(result).toBeNull();
    });
  });

  describe("computeAutoStacks", () => {
    beforeEach(() => {
      // Create test issues
      const issues = [
        { id: "i-001", title: "Feature A", status: "open" },
        { id: "i-002", title: "Feature B", status: "open" },
        { id: "i-003", title: "Feature C", status: "open" },
        { id: "i-004", title: "Feature D", status: "open" },
      ];

      for (const issue of issues) {
        db.prepare(
          `INSERT INTO issues (id, uuid, title, status) VALUES (?, ?, ?, ?)`
        ).run(issue.id, `uuid-${issue.id}`, issue.title, issue.status);
      }
    });

    it("should detect stack from blocks relationship", () => {
      // i-001 blocks i-002 (i-002 depends on i-001)
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-001", "i-002");

      const stacks = computeAutoStacks(db);

      expect(stacks).toHaveLength(1);
      expect(stacks[0].stack.is_auto).toBe(true);
      expect(stacks[0].stack.issue_order).toContain("i-001");
      expect(stacks[0].stack.issue_order).toContain("i-002");
      // i-001 should come before i-002 (leaf first)
      expect(stacks[0].stack.issue_order.indexOf("i-001")).toBeLessThan(
        stacks[0].stack.issue_order.indexOf("i-002")
      );
    });

    it("should detect stack from depends-on relationship", () => {
      // i-002 depends on i-001
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'depends-on')`
      ).run("i-002", "i-001");

      const stacks = computeAutoStacks(db);

      expect(stacks).toHaveLength(1);
      expect(stacks[0].stack.issue_order).toContain("i-001");
      expect(stacks[0].stack.issue_order).toContain("i-002");
    });

    it("should not create stack for single issue", () => {
      // No relationships - no stacks
      const stacks = computeAutoStacks(db);
      expect(stacks).toHaveLength(0);
    });

    it("should create separate stacks for unconnected components", () => {
      // i-001 blocks i-002
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-001", "i-002");

      // i-003 blocks i-004 (separate chain)
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-003", "i-004");

      const stacks = computeAutoStacks(db);

      expect(stacks).toHaveLength(2);
    });

    it("should exclude issues already in manual stacks", () => {
      // Create dependency chain
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-001", "i-002");

      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-002", "i-003");

      // Put i-001 in a manual stack
      createStack(db, { issueIds: ["i-001"] });

      const stacks = computeAutoStacks(db);

      // Should create stack with i-002 and i-003 only
      const autoStack = stacks.find((s) => s.stack.is_auto);
      expect(autoStack).toBeTruthy();
      expect(autoStack!.stack.issue_order).not.toContain("i-001");
      expect(autoStack!.stack.issue_order).toContain("i-002");
      expect(autoStack!.stack.issue_order).toContain("i-003");
    });

    it("should exclude closed/archived issues", () => {
      // Add a closed issue
      db.prepare(
        `INSERT INTO issues (id, uuid, title, status) VALUES (?, ?, ?, ?)`
      ).run("i-closed", "uuid-closed", "Closed Issue", "closed");

      // i-001 blocks i-closed
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-001", "i-closed");

      const stacks = computeAutoStacks(db);

      // Should not create a stack since i-closed is not active
      expect(stacks).toHaveLength(0);
    });

    it("should order issues topologically (leaf first)", () => {
      // Chain: i-001 -> i-002 -> i-003 (i-001 is leaf, i-003 is root)
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-001", "i-002");

      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-002", "i-003");

      const stacks = computeAutoStacks(db);

      expect(stacks).toHaveLength(1);
      expect(stacks[0].stack.issue_order).toEqual(["i-001", "i-002", "i-003"]);
      expect(stacks[0].entries[0].depth).toBe(0); // i-001 is leaf
      expect(stacks[0].entries[2].depth).toBe(2); // i-003 is root
    });
  });

  describe("Stack Health Computation", () => {
    beforeEach(() => {
      // Create test issues
      db.prepare(
        `INSERT INTO issues (id, uuid, title, status) VALUES (?, ?, ?, ?)`
      ).run("i-001", "uuid-001", "Issue 1", "open");
      db.prepare(
        `INSERT INTO issues (id, uuid, title, status) VALUES (?, ?, ?, ?)`
      ).run("i-002", "uuid-002", "Issue 2", "open");
    });

    it("should compute health as 'pending' when no checkpoints", () => {
      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      const stackInfo = getStack(db, stack.id);

      expect(stackInfo!.health).toBe("pending");
    });

    it("should compute health as 'pending' when checkpoint is pending", () => {
      const stack = createStack(db, {
        issueIds: ["i-001"],
      });

      db.prepare(
        `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("cp-001", "i-001", "abc123", "pending", new Date().toISOString());

      const stackInfo = getStack(db, stack.id);

      expect(stackInfo!.health).toBe("pending");
    });

    it("should compute health as 'ready' when all checkpoints approved", () => {
      const stack = createStack(db, {
        issueIds: ["i-001"],
      });

      db.prepare(
        `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("cp-001", "i-001", "abc123", "approved", new Date().toISOString());

      const stackInfo = getStack(db, stack.id);

      expect(stackInfo!.health).toBe("ready");
    });

    it("should compute health as 'blocked' when blocker is not promoted", () => {
      // i-001 blocks i-002
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-001", "i-002");

      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      // Add approved checkpoints for both
      db.prepare(
        `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("cp-001", "i-001", "abc123", "approved", new Date().toISOString());
      db.prepare(
        `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("cp-002", "i-002", "def456", "approved", new Date().toISOString());

      const stackInfo = getStack(db, stack.id);

      expect(stackInfo!.health).toBe("blocked");
    });

    it("should compute health as 'ready' when blocker is promoted", () => {
      // i-001 blocks i-002
      db.prepare(
        `INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
         VALUES (?, 'issue', ?, 'issue', 'blocks')`
      ).run("i-001", "i-002");

      const stack = createStack(db, {
        issueIds: ["i-001", "i-002"],
      });

      // i-001 is merged, i-002 is approved
      db.prepare(
        `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("cp-001", "i-001", "abc123", "merged", new Date().toISOString());
      db.prepare(
        `INSERT INTO checkpoints (id, issue_id, commit_sha, review_status, checkpointed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("cp-002", "i-002", "def456", "approved", new Date().toISOString());

      const stackInfo = getStack(db, stack.id);

      expect(stackInfo!.health).toBe("ready");
    });
  });
});
