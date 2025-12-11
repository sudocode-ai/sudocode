/**
 * Wakeup Timeout Tests
 *
 * Tests for execution timeout tracking in WorkflowWakeupService.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { WorkflowWakeupService } from "../../../../src/workflow/services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../../../../src/workflow/services/prompt-builder.js";
import { WorkflowEventEmitter } from "../../../../src/workflow/workflow-event-emitter.js";
import type { ExecutionService } from "../../../../src/services/execution-service.js";

describe("Execution Timeout", () => {
  let db: Database.Database;
  let mockExecutionService: ExecutionService;
  let wakeupService: WorkflowWakeupService;
  let eventEmitter: WorkflowEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create in-memory database with required tables
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        steps TEXT NOT NULL DEFAULT '[]',
        worktree_path TEXT,
        branch_name TEXT,
        base_branch TEXT NOT NULL,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        orchestrator_execution_id TEXT,
        orchestrator_session_id TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE workflow_events (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        type TEXT NOT NULL,
        step_id TEXT,
        execution_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        processed_at TEXT
      );

      CREATE TABLE executions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        session_id TEXT
      );
    `);

    // Mock execution service
    mockExecutionService = {
      cancelExecution: vi.fn().mockResolvedValue(undefined),
      createFollowUp: vi.fn().mockResolvedValue({
        id: "follow-up-123",
        session_id: "session-123",
      }),
    } as unknown as ExecutionService;

    eventEmitter = new WorkflowEventEmitter();

    wakeupService = new WorkflowWakeupService({
      db,
      executionService: mockExecutionService,
      promptBuilder: new WorkflowPromptBuilder(),
      eventEmitter,
      config: { batchWindowMs: 1000 },
    });
  });

  afterEach(() => {
    wakeupService.stop();
    db.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Timeout Start/Clear
  // ===========================================================================

  describe("timeout start and clear", () => {
    it("should start execution timeout", () => {
      wakeupService.startExecutionTimeout(
        "exec-123",
        "wf-456",
        "step-1",
        5000
      );

      // Verify timeout was started (console.log check)
      const consoleSpy = vi.spyOn(console, "log");
      wakeupService.startExecutionTimeout("exec-456", "wf-789", "step-2", 3000);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should clear timeout when execution completes normally", () => {
      const consoleSpy = vi.spyOn(console, "log");

      wakeupService.startExecutionTimeout(
        "exec-123",
        "wf-456",
        "step-1",
        5000
      );

      wakeupService.clearExecutionTimeout("exec-123");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cleared timeout for execution exec-123")
      );
    });

    it("should handle clearing non-existent timeout", () => {
      // Should not throw
      expect(() => {
        wakeupService.clearExecutionTimeout("non-existent");
      }).not.toThrow();
    });

    it("should replace timeout when starting for same execution", () => {
      wakeupService.startExecutionTimeout(
        "exec-123",
        "wf-456",
        "step-1",
        5000
      );

      // Start another timeout for the same execution
      wakeupService.startExecutionTimeout(
        "exec-123",
        "wf-456",
        "step-1",
        10000
      );

      // Old timeout should be cleared, only new one active
      // Advance past first timeout but not second
      vi.advanceTimersByTime(6000);

      // Should not have cancelled (would happen at 5000ms with old timeout)
      expect(mockExecutionService.cancelExecution).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Timeout Expiration
  // ===========================================================================

  describe("timeout expiration", () => {
    it("should cancel execution when timeout expires", async () => {
      wakeupService.startExecutionTimeout(
        "exec-123",
        "wf-456",
        "step-1",
        5000
      );

      // Advance time past timeout
      vi.advanceTimersByTime(6000);

      // Allow promises to resolve
      await vi.runAllTimersAsync();

      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith(
        "exec-123"
      );
    });

    it("should record step_failed event with timeout reason", async () => {
      wakeupService.startExecutionTimeout(
        "exec-123",
        "wf-456",
        "step-1",
        5000
      );

      vi.advanceTimersByTime(6000);
      await vi.runAllTimersAsync();

      // Check step_failed event was recorded in database
      // Filter for step_failed type since execution_timeout events are also persisted
      const events = db
        .prepare("SELECT * FROM workflow_events WHERE workflow_id = ? AND type = 'step_failed'")
        .all("wf-456") as Array<{
          type: string;
          execution_id: string;
          step_id: string;
          payload: string;
        }>;

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("step_failed");
      expect(events[0].execution_id).toBe("exec-123");
      expect(events[0].step_id).toBe("step-1");

      const payload = JSON.parse(events[0].payload);
      expect(payload.reason).toBe("timeout");
    });

    it("should handle cancel failure gracefully", async () => {
      mockExecutionService.cancelExecution = vi
        .fn()
        .mockRejectedValue(new Error("Cancel failed"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      wakeupService.startExecutionTimeout(
        "exec-123",
        "wf-456",
        "step-1",
        5000
      );

      vi.advanceTimersByTime(6000);
      await vi.runAllTimersAsync();

      // Should still record the step_failed event despite cancel failure
      // Filter for step_failed type since execution_timeout events are also persisted
      const events = db
        .prepare("SELECT * FROM workflow_events WHERE workflow_id = ? AND type = 'step_failed'")
        .all("wf-456") as Array<{ type: string }>;

      expect(events).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Concurrent Timeouts
  // ===========================================================================

  describe("concurrent timeouts", () => {
    it("should handle multiple concurrent timeouts", async () => {
      wakeupService.startExecutionTimeout(
        "exec-1",
        "wf-1",
        "step-1",
        3000
      );
      wakeupService.startExecutionTimeout(
        "exec-2",
        "wf-2",
        "step-2",
        5000
      );
      wakeupService.startExecutionTimeout(
        "exec-3",
        "wf-3",
        "step-3",
        7000
      );

      // Advance to first timeout (3000ms)
      await vi.advanceTimersByTimeAsync(3500);

      expect(mockExecutionService.cancelExecution).toHaveBeenCalledTimes(1);
      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith("exec-1");

      // Advance to second timeout (5000ms total, so 1500ms more)
      await vi.advanceTimersByTimeAsync(2000);

      expect(mockExecutionService.cancelExecution).toHaveBeenCalledTimes(2);
      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith("exec-2");

      // Advance to third timeout (7000ms total, so 2000ms more)
      await vi.advanceTimersByTimeAsync(2500);

      expect(mockExecutionService.cancelExecution).toHaveBeenCalledTimes(3);
      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith("exec-3");
    });

    it("should clear specific timeout without affecting others", async () => {
      wakeupService.startExecutionTimeout(
        "exec-1",
        "wf-1",
        "step-1",
        3000
      );
      wakeupService.startExecutionTimeout(
        "exec-2",
        "wf-2",
        "step-2",
        5000
      );

      // Clear first timeout
      wakeupService.clearExecutionTimeout("exec-1");

      // Advance past both timeouts
      vi.advanceTimersByTime(6000);
      await vi.runAllTimersAsync();

      // Only exec-2 should be cancelled
      expect(mockExecutionService.cancelExecution).toHaveBeenCalledTimes(1);
      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith("exec-2");
    });
  });

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  describe("cleanup", () => {
    it("should cleanup all timeouts on service stop", async () => {
      wakeupService.startExecutionTimeout(
        "exec-1",
        "wf-1",
        "step-1",
        3000
      );
      wakeupService.startExecutionTimeout(
        "exec-2",
        "wf-2",
        "step-2",
        5000
      );

      // Stop service (which should clear all timeouts)
      wakeupService.stop();

      // Advance past all timeouts
      vi.advanceTimersByTime(10000);
      await vi.runAllTimersAsync();

      // No cancellations should happen
      expect(mockExecutionService.cancelExecution).not.toHaveBeenCalled();
    });
  });
});
