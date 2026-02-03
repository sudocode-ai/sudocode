/**
 * TDD tests for markdown sync file finding and renaming behavior
 *
 * These tests validate:
 * 1. Finding existing files by ID via frontmatter scan (regardless of filename)
 * 2. Renaming files when title changes
 * 3. No duplicate files created
 *
 * Issue: i-8wlr
 * Spec: s-72iq
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { initDatabase } from "../../src/db.js";
import {
  findExistingEntityFile,
  generateUniqueFilename,
} from "../../src/filename-generator.js";
import { createIssue, updateIssue, getIssue } from "../../src/operations/issues.js";
import { exportToJSONL } from "../../src/export.js";
import { handleSync } from "../../src/cli/sync-commands.js";
import type Database from "better-sqlite3";

describe("Sync Rename Behavior", () => {
  let tempDir: string;
  let db: Database.Database;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-rename-test-"));
    db = initDatabase({ path: ":memory:" });

    // Create directory structure
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "issues"), { recursive: true });

    // Create config.json to mark as initialized
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({ version: "0.1.0" }),
      "utf8"
    );

    // Spy on console
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();

    if (db) {
      db.close();
    }

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("findExistingEntityFile - directory scan fallback", () => {
    it("should find file by ID in frontmatter when title is completely different", () => {
      const issuesDir = path.join(tempDir, "issues");

      // Create a file with OLD title in filename
      const oldFilename = "i-test123_old_original_title.md";
      const filePath = path.join(issuesDir, oldFilename);
      fs.writeFileSync(
        filePath,
        `---
id: i-test123
title: Old Original Title
status: open
priority: 2
---

Content here`,
        "utf8"
      );

      // Search with a COMPLETELY DIFFERENT title
      const found = findExistingEntityFile(
        "i-test123",
        issuesDir,
        "Completely Different New Title"
      );

      // Should find the file via directory scan (frontmatter ID match)
      expect(found).toBe(filePath);
    });

    it("should find file even when filename has no title slug (legacy format)", () => {
      const issuesDir = path.join(tempDir, "issues");

      // Create legacy format file
      const filePath = path.join(issuesDir, "i-legacy.md");
      fs.writeFileSync(
        filePath,
        `---
id: i-legacy
title: Some Title
status: open
---

Content`,
        "utf8"
      );

      // Search with different title
      const found = findExistingEntityFile(
        "i-legacy",
        issuesDir,
        "Totally Different Title"
      );

      expect(found).toBe(filePath);
    });

    it("should not find file when ID doesn't match", () => {
      const issuesDir = path.join(tempDir, "issues");

      // Create a file with different ID
      fs.writeFileSync(
        path.join(issuesDir, "i-other_some_title.md"),
        `---
id: i-other
title: Some Title
status: open
---

Content`,
        "utf8"
      );

      // Search for non-existent ID
      const found = findExistingEntityFile(
        "i-nonexistent",
        issuesDir,
        "Some Title"
      );

      expect(found).toBeNull();
    });
  });

  describe("File rename on title change", () => {
    it("should rename markdown file when issue title changes via sync", async () => {
      const issuesDir = path.join(tempDir, "issues");
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issue with original title
      createIssue(db, {
        id: "i-rename1",
        uuid: "uuid-rename1",
        title: "Original Title Here",
        content: "Test content",
        status: "open",
        priority: 2,
      });

      // Export and sync to create markdown file
      await exportToJSONL(db, { outputDir: tempDir });
      await handleSync(ctx, { toMarkdown: true });

      // Verify original file exists
      const originalFilename = generateUniqueFilename("Original Title Here", "i-rename1");
      const originalPath = path.join(issuesDir, originalFilename);
      expect(fs.existsSync(originalPath)).toBe(true);

      // Update title in database
      updateIssue(db, "i-rename1", { title: "New Updated Title" });
      await exportToJSONL(db, { outputDir: tempDir });

      // Sync again - should rename the file
      await handleSync(ctx, { toMarkdown: true });

      // Verify: Original file should NOT exist
      expect(fs.existsSync(originalPath)).toBe(false);

      // Verify: New file SHOULD exist with new title
      const newFilename = generateUniqueFilename("New Updated Title", "i-rename1");
      const newPath = path.join(issuesDir, newFilename);
      expect(fs.existsSync(newPath)).toBe(true);

      // Verify: Content should have new title in frontmatter
      const content = fs.readFileSync(newPath, "utf8");
      expect(content).toContain("title: New Updated Title");
      expect(content).toContain("id: i-rename1");
    });

    it("should rename file when title changes via CLI issue update", async () => {
      const issuesDir = path.join(tempDir, "issues");

      // Create issue and initial markdown
      createIssue(db, {
        id: "i-cliupd",
        uuid: "uuid-cliupd",
        title: "CLI Original Title",
        content: "Test content",
        status: "open",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // Create the markdown file manually (simulating initial sync)
      const originalFilename = generateUniqueFilename("CLI Original Title", "i-cliupd");
      const originalPath = path.join(issuesDir, originalFilename);
      fs.writeFileSync(
        originalPath,
        `---
id: i-cliupd
title: CLI Original Title
status: open
priority: 2
---

Test content`,
        "utf8"
      );

      // Import handleIssueUpdate and call it (simulating CLI)
      const { handleIssueUpdate } = await import("../../src/cli/issue-commands.js");
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueUpdate(ctx, "i-cliupd", { title: "CLI New Title" });

      // Verify: Original file should NOT exist
      expect(fs.existsSync(originalPath)).toBe(false);

      // Verify: New file SHOULD exist
      const newFilename = generateUniqueFilename("CLI New Title", "i-cliupd");
      const newPath = path.join(issuesDir, newFilename);
      expect(fs.existsSync(newPath)).toBe(true);

      // Verify content
      const content = fs.readFileSync(newPath, "utf8");
      expect(content).toContain("title: CLI New Title");
    });
  });

  describe("No duplicates on title change", () => {
    it("should have only ONE markdown file after multiple title changes", async () => {
      const issuesDir = path.join(tempDir, "issues");
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create issue
      createIssue(db, {
        id: "i-multi",
        uuid: "uuid-multi",
        title: "Title Version 1",
        content: "Content",
        status: "open",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });
      await handleSync(ctx, { toMarkdown: true });

      // Update title multiple times
      const titles = [
        "Title Version 2",
        "Title Version 3",
        "Final Title Version",
      ];

      for (const newTitle of titles) {
        updateIssue(db, "i-multi", { title: newTitle });
        await exportToJSONL(db, { outputDir: tempDir });
        await handleSync(ctx, { toMarkdown: true });
      }

      // Count files with this issue ID in frontmatter
      const files = fs.readdirSync(issuesDir);
      const matchingFiles = files.filter((file) => {
        if (!file.endsWith(".md")) return false;
        const content = fs.readFileSync(path.join(issuesDir, file), "utf8");
        return content.includes("id: i-multi");
      });

      // Should be exactly ONE file
      expect(matchingFiles).toHaveLength(1);

      // That file should have the final title
      const finalFilename = generateUniqueFilename("Final Title Version", "i-multi");
      expect(matchingFiles[0]).toBe(finalFilename);
    });

    it("should not create duplicate when issue update is called without sync", async () => {
      const issuesDir = path.join(tempDir, "issues");

      // Create issue with markdown
      createIssue(db, {
        id: "i-nodup",
        uuid: "uuid-nodup",
        title: "Original No Dup",
        content: "Content",
        status: "open",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // Manually create the markdown file
      const originalPath = path.join(
        issuesDir,
        generateUniqueFilename("Original No Dup", "i-nodup")
      );
      fs.writeFileSync(
        originalPath,
        `---
id: i-nodup
title: Original No Dup
status: open
---

Content`,
        "utf8"
      );

      // Update via CLI (which currently creates duplicate - this test should fail until fixed)
      const { handleIssueUpdate } = await import("../../src/cli/issue-commands.js");
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleIssueUpdate(ctx, "i-nodup", { title: "Updated No Dup" });

      // Count all markdown files
      const allMdFiles = fs.readdirSync(issuesDir).filter((f) => f.endsWith(".md"));

      // Should be exactly ONE file (not two!)
      expect(allMdFiles).toHaveLength(1);
    });
  });

  describe("Orphan detection", () => {
    it("should detect multiple files with same ID as orphans", () => {
      const issuesDir = path.join(tempDir, "issues");

      // Create TWO files with the same ID (simulating the bug)
      const file1 = path.join(issuesDir, "i-orphan.md");
      const file2 = path.join(issuesDir, "i-orphan_some_old_title.md");

      const content = `---
id: i-orphan
title: Test
status: open
---

Content`;

      fs.writeFileSync(file1, content, "utf8");
      fs.writeFileSync(file2, content, "utf8");

      // Helper function to find all files with given ID
      const findAllFilesWithId = (id: string, dir: string): string[] => {
        const files = fs.readdirSync(dir);
        return files.filter((file) => {
          if (!file.endsWith(".md")) return false;
          const content = fs.readFileSync(path.join(dir, file), "utf8");
          const idMatch = content.match(/^id:\s*['"]?([^'"\n]+)['"]?\s*$/m);
          return idMatch && idMatch[1] === id;
        });
      };

      const duplicates = findAllFilesWithId("i-orphan", issuesDir);

      // Should detect both files
      expect(duplicates).toHaveLength(2);
      expect(duplicates).toContain("i-orphan.md");
      expect(duplicates).toContain("i-orphan_some_old_title.md");
    });
  });
});
