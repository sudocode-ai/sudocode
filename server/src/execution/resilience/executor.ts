/**
 * Resilient Executor Interface
 *
 * Core abstraction for resilient task execution. Provides methods for
 * executing tasks with retry logic, circuit breakers, and fault tolerance.
 *
 * @module execution/resilience/executor
 */

import type { ExecutionTask } from '../engine/types.js';
import type {
  RetryPolicy,
  CircuitBreaker,
  RetryMetrics,
  ResilientExecutionResult,
  RetryAttemptHandler,
  CircuitOpenHandler,
} from './types.js';

/**
 * IResilientExecutor - Interface for resilient task execution
 *
 * Defines the contract for executors that add resilience patterns
 * (retry, circuit breaker) to task execution. Implementations wrap
 * the Engine Layer with fault tolerance mechanisms.
 *
 * @example
 * ```typescript
 * const executor = new ResilientExecutor(engine, {
 *   maxAttempts: 3,
 *   backoff: {
 *     type: 'exponential',
 *     baseDelayMs: 1000,
 *     maxDelayMs: 30000,
 *     jitter: true,
 *   },
 *   retryableErrors: ['timeout', 'ECONNREFUSED'],
 *   retryableExitCodes: [1],
 * });
 *
 * const result = await executor.executeTask(task);
 * console.log(`Success after ${result.totalAttempts} attempts`);
 * ```
 */
export interface IResilientExecutor {
  // ========================================
  // Resilient Execution
  // ========================================

  /**
   * Execute a single task with retry and circuit breaker
   *
   * Attempts to execute the task, retrying on transient failures according
   * to the retry policy. Checks circuit breaker before execution to prevent
   * cascading failures.
   *
   * @param task - The task to execute
   * @param policy - Optional retry policy (uses default if not provided)
   * @returns Promise resolving to enhanced result with retry information
   * @throws Error if circuit breaker is open or max retries exceeded
   */
  executeTask(
    task: ExecutionTask,
    policy?: RetryPolicy
  ): Promise<ResilientExecutionResult>;

  /**
   * Execute multiple tasks with retry and circuit breaker
   *
   * Executes all tasks in parallel, each with its own retry logic.
   * Tasks of the same type share a circuit breaker.
   *
   * @param tasks - Array of tasks to execute
   * @param policy - Optional retry policy for all tasks
   * @returns Promise resolving to array of enhanced results
   */
  executeTasks(
    tasks: ExecutionTask[],
    policy?: RetryPolicy
  ): Promise<ResilientExecutionResult[]>;

  // ========================================
  // Circuit Breaker Management
  // ========================================

  /**
   * Get circuit breaker by name
   *
   * Circuit breakers are typically named by task type (e.g., 'issue', 'spec').
   * Returns null if no circuit breaker exists for the given name.
   *
   * @param name - Name of the circuit breaker
   * @returns Circuit breaker or null if not found
   */
  getCircuitBreaker(name: string): CircuitBreaker | null;

  /**
   * Reset a circuit breaker to closed state
   *
   * Manually resets a circuit breaker, clearing failure counts and
   * returning it to the closed state. Useful for recovery after
   * fixing underlying issues.
   *
   * @param name - Name of the circuit breaker to reset
   */
  resetCircuitBreaker(name: string): void;

  // ========================================
  // Monitoring
  // ========================================

  /**
   * Get aggregate retry metrics
   *
   * Returns statistics about retry behavior across all tasks,
   * including circuit breaker states.
   *
   * @returns Retry metrics (defensive copy)
   */
  getRetryMetrics(): RetryMetrics;

  /**
   * Register handler for retry attempt events
   *
   * Called whenever a task is retried after a failure. Useful for
   * logging, alerting, or monitoring retry patterns.
   *
   * @param handler - Callback function to invoke on each retry
   */
  onRetryAttempt(handler: RetryAttemptHandler): void;

  /**
   * Register handler for circuit breaker open events
   *
   * Called when a circuit breaker transitions from closed/half-open
   * to open state. Useful for alerting on service degradation.
   *
   * @param handler - Callback function to invoke when circuit opens
   */
  onCircuitOpen(handler: CircuitOpenHandler): void;
}
