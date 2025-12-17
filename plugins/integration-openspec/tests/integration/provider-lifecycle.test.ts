/**
 * Integration tests for OpenSpecProvider lifecycle operations
 *
 * Tests the full flow of provider initialization, entity operations,
 * watching, and disposal.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import openSpecPlugin from "../../src/index.js";
import type { IntegrationProvider, ExternalChange } from "@sudocode-ai/types";

describe("OpenSpecProvider Lifecycle", () => {
  let tempDir: string;
  let openspecDir: string;
  let specsDir: string;
  let changesDir: string;
  let provider: IntegrationProvider;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `openspec-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    openspecDir = join(tempDir, "openspec");
    specsDir = join(openspecDir, "specs");
    changesDir = join(openspecDir, "changes");

    mkdirSync(specsDir, { recursive: true });
    mkdirSync(changesDir, { recursive: true });

    provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      tempDir
    );

    await provider.initialize();
  });

  afterEach(async () => {
    await provider.dispose();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Initialization", () => {
    it("should initialize successfully with valid directory", async () => {
      // Provider already initialized in beforeEach
      const validation = await provider.validate();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should fail validation with missing directory", async () => {
      const badProvider = openSpecPlugin.createProvider(
        { path: "nonexistent" },
        tempDir
      );

      await expect(badProvider.initialize()).rejects.toThrow();
    });

    it("should support dispose and re-initialization", async () => {
      await provider.dispose();

      // Re-create and initialize
      provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      const validation = await provider.validate();
      expect(validation.valid).toBe(true);
    });
  });

  describe("Entity Operations", () => {
    it("should return empty results for empty directory", async () => {
      const entities = await provider.searchEntities();
      expect(entities).toHaveLength(0);
    });

    it("should find entities after files are added", async () => {
      // Add a spec
      const specDir = join(specsDir, "test-spec");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# Test Specification\n\n## Purpose\nTest purpose."
      );

      const entities = await provider.searchEntities();
      expect(entities).toHaveLength(1);
      expect(entities[0].type).toBe("spec");
    });

    it("should fetch specific entity by ID", async () => {
      // Add a spec
      const specDir = join(specsDir, "fetchable-spec");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# Fetchable Specification\n\n## Purpose\nCan be fetched."
      );

      const entities = await provider.searchEntities();
      const specId = entities[0].id;

      const fetched = await provider.fetchEntity(specId);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(specId);
      expect(fetched?.title).toBe("Fetchable Specification");
    });

    it("should return null for non-existent entity", async () => {
      const fetched = await provider.fetchEntity("os-nonexistent");
      expect(fetched).toBeNull();
    });

    it("should handle concurrent searches", async () => {
      // Add multiple specs
      for (let i = 0; i < 5; i++) {
        const specDir = join(specsDir, `spec-${i}`);
        mkdirSync(specDir, { recursive: true });
        writeFileSync(
          join(specDir, "spec.md"),
          `# Specification ${i}\n\n## Purpose\nSpec number ${i}.`
        );
      }

      // Run concurrent searches
      const results = await Promise.all([
        provider.searchEntities(),
        provider.searchEntities("Specification 1"),
        provider.searchEntities("Specification 2"),
      ]);

      expect(results[0]).toHaveLength(5);
      expect(results[1]).toHaveLength(1);
      expect(results[2]).toHaveLength(1);
    });
  });

  describe("Change Detection", () => {
    it("should track entity creation", async () => {
      // Capture initial (empty) state
      const initialChanges = await provider.getChangesSince(new Date(0));
      expect(initialChanges).toHaveLength(0);

      // Add entity
      const specDir = join(specsDir, "new-spec");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# New Specification\n\n## Purpose\nBrand new."
      );

      // Check for changes
      const changes = await provider.getChangesSince(new Date(0));
      expect(changes).toHaveLength(1);
      expect(changes[0].change_type).toBe("created");
    });

    it("should track entity updates", async () => {
      // Create initial entity
      const specDir = join(specsDir, "updateable");
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, "spec.md");
      writeFileSync(specPath, "# Original\n\n## Purpose\nOriginal content.");

      // Capture state
      await provider.getChangesSince(new Date(0));

      // Update entity
      writeFileSync(specPath, "# Updated\n\n## Purpose\nUpdated content.");

      // Check for changes
      const changes = await provider.getChangesSince(new Date(0));
      const updateChange = changes.find((c) => c.change_type === "updated");

      expect(updateChange).toBeDefined();
    });

    it("should track entity deletion", async () => {
      // Create entity
      const specDir = join(specsDir, "deletable");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# Deletable\n\n## Purpose\nWill be deleted."
      );

      // Capture state
      await provider.getChangesSince(new Date(0));

      // Delete entity
      rmSync(specDir, { recursive: true });

      // Check for changes
      const changes = await provider.getChangesSince(new Date(0));
      const deleteChange = changes.find((c) => c.change_type === "deleted");

      expect(deleteChange).toBeDefined();
    });

    it("should not report unchanged entities", async () => {
      // Create entity
      const specDir = join(specsDir, "stable");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# Stable\n\n## Purpose\nNot changing."
      );

      // Capture state
      await provider.getChangesSince(new Date(0));

      // No changes made

      // Check - should report nothing
      const changes = await provider.getChangesSince(new Date(0));
      expect(changes).toHaveLength(0);
    });
  });

  describe("File Watching", () => {
    it("should support starting and stopping watch", async () => {
      expect(provider.supportsWatch).toBe(true);

      let changeCount = 0;
      const callback = (changes: ExternalChange[]) => {
        changeCount += changes.length;
      };

      provider.startWatching(callback);
      provider.stopWatching();

      // Should not throw
      expect(true).toBe(true);
    });

    it("should detect file changes when watching", async () => {
      const detectedChanges: ExternalChange[] = [];
      const callback = (changes: ExternalChange[]) => {
        detectedChanges.push(...changes);
      };

      provider.startWatching(callback);

      // Give watcher time to initialize
      await sleep(200);

      // Add a new spec
      const specDir = join(specsDir, "watched-spec");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# Watched Specification\n\n## Purpose\nDetected by watcher."
      );

      // Wait for watcher to detect
      await sleep(500);

      provider.stopWatching();

      expect(detectedChanges.length).toBeGreaterThanOrEqual(1);
      expect(detectedChanges.some((c) => c.change_type === "created")).toBe(true);
    });

    it("should ignore non-relevant files when watching", async () => {
      const detectedChanges: ExternalChange[] = [];
      const callback = (changes: ExternalChange[]) => {
        detectedChanges.push(...changes);
      };

      provider.startWatching(callback);
      await sleep(200);

      // Add a non-relevant file
      writeFileSync(join(specsDir, "notes.txt"), "Not a spec");

      await sleep(300);

      provider.stopWatching();

      // Should not have detected the .txt file as a change
      const specChanges = detectedChanges.filter((c) => c.entity_type === "spec");
      expect(specChanges).toHaveLength(0);
    });
  });

  describe("Provider Properties", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("openspec");
    });

    it("should support watching", () => {
      expect(provider.supportsWatch).toBe(true);
    });

    it("should support polling", () => {
      expect(provider.supportsPolling).toBe(true);
    });
  });

  describe("Data Mapping", () => {
    it("should map external spec to sudocode spec", async () => {
      const specDir = join(specsDir, "mappable");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# Mappable Specification\n\n## Purpose\nCan be mapped to sudocode."
      );

      const entities = await provider.searchEntities();
      const spec = entities[0];

      const mapped = provider.mapToSudocode(spec);

      expect(mapped.spec).toBeDefined();
      expect(mapped.spec?.title).toBe("Mappable Specification");
      expect(mapped.spec?.content).toContain("Can be mapped to sudocode");
    });

    it("should map external issue to sudocode issue", async () => {
      const changeDir = join(changesDir, "mappable-change");
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(
        join(changeDir, "proposal.md"),
        "## Why\nNeed this change.\n\n## What Changes\nSomething will change."
      );

      const entities = await provider.searchEntities();
      const issue = entities.find((e) => e.type === "issue");

      expect(issue).toBeDefined();

      const mapped = provider.mapToSudocode(issue!);

      expect(mapped.issue).toBeDefined();
      expect(mapped.issue?.content).toContain("Need this change");
    });

    it("should map sudocode spec to external format", async () => {
      const sudocodeSpec = {
        id: "s-test",
        uuid: "test-uuid",
        title: "Test Spec",
        content: "Test content",
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mapped = provider.mapFromSudocode(sudocodeSpec);

      expect(mapped.type).toBe("spec");
      expect(mapped.title).toBe("Test Spec");
      expect(mapped.description).toBe("Test content");
    });

    it("should map sudocode issue to external format", async () => {
      const sudocodeIssue = {
        id: "i-test",
        uuid: "test-uuid",
        title: "Test Issue",
        content: "Issue content",
        priority: 2,
        status: "in_progress" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mapped = provider.mapFromSudocode(sudocodeIssue);

      expect(mapped.type).toBe("issue");
      expect(mapped.title).toBe("Test Issue");
      expect(mapped.status).toBe("in_progress");
    });
  });

  describe("Error Handling", () => {
    it("should throw on createEntity (inbound-only)", async () => {
      await expect(
        provider.createEntity({ title: "Test" })
      ).rejects.toThrow();
    });

    it("should throw on deleteEntity (inbound-only)", async () => {
      await expect(
        provider.deleteEntity("os-test")
      ).rejects.toThrow();
    });

    it("should handle updateEntity for non-existent entity gracefully", async () => {
      // updateEntity should not throw, just log error for non-existent entity
      await provider.updateEntity("os-nonexistent", { title: "Updated" });
      // Should complete without throwing
      expect(true).toBe(true);
    });

    it("should handle dispose gracefully", async () => {
      // Dispose multiple times should not throw
      await provider.dispose();
      await provider.dispose();

      expect(true).toBe(true);
    });
  });

  describe("Configuration Options", () => {
    it("should use custom spec prefix", async () => {
      await provider.dispose();

      provider = openSpecPlugin.createProvider(
        { path: "openspec", spec_prefix: "custom" },
        tempDir
      );
      await provider.initialize();

      const specDir = join(specsDir, "custom-prefix-test");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# Custom Prefix Test\n\n## Purpose\nTest custom prefix."
      );

      const entities = await provider.searchEntities();
      expect(entities[0].id.startsWith("custom-")).toBe(true);
    });

    it("should use custom issue prefix", async () => {
      await provider.dispose();

      provider = openSpecPlugin.createProvider(
        { path: "openspec", issue_prefix: "myissue" },
        tempDir
      );
      await provider.initialize();

      const changeDir = join(changesDir, "custom-issue-test");
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(
        join(changeDir, "proposal.md"),
        "## Why\nTest.\n\n## What Changes\nNothing."
      );

      const entities = await provider.searchEntities();
      const issue = entities.find((e) => e.type === "issue");

      expect(issue?.id.startsWith("myissue-")).toBe(true);
    });
  });
});

// Helper function
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
