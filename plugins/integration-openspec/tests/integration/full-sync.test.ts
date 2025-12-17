/**
 * Integration Tests for OpenSpec Plugin
 *
 * Comprehensive tests covering:
 * - Import flow (OpenSpec → sudocode)
 * - Relationship creation (change → spec via affected specs)
 * - Change detection
 * - Status mapping (archive detection, task completion)
 * - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import openSpecPlugin, {
  generateSpecId,
  generateChangeId,
  type OpenSpecOptions,
} from "../../src/index.js";

// ============================================================================
// Test Setup Helpers
// ============================================================================

/**
 * Test context with temp directory and common helpers
 */
interface TestContext {
  testDir: string;
  openspecDir: string;
  specsDir: string;
  changesDir: string;
  archiveDir: string;
  cleanup: () => void;
}

/**
 * Create a fresh test environment with OpenSpec directory structure
 */
function createTestContext(): TestContext {
  const testDir = join(
    tmpdir(),
    `openspec-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const openspecDir = join(testDir, "openspec");
  const specsDir = join(openspecDir, "specs");
  const changesDir = join(openspecDir, "changes");
  const archiveDir = join(changesDir, "archive");

  mkdirSync(specsDir, { recursive: true });
  mkdirSync(changesDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  return {
    testDir,
    openspecDir,
    specsDir,
    changesDir,
    archiveDir,
    cleanup: () => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Create a spec directory with spec.md file
 */
function createSpec(
  ctx: TestContext,
  capability: string,
  content: string
): string {
  const specDir = join(ctx.specsDir, capability);
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, "spec.md");
  writeFileSync(specPath, content);
  return specDir;
}

/**
 * Create a change directory with optional files
 */
function createChange(
  ctx: TestContext,
  name: string,
  options: {
    proposal?: string;
    tasks?: string;
    design?: string;
    affectedSpecs?: string[];
    archived?: boolean;
    archiveDate?: string;
  } = {}
): string {
  let changeDir: string;

  if (options.archived) {
    const datePart = options.archiveDate || "2024-01-15";
    changeDir = join(ctx.archiveDir, `${datePart}-${name}`);
  } else {
    changeDir = join(ctx.changesDir, name);
  }

  mkdirSync(changeDir, { recursive: true });

  if (options.proposal) {
    writeFileSync(join(changeDir, "proposal.md"), options.proposal);
  }
  if (options.tasks) {
    writeFileSync(join(changeDir, "tasks.md"), options.tasks);
  }
  if (options.design) {
    writeFileSync(join(changeDir, "design.md"), options.design);
  }

  // Create delta directories for affected specs
  if (options.affectedSpecs && options.affectedSpecs.length > 0) {
    const deltaSpecsDir = join(changeDir, "specs");
    mkdirSync(deltaSpecsDir, { recursive: true });
    for (const spec of options.affectedSpecs) {
      mkdirSync(join(deltaSpecsDir, spec), { recursive: true });
    }
  }

  return changeDir;
}

// ============================================================================
// Sample Content
// ============================================================================

const SAMPLE_SPEC = `# CLI Init Specification

## Purpose
Initialize a new project with default configuration.

### Requirement: Default Configuration
The CLI should create sensible defaults.

#### Scenario: New project initialization
- **GIVEN** a user runs \`init\` command
- **WHEN** the command executes
- **THEN** a configuration file is created
`;

const SAMPLE_SPEC_2 = `# API Design Specification

## Purpose
Define the REST API endpoints.

### Requirement: RESTful endpoints
All endpoints should follow REST conventions.
`;

const SAMPLE_PROPOSAL = `## Why
We need to add a new scaffold command for faster project setup.

## What Changes
- Add new \`scaffold\` subcommand to CLI
- Generate boilerplate files
- Support multiple templates

## Impact
This will speed up project initialization significantly.
`;

const SAMPLE_TASKS = `# Tasks

- [ ] Create command structure
- [ ] Add template parsing
- [x] Setup CLI framework
`;

const SAMPLE_TASKS_ALL_DONE = `# Tasks

- [x] Create command structure
- [x] Add template parsing
- [x] Setup CLI framework
`;

const SAMPLE_TASKS_PARTIAL = `# Tasks

- [ ] Create command structure
- [x] Add template parsing
- [ ] Setup CLI framework
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

  it("should import all specs from specs directory", async () => {
    createSpec(ctx, "cli-init", SAMPLE_SPEC);
    createSpec(ctx, "api-design", SAMPLE_SPEC_2);

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const specs = entities.filter((e) => e.type === "spec");

    expect(specs.length).toBe(2);

    const cliInitSpec = specs.find((s) => s.title === "CLI Init Specification");
    expect(cliInitSpec).toBeDefined();
    expect(cliInitSpec?.description).toContain("Initialize a new project");
  });

  it("should import all changes as issues", async () => {
    createChange(ctx, "add-scaffold-command", {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS,
    });

    createChange(ctx, "fix-bug", {
      proposal: "## Why\nFix critical bug\n\n## What Changes\nPatch the issue",
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issues = entities.filter((e) => e.type === "issue");

    expect(issues.length).toBe(2);

    const scaffoldIssue = issues.find((i) =>
      i.title.includes("scaffold")
    );
    expect(scaffoldIssue).toBeDefined();
  });

  it("should import both specs and changes together", async () => {
    createSpec(ctx, "cli-init", SAMPLE_SPEC);
    createChange(ctx, "add-scaffold-command", {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS,
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    const specs = entities.filter((e) => e.type === "spec");
    const issues = entities.filter((e) => e.type === "issue");

    expect(specs.length).toBe(1);
    expect(issues.length).toBe(1);
  });

  it("should handle empty openspec directory gracefully", async () => {
    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    expect(entities).toHaveLength(0);
  });

  it("should handle missing optional files (design.md)", async () => {
    createChange(ctx, "minimal-change", {
      proposal: SAMPLE_PROPOSAL,
      // No tasks.md or design.md
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    expect(entities.length).toBe(1);
    expect(entities[0].type).toBe("issue");
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

  it("should create implements relationship from change to affected spec", async () => {
    // Create the spec that will be affected
    createSpec(ctx, "cli-scaffold", SAMPLE_SPEC);

    // Create change with affected spec
    createChange(ctx, "add-scaffold-command", {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS,
      affectedSpecs: ["cli-scaffold"],
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue).toBeDefined();
    expect(issue?.relationships).toBeDefined();
    expect(issue?.relationships?.length).toBeGreaterThan(0);

    const implementsRel = issue?.relationships?.find(
      (r) => r.relationshipType === "implements"
    );
    expect(implementsRel).toBeDefined();
    expect(implementsRel?.targetType).toBe("spec");
  });

  it("should create multiple implements relationships for multiple affected specs", async () => {
    createSpec(ctx, "cli-scaffold", SAMPLE_SPEC);
    createSpec(ctx, "api-design", SAMPLE_SPEC_2);

    createChange(ctx, "big-refactor", {
      proposal: SAMPLE_PROPOSAL,
      affectedSpecs: ["cli-scaffold", "api-design"],
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.relationships?.length).toBe(2);

    const specIds = issue?.relationships?.map((r) => r.targetId);
    expect(specIds).toContain(generateSpecId("cli-scaffold", "os"));
    expect(specIds).toContain(generateSpecId("api-design", "os"));
  });

  it("should not create relationships when no affected specs", async () => {
    createChange(ctx, "standalone-change", {
      proposal: SAMPLE_PROPOSAL,
      // No affectedSpecs
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.relationships).toBeUndefined();
  });

  it("should use correct ID format for relationship targets", async () => {
    createSpec(ctx, "my-feature", SAMPLE_SPEC);

    createChange(ctx, "implement-feature", {
      proposal: SAMPLE_PROPOSAL,
      affectedSpecs: ["my-feature"],
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec", spec_prefix: "os" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    const expectedSpecId = generateSpecId("my-feature", "os");
    expect(issue?.relationships?.[0].targetId).toBe(expectedSpecId);
  });
});

// ============================================================================
// Status Mapping Tests
// ============================================================================

describe("Status Mapping Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should map archived changes to closed status", async () => {
    createChange(ctx, "completed-feature", {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS_ALL_DONE,
      archived: true,
      archiveDate: "2024-01-15",
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.status).toBe("closed");
  });

  it("should map changes with 100% task completion to needs_review", async () => {
    createChange(ctx, "ready-for-review", {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS_ALL_DONE,
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.status).toBe("needs_review");
  });

  it("should map changes with partial progress to in_progress", async () => {
    createChange(ctx, "in-progress-change", {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS_PARTIAL,
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.status).toBe("in_progress");
  });

  it("should map changes with no task progress to open", async () => {
    const noProgressTasks = `# Tasks

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
`;
    createChange(ctx, "not-started", {
      proposal: SAMPLE_PROPOSAL,
      tasks: noProgressTasks,
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.status).toBe("open");
  });

  it("should map changes without tasks.md to open", async () => {
    createChange(ctx, "no-tasks", {
      proposal: SAMPLE_PROPOSAL,
      // No tasks file
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.status).toBe("open");
  });

  it("should set lower priority for archived changes", async () => {
    createChange(ctx, "active-change", {
      proposal: SAMPLE_PROPOSAL,
    });

    createChange(ctx, "archived-change", {
      proposal: SAMPLE_PROPOSAL,
      archived: true,
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const activeIssue = entities.find(
      (e) => e.type === "issue" && e.status !== "closed"
    );
    const archivedIssue = entities.find(
      (e) => e.type === "issue" && e.status === "closed"
    );

    expect(activeIssue?.priority).toBe(2);
    expect(archivedIssue?.priority).toBe(4);
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

  it("should detect new spec added", async () => {
    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    // Initial state - no specs
    const initialChanges = await provider.getChangesSince(new Date(0));
    expect(initialChanges).toHaveLength(0);

    // Add a new spec
    createSpec(ctx, "new-feature", SAMPLE_SPEC);

    // Should detect the new entity
    const changes = await provider.getChangesSince(new Date(0));
    const createdChanges = changes.filter((c) => c.change_type === "created");

    expect(createdChanges.length).toBe(1);
    expect(createdChanges[0].entity_type).toBe("spec");
  });

  it("should detect spec content changes", async () => {
    createSpec(ctx, "cli-init", SAMPLE_SPEC);

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Modify the spec
    const specPath = join(ctx.specsDir, "cli-init", "spec.md");
    writeFileSync(specPath, SAMPLE_SPEC + "\n\n## New Section\nAdded content.");

    // Should detect the update
    const changes = await provider.getChangesSince(new Date(0));
    const updatedChange = changes.find((c) => c.change_type === "updated");

    expect(updatedChange).toBeDefined();
    expect(updatedChange?.entity_type).toBe("spec");
  });

  it("should detect new change directory added", async () => {
    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    // Initial state
    await provider.getChangesSince(new Date(0));

    // Add new change
    createChange(ctx, "new-feature-change", {
      proposal: SAMPLE_PROPOSAL,
    });

    const changes = await provider.getChangesSince(new Date(0));
    const createdChanges = changes.filter((c) => c.change_type === "created");

    expect(createdChanges.length).toBe(1);
    expect(createdChanges[0].entity_type).toBe("issue");
  });

  it("should detect task checkbox toggled", async () => {
    createChange(ctx, "task-change", {
      proposal: SAMPLE_PROPOSAL,
      tasks: "# Tasks\n\n- [ ] Task 1\n- [ ] Task 2\n",
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Toggle a task
    const tasksPath = join(ctx.changesDir, "task-change", "tasks.md");
    writeFileSync(tasksPath, "# Tasks\n\n- [x] Task 1\n- [ ] Task 2\n");

    // Should detect the update
    const changes = await provider.getChangesSince(new Date(0));
    const updatedChange = changes.find((c) => c.change_type === "updated");

    expect(updatedChange).toBeDefined();
  });

  it("should detect file deletion", async () => {
    createSpec(ctx, "to-delete", SAMPLE_SPEC);

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    // Capture initial state
    await provider.getChangesSince(new Date(0));

    // Delete the spec
    rmSync(join(ctx.specsDir, "to-delete"), { recursive: true });

    // Should detect the deletion
    const changes = await provider.getChangesSince(new Date(0));
    const deletedChange = changes.find((c) => c.change_type === "deleted");

    expect(deletedChange).toBeDefined();
    expect(deletedChange?.entity_type).toBe("spec");
  });
});

// ============================================================================
// Data Mapping Tests
// ============================================================================

describe("Data Mapping Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should correctly map spec to sudocode format", async () => {
    createSpec(ctx, "cli-init", SAMPLE_SPEC);

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const spec = entities.find((e) => e.type === "spec");

    expect(spec).toBeDefined();

    const mapped = provider.mapToSudocode(spec!);

    expect(mapped.spec).toBeDefined();
    expect(mapped.spec?.title).toBe("CLI Init Specification");
    expect(mapped.spec?.content).toContain("Initialize a new project");
    expect(mapped.spec?.priority).toBe(2);
  });

  it("should correctly map issue to sudocode format with status", async () => {
    createChange(ctx, "test-change", {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS_PARTIAL,
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    const mapped = provider.mapToSudocode(issue!);

    expect(mapped.issue).toBeDefined();
    expect(mapped.issue?.status).toBe("in_progress");
  });

  it("should include relationships in mapped result", async () => {
    createSpec(ctx, "target-spec", SAMPLE_SPEC);
    createChange(ctx, "implementing-change", {
      proposal: SAMPLE_PROPOSAL,
      affectedSpecs: ["target-spec"],
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    const mapped = provider.mapToSudocode(issue!);

    expect(mapped.relationships).toBeDefined();
    expect(mapped.relationships?.length).toBe(1);
    expect(mapped.relationships?.[0].relationshipType).toBe("implements");
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

  it("should handle spec directory without spec.md", async () => {
    // Create a directory but no spec.md file
    const emptySpecDir = join(ctx.specsDir, "empty-spec");
    mkdirSync(emptySpecDir, { recursive: true });
    writeFileSync(join(emptySpecDir, "notes.txt"), "Some notes");

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    expect(entities).toHaveLength(0);
  });

  it("should handle change directory with only design.md", async () => {
    const changeDir = join(ctx.changesDir, "design-only");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, "design.md"), "# Design\n\nSome design docs");

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue).toBeDefined();
    // Title should be formatted from directory name
    expect(issue?.title).toBe("Design only");
  });

  it("should handle malformed markdown gracefully", async () => {
    createSpec(ctx, "malformed", "This is not a valid spec\n\nNo headers");

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    // Should not throw
    const entities = await provider.searchEntities();
    expect(entities.length).toBe(1);
    // Title falls back to capability name
    expect(entities[0].title).toBe("malformed");
  });

  it("should handle very large spec file", async () => {
    let largeSpec = "# Large Specification\n\n## Purpose\nLarge file test.\n\n";
    for (let i = 0; i < 100; i++) {
      largeSpec += `### Requirement: Requirement ${i}\n\nSome content for requirement ${i}.\n\n`;
    }

    createSpec(ctx, "large-spec", largeSpec);

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    expect(entities.length).toBe(1);
    expect(entities[0].description?.length).toBeGreaterThan(5000);
  });

  it("should handle spec names with special characters", async () => {
    createSpec(ctx, "my-feature_v2", SAMPLE_SPEC);

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    expect(entities.length).toBe(1);

    // ID should be generated correctly
    const expectedId = generateSpecId("my-feature_v2", "os");
    expect(entities[0].id).toBe(expectedId);
  });

  it("should use custom ID prefixes", async () => {
    createSpec(ctx, "test-spec", SAMPLE_SPEC);
    createChange(ctx, "test-change", { proposal: SAMPLE_PROPOSAL });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec", spec_prefix: "myos", issue_prefix: "myosc" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    const spec = entities.find((e) => e.type === "spec");
    const issue = entities.find((e) => e.type === "issue");

    expect(spec?.id.startsWith("myos-")).toBe(true);
    expect(issue?.id.startsWith("myosc-")).toBe(true);
  });

  it("should handle missing openspec directory on initialize", async () => {
    rmSync(ctx.openspecDir, { recursive: true, force: true });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );

    await expect(provider.initialize()).rejects.toThrow();
  });

  it("should search entities by query", async () => {
    createSpec(ctx, "cli-init", SAMPLE_SPEC);
    createSpec(ctx, "api-design", SAMPLE_SPEC_2);
    createChange(ctx, "cli-change", { proposal: SAMPLE_PROPOSAL });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    // Search for "CLI"
    const cliEntities = await provider.searchEntities("CLI");
    expect(cliEntities.length).toBeGreaterThanOrEqual(1);

    // Search for "API"
    const apiEntities = await provider.searchEntities("API");
    expect(apiEntities.length).toBe(1);
    expect(apiEntities[0].title).toContain("API");
  });

  it("should return null for non-existent entity", async () => {
    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entity = await provider.fetchEntity("os-nonexistent");
    expect(entity).toBeNull();
  });

  it("should handle fetchEntity for valid ID", async () => {
    createSpec(ctx, "test-spec", SAMPLE_SPEC);

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const expectedId = generateSpecId("test-spec", "os");
    const entity = await provider.fetchEntity(expectedId);

    expect(entity).not.toBeNull();
    expect(entity?.id).toBe(expectedId);
    expect(entity?.type).toBe("spec");
  });

  it("should throw error on createEntity (inbound-only)", async () => {
    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    await expect(
      provider.createEntity({ title: "Test" })
    ).rejects.toThrow();
  });

  it("should throw error on deleteEntity (inbound-only)", async () => {
    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    await expect(
      provider.deleteEntity("os-test")
    ).rejects.toThrow();
  });
});

// ============================================================================
// Archive Detection Tests
// ============================================================================

describe("Archive Detection Tests", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should extract archive date from directory name", async () => {
    createChange(ctx, "completed-feature", {
      proposal: SAMPLE_PROPOSAL,
      archived: true,
      archiveDate: "2024-03-15",
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issue = entities.find((e) => e.type === "issue");

    expect(issue?.status).toBe("closed");
    // The raw data should contain archive info
    expect((issue?.raw as any)?.isArchived).toBe(true);
  });

  it("should use same ID for active and archived change with same name", async () => {
    // This tests that the ID is based on the change name, not the full path
    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );

    // Create active change
    createChange(ctx, "my-change", { proposal: SAMPLE_PROPOSAL });
    await provider.initialize();

    let entities = await provider.searchEntities();
    const activeId = entities[0].id;

    // Clean up and create archived version
    await provider.dispose();
    rmSync(join(ctx.changesDir, "my-change"), { recursive: true });

    createChange(ctx, "my-change", {
      proposal: SAMPLE_PROPOSAL,
      archived: true,
    });

    const provider2 = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider2.initialize();

    entities = await provider2.searchEntities();
    const archivedId = entities[0].id;

    // IDs should be the same since they're based on the change name
    expect(activeId).toBe(archivedId);

    await provider2.dispose();
  });

  it("should include both active and archived changes when trackArchived is true", async () => {
    createChange(ctx, "active-change", { proposal: SAMPLE_PROPOSAL });
    createChange(ctx, "archived-change", {
      proposal: SAMPLE_PROPOSAL,
      archived: true,
    });

    const provider = openSpecPlugin.createProvider(
      { path: "openspec" },
      ctx.testDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();
    const issues = entities.filter((e) => e.type === "issue");

    expect(issues.length).toBe(2);

    const activeIssue = issues.find((i) => i.status !== "closed");
    const archivedIssue = issues.find((i) => i.status === "closed");

    expect(activeIssue).toBeDefined();
    expect(archivedIssue).toBeDefined();
  });
});
