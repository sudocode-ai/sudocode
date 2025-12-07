/**
 * Unit tests for WorkflowWakeupService
 *
 * Tests event recording and wakeup triggering:
 * - Event recording to database
 * - Debounced wakeup scheduling
 * - Wakeup triggering creates follow-up execution
 * - Events marked as processed after wakeup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Execution } from "@sudocode-ai/types";
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

  // Disable foreign key enforcement for tests
  // (avoids needing to create all dependent tables)
  db.exec("PRAGMA foreign_keys = OFF");

  // Create tables
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
    cancelExecution: vi.fn().mockResolvedValue(undefined),
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
  // Use hasOwnProperty to distinguish between not-provided and explicitly-null
  const orchestratorExecutionId =
    overrides && "orchestratorExecutionId" in overrides
      ? overrides.orchestratorExecutionId
      : "orch-exec-1";

  // Insert orchestrator execution first if specified (for foreign key)
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

describe("WorkflowWakeupService", () => {
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
      config: { batchWindowMs: 100 }, // Short window for tests
    });
  });

  afterEach(() => {
    service.stop();
    db.close();
    vi.useRealTimers();
  });

  describe("recordEvent", () => {
    it("should insert event into database", async () => {
      insertTestWorkflow(db);

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        stepId: "step-1",
        payload: { issueId: "i-test" },
      });

      const events = db
        .prepare("SELECT * FROM workflow_events WHERE workflow_id = ?")
        .all("wf-test") as any[];

      expect(events).toHaveLength(1);
      expect(events[0].workflow_id).toBe("wf-test");
      expect(events[0].type).toBe("step_completed");
      expect(events[0].execution_id).toBe("exec-1");
      expect(events[0].step_id).toBe("step-1");
      expect(JSON.parse(events[0].payload)).toEqual({ issueId: "i-test" });
      expect(events[0].processed_at).toBeNull();
    });

    it("should schedule wakeup after recording event", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // Wakeup should not have triggered yet
      expect(executionService.createFollowUp).not.toHaveBeenCalled();

      // Advance timer past batch window
      await vi.advanceTimersByTimeAsync(150);

      // Now wakeup should have triggered
      expect(executionService.createFollowUp).toHaveBeenCalled();
    });
  });

  describe("getUnprocessedEvents", () => {
    it("should return unprocessed events in order", async () => {
      insertTestWorkflow(db);

      // Insert multiple events
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_started",
        payload: { order: 1 },
      });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        payload: { order: 2 },
      });

      const events = service.getUnprocessedEvents("wf-test");

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("step_started");
      expect(events[1].type).toBe("step_completed");
    });

    it("should not return processed events", async () => {
      insertTestWorkflow(db);

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        payload: {},
      });

      // Get events to get the ID
      let events = service.getUnprocessedEvents("wf-test");
      expect(events).toHaveLength(1);

      // Mark as processed
      service.markEventsProcessed([events[0].id]);

      // Should now be empty
      events = service.getUnprocessedEvents("wf-test");
      expect(events).toHaveLength(0);
    });
  });

  describe("markEventsProcessed", () => {
    it("should set processed_at on events", async () => {
      insertTestWorkflow(db);

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        payload: {},
      });

      const events = service.getUnprocessedEvents("wf-test");
      service.markEventsProcessed([events[0].id]);

      // Check database directly
      const row = db
        .prepare("SELECT processed_at FROM workflow_events WHERE id = ?")
        .get(events[0].id) as { processed_at: string | null };

      expect(row.processed_at).not.toBeNull();
    });

    it("should handle empty array", () => {
      // Should not throw
      service.markEventsProcessed([]);
    });
  });

  describe("scheduleWakeup", () => {
    it("should debounce multiple calls", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Record multiple events quickly
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_started",
        executionId: "exec-1",
        payload: {},
      });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "workflow_completed",
        payload: {},
      });

      // Advance past batch window
      await vi.advanceTimersByTimeAsync(150);

      // Should only have one call to createFollowUp
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("should reset timer on new event", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_started",
        executionId: "exec-1",
        payload: {},
      });

      // Advance partway
      await vi.advanceTimersByTimeAsync(50);

      // Record another event - should reset timer
      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // Advance another 50ms (total 100ms from start)
      await vi.advanceTimersByTimeAsync(50);

      // Should NOT have triggered yet (timer was reset)
      expect(executionService.createFollowUp).not.toHaveBeenCalled();

      // Advance remaining time
      await vi.advanceTimersByTimeAsync(60);

      // Now it should trigger
      expect(executionService.createFollowUp).toHaveBeenCalledTimes(1);
    });
  });

  describe("triggerWakeup", () => {
    it("should create follow-up execution with wakeup message", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1", issue_id: "i-auth" });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      expect(executionService.createFollowUp).toHaveBeenCalledWith(
        "orch-exec-1",
        expect.stringContaining("Workflow Event")
      );
    });

    it("should update workflow orchestrator execution ID", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Check workflow was updated
      const workflow = db
        .prepare("SELECT orchestrator_execution_id FROM workflows WHERE id = ?")
        .get("wf-test") as { orchestrator_execution_id: string };

      expect(workflow.orchestrator_execution_id).toBe("follow-up-exec");
    });

    it("should mark events as processed after wakeup", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Events should be processed
      const events = service.getUnprocessedEvents("wf-test");
      expect(events).toHaveLength(0);
    });

    it("should emit orchestrator_wakeup event", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      const listener = vi.fn();
      eventEmitter.on(listener);

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "orchestrator_wakeup",
          workflowId: "wf-test",
        })
      );
    });

    it("should skip wakeup if workflow not found", async () => {
      await service.triggerWakeup("nonexistent");

      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });

    it("should skip wakeup if no orchestrator execution", async () => {
      insertTestWorkflow(db, { orchestratorExecutionId: null });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });

    it("should skip wakeup if workflow is paused", async () => {
      insertTestWorkflow(db, { status: "paused" });
      insertTestExecution(db, { id: "exec-1" });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });

    it("should skip wakeup if no unprocessed events", async () => {
      insertTestWorkflow(db);

      await service.triggerWakeup("wf-test");

      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });

    it("should cancel previous execution before creating follow-up when still running", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Ensure orchestrator execution is in running state
      db.prepare("UPDATE executions SET status = 'running' WHERE id = ?").run(
        "orch-exec-1"
      );

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Should cancel the previous orchestrator execution first
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "orch-exec-1"
      );
      // Then create follow-up
      expect(executionService.createFollowUp).toHaveBeenCalledWith(
        "orch-exec-1",
        expect.any(String)
      );
    });

    it("should not cancel previous execution if already completed", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Set orchestrator execution to completed
      db.prepare("UPDATE executions SET status = 'completed' WHERE id = ?").run(
        "orch-exec-1"
      );

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Should NOT cancel since already completed
      expect(executionService.cancelExecution).not.toHaveBeenCalled();
      // Should still create follow-up
      expect(executionService.createFollowUp).toHaveBeenCalled();
    });

    it("should not cancel previous execution if already cancelled", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Set orchestrator execution to cancelled
      db.prepare("UPDATE executions SET status = 'cancelled' WHERE id = ?").run(
        "orch-exec-1"
      );

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Should NOT cancel since already cancelled
      expect(executionService.cancelExecution).not.toHaveBeenCalled();
      // Should still create follow-up
      expect(executionService.createFollowUp).toHaveBeenCalled();
    });

    it("should cancel previous execution in pending state", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Set orchestrator execution to pending
      db.prepare("UPDATE executions SET status = 'pending' WHERE id = ?").run(
        "orch-exec-1"
      );

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Should cancel the pending execution
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "orch-exec-1"
      );
    });

    it("should cancel previous execution in preparing state", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Set orchestrator execution to preparing
      db.prepare("UPDATE executions SET status = 'preparing' WHERE id = ?").run(
        "orch-exec-1"
      );

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Should cancel the preparing execution
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "orch-exec-1"
      );
    });

    it("should continue creating follow-up even if cancel fails", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      // Set orchestrator execution to running
      db.prepare("UPDATE executions SET status = 'running' WHERE id = ?").run(
        "orch-exec-1"
      );

      // Make cancel fail
      (executionService.cancelExecution as any).mockRejectedValueOnce(
        new Error("Cancel failed")
      );

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.triggerWakeup("wf-test");

      // Cancel was attempted
      expect(executionService.cancelExecution).toHaveBeenCalled();
      // Follow-up should still be created despite cancel failure
      expect(executionService.createFollowUp).toHaveBeenCalled();
    });
  });

  describe("cancelPendingWakeup", () => {
    it("should cancel scheduled wakeup", async () => {
      insertTestWorkflow(db);
      insertTestExecution(db, { id: "exec-1" });

      await service.recordEvent({
        workflowId: "wf-test",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      // Cancel before timer fires
      service.cancelPendingWakeup("wf-test");

      // Advance past batch window
      await vi.advanceTimersByTimeAsync(150);

      // Should not have triggered
      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should cancel all pending wakeups", async () => {
      insertTestWorkflow(db, { id: "wf-1" });
      insertTestWorkflow(db, { id: "wf-2" });
      insertTestExecution(db, { id: "exec-1" });

      await service.recordEvent({
        workflowId: "wf-1",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      await service.recordEvent({
        workflowId: "wf-2",
        type: "step_completed",
        executionId: "exec-1",
        payload: {},
      });

      service.stop();

      // Advance past batch window
      await vi.advanceTimersByTimeAsync(150);

      // Neither should have triggered
      expect(executionService.createFollowUp).not.toHaveBeenCalled();
    });
  });
});
