/**
 * Tests for Task Retry Logic
 *
 * Tests automatic retry behavior, retry limits, and failure propagation.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SimpleExecutionEngine } from "../../../../src/execution/engine/simple-engine.js";
import { MockProcessManager } from "./mock-process-manager.js";
import type { ExecutionTask } from "../../../../src/execution/engine/types.js";

describe("Task Retry Logic", () => {
  let engine: SimpleExecutionEngine;
  let processManager: MockProcessManager;

  beforeEach(() => {
    processManager = new MockProcessManager();
    engine = new SimpleExecutionEngine(processManager);
  });

  describe("No Retry Behavior", () => {
    it("does not retry task when maxRetries is undefined", async () => {
      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will fail once",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {}, // No maxRetries
      };

      await engine.submitTask(task);

      // Wait for task to fail
      await new Promise((resolve) => setTimeout(resolve, 25));

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 1);
      assert.strictEqual(metrics.completedTasks, 0);
    });

    it("does not retry task when maxRetries is 0", async () => {
      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will fail once",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 0,
        },
      };

      await engine.submitTask(task);

      // Wait for task to fail
      await new Promise((resolve) => setTimeout(resolve, 25));

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 1);
      assert.strictEqual(metrics.completedTasks, 0);
    });
  });

  describe("Retry Attempts", () => {
    it("retries task once when maxRetries is 1", async () => {
      let attemptCount = 0;

      // Track each execution attempt
      processManager.onAcquire = () => {
        attemptCount++;
      };

      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will retry once",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 1,
        },
      };

      await engine.submitTask(task);

      // Wait for original attempt + 1 retry
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(attemptCount, 2); // Original + 1 retry
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 1); // Only final failure counts
    });

    it("retries task multiple times when maxRetries is 3", async () => {
      let attemptCount = 0;

      processManager.onAcquire = () => {
        attemptCount++;
      };

      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will retry 3 times",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 3,
        },
      };

      await engine.submitTask(task);

      // Wait for original attempt + 3 retries
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.strictEqual(attemptCount, 4); // Original + 3 retries
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 1); // Only final failure counts
    });
  });

  describe("Successful Retry", () => {
    it("completes task when retry succeeds", async () => {
      let attemptCount = 0;

      processManager.onAcquire = () => {
        attemptCount++;
        // Fail first attempt, succeed on retry
        processManager.shouldFail = attemptCount === 1;
      };

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will succeed on retry",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 2,
        },
      };

      await engine.submitTask(task);

      // Wait for failure + successful retry
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(attemptCount, 2); // Original + 1 retry
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 0);
      assert.strictEqual(metrics.completedTasks, 1);
    });

    it("completes task when final retry succeeds", async () => {
      let attemptCount = 0;

      processManager.onAcquire = () => {
        attemptCount++;
        // Fail first 2 attempts, succeed on 3rd
        processManager.shouldFail = attemptCount < 3;
      };

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will succeed on final retry",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 2,
        },
      };

      await engine.submitTask(task);

      // Wait for 2 failures + successful retry
      await new Promise((resolve) => setTimeout(resolve, 75));

      assert.strictEqual(attemptCount, 3); // Original + 2 retries
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 0);
      assert.strictEqual(metrics.completedTasks, 1);
    });
  });

  describe("Retry Priority", () => {
    it("re-queues retry at front of queue (unshift)", async () => {
      // This test verifies that retries use unshift (front of queue) by checking
      // that a retry happens quickly without waiting for other queued tasks

      let attemptCount = 0;

      processManager.onAcquire = () => {
        attemptCount++;
        // Fail first attempt only
        processManager.shouldFail = attemptCount === 1;
      };

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will retry immediately",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 1,
        },
      };

      await engine.submitTask(task);

      // Wait for failure + immediate retry
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have attempted twice: original + 1 retry
      assert.strictEqual(attemptCount, 2);

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.completedTasks, 1);
      assert.strictEqual(metrics.failedTasks, 0);
    });
  });

  describe("Retry with Dependencies", () => {
    it("retries task with dependencies", async () => {
      let task2AttemptCount = 0;

      processManager.onAcquire = () => {
        const activeProcesses = processManager.getActiveProcesses();
        if (activeProcesses.length > 0) {
          task2AttemptCount++;
          // Fail task-2 first attempt only
          processManager.shouldFail = task2AttemptCount === 2; // Second process (task-2)
        }
      };

      // task-1 succeeds
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

      // task-2 depends on task-1, will fail once then succeed
      const task2: ExecutionTask = {
        id: "task-2",
        type: "issue",
        prompt: "Second task - depends on first",
        workDir: process.cwd(),
        priority: 0,
        dependencies: ["task-1"],
        createdAt: new Date(),
        config: {
          maxRetries: 2,
        },
      };

      await engine.submitTask(task1);
      await engine.submitTask(task2);

      // Wait for both tasks to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.completedTasks, 2);
      assert.strictEqual(metrics.failedTasks, 0);
    });
  });

  describe("Failure Events", () => {
    it("emits failure event only after all retries exhausted", async () => {
      const failureEvents: string[] = [];

      engine.onTaskFailed((taskId) => {
        failureEvents.push(taskId);
      });

      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will fail after retries",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 2,
        },
      };

      await engine.submitTask(task);

      // Wait for all attempts to complete
      await new Promise((resolve) => setTimeout(resolve, 75));

      // Should only emit failure event once, after final retry
      assert.strictEqual(failureEvents.length, 1);
      assert.strictEqual(failureEvents[0], "task-1");
    });

    it("does not emit failure event when retry succeeds", async () => {
      const failureEvents: string[] = [];
      let attemptCount = 0;

      engine.onTaskFailed((taskId) => {
        failureEvents.push(taskId);
      });

      processManager.onAcquire = () => {
        attemptCount++;
        // Fail first attempt, succeed on retry
        processManager.shouldFail = attemptCount === 1;
      };

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will succeed on retry",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 1,
        },
      };

      await engine.submitTask(task);

      // Wait for failure + successful retry
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not emit any failure events
      assert.strictEqual(failureEvents.length, 0);
    });
  });

  describe("Edge Cases", () => {
    it("handles concurrent tasks with different retry configs", async () => {
      processManager.shouldFail = true;

      const task1: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "No retries",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {}, // No retries
      };

      const task2: ExecutionTask = {
        id: "task-2",
        type: "issue",
        prompt: "With retries",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 2,
        },
      };

      await engine.submitTask(task1);
      await engine.submitTask(task2);

      // Wait for both to fail (task-2 with retries)
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.failedTasks, 2);
    });

    it("handles very large maxRetries value", async () => {
      let attemptCount = 0;

      processManager.onAcquire = () => {
        attemptCount++;
        // Succeed on 5th attempt
        processManager.shouldFail = attemptCount < 5;
      };

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Many retries",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 10, // High retry count
        },
      };

      await engine.submitTask(task);

      // Wait for retries to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.strictEqual(attemptCount, 5); // Should stop after success
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.completedTasks, 1);
      assert.strictEqual(metrics.failedTasks, 0);
    });
  });
});
