/**
 * Retry Logic and Backoff Strategies
 *
 * Implements retry logic with various backoff strategies including
 * exponential, linear, and fixed delays with optional jitter.
 *
 * @module execution/resilience/retry
 */

import type { RetryPolicy, ExecutionAttempt } from './types.js';
import type { ExecutionResult } from '../engine/types.js';

/**
 * Calculate backoff delay for a given attempt
 *
 * Supports multiple backoff strategies:
 * - Exponential: baseDelay * 2^(attempt-1) - e.g., 1s, 2s, 4s, 8s, 16s
 * - Linear: baseDelay * attempt - e.g., 1s, 2s, 3s, 4s, 5s
 * - Fixed: constant baseDelay - e.g., 1s, 1s, 1s, 1s, 1s
 *
 * Applies maxDelay cap and optional jitter to prevent thundering herd.
 *
 * @param attempt - Attempt number (1-indexed)
 * @param config - Backoff configuration from retry policy
 * @returns Delay in milliseconds
 *
 * @example
 * ```typescript
 * // Exponential backoff with jitter
 * const delay = calculateBackoff(3, {
 *   type: 'exponential',
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   jitter: true,
 * });
 * // Returns ~4000ms ± 10% jitter
 * ```
 */
export function calculateBackoff(
  attempt: number,
  config: RetryPolicy['backoff']
): number {
  let delay: number;

  // Calculate base delay based on strategy
  switch (config.type) {
    case 'exponential':
      // 2^(attempt-1) * baseDelay
      // attempt 1: 2^0 = 1x, attempt 2: 2^1 = 2x, attempt 3: 2^2 = 4x
      delay = config.baseDelayMs * Math.pow(2, attempt - 1);
      break;

    case 'linear':
      // attempt * baseDelay
      // attempt 1: 1x, attempt 2: 2x, attempt 3: 3x
      delay = config.baseDelayMs * attempt;
      break;

    case 'fixed':
      // constant baseDelay
      delay = config.baseDelayMs;
      break;

    default:
      // TypeScript should prevent this, but handle gracefully
      delay = config.baseDelayMs;
  }

  // Enforce maximum delay cap
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter if configured (±10% randomness)
  if (config.jitter) {
    const jitterAmount = delay * 0.1; // 10% of delay
    const jitterOffset = Math.random() * jitterAmount * 2 - jitterAmount;
    delay += jitterOffset;

    // Ensure delay stays positive and doesn't exceed max after jitter
    delay = Math.max(0, Math.min(delay, config.maxDelayMs));
  }

  return Math.floor(delay);
}

/**
 * Check if an error should trigger a retry
 *
 * Matches error message against the list of retryable error patterns
 * defined in the retry policy.
 *
 * @param error - Error that occurred
 * @param policy - Retry policy with retryable error patterns
 * @returns True if error should be retried
 *
 * @example
 * ```typescript
 * const error = new Error('Connection timeout');
 * const shouldRetry = isRetryableError(error, {
 *   retryableErrors: ['timeout', 'ECONNREFUSED'],
 *   // ... other policy fields
 * });
 * // Returns true
 * ```
 */
export function isRetryableError(error: Error, policy: RetryPolicy): boolean {
  const errorMessage = error.message || '';

  // Check if error message contains any retryable pattern
  for (const retryablePattern of policy.retryableErrors) {
    if (errorMessage.includes(retryablePattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an exit code should trigger a retry
 *
 * Matches exit code against the list of retryable exit codes
 * defined in the retry policy.
 *
 * @param exitCode - Process exit code
 * @param policy - Retry policy with retryable exit codes
 * @returns True if exit code should be retried
 *
 * @example
 * ```typescript
 * const shouldRetry = isRetryableExitCode(1, {
 *   retryableExitCodes: [1, 137],
 *   // ... other policy fields
 * });
 * // Returns true
 * ```
 */
export function isRetryableExitCode(
  exitCode: number,
  policy: RetryPolicy
): boolean {
  return policy.retryableExitCodes.includes(exitCode);
}

/**
 * Check if an execution result should trigger a retry
 *
 * Checks both the exit code and error message (if present) to determine
 * if the execution should be retried.
 *
 * @param result - Execution result from task execution
 * @param policy - Retry policy
 * @returns True if execution should be retried
 *
 * @example
 * ```typescript
 * const result: ExecutionResult = {
 *   taskId: 'task-1',
 *   executionId: 'proc-123',
 *   success: false,
 *   exitCode: 1,
 *   error: 'Connection timeout',
 *   // ... other fields
 * };
 *
 * const shouldRetry = isRetryableResult(result, policy);
 * // Returns true if exitCode is retryable OR error contains retryable pattern
 * ```
 */
export function isRetryableResult(
  result: ExecutionResult,
  policy: RetryPolicy
): boolean {
  // Check exit code
  if (result.exitCode !== undefined && result.exitCode !== null) {
    if (isRetryableExitCode(result.exitCode, policy)) {
      return true;
    }
  }

  // Check error message
  if (result.error) {
    const error = new Error(result.error);
    if (isRetryableError(error, policy)) {
      return true;
    }
  }

  return false;
}

/**
 * Promise-based sleep utility
 *
 * Returns a promise that resolves after the specified delay.
 * Useful for implementing retry backoff.
 *
 * @param ms - Delay in milliseconds
 * @returns Promise that resolves after delay
 *
 * @example
 * ```typescript
 * console.log('Starting...');
 * await sleep(1000);
 * console.log('1 second later');
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create an execution attempt record
 *
 * Helper function to create a properly structured ExecutionAttempt object.
 *
 * @param attemptNumber - Attempt number (1-indexed)
 * @param success - Whether the attempt succeeded
 * @param options - Optional fields for the attempt
 * @returns ExecutionAttempt object
 */
export function createAttempt(
  attemptNumber: number,
  success: boolean,
  options: {
    error?: Error;
    exitCode?: number;
    duration?: number;
    willRetry?: boolean;
    nextRetryAt?: Date;
  } = {}
): ExecutionAttempt {
  const now = new Date();

  return {
    attemptNumber,
    startedAt: now,
    completedAt: options.duration !== undefined ? now : undefined,
    duration: options.duration,
    success,
    error: options.error,
    exitCode: options.exitCode,
    willRetry: options.willRetry || false,
    nextRetryAt: options.nextRetryAt,
  };
}

/**
 * Calculate total delay from all retry attempts
 *
 * Sums up all the backoff delays that would be applied for a given
 * number of retry attempts. Useful for timeout calculations.
 *
 * @param maxAttempts - Maximum number of attempts
 * @param backoffConfig - Backoff configuration
 * @returns Total delay in milliseconds
 *
 * @example
 * ```typescript
 * const totalDelay = calculateTotalRetryDelay(3, {
 *   type: 'exponential',
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   jitter: false,
 * });
 * // Returns 7000ms (1s + 2s + 4s)
 * ```
 */
export function calculateTotalRetryDelay(
  maxAttempts: number,
  backoffConfig: RetryPolicy['backoff']
): number {
  let totalDelay = 0;

  // Calculate delay for each attempt (excluding the first one)
  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    totalDelay += calculateBackoff(attempt, backoffConfig);
  }

  return totalDelay;
}
