/**
 * Tests for SpecKitWatcher
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SpecKitWatcher } from "../src/watcher.js";
import type { ExternalChange } from "@sudocode-ai/types";

describe("SpecKitWatcher", () => {
  let tempDir: string;
  let specifyPath: string;
  let watcher: SpecKitWatcher;

  beforeEach(() => {
    // Create temp directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-kit-watcher-test-"));
    specifyPath = path.join(tempDir, ".specify");

    // Create .specify directory structure
    fs.mkdirSync(path.join(specifyPath, "specs", "001-auth"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(specifyPath, "memory"), { recursive: true });
  });

  afterEach(() => {
    // Stop watcher if running
    if (watcher) {
      watcher.stop();
    }

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create watcher with default options", () => {
      watcher = new SpecKitWatcher({
        specifyPath,
      });

      expect(watcher).toBeDefined();
      expect(watcher.isWatching()).toBe(false);
    });

    it("should create watcher with custom options", () => {
      watcher = new SpecKitWatcher({
        specifyPath,
        specPrefix: "custom",
        taskPrefix: "ctask",
        includeSupportingDocs: false,
        includeConstitution: false,
      });

      expect(watcher).toBeDefined();
    });
  });

  describe("captureState", () => {
    it("should capture initial state with no files", () => {
      watcher = new SpecKitWatcher({ specifyPath });
      watcher.captureState();

      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBe(0);
    });

    it("should capture initial state with spec files", () => {
      // Create a spec file
      const specContent = `# Feature Specification: Test Feature

**Status**: Draft
**Created**: 2024-01-01

## Overview
Test feature overview.
`;
      fs.writeFileSync(
        path.join(specifyPath, "specs", "001-auth", "spec.md"),
        specContent
      );

      watcher = new SpecKitWatcher({ specifyPath });
      watcher.captureState();

      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBe(1);
    });

    it("should capture tasks as separate entities", () => {
      // Create a tasks file
      const tasksContent = `# Implementation Tasks

## Phase 1: Setup

- [ ] T001 Setup authentication module
- [ ] T002 Configure database
- [x] T003 Write initial tests
`;
      fs.writeFileSync(
        path.join(specifyPath, "specs", "001-auth", "tasks.md"),
        tasksContent
      );

      watcher = new SpecKitWatcher({ specifyPath });
      watcher.captureState();

      const hashes = watcher.getEntityHashes();
      // Each task should be a separate entity
      expect(hashes.size).toBe(3);
    });

    it("should capture constitution when enabled", () => {
      // Create constitution file
      const constitutionContent = `# Project Constitution

## Principles
- Write clean code
`;
      fs.writeFileSync(
        path.join(specifyPath, "memory", "constitution.md"),
        constitutionContent
      );

      watcher = new SpecKitWatcher({
        specifyPath,
        includeConstitution: true,
      });
      watcher.captureState();

      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBe(1);
      expect(hashes.has("sk-constitution")).toBe(true);
    });

    it("should not capture constitution when disabled", () => {
      // Create constitution file
      const constitutionContent = `# Project Constitution

## Principles
- Write clean code
`;
      fs.writeFileSync(
        path.join(specifyPath, "memory", "constitution.md"),
        constitutionContent
      );

      watcher = new SpecKitWatcher({
        specifyPath,
        includeConstitution: false,
      });
      watcher.captureState();

      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBe(0);
    });
  });

  describe("start/stop", () => {
    it("should start and stop watching", () => {
      watcher = new SpecKitWatcher({ specifyPath });

      expect(watcher.isWatching()).toBe(false);

      watcher.start(() => {});
      expect(watcher.isWatching()).toBe(true);

      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    it("should not start twice", () => {
      watcher = new SpecKitWatcher({ specifyPath });

      const callback = vi.fn();
      watcher.start(callback);
      watcher.start(callback); // Should warn but not crash

      expect(watcher.isWatching()).toBe(true);
    });
  });

  describe("hash management", () => {
    it("should update entity hash", () => {
      watcher = new SpecKitWatcher({ specifyPath });

      watcher.updateEntityHash("test-entity", "abc123");

      const hashes = watcher.getEntityHashes();
      expect(hashes.get("test-entity")).toBe("abc123");
    });

    it("should remove entity hash", () => {
      watcher = new SpecKitWatcher({ specifyPath });

      watcher.updateEntityHash("test-entity", "abc123");
      expect(watcher.getEntityHashes().has("test-entity")).toBe(true);

      watcher.removeEntityHash("test-entity");
      expect(watcher.getEntityHashes().has("test-entity")).toBe(false);
    });

    it("should refresh state", () => {
      // Create initial spec
      fs.writeFileSync(
        path.join(specifyPath, "specs", "001-auth", "spec.md"),
        "# Test\n\nContent"
      );

      watcher = new SpecKitWatcher({ specifyPath });
      watcher.captureState();
      const initialHashes = watcher.getEntityHashes();

      // Add another file
      fs.mkdirSync(path.join(specifyPath, "specs", "002-payments"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(specifyPath, "specs", "002-payments", "spec.md"),
        "# Payments\n\nContent"
      );

      // Refresh should pick up the new file
      watcher.refreshState();
      const refreshedHashes = watcher.getEntityHashes();

      expect(refreshedHashes.size).toBeGreaterThan(initialHashes.size);
    });
  });

  describe("change detection", () => {
    // Note: These tests are timing-dependent due to chokidar file watching
    // They may be flaky in CI environments due to file system event timing
    // The core watcher logic is tested by the state capture tests above
    const WATCH_TIMEOUT = 1500; // Increased timeout for file watcher

    it.skipIf(process.env.CI)(
      "should detect new spec file",
      async () => {
        watcher = new SpecKitWatcher({ specifyPath });
        watcher.captureState();

        // Track changes via callback
        const changes: ExternalChange[] = [];
        const callback = (c: ExternalChange[]) => {
          changes.push(...c);
        };

        watcher.start(callback);

        // Small delay to let watcher initialize
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add a new spec file
        fs.writeFileSync(
          path.join(specifyPath, "specs", "001-auth", "spec.md"),
          "# New Feature\n\nNew content"
        );

        // Wait for debounce and processing
        await new Promise((resolve) => setTimeout(resolve, WATCH_TIMEOUT));

        // Should have detected the new entity
        expect(changes.length).toBeGreaterThanOrEqual(1);
        expect(changes.some((c) => c.change_type === "created")).toBe(true);
      },
      5000
    );

    it.skipIf(process.env.CI)(
      "should detect updated spec file",
      async () => {
        // Create initial file
        const specPath = path.join(specifyPath, "specs", "001-auth", "spec.md");
        fs.writeFileSync(specPath, "# Initial\n\nInitial content");

        watcher = new SpecKitWatcher({ specifyPath });
        watcher.captureState();

        const changes: ExternalChange[] = [];
        watcher.start((c) => changes.push(...c));

        // Small delay to let watcher initialize
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Update the file
        fs.writeFileSync(specPath, "# Updated\n\nUpdated content");

        await new Promise((resolve) => setTimeout(resolve, WATCH_TIMEOUT));

        expect(changes.some((c) => c.change_type === "updated")).toBe(true);
      },
      5000
    );

    it.skipIf(process.env.CI)(
      "should detect deleted spec file",
      async () => {
        // Create initial file
        const specPath = path.join(specifyPath, "specs", "001-auth", "spec.md");
        fs.writeFileSync(specPath, "# Test\n\nContent");

        watcher = new SpecKitWatcher({ specifyPath });
        watcher.captureState();

        const changes: ExternalChange[] = [];
        watcher.start((c) => changes.push(...c));

        // Small delay to let watcher initialize
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Delete the file
        fs.unlinkSync(specPath);

        await new Promise((resolve) => setTimeout(resolve, WATCH_TIMEOUT));

        expect(changes.some((c) => c.change_type === "deleted")).toBe(true);
      },
      5000
    );
  });

  describe("entity types", () => {
    const WATCH_TIMEOUT = 1500;

    it.skipIf(process.env.CI)(
      "should identify spec entities correctly (with watcher)",
      async () => {
        watcher = new SpecKitWatcher({ specifyPath });
        watcher.captureState();

        const changes: ExternalChange[] = [];
        watcher.start((c) => changes.push(...c));

        // Small delay to let watcher initialize
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add a spec file
        fs.writeFileSync(
          path.join(specifyPath, "specs", "001-auth", "spec.md"),
          "# Feature Specification: Auth\n\nContent"
        );

        await new Promise((resolve) => setTimeout(resolve, WATCH_TIMEOUT));

        const specChange = changes.find(
          (c) => c.change_type === "created" && c.entity_type === "spec"
        );
        expect(specChange).toBeDefined();
      },
      5000
    );

    it.skipIf(process.env.CI)(
      "should identify task entities as issues (with watcher)",
      async () => {
        watcher = new SpecKitWatcher({ specifyPath });
        watcher.captureState();

        const changes: ExternalChange[] = [];
        watcher.start((c) => changes.push(...c));

        // Small delay to let watcher initialize
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Add a tasks file
        fs.writeFileSync(
          path.join(specifyPath, "specs", "001-auth", "tasks.md"),
          "# Tasks\n\n- [ ] T001 Do something"
        );

        await new Promise((resolve) => setTimeout(resolve, WATCH_TIMEOUT));

        const taskChange = changes.find(
          (c) => c.change_type === "created" && c.entity_type === "issue"
        );
        expect(taskChange).toBeDefined();
      },
      5000
    );

    // Test entity type identification via state refresh (reliable, no file watching)
    it("should correctly identify spec entity types via state refresh", () => {
      // Create a spec file
      fs.writeFileSync(
        path.join(specifyPath, "specs", "001-auth", "spec.md"),
        "# Feature Specification: Auth\n\nContent"
      );

      watcher = new SpecKitWatcher({ specifyPath });
      watcher.captureState();

      const hashes = watcher.getEntityHashes();
      // Should have captured the spec entity
      expect(hashes.size).toBe(1);

      // The ID should indicate it's a spec (not a task)
      const entityIds = Array.from(hashes.keys());
      expect(entityIds[0]).toMatch(/^sk-/);
      expect(entityIds[0]).not.toMatch(/^skt-/);
    });

    it("should correctly identify task entity types via state refresh", () => {
      // Create a tasks file
      fs.writeFileSync(
        path.join(specifyPath, "specs", "001-auth", "tasks.md"),
        "# Tasks\n\n- [ ] T001 Do something\n- [x] T002 Already done"
      );

      watcher = new SpecKitWatcher({ specifyPath });
      watcher.captureState();

      const hashes = watcher.getEntityHashes();
      // Should have captured both task entities
      expect(hashes.size).toBe(2);

      // The IDs should indicate they are tasks
      const entityIds = Array.from(hashes.keys());
      expect(entityIds.every((id) => id.startsWith("skt-"))).toBe(true);
    });
  });
});
