/**
 * Tests for Task Cancellation
 *
 * Tests task cancellation for queued and running tasks.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SimpleExecutionEngine } from "../../../../src/execution/engine/simple-engine.js";
import { MockProcessManager } from "./mock-process-manager.js";
import type { ExecutionTask } from "../../../../src/execution/engine/types.js";

describe("Task Cancellation", () => {
  let engine: SimpleExecutionEngine;
  let processManager: MockProcessManager;

  beforeEach(() => {
    processManager = new MockProcessManager();
    engine = new SimpleExecutionEngine(processManager);
  });

  describe("Cancel Queued Task", () => {
    it("removes queued task before execution", async () => {
      // Create engine with 0 concurrency to keep tasks queued
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 0,
      });

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will be cancelled",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await blockedEngine.submitTask(task);

      // Verify task is queued
      const beforeStatus = blockedEngine.getTaskStatus("task-1");
      assert.strictEqual(beforeStatus?.state, "queued");

      // Cancel the queued task
      await blockedEngine.cancelTask("task-1");

      // Verify task removed from queue
      const afterStatus = blockedEngine.getTaskStatus("task-1");
      assert.strictEqual(afterStatus, null);

      // Verify metrics updated
      const metrics = blockedEngine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 0);
    });

    it("cancels correct task when multiple tasks queued", async () => {
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 0,
      });

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "First",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Second - will be cancelled",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-3",
          type: "issue",
          prompt: "Third",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await blockedEngine.submitTasks(tasks);

      // Cancel middle task
      await blockedEngine.cancelTask("task-2");

      // Verify task-2 removed, others remain
      assert.strictEqual(
        blockedEngine.getTaskStatus("task-1")?.state,
        "queued"
      );
      assert.strictEqual(blockedEngine.getTaskStatus("task-2"), null);
      assert.strictEqual(
        blockedEngine.getTaskStatus("task-3")?.state,
        "queued"
      );

      const metrics = blockedEngine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 2);
    });
  });

  describe("Cancel Running Task", () => {
    it("terminates running task and updates metrics", async () => {
      // Increase mock delay so task runs longer
      processManager.mockDelay = 100;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will be cancelled while running",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task to start running
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Verify task is running
      const beforeStatus = engine.getTaskStatus("task-1");
      assert.strictEqual(beforeStatus?.state, "running");

      const beforeMetrics = engine.getMetrics();
      const runningBefore = beforeMetrics.currentlyRunning;

      // Cancel the running task
      await engine.cancelTask("task-1");

      // Give time for cancellation to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify task no longer running
      const afterStatus = engine.getTaskStatus("task-1");
      assert.ok(afterStatus === null || afterStatus.state !== "running");

      // Verify metrics updated
      const afterMetrics = engine.getMetrics();
      assert.ok(afterMetrics.currentlyRunning < runningBefore);
    });

    it("releases capacity slot after cancelling running task", async () => {
      processManager.mockDelay = 100;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will be cancelled",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task to start
      await new Promise((resolve) => setTimeout(resolve, 5));

      const beforeMetrics = engine.getMetrics();
      const slotsBefore = beforeMetrics.availableSlots;

      // Cancel the running task
      await engine.cancelTask("task-1");

      // Give time for cancellation
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify capacity slot released
      const afterMetrics = engine.getMetrics();
      assert.ok(afterMetrics.availableSlots > slotsBefore);
    });
  });

  describe("Cancel and Queue Processing", () => {
    it("starts next queued task after cancellation", async () => {
      // Set maxConcurrent to 1 to test sequential execution
      const limitedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 1,
      });

      processManager.mockDelay = 100;

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Will be cancelled",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Should start after task-1 cancelled",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await limitedEngine.submitTasks(tasks);

      // Wait for task-1 to start
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Verify task-1 running, task-2 queued
      assert.strictEqual(
        limitedEngine.getTaskStatus("task-1")?.state,
        "running"
      );
      assert.strictEqual(
        limitedEngine.getTaskStatus("task-2")?.state,
        "queued"
      );

      // Cancel task-1
      await limitedEngine.cancelTask("task-1");

      // Wait for task-2 to start
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify task-2 now running (capacity freed)
      const task2Status = limitedEngine.getTaskStatus("task-2");
      assert.ok(
        task2Status?.state === "running" || task2Status?.state === "completed"
      );
    });
  });

  describe("Idempotent Cancellation", () => {
    it("does not error when cancelling non-existent task", async () => {
      // Should not throw
      await engine.cancelTask("non-existent-task");

      // Metrics should be unchanged
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 0);
      assert.strictEqual(metrics.currentlyRunning, 0);
    });

    it("does not error when cancelling same task twice", async () => {
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 0,
      });

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Cancel me twice",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await blockedEngine.submitTask(task);

      // Cancel once
      await blockedEngine.cancelTask("task-1");

      // Cancel again - should not error
      await blockedEngine.cancelTask("task-1");

      // Verify metrics correct
      const metrics = blockedEngine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 0);
    });

    it("does not error when cancelling completed task", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will complete",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Verify task completed
      const status = engine.getTaskStatus("task-1");
      assert.strictEqual(status?.state, "completed");

      // Try to cancel completed task - should not error
      await engine.cancelTask("task-1");

      // Task should still be completed
      const afterStatus = engine.getTaskStatus("task-1");
      assert.strictEqual(afterStatus?.state, "completed");
    });
  });

  describe("Edge Cases", () => {
    it("handles concurrent cancellations gracefully", async () => {
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 0,
      });

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Task 1",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Task 2",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-3",
          type: "issue",
          prompt: "Task 3",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await blockedEngine.submitTasks(tasks);

      // Cancel all tasks concurrently
      await Promise.all([
        blockedEngine.cancelTask("task-1"),
        blockedEngine.cancelTask("task-2"),
        blockedEngine.cancelTask("task-3"),
      ]);

      // All tasks should be cancelled
      assert.strictEqual(blockedEngine.getTaskStatus("task-1"), null);
      assert.strictEqual(blockedEngine.getTaskStatus("task-2"), null);
      assert.strictEqual(blockedEngine.getTaskStatus("task-3"), null);

      const metrics = blockedEngine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 0);
    });

    it("cancels task with dependencies correctly", async () => {
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 0,
      });

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Parent task",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Dependent task",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-1"],
          createdAt: new Date(),
          config: {},
        },
      ];

      await blockedEngine.submitTasks(tasks);

      // Cancel parent task
      await blockedEngine.cancelTask("task-1");

      // Parent task should be gone
      assert.strictEqual(blockedEngine.getTaskStatus("task-1"), null);

      // Dependent task should still be queued (waiting for non-existent dependency)
      assert.strictEqual(
        blockedEngine.getTaskStatus("task-2")?.state,
        "queued"
      );
    });
  });
});
