/**
 * Unit tests for sync command handlers and auto-sync direction detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import { handleSync } from "../../../src/cli/sync-commands.js";
import { createSpec } from "../../../src/operations/specs.js";
import { createIssue } from "../../../src/operations/issues.js";
import { exportToJSONL } from "../../../src/export.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Helper to ensure timestamps are different between operations
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Sync Commands - Auto Direction Detection", () => {
  let db: Database.Database;
  let tempDir: string;
  let specsDir: string;
  let issuesDir: string;
  let specsJsonl: string;
  let issuesJsonl: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ":memory:" });

    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-sync-test-"));
    specsDir = path.join(tempDir, "specs");
    issuesDir = path.join(tempDir, "issues");
    specsJsonl = path.join(tempDir, "specs.jsonl");
    issuesJsonl = path.join(tempDir, "issues.jsonl");

    // Create directories
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(issuesDir, { recursive: true });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore spies
    consoleLogSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();

    // Close database
    if (db) {
      db.close();
    }

    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Sync direction detection", () => {
    it("should sync TO markdown when JSONL is newer", async () => {
      // Create spec in database
      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "# Test content",
        priority: 2,
      });

      // Export to JSONL (making it fresh)
      await exportToJSONL(db, { outputDir: tempDir });

      // Create an older markdown file
      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(mdPath, "---\nid: SPEC-001\ntitle: Old Title\n---\n\n# Old content", "utf8");

      // Make markdown file older by modifying its timestamp
      const oldTime = new Date(Date.now() - 10000); // 10 seconds ago
      fs.utimesSync(mdPath, oldTime, oldTime);

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSync(ctx, {});

      // Should have synced TO markdown
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing FROM database TO markdown");
      expect(output).toContain("database is newer");
    });

    it("should sync FROM markdown when markdown is newer", async () => {
      // Create spec in database and export to JSONL
      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "# Test content",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // Make JSONL file older
      const oldTime = new Date(Date.now() - 10000);
      fs.utimesSync(specsJsonl, oldTime, oldTime);
      fs.utimesSync(issuesJsonl, oldTime, oldTime);

      // Create newer markdown file
      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: Updated Title\nfile_path: specs/test.md\n---\n\n# Updated content",
        "utf8"
      );

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSync(ctx, {});

      // Should have synced FROM markdown
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing FROM markdown TO database");
      expect(output).toContain("markdown is newer");
    });

    it("should report no-sync when no files exist", async () => {
      // Empty database, no JSONL, no markdown files
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Everything is in sync");
    });

    it("should sync FROM markdown when only markdown exists", async () => {
      // Create markdown file only (no JSONL)
      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: New Spec\nfile_path: specs/test.md\npriority: 2\n---\n\n# Content",
        "utf8"
      );

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing FROM markdown TO database");
      expect(output).toContain("JSONL missing, markdown exists");
    });

    it("should sync TO markdown when only JSONL exists", async () => {
      // Create spec in database and export
      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "# Test content",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // No markdown files exist
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing FROM database TO markdown");
      expect(output).toContain("markdown files missing, JSONL exists");
    });

    it("should prefer markdown when mixed timestamps exist", async () => {
      // Create spec and issue in database
      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test-spec.md",
        content: "# Spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "ISSUE-001",
        title: "Test Issue",
        description: "Issue desc",
        content: "# Issue content",
        status: "open",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // Make JSONL files old
      const oldJsonlTime = new Date(Date.now() - 20000);
      fs.utimesSync(specsJsonl, oldJsonlTime, oldJsonlTime);
      fs.utimesSync(issuesJsonl, oldJsonlTime, oldJsonlTime);

      // Create spec markdown (newer) and issue markdown (older than JSONL)
      const specMdPath = path.join(specsDir, "test-spec.md");
      fs.writeFileSync(
        specMdPath,
        "---\nid: SPEC-001\ntitle: Updated Spec\nfile_path: specs/test-spec.md\n---\n\n# Updated spec",
        "utf8"
      );

      const issueMdPath = path.join(issuesDir, "ISSUE-001.md");
      fs.writeFileSync(
        issueMdPath,
        "---\nid: ISSUE-001\ntitle: Old Issue\nstatus: open\n---\n\n# Old issue",
        "utf8"
      );

      // Make issue markdown even older (older than JSONL)
      const veryOldTime = new Date(Date.now() - 30000);
      fs.utimesSync(issueMdPath, veryOldTime, veryOldTime);

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSync(ctx, {});

      // Should prefer markdown as source (safer for user edits)
      // Spec markdown is newer than JSONL, issue markdown is older than JSONL
      // This creates a mixed state - we prefer markdown
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing FROM markdown TO database");
      expect(output).toContain("choosing markdown as source");
    });
  });

  describe("Content stability across syncs", () => {
    it("should set JSONL file mtime to match content timestamps", async () => {
      // This test verifies that JSONL files get their mtime set to match
      // the newest updated_at timestamp in their contents, which improves
      // sync direction detection accuracy.

      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "# Content",
        priority: 2,
      });

      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "SPEC-001");

      // Parse timestamp with same logic as jsonl.ts (SQLite returns UTC without 'Z')
      const timestamp = String(spec!.updated_at);
      const hasZone = timestamp.endsWith('Z') || timestamp.includes('+') || /[+-]\d{2}:\d{2}$/.test(timestamp);
      const utcTimestamp = hasZone ? timestamp : timestamp.replace(' ', 'T') + 'Z';
      const specUpdatedAt = new Date(utcTimestamp).getTime();

      // Export to JSONL
      await exportToJSONL(db, { outputDir: tempDir });

      // Check that JSONL file mtime matches the spec's updated_at
      const jsonlPath = path.join(tempDir, "specs.jsonl");
      const jsonlStat = fs.statSync(jsonlPath);
      const jsonlMtime = jsonlStat.mtimeMs;

      // Allow 1 second tolerance for filesystem precision
      const timeDiff = Math.abs(jsonlMtime - specUpdatedAt);
      expect(timeDiff).toBeLessThan(1000);
    });

    it("should preserve content across multiple sync operations", async () => {
      // Create spec with specific content
      const originalContent = "# Original Content\n\nThis should be preserved.";
      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: originalContent,
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(
        mdPath,
        `---\nid: SPEC-001\ntitle: Test Spec\nfile_path: specs/test.md\npriority: 2\n---\n\n${originalContent}`,
        "utf8"
      );

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Run sync multiple times to ensure content stability
      await handleSync(ctx, {});
      await sleep(100);
      await handleSync(ctx, {});
      await sleep(100);
      await handleSync(ctx, {});

      // Read final markdown content
      const finalContent = fs.readFileSync(mdPath, "utf8");

      // Content should be preserved (no data loss from syncing)
      expect(finalContent).toContain(originalContent);
      expect(finalContent).toContain("Test Spec");
      expect(finalContent).toContain("SPEC-001");

      // Verify database also has correct content
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "SPEC-001");
      // Use toContain for content since there may be whitespace differences
      expect(spec?.content).toContain("# Original Content");
      expect(spec?.content).toContain("This should be preserved");
      expect(spec?.title).toBe("Test Spec");
    });
  });

  describe("Manual sync overrides", () => {
    it("should respect --from-markdown flag regardless of timestamps", async () => {
      // Create newer JSONL
      createSpec(db, {
        id: "SPEC-001",
        title: "DB Spec",
        file_path: "specs/test.md",
        content: "# DB content",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // Create older markdown
      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: Markdown Spec\nfile_path: specs/test.md\n---\n\n# Markdown content",
        "utf8"
      );

      const oldTime = new Date(Date.now() - 10000);
      fs.utimesSync(mdPath, oldTime, oldTime);

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Force from-markdown
      await handleSync(ctx, { fromMarkdown: true });

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing from markdown to database");

      // Verify markdown content was synced
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "SPEC-001");
      expect(spec?.title).toBe("Markdown Spec");
      expect(spec?.content).toContain("# Markdown content");
    });

    it("should respect --to-markdown flag regardless of timestamps", async () => {
      // Create older JSONL
      createSpec(db, {
        id: "SPEC-001",
        title: "DB Spec",
        file_path: "specs/test.md",
        content: "# DB content",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      const oldTime = new Date(Date.now() - 10000);
      fs.utimesSync(specsJsonl, oldTime, oldTime);
      fs.utimesSync(issuesJsonl, oldTime, oldTime);

      // Create newer markdown
      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: Markdown Spec\nfile_path: specs/test.md\n---\n\n# Markdown content",
        "utf8"
      );

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Force to-markdown
      await handleSync(ctx, { toMarkdown: true });

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing from database to markdown");

      // Verify database content was synced to markdown
      const { parseMarkdownFile } = await import("../../../src/markdown.js");
      const parsed = parseMarkdownFile(mdPath, db, tempDir);
      expect(parsed.data.title).toBe("DB Spec");
      // Note: syncJSONLToMarkdown preserves existing content, only updates frontmatter
      expect(parsed.content).toContain("# Markdown content");
    });
  });

  describe("Real-world scenarios", () => {
    it("should sync correctly after user edits markdown file", async () => {
      // Initial setup
      createSpec(db, {
        id: "SPEC-001",
        title: "Original Title",
        file_path: "specs/test.md",
        content: "# Original content",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: Original Title\nfile_path: specs/test.md\n---\n\n# Original content",
        "utf8"
      );

      // Simulate user editing the markdown file
      await new Promise((resolve) => setTimeout(resolve, 10));
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: User Edited Title\nfile_path: specs/test.md\n---\n\n# User edited content",
        "utf8"
      );

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Sync should detect markdown is newer and sync it
      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("FROM markdown TO database");

      // Verify user edits were synced to database
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "SPEC-001");
      expect(spec?.title).toBe("User Edited Title");
      expect(spec?.content).toContain("# User edited content");
    });

    it("should sync correctly after external tool updates JSONL", async () => {
      // Create initial markdown
      const mdPath = path.join(specsDir, "test.md");
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: Markdown Title\nfile_path: specs/test.md\npriority: 2\n---\n\n# Markdown content",
        "utf8"
      );

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // First sync: markdown -> database
      await handleSync(ctx, { fromMarkdown: true });

      // Simulate external tool updating database
      const { updateSpec } = await import("../../../src/operations/specs.js");
      updateSpec(db, "SPEC-001", {
        title: "External Tool Updated Title",
        content: "# External tool content",
      });

      // Export to JSONL (simulating external tool sync)
      await exportToJSONL(db, { outputDir: tempDir });

      // Make markdown older
      const oldTime = new Date(Date.now() - 10000);
      fs.utimesSync(mdPath, oldTime, oldTime);

      // Sync should detect JSONL is newer and sync it
      consoleLogSpy.mockClear();
      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("FROM database TO markdown");

      // Verify external updates were synced to markdown
      const { parseMarkdownFile } = await import("../../../src/markdown.js");
      const parsed = parseMarkdownFile(mdPath, db, tempDir);
      expect(parsed.data.title).toBe("External Tool Updated Title");
    });
  });
});
