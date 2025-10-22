/**
 * Unit tests for issue CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  handleIssueCreate,
  handleIssueList,
  handleIssueShow,
  handleIssueUpdate,
  handleIssueClose,
} from "../../../src/cli/issue-commands.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Issue CLI Commands", () => {
  let db: Database.Database;
  let tempDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));

    const meta = {
      version: "1.0.0",
      next_spec_id: 1,
      next_issue_id: 1,
      id_prefix: {
        spec: "spec",
        issue: "issue",
      },
      last_sync: new Date().toISOString(),
      collision_log: [],
    };
    fs.writeFileSync(
      path.join(tempDir, "meta.json"),
      JSON.stringify(meta, null, 2)
    );

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

  describe("handleIssueCreate", () => {
    it("should create an issue with minimal options", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        type: "task",
        priority: "2",
      };

      await handleIssueCreate(ctx, "Test Issue", options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created issue"),
        expect.anything()
      );
    });

    it("should create an issue with all options", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        type: "bug",
        priority: "1",
        description: "Bug description",
        assignee: "user1",
        tags: "urgent,backend",
        estimate: "120",
      };

      await handleIssueCreate(ctx, "Critical Bug", options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created issue"),
        expect.anything()
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Assignee: user1")
      );
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const options = {
        type: "task",
        priority: "2",
      };

      await handleIssueCreate(ctx, "JSON Issue", options);

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.id).toBeDefined();
      expect(parsed.title).toBe("JSON Issue");
    });
  });

  describe("handleIssueList", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      await handleIssueCreate(ctx, "Issue 1", { priority: "1" });
      await handleIssueCreate(ctx, "Issue 2", {
        priority: "2",
        assignee: "user1",
      });
      consoleLogSpy.mockClear();
    });

    it("should list all issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = { limit: "50" };

      await handleIssueList(ctx, options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Found 2 issue(s)")
      );
    });

    it("should filter issues by priority", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        priority: "2",
        limit: "50",
      };

      await handleIssueList(ctx, options);

      const calls = consoleLogSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("Issue 2");
      expect(calls).not.toContain("Issue 1");
    });

    it("should filter issues by assignee", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        assignee: "user1",
        limit: "50",
      };

      await handleIssueList(ctx, options);

      const calls = consoleLogSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("Issue 2");
      expect(calls).toContain("@user1");
    });
  });

  describe("handleIssueShow", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      await handleIssueCreate(ctx, "Show Test Issue", {
        priority: "2",
        description: "Test description",
        assignee: "user1",
      });
      consoleLogSpy.mockClear();
    });

    it("should show issue details", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueShow(ctx, "issue-001");

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("issue-001");
      expect(output).toContain("Show Test Issue");
      expect(output).toContain("user1");
    });

    it("should handle non-existent issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueShow(ctx, "non-existent");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Issue not found")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("handleIssueUpdate", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      await handleIssueCreate(ctx, "Update Test", {
        priority: "2",
      });
      consoleLogSpy.mockClear();
    });

    it("should update issue status", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        status: "in_progress",
      };

      await handleIssueUpdate(ctx, "issue-001", options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Updated issue"),
        expect.anything()
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("status: in_progress")
      );
    });

    it("should update multiple fields", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        status: "in_progress",
        assignee: "user2",
        priority: "1",
      };

      await handleIssueUpdate(ctx, "issue-001", options);

      const calls = consoleLogSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("status: in_progress");
      expect(calls).toContain("assignee: user2");
      expect(calls).toContain("priority: 1");
    });
  });

  describe("handleIssueClose", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      await handleIssueCreate(ctx, "Close Test 1", { priority: "2" });
      await handleIssueCreate(ctx, "Close Test 2", { priority: "2" });
      consoleLogSpy.mockClear();
    });

    it("should close a single issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueClose(ctx, ["issue-001"], {});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.anything()
      );
    });

    it("should close multiple issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueClose(ctx, ["issue-001", "issue-002"], {});

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("✓ Closed issue"),
        expect.anything()
      );
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("✓ Closed issue"),
        expect.anything()
      );
    });

    it("should handle errors for non-existent issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueClose(ctx, ["issue-001", "non-existent"], {});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.anything()
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Failed to close"),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });
});
