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

      // Import getSpecByFilePath to find the auto-created spec
      const { getSpecByFilePath } = await import("../../src/operations/specs.js");

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
        description: "This issue came from JSONL",
        status: "open",
        priority: 2,
        content: "Issue content from JSONL.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n", "utf8");

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
        description: "This should not create markdown",
        status: "open",
        priority: 2,
        content: "Issue content.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n", "utf8");

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
description: Test description
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

      // Should see skip log because content matches
      expect(
        logs.some((log) => log.includes("Skipping sync for issue issue-match-002"))
      ).toBe(true);

      expect(errors.length).toBe(0);
    });

    it("should sync when content actually differs", async () => {
      const logs: string[] = [];
      const errors: Error[] = [];

      // Create initial markdown file
      const issuePath = path.join(tempDir, "issues", "issue-diff-001.md");
      const issueContent = `---
id: issue-diff-001
title: Test Content Diff
description: Original description
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
description: Updated description
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

    it("should not oscillate between markdown and JSONL with bidirectional sync", { timeout: 15000 }, async () => {
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
        description: "This should not oscillate",
        status: "open",
        priority: 2,
        content: "Issue content.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n", "utf8");

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
    });
  });
});
