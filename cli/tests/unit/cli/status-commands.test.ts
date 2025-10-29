/**
 * Unit tests for status CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  handleStatus,
  handleStats,
} from "../../../src/cli/status-commands.js";
import { handleSpecCreate } from "../../../src/cli/spec-commands.js";
import { handleIssueCreate } from "../../../src/cli/issue-commands.js";
import { handleLink } from "../../../src/cli/relationship-commands.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Status CLI Commands", () => {
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

    // Create subdirectories
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
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

  describe("handleStatus", () => {
    it("should show zero counts when no entities exist", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleStatus(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("0 total");
      expect(output).toContain("Sudocode Status");
    });

    it("should count specs correctly", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSpecCreate(ctx, "Spec 1", {
        priority: "2",
        filePath: "specs/spec-1.md",
      });
      await handleSpecCreate(ctx, "Spec 2", {
        priority: "2",
        filePath: "specs/spec-2.md",
      });

      consoleLogSpy.mockClear();

      await handleStatus(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Specs:");
      expect(output).toContain("2 total");
    });

    it("should count issues by status correctly", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueCreate(ctx, "Open Issue", { priority: "2" });
      await handleIssueCreate(ctx, "In Progress Issue", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked Issue", { priority: "2" });

      // Update statuses
      db.prepare(
        "UPDATE issues SET status = 'in_progress' WHERE id = 'issue-002'"
      ).run();
      db.prepare(
        "UPDATE issues SET status = 'blocked' WHERE id = 'issue-003'"
      ).run();

      consoleLogSpy.mockClear();

      await handleStatus(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("3 total");
      expect(output).toContain("1 open");
      expect(output).toContain("1 in_progress");
      expect(output).toContain("1 blocked");
    });

    it("should count ready issues correctly", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create ready issues (open, not blocked)
      await handleIssueCreate(ctx, "Ready Issue 1", { priority: "2" });
      await handleIssueCreate(ctx, "Ready Issue 2", { priority: "2" });

      consoleLogSpy.mockClear();

      await handleStatus(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("2 ready to work on");
    });

    it("should count blocked issues correctly", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create blocker and blocked issues
      await handleIssueCreate(ctx, "Blocker", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked Issue", { priority: "2" });

      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleStatus(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("1 blocked");
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleSpecCreate(ctx, "Test Spec", {
        priority: "2",
        filePath: "specs/test.md",
      });
      await handleIssueCreate(ctx, "Test Issue", { priority: "2" });

      consoleLogSpy.mockClear();

      await handleStatus(ctx, {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.specs.total).toBe(1);
      expect(parsed.issues.total).toBe(1);
      expect(parsed.issues.by_status).toBeDefined();
      expect(parsed.issues.ready).toBeDefined();
      expect(parsed.issues.blocked).toBeDefined();
    });

    it("should show all status types in breakdown", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issues with all statuses
      await handleIssueCreate(ctx, "Open", { priority: "2" });
      await handleIssueCreate(ctx, "In Progress", { priority: "2" });
      await handleIssueCreate(ctx, "Blocked", { priority: "2" });
      await handleIssueCreate(ctx, "Needs Review", { priority: "2" });
      await handleIssueCreate(ctx, "Closed", { priority: "2" });

      db.prepare(
        "UPDATE issues SET status = 'in_progress' WHERE id = 'issue-002'"
      ).run();
      db.prepare(
        "UPDATE issues SET status = 'blocked' WHERE id = 'issue-003'"
      ).run();
      db.prepare(
        "UPDATE issues SET status = 'needs_review' WHERE id = 'issue-004'"
      ).run();
      db.prepare(
        "UPDATE issues SET status = 'closed' WHERE id = 'issue-005'"
      ).run();

      consoleLogSpy.mockClear();

      await handleStatus(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("1 open");
      expect(output).toContain("1 in_progress");
      expect(output).toContain("1 blocked");
      expect(output).toContain("1 needs_review");
      expect(output).toContain("1 closed");
    });
  });

  describe("handleStats", () => {
    it("should show comprehensive statistics", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create entities
      await handleSpecCreate(ctx, "Spec 1", {
        priority: "2",
        filePath: "specs/spec-1.md",
      });
      await handleIssueCreate(ctx, "Issue 1", { priority: "2" });
      await handleIssueCreate(ctx, "Issue 2", { priority: "2" });

      // Create relationships
      await handleLink(ctx, "spec-001", "issue-001", { type: "implements" });
      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleStats(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Project Statistics");
      expect(output).toContain("Specs:");
      expect(output).toContain("Issues:");
      expect(output).toContain("Relationships:");
      expect(output).toContain("Recent Activity");
    });

    it("should count relationships by type", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create entities
      await handleSpecCreate(ctx, "Spec 1", {
        priority: "2",
        filePath: "specs/spec-1.md",
      });
      await handleSpecCreate(ctx, "Spec 2", {
        priority: "2",
        filePath: "specs/spec-2.md",
      });
      await handleIssueCreate(ctx, "Issue 1", { priority: "2" });
      await handleIssueCreate(ctx, "Issue 2", { priority: "2" });

      // Create different relationship types
      await handleLink(ctx, "spec-001", "spec-002", { type: "references" });
      await handleLink(ctx, "issue-001", "spec-001", { type: "implements" });
      await handleLink(ctx, "issue-002", "issue-001", { type: "blocks" });

      consoleLogSpy.mockClear();

      await handleStats(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Total: 3");
      expect(output).toContain("references");
      expect(output).toContain("implements");
      expect(output).toContain("blocks");
    });

    it("should track recent activity for last 7 days", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create entities (will have current timestamps)
      await handleIssueCreate(ctx, "New Issue", { priority: "2" });

      // Create an old issue (more than 7 days old)
      await handleIssueCreate(ctx, "Old Issue", { priority: "2" });
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
      db.prepare(
        "UPDATE issues SET created_at = ?, updated_at = ? WHERE id = 'issue-002'"
      ).run(eightDaysAgo.toISOString(), eightDaysAgo.toISOString());

      consoleLogSpy.mockClear();

      await handleStats(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Recent Activity (last 7 days):");
      expect(output).toContain("1 issues created");
      expect(output).toContain("1 issues updated");
    });

    it("should track closed issues in recent activity", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create and close an issue
      await handleIssueCreate(ctx, "Closed Issue", { priority: "2" });
      db.prepare(
        "UPDATE issues SET status = 'closed', closed_at = ? WHERE id = 'issue-001'"
      ).run(new Date().toISOString());

      consoleLogSpy.mockClear();

      await handleStats(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("1 issues closed");
    });

    it("should output JSON with all statistics", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleSpecCreate(ctx, "Test Spec", {
        priority: "2",
        filePath: "specs/test.md",
      });
      await handleIssueCreate(ctx, "Test Issue", { priority: "2" });
      await handleLink(ctx, "issue-001", "spec-001", { type: "implements" });

      consoleLogSpy.mockClear();

      await handleStats(ctx, {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.specs).toBeDefined();
      expect(parsed.issues).toBeDefined();
      expect(parsed.relationships).toBeDefined();
      expect(parsed.relationships.total).toBe(1);
      expect(parsed.relationships.by_type.implements).toBe(1);
      expect(parsed.recent_activity).toBeDefined();
      expect(parsed.recent_activity.specs_updated).toBeDefined();
      expect(parsed.recent_activity.issues_updated).toBeDefined();
      expect(parsed.recent_activity.issues_created).toBeDefined();
      expect(parsed.recent_activity.issues_closed).toBeDefined();
    });

    it("should show zero relationships when none exist", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueCreate(ctx, "Lonely Issue", { priority: "2" });

      consoleLogSpy.mockClear();

      await handleStats(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Relationships:");
      expect(output).toContain("Total: 0");
    });

    it("should count multiple relationship types correctly", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      // Create entities
      for (let i = 1; i <= 6; i++) {
        await handleIssueCreate(ctx, `Issue ${i}`, { priority: "2" });
      }

      // Create various relationship types
      await handleLink(ctx, "issue-001", "issue-002", { type: "blocks" });
      await handleLink(ctx, "issue-002", "issue-003", { type: "blocks" });
      await handleLink(ctx, "issue-003", "issue-004", { type: "implements" });
      await handleLink(ctx, "issue-004", "issue-005", { type: "references" });
      await handleLink(ctx, "issue-005", "issue-006", { type: "depends-on" });

      consoleLogSpy.mockClear();

      await handleStats(ctx, {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.relationships.total).toBe(5);
      expect(parsed.relationships.by_type.blocks).toBe(2);
      expect(parsed.relationships.by_type.implements).toBe(1);
      expect(parsed.relationships.by_type.references).toBe(1);
      expect(parsed.relationships.by_type["depends-on"]).toBe(1);
    });
  });
});
