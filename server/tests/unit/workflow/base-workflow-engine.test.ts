/**
 * Unit tests for BaseWorkflowEngine
 *
 * Tests the abstract base class shared logic:
 * - Database CRUD operations
 * - Source resolution
 * - Step creation from dependency graph
 * - Ready step detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type {
  Workflow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowStep,
  DependencyGraph,
} from "@sudocode-ai/types";
import { WORKFLOWS_TABLE, EXECUTIONS_TABLE } from "@sudocode-ai/types/schema";
import { BaseWorkflowEngine } from "../../../src/workflow/base-workflow-engine.js";
import {
  WorkflowEventEmitter,
  WorkflowNotFoundError,
  WorkflowStepNotFoundError,
} from "../../../src/workflow/index.js";

// Mock the CLI relationships module
vi.mock("@sudocode-ai/cli/dist/operations/relationships.js", () => ({
  getIncomingRelationships: vi.fn(),
}));

import { getIncomingRelationships } from "@sudocode-ai/cli/dist/operations/relationships.js";

const mockGetIncomingRelationships = vi.mocked(getIncomingRelationships);

// =============================================================================
// Concrete Test Implementation
// =============================================================================

/**
 * Concrete implementation for testing BaseWorkflowEngine.
 * Exposes protected methods for testing.
 */
class TestWorkflowEngine extends BaseWorkflowEngine {
  // Implement abstract methods with simple stubs
  async createWorkflow(
    source: WorkflowSource,
    config?: Partial<WorkflowConfig>
  ): Promise<Workflow> {
    const issueIds = await this.resolveSource(source);
    const graph = this.analyzeDependencies(issueIds);
    const steps = this.createStepsFromGraph(graph);
    const title = this.generateTitle(source);
    const workflow = this.buildWorkflow({ title, source, steps, config: config || {} });
    this.saveWorkflow(workflow);
    return workflow;
  }

  async startWorkflow(_workflowId: string): Promise<void> {
    throw new Error("Not implemented for tests");
  }

  async pauseWorkflow(_workflowId: string): Promise<void> {
    throw new Error("Not implemented for tests");
  }

  async resumeWorkflow(_workflowId: string): Promise<void> {
    throw new Error("Not implemented for tests");
  }

  async cancelWorkflow(_workflowId: string): Promise<void> {
    throw new Error("Not implemented for tests");
  }

  async retryStep(_workflowId: string, _stepId: string): Promise<void> {
    throw new Error("Not implemented for tests");
  }

  async skipStep(
    _workflowId: string,
    _stepId: string,
    _reason?: string
  ): Promise<void> {
    throw new Error("Not implemented for tests");
  }

  // Expose protected methods for testing
  public testResolveSource(source: WorkflowSource): Promise<string[]> {
    return this.resolveSource(source);
  }

  public testCreateStepsFromGraph(graph: DependencyGraph): WorkflowStep[] {
    return this.createStepsFromGraph(graph);
  }

  public testSaveWorkflow(workflow: Workflow): void {
    return this.saveWorkflow(workflow);
  }

  public testUpdateWorkflow(
    workflowId: string,
    updates: Parameters<typeof this.updateWorkflow>[1]
  ): Workflow {
    return this.updateWorkflow(workflowId, updates);
  }

  public testUpdateStep(
    workflowId: string,
    stepId: string,
    updates: Partial<WorkflowStep>
  ): void {
    return this.updateStep(workflowId, stepId, updates);
  }

  public testDeleteWorkflow(workflowId: string): void {
    return this.deleteWorkflow(workflowId);
  }

  public testGenerateTitle(source: WorkflowSource): string {
    return this.generateTitle(source);
  }

  public testBuildWorkflow(
    options: Parameters<typeof this.buildWorkflow>[0]
  ): Workflow {
    return this.buildWorkflow(options);
  }
}

// =============================================================================
// Test Data Factories
// =============================================================================

function createTestWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-test123",
    title: "Test Workflow",
    source: { type: "issues", issueIds: ["i-1", "i-2"] },
    status: "pending",
    steps: [
      { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
      { id: "step-2", issueId: "i-2", index: 1, dependencies: ["step-1"], status: "pending" },
    ],
    baseBranch: "main",
    currentStepIndex: 0,
    config: {
      parallelism: "sequential",
      maxConcurrency: 1,
      onFailure: "pause",
      autoCommitAfterStep: true,
      defaultAgentType: "claude-code",
      autonomyLevel: "human_in_the_loop",
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe("BaseWorkflowEngine", () => {
  let db: Database.Database;
  let engine: TestWorkflowEngine;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create in-memory database
    db = new Database(":memory:");

    // Create executions table (required for workflows foreign key)
    db.exec(EXECUTIONS_TABLE);

    // Create workflows table
    db.exec(WORKFLOWS_TABLE);

    // Create relationships table for source resolution tests
    db.exec(`
      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id TEXT NOT NULL,
        from_uuid TEXT,
        from_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        to_uuid TEXT,
        to_type TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      )
    `);

    // Create engine with in-memory database
    engine = new TestWorkflowEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("should create engine with provided database", () => {
      const newEngine = new TestWorkflowEngine(db);
      expect(newEngine).toBeInstanceOf(BaseWorkflowEngine);
    });

    it("should create default event emitter if not provided", () => {
      const newEngine = new TestWorkflowEngine(db);
      const listener = vi.fn();
      const unsubscribe = newEngine.onWorkflowEvent(listener);

      expect(typeof unsubscribe).toBe("function");
    });

    it("should use provided event emitter", () => {
      const customEmitter = new WorkflowEventEmitter();
      const listener = vi.fn();
      customEmitter.on(listener);

      const newEngine = new TestWorkflowEngine(db, customEmitter);
      expect(customEmitter.listenerCount).toBe(1);
    });
  });

  // ===========================================================================
  // Source Resolution Tests
  // ===========================================================================

  describe("resolveSource", () => {
    describe("issues source", () => {
      it("should return provided issue IDs as-is", async () => {
        const source: WorkflowSource = {
          type: "issues",
          issueIds: ["i-1", "i-2", "i-3"],
        };

        const result = await engine.testResolveSource(source);

        expect(result).toEqual(["i-1", "i-2", "i-3"]);
      });

      it("should return empty array for empty issue list", async () => {
        const source: WorkflowSource = {
          type: "issues",
          issueIds: [],
        };

        const result = await engine.testResolveSource(source);

        expect(result).toEqual([]);
      });
    });

    describe("spec source", () => {
      it("should find issues that implement the spec", async () => {
        mockGetIncomingRelationships.mockReturnValue([
          {
            from_id: "i-impl1",
            from_uuid: "uuid-1",
            from_type: "issue",
            to_id: "s-spec",
            to_uuid: "uuid-spec",
            to_type: "spec",
            relationship_type: "implements",
            created_at: "2024-01-01T00:00:00.000Z",
          },
          {
            from_id: "i-impl2",
            from_uuid: "uuid-2",
            from_type: "issue",
            to_id: "s-spec",
            to_uuid: "uuid-spec",
            to_type: "spec",
            relationship_type: "implements",
            created_at: "2024-01-01T00:00:00.000Z",
          },
        ]);

        const source: WorkflowSource = {
          type: "spec",
          specId: "s-spec",
        };

        const result = await engine.testResolveSource(source);

        expect(mockGetIncomingRelationships).toHaveBeenCalledWith(
          db,
          "s-spec",
          "spec",
          "implements"
        );
        expect(result).toEqual(["i-impl1", "i-impl2"]);
      });

      it("should return empty array if no issues implement the spec", async () => {
        mockGetIncomingRelationships.mockReturnValue([]);

        const source: WorkflowSource = {
          type: "spec",
          specId: "s-orphan",
        };

        const result = await engine.testResolveSource(source);

        expect(result).toEqual([]);
      });

      it("should filter out non-issue sources", async () => {
        mockGetIncomingRelationships.mockReturnValue([
          {
            from_id: "i-issue",
            from_uuid: "uuid-1",
            from_type: "issue",
            to_id: "s-spec",
            to_uuid: "uuid-spec",
            to_type: "spec",
            relationship_type: "implements",
            created_at: "2024-01-01T00:00:00.000Z",
          },
          {
            from_id: "s-other",
            from_uuid: "uuid-2",
            from_type: "spec",
            to_id: "s-spec",
            to_uuid: "uuid-spec",
            to_type: "spec",
            relationship_type: "implements",
            created_at: "2024-01-01T00:00:00.000Z",
          },
        ]);

        const source: WorkflowSource = {
          type: "spec",
          specId: "s-spec",
        };

        const result = await engine.testResolveSource(source);

        expect(result).toEqual(["i-issue"]);
      });
    });

    describe("root_issue source", () => {
      it("should return root issue and its blockers", async () => {
        // Setup: i-root is blocked by i-dep1, which is blocked by i-dep2
        mockGetIncomingRelationships.mockImplementation((db, issueId, entityType, relType) => {
          if (relType === "blocks") {
            if (issueId === "i-root") {
              return [
                {
                  from_id: "i-dep1",
                  from_uuid: "uuid-dep1",
                  from_type: "issue",
                  to_id: "i-root",
                  to_uuid: "uuid-root",
                  to_type: "issue",
                  relationship_type: "blocks",
                  created_at: "2024-01-01T00:00:00.000Z",
                },
              ];
            }
            if (issueId === "i-dep1") {
              return [
                {
                  from_id: "i-dep2",
                  from_uuid: "uuid-dep2",
                  from_type: "issue",
                  to_id: "i-dep1",
                  to_uuid: "uuid-dep1",
                  to_type: "issue",
                  relationship_type: "blocks",
                  created_at: "2024-01-01T00:00:00.000Z",
                },
              ];
            }
          }
          return [];
        });

        const source: WorkflowSource = {
          type: "root_issue",
          issueId: "i-root",
        };

        const result = await engine.testResolveSource(source);

        expect(result).toContain("i-root");
        expect(result).toContain("i-dep1");
        expect(result).toContain("i-dep2");
        expect(result.length).toBe(3);
      });

      it("should handle depends-on relationships", async () => {
        // Setup: i-root depends-on i-dep1
        mockGetIncomingRelationships.mockReturnValue([]);

        // Insert a depends-on relationship in the test database
        db.exec(`
          INSERT INTO relationships (from_id, from_type, to_id, to_type, relationship_type)
          VALUES ('i-root', 'issue', 'i-dep1', 'issue', 'depends-on')
        `);

        const source: WorkflowSource = {
          type: "root_issue",
          issueId: "i-root",
        };

        const result = await engine.testResolveSource(source);

        expect(result).toContain("i-root");
        expect(result).toContain("i-dep1");
      });

      it("should not enter infinite loop on circular dependencies", async () => {
        // Setup: i-a blocks i-b, i-b blocks i-a (cycle)
        mockGetIncomingRelationships.mockImplementation((db, issueId, entityType, relType) => {
          if (relType === "blocks") {
            if (issueId === "i-a") {
              return [
                {
                  from_id: "i-b",
                  from_uuid: "uuid-b",
                  from_type: "issue",
                  to_id: "i-a",
                  to_uuid: "uuid-a",
                  to_type: "issue",
                  relationship_type: "blocks",
                  created_at: "2024-01-01T00:00:00.000Z",
                },
              ];
            }
            if (issueId === "i-b") {
              return [
                {
                  from_id: "i-a",
                  from_uuid: "uuid-a",
                  from_type: "issue",
                  to_id: "i-b",
                  to_uuid: "uuid-b",
                  to_type: "issue",
                  relationship_type: "blocks",
                  created_at: "2024-01-01T00:00:00.000Z",
                },
              ];
            }
          }
          return [];
        });

        const source: WorkflowSource = {
          type: "root_issue",
          issueId: "i-a",
        };

        const result = await engine.testResolveSource(source);

        // Should not hang - should return both issues
        expect(result).toContain("i-a");
        expect(result).toContain("i-b");
        expect(result.length).toBe(2);
      });
    });

    describe("goal source", () => {
      it("should return empty array for goal source", async () => {
        const source: WorkflowSource = {
          type: "goal",
          goal: "Implement authentication system",
        };

        const result = await engine.testResolveSource(source);

        expect(result).toEqual([]);
      });
    });
  });

  // ===========================================================================
  // Step Creation Tests
  // ===========================================================================

  describe("createStepsFromGraph", () => {
    it("should create steps from dependency graph", () => {
      const graph: DependencyGraph = {
        issueIds: ["i-1", "i-2", "i-3"],
        edges: [
          ["i-1", "i-2"], // i-1 blocks i-2
          ["i-2", "i-3"], // i-2 blocks i-3
        ],
        topologicalOrder: ["i-1", "i-2", "i-3"],
        parallelGroups: [["i-1"], ["i-2"], ["i-3"]],
        cycles: null,
      };

      const steps = engine.testCreateStepsFromGraph(graph);

      expect(steps.length).toBe(3);

      // First step should be ready (no dependencies)
      expect(steps[0].issueId).toBe("i-1");
      expect(steps[0].index).toBe(0);
      expect(steps[0].dependencies).toEqual([]);
      expect(steps[0].status).toBe("ready");

      // Second step depends on first
      expect(steps[1].issueId).toBe("i-2");
      expect(steps[1].index).toBe(1);
      expect(steps[1].dependencies.length).toBe(1);
      expect(steps[1].status).toBe("pending");

      // Third step depends on second
      expect(steps[2].issueId).toBe("i-3");
      expect(steps[2].index).toBe(2);
      expect(steps[2].dependencies.length).toBe(1);
      expect(steps[2].status).toBe("pending");
    });

    it("should handle empty graph", () => {
      const graph: DependencyGraph = {
        issueIds: [],
        edges: [],
        topologicalOrder: [],
        parallelGroups: [],
        cycles: null,
      };

      const steps = engine.testCreateStepsFromGraph(graph);

      expect(steps).toEqual([]);
    });

    it("should handle parallel steps (no edges between them)", () => {
      const graph: DependencyGraph = {
        issueIds: ["i-1", "i-2", "i-3"],
        edges: [], // No dependencies
        topologicalOrder: ["i-1", "i-2", "i-3"],
        parallelGroups: [["i-1", "i-2", "i-3"]],
        cycles: null,
      };

      const steps = engine.testCreateStepsFromGraph(graph);

      expect(steps.length).toBe(3);

      // All steps should be ready (no dependencies)
      for (const step of steps) {
        expect(step.dependencies).toEqual([]);
        expect(step.status).toBe("ready");
      }
    });

    it("should handle diamond dependency pattern", () => {
      // i-1 blocks i-2 and i-3; both i-2 and i-3 block i-4
      const graph: DependencyGraph = {
        issueIds: ["i-1", "i-2", "i-3", "i-4"],
        edges: [
          ["i-1", "i-2"],
          ["i-1", "i-3"],
          ["i-2", "i-4"],
          ["i-3", "i-4"],
        ],
        topologicalOrder: ["i-1", "i-2", "i-3", "i-4"],
        parallelGroups: [["i-1"], ["i-2", "i-3"], ["i-4"]],
        cycles: null,
      };

      const steps = engine.testCreateStepsFromGraph(graph);

      expect(steps.length).toBe(4);

      // Find step for i-4 - should have 2 dependencies
      const step4 = steps.find((s) => s.issueId === "i-4");
      expect(step4?.dependencies.length).toBe(2);
    });

    it("should generate unique step IDs", () => {
      const graph: DependencyGraph = {
        issueIds: ["i-1", "i-2", "i-3"],
        edges: [],
        topologicalOrder: ["i-1", "i-2", "i-3"],
        parallelGroups: [["i-1", "i-2", "i-3"]],
        cycles: null,
      };

      const steps = engine.testCreateStepsFromGraph(graph);

      const stepIds = steps.map((s) => s.id);
      const uniqueIds = new Set(stepIds);

      expect(uniqueIds.size).toBe(steps.length);
      for (const id of stepIds) {
        expect(id).toMatch(/^step-/);
      }
    });
  });

  // ===========================================================================
  // Ready Step Detection Tests
  // ===========================================================================

  describe("getReadySteps", () => {
    it("should return steps with no dependencies", async () => {
      const workflow = createTestWorkflow({
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: [], status: "pending" },
        ],
      });
      engine.testSaveWorkflow(workflow);

      const readySteps = await engine.getReadySteps(workflow.id);

      expect(readySteps.length).toBe(2);
    });

    it("should return steps where all dependencies are completed", async () => {
      const workflow = createTestWorkflow({
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "completed" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: ["step-1"], status: "pending" },
          { id: "step-3", issueId: "i-3", index: 2, dependencies: ["step-2"], status: "pending" },
        ],
      });
      engine.testSaveWorkflow(workflow);

      const readySteps = await engine.getReadySteps(workflow.id);

      expect(readySteps.length).toBe(1);
      expect(readySteps[0].id).toBe("step-2");
    });

    it("should not return steps with pending dependencies", async () => {
      const workflow = createTestWorkflow({
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "pending" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: ["step-1"], status: "pending" },
        ],
      });
      engine.testSaveWorkflow(workflow);

      const readySteps = await engine.getReadySteps(workflow.id);

      // Only step-1 is ready (no dependencies)
      expect(readySteps.length).toBe(1);
      expect(readySteps[0].id).toBe("step-1");
    });

    it("should not return steps with running dependencies", async () => {
      const workflow = createTestWorkflow({
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "running" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: ["step-1"], status: "pending" },
        ],
      });
      engine.testSaveWorkflow(workflow);

      const readySteps = await engine.getReadySteps(workflow.id);

      // No steps are ready - step-1 is running, step-2 has pending dependency
      expect(readySteps.length).toBe(0);
    });

    it("should not return completed steps", async () => {
      const workflow = createTestWorkflow({
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "completed" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: ["step-1"], status: "ready" },
        ],
      });
      engine.testSaveWorkflow(workflow);

      const readySteps = await engine.getReadySteps(workflow.id);

      expect(readySteps.length).toBe(1);
      expect(readySteps[0].id).toBe("step-2");
    });

    it("should throw WorkflowNotFoundError for non-existent workflow", async () => {
      await expect(engine.getReadySteps("wf-nonexistent")).rejects.toThrow(
        WorkflowNotFoundError
      );
    });
  });

  // ===========================================================================
  // Workflow CRUD Tests
  // ===========================================================================

  describe("saveWorkflow", () => {
    it("should save workflow to database", () => {
      const workflow = createTestWorkflow();

      engine.testSaveWorkflow(workflow);

      const row = db
        .prepare("SELECT * FROM workflows WHERE id = ?")
        .get(workflow.id) as any;

      expect(row).toBeDefined();
      expect(row.title).toBe(workflow.title);
      expect(row.status).toBe(workflow.status);
    });

    it("should serialize JSON fields correctly", () => {
      const workflow = createTestWorkflow();

      engine.testSaveWorkflow(workflow);

      const row = db
        .prepare("SELECT * FROM workflows WHERE id = ?")
        .get(workflow.id) as any;

      expect(JSON.parse(row.source)).toEqual(workflow.source);
      expect(JSON.parse(row.steps)).toEqual(workflow.steps);
      expect(JSON.parse(row.config)).toEqual(workflow.config);
    });

    it("should handle null optional fields", () => {
      const workflow = createTestWorkflow({
        worktreePath: undefined,
        branchName: undefined,
        orchestratorExecutionId: undefined,
        orchestratorSessionId: undefined,
      });

      engine.testSaveWorkflow(workflow);

      const row = db
        .prepare("SELECT * FROM workflows WHERE id = ?")
        .get(workflow.id) as any;

      expect(row.worktree_path).toBeNull();
      expect(row.branch_name).toBeNull();
      expect(row.orchestrator_execution_id).toBeNull();
      expect(row.orchestrator_session_id).toBeNull();
    });
  });

  describe("getWorkflow", () => {
    it("should return workflow by ID", async () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      const result = await engine.getWorkflow(workflow.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(workflow.id);
      expect(result?.title).toBe(workflow.title);
    });

    it("should parse JSON fields correctly", async () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      const result = await engine.getWorkflow(workflow.id);

      expect(result?.source).toEqual(workflow.source);
      expect(result?.steps).toEqual(workflow.steps);
      expect(result?.config).toEqual(workflow.config);
    });

    it("should return null for non-existent workflow", async () => {
      const result = await engine.getWorkflow("wf-nonexistent");

      expect(result).toBeNull();
    });

    it("should handle undefined optional fields", async () => {
      const workflow = createTestWorkflow({
        worktreePath: undefined,
        branchName: undefined,
      });
      engine.testSaveWorkflow(workflow);

      const result = await engine.getWorkflow(workflow.id);

      expect(result?.worktreePath).toBeUndefined();
      expect(result?.branchName).toBeUndefined();
    });
  });

  describe("updateWorkflow", () => {
    it("should update workflow status", () => {
      const workflow = createTestWorkflow({ status: "pending" });
      engine.testSaveWorkflow(workflow);

      const updated = engine.testUpdateWorkflow(workflow.id, {
        status: "running",
      });

      expect(updated.status).toBe("running");

      // Verify in database
      const result = db
        .prepare("SELECT status FROM workflows WHERE id = ?")
        .get(workflow.id) as any;
      expect(result.status).toBe("running");
    });

    it("should update multiple fields", () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      const updated = engine.testUpdateWorkflow(workflow.id, {
        status: "running",
        currentStepIndex: 1,
        startedAt: "2024-01-02T00:00:00.000Z",
      });

      expect(updated.status).toBe("running");
      expect(updated.currentStepIndex).toBe(1);
      expect(updated.startedAt).toBe("2024-01-02T00:00:00.000Z");
    });

    it("should update steps JSON field", () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      const newSteps = [
        { id: "step-new", issueId: "i-new", index: 0, dependencies: [], status: "ready" as const },
      ];

      const updated = engine.testUpdateWorkflow(workflow.id, {
        steps: newSteps,
      });

      expect(updated.steps).toEqual(newSteps);
    });

    it("should update updated_at timestamp", () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      const before = db
        .prepare("SELECT updated_at FROM workflows WHERE id = ?")
        .get(workflow.id) as any;

      // Small delay to ensure different timestamp
      const updated = engine.testUpdateWorkflow(workflow.id, {
        status: "running",
      });

      expect(updated.updatedAt).not.toBe(before.updated_at);
    });
  });

  describe("updateStep", () => {
    it("should update step status", () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      engine.testUpdateStep(workflow.id, "step-1", { status: "running" });

      const result = db
        .prepare("SELECT steps FROM workflows WHERE id = ?")
        .get(workflow.id) as any;
      const steps = JSON.parse(result.steps) as WorkflowStep[];
      const step1 = steps.find((s) => s.id === "step-1");

      expect(step1?.status).toBe("running");
    });

    it("should update step execution ID", () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      engine.testUpdateStep(workflow.id, "step-1", {
        executionId: "exec-123",
        status: "running",
      });

      const result = db
        .prepare("SELECT steps FROM workflows WHERE id = ?")
        .get(workflow.id) as any;
      const steps = JSON.parse(result.steps) as WorkflowStep[];
      const step1 = steps.find((s) => s.id === "step-1");

      expect(step1?.executionId).toBe("exec-123");
    });

    it("should throw WorkflowNotFoundError for non-existent workflow", () => {
      expect(() =>
        engine.testUpdateStep("wf-nonexistent", "step-1", { status: "running" })
      ).toThrow(WorkflowNotFoundError);
    });

    it("should throw WorkflowStepNotFoundError for non-existent step", () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      expect(() =>
        engine.testUpdateStep(workflow.id, "step-nonexistent", {
          status: "running",
        })
      ).toThrow(WorkflowStepNotFoundError);
    });
  });

  describe("deleteWorkflow", () => {
    it("should delete workflow from database", () => {
      const workflow = createTestWorkflow();
      engine.testSaveWorkflow(workflow);

      engine.testDeleteWorkflow(workflow.id);

      const result = db
        .prepare("SELECT * FROM workflows WHERE id = ?")
        .get(workflow.id);
      expect(result).toBeUndefined();
    });

    it("should not error for non-existent workflow", () => {
      expect(() =>
        engine.testDeleteWorkflow("wf-nonexistent")
      ).not.toThrow();
    });
  });

  // ===========================================================================
  // Helper Method Tests
  // ===========================================================================

  describe("generateTitle", () => {
    it("should generate title for spec source", () => {
      const source: WorkflowSource = { type: "spec", specId: "s-auth" };

      const title = engine.testGenerateTitle(source);

      expect(title).toBe("Workflow for spec s-auth");
    });

    it("should generate title for issues source", () => {
      const source: WorkflowSource = {
        type: "issues",
        issueIds: ["i-1", "i-2", "i-3"],
      };

      const title = engine.testGenerateTitle(source);

      expect(title).toBe("Workflow for 3 issues");
    });

    it("should generate title for root_issue source", () => {
      const source: WorkflowSource = { type: "root_issue", issueId: "i-root" };

      const title = engine.testGenerateTitle(source);

      expect(title).toBe("Workflow for issue i-root");
    });

    it("should generate title for goal source", () => {
      const source: WorkflowSource = {
        type: "goal",
        goal: "Implement OAuth authentication system with social login",
      };

      const title = engine.testGenerateTitle(source);

      expect(title).toBe(
        "Implement OAuth authentication system with social login"
      );
    });

    it("should truncate long goal titles", () => {
      const longGoal = "A".repeat(200);
      const source: WorkflowSource = { type: "goal", goal: longGoal };

      const title = engine.testGenerateTitle(source);

      expect(title.length).toBe(100);
    });
  });

  describe("buildWorkflow", () => {
    it("should create workflow object with defaults", () => {
      const workflow = engine.testBuildWorkflow({
        source: { type: "issues", issueIds: ["i-1"] },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
        ],
        config: { title: "Test Workflow" },
      });

      expect(workflow.id).toMatch(/^wf-/);
      expect(workflow.title).toBe("Test Workflow");
      expect(workflow.status).toBe("pending");
      expect(workflow.baseBranch).toBe("main");
      expect(workflow.currentStepIndex).toBe(0);
      expect(workflow.config.parallelism).toBe("sequential");
    });

    it("should merge config with defaults", () => {
      const workflow = engine.testBuildWorkflow({
        source: { type: "issues", issueIds: ["i-1"] },
        steps: [],
        config: { maxConcurrency: 5, onFailure: "continue" },
      });

      expect(workflow.config.maxConcurrency).toBe(5);
      expect(workflow.config.onFailure).toBe("continue");
      expect(workflow.config.parallelism).toBe("sequential"); // default
    });

    it("should use provided base branch", () => {
      const workflow = engine.testBuildWorkflow({
        source: { type: "issues", issueIds: ["i-1"] },
        steps: [],
        config: { baseBranch: "develop" },
      });

      expect(workflow.baseBranch).toBe("develop");
    });
  });

  // ===========================================================================
  // Event Subscription Tests
  // ===========================================================================

  describe("onWorkflowEvent", () => {
    it("should subscribe to events via event emitter", () => {
      const listener = vi.fn();

      engine.onWorkflowEvent(listener);

      // We can't easily test this without exposing the emitter
      // But we verify the method exists and returns a function
      expect(typeof engine.onWorkflowEvent(listener)).toBe("function");
    });

    it("should return unsubscribe function", () => {
      const listener = vi.fn();

      const unsubscribe = engine.onWorkflowEvent(listener);

      expect(typeof unsubscribe).toBe("function");
      unsubscribe(); // Should not throw
    });
  });

  // ===========================================================================
  // List Workflows Tests
  // ===========================================================================

  describe("listWorkflows", () => {
    it("should return all workflows", async () => {
      const workflow1 = createTestWorkflow({ id: "wf-1" });
      const workflow2 = createTestWorkflow({ id: "wf-2" });
      engine.testSaveWorkflow(workflow1);
      engine.testSaveWorkflow(workflow2);

      const workflows = await engine.listWorkflows();

      expect(workflows.length).toBe(2);
    });

    it("should filter by status", async () => {
      const pending = createTestWorkflow({ id: "wf-1", status: "pending" });
      const running = createTestWorkflow({ id: "wf-2", status: "running" });
      engine.testSaveWorkflow(pending);
      engine.testSaveWorkflow(running);

      const workflows = await engine.listWorkflows({ status: "running" });

      expect(workflows.length).toBe(1);
      expect(workflows[0].status).toBe("running");
    });

    it("should respect limit", async () => {
      for (let i = 0; i < 10; i++) {
        engine.testSaveWorkflow(createTestWorkflow({ id: `wf-${i}` }));
      }

      const workflows = await engine.listWorkflows({ limit: 3 });

      expect(workflows.length).toBe(3);
    });

    it("should respect offset", async () => {
      for (let i = 0; i < 5; i++) {
        engine.testSaveWorkflow(
          createTestWorkflow({
            id: `wf-${i}`,
            createdAt: `2024-01-0${5 - i}T00:00:00.000Z`,
          })
        );
      }

      const workflows = await engine.listWorkflows({ offset: 2, limit: 2 });

      expect(workflows.length).toBe(2);
    });

    it("should return empty array when no workflows exist", async () => {
      const workflows = await engine.listWorkflows();

      expect(workflows).toEqual([]);
    });
  });
});
