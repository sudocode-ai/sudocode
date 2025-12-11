/**
 * Unit tests for WorkflowWakeupService await functionality
 *
 * Tests the await_events mechanism:
 * - Registering await conditions
 * - Checking if events satisfy await conditions
 * - Resolving awaits and triggering immediate wakeups
 * - Timeout handling for awaits
 * - Cleanup of await state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  WORKFLOWS_TABLE,
  WORKFLOW_EVENTS_TABLE,
  EXECUTIONS_TABLE,
} from "@sudocode-ai/types/schema";
import { WorkflowWakeupService } from "../../../../src/workflow/services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../../../../src/workflow/services/prompt-builder.js";
import { WorkflowEventEmitter } from "../../../../src/workflow/workflow-event-emitter.js";
import type { ExecutionService } from "../../../../src/services/execution-service.js";

// =============================================================================
// Test Setup
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(WORKFLOWS_TABLE);
  db.exec(EXECUTIONS_TABLE);
  db.exec(WORKFLOW_EVENTS_TABLE);
  return db;
}

function createMockExecutionService(): ExecutionService {
  return {
    createFollowUp: vi.fn().mockResolvedValue({
      id: "follow-up-exec",
      session_id: "session-123",
      status: "running",
    }),
  } as unknown as ExecutionService;
}

function insertTestWorkflow(
  db: Database.Database,
  overrides?: Partial<{
    id: string;
    status: string;
    orchestratorExecutionId: string | null;
  }>
): void {
  const id = overrides?.id ?? "wf-test";
  const status = overrides?.status ?? "running";
  const orchestratorExecutionId =
    overrides && "orchestratorExecutionId" in overrides
      ? overrides.orchestratorExecutionId
      : "orch-exec-1";

  if (orchestratorExecutionId) {
    db.prepare(
      `
      INSERT OR IGNORE INTO executions (id, status, agent_type, target_branch, branch_name)
      VALUES (?, 'running', 'claude-code', 'main', 'sudocode/orchestrator')
    `
    ).run(orchestratorExecutionId);
  }

  db.prepare(
    `
    INSERT INTO workflows (
      id, title, source, status, steps, base_branch,
      current_step_index, orchestrator_execution_id, config,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    "Test Workflow",
    JSON.stringify({ type: "goal", goal: "Test goal" }),
    status,
    JSON.stringify([]),
    "main",
    0,
    orchestratorExecutionId,
    JSON.stringify({
      parallelism: "sequential",
      onFailure: "pause",
      autoCommitAfterStep: true,
      defaultAgentType: "claude-code",
      autonomyLevel: "human_in_the_loop",
    }),
    "2025-01-01T00:00:00.000Z",
    "2025-01-01T00:00:00.000Z"
  );
}

function insertTestExecution(
  db: Database.Database,
  overrides?: Partial<{ id: string; issue_id: string; status: string }>
): void {
  const id = overrides?.id ?? "exec-test";
  const issueId = overrides?.issue_id ?? "i-test";
  const status = overrides?.status ?? "completed";

  db.prepare(
    `
    INSERT INTO executions (
      id, issue_id, status, agent_type, target_branch, branch_name,
      summary, files_changed, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    issueId,
    status,
    "claude-code",
    "main",
    "sudocode/exec",
    "Completed successfully",
    JSON.stringify([{ path: "test.ts", additions: 10, deletions: 5 }]),
    "2025-01-01T00:00:00.000Z",
    "2025-01-01T00:01:00.000Z"
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("WorkflowWakeupService Await Functionality", () => {
  let db: Database.Database;
  let executionService: ExecutionService;
  let promptBuilder: WorkflowPromptBuilder;
  let eventEmitter: WorkflowEventEmitter;
  let service: WorkflowWakeupService;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createTestDb();
    executionService = createMockExecutionService();
    promptBuilder = new WorkflowPromptBuilder();
    eventEmitter = new WorkflowEventEmitter();

    service = new WorkflowWakeupService({
      db,
      executionService,
      promptBuilder,
      eventEmitter,
      config: { batchWindowMs: 100 },
    });
  });

  afterEach(() => {
    service.stop();
    db.close();
    vi.useRealTimers();
  });

  describe("registerAwait", () => {
    it("should register an await condition and return await ID", () => {
      const result = service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed", "step_failed"],
      });

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(result.timeoutAt).toBeUndefined();
    });

    it("should calculate timeout_at when timeout_seconds is provided", () => {
      const now = new Date("2025-01-01T00:00:00.000Z");
      vi.setSystemTime(now);

      const result = service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        timeoutSeconds: 300,
      });

      expect(result.timeoutAt).toBeDefined();
      const timeoutDate = new Date(result.timeoutAt!);
      expect(timeoutDate.getTime()).toBe(now.getTime() + 300 * 1000);
    });

    it("should store pending await that can be retrieved", () => {
      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        executionIds: ["exec-1"],
        message: "Waiting for issue completion",
      });

      expect(service.hasPendingAwait("wf-test")).toBe(true);

      const pending = service.getPendingAwait("wf-test");
      expect(pending).toBeDefined();
      expect(pending!.eventTypes).toEqual(["step_completed"]);
      expect(pending!.executionIds).toEqual(["exec-1"]);
      expect(pending!.message).toBe("Waiting for issue completion");
    });

    it("should replace existing await for same workflow", () => {
      const result1 = service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
      });

      const result2 = service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_failed", "user_response"],
      });

      expect(result1.id).not.toBe(result2.id);

      const pending = service.getPendingAwait("wf-test");
      expect(pending!.id).toBe(result2.id);
      expect(pending!.eventTypes).toEqual(["step_failed", "user_response"]);
    });
  });

  describe("await condition matching", () => {
    it("should trigger immediate wakeup when event matches await condition", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Register await for step_completed
      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
      });

      // Record matching event
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // Should trigger immediately without waiting for batch window
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should not trigger immediate wakeup for non-matching event type", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Register await for step_failed only
      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_failed"],
      });

      // Record step_completed (not matching)
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // Should not trigger immediately
      expect(executionService.createFollowUp).not.toHaveBeenCalled();

      // But should trigger after batch window (regular wakeup)
      await vi.advanceTimersByTimeAsync(150);
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should filter by execution ID when specified", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });
      insertTestExecution(db, { id: "exec-2" });

      // Register await for specific execution
      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        executionIds: ["exec-2"],
      });

      // Record event from different execution
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // Should not trigger immediately (wrong execution)
      expect(executionService.createFollowUp).not.toHaveBeenCalled();

      // Record event from correct execution
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-2",
        payload: {},
      });

      // Should trigger immediately
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should clear pending await after it is satisfied", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
      });

      expect(service.hasPendingAwait("wf-test")).toBe(true);

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      expect(service.hasPendingAwait("wf-test")).toBe(false);
    });
  });

  describe("await timeout", () => {
    it("should trigger wakeup when timeout expires", async () => {
      insertTestWorkflow(db);

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        timeoutSeconds: 5,
      });

      // Should not trigger immediately
      expect(executionService.createFollowUp).not.toHaveBeenCalled();

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(5500);

      // Should have triggered
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should resolve await with 'timeout' when timeout expires", async () => {
      insertTestWorkflow(db);

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        timeoutSeconds: 5,
        message: "Waiting for completion",
      });

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(5500);

      // Check that createFollowUp was called with message containing timeout info
      expect(executionService.createFollowUp).toHaveBeenCalledWith(
        "orch-exec-1",
        expect.stringContaining("AWAIT RESOLVED")
      );
      expect(executionService.createFollowUp).toHaveBeenCalledWith(
        "orch-exec-1",
        expect.stringContaining("timeout")
      );
    });

    it("should clear timeout when await is satisfied before timeout", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        timeoutSeconds: 10,
      });

      // Satisfy await before timeout
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);

      // Advance past original timeout
      await vi.advanceTimersByTimeAsync(15000);

      // Should not trigger again
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should not trigger timeout if await was replaced", async () => {
      insertTestWorkflow(db);

      const result1 = service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        timeoutSeconds: 5,
      });

      // Advance partway
      await vi.advanceTimersByTimeAsync(3000);

      // Replace with new await (different timeout)
      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_failed"],
        timeoutSeconds: 10,
      });

      // Advance past original timeout
      await vi.advanceTimersByTimeAsync(3000);

      // Should not have triggered (original was replaced)
      expect(executionService.createFollowUp).not.toHaveBeenCalled();

      // Advance past new timeout
      await vi.advanceTimersByTimeAsync(8000);

      // Now should trigger
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAndClearResolvedAwait", () => {
    it("should return resolved await context after event triggers it", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed", "step_failed"],
        executionIds: ["exec-1"],
        message: "Waiting for issue",
      });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // getAndClearResolvedAwait is called internally by triggerWakeup
      // The wakeup message should contain await context
      expect(executionService.createFollowUp).toHaveBeenCalledWith(
        "orch-exec-1",
        expect.stringContaining("step_completed, step_failed")
      );
      expect(executionService.createFollowUp).toHaveBeenCalledWith(
        "orch-exec-1",
        expect.stringContaining("step_completed") // resolvedBy
      );
    });

    it("should clear resolved await after retrieval", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
      });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // First call returns the resolved await
      const resolved = service.getAndClearResolvedAwait("wf-test");
      expect(resolved).toBeUndefined(); // Already cleared by triggerWakeup

      // Second call returns undefined
      const resolved2 = service.getAndClearResolvedAwait("wf-test");
      expect(resolved2).toBeUndefined();
    });
  });

  describe("clearAwaitState", () => {
    it("should clear pending await and timeout", async () => {
      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
        timeoutSeconds: 10,
      });

      expect(service.hasPendingAwait("wf-test")).toBe(true);

      service.clearAwaitState("wf-test");

      expect(service.hasPendingAwait("wf-test")).toBe(false);

      // Timeout should not fire
      await vi.advanceTimersByTimeAsync(15000);
      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });

    it("should handle clearing non-existent await", () => {
      // Should not throw
      service.clearAwaitState("wf-nonexistent");
      expect(service.hasPendingAwait("wf-nonexistent")).toBe(false);
    });
  });

  describe("stop", () => {
    it("should clear all await state on stop", async () => {
      service.registerAwait({
        workflowId: "wf-1",
        eventTypes: ["step_completed"],
        timeoutSeconds: 5,
      });

      service.registerAwait({
        workflowId: "wf-2",
        eventTypes: ["step_failed"],
        timeoutSeconds: 5,
      });

      expect(service.hasPendingAwait("wf-1")).toBe(true);
      expect(service.hasPendingAwait("wf-2")).toBe(true);

      service.stop();

      expect(service.hasPendingAwait("wf-1")).toBe(false);
      expect(service.hasPendingAwait("wf-2")).toBe(false);

      // Timeouts should not fire
      await vi.advanceTimersByTimeAsync(10000);
      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });
  });

  describe("multiple event types", () => {
    it("should match any of the specified event types", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed", "step_failed", "user_response"],
      });

      // step_failed should match
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_failed",
        executionId: "exec-1",
        payload: {},
      });

      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should not match event types not in the list", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["step_completed"],
      });

      // step_started should not match
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_started",
        executionId: "exec-1",
        payload: {},
      });

      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });
  });

  describe("escalation events", () => {
    it("should match escalation_resolved event type", async () => {
      insertTestWorkflow(db);

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["escalation_resolved"],
      });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "escalation_resolved",
        payload: { action: "approve", message: "Go ahead" },
      });

      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should match user_response event type", async () => {
      insertTestWorkflow(db);

      service.registerAwait({
        workflowId: "wf-test",
        eventTypes: ["user_response"],
      });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "user_response",
        payload: { response: "Yes" },
      });

      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });
  });
});
