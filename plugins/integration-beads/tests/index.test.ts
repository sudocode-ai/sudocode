/**
 * Tests for Beads Integration Plugin
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import beadsPlugin from "../src/index.js";

describe("Beads Plugin", () => {
  describe("metadata", () => {
    it("should have correct name", () => {
      expect(beadsPlugin.name).toBe("beads");
    });

    it("should have display name", () => {
      expect(beadsPlugin.displayName).toBe("Beads");
    });

    it("should have version", () => {
      expect(beadsPlugin.version).toBe("0.1.0");
    });

    it("should have config schema", () => {
      expect(beadsPlugin.configSchema).toBeDefined();
      expect(beadsPlugin.configSchema?.properties.path).toBeDefined();
      expect(beadsPlugin.configSchema?.required).toContain("path");
    });
  });

  describe("validateConfig", () => {
    it("should require path option", () => {
      const result = beadsPlugin.validateConfig({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("beads.options.path is required");
    });

    it("should accept valid config", () => {
      const result = beadsPlugin.validateConfig({ path: ".beads" });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should warn about invalid issue_prefix", () => {
      const result = beadsPlugin.validateConfig({
        path: ".beads",
        issue_prefix: "toolong",
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "beads.options.issue_prefix should be 1-4 alphabetic characters"
      );
    });

    it("should accept valid issue_prefix", () => {
      const result = beadsPlugin.validateConfig({
        path: ".beads",
        issue_prefix: "bd",
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("testConnection", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "beads-test-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true });
    });

    it("should fail when path not configured", async () => {
      const result = await beadsPlugin.testConnection({}, tempDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("should fail when directory does not exist", async () => {
      const result = await beadsPlugin.testConnection(
        { path: "nonexistent" },
        tempDir
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should succeed when directory exists", async () => {
      const beadsDir = join(tempDir, ".beads");
      mkdirSync(beadsDir);

      const result = await beadsPlugin.testConnection(
        { path: ".beads" },
        tempDir
      );
      expect(result.success).toBe(true);
      expect(result.details?.hasIssuesFile).toBe(false);
    });

    it("should detect issues.jsonl file", async () => {
      const beadsDir = join(tempDir, ".beads");
      mkdirSync(beadsDir);
      writeFileSync(
        join(beadsDir, "issues.jsonl"),
        '{"id": "bd-1", "title": "Test"}\n{"id": "bd-2", "title": "Test 2"}\n'
      );

      const result = await beadsPlugin.testConnection(
        { path: ".beads" },
        tempDir
      );
      expect(result.success).toBe(true);
      expect(result.details?.hasIssuesFile).toBe(true);
      expect(result.details?.issueCount).toBe(2);
    });
  });

  describe("createProvider", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "beads-test-"));
      const beadsDir = join(tempDir, ".beads");
      mkdirSync(beadsDir);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true });
    });

    it("should create provider instance", () => {
      const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
      expect(provider).toBeDefined();
      expect(provider.name).toBe("beads");
    });

    it("should initialize successfully", async () => {
      const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
      await expect(provider.initialize()).resolves.toBeUndefined();
    });

    it("should fail initialization for non-existent directory", async () => {
      const provider = beadsPlugin.createProvider(
        { path: "nonexistent" },
        tempDir
      );
      await expect(provider.initialize()).rejects.toThrow("not found");
    });
  });

  describe("provider operations", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "beads-test-"));
      const beadsDir = join(tempDir, ".beads");
      mkdirSync(beadsDir);
      writeFileSync(
        join(beadsDir, "issues.jsonl"),
        '{"id": "bd-1", "title": "First Issue", "description": "Description 1", "status": "open", "priority": 2}\n' +
          '{"id": "bd-2", "title": "Second Issue", "description": "Description 2", "status": "in_progress", "priority": 1}\n'
      );
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true });
    });

    it("should fetch entity by ID", async () => {
      const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
      await provider.initialize();

      const entity = await provider.fetchEntity("bd-1");
      expect(entity).toBeDefined();
      expect(entity?.id).toBe("bd-1");
      expect(entity?.title).toBe("First Issue");
    });

    it("should return null for non-existent entity", async () => {
      const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
      await provider.initialize();

      const entity = await provider.fetchEntity("bd-999");
      expect(entity).toBeNull();
    });

    it("should search entities", async () => {
      const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
      await provider.initialize();

      const entities = await provider.searchEntities();
      expect(entities).toHaveLength(2);
    });

    it("should filter entities by query", async () => {
      const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
      await provider.initialize();

      const entities = await provider.searchEntities("First");
      expect(entities).toHaveLength(1);
      expect(entities[0].title).toBe("First Issue");
    });

    it("should map external entity to sudocode format", async () => {
      const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
      await provider.initialize();

      const entity = await provider.fetchEntity("bd-1");
      const mapped = provider.mapToSudocode(entity!);

      expect(mapped.issue).toBeDefined();
      expect(mapped.issue?.title).toBe("First Issue");
      expect(mapped.issue?.status).toBe("open");
    });
  });

  describe("bidirectional sync operations", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "beads-test-"));
      const beadsDir = join(tempDir, ".beads");
      mkdirSync(beadsDir);
      writeFileSync(
        join(beadsDir, "issues.jsonl"),
        '{"id": "bd-1", "title": "First Issue", "description": "Description 1", "status": "open", "priority": 2, "created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z"}\n'
      );
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true });
    });

    describe("createEntity", () => {
      it("should create new issue in beads", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        const newId = await provider.createEntity({
          title: "New Issue",
          content: "New content",
          priority: 1,
        });

        // ID format depends on whether CLI is available
        // CLI may return sequential IDs like "bd-2", JSONL generates hex IDs like "beads-12345678"
        expect(newId).toBeDefined();
        expect(typeof newId).toBe("string");
        expect(newId.length).toBeGreaterThan(0);

        // Verify it was written to the file
        const entity = await provider.fetchEntity(newId);
        expect(entity).toBeDefined();
        expect(entity?.title).toBe("New Issue");
        expect(entity?.description).toBe("New content");
        expect(entity?.priority).toBe(1);
      });

      it("should create issue with status", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        const newId = await provider.createEntity({
          title: "In Progress Issue",
          status: "in_progress",
        } as any);

        const entity = await provider.fetchEntity(newId);
        expect(entity?.status).toBe("in_progress");
      });

      it("should use custom prefix from options", async () => {
        const provider = beadsPlugin.createProvider(
          { path: ".beads", issue_prefix: "bd" },
          tempDir
        );
        await provider.initialize();

        const newId = await provider.createEntity({
          title: "Custom Prefix Issue",
        });

        // ID should start with the custom prefix
        expect(newId).toMatch(/^bd-/);
      });
    });

    describe("updateEntity", () => {
      it("should update issue title", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        await provider.updateEntity("bd-1", {
          title: "Updated Title",
        });

        const entity = await provider.fetchEntity("bd-1");
        expect(entity?.title).toBe("Updated Title");
        // Other fields preserved
        expect(entity?.description).toBe("Description 1");
      });

      it("should update issue status", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        await provider.updateEntity("bd-1", {
          status: "closed",
        } as any);

        const entity = await provider.fetchEntity("bd-1");
        expect(entity?.status).toBe("closed");
      });

      it("should update issue content", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        await provider.updateEntity("bd-1", {
          content: "Updated content",
        });

        const entity = await provider.fetchEntity("bd-1");
        expect(entity?.description).toBe("Updated content");
      });

      it("should update issue priority", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        await provider.updateEntity("bd-1", {
          priority: 0,
        });

        const entity = await provider.fetchEntity("bd-1");
        expect(entity?.priority).toBe(0);
      });

      it("should update multiple fields at once", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        await provider.updateEntity("bd-1", {
          title: "Multi-update",
          content: "Multi-content",
          priority: 3,
          status: "in_progress",
        } as any);

        const entity = await provider.fetchEntity("bd-1");
        expect(entity?.title).toBe("Multi-update");
        expect(entity?.description).toBe("Multi-content");
        expect(entity?.priority).toBe(3);
        expect(entity?.status).toBe("in_progress");
      });

      it("should update updated_at timestamp", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        const before = await provider.fetchEntity("bd-1");
        const beforeTimestamp = before?.updated_at;

        await provider.updateEntity("bd-1", {
          title: "Timestamp test",
        });

        const after = await provider.fetchEntity("bd-1");
        expect(after?.updated_at).not.toBe(beforeTimestamp);
      });

      it("should throw for non-existent entity", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        await expect(
          provider.updateEntity("bd-nonexistent", { title: "Test" })
        ).rejects.toThrow("not found");
      });
    });

    describe("deleteEntity", () => {
      it("should delete existing issue", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        await provider.deleteEntity("bd-1");

        const entity = await provider.fetchEntity("bd-1");
        expect(entity).toBeNull();
      });

      it("should not throw for non-existent entity", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        // Should not throw
        await expect(
          provider.deleteEntity("bd-nonexistent")
        ).resolves.toBeUndefined();
      });
    });

    describe("getChangesSince", () => {
      it("should detect no changes when nothing changed", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        // Call twice - first call captures state, second should show no changes
        await provider.getChangesSince(new Date(0));
        const changes = await provider.getChangesSince(new Date(0));

        // No new changes since last capture
        expect(changes).toHaveLength(0);
      });

      it("should detect externally created entities", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        // Record time before external creation
        const beforeCreate = new Date();

        // Simulate external creation (not through provider)
        const beadsDir = join(tempDir, ".beads");
        const newIssue = {
          id: "bd-external",
          title: "Externally Created",
          content: "",
          status: "open",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        writeFileSync(
          join(beadsDir, "issues.jsonl"),
          '{"id": "bd-1", "title": "First Issue", "description": "Description 1", "status": "open", "priority": 2, "created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z"}\n' +
            JSON.stringify(newIssue) + "\n"
        );

        const changes = await provider.getChangesSince(beforeCreate);
        const createChange = changes.find(
          (c) => c.entity_id === "bd-external" && c.change_type === "created"
        );
        expect(createChange).toBeDefined();
      });

      it("should detect externally updated entities", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        // Record time before external update
        const beforeUpdate = new Date();

        // Simulate external update (not through provider)
        const beadsDir = join(tempDir, ".beads");
        const updatedIssue = {
          id: "bd-1",
          title: "Externally Updated",
          description: "Description 1",
          status: "closed",
          priority: 2,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: new Date().toISOString(),
        };
        writeFileSync(
          join(beadsDir, "issues.jsonl"),
          JSON.stringify(updatedIssue) + "\n"
        );

        const changes = await provider.getChangesSince(beforeUpdate);
        const updateChange = changes.find(
          (c) => c.entity_id === "bd-1" && c.change_type === "updated"
        );
        expect(updateChange).toBeDefined();
      });

      it("should detect externally deleted entities", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        // Record time before external deletion
        const beforeDelete = new Date();

        // Simulate external deletion (not through provider)
        const beadsDir = join(tempDir, ".beads");
        writeFileSync(join(beadsDir, "issues.jsonl"), ""); // Empty file = delete all

        const changes = await provider.getChangesSince(beforeDelete);
        const deleteChange = changes.find(
          (c) => c.entity_id === "bd-1" && c.change_type === "deleted"
        );
        expect(deleteChange).toBeDefined();
      });
    });

    describe("parseExternalId and formatExternalId", () => {
      it("should parse plain ID", () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        const result = provider.parseExternalId("bd-123");
        expect(result).toEqual({ provider: "beads", id: "bd-123" });
      });

      it("should parse prefixed ID", () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        const result = provider.parseExternalId("beads:bd-123");
        expect(result).toEqual({ provider: "beads", id: "bd-123" });
      });

      it("should format ID with prefix", () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        const result = provider.formatExternalId("bd-123");
        expect(result).toBe("beads:bd-123");
      });
    });

    describe("validate", () => {
      it("should return valid for existing directory", async () => {
        const provider = beadsPlugin.createProvider({ path: ".beads" }, tempDir);
        await provider.initialize();

        const result = await provider.validate();
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should return invalid for non-existent directory", async () => {
        const provider = beadsPlugin.createProvider({ path: "nonexistent" }, tempDir);
        // Don't initialize - just validate

        const result = await provider.validate();
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });
});
