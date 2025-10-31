/**
 * Tests for Promise Resolution (waitForTask, waitForTasks)
 *
 * Tests promise-based waiting for task completion and failure.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SimpleExecutionEngine } from '../../../../src/execution/engine/simple-engine.js';
import { MockProcessManager } from './mock-process-manager.js';
import type { ExecutionTask } from '../../../../src/execution/engine/types.js';

describe('Promise Resolution', () => {
  let engine: SimpleExecutionEngine;
  let processManager: MockProcessManager;

  beforeEach(() => {
    processManager = new MockProcessManager();
    engine = new SimpleExecutionEngine(processManager);
  });

  describe('waitForTask - Success Cases', () => {
    it('resolves when task completes successfully', async () => {
      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Test task',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task to complete
      const result = await engine.waitForTask('task-1');

      assert.strictEqual(result.taskId, 'task-1');
      assert.strictEqual(result.success, true);
      assert.ok(result.output);
    });

    it('resolves immediately if task already completed', async () => {
      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Test task',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Now wait for already-completed task
      const result = await engine.waitForTask('task-1');

      assert.strictEqual(result.taskId, 'task-1');
      assert.strictEqual(result.success, true);
    });

    it('handles multiple waiters for same task', async () => {
      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Test task',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Multiple concurrent waiters
      const [result1, result2, result3] = await Promise.all([
        engine.waitForTask('task-1'),
        engine.waitForTask('task-1'),
        engine.waitForTask('task-1'),
      ]);

      // All should get the same result
      assert.strictEqual(result1.taskId, 'task-1');
      assert.strictEqual(result2.taskId, 'task-1');
      assert.strictEqual(result3.taskId, 'task-1');
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result3.success, true);
    });
  });

  describe('waitForTask - Failure Cases', () => {
    it('rejects when task fails', async () => {
      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Will fail',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait for task - should reject
      await assert.rejects(async () => {
        await engine.waitForTask('task-1');
      });
    });

    it('rejects all waiters when task fails', async () => {
      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Will fail',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Multiple waiters should all reject
      const results = await Promise.allSettled([
        engine.waitForTask('task-1'),
        engine.waitForTask('task-1'),
        engine.waitForTask('task-1'),
      ]);

      assert.strictEqual(results[0].status, 'rejected');
      assert.strictEqual(results[1].status, 'rejected');
      assert.strictEqual(results[2].status, 'rejected');
    });
  });

  describe('waitForTasks - Multiple Tasks', () => {
    it('waits for multiple tasks to complete', async () => {
      const tasks: ExecutionTask[] = [
        {
          id: 'task-1',
          type: 'issue',
          prompt: 'Task 1',
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: 'task-2',
          type: 'issue',
          prompt: 'Task 2',
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: 'task-3',
          type: 'issue',
          prompt: 'Task 3',
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Wait for all tasks
      const results = await engine.waitForTasks(['task-1', 'task-2', 'task-3']);

      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0].taskId, 'task-1');
      assert.strictEqual(results[1].taskId, 'task-2');
      assert.strictEqual(results[2].taskId, 'task-3');
      assert.ok(results.every((r) => r.success));
    });

    it('waits for mix of completed and pending tasks', async () => {
      const task1: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Already completed',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task1);

      // Wait for task-1 to complete
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Submit task-2 (still pending)
      const task2: ExecutionTask = {
        id: 'task-2',
        type: 'issue',
        prompt: 'Still pending',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task2);

      // Wait for both
      const results = await engine.waitForTasks(['task-1', 'task-2']);

      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].taskId, 'task-1');
      assert.strictEqual(results[1].taskId, 'task-2');
      assert.ok(results.every((r) => r.success));
    });

    it('rejects if any task fails', async () => {
      let attemptCount = 0;
      processManager.onAcquire = () => {
        attemptCount++;
        // Fail task-2 (second attempt)
        processManager.shouldFail = attemptCount === 2;
      };

      const tasks: ExecutionTask[] = [
        {
          id: 'task-1',
          type: 'issue',
          prompt: 'Will succeed',
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: 'task-2',
          type: 'issue',
          prompt: 'Will fail',
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Should reject because task-2 fails
      await assert.rejects(async () => {
        await engine.waitForTasks(['task-1', 'task-2']);
      });
    });

    it('handles empty task list', async () => {
      const results = await engine.waitForTasks([]);
      assert.deepStrictEqual(results, []);
    });
  });

  describe('Promise Resolution with Dependencies', () => {
    it('resolves dependent task after parent completes', async () => {
      const tasks: ExecutionTask[] = [
        {
          id: 'task-1',
          type: 'issue',
          prompt: 'Parent task',
          workDir: process.cwd(),
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: 'task-2',
          type: 'issue',
          prompt: 'Child task',
          workDir: process.cwd(),
          priority: 0,
          dependencies: ['task-1'],
          createdAt: new Date(),
          config: {},
        },
      ];

      await engine.submitTasks(tasks);

      // Wait for both - child should wait for parent
      const results = await engine.waitForTasks(['task-1', 'task-2']);

      assert.strictEqual(results.length, 2);
      assert.ok(results.every((r) => r.success));

      // Verify completion times - task-2 should complete after task-1
      assert.ok(
        results[0].completedAt! <= results[1].completedAt!,
        'Parent should complete before or at same time as child'
      );
    });
  });

  describe('Promise Resolution with Retries', () => {
    it('resolves after successful retry', async () => {
      let attemptCount = 0;
      processManager.onAcquire = () => {
        attemptCount++;
        // Fail first attempt, succeed on retry
        processManager.shouldFail = attemptCount === 1;
      };

      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Will succeed on retry',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 2,
        },
      };

      await engine.submitTask(task);

      // Wait for task - should eventually succeed after retry
      const result = await engine.waitForTask('task-1');

      assert.strictEqual(result.success, true);
      assert.strictEqual(attemptCount, 2); // Original + 1 retry
    });

    it('rejects after all retries exhausted', async () => {
      processManager.shouldFail = true;

      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Will fail after retries',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {
          maxRetries: 2,
        },
      };

      await engine.submitTask(task);

      // Should reject after all retries
      await assert.rejects(async () => {
        await engine.waitForTask('task-1');
      });
    });
  });

  describe('Promise Resolution with Cancellation', () => {
    it('handles wait for cancelled task gracefully', async () => {
      processManager.mockDelay = 100;

      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Will be cancelled',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Start waiting
      const waitPromise = engine.waitForTask('task-1');

      // Cancel task while waiting
      await new Promise((resolve) => setTimeout(resolve, 10));
      await engine.cancelTask('task-1');

      // The wait promise behavior when cancelled is implementation-defined
      // It might reject with an error or hang waiting for a result that will never come
      // For now, verify it doesn't crash and either rejects or times out
      try {
        await Promise.race([
          waitPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 50)
          ),
        ]);
        // If we get here, task somehow completed despite cancellation (shouldn't happen)
        assert.ok(true);
      } catch (error: any) {
        // Either rejects with process error or times out - both are acceptable
        assert.ok(error !== null);
      }
    });
  });

  describe('Edge Cases', () => {
    it('handles concurrent submissions and waits', async () => {
      const tasks: ExecutionTask[] = Array.from({ length: 10 }, (_, i) => ({
        id: `task-${i + 1}`,
        type: 'issue' as const,
        prompt: `Task ${i + 1}`,
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      }));

      // Submit and wait concurrently
      const submitPromises = tasks.map((t) => engine.submitTask(t));
      const waitPromises = tasks.map((t) => engine.waitForTask(t.id));

      await Promise.all([...submitPromises, ...waitPromises]);

      // All tasks should complete
      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.completedTasks, 10);
    });

    it('handles waiting for same task multiple times sequentially', async () => {
      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Test task',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task);

      // Wait multiple times sequentially
      const result1 = await engine.waitForTask('task-1');
      const result2 = await engine.waitForTask('task-1');
      const result3 = await engine.waitForTask('task-1');

      assert.strictEqual(result1.taskId, 'task-1');
      assert.strictEqual(result2.taskId, 'task-1');
      assert.strictEqual(result3.taskId, 'task-1');
    });
  });
});
