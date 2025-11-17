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
import { getIssue } from "../../../src/operations/issues.js";
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
      const issueId1 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId1);

      consoleLogSpy.mockClear();
      await handleIssueCreate(ctx, "Issue 2", {
        priority: "2",
        assignee: "user1",
      });
      const issueId2 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId2);

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
      const issueId = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId);
      consoleLogSpy.mockClear();
    });

    it("should show issue details", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId = createdIssueIds[0];

      await handleIssueShow(ctx, issueId);

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain(issueId);
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
      const issueId = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId);
      consoleLogSpy.mockClear();
    });

    it("should update issue status", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId = createdIssueIds[0];
      const options = {
        status: "in_progress",
      };

      await handleIssueUpdate(ctx, issueId, options);

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
      const issueId = createdIssueIds[0];
      const options = {
        status: "in_progress",
        assignee: "user2",
        priority: "1",
      };

      await handleIssueUpdate(ctx, issueId, options);

      const calls = consoleLogSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("status: in_progress");
      expect(calls).toContain("assignee: user2");
      expect(calls).toContain("priority: 1");
    });

    it("should update issue description (content field)", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const issueId = createdIssueIds[0];
      const newDescription = "This is the updated description text";
      const options = {
        description: newDescription,
      };

      await handleIssueUpdate(ctx, issueId, options);

      // Get the JSON output
      const output = consoleLogSpy.mock.calls
        .flat()
        .join("")
        .replace(/\n/g, "");
      const result = JSON.parse(output);

      // Verify the content field was updated (not description)
      expect(result.content).toBe(newDescription);
      expect(result.id).toBe(issueId);
    });

    it("should export to JSONL after update", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId = createdIssueIds[0];
      const options = {
        description: "New content to export",
      };

      await handleIssueUpdate(ctx, issueId, options);

      // Check that JSONL file was created and contains the issue
      const jsonlPath = path.join(tempDir, "issues.jsonl");
      expect(fs.existsSync(jsonlPath)).toBe(true);

      const jsonlContent = fs.readFileSync(jsonlPath, "utf8");
      const issues = jsonlContent
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      const updatedIssue = issues.find((i: any) => i.id === issueId);
      expect(updatedIssue).toBeDefined();
      expect(updatedIssue.content).toBe("New content to export");
    });

    it("should update issue parent", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create a parent issue
      await handleIssueCreate(ctx, "Parent Issue", { priority: "2" });
      const parentIssueId = extractIssueId(consoleLogSpy);
      consoleLogSpy.mockClear();

      // Create a child issue
      await handleIssueCreate(ctx, "Child Issue", { priority: "2" });
      const childIssueId = extractIssueId(consoleLogSpy);
      consoleLogSpy.mockClear();

      // Update child to set parent
      const options = {
        parent: parentIssueId,
      };

      await handleIssueUpdate(ctx, childIssueId, options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "✓ Updated issue",
        expect.anything()
      );

      // Verify parent was set in database
      const issue = getIssue(db, childIssueId);
      expect(issue?.parent_id).toBe(parentIssueId);

      // Verify parent appears in output
      const calls = consoleLogSpy.mock.calls.flat().join(" ");
      expect(calls).toContain(`parent_id: ${parentIssueId}`);
    });
  });

  describe("handleIssueClose", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      await handleIssueCreate(ctx, "Close Test 1", { priority: "2" });
      const issueId1 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId1);

      consoleLogSpy.mockClear();
      await handleIssueCreate(ctx, "Close Test 2", { priority: "2" });
      const issueId2 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId2);

      consoleLogSpy.mockClear();
    });

    it("should close a single issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId = createdIssueIds[0];

      await handleIssueClose(ctx, [issueId], {});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.anything()
      );
    });

    it("should close multiple issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId1 = createdIssueIds[0];
      const issueId2 = createdIssueIds[1];

      await handleIssueClose(ctx, [issueId1, issueId2], {});

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
      const issueId = createdIssueIds[0];

      await handleIssueClose(ctx, [issueId, "non-existent"], {});

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
      const issueId1 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId1);

      consoleLogSpy.mockClear();
      await handleIssueCreate(ctx, "Delete Test 2", { priority: "2" });
      const issueId2 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId2);

      consoleLogSpy.mockClear();
      await handleIssueCreate(ctx, "Delete Test 3", { priority: "2" });
      const issueId3 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId3);

      consoleLogSpy.mockClear();
    });

    it("should soft delete (close) a single issue by default", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId = createdIssueIds[0];

      await handleIssueDelete(ctx, [issueId], {});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.anything()
      );

      // Verify issue is closed, not deleted
      const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId);
      expect(issue).toBeDefined();
      expect((issue as any).status).toBe("closed");
    });

    it("should hard delete (permanently remove) issue with --hard flag", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId = createdIssueIds[0];

      await handleIssueDelete(ctx, [issueId], { hard: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Permanently deleted issue"),
        expect.anything()
      );

      // Verify issue is completely removed from database
      const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId);
      expect(issue).toBeUndefined();
    });

    it("should delete multiple issues (soft delete)", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId1 = createdIssueIds[0];
      const issueId2 = createdIssueIds[1];

      await handleIssueDelete(ctx, [issueId1, issueId2], {});

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
      const issue1 = db.prepare("SELECT status FROM issues WHERE id = ?").get(issueId1);
      const issue2 = db.prepare("SELECT status FROM issues WHERE id = ?").get(issueId2);
      expect((issue1 as any).status).toBe("closed");
      expect((issue2 as any).status).toBe("closed");
    });

    it("should delete multiple issues (hard delete)", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issueId1 = createdIssueIds[0];
      const issueId2 = createdIssueIds[1];

      await handleIssueDelete(ctx, [issueId1, issueId2], { hard: true });

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
      const issue1 = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId1);
      const issue2 = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId2);
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
      const issueId1 = createdIssueIds[0];
      const issueId2 = createdIssueIds[1];

      await handleIssueDelete(ctx, [issueId1, "non-existent", issueId2], {});

      // Should succeed for existing issues
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.stringContaining(issueId1)
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Closed issue"),
        expect.stringContaining(issueId2)
      );

      // Should error for non-existent issue
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Issue not found:"),
        expect.stringContaining("non-existent")
      );
    });

    it("should output JSON with results for all operations", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const issueId1 = createdIssueIds[0];
      const issueId2 = createdIssueIds[1];

      await handleIssueDelete(ctx, [issueId1, "non-existent", issueId2], {});

      const output = consoleLogSpy.mock.calls[0][0];
      const results = JSON.parse(output);

      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        id: issueId1,
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
        id: issueId2,
        success: true,
        action: "soft_delete",
        status: "closed",
      });
    });

    it("should output JSON for hard delete", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const issueId = createdIssueIds[0];

      await handleIssueDelete(ctx, [issueId], { hard: true });

      const output = consoleLogSpy.mock.calls[0][0];
      const results = JSON.parse(output);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: issueId,
        success: true,
        action: "hard_delete",
      });
    });
  });

  describe("Markdown Sync After Operations", () => {
    it("should create markdown file when creating an issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        priority: "2",
        description: "Test description",
      };

      await handleIssueCreate(ctx, "Test Issue for MD", options);
      const issueId = extractIssueId(consoleLogSpy);

      // Check that markdown file was created
      const mdPath = path.join(tempDir, "issues", `${issueId}.md`);
      expect(fs.existsSync(mdPath)).toBe(true);

      // Verify markdown content
      const mdContent = fs.readFileSync(mdPath, "utf8");
      expect(mdContent).toContain("---");
      expect(mdContent).toContain(`id: ${issueId}`);
      expect(mdContent).toContain("title: Test Issue for MD");
      expect(mdContent).toContain("status: open");
      expect(mdContent).toContain("Test description");
    });

    it("should update markdown file when updating an issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issue first
      await handleIssueCreate(ctx, "Original Title", { priority: "2" });
      const issueId = extractIssueId(consoleLogSpy);
      consoleLogSpy.mockClear();

      // Update the issue
      const options = {
        title: "Updated Title",
        status: "in_progress",
      };
      await handleIssueUpdate(ctx, issueId, options);

      // Check that markdown file was updated
      const mdPath = path.join(tempDir, "issues", `${issueId}.md`);
      expect(fs.existsSync(mdPath)).toBe(true);

      // Verify markdown content has updated values
      const mdContent = fs.readFileSync(mdPath, "utf8");
      expect(mdContent).toContain("title: Updated Title");
      expect(mdContent).toContain("status: in_progress");
    });

    it("should update markdown file when closing an issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issue first
      await handleIssueCreate(ctx, "Issue to Close", { priority: "2" });
      const issueId = extractIssueId(consoleLogSpy);
      consoleLogSpy.mockClear();

      // Close the issue
      await handleIssueClose(ctx, [issueId], {});

      // Check that markdown file was updated
      const mdPath = path.join(tempDir, "issues", `${issueId}.md`);
      expect(fs.existsSync(mdPath)).toBe(true);

      // Verify markdown content has closed status
      const mdContent = fs.readFileSync(mdPath, "utf8");
      expect(mdContent).toContain("status: closed");
    });

    it("should preserve markdown content when updating frontmatter", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issue with content
      await handleIssueCreate(ctx, "Issue with Content", {
        priority: "2",
        description: "Original content\nMultiple lines\nOf text"
      });
      const issueId = extractIssueId(consoleLogSpy);
      consoleLogSpy.mockClear();

      // Update just the status (not content)
      await handleIssueUpdate(ctx, issueId, { status: "in_progress" });

      // Check that markdown file preserves content
      const mdPath = path.join(tempDir, "issues", `${issueId}.md`);
      const mdContent = fs.readFileSync(mdPath, "utf8");

      expect(mdContent).toContain("Original content");
      expect(mdContent).toContain("Multiple lines");
      expect(mdContent).toContain("Of text");
      expect(mdContent).toContain("status: in_progress");
    });
  });
});
