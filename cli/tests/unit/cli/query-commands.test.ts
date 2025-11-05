/**
 * Unit tests for query CLI command handlers (ready, blocked)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  handleReady,
  handleBlocked,
} from "../../../src/cli/query-commands.js";
import { handleIssueCreate } from "../../../src/cli/issue-commands.js";
import { handleLink } from "../../../src/cli/relationship-commands.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Query CLI Commands", () => {
  let db: Database.Database;
  let tempDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let createdIssueIds: string[] = [];

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));
    createdIssueIds = [];

    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "s",
        issue: "i",
      },
    };
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify(config, null, 2)
    );

    // Create issues subdirectory
    fs.mkdirSync(path.join(tempDir, "issues"), { recursive: true });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // Helper to extract issue ID from console output
  const extractIssueId = (spy: any): string => {
    const output = spy.mock.calls.flat().join(" ");
    const match = output.match(/\bi-[0-9a-z]{4,8}\b/);
    if (!match) {
      throw new Error(`Could not find issue ID in output: ${output}`);
    }
    return match[0];
  };

  // Helper to create issue and track its ID
  const createAndTrackIssue = async (ctx: any, title: string, options: any = {}) => {
    await handleIssueCreate(ctx, title, options);
    const issueId = extractIssueId(consoleLogSpy);
    createdIssueIds.push(issueId);
    consoleLogSpy.mockClear();
    return issueId;
  };

  describe("handleReady", () => {
    it("should show message when no ready issues exist", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("No ready issues");
    });

    it("should list ready issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create open issues that are ready (not blocked)
      await handleIssueCreate(ctx, "Ready Issue 1", { priority: "1" });
      await handleIssueCreate(ctx, "Ready Issue 2", { priority: "2" });

      consoleLogSpy.mockClear();

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Ready Issues (2)");
      expect(output).toContain("Ready Issue 1");
      expect(output).toContain("Ready Issue 2");
    });

    it("should exclude blocked issues from ready list", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issues
      const blockingId = await createAndTrackIssue(ctx, "Blocking Issue", { priority: "2" });
      const blockedId = await createAndTrackIssue(ctx, "Blocked Issue", { priority: "2" });
      await createAndTrackIssue(ctx, "Ready Issue", { priority: "2" });

      // Create blocking relationship
      await handleLink(ctx, blockedId, blockingId, { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      // Should show 2 ready issues (blocking and ready, but not blocked)
      expect(output).toContain("Ready Issues (2)");
      expect(output).toContain("Blocking Issue");
      expect(output).toContain("Ready Issue");
      expect(output).not.toContain("Blocked Issue");
    });

    it("should exclude closed issues from ready list", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create an open issue
      await createAndTrackIssue(ctx, "Open Issue", { priority: "2" });

      // Create a closed issue
      const closedId = await createAndTrackIssue(ctx, "Closed Issue", { priority: "2" });
      db.prepare("UPDATE issues SET status = 'closed' WHERE id = ?").run(closedId);

      consoleLogSpy.mockClear();

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Ready Issues (1)");
      expect(output).toContain("Open Issue");
      expect(output).not.toContain("Closed Issue");
    });

    it("should exclude archived issues from ready list", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create an open issue
      await createAndTrackIssue(ctx, "Active Issue", { priority: "2" });

      // Create an archived issue
      const archivedId = await createAndTrackIssue(ctx, "Archived Issue", { priority: "2" });
      db.prepare("UPDATE issues SET archived = 1 WHERE id = ?").run(archivedId);

      consoleLogSpy.mockClear();

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Ready Issues (1)");
      expect(output).toContain("Active Issue");
      expect(output).not.toContain("Archived Issue");
    });

    it("should show assignees when present", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueCreate(ctx, "Assigned Issue", {
        priority: "2",
        assignee: "john",
      });

      consoleLogSpy.mockClear();

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("@john");
    });

    it("should sort by priority (DESC) and created_at", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issues with different priorities
      await handleIssueCreate(ctx, "Low Priority", { priority: "3" });
      await handleIssueCreate(ctx, "High Priority", { priority: "1" });
      await handleIssueCreate(ctx, "Medium Priority", { priority: "2" });

      consoleLogSpy.mockClear();

      await handleReady(ctx, {});

      // Get all console.log calls
      const calls = consoleLogSpy.mock.calls.map((call) => call.join(" "));

      // Find indices of each issue in the output
      const highPriorityIndex = calls.findIndex((c) => c.includes("High Priority"));
      const mediumPriorityIndex = calls.findIndex((c) => c.includes("Medium Priority"));
      const lowPriorityIndex = calls.findIndex((c) => c.includes("Low Priority"));

      // SQL uses ORDER BY priority DESC, so higher numbers come first
      expect(lowPriorityIndex).toBeLessThan(mediumPriorityIndex);
      expect(mediumPriorityIndex).toBeLessThan(highPriorityIndex);
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleIssueCreate(ctx, "Ready Issue", { priority: "2" });

      consoleLogSpy.mockClear();

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.issues).toBeDefined();
      expect(parsed.issues).toHaveLength(1);
      expect(parsed.issues[0].title).toBe("Ready Issue");
    });

    it("should output empty JSON array when no ready issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleReady(ctx, {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.issues).toBeDefined();
      expect(parsed.issues).toHaveLength(0);
    });
  });

  describe("handleBlocked", () => {
    it("should show message when no blocked issues exist", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleBlocked(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("No blocked issues");
    });

    it("should list blocked issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issues
      const blockingId = await createAndTrackIssue(ctx, "Blocking Issue", { priority: "2" });
      const blockedId1 = await createAndTrackIssue(ctx, "Blocked Issue 1", { priority: "2" });
      const blockedId2 = await createAndTrackIssue(ctx, "Blocked Issue 2", { priority: "2" });

      // Create blocking relationships
      await handleLink(ctx, blockedId1, blockingId, { type: "blocks" });
      await handleLink(ctx, blockedId2, blockingId, { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleBlocked(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Blocked Issues (2)");
      expect(output).toContain("Blocked Issue 1");
      expect(output).toContain("Blocked Issue 2");
    });

    it("should not list ready issues in blocked list", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issues with blocking relationship
      const blockingId = await createAndTrackIssue(ctx, "Blocking Issue", { priority: "2" });
      const blockedId = await createAndTrackIssue(ctx, "Blocked Issue", { priority: "2" });
      await createAndTrackIssue(ctx, "Ready Issue", { priority: "2" });

      await handleLink(ctx, blockedId, blockingId, { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleBlocked(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Blocked Issue");
      expect(output).not.toContain("Ready Issue");
      expect(output).not.toContain("Blocking Issue");
    });

    it("should exclude blocked issues when blocker is closed", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issues with blocking relationship
      const blockingId = await createAndTrackIssue(ctx, "Blocking Issue", { priority: "2" });
      const blockedId = await createAndTrackIssue(ctx, "Previously Blocked Issue", { priority: "2" });

      await handleLink(ctx, blockedId, blockingId, { type: "blocks" });

      // Close the blocking issue
      db.prepare("UPDATE issues SET status = 'closed' WHERE id = ?").run(blockingId);

      consoleLogSpy.mockClear();

      await handleBlocked(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      // Issue should not be blocked anymore since blocker is closed
      expect(output).toContain("No blocked issues");
    });

    it("should sort by priority (DESC) and created_at", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create blocker
      const blockerId = await createAndTrackIssue(ctx, "Blocker", { priority: "2" });

      // Create blocked issues with different priorities
      const lowPriorityId = await createAndTrackIssue(ctx, "Low Priority Blocked", { priority: "3" });
      const highPriorityId = await createAndTrackIssue(ctx, "High Priority Blocked", { priority: "1" });
      const mediumPriorityId = await createAndTrackIssue(ctx, "Medium Priority Blocked", { priority: "2" });

      // Create blocking relationships
      await handleLink(ctx, lowPriorityId, blockerId, { type: "blocks" });
      await handleLink(ctx, highPriorityId, blockerId, { type: "blocks" });
      await handleLink(ctx, mediumPriorityId, blockerId, { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleBlocked(ctx, {});

      // Get all console.log calls
      const calls = consoleLogSpy.mock.calls.map((call) => call.join(" "));

      // Find indices of each issue in the output
      const highPriorityIndex = calls.findIndex((c) => c.includes("High Priority Blocked"));
      const mediumPriorityIndex = calls.findIndex((c) => c.includes("Medium Priority Blocked"));
      const lowPriorityIndex = calls.findIndex((c) => c.includes("Low Priority Blocked"));

      // SQL uses ORDER BY priority DESC, so higher numbers come first
      expect(lowPriorityIndex).toBeLessThan(mediumPriorityIndex);
      expect(mediumPriorityIndex).toBeLessThan(highPriorityIndex);
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      // Create issues with blocking relationship
      const blockerId = await createAndTrackIssue(ctx, "Blocker", { priority: "2" });
      const blockedId = await createAndTrackIssue(ctx, "Blocked", { priority: "2" });
      await handleLink(ctx, blockedId, blockerId, { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleBlocked(ctx, {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.issues).toBeDefined();
      expect(parsed.issues).toHaveLength(1);
      expect(parsed.issues[0].title).toBe("Blocked");
    });

    it("should output empty JSON array when no blocked issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleBlocked(ctx, {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.issues).toBeDefined();
      expect(parsed.issues).toHaveLength(0);
    });
  });
});
