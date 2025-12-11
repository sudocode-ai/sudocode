/**
 * Unit tests for watcher typed callbacks (onEntitySync, onFileChange)
 * Tests the new event system that replaces log parsing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../src/db.js";
import { startWatcher } from "../../src/watcher.js";
import type { EntitySyncEvent } from "@sudocode-ai/types";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createIssue, updateIssue } from "../../src/operations/issues.js";
import { createSpec } from "../../src/operations/specs.js";
import { exportToJSONL } from "../../src/export.js";

describe("Watcher Typed Callbacks", () => {
  let db: Database.Database;
  let tempDir: string;
  let control: ReturnType<typeof startWatcher> | null = null;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-callback-test-"));

    // Create directory structure
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "issues"), { recursive: true });

    // Create empty JSONL files
    fs.writeFileSync(path.join(tempDir, "specs.jsonl"), "", "utf8");
    fs.writeFileSync(path.join(tempDir, "issues.jsonl"), "", "utf8");

    // Create config.json
    const config = {
      version: "1.0.0",
      id_prefix: { spec: "s", issue: "i" },
    };
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify(config, null, 2)
    );
  });

  afterEach(async () => {
    if (control) {
      await control.stop();
      control = null;
    }
    db.close();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("onEntitySync - JSONL changes", () => {
    it("should call onEntitySync when JSONL changes (import needed)", async () => {
      const events: EntitySyncEvent[] = [];

      // Create an issue in DB and export
      createIssue(db, {
        id: "i-test1",
        uuid: "uuid-1",
        title: "Test Issue",
        content: "Original content",
        status: "open",
        priority: 2,
      });
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher with callback
      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Modify JSONL directly
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = JSON.parse(fs.readFileSync(issuesJsonlPath, "utf8").trim());
      issueData.title = "Updated Title";
      issueData.content = "Updated content";
      issueData.updated_at = new Date().toISOString(); // Trigger import
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

      // Wait for watcher to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify callback was called
      expect(events.length).toBeGreaterThan(0);
      const event = events.find((e) => e.entityId === "i-test1");
      expect(event).toBeDefined();
      expect(event?.entityType).toBe("issue");
      expect(event?.action).toBe("updated");
      expect(event?.source).toBe("jsonl");
      expect(event?.baseDir).toBe(tempDir);
      expect(event?.entity).toBeDefined();
      expect(event?.entity).toMatchObject({
        id: "i-test1",
        title: "Updated Title",
      });
      expect(event?.version).toBe(1);
    });

    it.skip("should emit events even when jsonlNeedsImport returns false (Gap 1 fix)", async () => {
      const events: EntitySyncEvent[] = [];

      // Create issue in DB
      createIssue(db, {
        id: "i-test2",
        uuid: "uuid-2",
        title: "Test Issue 2",
        content: "Content",
        status: "open",
        priority: 2,
      });

      // Update via DB directly (simulate CLI update)
      updateIssue(db, "i-test2", { status: "closed" });

      // Export to JSONL
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher
      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Modify JSONL file to trigger watcher (even though DB already synced)
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = JSON.parse(fs.readFileSync(issuesJsonlPath, "utf8").trim());
      // Change updated_at to force file change detection
      issueData.updated_at = new Date().toISOString();
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Event should STILL be emitted (this is the bug fix!)
      expect(events.length).toBeGreaterThan(0);
      const event = events.find((e) => e.entityId === "i-test2");
      expect(event).toBeDefined();
      expect(event?.action).toBe("updated");
    });

    it("should emit events for multiple entities changed in JSONL", async () => {
      const events: EntitySyncEvent[] = [];

      // Create multiple issues
      createIssue(db, {
        id: "i-multi1",
        uuid: "uuid-multi1",
        title: "Multi 1",
        content: "Content 1",
        status: "open",
        priority: 2,
      });
      createIssue(db, {
        id: "i-multi2",
        uuid: "uuid-multi2",
        title: "Multi 2",
        content: "Content 2",
        status: "open",
        priority: 2,
      });
      await exportToJSONL(db, { outputDir: tempDir });

      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Update both in JSONL
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const lines = fs.readFileSync(issuesJsonlPath, "utf8").trim().split("\n");
      const issue1 = JSON.parse(lines[0]);
      const issue2 = JSON.parse(lines[1]);
      issue1.title = "Updated Multi 1";
      issue1.updated_at = new Date().toISOString();
      issue2.title = "Updated Multi 2";
      issue2.updated_at = new Date().toISOString();
      fs.writeFileSync(
        issuesJsonlPath,
        JSON.stringify(issue1) + "\n" + JSON.stringify(issue2) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should emit event for each changed entity
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.find((e) => e.entityId === "i-multi1")).toBeDefined();
      expect(events.find((e) => e.entityId === "i-multi2")).toBeDefined();
    });

    it("should detect content changes even without timestamp update", async () => {
      const events: EntitySyncEvent[] = [];

      // Create an issue in DB and export
      createIssue(db, {
        id: "i-content-test",
        uuid: "uuid-content-test",
        title: "Original Title",
        content: "Original content",
        status: "open",
        priority: 2,
      });
      await exportToJSONL(db, { outputDir: tempDir });

      // Start watcher with callback
      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Modify JSONL content WITHOUT changing timestamp
      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = JSON.parse(fs.readFileSync(issuesJsonlPath, "utf8").trim());
      const originalTimestamp = issueData.updated_at;

      // Change content but keep same timestamp
      issueData.title = "Modified Title";
      issueData.content = "Modified content";
      // Don't update timestamp - this is the key test case
      // issueData.updated_at stays the same

      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

      // Wait for watcher to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify change was detected and imported
      expect(events.length).toBeGreaterThan(0);
      const event = events.find((e) => e.entityId === "i-content-test");
      expect(event).toBeDefined();
      expect(event?.action).toBe("updated");
      expect(event?.entity).toBeDefined();

      // Most importantly: verify database was updated with NEW content
      expect(event?.entity).toMatchObject({
        id: "i-content-test",
        title: "Modified Title",
        content: "Modified content",
      });

      // Verify timestamp was preserved
      expect(event?.entity?.updated_at).toBe(originalTimestamp);
    });

    it.skip("should support async callbacks", async () => {
      const events: EntitySyncEvent[] = [];
      let asyncCompleted = false;

      createIssue(db, {
        id: "i-async",
        uuid: "uuid-async",
        title: "Async Test",
        content: "Content",
        status: "open",
        priority: 2,
      });
      await exportToJSONL(db, { outputDir: tempDir });

      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: async (event) => {
          events.push(event);
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 50));
          asyncCompleted = true;
        },
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = JSON.parse(fs.readFileSync(issuesJsonlPath, "utf8").trim());
      issueData.updated_at = new Date().toISOString();
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(events.length).toBeGreaterThan(0);
      expect(asyncCompleted).toBe(true);
    });
  });

  describe("onEntitySync - Markdown changes", () => {
    it("should call onEntitySync when markdown file changes (entity exists in DB)", async () => {
      const events: EntitySyncEvent[] = [];

      // First create the spec in the database (DB is source of truth for entity existence)
      createSpec(db, {
        id: "s-md1",
        uuid: "test-uuid-md1",
        title: "Test Spec OLD",
        file_path: "specs/s-md1 - Test Spec.md",
        content: "Old content",
        priority: 2,
      });

      // Set DB timestamp to past so markdown will be considered newer
      const { updateSpec } = await import("../../src/operations/specs.js");
      const pastTime = new Date(Date.now() - 60000).toISOString();
      updateSpec(db, "s-md1", { updated_at: pastTime });

      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Create markdown file with updated content
      const specPath = path.join(tempDir, "specs", "s-md1 - Test Spec.md");
      const content = `---
id: s-md1
title: Test Spec
---

# Test Spec

This is updated test content.
`;
      fs.writeFileSync(specPath, content);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify callback was called with source: markdown
      expect(events.length).toBeGreaterThan(0);
      const event = events.find((e) => e.entityId === "s-md1");
      expect(event).toBeDefined();
      expect(event?.entityType).toBe("spec");
      expect(event?.action).toBe("updated");
      expect(event?.source).toBe("markdown");
      expect(event?.baseDir).toBe(tempDir);
      expect(event?.entity).toBeDefined();
      expect(event?.version).toBe(1);
    });

    it("should include entity data in markdown sync events", async () => {
      const events: EntitySyncEvent[] = [];

      // First create the issue in the database (DB is source of truth for entity existence)
      createIssue(db, {
        id: "i-md2",
        uuid: "test-uuid-md2",
        title: "Test Issue OLD",
        content: "Old content",
        status: "open",
        priority: 2,
      });

      // Set DB timestamp to past so markdown will be considered newer
      const { updateIssue } = await import("../../src/operations/issues.js");
      const pastTime = new Date(Date.now() - 60000).toISOString();
      updateIssue(db, "i-md2", { updated_at: pastTime });

      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const issuePath = path.join(tempDir, "issues", "i-md2 - Test Issue.md");
      const content = `---
id: i-md2
title: Test Issue
status: open
---

# Test Issue

Updated content here.
`;
      fs.writeFileSync(issuePath, content);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const event = events.find((e) => e.entityId === "i-md2");
      expect(event?.entity).toBeDefined();
      expect(event?.entity).toMatchObject({
        id: "i-md2",
        title: "Test Issue",
        status: "open",
      });
    });
  });

  describe("Backward compatibility", () => {
    it.skip("should call both onLog and onEntitySync", async () => {
      const logs: string[] = [];
      const events: EntitySyncEvent[] = [];

      createIssue(db, {
        id: "i-compat",
        uuid: "uuid-compat",
        title: "Compat Test",
        content: "Content",
        status: "open",
        priority: 2,
      });
      await exportToJSONL(db, { outputDir: tempDir });

      control = startWatcher({
        db,
        baseDir: tempDir,
        onLog: (msg) => logs.push(msg),
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = JSON.parse(fs.readFileSync(issuesJsonlPath, "utf8").trim());
      issueData.updated_at = new Date().toISOString();
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Both should be called
      expect(logs.some((log) => log.includes("Synced issue i-compat"))).toBe(true);
      expect(events.find((e) => e.entityId === "i-compat")).toBeDefined();
    });

    it.skip("should work without callbacks (backward compat)", async () => {
      const logs: string[] = [];

      createIssue(db, {
        id: "i-noCallback",
        uuid: "uuid-noCallback",
        title: "No Callback Test",
        content: "Content",
        status: "open",
        priority: 2,
      });
      await exportToJSONL(db, { outputDir: tempDir });

      // No callbacks provided
      control = startWatcher({
        db,
        baseDir: tempDir,
        onLog: (msg) => logs.push(msg),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const issuesJsonlPath = path.join(tempDir, "issues.jsonl");
      const issueData = JSON.parse(fs.readFileSync(issuesJsonlPath, "utf8").trim());
      issueData.updated_at = new Date().toISOString();
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should still work - log should be called
      expect(logs.some((log) => log.includes("Synced issue i-noCallback"))).toBe(true);
    });
  });

  describe("Event data validation", () => {
    it.skip("should include all required fields in events", async () => {
      const events: EntitySyncEvent[] = [];

      createSpec(db, {
        id: "s-validation",
        uuid: "uuid-validation",
        title: "Validation Test",
        content: "Content",
        priority: 2,
        file_path: "specs/s-validation - Validation Test.md",
      });
      await exportToJSONL(db, { outputDir: tempDir });

      control = startWatcher({
        db,
        baseDir: tempDir,
        onEntitySync: (event) => events.push(event),
        ignoreInitial: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const specsJsonlPath = path.join(tempDir, "specs.jsonl");
      const specData = JSON.parse(fs.readFileSync(specsJsonlPath, "utf8").trim());
      specData.updated_at = new Date().toISOString();
      fs.writeFileSync(specsJsonlPath, JSON.stringify(specData) + "\n");

      await new Promise((resolve) => setTimeout(resolve, 500));

      const event = events.find((e) => e.entityId === "s-validation");
      expect(event).toBeDefined();

      // Verify all required fields
      expect(event?.entityType).toBe("spec");
      expect(event?.entityId).toBe("s-validation");
      expect(event?.action).toBeDefined();
      expect(event?.filePath).toBeDefined();
      expect(event?.baseDir).toBe(tempDir);
      expect(event?.source).toBe("jsonl");
      expect(event?.timestamp).toBeInstanceOf(Date);
      expect(event?.version).toBe(1);

      // Verify optional entity field is included
      expect(event?.entity).toBeDefined();
    });
  });
});
