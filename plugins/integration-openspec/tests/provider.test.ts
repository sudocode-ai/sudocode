/**
 * Integration tests for OpenSpecProvider
 *
 * Tests the full provider implementation including:
 * - searchEntities() scanning specs/ and changes/
 * - fetchEntity() fetching by ID
 * - mapToSudocode() converting entities
 * - Archive detection and status mapping
 * - Relationship creation from affected specs
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import openSpecPlugin from "../src/index.js";
import type { ExternalEntity } from "@sudocode-ai/types";
import { generateSpecId, generateChangeId } from "../src/id-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesPath = path.join(__dirname, "fixtures");

describe("OpenSpecProvider", () => {
  let provider: ReturnType<typeof openSpecPlugin.createProvider>;

  beforeAll(async () => {
    provider = openSpecPlugin.createProvider(
      { path: "." },
      fixturesPath
    );
    await provider.initialize();
  });

  afterAll(async () => {
    await provider.dispose();
  });

  describe("provider properties", () => {
    it("has correct name", () => {
      expect(provider.name).toBe("openspec");
    });

    it("supports watching", () => {
      expect(provider.supportsWatch).toBe(true);
    });

    it("supports polling", () => {
      expect(provider.supportsPolling).toBe(true);
    });
  });

  describe("searchEntities", () => {
    let entities: ExternalEntity[];

    beforeAll(async () => {
      entities = await provider.searchEntities();
    });

    it("finds specs from specs/ directory", () => {
      const specs = entities.filter((e) => e.type === "spec");
      expect(specs.length).toBeGreaterThanOrEqual(2);
    });

    it("finds changes from changes/ directory as issues", () => {
      const issues = entities.filter((e) => e.type === "issue");
      expect(issues.length).toBeGreaterThanOrEqual(3);
    });

    it("includes cli-init spec", () => {
      const cliInitSpec = entities.find(
        (e) => e.type === "spec" && e.title === "CLI Init Specification"
      );
      expect(cliInitSpec).toBeDefined();
    });

    it("includes api-design spec", () => {
      const apiDesignSpec = entities.find(
        (e) => e.type === "spec" && e.title === "API Design Specification"
      );
      expect(apiDesignSpec).toBeDefined();
    });

    it("includes add-scaffold-command change as issue", () => {
      const scaffoldIssue = entities.find(
        (e) => e.type === "issue" && e.title.includes("scaffold")
      );
      expect(scaffoldIssue).toBeDefined();
    });

    it("includes archived changes", () => {
      const archivedIssue = entities.find(
        (e) => e.type === "issue" && e.raw?.isArchived === true
      );
      expect(archivedIssue).toBeDefined();
    });

    describe("query filtering", () => {
      it("filters by query string in title", async () => {
        const filtered = await provider.searchEntities("CLI");
        expect(filtered.length).toBeGreaterThanOrEqual(1);
        expect(filtered.every((e) =>
          e.title.toLowerCase().includes("cli") ||
          e.description?.toLowerCase().includes("cli")
        )).toBe(true);
      });

      it("filters by query string in description", async () => {
        const filtered = await provider.searchEntities("scaffold");
        expect(filtered.length).toBeGreaterThanOrEqual(1);
      });

      it("returns all entities with empty query", async () => {
        const all = await provider.searchEntities();
        const empty = await provider.searchEntities("");
        expect(all.length).toBe(empty.length);
      });
    });
  });

  describe("fetchEntity", () => {
    it("fetches spec by ID", async () => {
      const specId = generateSpecId("cli-init", "os");
      const entity = await provider.fetchEntity(specId);

      expect(entity).not.toBeNull();
      expect(entity!.type).toBe("spec");
      expect(entity!.title).toBe("CLI Init Specification");
    });

    it("fetches change/issue by ID", async () => {
      const changeId = generateChangeId("add-scaffold-command", "osc");
      const entity = await provider.fetchEntity(changeId);

      expect(entity).not.toBeNull();
      expect(entity!.type).toBe("issue");
      expect(entity!.title).toContain("scaffold");
    });

    it("returns null for non-existent ID", async () => {
      const entity = await provider.fetchEntity("os-invalid");
      expect(entity).toBeNull();
    });

    it("returns null for invalid ID format", async () => {
      const entity = await provider.fetchEntity("invalid");
      expect(entity).toBeNull();
    });
  });

  describe("status mapping for changes/issues", () => {
    it("maps archived changes to closed status", async () => {
      const entities = await provider.searchEntities();
      const archivedIssue = entities.find(
        (e) => e.type === "issue" && e.raw?.isArchived === true
      );

      expect(archivedIssue).toBeDefined();
      expect(archivedIssue!.status).toBe("closed");
    });

    it("maps changes with 100% completion to needs_review", async () => {
      // The archived change fixture has 100% completion
      const entities = await provider.searchEntities();
      // Find a non-archived issue with 100% completion
      // Note: we might need to check raw data for this
      const issuesWithCompletion = entities.filter(
        (e) => e.type === "issue" && e.raw?.taskCompletion === 100 && !e.raw?.isArchived
      );

      // If we have any, they should be needs_review
      for (const issue of issuesWithCompletion) {
        expect(issue.status).toBe("needs_review");
      }
    });

    it("maps changes with partial progress to in_progress", async () => {
      const entities = await provider.searchEntities();
      const addScaffoldIssue = entities.find(
        (e) => e.type === "issue" && e.raw?.name === "add-scaffold-command"
      );

      expect(addScaffoldIssue).toBeDefined();
      // This change has 50% completion
      expect(addScaffoldIssue!.status).toBe("in_progress");
    });

    it("maps changes with no progress to open", async () => {
      const entities = await provider.searchEntities();
      const emptyChange = entities.find(
        (e) => e.type === "issue" && e.raw?.name === "empty-change"
      );

      if (emptyChange) {
        expect(emptyChange.status).toBe("open");
      }
    });
  });

  describe("relationships from affected specs", () => {
    it("creates implements relationships for affected specs", async () => {
      const entities = await provider.searchEntities();
      const addScaffoldIssue = entities.find(
        (e) => e.type === "issue" && e.raw?.name === "add-scaffold-command"
      );

      expect(addScaffoldIssue).toBeDefined();
      expect(addScaffoldIssue!.relationships).toBeDefined();
      expect(addScaffoldIssue!.relationships!.length).toBeGreaterThanOrEqual(1);

      const implementsRelationship = addScaffoldIssue!.relationships!.find(
        (r) => r.relationshipType === "implements"
      );
      expect(implementsRelationship).toBeDefined();
      expect(implementsRelationship!.targetType).toBe("spec");
    });

    it("references correct spec ID", async () => {
      const entities = await provider.searchEntities();
      const addScaffoldIssue = entities.find(
        (e) => e.type === "issue" && e.raw?.name === "add-scaffold-command"
      );

      // The affected spec is cli-scaffold
      const expectedSpecId = generateSpecId("cli-scaffold", "os");
      const relationship = addScaffoldIssue!.relationships!.find(
        (r) => r.targetId === expectedSpecId
      );

      expect(relationship).toBeDefined();
    });

    it("does not create relationships when no affected specs", async () => {
      const entities = await provider.searchEntities();
      const improveCliIssue = entities.find(
        (e) => e.type === "issue" && e.raw?.name === "improve-cli-output"
      );

      if (improveCliIssue) {
        expect(
          improveCliIssue.relationships === undefined ||
          improveCliIssue.relationships.length === 0
        ).toBe(true);
      }
    });
  });

  describe("mapToSudocode", () => {
    it("maps spec entity to Spec", async () => {
      const entities = await provider.searchEntities();
      const specEntity = entities.find((e) => e.type === "spec");

      const mapped = provider.mapToSudocode(specEntity!);

      expect(mapped.spec).toBeDefined();
      expect(mapped.issue).toBeUndefined();
      expect(mapped.spec!.title).toBe(specEntity!.title);
      expect(mapped.spec!.content).toBe(specEntity!.description);
    });

    it("maps issue entity to Issue with status", async () => {
      const entities = await provider.searchEntities();
      const issueEntity = entities.find((e) => e.type === "issue");

      const mapped = provider.mapToSudocode(issueEntity!);

      expect(mapped.issue).toBeDefined();
      expect(mapped.spec).toBeUndefined();
      expect(mapped.issue!.title).toBe(issueEntity!.title);
      expect(mapped.issue!.status).toBeDefined();
    });

    it("includes relationships in mapped result", async () => {
      const entities = await provider.searchEntities();
      const issueWithRelationships = entities.find(
        (e) => e.type === "issue" && e.relationships && e.relationships.length > 0
      );

      if (issueWithRelationships) {
        const mapped = provider.mapToSudocode(issueWithRelationships);
        expect(mapped.relationships).toBeDefined();
        expect(mapped.relationships!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("mapFromSudocode", () => {
    it("maps Spec to external entity format", () => {
      const spec = {
        id: "s-1234",
        uuid: "test-uuid",
        title: "Test Spec",
        content: "Test content",
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const external = provider.mapFromSudocode(spec as any);

      expect(external.type).toBe("spec");
      expect(external.title).toBe("Test Spec");
      expect(external.description).toBe("Test content");
      expect(external.priority).toBe(1);
    });

    it("maps Issue to external entity format", () => {
      const issue = {
        id: "i-1234",
        uuid: "test-uuid",
        title: "Test Issue",
        content: "Test content",
        status: "in_progress" as const,
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const external = provider.mapFromSudocode(issue as any);

      expect(external.type).toBe("issue");
      expect(external.title).toBe("Test Issue");
      expect(external.status).toBe("in_progress");
    });
  });

  describe("getChangesSince", () => {
    it("detects all entities as new on first call", async () => {
      // Create a fresh provider for this test
      const freshProvider = openSpecPlugin.createProvider(
        { path: "." },
        fixturesPath
      );
      await freshProvider.initialize();

      const changes = await freshProvider.getChangesSince(new Date(0));

      expect(changes.length).toBeGreaterThan(0);
      expect(changes.every((c) => c.change_type === "created")).toBe(true);

      await freshProvider.dispose();
    });

    it("returns no changes when nothing has changed", async () => {
      // Create fresh provider and do initial sync
      const freshProvider = openSpecPlugin.createProvider(
        { path: "." },
        fixturesPath
      );
      await freshProvider.initialize();

      // First call populates hashes
      await freshProvider.getChangesSince(new Date(0));

      // Second call should return no changes
      const changes = await freshProvider.getChangesSince(new Date());

      expect(changes).toEqual([]);

      await freshProvider.dispose();
    });
  });

  describe("createEntity", () => {
    it("throws error (inbound-only sync)", async () => {
      await expect(provider.createEntity({ title: "Test" })).rejects.toThrow();
    });
  });

  describe("deleteEntity", () => {
    it("throws error (inbound-only sync)", async () => {
      await expect(provider.deleteEntity("os-1234")).rejects.toThrow();
    });
  });
});

describe("OpenSpecPlugin", () => {
  describe("validateConfig", () => {
    it("validates required path field", () => {
      const result = openSpecPlugin.validateConfig({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("openspec.options.path is required");
    });

    it("accepts valid configuration", () => {
      const result = openSpecPlugin.validateConfig({ path: ".openspec" });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("warns about non-standard prefixes", () => {
      const result = openSpecPlugin.validateConfig({
        path: ".openspec",
        spec_prefix: "toolong",
      });
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("testConnection", () => {
    it("succeeds for valid directory", async () => {
      const result = await openSpecPlugin.testConnection(
        { path: "." },
        fixturesPath
      );

      expect(result.success).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.enabled).toBe(true);
    });

    it("fails for non-existent directory", async () => {
      const result = await openSpecPlugin.testConnection(
        { path: "non-existent" },
        fixturesPath
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
