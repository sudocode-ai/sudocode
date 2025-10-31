/**
 * Tests for Retry Logic and Backoff Strategies
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  calculateBackoff,
  isRetryableError,
  isRetryableExitCode,
  isRetryableResult,
  sleep,
  createAttempt,
  calculateTotalRetryDelay,
} from '../../../../src/execution/resilience/retry.js';
import type { RetryPolicy } from '../../../../src/execution/resilience/types.js';
import type { ExecutionResult } from '../../../../src/execution/engine/types.js';

describe('Retry Logic', () => {
  describe('calculateBackoff', () => {
    describe('exponential backoff', () => {
      it('should calculate exponential backoff correctly', () => {
        const config = {
          type: 'exponential' as const,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitter: false,
        };

        // 2^0 = 1x
        assert.strictEqual(calculateBackoff(1, config), 1000);
        // 2^1 = 2x
        assert.strictEqual(calculateBackoff(2, config), 2000);
        // 2^2 = 4x
        assert.strictEqual(calculateBackoff(3, config), 4000);
        // 2^3 = 8x
        assert.strictEqual(calculateBackoff(4, config), 8000);
        // 2^4 = 16x
        assert.strictEqual(calculateBackoff(5, config), 16000);
      });

      it('should enforce maxDelay cap', () => {
        const config = {
          type: 'exponential' as const,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          jitter: false,
        };

        // Would be 8000 but capped at 5000
        assert.strictEqual(calculateBackoff(4, config), 5000);
        // Would be 16000 but capped at 5000
        assert.strictEqual(calculateBackoff(5, config), 5000);
      });

      it('should add jitter when enabled', () => {
        const config = {
          type: 'exponential' as const,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitter: true,
        };

        // Run multiple times to test jitter randomness
        const delays: number[] = [];
        for (let i = 0; i < 10; i++) {
          delays.push(calculateBackoff(2, config));
        }

        // All delays should be around 2000ms
        const baseDelay = 2000;
        const minExpected = baseDelay * 0.9; // 1800
        const maxExpected = baseDelay * 1.1; // 2200

        delays.forEach((delay) => {
          assert.ok(
            delay >= minExpected && delay <= maxExpected,
            `Delay ${delay} should be between ${minExpected} and ${maxExpected}`
          );
        });

        // At least some variation should exist
        const uniqueDelays = new Set(delays);
        assert.ok(uniqueDelays.size > 1, 'Jitter should create variation in delays');
      });

      it('should not exceed maxDelay even with jitter', () => {
        const config = {
          type: 'exponential' as const,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          jitter: true,
        };

        // Run multiple times with jitter
        for (let i = 0; i < 20; i++) {
          const delay = calculateBackoff(10, config);
          assert.ok(
            delay <= 5000 && delay >= 0,
            `Delay ${delay} should be between 0 and 5000`
          );
        }
      });
    });

    describe('linear backoff', () => {
      it('should calculate linear backoff correctly', () => {
        const config = {
          type: 'linear' as const,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitter: false,
        };

        // 1 * 1000
        assert.strictEqual(calculateBackoff(1, config), 1000);
        // 2 * 1000
        assert.strictEqual(calculateBackoff(2, config), 2000);
        // 3 * 1000
        assert.strictEqual(calculateBackoff(3, config), 3000);
        // 4 * 1000
        assert.strictEqual(calculateBackoff(4, config), 4000);
        // 5 * 1000
        assert.strictEqual(calculateBackoff(5, config), 5000);
      });

      it('should enforce maxDelay cap', () => {
        const config = {
          type: 'linear' as const,
          baseDelayMs: 1000,
          maxDelayMs: 3500,
          jitter: false,
        };

        // Would be 4000 but capped at 3500
        assert.strictEqual(calculateBackoff(4, config), 3500);
        // Would be 5000 but capped at 3500
        assert.strictEqual(calculateBackoff(5, config), 3500);
      });
    });

    describe('fixed backoff', () => {
      it('should return constant delay', () => {
        const config = {
          type: 'fixed' as const,
          baseDelayMs: 2000,
          maxDelayMs: 30000,
          jitter: false,
        };

        // All attempts should return same delay
        assert.strictEqual(calculateBackoff(1, config), 2000);
        assert.strictEqual(calculateBackoff(2, config), 2000);
        assert.strictEqual(calculateBackoff(3, config), 2000);
        assert.strictEqual(calculateBackoff(10, config), 2000);
      });
    });
  });

  describe('isRetryableError', () => {
    let policy: RetryPolicy;

    beforeEach(() => {
      policy = {
        maxAttempts: 3,
        backoff: {
          type: 'exponential',
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitter: true,
        },
        retryableErrors: ['timeout', 'ECONNREFUSED', 'network error'],
        retryableExitCodes: [1, 137],
      };
    });

    it('should return true for retryable errors', () => {
      assert.strictEqual(isRetryableError(new Error('Connection timeout'), policy), true);
      assert.strictEqual(isRetryableError(new Error('ECONNREFUSED'), policy), true);
      assert.strictEqual(isRetryableError(new Error('network error occurred'), policy), true);
    });

    it('should return false for non-retryable errors', () => {
      assert.strictEqual(isRetryableError(new Error('Permission denied'), policy), false);
      assert.strictEqual(isRetryableError(new Error('File not found'), policy), false);
      assert.strictEqual(isRetryableError(new Error('Invalid input'), policy), false);
    });

    it('should handle errors with empty messages', () => {
      assert.strictEqual(isRetryableError(new Error(''), policy), false);
    });

    it('should be case-sensitive by default', () => {
      assert.strictEqual(isRetryableError(new Error('TIMEOUT'), policy), false);
      assert.strictEqual(isRetryableError(new Error('timeout'), policy), true);
    });
  });

  describe('isRetryableExitCode', () => {
    let policy: RetryPolicy;

    beforeEach(() => {
      policy = {
        maxAttempts: 3,
        backoff: {
          type: 'exponential',
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitter: true,
        },
        retryableErrors: ['timeout'],
        retryableExitCodes: [1, 137, 143],
      };
    });

    it('should return true for retryable exit codes', () => {
      assert.strictEqual(isRetryableExitCode(1, policy), true);
      assert.strictEqual(isRetryableExitCode(137, policy), true);
      assert.strictEqual(isRetryableExitCode(143, policy), true);
    });

    it('should return false for non-retryable exit codes', () => {
      assert.strictEqual(isRetryableExitCode(0, policy), false);
      assert.strictEqual(isRetryableExitCode(2, policy), false);
      assert.strictEqual(isRetryableExitCode(127, policy), false);
    });
  });

  describe('isRetryableResult', () => {
    let policy: RetryPolicy;

    beforeEach(() => {
      policy = {
        maxAttempts: 3,
        backoff: {
          type: 'exponential',
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitter: true,
        },
        retryableErrors: ['timeout', 'ECONNREFUSED'],
        retryableExitCodes: [1, 137],
      };
    });

    it('should return true for retryable exit codes', () => {
      const result: ExecutionResult = {
        taskId: 'task-1',
        executionId: 'exec-1',
        success: false,
        exitCode: 1,
        output: '',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      };

      assert.strictEqual(isRetryableResult(result, policy), true);
    });

    it('should return true for retryable errors', () => {
      const result: ExecutionResult = {
        taskId: 'task-1',
        executionId: 'exec-1',
        success: false,
        exitCode: 0,
        output: '',
        error: 'Connection timeout',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      };

      assert.strictEqual(isRetryableResult(result, policy), true);
    });

    it('should return true if either exit code or error is retryable', () => {
      const result: ExecutionResult = {
        taskId: 'task-1',
        executionId: 'exec-1',
        success: false,
        exitCode: 1,
        output: '',
        error: 'Some other error',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      };

      assert.strictEqual(isRetryableResult(result, policy), true);
    });

    it('should return false for non-retryable results', () => {
      const result: ExecutionResult = {
        taskId: 'task-1',
        executionId: 'exec-1',
        success: false,
        exitCode: 2,
        output: '',
        error: 'Permission denied',
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      };

      assert.strictEqual(isRetryableResult(result, policy), false);
    });
  });

  describe('sleep', () => {
    it('should delay for specified time', async () => {
      const start = Date.now();
      await sleep(100);
      const elapsed = Date.now() - start;

      // Allow some tolerance for timer accuracy
      assert.ok(elapsed >= 90 && elapsed < 150, `Elapsed time ${elapsed}ms should be around 100ms`);
    });

    it('should work with zero delay', async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;

      assert.ok(elapsed < 50, `Zero delay should complete quickly, took ${elapsed}ms`);
    });
  });

  describe('createAttempt', () => {
    it('should create basic attempt', () => {
      const attempt = createAttempt(1, true);

      assert.strictEqual(attempt.attemptNumber, 1);
      assert.strictEqual(attempt.success, true);
      assert.ok(attempt.startedAt instanceof Date);
      assert.strictEqual(attempt.willRetry, false);
      assert.strictEqual(attempt.completedAt, undefined);
      assert.strictEqual(attempt.duration, undefined);
    });

    it('should include optional fields', () => {
      const error = new Error('Test error');
      const nextRetryAt = new Date(Date.now() + 1000);

      const attempt = createAttempt(2, false, {
        error,
        exitCode: 1,
        duration: 500,
        willRetry: true,
        nextRetryAt,
      });

      assert.strictEqual(attempt.attemptNumber, 2);
      assert.strictEqual(attempt.success, false);
      assert.strictEqual(attempt.error, error);
      assert.strictEqual(attempt.exitCode, 1);
      assert.strictEqual(attempt.duration, 500);
      assert.strictEqual(attempt.willRetry, true);
      assert.strictEqual(attempt.nextRetryAt, nextRetryAt);
      assert.ok(attempt.completedAt instanceof Date);
    });
  });

  describe('calculateTotalRetryDelay', () => {
    it('should calculate total delay for exponential backoff', () => {
      const config = {
        type: 'exponential' as const,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: false,
      };

      // 3 attempts: no delay for 1st, 2000 for 2nd, 4000 for 3rd = 6000 total
      const total = calculateTotalRetryDelay(3, config);
      assert.strictEqual(total, 6000);
    });

    it('should calculate total delay for linear backoff', () => {
      const config = {
        type: 'linear' as const,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: false,
      };

      // 3 attempts: no delay for 1st, 2000 for 2nd, 3000 for 3rd = 5000 total
      const total = calculateTotalRetryDelay(3, config);
      assert.strictEqual(total, 5000);
    });

    it('should calculate total delay for fixed backoff', () => {
      const config = {
        type: 'fixed' as const,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: false,
      };

      // 3 attempts: no delay for 1st, 1000 for 2nd, 1000 for 3rd = 2000 total
      const total = calculateTotalRetryDelay(3, config);
      assert.strictEqual(total, 2000);
    });

    it('should respect maxDelay cap', () => {
      const config = {
        type: 'exponential' as const,
        baseDelayMs: 1000,
        maxDelayMs: 3000,
        jitter: false,
      };

      // 5 attempts: 0 + 2000 + 3000 (capped) + 3000 (capped) + 3000 (capped) = 11000
      const total = calculateTotalRetryDelay(5, config);
      assert.strictEqual(total, 11000);
    });
  });
});
