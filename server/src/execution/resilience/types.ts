/**
 * Resilience Layer Types
 *
 * Core types for the Resilience Layer (Layer 3) that adds retry logic,
 * circuit breakers, and fault tolerance to task execution.
 *
 * @module execution/resilience/types
 */

import type { ExecutionResult } from '../engine/types.js';

/**
 * RetryPolicy - Configuration for retry behavior
 */
export interface RetryPolicy {
  /**
   * Maximum number of retry attempts (0 = no retry)
   */
  maxAttempts: number;

  /**
   * Backoff strategy configuration
   */
  backoff: {
    /**
     * Type of backoff strategy
     * - exponential: delay = baseDelay * 2^(attempt-1)
     * - linear: delay = baseDelay * attempt
     * - fixed: delay = baseDelay (constant)
     */
    type: 'exponential' | 'linear' | 'fixed';

    /**
     * Initial delay in milliseconds
     */
    baseDelayMs: number;

    /**
     * Maximum delay cap in milliseconds
     */
    maxDelayMs: number;

    /**
     * Add randomness to prevent thundering herd
     * Adds ±10% jitter to delay
     */
    jitter: boolean;
  };

  /**
   * Error types/messages that should trigger a retry
   * Examples: 'ECONNREFUSED', 'timeout', 'network'
   */
  retryableErrors: string[];

  /**
   * Exit codes that should trigger a retry
   * Examples: [1, 137] for generic error and SIGKILL
   */
  retryableExitCodes: number[];

  /**
   * Optional callback to determine if circuit breaker should open
   */
  shouldOpenCircuit?: (error: Error, attempts: number) => boolean;
}

/**
 * CircuitState - State of a circuit breaker
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * CircuitBreaker - Circuit breaker for preventing cascading failures
 */
export interface CircuitBreaker {
  /**
   * Unique name for this circuit breaker
   * Typically matches the task type (e.g., 'issue', 'spec', 'custom')
   */
  name: string;

  /**
   * Current state of the circuit
   * - closed: Normal operation, requests pass through
   * - open: Too many failures, requests rejected
   * - half-open: Testing if service recovered, limited requests allowed
   */
  state: CircuitState;

  /**
   * Circuit breaker configuration
   */
  config: {
    /**
     * Number of consecutive failures before opening circuit
     */
    failureThreshold: number;

    /**
     * Number of consecutive successes in half-open to close circuit
     */
    successThreshold: number;

    /**
     * Time to wait before transitioning from open to half-open (ms)
     */
    timeout: number;
  };

  /**
   * Circuit breaker metrics
   */
  metrics: {
    /**
     * Total requests processed
     */
    totalRequests: number;

    /**
     * Total failed requests
     */
    failedRequests: number;

    /**
     * Total successful requests
     */
    successfulRequests: number;

    /**
     * Timestamp of last failure
     */
    lastFailureTime?: Date;

    /**
     * Timestamp of last success
     */
    lastSuccessTime?: Date;
  };
}

/**
 * ExecutionAttempt - Record of a single execution attempt
 */
export interface ExecutionAttempt {
  /**
   * Attempt number (1-indexed)
   */
  attemptNumber: number;

  /**
   * When this attempt started
   */
  startedAt: Date;

  /**
   * When this attempt completed (if finished)
   */
  completedAt?: Date;

  /**
   * Duration of this attempt in milliseconds
   */
  duration?: number;

  /**
   * Whether this attempt succeeded
   */
  success: boolean;

  /**
   * Error that occurred during this attempt
   */
  error?: Error;

  /**
   * Exit code from this attempt
   */
  exitCode?: number;

  /**
   * Whether another retry will be attempted after this
   */
  willRetry: boolean;

  /**
   * When the next retry will occur (if willRetry is true)
   */
  nextRetryAt?: Date;
}

/**
 * ResilientExecutionResult - Enhanced execution result with retry information
 *
 * Extends the base ExecutionResult with detailed retry tracking
 */
export interface ResilientExecutionResult extends ExecutionResult {
  /**
   * All execution attempts made for this task
   */
  attempts: ExecutionAttempt[];

  /**
   * Total number of attempts made
   */
  totalAttempts: number;

  /**
   * The final attempt (may be success or failure)
   */
  finalAttempt: ExecutionAttempt;

  /**
   * Human-readable reason for failure (if failed)
   */
  failureReason?: string;

  /**
   * Whether the circuit breaker prevented execution
   */
  circuitBreakerTriggered?: boolean;
}

/**
 * RetryMetrics - Aggregate metrics for retry behavior
 */
export interface RetryMetrics {
  /**
   * Total number of retries attempted across all tasks
   */
  totalRetries: number;

  /**
   * Number of retries that eventually succeeded
   */
  successfulRetries: number;

  /**
   * Number of retries that ultimately failed
   */
  failedRetries: number;

  /**
   * Average number of attempts needed for successful tasks
   */
  averageAttemptsToSuccess: number;

  /**
   * Circuit breakers by name
   */
  circuitBreakers: Map<string, CircuitBreaker>;
}

/**
 * RetryAttemptHandler - Callback for retry attempt events
 */
export type RetryAttemptHandler = (
  taskId: string,
  attempt: ExecutionAttempt
) => void;

/**
 * CircuitOpenHandler - Callback for circuit breaker open events
 */
export type CircuitOpenHandler = (
  circuitName: string,
  breaker: CircuitBreaker
) => void;

/**
 * Default retry policy for resilient execution
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: {
    type: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: true,
  },
  retryableErrors: [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'timeout',
    'network',
    'Process execution timeout',
  ],
  retryableExitCodes: [1, 137], // Generic error, SIGKILL
};
