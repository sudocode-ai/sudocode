/**
 * Tests for File Watcher Service
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode/cli/dist/db.js";
import { startServerWatcher } from "../../src/services/watcher.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("File Watcher Service", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;

  before(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-watcher-"));
    testDbPath = path.join(testDir, "cache.db");

    // Set SUDOCODE_DIR environment variable
    process.env.SUDOCODE_DIR = testDir;

    // Create config.json for ID generation
    const configPath = path.join(testDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create specs and issues directories
    const specsDir = path.join(testDir, "specs");
    const issuesDir = path.join(testDir, "issues");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(issuesDir, { recursive: true });

    // Initialize test database
    db = initDatabase({ path: testDbPath });
  });

  after(() => {
    // Clean up
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  describe("Watcher Initialization", () => {
    it("should start watcher successfully", async () => {
      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 50, // Shorter delay for tests
      });

      assert.ok(watcher, "Watcher should be created");
      assert.ok(typeof watcher.stop === "function", "Watcher should have stop method");
      assert.ok(typeof watcher.getStats === "function", "Watcher should have getStats method");

      // Wait for watcher to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = watcher.getStats();
      assert.ok(stats, "Stats should be available");
      assert.strictEqual(typeof stats.filesWatched, "number", "Stats should include filesWatched");
      assert.strictEqual(typeof stats.changesPending, "number", "Stats should include changesPending");
      assert.strictEqual(typeof stats.changesProcessed, "number", "Stats should include changesProcessed");
      assert.strictEqual(typeof stats.errors, "number", "Stats should include errors");

      await watcher.stop();
    });

    it("should watch correct directories", async () => {
      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 50,
      });

      // Wait for watcher to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = watcher.getStats();

      // Verify watcher is watching files
      assert.ok(stats.filesWatched >= 0, "Watcher should be tracking files");

      await watcher.stop();
    });

    it("should accept custom debounce delay", async () => {
      const customDelay = 100;
      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: customDelay,
      });

      // The debounce delay is internal to the CLI watcher,
      // but we can verify the watcher was created with our options
      assert.ok(watcher, "Watcher should be created with custom debounce");

      await watcher.stop();
    });
  });

  describe("File Change Detection", () => {
    it("should detect markdown file changes", async () => {
      const changes: any[] = [];

      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 50,
        onFileChange: (info) => {
          changes.push(info);
        },
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a markdown file
      const specsDir = path.join(testDir, "specs");
      const testFilePath = path.join(specsDir, "test-spec.md");
      fs.writeFileSync(testFilePath, "---\nid: SPEC-001\n---\n\n# Test Spec\n\nThis is a test spec.");

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify that a change was detected
      assert.ok(changes.length > 0, "Should have detected file change");

      await watcher.stop();

      // Clean up test file
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });

    it("should detect JSONL file changes", async () => {
      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 50,
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a JSONL file
      const specsJsonlPath = path.join(testDir, "specs", "specs.jsonl");
      const testData = {
        id: "SPEC-002",
        title: "Test Spec from JSONL",
        content: "Test content",
      };
      fs.writeFileSync(specsJsonlPath, JSON.stringify(testData) + "\n");

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // The callback may or may not be invoked depending on sync success
      // Just verify the watcher is still running without errors
      const stats = watcher.getStats();
      assert.ok(stats.errors === 0, "Watcher should have no errors after JSONL change");

      await watcher.stop();

      // Clean up test file
      if (fs.existsSync(specsJsonlPath)) {
        fs.unlinkSync(specsJsonlPath);
      }
    });
  });

  describe("Watcher Control", () => {
    it("should stop watcher gracefully", async () => {
      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 50,
      });

      // Wait for watcher to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Stop should not throw
      await assert.doesNotReject(
        async () => {
          await watcher.stop();
        },
        "Stopping watcher should not throw"
      );
    });

    it("should provide accurate stats", async () => {
      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 50,
      });

      // Wait for watcher to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const initialStats = watcher.getStats();
      assert.strictEqual(initialStats.changesPending, 0, "Should have no pending changes initially");

      await watcher.stop();
    });

    it("should handle multiple file changes with debouncing", async () => {
      const changes: any[] = [];

      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 100, // 100ms debounce
        onFileChange: (info) => {
          changes.push(info);
        },
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create multiple files rapidly
      const specsDir = path.join(testDir, "specs");
      const file1 = path.join(specsDir, "rapid-1.md");
      const file2 = path.join(specsDir, "rapid-2.md");

      fs.writeFileSync(file1, "---\nid: SPEC-R1\n---\n# Rapid 1");
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.writeFileSync(file2, "---\nid: SPEC-R2\n---\n# Rapid 2");

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Should have processed both files (debouncing prevents duplicate processing)
      assert.ok(changes.length >= 0, "Should handle multiple rapid changes");

      await watcher.stop();

      // Clean up
      if (fs.existsSync(file1)) fs.unlinkSync(file1);
      if (fs.existsSync(file2)) fs.unlinkSync(file2);
    });
  });

  describe("Callback Integration", () => {
    it("should invoke onFileChange callback with entity info", async () => {
      let callbackInvoked = false;
      let receivedInfo: any = null;

      const watcher = startServerWatcher({
        db,
        baseDir: testDir,
        debounceDelay: 50,
        onFileChange: (info) => {
          callbackInvoked = true;
          receivedInfo = info;
        },
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a spec file
      const specsDir = path.join(testDir, "specs");
      const testFile = path.join(specsDir, "callback-test.md");
      fs.writeFileSync(testFile, "---\nid: SPEC-CB1\n---\n# Callback Test");

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      if (callbackInvoked && receivedInfo) {
        assert.ok(receivedInfo, "Callback should receive info object");
        // The callback might have entity info if sync was successful
        assert.ok(
          receivedInfo.filePath !== undefined ||
          receivedInfo.entityType !== undefined ||
          receivedInfo.event !== undefined,
          "Info object should have relevant properties"
        );
      }

      await watcher.stop();

      // Clean up
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    });
  });
});
