/**
 * Integration tests for real-time file watching
 *
 * Tests the BeadsWatcher detecting actual file system changes
 * and emitting the correct change events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ExternalChange } from "@sudocode-ai/types";
import beadsPlugin from "../../src/index.js";
import type { IntegrationProvider } from "@sudocode-ai/types";

describe("File Watcher Integration", () => {
  let tempDir: string;
  let beadsDir: string;
  let issuesPath: string;
  let provider: IntegrationProvider;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-watcher-integration-"));
    beadsDir = join(tempDir, ".beads");
    mkdirSync(beadsDir);
    issuesPath = join(beadsDir, "issues.jsonl");

    // Create empty issues file
    writeFileSync(issuesPath, "");

    provider = beadsPlugin.createProvider(
      { path: ".beads", issue_prefix: "test" },
      tempDir
    );

    await provider.initialize();
  });

  afterEach(async () => {
    provider.stopWatching();
    await provider.dispose();
    rmSync(tempDir, { recursive: true });
  });

  describe("startWatching / stopWatching", () => {
    it("should start and stop without errors", () => {
      const callback = vi.fn();

      expect(() => provider.startWatching(callback)).not.toThrow();
      expect(() => provider.stopWatching()).not.toThrow();
    });

    it("should be idempotent when stopping multiple times", () => {
      const callback = vi.fn();

      provider.startWatching(callback);
      provider.stopWatching();
      expect(() => provider.stopWatching()).not.toThrow();
    });
  });

  describe("Real-time Change Detection", () => {
    it("should detect file creation and report new entities", async () => {
      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);

      // Wait for watcher to initialize
      await sleep(200);

      // Create a new issue via direct file write (simulating external tool)
      const newIssue = {
        id: "external-new-001",
        title: "Externally Created",
        content: "Created by external tool",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      writeFileSync(issuesPath, JSON.stringify(newIssue) + "\n");

      // Wait for watcher to detect change
      await waitForCallback(callback, 1000);

      expect(changes.length).toBeGreaterThan(0);
      const createChange = changes.find((c) => c.change_type === "created");
      expect(createChange).toBeDefined();
      expect(createChange?.entity_id).toBe("external-new-001");
    });

    it("should detect entity updates from file changes", async () => {
      // Create initial entity
      const id = await provider.createEntity({ title: "Original Title" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Update via direct file manipulation
      const updatedIssue = {
        id,
        title: "Updated Title",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      writeFileSync(issuesPath, JSON.stringify(updatedIssue) + "\n");

      await waitForCallback(callback, 1000);

      const updateChange = changes.find(
        (c) => c.change_type === "updated" && c.entity_id === id
      );
      expect(updateChange).toBeDefined();
      expect(updateChange?.data?.title).toBe("Updated Title");
    });

    it("should detect entity deletion from file changes", async () => {
      // Create initial entities
      const id1 = await provider.createEntity({ title: "Issue 1" });
      const id2 = await provider.createEntity({ title: "Issue 2" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Delete one entity by rewriting file without it
      const remainingIssue = {
        id: id1,
        title: "Issue 1",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      writeFileSync(issuesPath, JSON.stringify(remainingIssue) + "\n");

      await waitForCallback(callback, 1000);

      const deleteChange = changes.find(
        (c) => c.change_type === "deleted" && c.entity_id === id2
      );
      expect(deleteChange).toBeDefined();
    });

    it("should detect multiple changes in single file update", async () => {
      // Create initial entities
      const id1 = await provider.createEntity({ title: "Issue 1" });
      await provider.createEntity({ title: "Issue 2" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Rewrite file with: updated issue 1, deleted issue 2, new issue 3
      const now = new Date().toISOString();
      const newContent = [
        JSON.stringify({
          id: id1,
          title: "Updated Issue 1",
          status: "open",
          priority: 2,
          created_at: now,
          updated_at: now,
        }),
        JSON.stringify({
          id: "new-issue-003",
          title: "New Issue 3",
          status: "open",
          priority: 1,
          created_at: now,
          updated_at: now,
        }),
      ].join("\n") + "\n";

      writeFileSync(issuesPath, newContent);

      await waitForCallback(callback, 1000);

      // Should have: 1 update, 1 delete, 1 create
      expect(changes.filter((c) => c.change_type === "created").length).toBeGreaterThanOrEqual(1);
      expect(changes.filter((c) => c.change_type === "updated").length).toBeGreaterThanOrEqual(1);
      expect(changes.filter((c) => c.change_type === "deleted").length).toBeGreaterThanOrEqual(1);
    });

    it("should not trigger callback when content hash unchanged", async () => {
      const id = await provider.createEntity({ title: "Test Issue" });

      const callback = vi.fn();
      provider.startWatching(callback);
      await sleep(200);

      // Read current content
      const currentEntity = await provider.fetchEntity(id);

      // Rewrite using the raw entity data to preserve all fields
      // Just change the key order by reconstructing the object
      const rawData = currentEntity?.raw as Record<string, unknown>;
      const sameContent = {
        updated_at: rawData?.updated_at,
        title: rawData?.title,
        id: rawData?.id,
        status: rawData?.status,
        priority: rawData?.priority,
        created_at: rawData?.created_at,
        content: rawData?.content,
        // Include any other fields the CLI might have created
        ...Object.fromEntries(
          Object.entries(rawData || {}).filter(
            ([k]) =>
              ![
                "updated_at",
                "title",
                "id",
                "status",
                "priority",
                "created_at",
                "content",
              ].includes(k)
          )
        ),
      };

      writeFileSync(issuesPath, JSON.stringify(sameContent) + "\n");

      // Wait a bit
      await sleep(300);

      // Callback may be called, but no actual changes should be reported
      // because canonical hash should be identical
      const calls = callback.mock.calls;
      const allChanges = calls.flatMap((c) => c[0] as ExternalChange[]);

      // If called, changes array should be empty (no actual content change)
      // Or callback not called at all
      expect(
        calls.length === 0 || allChanges.every((c) => c.entity_id !== id)
      ).toBe(true);
    });
  });

  describe("File Deletion Handling", () => {
    it("should handle issues file being deleted", async () => {
      const id = await provider.createEntity({ title: "Test Issue" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Delete the issues file
      unlinkSync(issuesPath);

      await waitForCallback(callback, 1000);

      // Should report deletion of all entities
      const deleteChange = changes.find(
        (c) => c.change_type === "deleted" && c.entity_id === id
      );
      expect(deleteChange).toBeDefined();
    });

    it("should recover when file is recreated after deletion", async () => {
      await provider.createEntity({ title: "Original Issue" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Delete file
      unlinkSync(issuesPath);
      await sleep(200);

      // Recreate with new issue
      const newIssue = {
        id: "recovered-001",
        title: "Recovered Issue",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      writeFileSync(issuesPath, JSON.stringify(newIssue) + "\n");

      await waitForCallback(callback, 1000, 2);

      const createChange = changes.find(
        (c) => c.change_type === "created" && c.entity_id === "recovered-001"
      );
      expect(createChange).toBeDefined();
    });
  });

  describe("Rapid Changes", () => {
    it("should handle rapid sequential file updates", async () => {
      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Rapid updates
      for (let i = 0; i < 5; i++) {
        const issue = {
          id: "rapid-test",
          title: `Update ${i}`,
          status: "open",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        writeFileSync(issuesPath, JSON.stringify(issue) + "\n");
        await sleep(50); // Small delay between writes
      }

      // Wait for debouncing/stabilization
      await sleep(500);

      // Should have detected at least some changes
      expect(changes.length).toBeGreaterThan(0);
    });
  });

  describe("Sync Loop Prevention", () => {
    it("should NOT detect provider create operations (prevents sync loops)", async () => {
      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Create via provider - watcher hash is updated, so it shouldn't be detected
      await provider.createEntity({ title: "Provider Created" });

      // Give watcher time to potentially detect (it shouldn't)
      await sleep(500);

      // Provider operations should NOT trigger watcher callbacks (sync loop prevention)
      expect(changes).toHaveLength(0);
    });

    it("should NOT detect provider update operations (prevents sync loops)", async () => {
      const id = await provider.createEntity({ title: "Original" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Update via provider - watcher hash is updated, so it shouldn't be detected
      await provider.updateEntity(id, { title: "Updated" });

      // Give watcher time to potentially detect (it shouldn't)
      await sleep(500);

      // Provider operations should NOT trigger watcher callbacks (sync loop prevention)
      expect(changes).toHaveLength(0);
    });

    it("should NOT detect provider delete operations (prevents sync loops)", async () => {
      const id = await provider.createEntity({ title: "To Delete" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Delete via provider - watcher hash is removed, so it shouldn't be detected
      await provider.deleteEntity(id);

      // Give watcher time to potentially detect (it shouldn't)
      await sleep(500);

      // Provider operations should NOT trigger watcher callbacks (sync loop prevention)
      expect(changes).toHaveLength(0);
    });

    it("should still detect external changes while provider operations occur", async () => {
      // First create an entity to have something to watch
      await provider.createEntity({ title: "Existing" });

      const changes: ExternalChange[] = [];
      const callback = vi.fn((c: ExternalChange[]) => changes.push(...c));

      provider.startWatching(callback);
      await sleep(200);

      // Simulate external change (not through provider)
      const externalIssue = {
        id: "external-new",
        title: "External Change",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Read existing content and append
      const existingContent = readFileSync(issuesPath, "utf-8");
      writeFileSync(issuesPath, existingContent + JSON.stringify(externalIssue) + "\n");

      // Wait for watcher
      await waitForCallback(callback, 2000);

      // Should detect the external creation
      const createChange = changes.find(
        (c) => c.change_type === "created" && c.entity_id === "external-new"
      );
      expect(createChange).toBeDefined();
    });
  });
});

// Helper functions
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCallback(
  callback: ReturnType<typeof vi.fn>,
  timeout: number,
  minCalls: number = 1
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (callback.mock.calls.length >= minCalls) {
      return;
    }
    await sleep(50);
  }
}
