/**
 * Test that frontmatter is written back to new spec files
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../src/db.js";
import { startWatcher } from "../../src/watcher.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("File Watcher - Frontmatter Writeback", () => {
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

  it("should write frontmatter back to new spec file without frontmatter", async () => {
    const logs: string[] = [];
    const errors: Error[] = [];

    // Create a spec file WITHOUT frontmatter
    const specPath = path.join(tempDir, "specs", "new-spec-without-fm.md");
    const content = `# Test New Spec

This is a test spec without any frontmatter.
The watcher should auto-generate an ID and write it back.
`;
    fs.writeFileSync(specPath, content, "utf8");

    // Start watcher with ignoreInitial: false to detect existing files
    control = startWatcher({
      db,
      baseDir: tempDir,
      debounceDelay: 50,
      ignoreInitial: false,
      onLog: (msg) => logs.push(msg),
      onError: (err) => errors.push(err),
    });

    // Wait for watcher to process the file
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Read the file again
    const updatedContent = fs.readFileSync(specPath, "utf8");

    // Check that frontmatter was added
    expect(updatedContent.startsWith("---")).toBe(true);

    // Check that an ID was generated
    expect(updatedContent).toMatch(/id:\s*SPEC-\d{3}/);

    // Check that title was extracted
    expect(updatedContent).toContain("title:");

    // Check that priority was set
    expect(updatedContent).toMatch(/priority:\s*\d/);

    // Check that timestamps were added
    expect(updatedContent).toContain("created_at:");

    // Verify spec was created in database
    const { getSpecByFilePath } = await import("../../src/operations/specs.js");
    const spec = getSpecByFilePath(db, "specs/new-spec-without-fm.md");
    expect(spec).not.toBeNull();
    expect(spec?.id).toMatch(/SPEC-\d{3}/);

    // No errors should occur
    expect(errors.length).toBe(0);
  });

  it("should not create duplicate frontmatter for spec that already has frontmatter", async () => {
    const logs: string[] = [];
    const errors: Error[] = [];

    // Create a spec file WITH frontmatter
    const specPath = path.join(tempDir, "specs", "existing-fm.md");
    const content = `---
id: SPEC-999
title: Existing Spec
priority: 1
created_at: '2025-01-01 00:00:00'
---

# Existing Spec

This spec already has frontmatter.
`;
    fs.writeFileSync(specPath, content, "utf8");

    // Start watcher
    control = startWatcher({
      db,
      baseDir: tempDir,
      debounceDelay: 50,
      ignoreInitial: false,
      onLog: (msg) => logs.push(msg),
      onError: (err) => errors.push(err),
    });

    // Wait for watcher to process
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Read the file again
    const updatedContent = fs.readFileSync(specPath, "utf8");

    // Should still have frontmatter (and only one set of it)
    const frontmatterCount = (
      updatedContent.match(/^---$/gm) || []
    ).length;
    expect(frontmatterCount).toBe(2); // Opening and closing ---

    // ID should be unchanged
    expect(updatedContent).toContain("id: SPEC-999");

    // No errors should occur
    expect(errors.length).toBe(0);
  });
});
