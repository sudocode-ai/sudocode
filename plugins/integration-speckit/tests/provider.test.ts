/**
 * Tests for SpecKitProvider core methods
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import specKitPlugin, { type SpecKitOptions } from "../src/index.js";

describe("SpecKitProvider", () => {
  let testDir: string;
  let specifyDir: string;
  let specsDir: string;

  beforeEach(() => {
    // Create a temp directory with spec-kit structure
    testDir = join(tmpdir(), `speckit-test-${Date.now()}`);
    specifyDir = join(testDir, ".specify");
    specsDir = join(specifyDir, "specs");

    mkdirSync(specsDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create a feature directory with files
   */
  function createFeature(
    featureNumber: string,
    name: string,
    options: {
      spec?: string;
      plan?: string;
      tasks?: string;
      research?: string;
    } = {}
  ): string {
    const featureDir = join(specsDir, `${featureNumber}-${name}`);
    mkdirSync(featureDir, { recursive: true });

    if (options.spec) {
      writeFileSync(join(featureDir, "spec.md"), options.spec);
    }
    if (options.plan) {
      writeFileSync(join(featureDir, "plan.md"), options.plan);
    }
    if (options.tasks) {
      writeFileSync(join(featureDir, "tasks.md"), options.tasks);
    }
    if (options.research) {
      writeFileSync(join(featureDir, "research.md"), options.research);
    }

    return featureDir;
  }

  describe("validateConfig", () => {
    it("should return valid when path is provided", () => {
      const result = specKitPlugin.validateConfig({ path: ".specify" });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return invalid when path is missing", () => {
      const result = specKitPlugin.validateConfig({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("spec-kit.options.path is required");
    });

    it("should validate spec_prefix format", () => {
      const result = specKitPlugin.validateConfig({
        path: ".specify",
        spec_prefix: "toolong",
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "spec-kit.options.spec_prefix should be 1-4 alphabetic characters"
      );
    });
  });

  describe("testConnection", () => {
    it("should return success when directory exists", async () => {
      const result = await specKitPlugin.testConnection(
        { path: ".specify" },
        testDir
      );
      expect(result.success).toBe(true);
      expect(result.details?.hasSpecsDirectory).toBe(true);
    });

    it("should return failure when directory does not exist", async () => {
      const result = await specKitPlugin.testConnection(
        { path: ".nonexistent" },
        testDir
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("provider lifecycle", () => {
    it("should initialize successfully", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await expect(provider.initialize()).resolves.not.toThrow();
    });

    it("should validate successfully", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();
      const result = await provider.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should dispose successfully", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();
      await expect(provider.dispose()).resolves.not.toThrow();
    });
  });

  describe("searchEntities", () => {
    it("should return empty array when no specs exist", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      expect(entities).toHaveLength(0);
    });

    it("should find spec files", async () => {
      createFeature("001", "auth", {
        spec: `# Feature Specification: Authentication

**Status**: Draft

## Overview
User authentication system.
`,
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      expect(entities.length).toBeGreaterThan(0);

      const specEntity = entities.find((e) => e.id === "sk-001-spec");
      expect(specEntity).toBeDefined();
      expect(specEntity?.type).toBe("spec");
      expect(specEntity?.title).toBe("Authentication");
    });

    it("should find plan files", async () => {
      createFeature("001", "auth", {
        spec: "# Feature Specification: Auth\n",
        plan: `# Implementation Plan: Authentication

**Status**: In Progress

## Overview
Implementation details.
`,
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const planEntity = entities.find((e) => e.id === "sk-001-plan");

      expect(planEntity).toBeDefined();
      expect(planEntity?.type).toBe("spec");
      expect(planEntity?.title).toBe("Authentication");
    });

    it("should find tasks as issues", async () => {
      createFeature("001", "auth", {
        tasks: `# Tasks

- [ ] T001 Setup project structure
- [x] T002 Create user model
- [ ] T003 [P] Implement login
`,
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();

      // Find task entities
      const task1 = entities.find((e) => e.id === "skt-001-T001");
      const task2 = entities.find((e) => e.id === "skt-001-T002");
      const task3 = entities.find((e) => e.id === "skt-001-T003");

      expect(task1).toBeDefined();
      expect(task1?.type).toBe("issue");
      expect(task1?.status).toBe("open");

      expect(task2).toBeDefined();
      expect(task2?.status).toBe("closed"); // Completed task

      expect(task3).toBeDefined();
      expect(task3?.priority).toBe(1); // Parallelizable = higher priority
    });

    it("should filter by query", async () => {
      createFeature("001", "auth", {
        spec: "# Feature Specification: Authentication\n",
        plan: "# Implementation Plan: Auth System\n",
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const filteredEntities = await provider.searchEntities("Authentication");

      expect(filteredEntities.length).toBe(1);
      expect(filteredEntities[0].title).toBe("Authentication");
    });

    it("should include constitution when configured", async () => {
      const memoryDir = join(specifyDir, "memory");
      mkdirSync(memoryDir, { recursive: true });
      writeFileSync(
        join(memoryDir, "constitution.md"),
        "# Constitution\n\nProject principles."
      );

      const provider = specKitPlugin.createProvider(
        { path: ".specify", include_constitution: true },
        testDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const constitution = entities.find((e) => e.id === "sk-constitution");

      expect(constitution).toBeDefined();
      expect(constitution?.type).toBe("spec");
    });

    it("should respect include_supporting_docs option", async () => {
      createFeature("001", "auth", {
        spec: "# Feature Specification: Auth\n",
        research: "# Research Notes\n\nFindings.",
      });

      // With supporting docs enabled (default)
      const provider1 = specKitPlugin.createProvider(
        { path: ".specify", include_supporting_docs: true },
        testDir
      );
      await provider1.initialize();
      const entities1 = await provider1.searchEntities();
      const research1 = entities1.find((e) => e.id === "sk-001-research");
      expect(research1).toBeDefined();

      // With supporting docs disabled
      const provider2 = specKitPlugin.createProvider(
        { path: ".specify", include_supporting_docs: false },
        testDir
      );
      await provider2.initialize();
      const entities2 = await provider2.searchEntities();
      const research2 = entities2.find((e) => e.id === "sk-001-research");
      expect(research2).toBeUndefined();
    });
  });

  describe("fetchEntity", () => {
    it("should fetch a specific spec entity", async () => {
      createFeature("001", "auth", {
        spec: `# Feature Specification: Authentication

**Status**: Draft

## Overview
User authentication.
`,
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entity = await provider.fetchEntity("sk-001-spec");

      expect(entity).not.toBeNull();
      expect(entity?.id).toBe("sk-001-spec");
      expect(entity?.type).toBe("spec");
      expect(entity?.title).toBe("Authentication");
    });

    it("should fetch a specific task entity", async () => {
      createFeature("001", "auth", {
        tasks: `# Tasks

- [ ] T001 Setup project
- [x] T002 Done task
`,
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entity = await provider.fetchEntity("skt-001-T001");

      expect(entity).not.toBeNull();
      expect(entity?.id).toBe("skt-001-T001");
      expect(entity?.type).toBe("issue");
      expect(entity?.status).toBe("open");
    });

    it("should return null for non-existent entity", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entity = await provider.fetchEntity("sk-999-spec");

      expect(entity).toBeNull();
    });

    it("should return null for invalid ID format", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      const entity = await provider.fetchEntity("invalid-format");

      expect(entity).toBeNull();
    });
  });

  describe("getChangesSince", () => {
    it("should detect new entities", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      // Initial state - no entities
      const initialChanges = await provider.getChangesSince(new Date(0));
      expect(initialChanges).toHaveLength(0);

      // Create a new feature
      createFeature("001", "auth", {
        spec: "# Feature Specification: Auth\n",
      });

      // Should detect the new entity
      const changes = await provider.getChangesSince(new Date(0));
      expect(changes.length).toBeGreaterThan(0);

      const createdChange = changes.find(
        (c) => c.entity_id === "sk-001-spec" && c.change_type === "created"
      );
      expect(createdChange).toBeDefined();
    });

    it("should detect updated entities", async () => {
      createFeature("001", "auth", {
        spec: "# Feature Specification: Auth\n\nVersion 1",
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      // Initial capture
      await provider.getChangesSince(new Date(0));

      // Modify the spec
      const specPath = join(specsDir, "001-auth", "spec.md");
      writeFileSync(specPath, "# Feature Specification: Auth\n\nVersion 2");

      // Should detect the update
      const changes = await provider.getChangesSince(new Date(0));
      const updatedChange = changes.find(
        (c) => c.entity_id === "sk-001-spec" && c.change_type === "updated"
      );
      expect(updatedChange).toBeDefined();
    });

    it("should detect deleted entities", async () => {
      createFeature("001", "auth", {
        spec: "# Feature Specification: Auth\n",
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );
      await provider.initialize();

      // Initial capture
      await provider.getChangesSince(new Date(0));

      // Delete the feature
      rmSync(join(specsDir, "001-auth"), { recursive: true, force: true });

      // Should detect the deletion
      const changes = await provider.getChangesSince(new Date(0));
      const deletedChange = changes.find(
        (c) => c.entity_id === "sk-001-spec" && c.change_type === "deleted"
      );
      expect(deletedChange).toBeDefined();
    });
  });

  describe("mapToSudocode", () => {
    it("should map issue entities correctly", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );

      const externalEntity = {
        id: "skt-001-T001",
        type: "issue" as const,
        title: "T001: Setup project",
        description: "Setup the project structure",
        status: "open",
        priority: 2,
      };

      const result = provider.mapToSudocode(externalEntity);

      expect(result.issue).toBeDefined();
      expect(result.issue?.title).toBe("T001: Setup project");
      expect(result.issue?.content).toBe("Setup the project structure");
      expect(result.issue?.status).toBe("open");
    });

    it("should map spec entities correctly", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );

      const externalEntity = {
        id: "sk-001-spec",
        type: "spec" as const,
        title: "Authentication",
        description: "Auth spec content",
        priority: 2,
      };

      const result = provider.mapToSudocode(externalEntity);

      expect(result.spec).toBeDefined();
      expect(result.spec?.title).toBe("Authentication");
      expect(result.spec?.content).toBe("Auth spec content");
    });
  });

  describe("mapFromSudocode", () => {
    it("should map issue to external format", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );

      const issue = {
        id: "i-test",
        uuid: "test-uuid",
        title: "Test Issue",
        content: "Issue description",
        status: "in_progress" as const,
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = provider.mapFromSudocode(issue);

      expect(result.type).toBe("issue");
      expect(result.title).toBe("Test Issue");
      expect(result.description).toBe("Issue description");
      expect(result.status).toBe("in_progress");
    });

    it("should map spec to external format", async () => {
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        testDir
      );

      const spec = {
        id: "s-test",
        uuid: "test-uuid",
        title: "Test Spec",
        content: "Spec content",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = provider.mapFromSudocode(spec);

      expect(result.type).toBe("spec");
      expect(result.title).toBe("Test Spec");
      expect(result.description).toBe("Spec content");
      expect(result.status).toBeUndefined();
    });
  });

  describe("custom prefixes", () => {
    it("should use custom spec prefix", async () => {
      createFeature("001", "auth", {
        spec: "# Feature Specification: Auth\n",
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify", spec_prefix: "my" },
        testDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const specEntity = entities.find((e) => e.id === "my-001-spec");

      expect(specEntity).toBeDefined();
    });

    it("should use custom task prefix", async () => {
      createFeature("001", "auth", {
        tasks: "# Tasks\n\n- [ ] T001 Setup\n",
      });

      const provider = specKitPlugin.createProvider(
        { path: ".specify", task_prefix: "tk" },
        testDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const taskEntity = entities.find((e) => e.id === "tk-001-T001");

      expect(taskEntity).toBeDefined();
    });
  });
});
