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
  handleIssueDelete,
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

  describe("handleIssueDelete", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      await handleIssueCreate(ctx, "Delete Test 1", { priority: "2" });
      await handleIssueCreate(ctx, "Delete Test 2", { priority: "2" });
      await handleIssueCreate(ctx, "Delete Test 3", { priority: "2" });
      consoleLogSpy.mockClear();
    });

    it("should soft delete (close) a single issue by default", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueDelete(ctx, ["issue-001"], {});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.anything()
      );

      // Verify issue is closed, not deleted
      const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get("issue-001");
      expect(issue).toBeDefined();
      expect((issue as any).status).toBe("closed");
    });

    it("should hard delete (permanently remove) issue with --hard flag", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueDelete(ctx, ["issue-001"], { hard: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Permanently deleted issue"),
        expect.anything()
      );

      // Verify issue is completely removed from database
      const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get("issue-001");
      expect(issue).toBeUndefined();
    });

    it("should delete multiple issues (soft delete)", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueDelete(ctx, ["issue-001", "issue-002"], {});

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

      // Verify both issues are closed
      const issue1 = db.prepare("SELECT status FROM issues WHERE id = ?").get("issue-001");
      const issue2 = db.prepare("SELECT status FROM issues WHERE id = ?").get("issue-002");
      expect((issue1 as any).status).toBe("closed");
      expect((issue2 as any).status).toBe("closed");
    });

    it("should delete multiple issues (hard delete)", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueDelete(ctx, ["issue-001", "issue-002"], { hard: true });

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("✓ Permanently deleted issue"),
        expect.anything()
      );
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("✓ Permanently deleted issue"),
        expect.anything()
      );

      // Verify both issues are removed
      const issue1 = db.prepare("SELECT * FROM issues WHERE id = ?").get("issue-001");
      const issue2 = db.prepare("SELECT * FROM issues WHERE id = ?").get("issue-002");
      expect(issue1).toBeUndefined();
      expect(issue2).toBeUndefined();
    });

    it("should handle non-existent issue gracefully", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueDelete(ctx, ["non-existent"], {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Issue not found:"),
        expect.anything()
      );
    });

    it("should handle mixed batch delete (some exist, some don't)", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueDelete(ctx, ["issue-001", "non-existent", "issue-002"], {});

      // Should succeed for existing issues
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.stringContaining("issue-001")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.stringContaining("issue-002")
      );

      // Should error for non-existent issue
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Issue not found:"),
        expect.stringContaining("non-existent")
      );
    });

    it("should output JSON with results for all operations", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleIssueDelete(ctx, ["issue-001", "non-existent", "issue-002"], {});

      const output = consoleLogSpy.mock.calls[0][0];
      const results = JSON.parse(output);

      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        id: "issue-001",
        success: true,
        action: "soft_delete",
        status: "closed",
      });
      expect(results[1]).toMatchObject({
        id: "non-existent",
        success: false,
        error: "Issue not found",
      });
      expect(results[2]).toMatchObject({
        id: "issue-002",
        success: true,
        action: "soft_delete",
        status: "closed",
      });
    });

    it("should output JSON for hard delete", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleIssueDelete(ctx, ["issue-001"], { hard: true });

      const output = consoleLogSpy.mock.calls[0][0];
      const results = JSON.parse(output);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: "issue-001",
        success: true,
        action: "hard_delete",
      });
    });
  });
});
