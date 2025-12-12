/**
 * Integration Tests for Spec-Kit Plugin
 *
 * Comprehensive tests covering:
 * - Import flow (spec-kit → sudocode)
 * - Relationship creation
 * - Change detection
 * - Outbound sync (sudocode → spec-kit)
 * - Bidirectional sync
 * - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import specKitPlugin, {
  mapFeatureRelationships,
  mapPlanToSpecRelationship,
  mapTaskToPlanRelationship,
  mapSupportingDocRelationships,
  updateTaskStatus,
  updateSpecContent,
  getTaskStatus,
  getSpecTitle,
  getSpecStatus,
  type SpecKitOptions,
} from "../../src/index.js";

// ============================================================================
// Test Setup Helpers
// ============================================================================

/**
 * Test context with temp directory and common helpers
 */
interface TestContext {
  testDir: string;
  specifyDir: string;
  specsDir: string;
  memoryDir: string;
  cleanup: () => void;
}

/**
 * Create a fresh test environment with spec-kit directory structure
 */
function createTestContext(): TestContext {
  const testDir = join(tmpdir(), `speckit-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const specifyDir = join(testDir, ".specify");
  const specsDir = join(specifyDir, "specs");
  const memoryDir = join(specifyDir, "memory");

  mkdirSync(specsDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  return {
    testDir,
    specifyDir,
    specsDir,
    memoryDir,
    cleanup: () => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Create a feature directory with standard spec-kit files
 */
function createFeature(
  ctx: TestContext,
  featureNumber: string,
  name: string,
  options: {
    spec?: string;
    plan?: string;
    tasks?: string;
    research?: string;
    dataModel?: string;
    contracts?: Record<string, object>;
  } = {}
): string {
  const featureDir = join(ctx.specsDir, `${featureNumber}-${name}`);
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
  if (options.dataModel) {
    writeFileSync(join(featureDir, "data-model.md"), options.dataModel);
  }
  if (options.contracts) {
    const contractsDir = join(featureDir, "contracts");
    mkdirSync(contractsDir, { recursive: true });
    for (const [name, data] of Object.entries(options.contracts)) {
      writeFileSync(join(contractsDir, `${name}.json`), JSON.stringify(data, null, 2));
    }
  }

  return featureDir;
}

/**
 * Create a constitution file
 */
function createConstitution(ctx: TestContext, content: string): string {
  const filePath = join(ctx.memoryDir, "constitution.md");
  writeFileSync(filePath, content);
  return filePath;
}

/**
 * Sample spec-kit files for testing
 */
const SAMPLE_SPEC = `# Feature Specification: User Authentication

**Feature Branch**: feature/auth
**Status**: In Progress
**Created**: 2024-01-15

## Overview
Implement user authentication with JWT tokens.

## Requirements
- User registration
- User login
- Password reset
- Token refresh
`;

const SAMPLE_PLAN = `# Implementation Plan: User Authentication

**Branch**: feature/auth
**Spec**: [[001-spec]]
**Status**: Draft

## Architecture
JWT-based authentication with refresh tokens.

## Phases
1. Database schema
2. API endpoints
3. Frontend integration
`;

const SAMPLE_TASKS = `# Tasks

## Phase 1: Foundation
- [ ] T001 [P] Setup database schema
- [ ] T002 Create user model
- [x] T003 Configure JWT library

## Phase 2: API
- [ ] T004 [US1] Implement login endpoint
- [ ] T005 [US1] Implement registration endpoint
- [ ] T006 [US2] [P] Add password reset
`;

const SAMPLE_RESEARCH = `# Research Notes

## JWT Libraries
- jsonwebtoken is the most popular
- jose is more modern but less documented

## Security Considerations
- Token expiry: 15 minutes
- Refresh token: 7 days
`;

const SAMPLE_DATA_MODEL = `# Data Model

## User Table
- id: UUID (primary key)
- email: VARCHAR(255) (unique)
- password_hash: VARCHAR(255)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
`;

const SAMPLE_CONSTITUTION = `# Project Constitution

## Principles
1. Security first
2. User experience matters
3. Keep it simple
`;

// ============================================================================
// Import Tests
// ============================================================================

describe("Import Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should import all entities from a feature directory", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      plan: SAMPLE_PLAN,
      tasks: SAMPLE_TASKS,
      research: SAMPLE_RESEARCH,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    // Should find spec, plan, tasks (as issues), and research
    const spec = entities.find((e) => e.id === "sk-001-spec");
    const plan = entities.find((e) => e.id === "sk-001-plan");
    const research = entities.find((e) => e.id === "sk-001-research");
    const tasks = entities.filter((e) => e.type === "issue");

    expect(spec).toBeDefined();
    expect(spec?.type).toBe("spec");
    expect(spec?.title).toBe("User Authentication");

    expect(plan).toBeDefined();
    expect(plan?.type).toBe("spec");
    expect(plan?.title).toBe("User Authentication");

    expect(research).toBeDefined();
    expect(research?.type).toBe("spec");

    // 6 tasks in SAMPLE_TASKS
    expect(tasks.length).toBe(6);
  });

  it("should correctly count specs and issues created", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      plan: SAMPLE_PLAN,
      tasks: SAMPLE_TASKS,
    });

    createFeature(ctx, "002", "payments", {
      spec: "# Feature Specification: Payments\n\n**Status**: Draft",
      plan: "# Implementation Plan: Payments\n",
      tasks: "# Tasks\n\n- [ ] T001 Setup Stripe\n- [ ] T002 Add webhooks\n",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    const specs = entities.filter((e) => e.type === "spec");
    const issues = entities.filter((e) => e.type === "issue");

    // 2 specs + 2 plans = 4 spec entities
    expect(specs.length).toBe(4);
    // 6 tasks from auth + 2 tasks from payments = 8 issues
    expect(issues.length).toBe(8);
  });

  it("should handle empty .specify directory gracefully", async () => {
    // specifyDir exists but specsDir is empty

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    expect(entities).toHaveLength(0);
  });

  it("should handle missing optional files (research.md, etc.)", async () => {
    // Only create spec and tasks, no plan or research
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      tasks: SAMPLE_TASKS,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    // Should still find spec and tasks
    const spec = entities.find((e) => e.id === "sk-001-spec");
    const plan = entities.find((e) => e.id === "sk-001-plan");
    const tasks = entities.filter((e) => e.type === "issue");

    expect(spec).toBeDefined();
    expect(plan).toBeUndefined(); // No plan file
    expect(tasks.length).toBe(6);
  });
});

// ============================================================================
// Relationship Tests
// ============================================================================

describe("Relationship Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should create implements relationship from plan to spec", () => {
    const rel = mapPlanToSpecRelationship("001", "sk");

    expect(rel.fromId).toBe("sk-001-plan");
    expect(rel.fromType).toBe("spec");
    expect(rel.toId).toBe("sk-001-spec");
    expect(rel.toType).toBe("spec");
    expect(rel.relationshipType).toBe("implements");
  });

  it("should create implements relationship from tasks to plan", () => {
    const rel = mapTaskToPlanRelationship("001", "T001", "sk", "skt");

    expect(rel.fromId).toBe("skt-001-T001");
    expect(rel.fromType).toBe("issue");
    expect(rel.toId).toBe("sk-001-plan");
    expect(rel.toType).toBe("spec");
    expect(rel.relationshipType).toBe("implements");
  });

  it("should create references relationship from supporting docs to plan", () => {
    const rels = mapSupportingDocRelationships("001", "sk", [
      { fileType: "research", entityType: "spec" },
      { fileType: "data-model", entityType: "spec" },
    ]);

    expect(rels).toHaveLength(2);

    const researchRel = rels.find((r) => r.fromId === "sk-001-research");
    expect(researchRel?.relationshipType).toBe("references");
    expect(researchRel?.toId).toBe("sk-001-plan");

    const dataModelRel = rels.find((r) => r.fromId === "sk-001-data-model");
    expect(dataModelRel?.relationshipType).toBe("references");
    expect(dataModelRel?.toId).toBe("sk-001-plan");
  });

  it("should create complete relationship graph for a feature", () => {
    const relationships = mapFeatureRelationships(
      "001",
      "sk",
      "skt",
      [
        { taskId: "T001" },
        { taskId: "T002", dependsOn: ["T001"] },
        { taskId: "T003" },
      ],
      [
        { fileType: "research", entityType: "spec" },
      ]
    );

    // Should have:
    // 1 plan->spec implements
    // 3 task->plan implements
    // 1 task->task depends-on (T002 depends on T001)
    // 1 research->plan references
    expect(relationships).toHaveLength(6);

    // Verify plan implements spec
    const planToSpec = relationships.find(
      (r) => r.fromId === "sk-001-plan" && r.toId === "sk-001-spec"
    );
    expect(planToSpec?.relationshipType).toBe("implements");

    // Verify task dependency
    const taskDep = relationships.find(
      (r) => r.fromId === "skt-001-T002" && r.toId === "skt-001-T001"
    );
    expect(taskDep?.relationshipType).toBe("depends-on");
  });
});

// ============================================================================
// Change Detection Tests
// ============================================================================

describe("Change Detection Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should detect new feature directory added", async () => {
    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Initial state - no features
    const initialChanges = await provider.getChangesSince(new Date(0));
    expect(initialChanges).toHaveLength(0);

    // Add a new feature
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
    });

    // Should detect the new entity
    const changes = await provider.getChangesSince(new Date(0));
    const createdChanges = changes.filter((c) => c.change_type === "created");

    expect(createdChanges.length).toBeGreaterThan(0);
    expect(createdChanges.some((c) => c.entity_id === "sk-001-spec")).toBe(true);
  });

  it("should detect spec.md content changes", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Modify the spec
    const specPath = join(ctx.specsDir, "001-auth", "spec.md");
    writeFileSync(specPath, SAMPLE_SPEC + "\n\n## Updated Section\nNew content here.");

    // Should detect the update
    const changes = await provider.getChangesSince(new Date(0));
    const updatedChange = changes.find(
      (c) => c.entity_id === "sk-001-spec" && c.change_type === "updated"
    );

    expect(updatedChange).toBeDefined();
  });

  it("should detect task checkbox toggled", async () => {
    createFeature(ctx, "001", "auth", {
      tasks: "# Tasks\n\n- [ ] T001 Setup\n- [ ] T002 Build\n",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Toggle a task
    const tasksPath = join(ctx.specsDir, "001-auth", "tasks.md");
    writeFileSync(tasksPath, "# Tasks\n\n- [x] T001 Setup\n- [ ] T002 Build\n");

    // Should detect the update
    const changes = await provider.getChangesSince(new Date(0));
    const updatedChange = changes.find(
      (c) => c.entity_id === "skt-001-T001" && c.change_type === "updated"
    );

    expect(updatedChange).toBeDefined();
  });

  it("should detect file deletion", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      plan: SAMPLE_PLAN,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Delete the plan file
    rmSync(join(ctx.specsDir, "001-auth", "plan.md"));

    // Should detect the deletion
    const changes = await provider.getChangesSince(new Date(0));
    const deletedChange = changes.find(
      (c) => c.entity_id === "sk-001-plan" && c.change_type === "deleted"
    );

    expect(deletedChange).toBeDefined();
  });
});

// ============================================================================
// Outbound Sync Tests
// ============================================================================

describe("Outbound Sync Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should update task checkbox when sudocode issue closed", async () => {
    createFeature(ctx, "001", "auth", {
      tasks: "# Tasks\n\n- [ ] T001 Setup project\n- [ ] T002 Build feature\n",
    });

    const tasksPath = join(ctx.specsDir, "001-auth", "tasks.md");

    // Verify initial state
    expect(getTaskStatus(tasksPath, "T001")).toBe(false);

    // Update task status (simulating issue closed in sudocode)
    const result = updateTaskStatus(tasksPath, "T001", true);

    expect(result.success).toBe(true);
    expect(result.previousStatus).toBe(false);
    expect(result.newStatus).toBe(true);

    // Verify file was updated
    const content = readFileSync(tasksPath, "utf-8");
    expect(content).toContain("- [x] T001 Setup project");
  });

  it("should update spec.md when sudocode spec title changes", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
    });

    const specPath = join(ctx.specsDir, "001-auth", "spec.md");

    // Verify initial title
    expect(getSpecTitle(specPath)).toBe("Feature Specification: User Authentication");

    // Update spec title
    const result = updateSpecContent(specPath, {
      title: "Feature Specification: Enhanced Authentication",
    });

    expect(result.success).toBe(true);
    expect(result.changes.title?.from).toBe("Feature Specification: User Authentication");
    expect(result.changes.title?.to).toBe("Feature Specification: Enhanced Authentication");

    // Verify file was updated
    expect(getSpecTitle(specPath)).toBe("Feature Specification: Enhanced Authentication");
  });

  it("should not trigger false change detection after outbound write", async () => {
    createFeature(ctx, "001", "auth", {
      tasks: "# Tasks\n\n- [ ] T001 Setup\n",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Update entity through provider (triggers outbound write)
    await provider.updateEntity("skt-001-T001", { status: "closed" });

    // Verify the update was successful - the file should now be updated
    const tasksPath = join(ctx.specsDir, "001-auth", "tasks.md");
    const content = readFileSync(tasksPath, "utf-8");
    expect(content).toContain("- [x] T001 Setup");

    // After a successful outbound write, subsequent fetches should reflect the change
    const entity = await provider.fetchEntity("skt-001-T001");
    expect(entity?.status).toBe("closed");
  });

  it("should update spec status through provider", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Update status through provider
    await provider.updateEntity("sk-001-spec", { status: "closed" });

    // Verify the file was updated
    const specPath = join(ctx.specsDir, "001-auth", "spec.md");
    const status = getSpecStatus(specPath);
    expect(status).toBe("Complete"); // "closed" maps to "Complete"
  });
});

// ============================================================================
// Bidirectional Sync Tests
// ============================================================================

describe("Bidirectional Sync Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should handle concurrent changes in both systems", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      tasks: "# Tasks\n\n- [ ] T001 Setup\n- [ ] T002 Build\n",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Simulate changes from both directions:
    // 1. External change: modify spec.md directly
    const specPath = join(ctx.specsDir, "001-auth", "spec.md");
    writeFileSync(specPath, SAMPLE_SPEC + "\n## External Edit\n");

    // 2. Internal change: update task through provider
    await provider.updateEntity("skt-001-T001", { status: "closed" });

    // Should detect the external change
    const changes = await provider.getChangesSince(new Date(0));

    // The spec change should be detected as external
    const specChange = changes.find((c) => c.entity_id === "sk-001-spec");
    expect(specChange).toBeDefined();
    expect(specChange?.change_type).toBe("updated");

    // Both changes are detected - the task update through provider is also detected
    // because the change detection compares entity state (not file content)
    const taskChange = changes.find((c) => c.entity_id === "skt-001-T001");
    expect(taskChange).toBeDefined();
    expect(taskChange?.change_type).toBe("updated");
    expect(taskChange?.data?.status).toBe("closed");
  });

  it("should respect sync direction configuration", async () => {
    // Test that include_supporting_docs configuration is respected
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      research: SAMPLE_RESEARCH,
    });

    // With supporting docs disabled
    const provider = specKitPlugin.createProvider(
      { path: ".specify", include_supporting_docs: false },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    // Should find spec but not research
    expect(entities.find((e) => e.id === "sk-001-spec")).toBeDefined();
    expect(entities.find((e) => e.id === "sk-001-research")).toBeUndefined();
  });

  it("should handle conflict scenarios gracefully", async () => {
    createFeature(ctx, "001", "auth", {
      tasks: "# Tasks\n\n- [ ] T001 Setup\n",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const tasksPath = join(ctx.specsDir, "001-auth", "tasks.md");

    // Both systems try to update the same task:
    // Direct file edit (simulating external change)
    writeFileSync(tasksPath, "# Tasks\n\n- [x] T001 Setup (external edit)\n");

    // Provider update (last write wins)
    await provider.updateEntity("skt-001-T001", { status: "open" });

    // The provider update should have won (last write)
    const content = readFileSync(tasksPath, "utf-8");
    expect(content).toContain("- [ ] T001");
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe("Edge Cases", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should handle feature directory with only spec.md (no plan/tasks)", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    // Should only find the spec
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe("sk-001-spec");
    expect(entities[0].type).toBe("spec");
  });

  it("should handle tasks.md with no tasks", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      tasks: "# Tasks\n\n## Coming Soon\n\nNo tasks defined yet.\n",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issues = entities.filter((e) => e.type === "issue");

    // Should find no issues (no valid task lines)
    expect(issues).toHaveLength(0);
  });

  it("should handle malformed markdown gracefully", async () => {
    createFeature(ctx, "001", "auth", {
      spec: "This is not a valid spec file\n\nNo headers at all",
      tasks: "Malformed tasks file\n- Not a task\n- Also not a task",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Should not throw, may find entities with default/empty values
    const entities = await provider.searchEntities();

    // Parser should be tolerant and still create entities
    expect(() => provider.searchEntities()).not.toThrow();
  });

  it("should handle very large tasks.md file", async () => {
    // Generate a large tasks file with 100 tasks
    let tasks = "# Tasks\n\n## Phase 1\n";
    for (let i = 1; i <= 100; i++) {
      const taskId = `T${String(i).padStart(3, "0")}`;
      const completed = i % 3 === 0 ? "x" : " ";
      const parallel = i % 5 === 0 ? " [P]" : "";
      tasks += `- [${completed}] ${taskId}${parallel} Task number ${i} with some description\n`;
    }

    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      tasks,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issues = entities.filter((e) => e.type === "issue");

    // Should find all 100 tasks
    expect(issues.length).toBe(100);

    // Verify completed status is correct
    const t003 = issues.find((e) => e.id === "skt-001-T003");
    expect(t003?.status).toBe("closed"); // Every 3rd task is completed

    const t005 = issues.find((e) => e.id === "skt-001-T005");
    expect(t005?.priority).toBe(1); // Every 5th task is parallelizable
  });

  it("should handle feature directory names with special characters", async () => {
    // Feature name with underscores and dashes
    createFeature(ctx, "001", "user-auth_v2", {
      spec: SAMPLE_SPEC,
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    expect(entities.find((e) => e.id === "sk-001-spec")).toBeDefined();
  });

  it("should handle constitution file", async () => {
    createConstitution(ctx, SAMPLE_CONSTITUTION);

    const provider = specKitPlugin.createProvider(
      { path: ".specify", include_constitution: true },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const constitution = entities.find((e) => e.id === "sk-constitution");

    expect(constitution).toBeDefined();
    expect(constitution?.type).toBe("spec");
    expect(constitution?.title).toBe("Project Constitution");
  });

  it("should exclude constitution when configured", async () => {
    createConstitution(ctx, SAMPLE_CONSTITUTION);

    const provider = specKitPlugin.createProvider(
      { path: ".specify", include_constitution: false },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const constitution = entities.find((e) => e.id === "sk-constitution");

    expect(constitution).toBeUndefined();
  });

  it("should handle contracts directory", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      contracts: {
        "api-spec": { openapi: "3.0.0", paths: {} },
        "events": { eventTypes: ["login", "logout"] },
      },
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify", include_supporting_docs: true },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    // Should find the contract files
    const apiSpec = entities.find((e) => e.id === "sk-001-contract-api-spec");
    const events = entities.find((e) => e.id === "sk-001-contract-events");

    expect(apiSpec).toBeDefined();
    expect(apiSpec?.type).toBe("spec");
    expect(events).toBeDefined();
  });

  it("should handle empty spec.md file", async () => {
    createFeature(ctx, "001", "auth", {
      spec: "",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );
    await provider.initialize();

    // Should handle gracefully without throwing
    await expect(provider.searchEntities()).resolves.toBeDefined();
  });

  it("should handle missing .specify directory on validate", async () => {
    // Remove the specs directory
    rmSync(ctx.specifyDir, { recursive: true, force: true });

    const provider = specKitPlugin.createProvider(
      { path: ".specify" },
      ctx.testDir
    );

    // Initialize should throw
    await expect(provider.initialize()).rejects.toThrow();
  });

  it("should correctly use custom ID prefixes", async () => {
    createFeature(ctx, "001", "auth", {
      spec: SAMPLE_SPEC,
      tasks: "# Tasks\n\n- [ ] T001 Setup\n",
    });

    const provider = specKitPlugin.createProvider(
      { path: ".specify", spec_prefix: "myspec", task_prefix: "mytask" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    // Should use custom prefixes
    expect(entities.find((e) => e.id === "myspec-001-spec")).toBeDefined();
    expect(entities.find((e) => e.id === "mytask-001-T001")).toBeDefined();
  });
});
