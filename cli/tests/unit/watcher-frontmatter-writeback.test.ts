/**
 * Test orphaned file handling and frontmatter preservation
 * (DB/JSONL is source of truth - markdown files without DB entries are orphaned)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../src/db.js";
import { startWatcher } from "../../src/watcher.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("File Watcher - Orphaned Files and Frontmatter", () => {
  let db: Database.Database;
  let tempDir: string;
  let control: ReturnType<typeof startWatcher> | null = null;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ":memory:" });

    // Create temporary directory for files
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-frontmatter-test-")
    );

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
        spec: "SPEC",
        issue: "ISSUE",
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

  it("should delete orphaned spec file without frontmatter (no DB entry)", async () => {
    const logs: string[] = [];
    const errors: Error[] = [];

    // Create a spec file WITHOUT frontmatter (and no DB entry)
    // Since DB/JSONL is source of truth, this file should be deleted as orphaned
    const specPath = path.join(tempDir, "specs", "new-spec-without-fm.md");
    const content = `# Test New Spec

This is a test spec without any frontmatter and no DB entry.
It should be deleted as orphaned.
`;
    fs.writeFileSync(specPath, content, "utf8");

    // Verify file exists before watcher starts
    expect(fs.existsSync(specPath)).toBe(true);

    // Start watcher with ignoreInitial: false to detect existing files
    control = startWatcher({
      db,
      baseDir: tempDir,
      ignoreInitial: false,
      onLog: (msg) => logs.push(msg),
      onError: (err) => errors.push(err),
    });

    // Wait for watcher to process the file
    await new Promise((resolve) => setTimeout(resolve, 800));

    // File should be deleted as orphaned (no DB entry)
    expect(fs.existsSync(specPath)).toBe(false);

    // Verify orphaned file handling was logged
    expect(
      logs.some((log) => log.includes("Orphaned file detected") || log.includes("Deleted orphaned"))
    ).toBe(true);

    // No errors should occur
    expect(errors.length).toBe(0);
  });

  it("should delete orphaned spec file with frontmatter but no DB entry", async () => {
    const logs: string[] = [];
    const errors: Error[] = [];

    // Create a spec file WITH frontmatter but WITHOUT a DB entry
    // Since the ID doesn't exist in DB, it should be deleted as orphaned
    const specPath = path.join(tempDir, "specs", "existing-fm.md");
    const content = `---
id: SPEC-999
title: Orphaned Spec
priority: 1
created_at: '2025-01-01 00:00:00'
---

# Orphaned Spec

This spec has frontmatter but no DB entry, so it's orphaned.
`;
    fs.writeFileSync(specPath, content, "utf8");

    // Verify file exists before watcher starts
    expect(fs.existsSync(specPath)).toBe(true);

    // Start watcher
    control = startWatcher({
      db,
      baseDir: tempDir,
      ignoreInitial: false,
      onLog: (msg) => logs.push(msg),
      onError: (err) => errors.push(err),
    });

    // Wait for watcher to process
    await new Promise((resolve) => setTimeout(resolve, 800));

    // File should be deleted as orphaned (no DB entry for SPEC-999)
    expect(fs.existsSync(specPath)).toBe(false);

    // Verify orphaned file handling was logged
    expect(
      logs.some((log) => log.includes("Orphaned file detected") || log.includes("Deleted orphaned"))
    ).toBe(true);

    // No errors should occur
    expect(errors.length).toBe(0);
  });

  it("should preserve valid spec file with matching DB entry", async () => {
    const logs: string[] = [];
    const errors: Error[] = [];

    // First create the spec in the database (DB is source of truth)
    const { createSpec, getSpec } = await import("../../src/operations/specs.js");
    createSpec(db, {
      id: "s-valid",
      uuid: "test-uuid-valid",
      title: "Valid Spec",
      file_path: "specs/valid-spec.md",
      content: "# Valid Spec\n\nThis spec exists in both DB and markdown.",
      priority: 1,
    });

    // Create matching markdown file
    const specPath = path.join(tempDir, "specs", "valid-spec.md");
    const content = `---
id: s-valid
title: Valid Spec
priority: 1
---

# Valid Spec

This spec exists in both DB and markdown.
`;
    fs.writeFileSync(specPath, content, "utf8");

    // Verify file exists before watcher starts
    expect(fs.existsSync(specPath)).toBe(true);

    // Start watcher
    control = startWatcher({
      db,
      baseDir: tempDir,
      ignoreInitial: false,
      onLog: (msg) => logs.push(msg),
      onError: (err) => errors.push(err),
    });

    // Wait for watcher to process
    await new Promise((resolve) => setTimeout(resolve, 800));

    // File should NOT be deleted (it has a matching DB entry)
    expect(fs.existsSync(specPath)).toBe(true);

    // Verify spec still exists in database
    const spec = getSpec(db, "s-valid");
    expect(spec).not.toBeNull();
    expect(spec?.title).toBe("Valid Spec");

    // No errors should occur
    expect(errors.length).toBe(0);
  });
});
