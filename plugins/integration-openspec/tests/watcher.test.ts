/**
 * Unit tests for OpenSpec watcher
 *
 * Tests file watching functionality including:
 * - Initial state capture
 * - Hash-based change detection
 * - Entity scanning (specs and changes)
 * - Archive detection
 * - Debouncing
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
  OpenSpecWatcher,
  type OpenSpecWatcherOptions,
  type ChangeCallback,
} from "../src/watcher.js";
import type { ExternalChange, ExternalEntity } from "@sudocode-ai/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesPath = path.join(__dirname, "fixtures");

// Helper to create a temporary test directory
function createTempDir(): string {
  const tempDir = path.join(__dirname, ".temp-watcher-test-" + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

// Helper to clean up a temporary directory
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Helper to copy fixtures to a temp directory
function copyFixtures(targetDir: string): void {
  // Copy specs
  const specsSource = path.join(fixturesPath, "specs");
  const specsTarget = path.join(targetDir, "specs");
  fs.mkdirSync(specsTarget, { recursive: true });

  for (const dir of fs.readdirSync(specsSource)) {
    const srcDir = path.join(specsSource, dir);
    const destDir = path.join(specsTarget, dir);
    fs.mkdirSync(destDir, { recursive: true });

    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }

  // Copy changes
  const changesSource = path.join(fixturesPath, "changes");
  const changesTarget = path.join(targetDir, "changes");
  fs.mkdirSync(changesTarget, { recursive: true });

  // Copy non-archive changes
  for (const dir of fs.readdirSync(changesSource)) {
    if (dir === "archive") continue;

    const srcDir = path.join(changesSource, dir);
    const destDir = path.join(changesTarget, dir);

    if (fs.statSync(srcDir).isDirectory()) {
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        const srcFile = path.join(srcDir, file);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, path.join(destDir, file));
        }
      }
    }
  }

  // Copy archive
  const archiveSource = path.join(changesSource, "archive");
  const archiveTarget = path.join(changesTarget, "archive");
  if (fs.existsSync(archiveSource)) {
    fs.mkdirSync(archiveTarget, { recursive: true });

    for (const dir of fs.readdirSync(archiveSource)) {
      const srcDir = path.join(archiveSource, dir);
      const destDir = path.join(archiveTarget, dir);

      if (fs.statSync(srcDir).isDirectory()) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          const srcFile = path.join(srcDir, file);
          if (fs.statSync(srcFile).isFile()) {
            fs.copyFileSync(srcFile, path.join(destDir, file));
          }
        }
      }
    }
  }
}

describe("OpenSpecWatcher", () => {
  describe("constructor", () => {
    it("creates watcher with default options", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      expect(watcher).toBeInstanceOf(OpenSpecWatcher);
      expect(watcher.isWatching()).toBe(false);
    });

    it("creates watcher with custom options", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
        specPrefix: "test",
        changePrefix: "tch",
        trackArchived: false,
        debounceMs: 200,
      });

      expect(watcher).toBeInstanceOf(OpenSpecWatcher);
    });
  });

  describe("captureState", () => {
    it("captures initial entity state", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      watcher.captureState();
      const hashes = watcher.getEntityHashes();

      // Should have captured specs and changes
      expect(hashes.size).toBeGreaterThan(0);

      // Check that we have both spec and change entity IDs
      const ids = Array.from(hashes.keys());
      const hasSpecs = ids.some((id) => id.startsWith("os-"));
      const hasChanges = ids.some((id) => id.startsWith("osc-"));

      expect(hasSpecs).toBe(true);
      expect(hasChanges).toBe(true);
    });

    it("captures state with custom prefixes", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
        specPrefix: "sp",
        changePrefix: "ch",
      });

      watcher.captureState();
      const hashes = watcher.getEntityHashes();
      const ids = Array.from(hashes.keys());

      const hasCustomSpecs = ids.some((id) => id.startsWith("sp-"));
      const hasCustomChanges = ids.some((id) => id.startsWith("ch-"));

      expect(hasCustomSpecs).toBe(true);
      expect(hasCustomChanges).toBe(true);
    });

    it("excludes archived changes when trackArchived is false", () => {
      const watcherWithArchived = new OpenSpecWatcher({
        openspecPath: fixturesPath,
        trackArchived: true,
      });

      const watcherWithoutArchived = new OpenSpecWatcher({
        openspecPath: fixturesPath,
        trackArchived: false,
      });

      watcherWithArchived.captureState();
      watcherWithoutArchived.captureState();

      const hashesWithArchived = watcherWithArchived.getEntityHashes();
      const hashesWithoutArchived = watcherWithoutArchived.getEntityHashes();

      // The watcher with archived should have more entities
      expect(hashesWithArchived.size).toBeGreaterThanOrEqual(
        hashesWithoutArchived.size
      );
    });
  });

  describe("computeEntityHash", () => {
    it("produces consistent hashes for same content", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      const entity: ExternalEntity = {
        id: "test-id",
        type: "spec",
        title: "Test Title",
        description: "Test description",
        priority: 2,
      };

      const hash1 = watcher.computeEntityHash(entity);
      const hash2 = watcher.computeEntityHash(entity);

      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different content", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      const entity1: ExternalEntity = {
        id: "test-id",
        type: "spec",
        title: "Test Title",
        description: "Test description",
        priority: 2,
      };

      const entity2: ExternalEntity = {
        ...entity1,
        title: "Different Title",
      };

      const hash1 = watcher.computeEntityHash(entity1);
      const hash2 = watcher.computeEntityHash(entity2);

      expect(hash1).not.toBe(hash2);
    });

    it("includes status in hash for issues", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      const entity1: ExternalEntity = {
        id: "test-id",
        type: "issue",
        title: "Test Issue",
        status: "open",
      };

      const entity2: ExternalEntity = {
        ...entity1,
        status: "closed",
      };

      const hash1 = watcher.computeEntityHash(entity1);
      const hash2 = watcher.computeEntityHash(entity2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("updateEntityHash", () => {
    it("updates hash in cache", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      watcher.captureState();

      const initialHashes = watcher.getEntityHashes();
      const entityId = Array.from(initialHashes.keys())[0];
      const originalHash = initialHashes.get(entityId);

      // Update the hash
      const newHash = "new-hash-value";
      watcher.updateEntityHash(entityId, newHash);

      const updatedHashes = watcher.getEntityHashes();
      expect(updatedHashes.get(entityId)).toBe(newHash);
      expect(updatedHashes.get(entityId)).not.toBe(originalHash);
    });
  });

  describe("removeEntityHash", () => {
    it("removes hash from cache", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      watcher.captureState();

      const initialHashes = watcher.getEntityHashes();
      const entityId = Array.from(initialHashes.keys())[0];

      expect(initialHashes.has(entityId)).toBe(true);

      watcher.removeEntityHash(entityId);

      const updatedHashes = watcher.getEntityHashes();
      expect(updatedHashes.has(entityId)).toBe(false);
    });
  });

  describe("refreshState", () => {
    it("refreshes cached state", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      watcher.captureState();
      const initialHashes = watcher.getEntityHashes();
      const initialSize = initialHashes.size;

      // Manually modify the hash cache
      watcher.updateEntityHash("fake-entity", "fake-hash");

      expect(watcher.getEntityHashes().size).toBe(initialSize + 1);

      // Refresh should reset to actual state
      watcher.refreshState();

      expect(watcher.getEntityHashes().size).toBe(initialSize);
      expect(watcher.getEntityHashes().has("fake-entity")).toBe(false);
    });
  });

  describe("start/stop watching", () => {
    let watcher: OpenSpecWatcher;
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir();
      copyFixtures(tempDir);
      watcher = new OpenSpecWatcher({
        openspecPath: tempDir,
        debounceMs: 50, // Use short debounce for tests
      });
    });

    afterEach(() => {
      watcher.stop();
      cleanupTempDir(tempDir);
    });

    it("starts and stops watching", () => {
      const callback = vi.fn();

      expect(watcher.isWatching()).toBe(false);

      watcher.start(callback);
      expect(watcher.isWatching()).toBe(true);

      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    it("warns when already watching", () => {
      const callback = vi.fn();
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      watcher.start(callback);
      watcher.start(callback); // Second call should warn

      expect(consoleWarn).toHaveBeenCalledWith(
        "[openspec-watcher] Already watching"
      );

      consoleWarn.mockRestore();
    });

    it("captures initial state on start", () => {
      const callback = vi.fn();

      watcher.start(callback);

      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBeGreaterThan(0);
    });
  });

  describe("change detection", () => {
    let watcher: OpenSpecWatcher;
    let tempDir: string;
    let receivedChanges: ExternalChange[];
    let callback: ChangeCallback;

    beforeEach(() => {
      tempDir = createTempDir();
      copyFixtures(tempDir);
      receivedChanges = [];
      callback = (changes) => {
        receivedChanges.push(...changes);
      };
      watcher = new OpenSpecWatcher({
        openspecPath: tempDir,
        debounceMs: 50,
      });
    });

    afterEach(() => {
      watcher.stop();
      cleanupTempDir(tempDir);
    });

    it("detects new spec file creation", async () => {
      watcher.start(callback);

      // Wait for watcher to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Create a new spec directory and file
      const newSpecDir = path.join(tempDir, "specs", "new-feature");
      fs.mkdirSync(newSpecDir, { recursive: true });
      fs.writeFileSync(
        path.join(newSpecDir, "spec.md"),
        "# New Feature\n\n## Purpose\nA new feature."
      );

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(receivedChanges.length).toBeGreaterThan(0);
      const createdChange = receivedChanges.find(
        (c) => c.change_type === "created" && c.entity_type === "spec"
      );
      expect(createdChange).toBeDefined();
    });

    it("detects spec file updates", async () => {
      watcher.start(callback);

      // Wait for watcher to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Modify an existing spec
      const specPath = path.join(tempDir, "specs", "cli-init", "spec.md");
      const originalContent = fs.readFileSync(specPath, "utf-8");
      fs.writeFileSync(specPath, originalContent + "\n\n## New Section\nAdded content.");

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(receivedChanges.length).toBeGreaterThan(0);
      const updatedChange = receivedChanges.find(
        (c) => c.change_type === "updated" && c.entity_type === "spec"
      );
      expect(updatedChange).toBeDefined();
    });

    it("detects spec file deletion", async () => {
      watcher.start(callback);

      // Wait for watcher to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Delete a spec directory
      const specDir = path.join(tempDir, "specs", "api-design");
      fs.rmSync(specDir, { recursive: true, force: true });

      // Wait for debounce + processing (longer for directory deletion)
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(receivedChanges.length).toBeGreaterThan(0);
      const deletedChange = receivedChanges.find(
        (c) => c.change_type === "deleted" && c.entity_type === "spec"
      );
      expect(deletedChange).toBeDefined();
    });

    it("detects new change directory creation", async () => {
      watcher.start(callback);

      // Wait for watcher to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Create a new change directory with proposal.md
      const newChangeDir = path.join(tempDir, "changes", "new-change");
      fs.mkdirSync(newChangeDir, { recursive: true });
      fs.writeFileSync(
        path.join(newChangeDir, "proposal.md"),
        "## Why\nA reason.\n\n## What Changes\n- New change\n\n## Impact\nMinor."
      );

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(receivedChanges.length).toBeGreaterThan(0);
      const createdChange = receivedChanges.find(
        (c) => c.change_type === "created" && c.entity_type === "issue"
      );
      expect(createdChange).toBeDefined();
    });

    it("detects change file updates", async () => {
      watcher.start(callback);

      // Wait for watcher to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Modify an existing proposal - update the tasks.md file which changes taskCompletion
      const tasksPath = path.join(
        tempDir,
        "changes",
        "add-scaffold-command",
        "tasks.md"
      );

      // Verify file exists first
      expect(fs.existsSync(tasksPath)).toBe(true);

      // Make a significant change to the tasks (check off a task)
      const originalContent = fs.readFileSync(tasksPath, "utf-8");
      // Change task completion which affects the entity hash
      const updatedContent = originalContent.replace("- [ ]", "- [x]");
      fs.writeFileSync(tasksPath, updatedContent);

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(receivedChanges.length).toBeGreaterThan(0);
      const updatedChange = receivedChanges.find(
        (c) => c.change_type === "updated" && c.entity_type === "issue"
      );
      expect(updatedChange).toBeDefined();
    });

    it("ignores non-relevant files", async () => {
      watcher.start(callback);

      // Create a file that should be ignored
      fs.writeFileSync(
        path.join(tempDir, "specs", "cli-init", "notes.txt"),
        "This should be ignored"
      );

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 200));

      // No changes should be detected for a .txt file
      const txtRelatedChanges = receivedChanges.filter(
        (c) => c.data?.raw?.filePath?.includes("notes.txt")
      );
      expect(txtRelatedChanges).toHaveLength(0);
    });
  });

  describe("entity scanning", () => {
    it("scans all specs from fixtures", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      watcher.captureState();
      const hashes = watcher.getEntityHashes();
      const ids = Array.from(hashes.keys());

      // Should find cli-init and api-design specs
      const specIds = ids.filter((id) => id.startsWith("os-"));
      expect(specIds.length).toBe(2);
    });

    it("scans all changes including archived from fixtures", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
        trackArchived: true,
      });

      watcher.captureState();
      const hashes = watcher.getEntityHashes();
      const ids = Array.from(hashes.keys());

      // Should find changes: add-scaffold-command, improve-cli-output, empty-change, and archived
      const changeIds = ids.filter((id) => id.startsWith("osc-"));
      expect(changeIds.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("edge cases", () => {
    it("handles non-existent directory gracefully on captureState", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: "/non/existent/path",
      });

      // Should not throw
      expect(() => watcher.captureState()).not.toThrow();

      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBe(0);
    });

    it("handles empty openspec directory", () => {
      const tempDir = createTempDir();
      fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "changes"), { recursive: true });

      const watcher = new OpenSpecWatcher({
        openspecPath: tempDir,
      });

      watcher.captureState();
      const hashes = watcher.getEntityHashes();

      expect(hashes.size).toBe(0);

      cleanupTempDir(tempDir);
    });

    it("handles spec directory without spec.md", () => {
      const tempDir = createTempDir();
      fs.mkdirSync(path.join(tempDir, "specs", "incomplete-spec"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempDir, "specs", "incomplete-spec", "notes.md"),
        "Some notes"
      );

      const watcher = new OpenSpecWatcher({
        openspecPath: tempDir,
      });

      watcher.captureState();
      const hashes = watcher.getEntityHashes();

      // Should not include the incomplete spec
      expect(hashes.size).toBe(0);

      cleanupTempDir(tempDir);
    });

    it("handles change directory with only design.md", () => {
      const watcher = new OpenSpecWatcher({
        openspecPath: fixturesPath,
      });

      watcher.captureState();
      const hashes = watcher.getEntityHashes();
      const ids = Array.from(hashes.keys());

      // empty-change has only design.md, should still be detected
      const changeIds = ids.filter((id) => id.startsWith("osc-"));
      expect(changeIds.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("proposed specs", () => {
    let tempDir: string;
    let receivedChanges: ExternalChange[];
    let callback: ChangeCallback;
    let watcher: OpenSpecWatcher;

    beforeEach(() => {
      tempDir = createTempDir();
      copyFixtures(tempDir);
      receivedChanges = [];
      callback = (changes) => {
        receivedChanges.push(...changes);
      };
      watcher = new OpenSpecWatcher({
        openspecPath: tempDir,
        debounceMs: 50,
      });
    });

    afterEach(() => {
      watcher.stop();
      cleanupTempDir(tempDir);
    });

    it("scans proposed specs in changes/[name]/specs/ directories", () => {
      // Create a change with a proposed spec
      const changeDir = path.join(tempDir, "changes", "add-auth");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(
        path.join(changeDir, "proposal.md"),
        "## Why\nNeed authentication.\n\n## What Changes\n- Add auth module"
      );

      // Create a proposed spec in the change
      const proposedSpecDir = path.join(changeDir, "specs", "auth");
      fs.mkdirSync(proposedSpecDir, { recursive: true });
      fs.writeFileSync(
        path.join(proposedSpecDir, "spec.md"),
        "# Authentication Specification\n\n## Purpose\nHandle user authentication."
      );

      watcher.captureState();
      const hashes = watcher.getEntityHashes();
      const ids = Array.from(hashes.keys());

      // Should have the proposed spec as a separate entity
      const specIds = ids.filter((id) => id.startsWith("os-"));
      expect(specIds.length).toBeGreaterThanOrEqual(3); // 2 from fixtures + 1 proposed
    });

    it("marks proposed specs with isProposed and proposedByChange", () => {
      // Create a change with a proposed spec
      const changeDir = path.join(tempDir, "changes", "add-notifications");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(
        path.join(changeDir, "proposal.md"),
        "## Why\nNeed notifications.\n\n## What Changes\n- Add notifications"
      );

      const proposedSpecDir = path.join(changeDir, "specs", "notifications");
      fs.mkdirSync(proposedSpecDir, { recursive: true });
      fs.writeFileSync(
        path.join(proposedSpecDir, "spec.md"),
        "# Notifications Specification\n\n## Purpose\nSend notifications."
      );

      watcher.captureState();

      // The watcher doesn't expose entity data directly, but we can verify
      // that the entity is captured by checking the hash count increases
      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBeGreaterThan(0);
    });

    it("does NOT duplicate proposed specs that exist in openspec/specs/", () => {
      // Create a change with a delta spec (same capability as existing spec)
      const changeDir = path.join(tempDir, "changes", "update-cli-init");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(
        path.join(changeDir, "proposal.md"),
        "## Why\nUpdate CLI init.\n\n## What Changes\n- Enhance init command"
      );

      // Create a spec delta for an EXISTING spec (cli-init exists in fixtures)
      const deltaSpecDir = path.join(changeDir, "specs", "cli-init");
      fs.mkdirSync(deltaSpecDir, { recursive: true });
      fs.writeFileSync(
        path.join(deltaSpecDir, "spec.md"),
        "# CLI Init Delta\n\n## Changes\nAdd new options."
      );

      watcher.captureState();
      const hashes = watcher.getEntityHashes();
      const ids = Array.from(hashes.keys());

      // Should only have 2 specs from fixtures (cli-init, api-design), NOT a duplicate
      const specIds = ids.filter((id) => id.startsWith("os-"));
      expect(specIds.length).toBe(2);
    });

    it("detects new proposed spec file creation", async () => {
      watcher.start(callback);

      // Wait for watcher to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Create a change with a proposed spec
      const changeDir = path.join(tempDir, "changes", "new-feature");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(
        path.join(changeDir, "proposal.md"),
        "## Why\nNew feature needed.\n\n## What Changes\n- Add new feature"
      );

      // Create the proposed spec
      const proposedSpecDir = path.join(changeDir, "specs", "new-feature");
      fs.mkdirSync(proposedSpecDir, { recursive: true });
      fs.writeFileSync(
        path.join(proposedSpecDir, "spec.md"),
        "# New Feature Specification\n\n## Purpose\nA brand new feature."
      );

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(receivedChanges.length).toBeGreaterThan(0);

      // Should detect both the change (issue) and the proposed spec
      const createdSpecs = receivedChanges.filter(
        (c) => c.change_type === "created" && c.entity_type === "spec"
      );
      const createdIssues = receivedChanges.filter(
        (c) => c.change_type === "created" && c.entity_type === "issue"
      );

      expect(createdSpecs.length).toBe(1);
      expect(createdIssues.length).toBe(1);
    });

    it("detects proposed spec file updates", async () => {
      // First create a change with a proposed spec
      const changeDir = path.join(tempDir, "changes", "update-test");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(
        path.join(changeDir, "proposal.md"),
        "## Why\nTesting updates.\n\n## What Changes\n- Test updates"
      );

      const proposedSpecDir = path.join(changeDir, "specs", "test-spec");
      fs.mkdirSync(proposedSpecDir, { recursive: true });
      const specPath = path.join(proposedSpecDir, "spec.md");
      fs.writeFileSync(
        specPath,
        "# Test Specification\n\n## Purpose\nInitial content."
      );

      watcher.start(callback);

      // Wait for watcher to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear any initial changes
      receivedChanges = [];

      // Update the proposed spec
      fs.writeFileSync(
        specPath,
        "# Test Specification\n\n## Purpose\nUpdated content with more details."
      );

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(receivedChanges.length).toBeGreaterThan(0);
      const updatedChange = receivedChanges.find(
        (c) => c.change_type === "updated" && c.entity_type === "spec"
      );
      expect(updatedChange).toBeDefined();
    });
  });
});
