/**
 * Tests for Task Dependency Resolution
 *
 * Tests dependency checking, ordering, and handling of failed dependencies.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SimpleExecutionEngine } from "../../../../src/execution/engine/simple-engine.js";
import { MockProcessManager } from "./mock-process-manager.js";
import type { ExecutionTask } from "../../../../src/execution/engine/types.js";

describe("Task Dependency Resolution", () => {
  let engine: SimpleExecutionEngine;
  let processManager: MockProcessManager;

  beforeEach(() => {
    processManager = new MockProcessManager();
    engine = new SimpleExecutionEngine(processManager);
  });

  describe("Dependency Checking", () => {
    it("executes task with no dependencies immediately", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Task without dependencies",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Give time for task to start
      await new Promise((resolve) => setTimeout(resolve, 5));

      const status = engine.getTaskStatus("task-1");
      // Should be running or completed (not queued)
      assert.ok(status?.state === "running" || status?.state === "completed");
    });

    it("queues task with unmet dependencies", async () => {
      const task: ExecutionTask = {
        id: "task-2",
        type: "issue",
        prompt: "Task with dependency",
        workDir: process.cwd(),
        priority: 0,
        dependencies: ["task-1"], // Depends on non-existent task
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Give time for queue processing
      await new Promise((resolve) => setTimeout(resolve, 5));

      const status = engine.getTaskStatus("task-2");
      // Should remain queued because dependency not met
      assert.strictEqual(status?.state, "queued");
    });

    it("executes task after dependencies complete", async () => {
      // Submit task 1 first
      const task1: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "First task",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      // Submit task 2 that depends on task 1
      const task2: ExecutionTask = {
        id: "task-2",
        type: "issue",
        prompt: "Second task",
        workDir: process.cwd(),
        priority: 0,
        dependencies: ["task-1"],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task1);
      await engine.submitTask(task2);

      // Wait for task 1 to complete (mock takes ~10ms)
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Task 2 should now be able to execute
      const status2 = engine.getTaskStatus("task-2");
      // Should be running or completed (dependencies met)
      assert.ok(
        status2?.state === "running" ||
          status2?.state === "completed" ||
          status2 === null
      );
    });
  });

  describe("Execution Order", () => {
    it("enforces correct execution order with linear dependencies", async () => {
      const completionOrder: string[] = [];

      // Create engine with completion tracking
      engine.onTaskComplete((result) => {
        completionOrder.push(result.taskId);
      });

      // Create chain: task-1 -> task-2 -> task-3
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
          dependencies: ["task-1"],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-3",
          type: "issue",
          prompt: "Third",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-2"],
          createdAt: new Date(),
          config: {},
        },
      ];

      // Submit in order for predictable execution
      await engine.submitTasks(tasks);

      // Wait for all tasks to complete (each takes ~10ms + processing)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify execution order
      assert.ok(completionOrder.length >= 3, "All tasks should complete");
      assert.strictEqual(completionOrder[0], "task-1");
      assert.strictEqual(completionOrder[1], "task-2");
      assert.strictEqual(completionOrder[2], "task-3");
    });

    it("handles multiple independent tasks with dependencies", async () => {
      const completionOrder: string[] = [];

      engine.onTaskComplete((result) => {
        completionOrder.push(result.taskId);
      });

      // Create tree structure:
      //   task-1 -> task-2
      //          -> task-3
      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Root",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Branch 1",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-1"],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-3",
          type: "issue",
          prompt: "Branch 2",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-1"],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Wait for all tasks to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // task-1 must complete first
      assert.strictEqual(completionOrder[0], "task-1");
      // task-2 and task-3 can complete in any order after task-1
      assert.ok(completionOrder.includes("task-2"));
      assert.ok(completionOrder.includes("task-3"));
    });
  });

  describe("Failed Dependencies", () => {
    it("fails task when dependency fails", async () => {
      // Configure mock to fail task-1
      processManager.shouldFail = true;

      const task1: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will fail",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const task2: ExecutionTask = {
        id: "task-2",
        type: "issue",
        prompt: "Depends on failed task",
        workDir: process.cwd(),
        priority: 0,
        dependencies: ["task-1"],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task1);
      await engine.submitTask(task2);

      // Wait for tasks to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Task 2 should be failed (not queued or completed)
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 2); // Both task-1 and task-2 failed
    });

    it("does not execute task with failed dependency", async () => {
      let task2Executed = false;

      // Track if task-2 starts executing
      engine.onTaskComplete((result) => {
        if (result.taskId === "task-2") {
          task2Executed = true;
        }
      });

      // Configure mock to fail
      processManager.shouldFail = true;

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Will fail",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Should not execute",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-1"],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Task 2 should not have executed successfully
      assert.strictEqual(task2Executed, false);
    });

    it("propagates failure through dependency chain", async () => {
      processManager.shouldFail = true;

      // Create chain: task-1 (fail) -> task-2 -> task-3
      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Will fail",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Will fail due to dependency",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-1"],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-3",
          type: "issue",
          prompt: "Will also fail",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-2"],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Wait for processing (need time for sequential failure propagation)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // All three tasks should have failed
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 3);
      assert.strictEqual(metrics.completedTasks, 0);
    });
  });

  describe("Edge Cases", () => {
    it("handles task with multiple dependencies", async () => {
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
          prompt: "Depends on both",
          workDir: process.cwd(),
          priority: 0,
          dependencies: ["task-1", "task-2"],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = engine.getMetrics();
      // All tasks should complete
      assert.strictEqual(metrics.completedTasks, 3);
    });

    it("prevents infinite loop with missing dependencies", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Has missing dependency",
        workDir: process.cwd(),
        priority: 0,
        dependencies: ["non-existent-task"],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Task should remain queued (not crash or loop)
      const status = engine.getTaskStatus("task-1");
      assert.strictEqual(status?.state, "queued");
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.queuedTasks, 1);
    });

    it("handles mix of successful and failed dependencies", async () => {
      // Create a fresh engine and process manager for this test
      const testProcessManager = new MockProcessManager();
      const testEngine = new SimpleExecutionEngine(testProcessManager);

      // task-1 succeeds
      testProcessManager.shouldFail = false;
      await testEngine.submitTask({
        id: "task-1",
        type: "issue",
        prompt: "Will succeed",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      });

      // Wait for task-1 to complete
      await new Promise((resolve) => setTimeout(resolve, 25));

      // task-2 fails
      testProcessManager.shouldFail = true;
      await testEngine.submitTask({
        id: "task-2",
        type: "issue",
        prompt: "Will fail",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      });

      // Wait for task-2 to complete/fail
      await new Promise((resolve) => setTimeout(resolve, 25));

      // task-3 depends on both (one succeeded, one failed)
      testProcessManager.shouldFail = false;
      await testEngine.submitTask({
        id: "task-3",
        type: "issue",
        prompt: "Depends on both",
        workDir: process.cwd(),
        priority: 0,
        dependencies: ["task-1", "task-2"],
        createdAt: new Date(),
        config: {},
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // task-1 should succeed, task-2 and task-3 should fail
      const metrics = testEngine.getMetrics();
      assert.strictEqual(metrics.completedTasks, 1); // Only task-1
      assert.strictEqual(metrics.failedTasks, 2); // task-2 and task-3
    });
  });
});
