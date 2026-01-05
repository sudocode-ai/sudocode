/**
 * Unit tests for Issue operations
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  createIssue,
  getIssue,
  updateIssue,
  closeIssue,
  reopenIssue,
  listIssues,
  searchIssues,
} from "../../../src/operations/issues.js";
import { addRelationship } from "../../../src/operations/relationships.js";
import type Database from "better-sqlite3";

describe("Issue Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
  });

  describe("createIssue", () => {
    it("should create an issue with all fields", () => {
      const issue = createIssue(db, {
        id: "issue-001",
        title: "Test Issue",
        content: "# Details",
        status: "open",
        priority: 1,
        assignee: "agent1",
      });

      expect(issue.id).toBe("issue-001");
      expect(issue.title).toBe("Test Issue");
      expect(issue.priority).toBe(1);
      expect(issue.assignee).toBe("agent1");
    });

    it("should create an issue with defaults", () => {
      const issue = createIssue(db, {
        id: "issue-002",
        title: "Minimal Issue",
      });

      expect(issue.status).toBe("open");
      expect(issue.priority).toBe(2);
      expect(issue.assignee).toBeNull();
    });

    it("should upsert on duplicate ID (idempotent import)", () => {
      createIssue(db, {
        id: "issue-001",
        title: "First",
      });

      // Second call with same ID should update, not error (UPSERT behavior)
      const updated = createIssue(db, {
        id: "issue-001",
        title: "Updated Title",
        status: "in_progress",
      });

      expect(updated).toBeDefined();
      expect(updated.title).toBe("Updated Title");
      expect(updated.status).toBe("in_progress");

      // Verify only one issue exists
      const allIssues = listIssues(db);
      expect(allIssues.length).toBe(1);
    });

    it("should throw error when parent_id does not exist", () => {
      expect(() => {
        createIssue(db, {
          id: "issue-001",
          title: "Child Issue",
          parent_id: "issue-999",
        });
      }).toThrow("Parent issue not found: issue-999");
    });

    it("should create issue with valid parent_id", () => {
      createIssue(db, {
        id: "issue-001",
        title: "Parent Issue",
      });

      const child = createIssue(db, {
        id: "issue-002",
        title: "Child Issue",
        parent_id: "issue-001",
      });

      expect(child.parent_id).toBe("issue-001");
    });
  });

  describe("updateIssue", () => {
    it("should update issue fields", () => {
      createIssue(db, {
        id: "issue-001",
        title: "Original",
      });

      const updated = updateIssue(db, "issue-001", {
        title: "Updated",
        status: "in_progress",
        assignee: "agent1",
      });

      expect(updated.title).toBe("Updated");
      expect(updated.status).toBe("in_progress");
      expect(updated.assignee).toBe("agent1");
    });

    it("should set closed_at when closing", () => {
      createIssue(db, {
        id: "issue-001",
        title: "To Close",
      });

      const closed = updateIssue(db, "issue-001", { status: "closed" });
      expect(closed.status).toBe("closed");
      expect(closed.closed_at).not.toBeNull();
    });

    it("should clear closed_at when reopening", () => {
      createIssue(db, {
        id: "issue-001",
        title: "Issue",
        status: "closed",
      });

      // Close it first
      updateIssue(db, "issue-001", { status: "closed" });

      // Reopen
      const reopened = updateIssue(db, "issue-001", { status: "open" });
      expect(reopened.status).toBe("open");
      expect(reopened.closed_at).toBeNull();
    });

    it("should throw error when updating with non-existent parent_id", () => {
      createIssue(db, {
        id: "issue-001",
        title: "Test Issue",
      });

      expect(() => {
        updateIssue(db, "issue-001", {
          parent_id: "issue-999",
        });
      }).toThrow("Parent issue not found: issue-999");
    });

    it("should update issue with valid parent_id", () => {
      createIssue(db, {
        id: "issue-001",
        title: "Parent Issue",
      });

      createIssue(db, {
        id: "issue-002",
        title: "Child Issue",
      });

      const updated = updateIssue(db, "issue-002", {
        parent_id: "issue-001",
      });

      expect(updated.parent_id).toBe("issue-001");
    });
  });

  describe("closeIssue and reopenIssue", () => {
    it("should close an issue", () => {
      createIssue(db, {
        id: "issue-001",
        title: "To Close",
      });

      const closed = closeIssue(db, "issue-001");
      expect(closed.status).toBe("closed");
      expect(closed.closed_at).not.toBeNull();
    });

    it("should reopen an issue", () => {
      createIssue(db, {
        id: "issue-001",
        title: "Issue",
        status: "closed",
      });

      closeIssue(db, "issue-001");
      const reopened = reopenIssue(db, "issue-001");

      expect(reopened.status).toBe("open");
      expect(reopened.closed_at).toBeNull();
    });
  });

  describe("listIssues", () => {
    beforeEach(() => {
      createIssue(db, {
        id: "issue-001",
        title: "Issue 1",
        status: "open",
        priority: 1,
      });
      createIssue(db, {
        id: "issue-002",
        title: "Issue 2",
        status: "closed",
        priority: 2,
        assignee: "agent1",
      });
    });

    it("should list all issues including archived when no filter provided", () => {
      // Archive one issue
      updateIssue(db, "issue-001", { archived: true });

      // Without archived parameter, should return ALL issues (both archived and non-archived)
      const issues = listIssues(db);
      expect(issues).toHaveLength(2);
    });

    it("should filter by status", () => {
      const issues = listIssues(db, { status: "open" });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("issue-001");
    });

    it("should filter by priority", () => {
      const issues = listIssues(db, { priority: 1 });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("issue-001");
    });

    it("should filter by assignee", () => {
      const issues = listIssues(db, { assignee: "agent1" });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("issue-002");
    });

    it("should filter by archived status - exclude archived", () => {
      // Archive one issue
      updateIssue(db, "issue-001", { archived: true });

      const issues = listIssues(db, { archived: false });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("issue-002");
    });

    it("should filter by archived status - only archived", () => {
      // Archive one issue
      updateIssue(db, "issue-001", { archived: true });

      const issues = listIssues(db, { archived: true });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("issue-001");
    });
  });

  describe("searchIssues", () => {
    beforeEach(() => {
      createIssue(db, {
        id: "issue-001",
        title: "Fix authentication bug",
        content: "OAuth is broken and needs to be fixed",
        status: "open",
        priority: 1,
        assignee: "agent1",
      });
      createIssue(db, {
        id: "issue-002",
        title: "Add database migration",
        content: "PostgreSQL schema update",
        status: "in_progress",
        priority: 2,
      });
      createIssue(db, {
        id: "issue-003",
        title: "Fix database connection",
        content: "Connection pooling issue needs investigation",
        status: "closed",
        priority: 1,
      });
    });

    it("should search by title", () => {
      const results = searchIssues(db, "authentication");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("issue-001");
    });

    it("should search by content (OAuth)", () => {
      const results = searchIssues(db, "OAuth");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("issue-001");
    });

    it("should search by content (PostgreSQL)", () => {
      const results = searchIssues(db, "PostgreSQL");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("issue-002");
    });

    it("should search and filter by status", () => {
      const results = searchIssues(db, "database", { status: "in_progress" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("issue-002");
    });

    it("should search and filter by priority", () => {
      const results = searchIssues(db, "Fix", { priority: 1 });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual([
        "issue-001",
        "issue-003",
      ]);
    });

    it("should search and filter by assignee", () => {
      const results = searchIssues(db, "authentication", {
        assignee: "agent1",
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("issue-001");
    });

    it("should search and filter by multiple criteria", () => {
      const results = searchIssues(db, "Fix", {
        status: "open",
        priority: 1,
        assignee: "agent1",
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("issue-001");
    });

    it("should return empty array when search matches but filters do not", () => {
      const results = searchIssues(db, "authentication", { status: "closed" });
      expect(results).toHaveLength(0);
    });
  });

  describe("Automatic Unblocking on Issue Close", () => {
    it("should automatically unblock when blocker issue is closed (blocks relationship)", () => {
      // Create two issues
      createIssue(db, { id: "issue-001", title: "Blocker" });
      createIssue(db, { id: "issue-002", title: "Blocked" });

      // Add blocking relationship (issue-001 blocks issue-002)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Verify issue-002 is blocked
      let issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("blocked");

      // Close issue-001 (the blocker)
      closeIssue(db, "issue-001");

      // Verify issue-002 is automatically unblocked
      issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("open");
    });

    it("should automatically unblock when dependency issue is closed (depends-on relationship)", () => {
      // Create two issues
      createIssue(db, { id: "issue-001", title: "Dependent" });
      createIssue(db, { id: "issue-002", title: "Dependency" });

      // Add depends-on relationship (issue-001 depends-on issue-002)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "depends-on",
      });

      // Verify issue-001 is blocked
      let issue1 = getIssue(db, "issue-001");
      expect(issue1?.status).toBe("blocked");

      // Close issue-002 (the dependency)
      closeIssue(db, "issue-002");

      // Verify issue-001 is automatically unblocked
      issue1 = getIssue(db, "issue-001");
      expect(issue1?.status).toBe("open");
    });

    it("should keep status blocked when closing one of multiple blockers", () => {
      // Create three issues
      createIssue(db, { id: "issue-001", title: "Blocker 1" });
      createIssue(db, { id: "issue-002", title: "Blocker 2" });
      createIssue(db, { id: "issue-003", title: "Blocked by both" });

      // Add two blocking relationships
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "blocks",
      });
      addRelationship(db, {
        from_id: "issue-002",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Verify issue-003 is blocked
      let issue3 = getIssue(db, "issue-003");
      expect(issue3?.status).toBe("blocked");

      // Close only one blocker
      closeIssue(db, "issue-001");

      // Verify issue-003 remains blocked (issue-002 is still open)
      issue3 = getIssue(db, "issue-003");
      expect(issue3?.status).toBe("blocked");

      // Close the second blocker
      closeIssue(db, "issue-002");

      // Now issue-003 should be unblocked
      issue3 = getIssue(db, "issue-003");
      expect(issue3?.status).toBe("open");
    });

    it("should handle mixed blocks and depends-on relationships", () => {
      // Create three issues
      createIssue(db, { id: "issue-001", title: "Blocker via blocks" });
      createIssue(db, { id: "issue-002", title: "Blocker via depends-on" });
      createIssue(db, { id: "issue-003", title: "Blocked by both types" });

      // issue-001 blocks issue-003
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // issue-003 depends-on issue-002
      addRelationship(db, {
        from_id: "issue-003",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "depends-on",
      });

      // Verify issue-003 is blocked
      let issue3 = getIssue(db, "issue-003");
      expect(issue3?.status).toBe("blocked");

      // Close one blocker
      closeIssue(db, "issue-001");

      // Should still be blocked
      issue3 = getIssue(db, "issue-003");
      expect(issue3?.status).toBe("blocked");

      // Close the other blocker
      closeIssue(db, "issue-002");

      // Now should be unblocked
      issue3 = getIssue(db, "issue-003");
      expect(issue3?.status).toBe("open");
    });

    it("should not unblock if blocked issue is not in blocked status", () => {
      // Create two issues
      createIssue(db, { id: "issue-001", title: "Blocker" });
      createIssue(db, { id: "issue-002", title: "In Progress" });

      // Add blocking relationship
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Manually set issue-002 to in_progress (not blocked)
      updateIssue(db, "issue-002", { status: "in_progress" });

      let issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("in_progress");

      // Close the blocker
      closeIssue(db, "issue-001");

      // Status should remain in_progress (not changed to open)
      issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("in_progress");
    });

    it("should work with updateIssue when status changes to closed", () => {
      // Create two issues
      createIssue(db, { id: "issue-001", title: "Blocker" });
      createIssue(db, { id: "issue-002", title: "Blocked" });

      // Add blocking relationship
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Verify issue-002 is blocked
      let issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("blocked");

      // Close issue-001 using updateIssue
      updateIssue(db, "issue-001", { status: "closed" });

      // Verify issue-002 is automatically unblocked
      issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("open");
    });

    it("should not trigger unblocking when reopening a closed issue", () => {
      // Create two issues, close the blocker first
      createIssue(db, { id: "issue-001", title: "Blocker", status: "closed" });
      createIssue(db, { id: "issue-002", title: "Not Blocked" });

      // Add blocking relationship (should not block since blocker is closed)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Issue-002 should remain open since blocker is closed
      let issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("open");

      // Reopen issue-001 (blocker)
      reopenIssue(db, "issue-001");

      // Issue-002 should still be open (reopening doesn't auto-block)
      issue2 = getIssue(db, "issue-002");
      expect(issue2?.status).toBe("open");
    });
  });

  describe("Blocked Status Management", () => {
    it("should update blocked issue status when blocker is closed", () => {
      // Create blocker and blocked issues
      const blocker = createIssue(db, {
        id: "issue-blocker",
        title: "Blocker Issue",
        status: "open",
      });

      const blocked = createIssue(db, {
        id: "issue-blocked",
        title: "Blocked Issue",
        status: "open",
      });

      // Add blocks relationship (issue-blocker blocks issue-blocked - new semantic)
      addRelationship(db, {
        from_id: "issue-blocker",
        from_type: "issue",
        to_id: "issue-blocked",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // issue-blocked will be automatically set to 'blocked'

      // Verify blocked issue is blocked
      const blockedBefore = getIssue(db, "issue-blocked");
      expect(blockedBefore?.status).toBe("blocked");

      // Close the blocker issue
      closeIssue(db, "issue-blocker");

      // Verify blocked issue status is updated to 'open'
      const blockedAfter = getIssue(db, "issue-blocked");
      expect(blockedAfter?.status).toBe("open");
    });

    it("should keep status as blocked when other blockers remain open", () => {
      // Create two blockers and one blocked issue
      createIssue(db, {
        id: "issue-blocker-1",
        title: "Blocker 1",
        status: "open",
      });

      createIssue(db, {
        id: "issue-blocker-2",
        title: "Blocker 2",
        status: "open",
      });

      createIssue(db, {
        id: "issue-blocked",
        title: "Blocked Issue",
        status: "open",
      });

      // Add two blocks relationships (both blockers block the same issue - new semantic)
      addRelationship(db, {
        from_id: "issue-blocker-1",
        from_type: "issue",
        to_id: "issue-blocked",
        to_type: "issue",
        relationship_type: "blocks",
      });

      addRelationship(db, {
        from_id: "issue-blocker-2",
        from_type: "issue",
        to_id: "issue-blocked",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // issue-blocked will be automatically set to 'blocked'

      // Close only the first blocker
      closeIssue(db, "issue-blocker-1");

      // Blocked issue should still be blocked (because blocker-2 is still open)
      const blockedAfter = getIssue(db, "issue-blocked");
      expect(blockedAfter?.status).toBe("blocked");
    });
  });

  describe("Timestamp Preservation", () => {
    it("should accept and preserve custom timestamps when creating issues", () => {
      const customTimestamps = {
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
        closed_at: null,
      };

      const issue = createIssue(db, {
        id: "issue-ts-1",
        title: "Test Issue",
        created_at: customTimestamps.created_at,
        updated_at: customTimestamps.updated_at,
        closed_at: customTimestamps.closed_at,
      });

      expect(issue.created_at).toBe(customTimestamps.created_at);
      expect(issue.updated_at).toBe(customTimestamps.updated_at);
      expect(issue.closed_at).toBe(customTimestamps.closed_at);
    });

    it("should preserve custom updated_at when updating issues", () => {
      // Create an issue
      createIssue(db, {
        id: "issue-ts-2",
        title: "Original Title",
      });

      // Update with custom timestamp
      const customTimestamp = "2024-06-15T10:00:00Z";
      const updated = updateIssue(db, "issue-ts-2", {
        title: "Updated Title",
        updated_at: customTimestamp,
      });

      expect(updated.title).toBe("Updated Title");
      expect(updated.updated_at).toBe(customTimestamp);
    });

    it("should preserve custom closed_at when updating issues", () => {
      // Create an issue
      createIssue(db, {
        id: "issue-ts-3",
        title: "Issue to Close",
        status: "open",
      });

      // Close with custom timestamp
      const customClosedAt = "2024-07-20T15:30:00Z";
      const updated = updateIssue(db, "issue-ts-3", {
        status: "closed",
        closed_at: customClosedAt,
      });

      expect(updated.status).toBe("closed");
      expect(updated.closed_at).toBe(customClosedAt);
    });

    it("should auto-generate timestamps when not provided", () => {
      const issue = createIssue(db, {
        id: "issue-ts-4",
        title: "Auto Timestamp Issue",
      });

      // Should have auto-generated timestamps
      expect(issue.created_at).toBeTruthy();
      expect(issue.updated_at).toBeTruthy();
      expect(typeof issue.created_at).toBe("string");
      expect(typeof issue.updated_at).toBe("string");
    });

    it("should auto-generate updated_at when updating without providing it", () => {
      // Create issue with a specific old timestamp
      const oldTimestamp = "2024-01-01T00:00:00Z";
      createIssue(db, {
        id: "issue-ts-5",
        title: "Original",
        updated_at: oldTimestamp,
      });

      // Update without providing updated_at
      const updated = updateIssue(db, "issue-ts-5", {
        title: "Modified",
      });

      // Should have a new auto-generated timestamp (different from the old one)
      expect(updated.updated_at).toBeTruthy();
      expect(updated.updated_at).not.toBe(oldTimestamp);
      // Verify it's a recent timestamp (not the old 2024 value)
      // Use UTC year since SQLite CURRENT_TIMESTAMP uses UTC
      const currentUtcYear = new Date().getUTCFullYear().toString();
      expect(updated.updated_at.startsWith(currentUtcYear)).toBe(true);
    });
  });
});
