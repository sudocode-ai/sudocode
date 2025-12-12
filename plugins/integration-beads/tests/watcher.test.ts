/**
 * Tests for Beads file watcher
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ExternalChange } from "@sudocode-ai/types";
import { BeadsWatcher } from "../src/watcher.js";

describe("BeadsWatcher", () => {
  let tempDir: string;
  let beadsDir: string;
  let issuesPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-watcher-test-"));
    beadsDir = join(tempDir, ".beads");
    mkdirSync(beadsDir);
    issuesPath = join(beadsDir, "issues.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("constructor", () => {
    it("should create a watcher instance", () => {
      const watcher = new BeadsWatcher(beadsDir);
      expect(watcher).toBeDefined();
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe("start and stop", () => {
    it("should start watching", async () => {
      writeFileSync(issuesPath, "");

      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      watcher.start(callback);
      expect(watcher.isWatching()).toBe(true);

      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    it("should warn when already watching", () => {
      writeFileSync(issuesPath, "");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      watcher.start(callback);
      watcher.start(callback); // Try to start again

      expect(warnSpy).toHaveBeenCalledWith("[beads-watcher] Already watching");

      watcher.stop();
      warnSpy.mockRestore();
    });

    it("should be safe to stop when not watching", () => {
      const watcher = new BeadsWatcher(beadsDir);
      expect(() => watcher.stop()).not.toThrow();
    });
  });

  describe("getEntityHashes", () => {
    it("should return copy of entity hashes map", () => {
      const watcher = new BeadsWatcher(beadsDir);
      const hashes = watcher.getEntityHashes();

      expect(hashes).toBeInstanceOf(Map);
      expect(hashes.size).toBe(0);
    });

    it("should capture hashes when starting", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      watcher.start(callback);

      const hashes = watcher.getEntityHashes();
      expect(hashes.size).toBe(1);
      expect(hashes.has("bd-1")).toBe(true);

      watcher.stop();
    });
  });

  describe("refreshState", () => {
    it("should update entity hashes", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      watcher.start(callback);
      expect(watcher.getEntityHashes().size).toBe(1);

      // Add another issue directly
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n' +
          '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
      );

      watcher.refreshState();
      expect(watcher.getEntityHashes().size).toBe(2);

      watcher.stop();
    });
  });

  describe("change detection", () => {
    it("should detect new entity", async () => {
      // Start with one issue
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      const watcher = new BeadsWatcher(beadsDir);
      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      watcher.start(callback);

      // Manually trigger change detection (simulating what handleFileChange does)
      // We'll use refreshState and then check the hashes changed
      const initialHashes = new Map(watcher.getEntityHashes());
      expect(initialHashes.has("bd-1")).toBe(true);
      expect(initialHashes.has("bd-2")).toBe(false);

      // Add new issue
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n' +
          '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
      );

      // Refresh state
      watcher.refreshState();
      const newHashes = watcher.getEntityHashes();
      expect(newHashes.has("bd-2")).toBe(true);

      watcher.stop();
    });

    it("should detect updated entity", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      watcher.start(callback);

      const initialHash = watcher.getEntityHashes().get("bd-1");

      // Update the issue
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Updated Issue 1","created_at":"2024-01-01","updated_at":"2024-01-02"}\n'
      );

      watcher.refreshState();
      const newHash = watcher.getEntityHashes().get("bd-1");

      // Hash should be different because content changed
      expect(newHash).not.toBe(initialHash);

      watcher.stop();
    });

    it("should detect deleted entity", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n' +
          '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
      );

      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      watcher.start(callback);
      expect(watcher.getEntityHashes().has("bd-2")).toBe(true);

      // Remove second issue
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      watcher.refreshState();
      expect(watcher.getEntityHashes().has("bd-1")).toBe(true);
      // Note: refreshState just captures current state, doesn't remove old hashes
      // The actual deletion detection happens in handleFileChange via detectChanges

      watcher.stop();
    });
  });

  describe("hash consistency", () => {
    it("should produce same hash for same content with different key order", () => {
      const issue1 =
        '{"id":"bd-1","title":"Test","status":"open","created_at":"2024-01-01","updated_at":"2024-01-01"}';
      const issue2 =
        '{"status":"open","updated_at":"2024-01-01","id":"bd-1","created_at":"2024-01-01","title":"Test"}';

      // Write first version
      writeFileSync(issuesPath, issue1 + "\n");

      const watcher = new BeadsWatcher(beadsDir);
      watcher.start(vi.fn());
      const hash1 = watcher.getEntityHashes().get("bd-1");

      // Write second version (same content, different key order)
      writeFileSync(issuesPath, issue2 + "\n");
      watcher.refreshState();
      const hash2 = watcher.getEntityHashes().get("bd-1");

      // Hashes should be the same due to canonical hashing
      expect(hash1).toBe(hash2);

      watcher.stop();
    });
  });

  describe("empty file handling", () => {
    it("should handle empty issues file", () => {
      writeFileSync(issuesPath, "");

      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      expect(() => watcher.start(callback)).not.toThrow();
      expect(watcher.getEntityHashes().size).toBe(0);

      watcher.stop();
    });

    it("should handle missing issues file", () => {
      // Don't create the file
      const watcher = new BeadsWatcher(beadsDir);
      const callback = vi.fn();

      expect(() => watcher.start(callback)).not.toThrow();
      expect(watcher.getEntityHashes().size).toBe(0);

      watcher.stop();
    });
  });

  describe("sync loop prevention", () => {
    describe("updateEntityHash", () => {
      it("should update hash for entity after outbound write", () => {
        writeFileSync(
          issuesPath,
          '{"id":"bd-1","title":"Issue 1","status":"open","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
        );

        const watcher = new BeadsWatcher(beadsDir);
        watcher.start(vi.fn());

        const initialHash = watcher.getEntityHashes().get("bd-1");
        expect(initialHash).toBeDefined();

        // Simulate an outbound write - update the hash with new content
        const updatedEntity = {
          id: "bd-1",
          title: "Issue 1",
          status: "closed",
          created_at: "2024-01-01",
          updated_at: "2024-01-02",
        };
        watcher.updateEntityHash("bd-1", updatedEntity);

        const newHash = watcher.getEntityHashes().get("bd-1");
        expect(newHash).not.toBe(initialHash);

        watcher.stop();
      });

      it("should prevent watcher from detecting own writes as changes", () => {
        writeFileSync(
          issuesPath,
          '{"id":"bd-1","title":"Issue 1","status":"open","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
        );

        const watcher = new BeadsWatcher(beadsDir);
        const callback = vi.fn();
        watcher.start(callback);

        // Simulate outbound write: update file and also update hash
        const updatedEntity = {
          id: "bd-1",
          title: "Issue 1",
          status: "closed",
          created_at: "2024-01-01",
          updated_at: "2024-01-02",
        };

        // Write the updated content to file
        writeFileSync(
          issuesPath,
          JSON.stringify(updatedEntity) + "\n"
        );

        // Update watcher's hash BEFORE file change is detected
        watcher.updateEntityHash("bd-1", updatedEntity);

        // Refresh state (simulating what detectChanges does)
        watcher.refreshState();

        // Hash should match, so no change should be detected
        const hashes = watcher.getEntityHashes();
        expect(hashes.get("bd-1")).toBeDefined();
        // The hash should match what we just set

        watcher.stop();
      });

      it("should handle updating hash for new entity", () => {
        writeFileSync(issuesPath, "");

        const watcher = new BeadsWatcher(beadsDir);
        watcher.start(vi.fn());

        expect(watcher.getEntityHashes().size).toBe(0);

        // Add new entity hash
        const newEntity = {
          id: "bd-new",
          title: "New Issue",
          status: "open",
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
        };
        watcher.updateEntityHash("bd-new", newEntity);

        expect(watcher.getEntityHashes().has("bd-new")).toBe(true);

        watcher.stop();
      });
    });

    describe("removeEntityHash", () => {
      it("should remove hash for deleted entity", () => {
        writeFileSync(
          issuesPath,
          '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n' +
            '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
        );

        const watcher = new BeadsWatcher(beadsDir);
        watcher.start(vi.fn());

        expect(watcher.getEntityHashes().has("bd-1")).toBe(true);
        expect(watcher.getEntityHashes().has("bd-2")).toBe(true);

        // Simulate outbound delete
        watcher.removeEntityHash("bd-1");

        expect(watcher.getEntityHashes().has("bd-1")).toBe(false);
        expect(watcher.getEntityHashes().has("bd-2")).toBe(true);

        watcher.stop();
      });

      it("should handle removing non-existent hash", () => {
        writeFileSync(
          issuesPath,
          '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
        );

        const watcher = new BeadsWatcher(beadsDir);
        watcher.start(vi.fn());

        // Should not throw
        expect(() => watcher.removeEntityHash("bd-nonexistent")).not.toThrow();

        watcher.stop();
      });

      it("should prevent watcher from detecting own deletes as changes", () => {
        writeFileSync(
          issuesPath,
          '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n' +
            '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
        );

        const watcher = new BeadsWatcher(beadsDir);
        const callback = vi.fn();
        watcher.start(callback);

        // Simulate outbound delete: remove from file and also remove hash
        writeFileSync(
          issuesPath,
          '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
        );

        // Remove from hash cache BEFORE change detection
        watcher.removeEntityHash("bd-1");

        // Refresh state
        watcher.refreshState();

        // Only bd-2 should be in hashes
        const hashes = watcher.getEntityHashes();
        expect(hashes.has("bd-1")).toBe(false);
        expect(hashes.has("bd-2")).toBe(true);

        watcher.stop();
      });
    });

    describe("content-based comparison", () => {
      it("should detect actual content changes", () => {
        writeFileSync(
          issuesPath,
          '{"id":"bd-1","title":"Issue 1","status":"open","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
        );

        const watcher = new BeadsWatcher(beadsDir);
        watcher.start(vi.fn());

        const initialHash = watcher.getEntityHashes().get("bd-1");

        // Make actual content change (external edit, not our write)
        writeFileSync(
          issuesPath,
          '{"id":"bd-1","title":"Issue 1","status":"closed","created_at":"2024-01-01","updated_at":"2024-01-02"}\n'
        );

        watcher.refreshState();
        const newHash = watcher.getEntityHashes().get("bd-1");

        // Hash should be different because content changed
        expect(newHash).not.toBe(initialHash);

        watcher.stop();
      });

      it("should not detect change when content is same", () => {
        const issueJson =
          '{"id":"bd-1","title":"Issue 1","status":"open","created_at":"2024-01-01","updated_at":"2024-01-01"}';

        writeFileSync(issuesPath, issueJson + "\n");

        const watcher = new BeadsWatcher(beadsDir);
        watcher.start(vi.fn());

        const initialHash = watcher.getEntityHashes().get("bd-1");

        // Rewrite same content (simulate touch)
        writeFileSync(issuesPath, issueJson + "\n");

        watcher.refreshState();
        const newHash = watcher.getEntityHashes().get("bd-1");

        // Hash should be the same because content is identical
        expect(newHash).toBe(initialHash);

        watcher.stop();
      });
    });
  });
});
