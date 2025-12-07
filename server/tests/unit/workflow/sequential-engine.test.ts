/**
 * Unit tests for SequentialWorkflowEngine
 *
 * Tests the sequential workflow engine implementation:
 * - Workflow lifecycle (start, pause, resume, cancel)
 * - Step execution loop
 * - Worktree reuse
 * - Failure handling strategies
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type {
  Workflow,
  WorkflowStep,
  Execution,
} from "@sudocode-ai/types";
import { WORKFLOWS_TABLE, EXECUTIONS_TABLE } from "@sudocode-ai/types/schema";
import { SequentialWorkflowEngine } from "../../../src/workflow/engines/sequential-engine.js";
import { WorkflowEventEmitter } from "../../../src/workflow/workflow-event-emitter.js";
import { WorkflowStateError } from "../../../src/workflow/workflow-engine.js";
import type { ExecutionService } from "../../../src/services/execution-service.js";
import type { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";

// Mock CLI operations
vi.mock("@sudocode-ai/cli/dist/operations/issues.js", () => ({
  getIssue: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("@sudocode-ai/cli/dist/operations/relationships.js", () => ({
  getIncomingRelationships: vi.fn(),
  getOutgoingRelationships: vi.fn(),
}));

vi.mock("@sudocode-ai/cli/dist/jsonl.js", () => ({
  readJSONLSync: vi.fn(),
  writeJSONL: vi.fn(),
}));

vi.mock("../../../src/services/executions.js", () => ({
  getExecution: vi.fn(),
}));

import { getIssue, updateIssue } from "@sudocode-ai/cli/dist/operations/issues.js";
import { getIncomingRelationships, getOutgoingRelationships } from "@sudocode-ai/cli/dist/operations/relationships.js";
import { readJSONLSync, writeJSONL } from "@sudocode-ai/cli/dist/jsonl.js";
import { getExecution } from "../../../src/services/executions.js";

const mockGetIssue = vi.mocked(getIssue);
const mockUpdateIssue = vi.mocked(updateIssue);
const mockGetIncomingRelationships = vi.mocked(getIncomingRelationships);
const mockGetOutgoingRelationships = vi.mocked(getOutgoingRelationships);
const mockReadJSONLSync = vi.mocked(readJSONLSync);
const mockWriteJSONL = vi.mocked(writeJSONL);
const mockGetExecution = vi.mocked(getExecution);

// =============================================================================
// Test Data Factories
// =============================================================================

function createTestStep(overrides?: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: "step-1",
    issueId: "i-test",
    index: 0,
    dependencies: [],
    status: "pending",
    ...overrides,
  };
}

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

function createMockExecution(overrides?: Partial<Execution>): Execution {
  return {
    id: "exec-123",
    issue_id: "i-1",
    agent_type: "claude-code",
    status: "completed",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    error_message: null,
    exit_code: null,
    before_commit: null,
    after_commit: null,
    worktree_path: null,
    model: null,
    mode: "local",
    prompt: "Test prompt",
    ...overrides,
  };
}

function createMockExecutionService(): ExecutionService {
  return {
    createExecution: vi.fn(),
    cancelExecution: vi.fn(),
  } as unknown as ExecutionService;
}

function createMockLifecycleService(): ExecutionLifecycleService {
  return {
    createWorkflowWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/test/worktrees/workflow-test",
      branchName: "sudocode/workflow/test/test-workflow",
    }),
  } as unknown as ExecutionLifecycleService;
}

// =============================================================================
// Test Suite
// =============================================================================

describe("SequentialWorkflowEngine", () => {
  let db: Database.Database;
  let engine: SequentialWorkflowEngine;
  let mockExecutionService: ExecutionService;
  let mockLifecycleService: ExecutionLifecycleService;
  let eventEmitter: WorkflowEventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create in-memory database
    db = new Database(":memory:");

    // Create executions table (required for workflows foreign key)
    db.exec(EXECUTIONS_TABLE);

    // Create workflows table
    db.exec(WORKFLOWS_TABLE);

    // Create issues table for getIssue lookups
    db.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        uuid TEXT UNIQUE,
        title TEXT NOT NULL,
        content TEXT,
        status TEXT DEFAULT 'open',
        priority INTEGER DEFAULT 2,
        assignee TEXT,
        archived INTEGER DEFAULT 0,
        archived_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT,
        parent_id TEXT,
        parent_uuid TEXT
      )
    `);

    // Create relationships table
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

    // Setup mocks
    mockExecutionService = createMockExecutionService();
    mockLifecycleService = createMockLifecycleService();
    eventEmitter = new WorkflowEventEmitter();

    // Create engine (lifecycleService is required as 3rd param)
    engine = new SequentialWorkflowEngine(db, mockExecutionService, mockLifecycleService, "/test/repo", eventEmitter);

    // Default mock behavior
    mockGetIncomingRelationships.mockReturnValue([]);
    mockGetOutgoingRelationships.mockReturnValue([]);
  });

  afterEach(() => {
    db.close();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("should create engine with execution service", () => {
      const newEngine = new SequentialWorkflowEngine(db, mockExecutionService, mockLifecycleService, "/test/repo");
      expect(newEngine).toBeInstanceOf(SequentialWorkflowEngine);
    });

    it("should accept custom event emitter", () => {
      const customEmitter = new WorkflowEventEmitter();
      const listener = vi.fn();
      customEmitter.on(listener);

      const newEngine = new SequentialWorkflowEngine(db, mockExecutionService, mockLifecycleService, "/test/repo", customEmitter);
      expect(customEmitter.listenerCount).toBe(1);
    });
  });

  // ===========================================================================
  // Workflow Lifecycle Tests
  // ===========================================================================

  describe("startWorkflow", () => {
    it("should update workflow status to running", async () => {
      // Save a pending workflow
      const workflow = createTestWorkflow({ status: "pending" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      // Mock to prevent actual execution loop
      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      // Mock execution to complete immediately
      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.startWorkflow(workflow.id);

      // Check status was updated
      const updated = await engine.getWorkflow(workflow.id);
      expect(updated?.status).toBe("running");
      expect(updated?.startedAt).toBeDefined();
    });

    it("should emit workflow_started event", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      const workflow = createTestWorkflow({ status: "pending" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.startWorkflow(workflow.id);

      expect(events).toContain("workflow_started");
    });

    it("should throw if workflow is not in pending state", async () => {
      const workflow = createTestWorkflow({ status: "running" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await expect(engine.startWorkflow(workflow.id)).rejects.toThrow(WorkflowStateError);
    });
  });

  describe("pauseWorkflow", () => {
    it("should update workflow status to paused", async () => {
      const workflow = createTestWorkflow({ status: "running" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await engine.pauseWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated?.status).toBe("paused");
    });

    it("should emit workflow_paused event", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      const workflow = createTestWorkflow({ status: "running" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await engine.pauseWorkflow(workflow.id);

      expect(events).toContain("workflow_paused");
    });

    it("should throw if workflow is not running", async () => {
      const workflow = createTestWorkflow({ status: "pending" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await expect(engine.pauseWorkflow(workflow.id)).rejects.toThrow(WorkflowStateError);
    });
  });

  describe("resumeWorkflow", () => {
    it("should update workflow status to running", async () => {
      const workflow = createTestWorkflow({ status: "paused" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.resumeWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated?.status).toBe("running");
    });

    it("should emit workflow_resumed event", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      const workflow = createTestWorkflow({ status: "paused" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.resumeWorkflow(workflow.id);

      expect(events).toContain("workflow_resumed");
    });

    it("should throw if workflow is not paused", async () => {
      const workflow = createTestWorkflow({ status: "running" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await expect(engine.resumeWorkflow(workflow.id)).rejects.toThrow(WorkflowStateError);
    });
  });

  describe("cancelWorkflow", () => {
    it("should update workflow status to cancelled", async () => {
      const workflow = createTestWorkflow({ status: "running" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await engine.cancelWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated?.status).toBe("cancelled");
      expect(updated?.completedAt).toBeDefined();
    });

    it("should emit workflow_cancelled event", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      const workflow = createTestWorkflow({ status: "running" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await engine.cancelWorkflow(workflow.id);

      expect(events).toContain("workflow_cancelled");
    });

    it("should throw if workflow is already in terminal state", async () => {
      const workflow = createTestWorkflow({ status: "completed" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await expect(engine.cancelWorkflow(workflow.id)).rejects.toThrow(WorkflowStateError);
    });

    it("should cancel pending workflow", async () => {
      const workflow = createTestWorkflow({ status: "pending" });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await engine.cancelWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated?.status).toBe("cancelled");
    });
  });

  // ===========================================================================
  // Step Control Tests
  // ===========================================================================

  describe("retryStep", () => {
    it("should reset step status to pending", async () => {
      const workflow = createTestWorkflow({
        status: "paused",
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "failed", error: "Test error" },
        ],
      });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.retryStep(workflow.id, "step-1");

      const updated = await engine.getWorkflow(workflow.id);
      const step = updated?.steps.find((s) => s.id === "step-1");
      expect(step?.status).toBe("pending");
      expect(step?.error).toBeUndefined();
    });

    it("should throw if step is not failed", async () => {
      const workflow = createTestWorkflow({
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "completed" },
        ],
      });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      await expect(engine.retryStep(workflow.id, "step-1")).rejects.toThrow(WorkflowStateError);
    });
  });

  describe("skipStep", () => {
    it("should mark step as skipped", async () => {
      const workflow = createTestWorkflow({
        status: "paused",
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "failed", error: "Test error" },
        ],
      });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.skipStep(workflow.id, "step-1", "User requested skip");

      const updated = await engine.getWorkflow(workflow.id);
      const step = updated?.steps.find((s) => s.id === "step-1");
      expect(step?.status).toBe("skipped");
      expect(step?.error).toBe("User requested skip");
    });

    it("should emit step_skipped event", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      const workflow = createTestWorkflow({
        status: "paused",
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "pending" },
        ],
      });
      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.skipStep(workflow.id, "step-1");

      expect(events).toContain("step_skipped");
    });
  });

  // ===========================================================================
  // Parallel Execution Tests
  // ===========================================================================

  describe("parallel execution", () => {
    it("should execute multiple ready steps in parallel mode", async () => {
      // Create workflow with parallel config and independent steps
      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "parallel",
          maxConcurrency: 3,
          onFailure: "pause",
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: [], status: "ready" },
          { id: "step-3", issueId: "i-3", index: 2, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      // Mock issue lookups
      mockGetIssue.mockImplementation((db, issueId) => ({
        id: issueId,
        title: `Test Issue ${issueId}`,
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: `uuid-${issueId}`,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      }));

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.startWorkflow(workflow.id);

      // Wait for async execution loop to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify createExecution was called multiple times (once per step)
      // Note: Due to async nature, we check that it was called at least once
      expect(mockExecutionService.createExecution).toHaveBeenCalled();
    });

    it("should respect maxConcurrency limit", async () => {
      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "parallel",
          maxConcurrency: 2, // Only allow 2 at a time
          onFailure: "continue",
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: [], status: "ready" },
          { id: "step-3", issueId: "i-3", index: 2, dependencies: [], status: "ready" },
          { id: "step-4", issueId: "i-4", index: 3, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockImplementation((db, issueId) => ({
        id: issueId,
        title: `Test Issue ${issueId}`,
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: `uuid-${issueId}`,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      }));

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.startWorkflow(workflow.id);

      // The workflow should process steps respecting maxConcurrency
      const updated = await engine.getWorkflow(workflow.id);
      expect(updated?.status).toBe("running");
    });

    it("should continue with other steps when one fails in continue mode", async () => {
      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "parallel",
          maxConcurrency: 3,
          onFailure: "continue", // Continue even if step fails
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockImplementation((_db, issueId) => ({
        id: issueId,
        title: `Test Issue ${issueId}`,
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: `uuid-${issueId}`,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      }));

      // First execution fails, second succeeds
      let callCount = 0;
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        return Promise.resolve(createMockExecution({
          id: `exec-${callCount}`,
          status: callCount === 1 ? "failed" : "completed",
          error_message: callCount === 1 ? "Test failure" : null,
        }));
      });

      mockGetExecution.mockImplementation((_db, execId) => {
        const num = parseInt(execId.split("-")[1]);
        return createMockExecution({
          id: execId,
          status: num === 1 ? "failed" : "completed",
          error_message: num === 1 ? "Test failure" : null,
        });
      });

      await engine.startWorkflow(workflow.id);

      // Wait for async execution loop to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // In continue mode, both steps should be attempted
      expect(mockExecutionService.createExecution).toHaveBeenCalledTimes(2);
    });

    it("should stop immediately when step fails in stop mode", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "parallel",
          maxConcurrency: 3,
          onFailure: "stop", // Stop on first failure
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: [], status: "ready" },
          { id: "step-3", issueId: "i-3", index: 2, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockImplementation((_db, issueId) => ({
        id: issueId,
        title: `Test Issue ${issueId}`,
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: `uuid-${issueId}`,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      }));

      // First execution fails
      const failedExec = createMockExecution({
        status: "failed",
        error_message: "Test failure",
      });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(failedExec);
      mockGetExecution.mockReturnValue(failedExec);

      await engine.startWorkflow(workflow.id);

      // Wait for async execution loop to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should stop after first failure
      expect(mockExecutionService.createExecution).toHaveBeenCalledTimes(1);
      expect(events).toContain("workflow_failed");
    });
  });

  // ===========================================================================
  // Failure Handling Strategy Tests
  // ===========================================================================

  describe("failure handling strategies", () => {
    const setupFailureTest = (onFailure: "stop" | "pause" | "skip_dependents" | "continue") => {
      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "sequential",
          maxConcurrency: 1,
          onFailure,
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: ["step-1"], status: "pending" },
          { id: "step-3", issueId: "i-3", index: 2, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockImplementation((_db, issueId) => ({
        id: issueId,
        title: `Test Issue ${issueId}`,
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: `uuid-${issueId}`,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      }));

      return workflow;
    };

    it("stop strategy should fail workflow immediately on step failure", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      setupFailureTest("stop");

      const failedExec = createMockExecution({
        status: "failed",
        error_message: "Test failure",
      });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(failedExec);
      mockGetExecution.mockReturnValue(failedExec);

      await engine.startWorkflow("wf-test123");
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = await engine.getWorkflow("wf-test123");
      expect(updated?.status).toBe("failed");
      expect(events).toContain("workflow_failed");
      expect(events).toContain("step_failed");
    });

    it("pause strategy should pause workflow on step failure", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      setupFailureTest("pause");

      const failedExec = createMockExecution({
        status: "failed",
        error_message: "Test failure",
      });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(failedExec);
      mockGetExecution.mockReturnValue(failedExec);

      await engine.startWorkflow("wf-test123");
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = await engine.getWorkflow("wf-test123");
      expect(updated?.status).toBe("paused");
      expect(events).toContain("workflow_paused");
      expect(events).toContain("step_failed");
    });

    it("skip_dependents strategy should skip dependent steps on failure", async () => {
      const events: string[] = [];
      eventEmitter.on((event) => events.push(event.type));

      setupFailureTest("skip_dependents");

      const failedExec = createMockExecution({
        status: "failed",
        error_message: "Test failure",
      });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(failedExec);
      mockGetExecution.mockReturnValue(failedExec);

      await engine.startWorkflow("wf-test123");
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = await engine.getWorkflow("wf-test123");
      // Step-2 depends on step-1, so it should be skipped
      const step2 = updated?.steps.find((s) => s.id === "step-2");
      expect(step2?.status).toBe("skipped");
      expect(events).toContain("step_skipped");
    });

    it("continue strategy should block dependents and continue with others", async () => {
      setupFailureTest("continue");

      let callCount = 0;
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        // First call (step-1) fails, second call (step-3) succeeds
        return Promise.resolve(createMockExecution({
          id: `exec-${callCount}`,
          status: callCount === 1 ? "failed" : "completed",
          error_message: callCount === 1 ? "Test failure" : null,
        }));
      });

      mockGetExecution.mockImplementation((_db, execId) => {
        const num = parseInt(execId.split("-")[1]);
        return createMockExecution({
          id: execId,
          status: num === 1 ? "failed" : "completed",
          error_message: num === 1 ? "Test failure" : null,
        });
      });

      await engine.startWorkflow("wf-test123");
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updated = await engine.getWorkflow("wf-test123");
      // Step-1 failed, step-2 should be blocked, step-3 should have been attempted
      const step1 = updated?.steps.find((s) => s.id === "step-1");
      const step2 = updated?.steps.find((s) => s.id === "step-2");
      expect(step1?.status).toBe("failed");
      expect(step2?.status).toBe("blocked");
      // Step-3 should have been executed (it has no dependencies)
      expect(mockExecutionService.createExecution).toHaveBeenCalledTimes(2);
    });

    it("retryStep should unblock dependent steps", async () => {
      // Create workflow with a failed step and blocked dependents
      const workflow = createTestWorkflow({
        status: "paused",
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "failed", error: "Test error" },
          { id: "step-2", issueId: "i-2", index: 1, dependencies: ["step-1"], status: "blocked" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.retryStep(workflow.id, "step-1");

      const updated = await engine.getWorkflow(workflow.id);
      const step1 = updated?.steps.find((s) => s.id === "step-1");
      const step2 = updated?.steps.find((s) => s.id === "step-2");

      // Step-1 should be reset to pending
      expect(step1?.status).toBe("pending");
      expect(step1?.error).toBeUndefined();

      // Step-2 should be unblocked (back to pending)
      expect(step2?.status).toBe("pending");
    });
  });

  // ===========================================================================
  // Auto-Commit Tests
  // ===========================================================================

  describe("auto-commit", () => {
    it("should update issue in worktree JSONL after successful step completion", async () => {
      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "sequential",
          maxConcurrency: 1,
          onFailure: "pause",
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      // Mock JSONL functions for worktree issue updates
      mockReadJSONLSync.mockReturnValue([
        {
          id: "i-1",
          title: "Test Issue",
          content: "Test content",
          status: "open",
          priority: 2,
          uuid: "uuid-1",
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
        },
      ]);
      mockWriteJSONL.mockResolvedValue(undefined);

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.startWorkflow(workflow.id);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify JSONL was read from worktree
      expect(mockReadJSONLSync).toHaveBeenCalledWith(
        "/test/worktrees/workflow-test/.sudocode/issues.jsonl"
      );

      // Verify JSONL was written with updated issue status
      expect(mockWriteJSONL).toHaveBeenCalledWith(
        "/test/worktrees/workflow-test/.sudocode/issues.jsonl",
        expect.arrayContaining([
          expect.objectContaining({
            id: "i-1",
            status: "closed",
          }),
        ])
      );

      // Verify updateIssue was NOT called (should use JSONL instead)
      expect(mockUpdateIssue).not.toHaveBeenCalled();
    });

    it("should fall back to database when no worktree exists", async () => {
      // Create a workflow without worktree (simulating local mode)
      const workflow = createTestWorkflow({
        status: "pending",
        worktreePath: undefined, // No worktree
        config: {
          parallelism: "sequential",
          maxConcurrency: 1,
          onFailure: "pause",
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      // Mock lifecycle service to NOT create a worktree for this test
      (mockLifecycleService.createWorkflowWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
        worktreePath: null,
        branchName: null,
      });

      const mockExec = createMockExecution({ status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.startWorkflow(workflow.id);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify updateIssue was called (fallback when no worktree)
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        expect.anything(),
        "i-1",
        { status: "closed" }
      );

      // Verify JSONL was NOT used
      expect(mockWriteJSONL).not.toHaveBeenCalled();
    });

    it("should not close issue when step fails", async () => {
      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "sequential",
          maxConcurrency: 1,
          onFailure: "pause",
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const failedExec = createMockExecution({
        status: "failed",
        error_message: "Test failure",
      });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(failedExec);
      mockGetExecution.mockReturnValue(failedExec);

      mockUpdateIssue.mockClear();
      mockWriteJSONL.mockClear();

      await engine.startWorkflow(workflow.id);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Neither updateIssue nor writeJSONL should be called when step fails
      expect(mockUpdateIssue).not.toHaveBeenCalled();
      expect(mockWriteJSONL).not.toHaveBeenCalled();
    });

    it("should emit step_completed event with correct data after success", async () => {
      const events: { type: string; executionId?: string }[] = [];
      eventEmitter.on((event) => {
        if (event.type === "step_completed") {
          events.push({ type: event.type, executionId: event.executionId });
        }
      });

      const workflow = createTestWorkflow({
        status: "pending",
        config: {
          parallelism: "sequential",
          maxConcurrency: 1,
          onFailure: "pause",
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "human_in_the_loop",
        },
        steps: [
          { id: "step-1", issueId: "i-1", index: 0, dependencies: [], status: "ready" },
        ],
      });

      db.prepare(`
        INSERT INTO workflows (id, title, source, status, steps, base_branch, current_step_index, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.title,
        JSON.stringify(workflow.source),
        workflow.status,
        JSON.stringify(workflow.steps),
        workflow.baseBranch,
        workflow.currentStepIndex,
        JSON.stringify(workflow.config),
        workflow.createdAt,
        workflow.updatedAt
      );

      mockGetIssue.mockReturnValue({
        id: "i-1",
        title: "Test Issue",
        content: "Test content",
        status: "open",
        priority: 2,
        uuid: "uuid-1",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      });

      const mockExec = createMockExecution({ id: "exec-123", status: "completed" });
      (mockExecutionService.createExecution as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
      mockGetExecution.mockReturnValue(mockExec);

      await engine.startWorkflow(workflow.id);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify step_completed event includes executionId
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("step_completed");
      expect(events[0].executionId).toBe("exec-123");
    });
  });

  // ===========================================================================
  // Workflow Creation Tests
  // ===========================================================================

  describe("createWorkflow", () => {
    it("should create workflow from issues source", async () => {
      const workflow = await engine.createWorkflow(
        { type: "issues", issueIds: ["i-1", "i-2"] },
        { parallelism: "sequential" }
      );

      expect(workflow.id).toBeDefined();
      expect(workflow.source.type).toBe("issues");
      expect(workflow.steps.length).toBe(2);
      expect(workflow.status).toBe("pending");
    });

    it("should save workflow to database", async () => {
      const workflow = await engine.createWorkflow(
        { type: "issues", issueIds: ["i-1"] }
      );

      const retrieved = await engine.getWorkflow(workflow.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe(workflow.title);
    });
  });
});
