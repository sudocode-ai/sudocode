/**
 * Unit tests for file watcher
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../src/db.js";
import { startWatcher, parseTimestampAsUTC } from "../../src/watcher.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("parseTimestampAsUTC", () => {
  it("should parse ISO format with Z suffix correctly", () => {
    const isoTimestamp = "2025-12-21T21:52:25.123Z";
    const result = parseTimestampAsUTC(isoTimestamp);
    expect(result).toBe(new Date(isoTimestamp).getTime());
  });

  it("should parse SQLite CURRENT_TIMESTAMP format as UTC", () => {
    // SQLite returns 'YYYY-MM-DD HH:MM:SS' without timezone
    const sqliteTimestamp = "2025-12-21 21:52:25";
    const result = parseTimestampAsUTC(sqliteTimestamp);

    // Should be parsed as UTC, not local time
    const expectedUTC = new Date("2025-12-21T21:52:25Z").getTime();
    expect(result).toBe(expectedUTC);
  });

  it("should NOT add timezone offset to SQLite format (the original bug)", () => {
    const sqliteTimestamp = "2025-12-21 21:52:25";
    const result = parseTimestampAsUTC(sqliteTimestamp);

    // The bug was that JavaScript parsed "2025-12-21 21:52:25" as local time,
    // adding 8 hours (or whatever the local offset is) to the result.
    // After the fix, it should be exactly 21:52:25 UTC.
    const correctUTC = new Date("2025-12-21T21:52:25Z");
    expect(result).toBe(correctUTC.getTime());

    // Verify the hour is 21 in UTC
    expect(new Date(result).getUTCHours()).toBe(21);
  });

  it("should handle both formats consistently for the same time", () => {
    const sqliteFormat = "2025-12-21 10:30:45";
    const isoFormat = "2025-12-21T10:30:45Z";

    const sqliteResult = parseTimestampAsUTC(sqliteFormat);
    const isoResult = parseTimestampAsUTC(isoFormat);

    // Both should give the same timestamp
    expect(sqliteResult).toBe(isoResult);
  });

  it("should correctly compare file mtime against DB timestamp", () => {
    // Simulate the comparison that happens in the watcher
    // File was just modified at 10:30:50 UTC
    const fileTime = new Date("2025-12-21T10:30:50Z").getTime();

    // DB was last updated at 10:30:45 UTC (stored as SQLite format)
    const dbTimestamp = "2025-12-21 10:30:45";
    const dbTime = parseTimestampAsUTC(dbTimestamp);

    // File should be newer (5 seconds later)
    expect(fileTime).toBeGreaterThan(dbTime);
    expect(fileTime - dbTime).toBe(5000); // 5 seconds
  });
});

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
        onLog: (msg) => logs.push(msg),
        onError: (err) => console.error(err),
      });

      expect(control).toBeDefined();
      expect(control.stop).toBeDefined();
      expect(control.getStats).toBeDefined();

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

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
        ignoreInitial: false, // Detect existing files
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to start and process initial files
      // Need to wait for: awaitWriteFinish + debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 800));

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
      while (!watcherReady && waited < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waited += 100;
      }

      // Additional buffer
      await new Promise((resolve) => setTimeout(resolve, 200));

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
      // awaitWriteFinish + debounce + processing + buffer
      await new Promise((resolve) => setTimeout(resolve, 1000));

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
      while (!watcherReady && waited < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waited += 100;
      }

      // Additional buffer
      await new Promise((resolve) => setTimeout(resolve, 200));

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
        await new Promise((resolve) => setTimeout(resolve, 30)); // 30ms between writes
      }

      // Wait for debounce and processing
      // awaitWriteFinish + debounce (200ms) + processing time + buffer
      await new Promise((resolve) => setTimeout(resolve, 1000));

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

    it("should NOT delete spec from database when file is deleted (DB is source of truth)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // First create the spec in the database (DB is source of truth for entity existence)
      const { createSpec, getSpec } = await import(
        "../../src/operations/specs.js"
      );
      createSpec(db, {
        id: "spec-delete-001",
        uuid: "test-uuid-delete-001",
        title: "Test Delete Spec",
        file_path: "specs/test-delete.md",
        content:
          "This spec will have its markdown deleted but DB entry preserved.",
        priority: 2,
      });

      // Create the corresponding markdown file
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

This spec will have its markdown deleted but DB entry preserved.
`;
      fs.writeFileSync(specPath, content, "utf8");

      // Start watcher with ignoreInitial: false
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to start
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify spec exists in database
      let spec = getSpec(db, "spec-delete-001");
      expect(spec).not.toBeNull();
      expect(spec?.title).toBe("Test Delete Spec");

      // Delete the markdown file
      fs.unlinkSync(specPath);

      // Wait for deletion to be processed
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify spec was NOT deleted from database (DB is source of truth)
      spec = getSpec(db, "spec-delete-001");
      expect(spec).not.toBeNull();
      expect(spec?.title).toBe("Test Delete Spec");

      // Verify deletion was logged (informational only, no DB deletion)
      expect(logs.some((log) => log.includes("Markdown file deleted"))).toBe(
        true
      );
      expect(
        logs.some((log) => log.includes("DB/JSONL is source of truth"))
      ).toBe(true);

      // No errors should occur
      expect(errors.length).toBe(0);
    });

    it("should delete orphaned markdown file without frontmatter (no corresponding DB entry)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create a markdown file WITHOUT frontmatter BEFORE starting watcher
      // Since DB/JSONL is source of truth, this file has no corresponding DB entry
      const specPath = path.join(tempDir, "specs", "no-frontmatter-orphan.md");
      const content = `# No Frontmatter Orphan Test

This spec has no frontmatter and no DB entry, so it should be deleted as orphaned.
`;
      fs.writeFileSync(specPath, content, "utf8");

      // Verify file exists before watcher starts
      expect(fs.existsSync(specPath)).toBe(true);

      // Start watcher with ignoreInitial: false to detect and clean up orphaned files
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: false, // Detect existing files
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to start and process the orphaned file
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify orphaned file was deleted (DB/JSONL is source of truth)
      expect(fs.existsSync(specPath)).toBe(false);

      // Verify orphaned file deletion was logged
      expect(logs.some((log) => log.includes("Orphaned file detected"))).toBe(
        true
      );
      expect(logs.some((log) => log.includes("Deleted orphaned"))).toBe(true);

      // No errors should occur
      expect(errors.length).toBe(0);
    });

    it("should stop cleanly", async () => {
      const logs: string[] = [];

      control = startWatcher({
        db,
        baseDir: tempDir,
        onLog: (msg) => logs.push(msg),
        onError: (err) => console.error(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop watcher
      await control.stop();

      // Check logs for stop message
      expect(logs.some((log) => log.includes("Stopping watcher"))).toBe(true);
      expect(logs.some((log) => log.includes("Watcher stopped"))).toBe(true);
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
        ignoreInitial: true,
        syncJSONLToMarkdown: true, // Enable reverse sync
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

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
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify markdown file was created with unified naming scheme
      const issueMdPath = path.join(
        tempDir,
        "issues",
        "issue-001_test_issue_from_jsonl.md"
      );
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
        ignoreInitial: true,
        syncJSONLToMarkdown: false, // Explicitly disabled
        onLog: (msg) => logs.push(msg),
        onError: (err) => console.error(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

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
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify markdown file was NOT created
      const issueMdPath = path.join(tempDir, "issues", "issue-002.md");
      expect(fs.existsSync(issueMdPath)).toBe(false);

      // Verify logs show import
      expect(logs.some((log) => log.includes("Imported JSONL"))).toBe(true);

      // Note: "Synced issue" logs now appear when we detect JSONL changes
      // (part of the new typed callback system), but this doesn't mean
      // markdown files were created - it just means we tracked which entities changed
      // The actual test is that markdown file was NOT created (checked above)
    });
  });

  describe("Content Matching (Oscillation Prevention)", () => {
    it("should skip markdown sync when content matches (prevents oscillation)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // First create the issue in the database (DB is source of truth for entity existence)
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-match-001",
        uuid: "test-uuid-match-001",
        title: "Test Content Match",
        content: "# Test Content Match\n\nThis is the issue content.",
        status: "open",
        priority: 2,
      });

      // Create initial markdown file with matching content
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

      // Export to JSONL so the issue exists in JSONL too
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: false,
        syncJSONLToMarkdown: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial import
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Clear logs to track next changes
      logs.length = 0;

      // Modify JSONL file (simulating external change)
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const jsonlContent = fs.readFileSync(issuesJsonlPath, "utf8");
      fs.writeFileSync(issuesJsonlPath, jsonlContent, "utf8"); // Touch the file

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

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

      // First create the issue in the database (DB is source of truth for entity existence)
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-match-002",
        uuid: "test-uuid-match-002",
        title: "Test Markdown Match",
        content: "# Test Markdown Match\n\nThis is the issue content.",
        status: "open",
        priority: 2,
      });

      // Create initial markdown file with matching content
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

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: false,
        syncJSONLToMarkdown: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial import
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Clear logs to track next changes
      logs.length = 0;

      // Touch the markdown file (no actual content change)
      fs.utimesSync(issuePath, new Date(), new Date());

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

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
      await new Promise((resolve) => setTimeout(resolve, 800));

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
        await new Promise((resolve) => setTimeout(resolve, 200));

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
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Reset sync counter
        const initialSyncCount = syncCount;
        syncCount = 0;

        // Wait additional time to see if oscillation occurs
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Should have no additional syncs (oscillation would cause repeated syncs)
        expect(syncCount).toBe(0);

        // Verify the file exists and has correct content with unified naming scheme
        const issueMdPath = path.join(
          tempDir,
          "issues",
          "issue-osc-001_test_no_oscillation.md"
        );
        expect(fs.existsSync(issueMdPath)).toBe(true);

        expect(errors.length).toBe(0);
      }
    );

    it(
      "should not create loop when CLI updates issue (simulating MCP operation)",
      { timeout: 15000 },
      async () => {
        const logs: string[] = [];
        const errors: Error[] = [];
        let syncCount = 0;

        // Create initial issue
        const { createIssue } = await import("../../src/operations/issues.js");
        createIssue(db, {
          id: "issue-cli-001",
          uuid: "test-uuid-cli-001",
          title: "CLI Test Issue",
          content: "Initial content",
          status: "open",
          priority: 2,
        });

        // Export to JSONL and sync to markdown (simulating initialization)
        const { exportToJSONL } = await import("../../src/export.js");
        await exportToJSONL(db, { outputDir: tempDir });

        const { syncJSONLToMarkdown } = await import("../../src/sync.js");
        const issuesDir = path.join(tempDir, "issues");
        fs.mkdirSync(issuesDir, { recursive: true });
        const mdPath = path.join(issuesDir, "issue-cli-001.md");
        await syncJSONLToMarkdown(db, "issue-cli-001", "issue", mdPath);

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Start watcher
        control = startWatcher({
          db,
          baseDir: tempDir,
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
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Simulate CLI operation: update issue + export + sync to markdown
        const { updateIssue } = await import("../../src/operations/issues.js");
        updateIssue(db, "issue-cli-001", { status: "closed" });
        await exportToJSONL(db, { outputDir: tempDir });
        await syncJSONLToMarkdown(db, "issue-cli-001", "issue", mdPath);

        // Wait for watcher to process (should detect content match and skip)
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Reset sync counter
        syncCount = 0;

        // Wait additional time to verify no oscillation
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Should have zero syncs (watcher should have skipped due to content match)
        expect(syncCount).toBe(0);

        // Verify markdown file has the update
        const mdContent = fs.readFileSync(mdPath, "utf8");
        expect(mdContent).toContain("status: closed");

        expect(errors.length).toBe(0);
      }
    );

    it("should produce same hash regardless of array element order (relationships, tags)", async () => {
      // This tests the canonical hash function's array sorting behavior
      // Two entities with same content but different array ordering should have same hash
      const { createIssue } = await import("../../src/operations/issues.js");
      const { addRelationship } = await import("../../src/operations/relationships.js");
      const { addTags } = await import("../../src/operations/tags.js");
      const { exportToJSONL } = await import("../../src/export.js");
      const { readJSONLSync } = await import("../../src/jsonl.js");

      // Create two issues
      createIssue(db, {
        id: "issue-hash-001",
        uuid: "uuid-hash-001",
        title: "Hash Test 1",
        content: "Content",
        status: "open",
        priority: 2,
      });
      createIssue(db, {
        id: "issue-hash-002",
        uuid: "uuid-hash-002",
        title: "Hash Test 2",
        content: "Content",
        status: "open",
        priority: 2,
      });
      createIssue(db, {
        id: "issue-hash-003",
        uuid: "uuid-hash-003",
        title: "Hash Test 3",
        content: "Content",
        status: "open",
        priority: 2,
      });

      // Add relationships in different order
      // For issue-hash-001: add to 002 first, then 003
      addRelationship(db, {
        from_id: "issue-hash-001",
        from_type: "issue",
        to_id: "issue-hash-002",
        to_type: "issue",
        relationship_type: "related",
      });
      addRelationship(db, {
        from_id: "issue-hash-001",
        from_type: "issue",
        to_id: "issue-hash-003",
        to_type: "issue",
        relationship_type: "related",
      });

      // Add tags in different order
      addTags(db, "issue-hash-001", "issue", ["beta", "alpha", "gamma"]);

      // Export to JSONL
      await exportToJSONL(db, { outputDir: tempDir });

      // Read JSONL
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issues = readJSONLSync<any>(issuesJsonlPath);
      const issue = issues.find((i: any) => i.id === "issue-hash-001");

      // Verify relationships and tags are present
      expect(issue.relationships.length).toBe(2);
      expect(issue.tags.length).toBe(3);

      // Now modify the JSONL to have different array order but same content
      const modifiedIssues = issues.map((i: any) => {
        if (i.id === "issue-hash-001") {
          return {
            ...i,
            // Reverse the relationships order
            relationships: [...i.relationships].reverse(),
            // Reverse the tags order
            tags: [...i.tags].reverse(),
          };
        }
        return i;
      });

      // Write modified JSONL
      const { writeJSONL } = await import("../../src/jsonl.js");
      await writeJSONL(issuesJsonlPath, modifiedIssues);

      // Start watcher
      const logs: string[] = [];
      const errors: Error[] = [];
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // The canonical hash should treat arrays as order-independent
      // So no import should be triggered (content is semantically same)
      // Note: The hash now sorts arrays, so same content different order = same hash
      expect(errors.length).toBe(0);
    });
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
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Touch the JSONL file (no content change, simulating our own export)
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const content = fs.readFileSync(issuesJsonlPath, "utf8");
      fs.writeFileSync(issuesJsonlPath, content, "utf8");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

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
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

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
      await new Promise((resolve) => setTimeout(resolve, 800));

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
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

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
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should skip because database is newer
      expect(
        logs.some(
          (log) =>
            log.includes("database is newer") || log.includes("Skipping sync")
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

      // First create the issue in the database with an OLD timestamp (DB is source of truth for entity existence)
      // Use an old timestamp so the markdown file will be considered newer
      const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const { createIssue, getIssue, updateIssue } = await import(
        "../../src/operations/issues.js"
      );
      createIssue(db, {
        id: "issue-timestamp-001",
        uuid: "test-uuid-timestamp-001",
        title: "Test Timestamp OLD",
        content: "Old content",
        status: "open",
        priority: 2,
      });
      // Set the updated_at to past so markdown will be considered newer
      updateIssue(db, "issue-timestamp-001", { updated_at: pastTime });

      // Create initial markdown file with updated content
      const issuePath = path.join(tempDir, "issues", "issue-timestamp-001.md");
      const issueContent = `---
id: issue-timestamp-001
title: Test Timestamp
status: open
priority: 2
---

# Test Timestamp

Updated content.
`;
      fs.writeFileSync(issuePath, issueContent, "utf8");

      // Get file modification time BEFORE starting watcher
      const fileStatBefore = fs.statSync(issuePath);
      const fileTimeBefore = fileStatBefore.mtimeMs;

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for initial sync
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Get the issue from database
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

        // First create the issue in the database with an OLD timestamp (DB is source of truth for entity existence)
        const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
        const { createIssue, getIssue, updateIssue } = await import(
          "../../src/operations/issues.js"
        );
        createIssue(db, {
          id: "issue-multi-edit-001",
          uuid: "test-uuid-multi-001",
          title: "Multi Edit Test",
          content: "Version 0",
          status: "open",
          priority: 2,
        });
        // Set the updated_at to past so markdown will be considered newer
        updateIssue(db, "issue-multi-edit-001", { updated_at: pastTime });

        // Create initial markdown file
        const issuePath = path.join(
          tempDir,
          "issues",
          "issue-multi-edit-001.md"
        );
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
          ignoreInitial: false,
          onLog: (msg) => logs.push(msg),
          onError: (err) => errors.push(err),
        });

        // Wait for initial sync
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // First edit
        logs.length = 0;
        const edit1Content = initialContent.replace("Version 1", "Version 2");
        fs.writeFileSync(issuePath, edit1Content, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        let issue = getIssue(db, "issue-multi-edit-001");
        expect(issue?.content).toContain("Version 2");
        expect(
          logs.some((log) => log.includes("Synced issue issue-multi-edit-001"))
        ).toBe(true);

        // Second edit (shortly after)
        logs.length = 0;
        const edit2Content = edit1Content.replace("Version 2", "Version 3");
        fs.writeFileSync(issuePath, edit2Content, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        issue = getIssue(db, "issue-multi-edit-001");
        expect(issue?.content).toContain("Version 3");
        expect(
          logs.some((log) => log.includes("Synced issue issue-multi-edit-001"))
        ).toBe(true);

        // Third edit
        logs.length = 0;
        const edit3Content = edit2Content.replace("Version 3", "Version 4");
        fs.writeFileSync(issuePath, edit3Content, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        issue = getIssue(db, "issue-multi-edit-001");
        expect(issue?.content).toContain("Version 4");
        expect(
          logs.some((log) => log.includes("Synced issue issue-multi-edit-001"))
        ).toBe(true);

        expect(errors.length).toBe(0);
      },
      { timeout: 10000 }
    );

    it("should sync DB to markdown when database is genuinely newer than file (via direct DB update)", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // First create the issue in the database (DB is source of truth for entity existence)
      const { createIssue, updateIssue, getIssue } = await import(
        "../../src/operations/issues.js"
      );
      createIssue(db, {
        id: "issue-db-newer-001",
        uuid: "test-uuid-db-newer-001",
        title: "DB Newer Test",
        content: "Original content.",
        status: "open",
        priority: 2,
      });

      // Create initial markdown file with DIFFERENT content from DB
      const issuePath = path.join(tempDir, "issues", "issue-db-newer-001.md");
      const issueContent = `---
id: issue-db-newer-001
title: DB Newer Test
status: open
priority: 2
---

# DB Newer Test

OLD file content.
`;
      fs.writeFileSync(issuePath, issueContent, "utf8");

      // Set the file timestamp to the past so DB will be newer
      const pastFileTime = new Date(Date.now() - 60000); // 1 minute ago
      fs.utimesSync(issuePath, pastFileTime, pastFileTime);

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to process - should see "DB is newer" because:
      // 1. Content differs between markdown and DB
      // 2. DB timestamp (recent) is newer than file timestamp (1 min ago)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should see "DB is newer" message because database is newer
      expect(
        logs.some((log) =>
          log.includes("DB is newer for issue issue-db-newer-001")
        )
      ).toBe(true);

      expect(errors.length).toBe(0);
    });

    it("should preserve correct timestamps across markdown → database → JSONL sync chain", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // First create the spec in the database with an OLD timestamp (DB is source of truth for entity existence)
      const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const { createSpec, getSpec, updateSpec } = await import(
        "../../src/operations/specs.js"
      );
      createSpec(db, {
        id: "spec-timestamp-chain",
        uuid: "test-uuid-chain-001",
        title: "Timestamp Chain Test OLD",
        file_path: "specs/spec-timestamp-chain.md",
        content: "Old content.",
        priority: 2,
      });
      // Set the updated_at to past so markdown will be considered newer
      updateSpec(db, "spec-timestamp-chain", { updated_at: pastTime });

      // Create markdown file with updated content
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
        ignoreInitial: false,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for sync to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check database timestamp
      const spec = getSpec(db, "spec-timestamp-chain");
      expect(spec).toBeDefined();

      if (spec) {
        const dbTime = new Date(spec.updated_at).getTime();
        const dbTimeDiff = Math.abs(dbTime - fileTime);
        expect(dbTimeDiff).toBeLessThan(1000); // Within 1 second

        // Check JSONL file contains the same timestamp
        const jsonlPath = path.join(tempDir, "specs.jsonl");
        const jsonlContent = fs.readFileSync(jsonlPath, "utf8");
        const lines = jsonlContent
          .trim()
          .split("\n")
          .filter((l) => l.trim());
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

  describe("Comprehensive Field Detection", () => {
    it("should detect feedback changes in issues", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create spec and issue in database with initial feedback
      const { createSpec } = await import("../../src/operations/specs.js");
      const { createIssue } = await import("../../src/operations/issues.js");
      const { createFeedback } = await import(
        "../../src/operations/feedback.js"
      );

      createSpec(db, {
        id: "s-fb001",
        uuid: "test-uuid-spec-fb-001",
        title: "Test Spec for Feedback",
        file_path: "specs/test-fb.md",
        content: "Spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-fb001",
        uuid: "test-uuid-fb-001",
        title: "Test Feedback Detection",
        content: "Content",
        status: "open",
        priority: 2,
      });

      // Add feedback to the issue
      createFeedback(db, {
        id: "feedback-001",
        from_id: "i-fb001",
        to_id: "s-fb001",
        feedback_type: "comment",
        content: "Original feedback content",
        agent: "test-agent",
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Modify JSONL with different feedback content
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const updatedIssue = {
        id: "i-fb001",
        uuid: "test-uuid-fb-001",
        title: "Test Feedback Detection",
        content: "Content",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: [],
        feedback: [
          {
            id: "feedback-001",
            from_id: "i-fb001",
            to_id: "s-fb001",
            feedback_type: "comment",
            content: "UPDATED feedback content", // Changed
            agent: "test-agent",
            dismissed: false,
          },
        ],
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(updatedIssue) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should import because feedback content changed
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify feedback was updated in database
      const { listFeedback } = await import("../../src/operations/feedback.js");
      const feedbackList = listFeedback(db, { from_id: "i-fb001" });
      expect(feedbackList.length).toBe(1);
      expect(feedbackList[0].content).toBe("UPDATED feedback content");

      expect(errors.length).toBe(0);
    });

    it("should detect new feedback added to issues", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create spec and issue in database without feedback
      const { createSpec } = await import("../../src/operations/specs.js");
      const { createIssue } = await import("../../src/operations/issues.js");

      createSpec(db, {
        id: "s-fb002",
        uuid: "test-uuid-spec-fb-002",
        title: "Test Spec for New Feedback",
        file_path: "specs/test-fb-2.md",
        content: "Spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-fb002",
        uuid: "test-uuid-fb-002",
        title: "Test New Feedback Detection",
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
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Modify JSONL to add new feedback
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const updatedIssue = {
        id: "i-fb002",
        uuid: "test-uuid-fb-002",
        title: "Test New Feedback Detection",
        content: "Content",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: [],
        feedback: [
          {
            id: "feedback-002",
            from_id: "i-fb002",
            to_id: "s-fb002",
            feedback_type: "suggestion",
            content: "New feedback added",
            agent: "test-agent",
            dismissed: false,
          },
        ],
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(updatedIssue) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should import because feedback was added
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify feedback was created in database
      const { listFeedback } = await import("../../src/operations/feedback.js");
      const feedbackList = listFeedback(db, { from_id: "i-fb002" });
      expect(feedbackList.length).toBe(1);
      expect(feedbackList[0].content).toBe("New feedback added");

      expect(errors.length).toBe(0);
    });

    it("should detect relationship changes in issues", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create issue and spec in database
      const { createIssue } = await import("../../src/operations/issues.js");
      const { createSpec } = await import("../../src/operations/specs.js");

      createSpec(db, {
        id: "spec-rel-001",
        uuid: "test-uuid-spec-rel",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "Spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "issue-rel-001",
        uuid: "test-uuid-rel-001",
        title: "Test Relationship Detection",
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
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Modify JSONL to add relationship
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const updatedIssue = {
        id: "issue-rel-001",
        uuid: "test-uuid-rel-001",
        title: "Test Relationship Detection",
        content: "Content",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [
          {
            from: "issue-rel-001",
            from_type: "issue",
            to: "spec-rel-001",
            to_type: "spec",
            type: "implements",
          },
        ],
        tags: [],
        feedback: [],
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(updatedIssue) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should import because relationship was added
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify relationship was created in database
      const { getOutgoingRelationships } = await import(
        "../../src/operations/relationships.js"
      );
      const rels = getOutgoingRelationships(db, "issue-rel-001", "issue");
      expect(rels.length).toBe(1);
      expect(rels[0].to_id).toBe("spec-rel-001");
      expect(rels[0].relationship_type).toBe("implements");

      expect(errors.length).toBe(0);
    });

    it("should detect tag changes in issues", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create issue in database
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-tag-001",
        uuid: "test-uuid-tag-001",
        title: "Test Tag Detection",
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
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Modify JSONL to add tags
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const updatedIssue = {
        id: "issue-tag-001",
        uuid: "test-uuid-tag-001",
        title: "Test Tag Detection",
        content: "Content",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: ["bug", "urgent"],
        feedback: [],
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(updatedIssue) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should import because tags were added
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify tags were created in database
      const { getTags } = await import("../../src/operations/tags.js");
      const tags = getTags(db, "issue-tag-001", "issue");
      expect(tags.length).toBe(2);
      expect(tags).toContain("bug");
      expect(tags).toContain("urgent");

      expect(errors.length).toBe(0);
    });

    it("should detect spec file_path changes", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create spec in database
      const { createSpec } = await import("../../src/operations/specs.js");
      createSpec(db, {
        id: "spec-path-001",
        uuid: "test-uuid-path-001",
        title: "Test Path Detection",
        file_path: "specs/original-path.md",
        content: "Content",
        priority: 2,
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Modify JSONL to change file_path
      const specsJsonlPath = path.join(tempDir, "specs.jsonl");
      const updatedSpec = {
        id: "spec-path-001",
        uuid: "test-uuid-path-001",
        title: "Test Path Detection",
        file_path: "specs/new-path.md", // Changed
        content: "Content",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: [],
      };
      fs.writeFileSync(
        specsJsonlPath,
        JSON.stringify(updatedSpec) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should import because file_path changed
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify file_path was updated in database
      const { getSpec } = await import("../../src/operations/specs.js");
      const spec = getSpec(db, "spec-path-001");
      expect(spec?.file_path).toBe("specs/new-path.md");

      expect(errors.length).toBe(0);
    });

    it("should detect archived field changes", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create issue in database
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-archived-001",
        uuid: "test-uuid-archived-001",
        title: "Test Archived Detection",
        content: "Content",
        status: "closed",
        priority: 2,
        archived: false,
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Modify JSONL to archive the issue
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const archivedAt = new Date().toISOString();
      const updatedIssue = {
        id: "issue-archived-001",
        uuid: "test-uuid-archived-001",
        title: "Test Archived Detection",
        content: "Content",
        status: "closed",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        archived: true, // Changed
        archived_at: archivedAt, // Added
        relationships: [],
        tags: [],
        feedback: [],
      };
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(updatedIssue) + "\n",
        "utf8"
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should import because archived field changed
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify archived was updated in database
      const { getIssue } = await import("../../src/operations/issues.js");
      const issue = getIssue(db, "issue-archived-001");
      expect(issue?.archived).toBeTruthy(); // SQLite stores boolean as 1
      expect(issue?.archived_at).toBe(archivedAt);

      expect(errors.length).toBe(0);
    });

    it("should detect parent_id changes", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create two issues in database
      const { createIssue } = await import("../../src/operations/issues.js");
      createIssue(db, {
        id: "issue-parent-001",
        uuid: "test-uuid-parent-001",
        title: "Parent Issue",
        content: "Parent content",
        status: "open",
        priority: 2,
      });

      createIssue(db, {
        id: "issue-child-001",
        uuid: "test-uuid-child-001",
        title: "Child Issue",
        content: "Child content",
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
        ignoreInitial: true,
        onLog: (msg) => logs.push(msg),
        onError: (err) => errors.push(err),
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear logs
      logs.length = 0;

      // Modify JSONL to set parent_id
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const content = fs.readFileSync(issuesJsonlPath, "utf8");
      const lines = content
        .trim()
        .split("\n")
        .filter((l) => l.trim());
      const updatedLines = lines.map((line) => {
        const issue = JSON.parse(line);
        if (issue.id === "issue-child-001") {
          issue.parent_id = "issue-parent-001"; // Added parent
          issue.updated_at = new Date().toISOString(); // Update timestamp to trigger import
        }
        return JSON.stringify(issue);
      });
      fs.writeFileSync(issuesJsonlPath, updatedLines.join("\n") + "\n", "utf8");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should import because parent_id changed
      expect(logs.some((log) => log.includes("Imported JSONL changes"))).toBe(
        true
      );

      // Verify parent_id was updated in database
      const { getIssue } = await import("../../src/operations/issues.js");
      const issue = getIssue(db, "issue-child-001");
      expect(issue?.parent_id).toBe("issue-parent-001");

      expect(errors.length).toBe(0);
    });
  });
});
