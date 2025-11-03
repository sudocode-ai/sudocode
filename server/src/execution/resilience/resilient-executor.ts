/**
 * Resilient Executor Implementation
 *
 * Implements resilient task execution with retry logic and circuit breakers.
 * Wraps the Engine Layer with fault tolerance mechanisms.
 *
 * @module execution/resilience/resilient-executor
 */

import type { IExecutionEngine } from "../engine/engine.js";
import type { ExecutionTask, ExecutionResult } from "../engine/types.js";
import type { IResilientExecutor } from "./executor.js";
import type {
  RetryPolicy,
  CircuitBreaker,
  RetryMetrics,
  ResilientExecutionResult,
  ExecutionAttempt,
  RetryAttemptHandler,
  CircuitOpenHandler,
} from "./types.js";

import { CircuitBreakerManager } from "./circuit-breaker.js";
import {
  calculateBackoff,
  isRetryableResult,
  sleep,
  createAttempt,
} from "./retry.js";
import { DEFAULT_RETRY_POLICY } from "./types.js";

/**
 * ResilientExecutor - Main implementation of resilient task execution
 *
 * Provides retry logic and circuit breaker protection for task execution.
 * Wraps an IExecutionEngine with fault tolerance mechanisms.
 *
 * @example
 * ```typescript
 * const engine = new SimpleExecutionEngine(processManager);
 * const executor = new ResilientExecutor(engine);
 *
 * const task: ExecutionTask = {
 *   id: 'task-1',
 *   type: 'issue',
 *   prompt: 'Fix the bug in authentication',
 *   workDir: '/path/to/project',
 *   priority: 0,
 *   dependencies: [],
 *   createdAt: new Date(),
 *   config: {},
 * };
 *
 * const result = await executor.executeTask(task);
 * console.log(`Completed after ${result.totalAttempts} attempts`);
 * ```
 */
export class ResilientExecutor implements IResilientExecutor {
  private _engine: IExecutionEngine;
  private _circuitManager: CircuitBreakerManager;
  private _defaultPolicy: RetryPolicy;
  private _metrics: RetryMetrics;

  // Event handlers
  private _retryHandlers: RetryAttemptHandler[] = [];
  private _circuitOpenHandlers: CircuitOpenHandler[] = [];

  constructor(
    engine: IExecutionEngine,
    defaultPolicy: RetryPolicy = DEFAULT_RETRY_POLICY
  ) {
    this._engine = engine;
    this._circuitManager = new CircuitBreakerManager();
    this._defaultPolicy = defaultPolicy;
    this._metrics = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageAttemptsToSuccess: 0,
      circuitBreakers: new Map<string, CircuitBreaker>(),
    };
  }

  /**
   * Execute a single task with retry and circuit breaker protection
   */
  async executeTask(
    task: ExecutionTask,
    policy?: RetryPolicy
  ): Promise<ResilientExecutionResult> {
    const retryPolicy = policy || this._defaultPolicy;
    const circuitBreakerName = task.type; // Use task type as circuit breaker name
    const attempts: ExecutionAttempt[] = [];

    // Get or create circuit breaker for this task type
    const breaker = this._circuitManager.getOrCreate(circuitBreakerName, {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000,
    });

    // Attempt execution with retries
    for (
      let attemptNumber = 1;
      attemptNumber <= retryPolicy.maxAttempts;
      attemptNumber++
    ) {
      // Check circuit breaker before execution
      if (!this._circuitManager.canExecute(circuitBreakerName)) {
        // Call circuit open handlers
        this._circuitOpenHandlers.forEach((handler) => {
          handler(circuitBreakerName, breaker);
        });

        // Return result indicating circuit breaker triggered
        const circuitOpenResult: ResilientExecutionResult = {
          taskId: task.id,
          executionId: "circuit-breaker-open",
          success: false,
          exitCode: -1,
          output: "",
          error: `Circuit breaker is open for ${circuitBreakerName}`,
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 0,
          attempts: [],
          totalAttempts: 0,
          finalAttempt: createAttempt(0, false, {
            error: new Error(
              `Circuit breaker is open for ${circuitBreakerName}`
            ),
          }),
          circuitBreakerTriggered: true,
        };
        return circuitOpenResult;
      }

      const attemptStart = new Date();

      try {
        // Submit task to engine and wait for result
        const taskId = await this._engine.submitTask(task);
        const result = await this._engine.waitForTask(taskId);

        const attemptDuration = Date.now() - attemptStart.getTime();

        // Check if execution was successful
        if (result.success) {
          // Success! Record in circuit breaker and return
          this._circuitManager.recordSuccess(circuitBreakerName);

          const successAttempt = createAttempt(attemptNumber, true, {
            exitCode: result.exitCode,
            duration: attemptDuration,
          });
          attempts.push(successAttempt);

          // Update metrics for successful retry
          if (attemptNumber > 1) {
            this._metrics.successfulRetries++;
            this._updateAverageAttempts(attemptNumber);
          }

          return this._createResilientResult(result, attempts);
        }

        // Execution completed but failed - check if retryable
        const isRetryable = isRetryableResult(result, retryPolicy);
        const willRetry =
          isRetryable && attemptNumber < retryPolicy.maxAttempts;

        const failureAttempt = createAttempt(attemptNumber, false, {
          error: new Error(result.error || "Task failed"),
          exitCode: result.exitCode,
          duration: attemptDuration,
          willRetry,
        });

        if (willRetry) {
          const backoffDelay = calculateBackoff(
            attemptNumber + 1,
            retryPolicy.backoff
          );
          failureAttempt.nextRetryAt = new Date(Date.now() + backoffDelay);

          // Call retry attempt handlers
          this._retryHandlers.forEach((handler) => {
            handler(task.id, failureAttempt);
          });

          this._metrics.totalRetries++;
          attempts.push(failureAttempt);

          // Wait before retry
          await sleep(backoffDelay);
          continue;
        }

        // Not retryable or max attempts reached - record failure
        attempts.push(failureAttempt);
        this._circuitManager.recordFailure(
          circuitBreakerName,
          new Error(result.error || "Task failed")
        );

        // Update metrics for failed retries
        // Count all retry attempts in this failed task
        if (attemptNumber > 1) {
          this._metrics.failedRetries += attemptNumber - 1;
        }

        return this._createResilientResult(result, attempts);
      } catch (error) {
        // Engine execution error (not a task failure)
        const attemptDuration = Date.now() - attemptStart.getTime();
        const err = error instanceof Error ? error : new Error(String(error));

        const isRetryable = retryPolicy.retryableErrors.some((pattern) =>
          err.message.includes(pattern)
        );
        const willRetry =
          isRetryable && attemptNumber < retryPolicy.maxAttempts;

        const errorAttempt = createAttempt(attemptNumber, false, {
          error: err,
          duration: attemptDuration,
          willRetry,
        });

        if (willRetry) {
          const backoffDelay = calculateBackoff(
            attemptNumber + 1,
            retryPolicy.backoff
          );
          errorAttempt.nextRetryAt = new Date(Date.now() + backoffDelay);

          // Call retry attempt handlers
          this._retryHandlers.forEach((handler) => {
            handler(task.id, errorAttempt);
          });

          this._metrics.totalRetries++;
          attempts.push(errorAttempt);

          // Wait before retry
          await sleep(backoffDelay);
          continue;
        }

        // Not retryable or max attempts reached
        attempts.push(errorAttempt);
        this._circuitManager.recordFailure(circuitBreakerName, err);

        // Update metrics for failed retries
        // Count all retry attempts in this failed task
        if (attemptNumber > 1) {
          this._metrics.failedRetries += attemptNumber - 1;
        }

        throw err;
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error("Unexpected state: exceeded max attempts without return");
  }

  /**
   * Execute multiple tasks with retry and circuit breaker protection
   */
  async executeTasks(
    tasks: ExecutionTask[],
    policy?: RetryPolicy
  ): Promise<ResilientExecutionResult[]> {
    // Execute all tasks in parallel
    const promises = tasks.map((task) => this.executeTask(task, policy));
    return Promise.all(promises);
  }

  /**
   * Get circuit breaker by name
   */
  getCircuitBreaker(name: string): CircuitBreaker | null {
    return this._circuitManager.get(name);
  }

  /**
   * Reset a circuit breaker to closed state
   */
  resetCircuitBreaker(name: string): void {
    this._circuitManager.reset(name);
  }

  /**
   * Get aggregate retry metrics
   */
  getRetryMetrics(): RetryMetrics {
    // Update circuit breakers in metrics
    this._metrics.circuitBreakers = this._circuitManager.getAll();

    // Return defensive copy
    return {
      ...this._metrics,
      circuitBreakers: new Map(this._metrics.circuitBreakers),
    };
  }

  /**
   * Register handler for retry attempt events
   */
  onRetryAttempt(handler: RetryAttemptHandler): void {
    this._retryHandlers.push(handler);
  }

  /**
   * Register handler for circuit breaker open events
   */
  onCircuitOpen(handler: CircuitOpenHandler): void {
    this._circuitOpenHandlers.push(handler);
  }

  /**
   * Helper to create ResilientExecutionResult from engine result
   * @private
   */
  private _createResilientResult(
    result: ExecutionResult,
    attempts: ExecutionAttempt[]
  ): ResilientExecutionResult {
    const finalAttempt = attempts[attempts.length - 1];

    return {
      ...result,
      attempts,
      totalAttempts: attempts.length,
      finalAttempt,
      failureReason: result.success ? undefined : result.error,
    };
  }

  /**
   * Helper to update average attempts to success metric
   * @private
   */
  private _updateAverageAttempts(attemptCount: number): void {
    const totalSuccessful = this._metrics.successfulRetries;
    const previousAverage = this._metrics.averageAttemptsToSuccess;
    const previousTotal = previousAverage * (totalSuccessful - 1);

    this._metrics.averageAttemptsToSuccess =
      (previousTotal + attemptCount) / totalSuccessful;
  }
}
