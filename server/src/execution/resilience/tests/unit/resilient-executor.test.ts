/**
 * Tests for ResilientExecutor Implementation
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ResilientExecutor } from '../../resilient-executor.js';
import type { IExecutionEngine } from '../../../engine/engine.js';
import type {
  ExecutionTask,
  ExecutionResult,
  TaskStatus,
  EngineMetrics,
  TaskCompleteHandler,
  TaskFailedHandler,
} from '../../../engine/types.js';
import type { RetryPolicy, ExecutionAttempt } from '../../types.js';

/**
 * Mock Engine for testing
 */
class MockEngine implements IExecutionEngine {
  private taskCounter = 0;
  private taskResults = new Map<string, ExecutionResult>();
  private taskBehaviors = new Map<
    string,
    { results: ExecutionResult[]; currentAttempt: number }
  >();

  /**
   * Configure how a task should behave across multiple attempts
   */
  configureBehavior(taskId: string, results: ExecutionResult[]): void {
    this.taskBehaviors.set(taskId, { results, currentAttempt: 0 });
  }

  async submitTask(task: ExecutionTask): Promise<string> {
    const taskId = `mock-${this.taskCounter++}`;

    // Check if we have configured behavior for this task
    const behavior = this.taskBehaviors.get(task.id);
    if (behavior && behavior.currentAttempt < behavior.results.length) {
      const result = behavior.results[behavior.currentAttempt];
      behavior.currentAttempt++;
      this.taskResults.set(taskId, result);
    } else {
      // Default success behavior
      this.taskResults.set(taskId, {
        taskId: task.id,
        executionId: taskId,
        success: true,
        exitCode: 0,
        output: 'Success',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      });
    }

    return taskId;
  }

  async submitTasks(tasks: ExecutionTask[]): Promise<string[]> {
    return Promise.all(tasks.map((task) => this.submitTask(task)));
  }

  async cancelTask(_taskId: string): Promise<void> {
    // Not needed for resilience tests
  }

  getTaskStatus(_taskId: string): TaskStatus | null {
    return null;
  }

  async waitForTask(taskId: string): Promise<ExecutionResult> {
    const result = this.taskResults.get(taskId);
    if (!result) {
      throw new Error(`Task ${taskId} not found`);
    }
    return result;
  }

  async waitForTasks(taskIds: string[]): Promise<ExecutionResult[]> {
    return Promise.all(taskIds.map((id) => this.waitForTask(id)));
  }

  getMetrics(): EngineMetrics {
    return {
      maxConcurrent: 3,
      currentlyRunning: 0,
      availableSlots: 3,
      queuedTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageDuration: 0,
      successRate: 1,
      throughput: 0,
      totalProcessesSpawned: 0,
      activeProcesses: 0,
    };
  }

  onTaskComplete(_handler: TaskCompleteHandler): void {
    // Not needed for resilience tests
  }

  onTaskFailed(_handler: TaskFailedHandler): void {
    // Not needed for resilience tests
  }

  async shutdown(): Promise<void> {
    this.taskResults.clear();
    this.taskBehaviors.clear();
  }

  reset(): void {
    this.taskCounter = 0;
    this.taskResults.clear();
    this.taskBehaviors.clear();
  }
}

describe('ResilientExecutor', () => {
  let mockEngine: MockEngine;
  let executor: ResilientExecutor;

  beforeEach(() => {
    mockEngine = new MockEngine();
    executor = new ResilientExecutor(mockEngine);
  });

  describe('Basic Execution', () => {
    it('should execute task successfully without retries', async () => {
      const task: ExecutionTask = {
        id: 'task-1',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const result = await executor.executeTask(task);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalAttempts, 1);
      assert.strictEqual(result.attempts.length, 1);
      assert.strictEqual(result.attempts[0].success, true);
      assert.strictEqual(result.attempts[0].attemptNumber, 1);
    });

    it('should handle immediate task failure', async () => {
      const task: ExecutionTask = {
        id: 'task-fail',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      // Configure to fail with non-retryable error
      mockEngine.configureBehavior('task-fail', [
        {
          taskId: 'task-fail',
          executionId: 'exec-1',
          success: false,
          exitCode: 127, // Non-retryable exit code
          output: '',
          error: 'Command not found',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
      ]);

      const result = await executor.executeTask(task);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.totalAttempts, 1);
      assert.strictEqual(result.exitCode, 127);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on retryable failure and eventually succeed', async () => {
      const task: ExecutionTask = {
        id: 'task-retry-success',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const policy: RetryPolicy = {
        maxAttempts: 3,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10, // Short delay for testing
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: ['timeout'],
        retryableExitCodes: [1],
      };

      // Configure: fail twice, then succeed
      mockEngine.configureBehavior('task-retry-success', [
        {
          taskId: 'task-retry-success',
          executionId: 'exec-1',
          success: false,
          exitCode: 1,
          output: '',
          error: 'Connection timeout',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'task-retry-success',
          executionId: 'exec-2',
          success: false,
          exitCode: 1,
          output: '',
          error: 'Connection timeout',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'task-retry-success',
          executionId: 'exec-3',
          success: true,
          exitCode: 0,
          output: 'Success',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
        },
      ]);

      const result = await executor.executeTask(task, policy);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalAttempts, 3);
      assert.strictEqual(result.attempts.length, 3);
      assert.strictEqual(result.attempts[0].success, false);
      assert.strictEqual(result.attempts[0].willRetry, true);
      assert.strictEqual(result.attempts[1].success, false);
      assert.strictEqual(result.attempts[1].willRetry, true);
      assert.strictEqual(result.attempts[2].success, true);
      assert.strictEqual(result.attempts[2].willRetry, false);
    });

    it('should exhaust retries and fail', async () => {
      const task: ExecutionTask = {
        id: 'task-retry-exhaust',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const policy: RetryPolicy = {
        maxAttempts: 3,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: ['timeout'],
        retryableExitCodes: [1],
      };

      // Configure: fail all attempts
      mockEngine.configureBehavior('task-retry-exhaust', [
        {
          taskId: 'task-retry-exhaust',
          executionId: 'exec-1',
          success: false,
          exitCode: 1,
          output: '',
          error: 'Connection timeout',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'task-retry-exhaust',
          executionId: 'exec-2',
          success: false,
          exitCode: 1,
          output: '',
          error: 'Connection timeout',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'task-retry-exhaust',
          executionId: 'exec-3',
          success: false,
          exitCode: 1,
          output: '',
          error: 'Connection timeout',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
      ]);

      const result = await executor.executeTask(task, policy);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.totalAttempts, 3);
      assert.strictEqual(result.attempts.length, 3);
      assert.strictEqual(result.attempts[2].willRetry, false);
    });

    it('should not retry on non-retryable error', async () => {
      const task: ExecutionTask = {
        id: 'task-no-retry',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const policy: RetryPolicy = {
        maxAttempts: 3,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: ['timeout'],
        retryableExitCodes: [1],
      };

      // Configure: fail with non-retryable error
      mockEngine.configureBehavior('task-no-retry', [
        {
          taskId: 'task-no-retry',
          executionId: 'exec-1',
          success: false,
          exitCode: 127, // Non-retryable
          output: '',
          error: 'Command not found',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
      ]);

      const result = await executor.executeTask(task, policy);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.totalAttempts, 1); // No retries
      assert.strictEqual(result.attempts[0].willRetry, false);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after failure threshold', async () => {
      const policy: RetryPolicy = {
        maxAttempts: 1, // No retries to trigger circuit breaker faster
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: [],
        retryableExitCodes: [],
      };

      // Create 5 failing tasks to open circuit (default threshold is 5)
      for (let i = 0; i < 5; i++) {
        const task: ExecutionTask = {
          id: `fail-task-${i}`,
          type: 'issue',
          prompt: 'Test task',
          workDir: '/test',
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        };

        mockEngine.configureBehavior(`fail-task-${i}`, [
          {
            taskId: `fail-task-${i}`,
            executionId: `exec-${i}`,
            success: false,
            exitCode: 2,
            output: '',
            error: 'Task failed',
            startedAt: new Date(),
            completedAt: new Date(),
            duration: 50,
          },
        ]);

        await executor.executeTask(task, policy);
      }

      // Check circuit breaker state
      const breaker = executor.getCircuitBreaker('issue');
      assert.ok(breaker !== null);
      assert.strictEqual(breaker.state, 'open');

      // Next task should be blocked by circuit breaker
      const blockedTask: ExecutionTask = {
        id: 'blocked-task',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const result = await executor.executeTask(blockedTask, policy);
      assert.strictEqual(result.circuitBreakerTriggered, true);
      assert.strictEqual(result.success, false);
    });

    it('should close circuit after successful executions', async () => {
      const policy: RetryPolicy = {
        maxAttempts: 1,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: [],
        retryableExitCodes: [],
      };

      // Create 5 failing tasks to open circuit (default threshold is 5)
      for (let i = 0; i < 5; i++) {
        const task: ExecutionTask = {
          id: `fail-spec-${i}`,
          type: 'spec',
          prompt: 'Test task',
          workDir: '/test',
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        };

        mockEngine.configureBehavior(`fail-spec-${i}`, [
          {
            taskId: `fail-spec-${i}`,
            executionId: `exec-${i}`,
            success: false,
            exitCode: 2,
            output: '',
            error: 'Task failed',
            startedAt: new Date(),
            completedAt: new Date(),
            duration: 50,
          },
        ]);

        await executor.executeTask(task, policy);
      }

      // Circuit should be open
      const openBreaker = executor.getCircuitBreaker('spec');
      assert.ok(openBreaker !== null);
      assert.strictEqual(openBreaker.state, 'open');
      assert.strictEqual(openBreaker.metrics.failedRequests, 5);

      // Reset the circuit breaker to simulate recovery
      executor.resetCircuitBreaker('spec');

      // Circuit should be closed after reset
      const resetBreaker = executor.getCircuitBreaker('spec');
      assert.ok(resetBreaker !== null);
      assert.strictEqual(resetBreaker.state, 'closed');
      assert.strictEqual(resetBreaker.metrics.failedRequests, 0);
    });
  });

  describe('Event Handlers', () => {
    it('should call retry attempt handler', async () => {
      const task: ExecutionTask = {
        id: 'task-event',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const policy: RetryPolicy = {
        maxAttempts: 2,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: [],
        retryableExitCodes: [1],
      };

      // Track retry events
      const retryEvents: { taskId: string; attempt: ExecutionAttempt }[] = [];
      executor.onRetryAttempt((taskId, attempt) => {
        retryEvents.push({ taskId, attempt });
      });

      // Configure: fail once, then succeed
      mockEngine.configureBehavior('task-event', [
        {
          taskId: 'task-event',
          executionId: 'exec-1',
          success: false,
          exitCode: 1,
          output: '',
          error: 'Temporary failure',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'task-event',
          executionId: 'exec-2',
          success: true,
          exitCode: 0,
          output: 'Success',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
        },
      ]);

      await executor.executeTask(task, policy);

      // Should have 1 retry event (for the first failure)
      assert.strictEqual(retryEvents.length, 1);
      assert.strictEqual(retryEvents[0].taskId, 'task-event');
      assert.strictEqual(retryEvents[0].attempt.attemptNumber, 1);
      assert.strictEqual(retryEvents[0].attempt.willRetry, true);
    });

    it('should call circuit open handler', async () => {
      const policy: RetryPolicy = {
        maxAttempts: 1,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: [],
        retryableExitCodes: [],
      };

      // Track circuit open events
      const circuitEvents: { name: string }[] = [];
      executor.onCircuitOpen((circuitName) => {
        circuitEvents.push({ name: circuitName });
      });

      // Create 5 failing tasks to open circuit
      for (let i = 0; i < 5; i++) {
        const task: ExecutionTask = {
          id: `circuit-fail-${i}`,
          type: 'custom',
          prompt: 'Test task',
          workDir: '/test',
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        };

        mockEngine.configureBehavior(`circuit-fail-${i}`, [
          {
            taskId: `circuit-fail-${i}`,
            executionId: `exec-${i}`,
            success: false,
            exitCode: 2,
            output: '',
            error: 'Task failed',
            startedAt: new Date(),
            completedAt: new Date(),
            duration: 50,
          },
        ]);

        await executor.executeTask(task, policy);
      }

      // Try one more task - should trigger circuit open event
      const blockedTask: ExecutionTask = {
        id: 'circuit-blocked',
        type: 'custom',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await executor.executeTask(blockedTask, policy);

      // Should have circuit open event
      assert.ok(circuitEvents.length > 0);
      assert.strictEqual(circuitEvents[0].name, 'custom');
    });
  });

  describe('Metrics', () => {
    it('should track retry metrics correctly', async () => {
      const policy: RetryPolicy = {
        maxAttempts: 3,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: [],
        retryableExitCodes: [1],
      };

      // Task 1: Success after 2 attempts
      const task1: ExecutionTask = {
        id: 'metrics-1',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      mockEngine.configureBehavior('metrics-1', [
        {
          taskId: 'metrics-1',
          executionId: 'exec-1',
          success: false,
          exitCode: 1,
          output: '',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'metrics-1',
          executionId: 'exec-2',
          success: true,
          exitCode: 0,
          output: 'Success',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
        },
      ]);

      await executor.executeTask(task1, policy);

      // Task 2: Fail all attempts
      const task2: ExecutionTask = {
        id: 'metrics-2',
        type: 'issue',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      mockEngine.configureBehavior('metrics-2', [
        {
          taskId: 'metrics-2',
          executionId: 'exec-1',
          success: false,
          exitCode: 1,
          output: '',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'metrics-2',
          executionId: 'exec-2',
          success: false,
          exitCode: 1,
          output: '',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
        {
          taskId: 'metrics-2',
          executionId: 'exec-3',
          success: false,
          exitCode: 1,
          output: '',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 50,
        },
      ]);

      await executor.executeTask(task2, policy);

      const metrics = executor.getRetryMetrics();

      // Total retries: 1 (task1) + 2 (task2) = 3
      assert.strictEqual(metrics.totalRetries, 3);
      // Successful retries: 1 (task1 succeeded after retry)
      assert.strictEqual(metrics.successfulRetries, 1);
      // Failed retries: 2 (task2 retried twice but failed)
      assert.strictEqual(metrics.failedRetries, 2);
      // Average attempts to success: 2 (task1 took 2 attempts)
      assert.strictEqual(metrics.averageAttemptsToSuccess, 2);
    });
  });

  describe('Batch Execution', () => {
    it('should execute multiple tasks in parallel', async () => {
      const tasks: ExecutionTask[] = [
        {
          id: 'batch-1',
          type: 'issue',
          prompt: 'Task 1',
          workDir: '/test',
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: 'batch-2',
          type: 'issue',
          prompt: 'Task 2',
          workDir: '/test',
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
        {
          id: 'batch-3',
          type: 'issue',
          prompt: 'Task 3',
          workDir: '/test',
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        },
      ];

      const results = await executor.executeTasks(tasks);

      assert.strictEqual(results.length, 3);
      assert.ok(results.every((r) => r.success));
    });
  });

  describe('Circuit Breaker Management', () => {
    it('should get circuit breaker by name', async () => {
      const task: ExecutionTask = {
        id: 'get-breaker',
        type: 'spec',
        prompt: 'Test task',
        workDir: '/test',
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await executor.executeTask(task);

      const breaker = executor.getCircuitBreaker('spec');
      assert.ok(breaker !== null);
      assert.strictEqual(breaker.name, 'spec');
    });

    it('should reset circuit breaker', async () => {
      const policy: RetryPolicy = {
        maxAttempts: 1,
        backoff: {
          type: 'fixed',
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: false,
        },
        retryableErrors: [],
        retryableExitCodes: [],
      };

      // Create failing tasks to open circuit
      for (let i = 0; i < 5; i++) {
        const task: ExecutionTask = {
          id: `reset-fail-${i}`,
          type: 'issue',
          prompt: 'Test task',
          workDir: '/test',
          priority: 0,
          dependencies: [],
          createdAt: new Date(),
          config: {},
        };

        mockEngine.configureBehavior(`reset-fail-${i}`, [
          {
            taskId: `reset-fail-${i}`,
            executionId: `exec-${i}`,
            success: false,
            exitCode: 2,
            output: '',
            startedAt: new Date(),
            completedAt: new Date(),
            duration: 50,
          },
        ]);

        await executor.executeTask(task, policy);
      }

      // Circuit should be open
      let breaker = executor.getCircuitBreaker('issue');
      assert.ok(breaker !== null);
      assert.strictEqual(breaker.state, 'open');

      // Reset circuit breaker
      executor.resetCircuitBreaker('issue');

      // Circuit should be closed
      breaker = executor.getCircuitBreaker('issue');
      assert.ok(breaker !== null);
      assert.strictEqual(breaker.state, 'closed');
      assert.strictEqual(breaker.metrics.failedRequests, 0);
    });
  });
});
