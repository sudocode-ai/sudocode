/**
 * Tests for Engine Shutdown
 *
 * Tests graceful shutdown, cleanup, and idempotent shutdown behavior.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SimpleExecutionEngine } from "../../../../src/execution/engine/simple-engine.js";
import { MockProcessManager } from "./mock-process-manager.js";
import type { ExecutionTask } from "../../../../src/execution/engine/types.js";

describe("Engine Shutdown", () => {
  let engine: SimpleExecutionEngine;
  let processManager: MockProcessManager;

  beforeEach(() => {
    processManager = new MockProcessManager();
    engine = new SimpleExecutionEngine(processManager);
  });

  describe("Shutdown with Queued Tasks", () => {
    it("clears all queued tasks", async () => {
      // Create engine with 0 concurrency to keep tasks queued
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 0,
      });

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Queued task 1",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Queued task 2",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-3",
          type: "issue",
          prompt: "Queued task 3",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await blockedEngine.submitTasks(tasks);

      // Verify tasks are queued
      const beforeMetrics = blockedEngine.getMetrics();
      assert.strictEqual(beforeMetrics.queuedTasks, 3);

      // Shutdown the engine
      await blockedEngine.shutdown();

      // Verify queue is cleared
      const afterMetrics = blockedEngine.getMetrics();
      assert.strictEqual(afterMetrics.queuedTasks, 0);

      // Verify tasks are no longer accessible
      assert.strictEqual(blockedEngine.getTaskStatus("task-1"), null);
      assert.strictEqual(blockedEngine.getTaskStatus("task-2"), null);
      assert.strictEqual(blockedEngine.getTaskStatus("task-3"), null);
    });
  });

  describe("Shutdown with Running Tasks", () => {
    it("cancels all running tasks", async () => {
      // Increase mock delay so tasks run longer
      processManager.mockDelay = 100;

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Running task 1",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Running task 2",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Wait for tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify tasks are running
      const beforeMetrics = engine.getMetrics();
      assert.ok(beforeMetrics.currentlyRunning > 0);

      // Shutdown the engine
      await engine.shutdown();

      // Verify no tasks are running
      const afterMetrics = engine.getMetrics();
      assert.strictEqual(afterMetrics.currentlyRunning, 0);
      assert.strictEqual(
        afterMetrics.availableSlots,
        afterMetrics.maxConcurrent
      );
    });

    it("terminates processes for running tasks", async () => {
      processManager.mockDelay = 100;

      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Will be terminated",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify process is running
      const beforeProcesses = processManager.getActiveProcesses();
      assert.ok(beforeProcesses.length > 0);

      // Shutdown
      await engine.shutdown();

      // Verify processes are terminated
      const afterProcesses = processManager.getActiveProcesses();
      assert.strictEqual(afterProcesses.length, 0);
    });
  });

  describe("Shutdown with Mixed State", () => {
    it("clears both queued and running tasks", async () => {
      // Create engine with limited concurrency
      const limitedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 1,
      });

      processManager.mockDelay = 100;

      const tasks: ExecutionTask[] = [
        {
          id: "task-1",
          type: "issue",
          prompt: "Will be running",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-2",
          type: "issue",
          prompt: "Will be queued",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: "task-3",
          type: "issue",
          prompt: "Will be queued",
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await limitedEngine.submitTasks(tasks);

      // Wait for first task to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify mixed state
      const beforeMetrics = limitedEngine.getMetrics();
      assert.strictEqual(beforeMetrics.currentlyRunning, 1);
      assert.ok(beforeMetrics.queuedTasks >= 2);

      // Shutdown
      await limitedEngine.shutdown();

      // Verify all tasks cleared
      const afterMetrics = limitedEngine.getMetrics();
      assert.strictEqual(afterMetrics.currentlyRunning, 0);
      assert.strictEqual(afterMetrics.queuedTasks, 0);
    });
  });

  describe("Process Manager Shutdown", () => {
    it("calls shutdown on process manager", async () => {
      let shutdownCalled = false;

      // Override shutdown to track calls
      const originalShutdown = processManager.shutdown.bind(processManager);
      processManager.shutdown = async () => {
        shutdownCalled = true;
        return originalShutdown();
      };

      await engine.shutdown();

      assert.strictEqual(shutdownCalled, true);
    });

    it("waits for process manager shutdown to complete", async () => {
      let shutdownStarted = false;
      let shutdownCompleted = false;

      processManager.shutdown = async () => {
        shutdownStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
        shutdownCompleted = true;
      };

      await engine.shutdown();

      assert.strictEqual(shutdownStarted, true);
      assert.strictEqual(shutdownCompleted, true);
    });
  });

  describe("Internal State Cleanup", () => {
    it("clears all internal state after shutdown", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test task",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Verify task result exists
      const beforeStatus = engine.getTaskStatus("task-1");
      assert.ok(beforeStatus !== null);

      // Shutdown
      await engine.shutdown();

      // Verify all state cleared
      const afterStatus = engine.getTaskStatus("task-1");
      assert.strictEqual(afterStatus, null);
    });

    it("resets metrics after shutdown", async () => {
      const blockedEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 2,
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

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Shutdown
      await blockedEngine.shutdown();

      // Verify metrics reset
      const metrics = blockedEngine.getMetrics();
      assert.strictEqual(metrics.currentlyRunning, 0);
      assert.strictEqual(metrics.queuedTasks, 0);
      assert.strictEqual(metrics.availableSlots, 2); // maxConcurrent
    });
  });

  describe("Idempotent Shutdown", () => {
    it("does not error when called multiple times", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test task",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // First shutdown
      await engine.shutdown();

      // Second shutdown - should not error
      await engine.shutdown();

      // Verify state remains clean
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.currentlyRunning, 0);
      assert.strictEqual(metrics.queuedTasks, 0);
    });

    it("handles shutdown with no tasks gracefully", async () => {
      // Shutdown empty engine - should not error
      await engine.shutdown();

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.currentlyRunning, 0);
      assert.strictEqual(metrics.queuedTasks, 0);
    });
  });

  describe("Shutdown Timing", () => {
    it("completes shutdown within reasonable time", async () => {
      processManager.mockDelay = 50;

      const tasks: ExecutionTask[] = Array.from({ length: 5 }, (_, i) => ({
        id: `task-${i + 1}`,
        type: "issue" as const,
        prompt: `Task ${i + 1}`,
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      }));

      await engine.submitTasks(tasks);

      // Wait for tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      const startTime = Date.now();
      await engine.shutdown();
      const duration = Date.now() - startTime;

      // Shutdown should complete quickly (not wait for tasks to finish naturally)
      // Allow reasonable buffer for termination operations
      assert.ok(
        duration < 200,
        `Shutdown took ${duration}ms, expected < 200ms`
      );
    });
  });

  describe("Event Handlers Cleanup", () => {
    it("clears event handlers after shutdown", async () => {
      let eventsFired = 0;

      // Register handlers
      engine.onTaskComplete(() => {
        eventsFired++;
      });
      engine.onTaskFailed(() => {
        eventsFired++;
      });

      // Shutdown
      await engine.shutdown();

      // Submit new task after shutdown
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "After shutdown",
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Events should not fire after shutdown cleared handlers
      assert.strictEqual(eventsFired, 0);
    });
  });
});
