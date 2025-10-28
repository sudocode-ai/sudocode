/**
 * Unit tests for file watcher
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../src/db.js";
import { startWatcher } from "../../src/watcher.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getSpecByFilePath } from "../../src/operations/specs.js";

describe("File Watcher", () => {
  let db: Database.Database;
  let tempDir: string;
  let control: ReturnType<typeof startWatcher> | null = null;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ":memory:" });

    // Create temporary directory for files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-watcher-test-"));

    // Create directory structure
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "issues"), { recursive: true });

    // Create empty JSONL files
    fs.writeFileSync(path.join(tempDir, "specs.jsonl"), "", "utf8");
    fs.writeFileSync(path.join(tempDir, "issues.jsonl"), "", "utf8");

    // Create config.json
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
  });

  afterEach(async () => {
    // Stop watcher if it's running
    if (control) {
      await control.stop();
      control = null;
    }

    // Close database
    db.close();

    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("startWatcher", () => {
    it("should start watching files and return control object", async () => {
      const logs: string[] = [];

      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100, // Shorter delay for tests
        onLog: (msg) => logs.push(msg),
        onError: (err) => console.error(err),
      });

      expect(control).toBeDefined();
      expect(control.stop).toBeDefined();
      expect(control.getStats).toBeDefined();

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check that watcher is ready
      expect(logs.some((log) => log.includes("Watching"))).toBe(true);

      const stats = control.getStats();
      expect(stats.filesWatched).toBeGreaterThan(0);
    });

    it("should detect new markdown files", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create a markdown file BEFORE starting watcher
      const specPath = path.join(tempDir, "specs", "test-spec.md");
      const content = `---
id: spec-001
title: Test Spec
type: feature
status: draft
priority: 2
---

# Test Spec

This is a test spec.
`;
      fs.writeFileSync(specPath, content, "utf8");

      // Start watcher with ignoreInitial: false to detect existing files
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false, // Detect existing files
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to start and process initial files
      // Need to wait for: awaitWriteFinish (300ms) + debounce (100ms) + processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Debug
      if (errors.length > 0) {
        console.log(
          "Errors:",
          errors.map((e) => e.message)
        );
      }

      // Check that file was detected
      const syncLogs = logs.filter(
        (log) => log.includes("Synced") || log.includes("[watch]")
      );
      expect(syncLogs.length).toBeGreaterThan(0);
    });

    it.skip("should detect changes to markdown files (timing-sensitive, verify manually)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];
      let watcherReady = false;

      // Start watcher first
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: true, // Ignore initial files
        onLog: (msg) => {
          logs.push(msg);
          if (msg.includes("Watching")) {
            watcherReady = true;
          }
        },
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      let waited = 0;
      while (!watcherReady && waited < 3000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waited += 100;
      }

      // Additional buffer
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create a new file AFTER watcher starts (so it will be detected)
      const specPath = path.join(tempDir, "specs", "test-spec-change.md");
      const content = `---
id: spec-002
title: Test Spec Change
type: feature
status: draft
priority: 2
---

# Test Spec

Initial content.
`;
      fs.writeFileSync(specPath, content, "utf8");

      // Wait for file to be detected
      // awaitWriteFinish (100ms) + debounce (100ms) + processing + buffer
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Debug
      if (errors.length > 0) {
        console.log(
          "Change test errors:",
          errors.map((e) => e.message)
        );
      }

      // Verify file was detected
      const addLogs = logs.filter(
        (log) => log.includes("Synced") || log.includes("add")
      );
      expect(addLogs.length).toBeGreaterThan(0);
    });

    it.skip("should debounce rapid changes (timing-sensitive, verify manually)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];
      let watcherReady = false;

      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 500, // Longer debounce for testing
        ignoreInitial: true,
        onLog: (msg) => {
          logs.push(msg);
          if (msg.includes("Watching")) {
            watcherReady = true;
          }
        },
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      let waited = 0;
      while (!watcherReady && waited < 3000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waited += 100;
      }

      // Additional buffer
      await new Promise((resolve) => setTimeout(resolve, 500));

      const initialProcessed = control.getStats().changesProcessed;

      // Create a file and modify it rapidly
      const specPath = path.join(tempDir, "specs", "test-debounce.md");
      const baseContent = `---
id: spec-003
title: Test Debounce
type: feature
status: draft
priority: 2
---

# Test Spec

Content version: `;

      // Write file multiple times in rapid succession (faster than debounce delay)
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(specPath, baseContent + i, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms between writes
      }

      // Wait for debounce and processing
      // awaitWriteFinish (100ms) + debounce (500ms) + processing time + buffer
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Debug
      if (errors.length > 0) {
        console.log(
          "Debounce test errors:",
          errors.map((e) => e.message)
        );
      }

      // Should only process once or twice due to debouncing (definitely < 5)
      const stats = control.getStats();
      const changesProcessed = stats.changesProcessed - initialProcessed;
      expect(changesProcessed).toBeLessThanOrEqual(2);
      expect(changesProcessed).toBeGreaterThan(0);
    });

    it("should delete spec from database when file is deleted", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create a markdown file BEFORE starting watcher
      const specPath = path.join(tempDir, "specs", "test-delete.md");
      const content = `---
id: spec-delete-001
title: Test Delete Spec
type: feature
status: draft
priority: 2
file_path: specs/test-delete.md
---

# Test Delete Spec

This spec will be deleted.
`;
      fs.writeFileSync(specPath, content, "utf8");

      // Start watcher with ignoreInitial: false to detect and sync the file
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false, // Detect existing files
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to start and process initial file
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Import getSpec to verify the spec exists
      const { getSpec } = await import("../../src/operations/specs.js");

      // Verify spec was created in database
      let spec = getSpec(db, "spec-delete-001");
      expect(spec).not.toBeNull();
      expect(spec?.title).toBe("Test Delete Spec");

      // Verify spec exists in JSONL
      const jsonlPath = path.join(tempDir, "specs.jsonl");
      let jsonlContent = fs.readFileSync(jsonlPath, "utf8");
      expect(jsonlContent).toContain("spec-delete-001");

      // Delete the markdown file
      fs.unlinkSync(specPath);

      // Wait for deletion to be processed
      // awaitWriteFinish + debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify spec was deleted from database
      spec = getSpec(db, "spec-delete-001");
      expect(spec).toBeNull();

      // Verify spec was removed from JSONL
      jsonlContent = fs.readFileSync(jsonlPath, "utf8");
      expect(jsonlContent).not.toContain("spec-delete-001");

      // Verify deletion was logged
      expect(
        logs.some((log) => log.includes("Deleted spec spec-delete-001"))
      ).toBe(true);
      expect(logs.some((log) => log.includes("unlink"))).toBe(true);

      // No errors should occur
      expect(errors.length).toBe(0);
    });

    it("should handle deletion of spec without frontmatter (identified by file path)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create a markdown file WITHOUT frontmatter BEFORE starting watcher
      const specPath = path.join(tempDir, "specs", "no-frontmatter-delete.md");
      const content = `# No Frontmatter Delete Test

This spec has no frontmatter and will be deleted.
`;
      fs.writeFileSync(specPath, content, "utf8");

      // Start watcher with ignoreInitial: false to detect and sync the file
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false, // Detect existing files
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to start and process initial file
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify spec was auto-created in database (by file path)
      const relPath = "specs/no-frontmatter-delete.md";
      let spec = getSpecByFilePath(db, relPath);
      expect(spec).not.toBeNull();
      const specId = spec?.id;
      expect(specId).toBeDefined();

      // Verify spec exists in JSONL
      const jsonlPath = path.join(tempDir, "specs.jsonl");
      let jsonlContent = fs.readFileSync(jsonlPath, "utf8");
      expect(jsonlContent).toContain(specId!);

      // Delete the markdown file
      fs.unlinkSync(specPath);

      // Wait for deletion to be processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify spec was deleted from database (by file path lookup)
      spec = getSpecByFilePath(db, relPath);
      expect(spec).toBeNull();

      // Verify spec was removed from JSONL
      jsonlContent = fs.readFileSync(jsonlPath, "utf8");
      expect(jsonlContent).not.toContain(specId!);

      // Verify deletion was logged
      expect(logs.some((log) => log.includes(`Deleted spec ${specId}`))).toBe(
        true
      );
      expect(logs.some((log) => log.includes("unlink"))).toBe(true);

      // No errors should occur
      expect(errors.length).toBe(0);
    });

    it("should stop cleanly", async () => {
      const logs: string[] = [];

      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        onLog: (msg) => logs.push(msg),
        onError: (err) => console.error(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Stop watcher
      await control.stop();

      // Check logs for stop message
      expect(logs.some((log) => log.includes("Stopping watcher"))).toBe(true);
      expect(logs.some((log) => log.includes("Watcher stopped"))).toBe(true);

      // Verify stats show no pending changes
      const stats = control.getStats();
      expect(stats.changesPending).toBe(0);
    });
  });

  describe("Reverse Sync (JSONL → Markdown)", () => {
    it("should sync JSONL changes to markdown when enabled", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Start watcher with reverse sync enabled
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: true,
        syncJSONLToMarkdown: true, // Enable reverse sync
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Write an issue directly to JSONL (simulating git pull)
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = {
        id: "issue-001",
        uuid: "test-uuid-001",
        title: "Test Issue from JSONL",
        status: "open",
        priority: 2,
        content: "Issue content from JSONL.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(issueData) + "\n",
        "utf8"
      );

      // Wait for JSONL change to be detected and processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify markdown file was created
      const issueMdPath = path.join(tempDir, "issues", "issue-001.md");
      expect(fs.existsSync(issueMdPath)).toBe(true);

      // Verify markdown content
      const mdContent = fs.readFileSync(issueMdPath, "utf8");
      expect(mdContent).toContain("id: issue-001");
      expect(mdContent).toContain("title: Test Issue from JSONL");
      expect(mdContent).toContain("Issue content from JSONL");

      // Verify logs show the sync
      expect(logs.some((log) => log.includes("Imported JSONL"))).toBe(true);
      expect(logs.some((log) => log.includes("Synced issue issue-001"))).toBe(
        true
      );

      expect(errors.length).toBe(0);
    });

    it("should NOT sync JSONL changes to markdown when disabled", async () => {
      const logs: string[] = [];

      // Start watcher with reverse sync DISABLED (default)
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: true,
        syncJSONLToMarkdown: false, // Explicitly disabled
        onLog: (msg) => logs.push(msg),
        onError: (err) => console.error(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Write an issue directly to JSONL
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = {
        id: "issue-002",
        uuid: "test-uuid-002",
        title: "Test Issue No Sync",
        status: "open",
        priority: 2,
        content: "Issue content.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(issueData) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify markdown file was NOT created
      const issueMdPath = path.join(tempDir, "issues", "issue-002.md");
      expect(fs.existsSync(issueMdPath)).toBe(false);

      // Verify logs show import but NOT markdown sync
      expect(logs.some((log) => log.includes("Imported JSONL"))).toBe(true);
      expect(logs.some((log) => log.includes("Synced issue"))).toBe(false);
    });
  });

  describe("Content Matching (Oscillation Prevention)", () => {
    it("should skip markdown sync when content matches (prevents oscillation)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create initial markdown file
      const issuePath = path.join(tempDir, "issues", "issue-match-001.md");
      const issueContent = `---
id: issue-match-001
title: Test Content Match
description: Test description
status: open
priority: 2
---

# Test Content Match

This is the issue content.
`;
      fs.writeFileSync(issuePath, issueContent, "utf8");

      // Start watcher to import the file
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false,
        syncJSONLToMarkdown: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial import
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Clear logs to track next changes
      logs.length = 0;

      // Modify JSONL file (simulating external change)
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const jsonlContent = fs.readFileSync(issuesJsonlPath, "utf8");
      fs.writeFileSync(issuesJsonlPath, jsonlContent, "utf8"); // Touch the file

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should see "All markdown files are up to date" because content matches
      expect(
        logs.some((log) => log.includes("All markdown files are up to date"))
      ).toBe(true);

      // Should NOT see a sync log for this issue
      expect(
        logs.some((log) => log.includes("Synced issue issue-match-001"))
      ).toBe(false);

      expect(errors.length).toBe(0);
    });

    it("should skip database sync when markdown content matches (prevents oscillation)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create initial markdown file
      const issuePath = path.join(tempDir, "issues", "issue-match-002.md");
      const issueContent = `---
id: issue-match-002
title: Test Markdown Match
status: open
priority: 2
---

# Test Markdown Match

This is the issue content.
`;
      fs.writeFileSync(issuePath, issueContent, "utf8");

      // Start watcher to import the file
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false,
        syncJSONLToMarkdown: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial import
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Clear logs to track next changes
      logs.length = 0;

      // Touch the markdown file (no actual content change)
      fs.utimesSync(issuePath, new Date(), new Date());

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(errors.length).toBe(0);
    });

    it.skip("should sync when content actually differs (timing-sensitive, verify manually)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create initial markdown file
      const issuePath = path.join(tempDir, "issues", "issue-diff-001.md");
      const issueContent = `---
id: issue-diff-001
title: Test Content Diff
status: open
priority: 2
---

# Test Content Diff

Original content.
`;
      fs.writeFileSync(issuePath, issueContent, "utf8");

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false,
        syncJSONLToMarkdown: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial import
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Clear logs
      logs.length = 0;

      // Actually change the content
      const updatedContent = `---
id: issue-diff-001
title: Test Content Diff UPDATED
status: in_progress
priority: 1
---

# Test Content Diff UPDATED

Updated content.
`;
      fs.writeFileSync(issuePath, updatedContent, "utf8");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should sync because content differs
      expect(
        logs.some((log) => log.includes("Synced issue issue-diff-001"))
      ).toBe(true);

      // Verify database was updated
      const { getIssue } = await import("../../src/operations/issues.js");
      const issue = getIssue(db, "issue-diff-001");
      expect(issue?.title).toBe("Test Content Diff UPDATED");
      expect(issue?.status).toBe("in_progress");

      expect(errors.length).toBe(0);
    });

    it(
      "should not oscillate between markdown and JSONL with bidirectional sync",
      { timeout: 15000 },
      async () => {
        const logs: string[] = [];
        const errors: Error[] = [];
        let syncCount = 0;

        // Start watcher with bidirectional sync
        control = startWatcher({
          db,
          baseDir: tempDir,
          debounceDelay: 100,
          ignoreInitial: true,
          syncJSONLToMarkdown: true,
          onLog: (msg) => {
            logs.push(msg);
            if (msg.includes("Synced")) {
              syncCount++;
            }
          },
          onError: (err) => errors.push(err),
        });

        // Wait for watcher to be ready
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Write an issue to JSONL
        const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
        const issueData = {
          id: "issue-osc-001",
          uuid: "test-uuid-osc-001",
          title: "Test No Oscillation",
          status: "open",
          priority: 2,
          content: "Issue content.",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        fs.writeFileSync(
          issuesJsonlPath,
          JSON.stringify(issueData) + "\n",
          "utf8"
        );

        // Wait for initial sync chain to complete
        // JSONL → DB → Markdown → (should stop here due to content match)
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Reset sync counter
        const initialSyncCount = syncCount;
        syncCount = 0;

        // Wait additional time to see if oscillation occurs
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Should have no additional syncs (oscillation would cause repeated syncs)
        expect(syncCount).toBe(0);

        // Verify the file exists and has correct content
        const issueMdPath = path.join(tempDir, "issues", "issue-osc-001.md");
        expect(fs.existsSync(issueMdPath)).toBe(true);

        expect(errors.length).toBe(0);
      }
    );
  });

  describe("Smart JSONL Operations (Regression Prevention)", () => {
    it("should skip JSONL write when content is identical", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create initial issue
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-skip-001",
        uuid: "test-uuid",
        title: "Test Skip Write",
        content: "Content",
        status: "open",
        priority: 2,
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Get initial file stats
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const specsJsonlPath = path.join(tempDir, "specs.jsonl");
      const issuesStat1 = fs.statSync(issuesJsonlPath);
      const specsStat1 = fs.statSync(specsJsonlPath);

      // Wait a bit to ensure different mtime if file is rewritten
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Export again without changes - should skip write
      await exportToJSONL(db, { outputDir: tempDir });

      // Get file stats again
      const issuesStat2 = fs.statSync(issuesJsonlPath);
      const specsStat2 = fs.statSync(specsJsonlPath);

      // Issues JSONL should be rewritten (same content but written)
      // But specs JSONL should NOT be touched since no specs exist
      expect(issuesStat1.mtimeMs).toBe(issuesStat2.mtimeMs); // Same time = skipped write
      expect(specsStat1.mtimeMs).toBe(specsStat2.mtimeMs); // Same time = skipped write

      expect(errors.length).toBe(0);
    });

    it.skip("should skip JSONL import when database is already up to date (timing-sensitive, verify manually)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create issue in database
      const { createIssue } = await import("../../src/operations/issues.js");
      const issue = createIssue(db, {
        id: "issue-import-001",
        uuid: "test-uuid",
        title: "Test Skip Import",
        content: "Content",
        status: "open",
        priority: 2,
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Clear logs
      logs.length = 0;

      // Touch the JSONL file (no content change, simulating our own export)
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const content = fs.readFileSync(issuesJsonlPath, "utf8");
      fs.writeFileSync(issuesJsonlPath, content, "utf8");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should see skip message
      expect(
        logs.some((log) =>
          log.includes("Skipping JSONL import for issues.jsonl")
        )
      ).toBe(true);

      // Should NOT see import message
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        false
      );

      expect(errors.length).toBe(0);
    });

    it("should import JSONL when content actually differs from database", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create issue in database with initial content
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-import-002",
        uuid: "test-uuid",
        title: "Original Title",
        content: "Original content",
        status: "open",
        priority: 2,
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Clear logs
      logs.length = 0;

      // Modify JSONL with different content (simulating git pull)
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const updatedIssue = {
        id: "issue-import-002",
        uuid: "test-uuid",
        title: "Updated Title from JSONL",
        content: "Updated content from external source",
        status: "in_progress",
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(updatedIssue) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should import because content differs
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify database was updated
      const { getIssue } = await import("../../src/operations/issues.js");
      const issue = getIssue(db, "issue-import-002");
      expect(issue?.title).toBe("Updated Title from JSONL");
      expect(issue?.content).toBe("Updated content from external source");
      expect(issue?.status).toBe("in_progress");

      expect(errors.length).toBe(0);
    });

    it.skip("should skip markdown→database sync when database is newer (timing-sensitive, verify manually)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create issue in database
      const { createIssue } = await import("../../src/operations/issues.js");
      const now = new Date();
      const issue = createIssue(db, {
        id: "issue-timestamp-001",
        uuid: "test-uuid",
        title: "Test Timestamp Check",
        content: "Content from database",
        status: "open",
        priority: 2,
        created_at: now.toISOString(),
        updated_at: now.toISOString(), // Fresh timestamp
      });

      // Export to JSONL and markdown
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      const { syncJSONLToMarkdown } = await import("../../src/sync.js");
      const mdPath = path.join(tempDir, "issues", "issue-timestamp-001.md");
      await syncJSONLToMarkdown(db, "issue-timestamp-001", "issue", mdPath);

      // Make markdown file older by changing its mtime
      const oldTime = new Date(now.getTime() - 10000); // 10 seconds ago
      fs.utimesSync(mdPath, oldTime, oldTime);

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Clear logs
      logs.length = 0;

      // Touch the markdown file (trigger change event but don't modify content)
      fs.utimesSync(mdPath, oldTime, oldTime); // Keep old time
      // Also append and remove a character to trigger proper change
      let content = fs.readFileSync(mdPath, "utf8");
      fs.writeFileSync(mdPath, content + " ", "utf8");
      fs.utimesSync(mdPath, oldTime, oldTime); // Reset to old time
      content = fs.readFileSync(mdPath, "utf8");
      fs.writeFileSync(mdPath, content.trimEnd(), "utf8");
      fs.utimesSync(mdPath, oldTime, oldTime); // Reset to old time again

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should skip because database is newer
      expect(
        logs.some(
          (log) =>
            log.includes("database is newer") ||
            log.includes("Skipping sync")
        )
      ).toBe(true);

      // Database should not be modified
      const { getIssue } = await import("../../src/operations/issues.js");
      const checkIssue = getIssue(db, "issue-timestamp-001");
      expect(checkIssue?.title).toBe("Test Timestamp Check");
      expect(checkIssue?.content).toBe("Content from database");

      expect(errors.length).toBe(0);
    });

    it.skip("should not trigger unnecessary file writes in cascade (timing-sensitive, verify manually)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];
      const fileChanges: string[] = [];

      // Start watcher with detailed logging
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: true,
        onLog: (msg) => {
          logs.push(msg);
          if (msg.includes("change")) {
            fileChanges.push(msg);
          }
        },
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create issue
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-cascade-001",
        uuid: "test-uuid",
        title: "Test Cascade",
        content: "Content",
        status: "open",
        priority: 2,
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Also create markdown
      const { syncJSONLToMarkdown } = await import("../../src/sync.js");
      const mdPath = path.join(tempDir, "issues", "issue-cascade-001.md");
      await syncJSONLToMarkdown(db, "issue-cascade-001", "issue", mdPath);

      // Clear logs and file changes
      logs.length = 0;
      fileChanges.length = 0;

      // Now update the issue (this is what server does)
      const { updateIssue } = await import("../../src/operations/issues.js");
      updateIssue(db, "issue-cascade-001", {
        title: "Updated Title",
      });

      // Export again (simulating server's triggerExport)
      await exportToJSONL(db, { outputDir: tempDir });

      // Update markdown (simulating server's syncEntityToMarkdown)
      await syncJSONLToMarkdown(db, "issue-cascade-001", "issue", mdPath);

      // Wait for all watcher events to process
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Should see changes for:
      // 1. issues.jsonl (contains the updated issue)
      // 2. issue-cascade-001.md (the updated markdown)
      // Should NOT see:
      // 3. specs.jsonl (no specs changed, content identical, write skipped)

      // Count change events
      const issueJsonlChanges = fileChanges.filter((log) =>
        log.includes("issues.jsonl")
      );
      const specJsonlChanges = fileChanges.filter((log) =>
        log.includes("specs.jsonl")
      );
      const mdChanges = fileChanges.filter((log) =>
        log.includes("issue-cascade-001.md")
      );

      // Should have exactly 1 change for issues.jsonl
      expect(issueJsonlChanges.length).toBe(1);

      // Should have NO changes for specs.jsonl (write was skipped)
      expect(specJsonlChanges.length).toBe(0);

      // Should have exactly 1 change for the markdown file
      expect(mdChanges.length).toBe(1);

      // Should see skip messages for JSONL import
      expect(
        logs.some((log) =>
          log.includes("Skipping JSONL import for issues.jsonl")
        )
      ).toBe(true);

      expect(errors.length).toBe(0);
    });
  });

  describe("Timestamp Behavior (File Modification Time)", () => {
    it("should use file modification time as database updated_at when syncing from markdown", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create initial markdown file with known content
      const issuePath = path.join(tempDir, "issues", "issue-timestamp-001.md");
      const issueContent = `---
id: issue-timestamp-001
title: Test Timestamp
status: open
priority: 2
---

# Test Timestamp

Initial content.
`;
      fs.writeFileSync(issuePath, issueContent, "utf8");

      // Get file modification time BEFORE starting watcher
      const fileStatBefore = fs.statSync(issuePath);
      const fileTimeBefore = fileStatBefore.mtimeMs;

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial sync
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get the issue from database
      const { getIssue } = await import("../../src/operations/issues.js");
      const issue = getIssue(db, "issue-timestamp-001");

      expect(issue).toBeDefined();
      expect(issue).not.toBeNull();

      if (issue) {
        // Database updated_at should be very close to file modification time
        const dbTime = new Date(issue.updated_at).getTime();
        const timeDiff = Math.abs(dbTime - fileTimeBefore);

        // Allow up to 1 second difference (for filesystem precision)
        expect(timeDiff).toBeLessThan(1000);
      }

      expect(errors.length).toBe(0);
    });

    it(
      "should allow multiple consecutive edits to be synced (not skipped due to timestamps)",
      async () => {
        const logs: string[] = [];
        const errors: Error[] = [];

        // Create initial markdown file
        const issuePath = path.join(tempDir, "issues", "issue-multi-edit-001.md");
        const initialContent = `---
id: issue-multi-edit-001
title: Multi Edit Test
status: open
priority: 2
---

# Multi Edit Test

Version 1
`;
        fs.writeFileSync(issuePath, initialContent, "utf8");

        // Start watcher
        control = startWatcher({
          db,
          baseDir: tempDir,
          debounceDelay: 100,
          ignoreInitial: false,
          onLog: (msg) => logs.push(msg),
          onError: (err) => errors.push(err),
        });

        // Wait for initial sync
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const { getIssue } = await import("../../src/operations/issues.js");

        // First edit
        logs.length = 0;
        const edit1Content = initialContent.replace("Version 1", "Version 2");
        fs.writeFileSync(issuePath, edit1Content, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        let issue = getIssue(db, "issue-multi-edit-001");
        expect(issue?.content).toContain("Version 2");
        expect(logs.some((log) => log.includes("Synced issue issue-multi-edit-001"))).toBe(true);

        // Second edit (shortly after)
        logs.length = 0;
        const edit2Content = edit1Content.replace("Version 2", "Version 3");
        fs.writeFileSync(issuePath, edit2Content, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        issue = getIssue(db, "issue-multi-edit-001");
        expect(issue?.content).toContain("Version 3");
        expect(logs.some((log) => log.includes("Synced issue issue-multi-edit-001"))).toBe(true);

        // Third edit
        logs.length = 0;
        const edit3Content = edit2Content.replace("Version 3", "Version 4");
        fs.writeFileSync(issuePath, edit3Content, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        issue = getIssue(db, "issue-multi-edit-001");
        expect(issue?.content).toContain("Version 4");
        expect(logs.some((log) => log.includes("Synced issue issue-multi-edit-001"))).toBe(true);

        expect(errors.length).toBe(0);
      },
      { timeout: 10000 }
    );

    it("should skip sync when database is genuinely newer than file (via direct DB update)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create initial markdown file
      const issuePath = path.join(tempDir, "issues", "issue-db-newer-001.md");
      const issueContent = `---
id: issue-db-newer-001
title: DB Newer Test
status: open
priority: 2
---

# DB Newer Test

Original content.
`;
      fs.writeFileSync(issuePath, issueContent, "utf8");

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial sync
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Clear logs
      logs.length = 0;

      // Update database directly with a future timestamp (simulating server update)
      const { updateIssue } = await import("../../src/operations/issues.js");
      const futureTime = new Date(Date.now() + 10000).toISOString(); // 10 seconds in future
      updateIssue(db, "issue-db-newer-001", {
        content: "Content updated via database",
        updated_at: futureTime,
      });

      // Now touch the markdown file (changing mtime but not content)
      fs.utimesSync(issuePath, new Date(), new Date());

      // Wait for watcher to process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should see "Skipping sync" message because database is newer
      expect(
        logs.some((log) =>
          log.includes("Skipping sync for issue issue-db-newer-001") &&
          log.includes("database is newer")
        )
      ).toBe(true);

      expect(errors.length).toBe(0);
    });

    it("should preserve correct timestamps across markdown → database → JSONL sync chain", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create markdown file
      const specPath = path.join(tempDir, "specs", "spec-timestamp-chain.md");
      const specContent = `---
id: spec-timestamp-chain
title: Timestamp Chain Test
priority: 2
---

# Timestamp Chain Test

Test content.
`;
      fs.writeFileSync(specPath, specContent, "utf8");

      // Get file time
      const fileStat = fs.statSync(specPath);
      const fileTime = fileStat.mtimeMs;

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        debounceDelay: 100,
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for sync to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check database timestamp
      const { getSpec } = await import("../../src/operations/specs.js");
      const spec = getSpec(db, "spec-timestamp-chain");
      expect(spec).toBeDefined();

      if (spec) {
        const dbTime = new Date(spec.updated_at).getTime();
        const dbTimeDiff = Math.abs(dbTime - fileTime);
        expect(dbTimeDiff).toBeLessThan(1000); // Within 1 second

        // Check JSONL file contains the same timestamp
        const jsonlPath = path.join(tempDir, "specs.jsonl");
        const jsonlContent = fs.readFileSync(jsonlPath, "utf8");
        const lines = jsonlContent.trim().split("\n").filter((l) => l.trim());
        const specLine = lines.find((l) => l.includes("spec-timestamp-chain"));

        expect(specLine).toBeDefined();
        if (specLine) {
          const jsonlSpec = JSON.parse(specLine);
          const jsonlTime = new Date(jsonlSpec.updated_at).getTime();
          const jsonlTimeDiff = Math.abs(jsonlTime - fileTime);
          expect(jsonlTimeDiff).toBeLessThan(1000); // Within 1 second
        }
      }

      expect(errors.length).toBe(0);
    });
  });
});
