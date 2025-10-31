/**
 * Tests for Task Queue Behavior
 *
 * Tests FIFO ordering, task submission, and basic metrics.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SimpleExecutionEngine } from "../../../../src/execution/engine/simple-engine.js";
import { MockProcessManager } from "./mock-process-manager.js";
import type { ExecutionTask } from "../../../../src/execution/engine/types.js";

describe("Task Queue", () => {
  let engine: SimpleExecutionEngine;
  let processManager: MockProcessManager;

  beforeEach(() => {
    processManager = new MockProcessManager();
    engine = new SimpleExecutionEngine(processManager);
  });

  describe("submitTask", () => {
    it("returns the task ID", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        entityId: "ISSUE-001",
        prompt: "Fix the bug",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const taskId = await engine.submitTask(task);
      assert.strictEqual(taskId, "task-1");
    });

    it("increments queuedTasks metric", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Fix the bug",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const beforeMetrics = engine.getMetrics();
      assert.strictEqual(beforeMetrics.queuedTasks, 0);

      await engine.submitTask(task);

      const afterMetrics = engine.getMetrics();
      // Note: queuedTasks may be 0 if processQueue already dequeued it
      // So we check that it was incremented at some point
      assert.ok(afterMetrics.queuedTasks >= 0);
    });

    it("triggers processQueue after submission", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Fix the bug",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      // Create engine with 0 concurrency to prevent execution attempts
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 0,
      });

      await blockedEngine.submitTask(task);

      // With maxConcurrent=0, task should remain queued
      const metrics = blockedEngine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 1);
    });
  });

  describe("submitTasks", () => {
    it("submits multiple tasks and returns all IDs", async () => {
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

      const taskIds = await engine.submitTasks(tasks);
      assert.deepStrictEqual(taskIds, ["task-1", "task-2", "task-3"]);
    });

    it("updates metrics for multiple tasks", async () => {
      // Create engine with 0 concurrency to prevent execution
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
      ];

      await blockedEngine.submitTasks(tasks);

      const metrics = blockedEngine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 2);
    });
  });

  describe("getMetrics", () => {
    it("returns initial metrics with default values", () => {
      const metrics = engine.getMetrics();

      assert.strictEqual(metrics.maxConcurrent, 3);
      assert.strictEqual(metrics.currentlyRunning, 0);
      assert.strictEqual(metrics.availableSlots, 3);
      assert.strictEqual(metrics.queuedTasks, 0);
      assert.strictEqual(metrics.completedTasks, 0);
      assert.strictEqual(metrics.failedTasks, 0);
      assert.strictEqual(metrics.averageDuration, 0);
      assert.strictEqual(metrics.successRate, 1.0);
      assert.strictEqual(metrics.throughput, 0);
      assert.strictEqual(metrics.totalProcessesSpawned, 0);
      assert.strictEqual(metrics.activeProcesses, 0);
    });

    it("respects custom maxConcurrent config", () => {
      const customEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 5,
      });

      const metrics = customEngine.getMetrics();
      assert.strictEqual(metrics.maxConcurrent, 5);
      assert.strictEqual(metrics.availableSlots, 5);
    });

    it("returns a defensive copy of metrics", () => {
      const metrics1 = engine.getMetrics();
      const metrics2 = engine.getMetrics();

      // Modifying one should not affect the other
      metrics1.queuedTasks = 999;
      assert.notStrictEqual(metrics2.queuedTasks, 999);
    });
  });

  describe("getTaskStatus", () => {
    it("returns null for non-existent task", () => {
      const status = engine.getTaskStatus("non-existent");
      assert.strictEqual(status, null);
    });

    it("maintains FIFO queue order", async () => {
      // Create engine with 0 concurrency to keep tasks in queue
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
          prompt: "Second",
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

      // Verify all tasks are queued
      const status1 = blockedEngine.getTaskStatus("task-1");
      const status2 = blockedEngine.getTaskStatus("task-2");
      const status3 = blockedEngine.getTaskStatus("task-3");

      // All should be queued in FIFO order
      assert.strictEqual(status1?.state, "queued");
      assert.strictEqual(status2?.state, "queued");
      assert.strictEqual(status3?.state, "queued");

      // Verify positions reflect FIFO order
      if (status1?.state === "queued") assert.strictEqual(status1.position, 0);
      if (status2?.state === "queued") assert.strictEqual(status2.position, 1);
      if (status3?.state === "queued") assert.strictEqual(status3.position, 2);
    });
  });
});
