/**
 * Unit tests for sync command handlers and auto-sync direction detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  handleSync,
  handleExport,
  handleImport,
} from "../../../src/cli/sync-commands.js";
import { createSpec } from "../../../src/operations/specs.js";
import { createIssue } from "../../../src/operations/issues.js";
import { exportToJSONL } from "../../../src/export.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Helper to ensure timestamps are different between operations
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to manually set database timestamps (for testing sync direction logic)
function setDatabaseTimestamp(
  db: Database.Database,
  entityType: "spec" | "issue",
  entityId: string,
  timestamp: Date
) {
  const table = entityType === "spec" ? "specs" : "issues";
  const isoTimestamp = timestamp.toISOString();
  db.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(
    isoTimestamp,
    entityId
  );
}

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
    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-sync-test-"));
    specsDir = path.join(tempDir, "specs");
    issuesDir = path.join(tempDir, "issues");
    specsJsonl = path.join(tempDir, "specs.jsonl");
    issuesJsonl = path.join(tempDir, "issues.jsonl");

    // Create directories
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(issuesDir, { recursive: true });

    // Create config.json to mark directory as initialized (prevents auto-init during tests)
    const config = {
      version: "0.1.0",
      id_prefix: { spec: "SPEC", issue: "ISSUE" },
    };
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify(config, null, 2),
      "utf8"
    );

    // Create database at cache.db path (not in-memory) so handleSync can use it
    const dbPath = path.join(tempDir, "cache.db");
    db = initDatabase({ path: dbPath });
    db.pragma('wal_checkpoint(FULL)'); // Force file creation

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
      fs.writeFileSync(
        mdPath,
        "---\nid: SPEC-001\ntitle: Old Title\n---\n\n# Old content",
        "utf8"
      );

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

      // Make database timestamp older
      const oldTime = new Date(Date.now() - 10000);
      setDatabaseTimestamp(db, "spec", "SPEC-001", oldTime);

      await exportToJSONL(db, { outputDir: tempDir });

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
      expect(output).toContain("database empty, markdown exists");
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
      expect(output).toContain("markdown files missing, database has entries");
    });

    it("should prefer database when mixed timestamps exist", async () => {
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
        content: "# Issue content",
        status: "open",
        priority: 2,
      });

      // Make database timestamps old
      const oldDbTime = new Date(Date.now() - 20000);
      setDatabaseTimestamp(db, "spec", "SPEC-001", oldDbTime);
      setDatabaseTimestamp(db, "issue", "ISSUE-001", oldDbTime);

      await exportToJSONL(db, { outputDir: tempDir });

      // Create spec markdown (newer than db) and issue markdown (older than db)
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

      // Make issue markdown even older (older than database)
      const veryOldTime = new Date(Date.now() - 30000);
      fs.utimesSync(issueMdPath, veryOldTime, veryOldTime);

      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSync(ctx, {});

      // Should prefer database as source of truth in mixed state
      // Spec markdown is newer than database, issue markdown is older than database
      // This creates a mixed state - we prefer database to avoid conflicts
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Syncing FROM database TO markdown");
      expect(output).toContain("using database as source of truth");
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
      const hasZone =
        timestamp.endsWith("Z") ||
        timestamp.includes("+") ||
        /[+-]\d{2}:\d{2}$/.test(timestamp);
      const utcTimestamp = hasZone
        ? timestamp
        : timestamp.replace(" ", "T") + "Z";
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

      // Make database timestamp older to simulate an earlier state
      const oldTime = new Date(Date.now() - 5000);
      setDatabaseTimestamp(db, "spec", "SPEC-001", oldTime);

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

describe("Export and Import Commands", () => {
  let db: Database.Database;
  let tempDir: string;
  let outputDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-export-test-"));
    outputDir = path.join(tempDir, "output");

    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });

    // Create database at cache.db path (not in-memory) so handleSync can use it
    const dbPath = path.join(tempDir, "cache.db");
    db = initDatabase({ path: dbPath });
    db.pragma('wal_checkpoint(FULL)'); // Force file creation

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    consoleLogSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();
    processExitSpy?.mockRestore();

    if (db) {
      db.close();
    }

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("handleExport", () => {
    it("should export database to JSONL files", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create test data
      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "# Content",
        priority: 2,
      });

      createIssue(db, {
        id: "ISSUE-001",
        title: "Test Issue",
        content: "# Issue content",
        status: "open",
        priority: 1,
      });

      await handleExport(ctx, { output: outputDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Exported to JSONL")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Output: ${outputDir}`)
      );

      // Verify JSONL files were created
      expect(fs.existsSync(path.join(outputDir, "specs.jsonl"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "issues.jsonl"))).toBe(true);

      // Verify content
      const specsContent = fs.readFileSync(
        path.join(outputDir, "specs.jsonl"),
        "utf8"
      );
      expect(specsContent).toContain("SPEC-001");
      expect(specsContent).toContain("Test Spec");

      const issuesContent = fs.readFileSync(
        path.join(outputDir, "issues.jsonl"),
        "utf8"
      );
      expect(issuesContent).toContain("ISSUE-001");
      expect(issuesContent).toContain("Test Issue");
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      createSpec(db, {
        id: "SPEC-001",
        title: "Test",
        file_path: "specs/test.md",
        content: "# Test",
        priority: 2,
      });

      await handleExport(ctx, { output: outputDir });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.outputDir).toBe(outputDir);
    });

    it("should export to default directory when no output specified", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      createSpec(db, {
        id: "SPEC-001",
        title: "Test",
        file_path: "specs/test.md",
        content: "# Test",
        priority: 2,
      });

      await handleExport(ctx, { output: tempDir });

      // Should create files in specified directory
      expect(fs.existsSync(path.join(tempDir, "specs.jsonl"))).toBe(true);
    });

    it("should handle export with no data", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleExport(ctx, { output: outputDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Exported to JSONL")
      );

      // JSONL files should still be created (empty)
      expect(fs.existsSync(path.join(outputDir, "specs.jsonl"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "issues.jsonl"))).toBe(true);
    });

    it("should create output directory if it doesn't exist", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const newOutputDir = path.join(tempDir, "new-output", "nested");

      createSpec(db, {
        id: "SPEC-001",
        title: "Test",
        file_path: "specs/test.md",
        content: "# Test",
        priority: 2,
      });

      await handleExport(ctx, { output: newOutputDir });

      expect(fs.existsSync(path.join(newOutputDir, "specs.jsonl"))).toBe(true);
    });

    it("should overwrite existing JSONL files", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create initial data and export
      createSpec(db, {
        id: "SPEC-001",
        title: "First Version",
        file_path: "specs/test.md",
        content: "# First",
        priority: 2,
      });

      await handleExport(ctx, { output: outputDir });

      // Update data and export again
      const { updateSpec } = await import("../../../src/operations/specs.js");
      updateSpec(db, "SPEC-001", { title: "Second Version" });

      consoleLogSpy.mockClear();

      await handleExport(ctx, { output: outputDir });

      // Verify updated content
      const specsContent = fs.readFileSync(
        path.join(outputDir, "specs.jsonl"),
        "utf8"
      );
      expect(specsContent).toContain("Second Version");
      expect(specsContent).not.toContain("First Version");
    });
  });

  describe("handleImport", () => {
    it("should import specs and issues from JSONL files", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const inputDir = path.join(tempDir, "input");
      fs.mkdirSync(inputDir, { recursive: true });

      // Create JSONL files
      const specData = {
        id: "SPEC-001",
        title: "Imported Spec",
        file_path: "specs/imported.md",
        content: "# Imported content",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const issueData = {
        id: "ISSUE-001",
        title: "Imported Issue",
        content: "# Issue content",
        status: "open",
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(inputDir, "specs.jsonl"),
        JSON.stringify(specData) + "\n",
        "utf8"
      );

      fs.writeFileSync(
        path.join(inputDir, "issues.jsonl"),
        JSON.stringify(issueData) + "\n",
        "utf8"
      );

      await handleImport(ctx, { input: inputDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Imported from JSONL")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Input: ${inputDir}`)
      );

      // Verify data was imported
      const { getSpec } = await import("../../../src/operations/specs.js");
      const { getIssue } = await import("../../../src/operations/issues.js");

      const spec = getSpec(db, "SPEC-001");
      expect(spec).toBeDefined();
      expect(spec?.title).toBe("Imported Spec");

      const issue = getIssue(db, "ISSUE-001");
      expect(issue).toBeDefined();
      expect(issue?.title).toBe("Imported Issue");
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const inputDir = path.join(tempDir, "input");
      fs.mkdirSync(inputDir, { recursive: true });

      // Create minimal JSONL files
      fs.writeFileSync(path.join(inputDir, "specs.jsonl"), "", "utf8");
      fs.writeFileSync(path.join(inputDir, "issues.jsonl"), "", "utf8");
      fs.writeFileSync(path.join(inputDir, "relationships.jsonl"), "", "utf8");
      fs.writeFileSync(path.join(inputDir, "feedback.jsonl"), "", "utf8");

      await handleImport(ctx, { input: inputDir });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.inputDir).toBe(inputDir);
    });

    it("should handle import with empty JSONL files", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const inputDir = path.join(tempDir, "input");
      fs.mkdirSync(inputDir, { recursive: true });

      // Create empty JSONL files
      fs.writeFileSync(path.join(inputDir, "specs.jsonl"), "", "utf8");
      fs.writeFileSync(path.join(inputDir, "issues.jsonl"), "", "utf8");
      fs.writeFileSync(path.join(inputDir, "relationships.jsonl"), "", "utf8");
      fs.writeFileSync(path.join(inputDir, "feedback.jsonl"), "", "utf8");

      await handleImport(ctx, { input: inputDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Imported from JSONL")
      );

      // Database should still be valid (no specs/issues)
      const { listSpecs } = await import("../../../src/operations/specs.js");
      const { listIssues } = await import("../../../src/operations/issues.js");

      expect(listSpecs(db, {}).length).toBe(0);
      expect(listIssues(db, {}).length).toBe(0);
    });

    it("should import relationships from JSONL", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const inputDir = path.join(tempDir, "input");
      fs.mkdirSync(inputDir, { recursive: true });

      // Create spec and issue data with relationships embedded
      const specData = {
        id: "SPEC-001",
        uuid: "uuid-spec-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "# Content",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        parent_id: null,
        relationships: [],
        tags: [],
      };

      const issueData = {
        id: "ISSUE-001",
        uuid: "uuid-issue-001",
        title: "Test Issue",
        content: "# Content",
        status: "open",
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        parent_id: null,
        assignee: null,
        closed_at: null,
        relationships: [
          {
            from: "ISSUE-001",
            from_type: "issue",
            to: "SPEC-001",
            to_type: "spec",
            type: "implements",
          },
        ],
        tags: [],
      };

      fs.writeFileSync(
        path.join(inputDir, "specs.jsonl"),
        JSON.stringify(specData) + "\n",
        "utf8"
      );

      fs.writeFileSync(
        path.join(inputDir, "issues.jsonl"),
        JSON.stringify(issueData) + "\n",
        "utf8"
      );

      await handleImport(ctx, { input: inputDir });

      // Verify relationship was imported
      const { getOutgoingRelationships } = await import(
        "../../../src/operations/relationships.js"
      );
      const relationships = getOutgoingRelationships(db, "ISSUE-001", "issue");

      expect(relationships).toHaveLength(1);
      expect(relationships[0].to_id).toBe("SPEC-001");
      expect(relationships[0].relationship_type).toBe("implements");
    });

    it("should handle missing JSONL files gracefully", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const inputDir = path.join(tempDir, "input");
      fs.mkdirSync(inputDir, { recursive: true });

      // Don't create any JSONL files

      await handleImport(ctx, { input: inputDir });

      // Should not crash, though it may log warnings
      // Database should be empty
      const { listSpecs } = await import("../../../src/operations/specs.js");
      expect(listSpecs(db, {}).length).toBe(0);
    });

    it("should perform round-trip export and import correctly", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const exportDir = path.join(tempDir, "export");

      // Create test data
      createSpec(db, {
        id: "SPEC-001",
        title: "Round Trip Spec",
        file_path: "specs/roundtrip.md",
        content: "# Round trip content",
        priority: 3,
      });

      createIssue(db, {
        id: "ISSUE-001",
        title: "Round Trip Issue",
        content: "# Issue content",
        status: "in_progress",
        priority: 2,
      });

      // Add relationship
      const { addRelationship } = await import(
        "../../../src/operations/relationships.js"
      );
      addRelationship(db, {
        from_id: "ISSUE-001",
        from_type: "issue",
        to_id: "SPEC-001",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Export
      await handleExport(ctx, { output: exportDir });

      // Create new database
      const db2 = initDatabase({ path: ":memory:" });
      const ctx2 = { db: db2, outputDir: tempDir, jsonOutput: false };

      consoleLogSpy.mockClear();

      // Import into new database
      await handleImport(ctx2, { input: exportDir });

      // Verify all data was imported correctly
      const { getSpec } = await import("../../../src/operations/specs.js");
      const { getIssue } = await import("../../../src/operations/issues.js");
      const { getOutgoingRelationships } = await import(
        "../../../src/operations/relationships.js"
      );

      const spec = getSpec(db2, "SPEC-001");
      expect(spec?.title).toBe("Round Trip Spec");
      expect(spec?.priority).toBe(3);

      const issue = getIssue(db2, "ISSUE-001");
      expect(issue?.title).toBe("Round Trip Issue");
      expect(issue?.status).toBe("in_progress");
      expect(issue?.priority).toBe(2);

      const relationships = getOutgoingRelationships(db2, "ISSUE-001", "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0].relationship_type).toBe("implements");

      db2.close();
    });
  });

  describe("Auto-initialization", () => {
    let uninitDb: Database.Database;
    let uninitTempDir: string;

    beforeEach(() => {
      // Create a fresh uninitialized directory (no config.json)
      uninitDb = initDatabase({ path: ":memory:" });
      uninitTempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-uninit-test-")
      );
      // Do NOT create config.json - this directory is uninitialized
    });

    afterEach(() => {
      if (uninitDb) {
        uninitDb.close();
      }
      if (uninitTempDir && fs.existsSync(uninitTempDir)) {
        fs.rmSync(uninitTempDir, { recursive: true, force: true });
      }
    });

    it("should auto-initialize when directory is not initialized", async () => {
      const ctx = { db: uninitDb, outputDir: uninitTempDir, jsonOutput: false };

      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Initializing sudocode...");
      expect(output).toContain("✓ Initialized sudocode");

      // Verify directory structure was created
      expect(fs.existsSync(path.join(uninitTempDir, "config.json"))).toBe(true);
      expect(fs.existsSync(path.join(uninitTempDir, "cache.db"))).toBe(true);
      expect(fs.existsSync(path.join(uninitTempDir, "specs"))).toBe(true);
      expect(fs.existsSync(path.join(uninitTempDir, "issues"))).toBe(true);
      expect(fs.existsSync(path.join(uninitTempDir, "specs.jsonl"))).toBe(true);
      expect(fs.existsSync(path.join(uninitTempDir, "issues.jsonl"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(uninitTempDir, ".gitignore"))).toBe(true);
    });

    it("should proceed with sync after auto-initialization", async () => {
      const ctx = { db: uninitDb, outputDir: uninitTempDir, jsonOutput: false };

      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      // Should contain both initialization AND sync messages
      expect(output).toContain("Initializing sudocode...");
      expect(output).toContain("Detecting sync direction");
    });

    it("should not re-initialize on second sync call", async () => {
      const ctx = { db: uninitDb, outputDir: uninitTempDir, jsonOutput: false };

      // First sync - should initialize
      await handleSync(ctx, {});
      consoleLogSpy.mockClear();

      // Second sync - should NOT initialize again
      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).not.toContain("Initializing sudocode...");
      expect(output).toContain("Detecting sync direction");
    });
  });

  describe("Database Timestamp-Based Sync Direction", () => {
    it("should sync to-markdown when database is newer than markdown files", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issuesDir = path.join(tempDir, "issues");
      fs.mkdirSync(issuesDir, { recursive: true });

      // Create an issue in the database
      const issue = createIssue(db, {
        id: "i-test1",
        uuid: "test-uuid-1",
        title: "Database Issue",
        content: "Fresh from database",
        status: "open",
        priority: 2,
      });

      // Export to JSONL
      await exportToJSONL(db, { outputDir: tempDir });

      // Create a stale markdown file (older than database)
      const mdPath = path.join(issuesDir, "i-test1.md");
      const staleMdContent = `---
id: i-test1
title: Stale Title
status: open
priority: 2
---

Stale content from markdown`;
      fs.writeFileSync(mdPath, staleMdContent, "utf8");

      // Make the markdown file older by setting its mtime to the past
      const pastTime = new Date(Date.now() - 10000); // 10 seconds ago
      fs.utimesSync(mdPath, pastTime, pastTime);

      // Wait a bit to ensure different timestamps
      await sleep(100);

      // Run sync - should detect database is newer and sync to-markdown
      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("TO markdown");
      expect(output).toContain("database is newer");

      // Verify markdown file was updated with database content
      const updatedMd = fs.readFileSync(mdPath, "utf8");
      expect(updatedMd).toContain("title: Database Issue");
    });

    it("should sync from-markdown when markdown files are newer than database", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issuesDir = path.join(tempDir, "issues");
      fs.mkdirSync(issuesDir, { recursive: true });

      // Create an issue in the database with an old timestamp
      const pastTime = new Date(Date.now() - 10000); // 10 seconds ago
      const issue = createIssue(db, {
        id: "i-test2",
        uuid: "test-uuid-2",
        title: "Old Database Issue",
        content: "Old database content",
        status: "open",
        priority: 2,
        updated_at: pastTime.toISOString(),
      });

      // Export to JSONL
      await exportToJSONL(db, { outputDir: tempDir });

      // Wait a bit to ensure different timestamps
      await sleep(100);

      // Create a fresh markdown file (newer than database)
      const mdPath = path.join(issuesDir, "i-test2.md");
      const freshMdContent = `---
id: i-test2
title: Fresh Markdown Title
status: in_progress
priority: 1
---

Fresh content from markdown`;
      fs.writeFileSync(mdPath, freshMdContent, "utf8");

      // Run sync - should detect markdown is newer and sync from-markdown
      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("FROM markdown");
      expect(output).toContain("markdown files are newer");

      // Verify database was updated with markdown content
      const { getIssue } = await import("../../../src/operations/issues.js");
      const updatedIssue = getIssue(db, "i-test2");
      expect(updatedIssue?.title).toBe("Fresh Markdown Title");
      expect(updatedIssue?.status).toBe("in_progress");
    });

    it("should prefer database (to-markdown) in mixed state conflicts", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issuesDir = path.join(tempDir, "issues");
      fs.mkdirSync(issuesDir, { recursive: true });

      // Mark as initialized to prevent handleSync from re-initializing
      // (which would reset database timestamps and break the test scenario)
      fs.writeFileSync(path.join(tempDir, "config.json"), JSON.stringify({ version: "0.1.0" }));
      fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });

      // Create two issues with different states
      const pastTime = new Date(Date.now() - 10000);

      // Issue 1: Database is newer
      const issue1 = createIssue(db, {
        id: "i-conf1",
        uuid: "conf-uuid-1",
        title: "Database Newer",
        content: "DB is fresh",
        status: "open",
        priority: 2,
      });

      // Issue 2: Markdown will be newer (created with old timestamp in DB)
      const issue2 = createIssue(db, {
        id: "i-conf2",
        uuid: "conf-uuid-2",
        title: "Old in DB",
        content: "DB is old",
        status: "open",
        priority: 2,
        updated_at: pastTime.toISOString(),
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // Create stale markdown for issue1
      const md1Path = path.join(issuesDir, "i-conf1.md");
      fs.writeFileSync(md1Path, `---\nid: i-conf1\ntitle: Stale\n---\nStale`, "utf8");
      fs.utimesSync(md1Path, pastTime, pastTime);

      await sleep(100);

      // Create fresh markdown for issue2
      const md2Path = path.join(issuesDir, "i-conf2.md");
      fs.writeFileSync(md2Path, `---\nid: i-conf2\ntitle: Fresh MD\n---\nFresh`, "utf8");

      await sleep(1100); // Sleep longer to ensure timestamp difference (filesystem may have 1s resolution)

      // Touch JSONL to make it newer than all markdown files
      // This simulates database being the source of truth
      const jsonlPath = path.join(tempDir, "issues.jsonl");
      const now = new Date();
      fs.utimesSync(jsonlPath, now, now);

      // Run sync - should prefer database as source of truth in conflict
      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("TO markdown");
      expect(output).toContain("database is newer");

      // Verify issue1's markdown was updated from database
      const md1Content = fs.readFileSync(md1Path, "utf8");
      expect(md1Content).toContain("title: Database Newer");
    });

    it("should handle no-sync when everything is in sync", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issuesDir = path.join(tempDir, "issues");
      fs.mkdirSync(issuesDir, { recursive: true });

      // Create issue and export
      const issue = createIssue(db, {
        id: "i-sync",
        uuid: "sync-uuid",
        title: "Synced Issue",
        content: "Synced content",
        status: "open",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: tempDir });

      // Create markdown matching database
      const mdPath = path.join(issuesDir, "i-sync.md");
      const { getIssue } = await import("../../../src/operations/issues.js");
      const dbIssue = getIssue(db, "i-sync");

      const mdContent = `---
id: i-sync
title: Synced Issue
status: open
priority: 2
created_at: ${dbIssue?.created_at}
updated_at: ${dbIssue?.updated_at}
---

Synced content`;
      fs.writeFileSync(mdPath, mdContent, "utf8");

      // Set markdown file time to match database updated_at
      const dbTime = new Date(dbIssue!.updated_at);
      fs.utimesSync(mdPath, dbTime, dbTime);

      // Run sync - should detect no sync needed
      await handleSync(ctx, {});

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("in sync");
    });
  });
});
