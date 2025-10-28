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

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));

    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "spec",
        issue: "issue",
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
      await handleIssueCreate(ctx, "Blocking Issue", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked Issue", { priority: "2" });
      await handleIssueCreate(ctx, "Ready Issue", { priority: "2" });

      // Create blocking relationship
      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });

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
      await handleIssueCreate(ctx, "Open Issue", { priority: "2" });

      // Create a closed issue
      await handleIssueCreate(ctx, "Closed Issue", { priority: "2" });
      db.prepare("UPDATE issues SET status = 'closed' WHERE id = 'issue-002'").run();

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
      await handleIssueCreate(ctx, "Active Issue", { priority: "2" });

      // Create an archived issue
      await handleIssueCreate(ctx, "Archived Issue", { priority: "2" });
      db.prepare("UPDATE issues SET archived = 1 WHERE id = 'issue-002'").run();

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
      await handleIssueCreate(ctx, "Blocking Issue", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked Issue 1", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked Issue 2", { priority: "2" });

      // Create blocking relationships
      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });
      await handleLink(ctx, "issue-003", "issue-001", { type: "blocks" });

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
      await handleIssueCreate(ctx, "Blocking Issue", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked Issue", { priority: "2" });
      await handleIssueCreate(ctx, "Ready Issue", { priority: "2" });

      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });

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
      await handleIssueCreate(ctx, "Blocking Issue", { priority: "2" });
      await handleIssueCreate(ctx, "Previously Blocked Issue", { priority: "2" });

      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });

      // Close the blocking issue
      db.prepare("UPDATE issues SET status = 'closed' WHERE id = 'issue-001'").run();

      consoleLogSpy.mockClear();

      await handleBlocked(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      // Issue should not be blocked anymore since blocker is closed
      expect(output).toContain("No blocked issues");
    });

    it("should sort by priority (DESC) and created_at", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create blocker
      await handleIssueCreate(ctx, "Blocker", { priority: "2" });

      // Create blocked issues with different priorities
      await handleIssueCreate(ctx, "Low Priority Blocked", { priority: "3" });
      await handleIssueCreate(ctx, "High Priority Blocked", { priority: "1" });
      await handleIssueCreate(ctx, "Medium Priority Blocked", { priority: "2" });

      // Create blocking relationships
      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });
      await handleLink(ctx, "issue-003", "issue-001", { type: "blocks" });
      await handleLink(ctx, "issue-004", "issue-001", { type: "blocks" });

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
      await handleIssueCreate(ctx, "Blocker", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked", { priority: "2" });
      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });

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
