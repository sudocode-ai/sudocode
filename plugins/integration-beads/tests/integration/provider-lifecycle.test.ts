/**
 * Integration tests for BeadsProvider lifecycle operations
 *
 * Tests the full flow of creating, updating, deleting entities
 * and verifying change detection works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import beadsPlugin from "../../src/index.js";
import type { IntegrationProvider } from "@sudocode-ai/types";

describe("BeadsProvider Integration", () => {
  let tempDir: string;
  let beadsDir: string;
  let issuesPath: string;
  let provider: IntegrationProvider;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-integration-test-"));
    beadsDir = join(tempDir, ".beads");
    mkdirSync(beadsDir);
    issuesPath = join(beadsDir, "issues.jsonl");

    // Create empty issues file
    writeFileSync(issuesPath, "");

    // Create provider
    provider = beadsPlugin.createProvider(
      { path: ".beads", issue_prefix: "test" },
      tempDir
    );

    await provider.initialize();
  });

  afterEach(async () => {
    await provider.dispose();
    rmSync(tempDir, { recursive: true });
  });

  describe("Entity Lifecycle", () => {
    it("should create, read, and verify entity exists", async () => {
      // Create
      const id = await provider.createEntity({
        title: "Test Issue",
        content: "Test content",
        priority: 1,
      });

      // ID format depends on whether CLI or JSONL fallback was used
      // CLI: beads-xxx-xxx-N format, JSONL: test-xxxxxxxx format
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");

      // Read back
      const entity = await provider.fetchEntity(id);
      expect(entity).not.toBeNull();
      expect(entity?.title).toBe("Test Issue");
      expect(entity?.description).toBe("Test content");
      expect(entity?.priority).toBe(1);
    });

    it("should create multiple entities and search them", async () => {
      // Create multiple issues
      const id1 = await provider.createEntity({ title: "First Issue", priority: 1 });
      const id2 = await provider.createEntity({ title: "Second Issue", priority: 2 });
      const id3 = await provider.createEntity({ title: "Third Task", priority: 3 });

      // Search all
      const allEntities = await provider.searchEntities();
      expect(allEntities.length).toBe(3);

      // Search by query
      const issueEntities = await provider.searchEntities("Issue");
      expect(issueEntities.length).toBe(2);

      const taskEntities = await provider.searchEntities("Task");
      expect(taskEntities.length).toBe(1);
      expect(taskEntities[0].id).toBe(id3);
    });

    it("should update entity and preserve unchanged fields", async () => {
      // Create
      const id = await provider.createEntity({
        title: "Original Title",
        content: "Original content",
        priority: 2,
      });

      // Update only title
      await provider.updateEntity(id, { title: "Updated Title" });

      // Verify update preserved content
      const entity = await provider.fetchEntity(id);
      expect(entity?.title).toBe("Updated Title");
      expect(entity?.description).toBe("Original content");
      expect(entity?.priority).toBe(2);
    });

    it("should update multiple fields at once", async () => {
      const id = await provider.createEntity({
        title: "Test",
        content: "Content",
        priority: 1,
      });

      await provider.updateEntity(id, {
        title: "New Title",
        content: "New Content",
        priority: 3,
      });

      const entity = await provider.fetchEntity(id);
      expect(entity?.title).toBe("New Title");
      expect(entity?.description).toBe("New Content");
      expect(entity?.priority).toBe(3);
    });

    it("should delete entity", async () => {
      const id = await provider.createEntity({ title: "To Delete" });

      // Verify exists
      let entity = await provider.fetchEntity(id);
      expect(entity).not.toBeNull();

      // Delete
      await provider.deleteEntity(id);

      // Verify gone
      entity = await provider.fetchEntity(id);
      expect(entity).toBeNull();
    });

    it("should handle full lifecycle: create → update → delete", async () => {
      // Create
      const id = await provider.createEntity({
        title: "Lifecycle Test",
        content: "Initial",
        priority: 2,
      });

      let entities = await provider.searchEntities();
      expect(entities.length).toBe(1);

      // Update
      await provider.updateEntity(id, {
        title: "Updated Lifecycle Test",
        content: "Modified",
      });

      let entity = await provider.fetchEntity(id);
      expect(entity?.title).toBe("Updated Lifecycle Test");
      expect(entity?.description).toBe("Modified");

      // Delete
      await provider.deleteEntity(id);

      entities = await provider.searchEntities();
      expect(entities.length).toBe(0);
    });
  });

  describe("Change Detection (getChangesSince)", () => {
    // Note: getChangesSince is designed to detect EXTERNAL changes (made by other tools),
    // not changes made by the provider itself (which updates its internal hash cache).
    // These tests verify the change detection mechanism works for external modifications.

    it("should not report provider-made changes (cache is updated)", async () => {
      // Provider operations update the internal hash cache, so getChangesSince
      // won't see them as "new" changes - this is by design
      const beforeCreate = new Date();
      await sleep(10);

      await provider.createEntity({ title: "New Issue" });

      const changes = await provider.getChangesSince(beforeCreate);
      // Provider already knows about this change (hash cache updated)
      expect(changes.length).toBe(0);
    });

    it("should not report unchanged entities", async () => {
      await provider.createEntity({ title: "Unchanged Issue" });

      // Capture state
      await provider.getChangesSince(new Date(0));

      const checkpoint = new Date();
      await sleep(10);

      // No changes made

      const changes = await provider.getChangesSince(checkpoint);
      expect(changes.length).toBe(0);
    });

    it("should detect changes after state refresh", async () => {
      // Create initial entity
      await provider.createEntity({ title: "Initial" });

      // Simulate a fresh provider (no cached state)
      // by reinitializing
      await provider.dispose();
      provider = beadsPlugin.createProvider(
        { path: ".beads", issue_prefix: "test" },
        tempDir
      );
      await provider.initialize();

      // Now all existing entities should show as "created" from the provider's perspective
      // since it just initialized and captured state for the first time
      const allEntities = await provider.searchEntities();
      expect(allEntities.length).toBe(1);
    });
  });

  describe("External Changes Detection", () => {
    it("should detect externally created entity", async () => {
      // Capture initial state
      await provider.getChangesSince(new Date(0));

      const checkpoint = new Date();
      await sleep(10);

      // Simulate external tool creating an issue
      const externalIssue = {
        id: "external-12345678",
        title: "External Issue",
        content: "Created by another tool",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      writeFileSync(issuesPath, JSON.stringify(externalIssue) + "\n");

      const changes = await provider.getChangesSince(checkpoint);

      expect(changes.length).toBe(1);
      expect(changes[0].change_type).toBe("created");
      expect(changes[0].entity_id).toBe("external-12345678");
    });

    it("should detect externally updated entity", async () => {
      const id = await provider.createEntity({ title: "Original" });

      // Capture state
      await provider.getChangesSince(new Date(0));

      const checkpoint = new Date();
      await sleep(10);

      // Read current content and modify externally
      const content = readFileSync(issuesPath, "utf-8");
      const issues = content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));

      issues[0].title = "Externally Modified";
      issues[0].updated_at = new Date().toISOString();

      writeFileSync(issuesPath, issues.map((i) => JSON.stringify(i)).join("\n") + "\n");

      const changes = await provider.getChangesSince(checkpoint);

      expect(changes.length).toBe(1);
      expect(changes[0].change_type).toBe("updated");
      expect(changes[0].data?.title).toBe("Externally Modified");
    });

    it("should detect externally deleted entity", async () => {
      await provider.createEntity({ title: "Issue 1" });
      const id2 = await provider.createEntity({ title: "Issue 2" });

      // Capture state
      await provider.getChangesSince(new Date(0));

      const checkpoint = new Date();
      await sleep(10);

      // Remove second issue externally
      const content = readFileSync(issuesPath, "utf-8");
      const issues = content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
        .filter((i) => i.id !== id2);

      writeFileSync(issuesPath, issues.map((i) => JSON.stringify(i)).join("\n") + "\n");

      const changes = await provider.getChangesSince(checkpoint);

      expect(changes.length).toBe(1);
      expect(changes[0].change_type).toBe("deleted");
      expect(changes[0].entity_id).toBe(id2);
    });
  });

  describe("Data Mapping", () => {
    it("should correctly map to sudocode format", async () => {
      const id = await provider.createEntity({
        title: "Test Issue",
        content: "Description",
        priority: 1,
        status: "in_progress",
      });

      const entity = await provider.fetchEntity(id);
      expect(entity).not.toBeNull();

      const mapped = provider.mapToSudocode(entity!);

      expect(mapped.issue).toBeDefined();
      expect(mapped.issue?.title).toBe("Test Issue");
      expect(mapped.issue?.content).toBe("Description");
      expect(mapped.issue?.priority).toBe(1);
      expect(mapped.issue?.status).toBe("in_progress");
    });

    it("should correctly map from sudocode format", () => {
      const sudocodeIssue = {
        id: "i-test",
        uuid: "test-uuid",
        title: "Sudocode Issue",
        content: "Issue content",
        priority: 2,
        status: "open" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mapped = provider.mapFromSudocode(sudocodeIssue);

      expect(mapped.type).toBe("issue");
      expect(mapped.title).toBe("Sudocode Issue");
      expect(mapped.description).toBe("Issue content");
      expect(mapped.priority).toBe(2);
      expect(mapped.status).toBe("open");
    });

    it("should map various status values correctly", async () => {
      // Test different status mappings
      const statuses = [
        { input: "open", expected: "open" },
        { input: "in_progress", expected: "in_progress" },
        { input: "blocked", expected: "blocked" },
        { input: "closed", expected: "closed" },
        { input: "done", expected: "closed" },
        { input: "completed", expected: "closed" },
      ];

      for (const { input, expected } of statuses) {
        const id = await provider.createEntity({
          title: `Status ${input}`,
          status: input,
        });

        const entity = await provider.fetchEntity(id);
        const mapped = provider.mapToSudocode(entity!);

        expect(mapped.issue?.status).toBe(expected);
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty search results", async () => {
      const results = await provider.searchEntities("nonexistent");
      expect(results).toEqual([]);
    });

    it("should return null for non-existent entity", async () => {
      const entity = await provider.fetchEntity("nonexistent-id");
      expect(entity).toBeNull();
    });

    it("should throw when updating non-existent entity", async () => {
      await expect(
        provider.updateEntity("nonexistent-id", { title: "Test" })
      ).rejects.toThrow("not found");
    });

    it("should handle special characters in title and content", async () => {
      const id = await provider.createEntity({
        title: 'Test "quotes" & <special> chars',
        content: "Line 1\nLine 2\n\tTabbed",
      });

      const entity = await provider.fetchEntity(id);
      expect(entity?.title).toBe('Test "quotes" & <special> chars');
      expect(entity?.description).toBe("Line 1\nLine 2\n\tTabbed");
    });

    it("should handle unicode characters", async () => {
      const id = await provider.createEntity({
        title: "Unicode: 日本語 🎉 émojis",
        content: "Content with ñ and ü",
      });

      const entity = await provider.fetchEntity(id);
      expect(entity?.title).toBe("Unicode: 日本語 🎉 émojis");
      expect(entity?.description).toBe("Content with ñ and ü");
    });

    it("should handle very long content", async () => {
      const longContent = "x".repeat(10000);
      const id = await provider.createEntity({
        title: "Long Content Issue",
        content: longContent,
      });

      const entity = await provider.fetchEntity(id);
      expect(entity?.description?.length).toBe(10000);
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent creates", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        provider.createEntity({ title: `Concurrent Issue ${i}` })
      );

      const ids = await Promise.all(promises);

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);

      // All should be retrievable
      const entities = await provider.searchEntities();
      expect(entities.length).toBe(10);
    });

    it("should handle rapid updates to same entity", async () => {
      const id = await provider.createEntity({ title: "Rapid Updates" });

      // Rapid sequential updates
      for (let i = 0; i < 5; i++) {
        await provider.updateEntity(id, { title: `Update ${i}` });
      }

      const entity = await provider.fetchEntity(id);
      expect(entity?.title).toBe("Update 4");
    });
  });
});

// Helper function
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
