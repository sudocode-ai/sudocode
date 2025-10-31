/**
 * Circuit Breaker Implementation
 *
 * Implements the circuit breaker pattern for preventing cascading failures.
 * Tracks failures and successes, automatically opening when thresholds are
 * exceeded and recovering through half-open state.
 *
 * @module execution/resilience/circuit-breaker
 */

import type { CircuitBreaker, CircuitState } from './types.js';

/**
 * CircuitBreakerManager - Manages multiple circuit breakers
 *
 * Maintains a collection of circuit breakers, typically one per task type
 * or service. Provides methods for checking state, recording outcomes,
 * and managing circuit lifecycle.
 *
 * @example
 * ```typescript
 * const manager = new CircuitBreakerManager();
 * const breaker = manager.getOrCreate('issue-executor', {
 *   failureThreshold: 5,
 *   successThreshold: 2,
 *   timeout: 60000,
 * });
 *
 * if (manager.canExecute('issue-executor')) {
 *   // Execute task
 *   const success = await executeTask();
 *   if (success) {
 *     manager.recordSuccess('issue-executor');
 *   } else {
 *     manager.recordFailure('issue-executor', new Error('Task failed'));
 *   }
 * }
 * ```
 */
export class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();

  /**
   * Get an existing circuit breaker by name
   *
   * @param name - Circuit breaker name
   * @returns Circuit breaker or null if not found
   */
  get(name: string): CircuitBreaker | null {
    return this.breakers.get(name) || null;
  }

  /**
   * Get or create a circuit breaker
   *
   * If a circuit breaker with the given name exists, returns it.
   * Otherwise creates a new one with the provided configuration.
   *
   * @param name - Circuit breaker name (typically task type)
   * @param config - Configuration for new circuit breaker
   * @returns Circuit breaker instance
   */
  getOrCreate(
    name: string,
    config: CircuitBreaker['config'] = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000,
    }
  ): CircuitBreaker {
    let breaker = this.breakers.get(name);

    if (!breaker) {
      breaker = {
        name,
        state: 'closed',
        config,
        metrics: {
          totalRequests: 0,
          failedRequests: 0,
          successfulRequests: 0,
        },
      };

      this.breakers.set(name, breaker);
    }

    return breaker;
  }

  /**
   * Check if a circuit breaker allows execution
   *
   * Returns false if circuit is open and timeout hasn't elapsed yet.
   * Returns true for closed and half-open states.
   *
   * @param name - Circuit breaker name
   * @returns True if execution is allowed
   */
  canExecute(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      return true; // No breaker means no restriction
    }

    if (breaker.state === 'open') {
      // Check if timeout has elapsed to transition to half-open
      if (this.shouldTransitionToHalfOpen(breaker)) {
        breaker.state = 'half-open';
        return true;
      }
      return false;
    }

    return true; // closed or half-open allows execution
  }

  /**
   * Record a successful execution
   *
   * Updates metrics and may transition circuit from half-open to closed
   * if success threshold is met.
   *
   * @param name - Circuit breaker name
   */
  recordSuccess(name: string): void {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      return;
    }

    breaker.metrics.totalRequests++;
    breaker.metrics.successfulRequests++;
    breaker.metrics.lastSuccessTime = new Date();

    // If in half-open state, check if we should close
    if (breaker.state === 'half-open') {
      // Count recent successes (simplified: use total for now)
      // In production, you'd track a sliding window of recent attempts
      const recentSuccesses = this.getConsecutiveSuccesses(breaker);

      if (recentSuccesses >= breaker.config.successThreshold) {
        breaker.state = 'closed';
        breaker.metrics.failedRequests = 0; // Reset failure count
      }
    }
  }

  /**
   * Record a failed execution
   *
   * Updates metrics and may transition circuit from closed/half-open to open
   * if failure threshold is met.
   *
   * @param name - Circuit breaker name
   * @param error - Error that occurred
   */
  recordFailure(name: string, error: Error): void {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      return;
    }

    void error; // Error logged but not used in current implementation

    breaker.metrics.totalRequests++;
    breaker.metrics.failedRequests++;
    breaker.metrics.lastFailureTime = new Date();

    // Check if we should open the circuit
    if (breaker.state === 'closed') {
      if (breaker.metrics.failedRequests >= breaker.config.failureThreshold) {
        breaker.state = 'open';
      }
    } else if (breaker.state === 'half-open') {
      // Any failure in half-open state reopens the circuit
      breaker.state = 'open';
    }
  }

  /**
   * Reset a circuit breaker to closed state
   *
   * Clears all failure counts and returns circuit to closed state.
   * Useful for manual recovery or after fixing underlying issues.
   *
   * @param name - Circuit breaker name
   */
  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      return;
    }

    breaker.state = 'closed';
    breaker.metrics.failedRequests = 0;
    breaker.metrics.successfulRequests = 0;
  }

  /**
   * Get all circuit breakers
   *
   * @returns Map of circuit breaker name to breaker instance
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Check if enough time has passed to transition from open to half-open
   *
   * @param breaker - Circuit breaker to check
   * @returns True if timeout has elapsed
   * @private
   */
  private shouldTransitionToHalfOpen(breaker: CircuitBreaker): boolean {
    if (!breaker.metrics.lastFailureTime) {
      return true;
    }

    const timeSinceFailure =
      Date.now() - breaker.metrics.lastFailureTime.getTime();

    return timeSinceFailure >= breaker.config.timeout;
  }

  /**
   * Get count of consecutive successes
   *
   * In a production implementation, this would track a sliding window
   * of recent attempts. For simplicity, we use total successful requests.
   *
   * @param breaker - Circuit breaker to check
   * @returns Number of consecutive successes
   * @private
   */
  private getConsecutiveSuccesses(breaker: CircuitBreaker): number {
    // Simplified: In production, track recent attempts in a circular buffer
    // For now, use successful requests as a proxy
    return breaker.metrics.successfulRequests;
  }
}

/**
 * Create a new circuit breaker instance
 *
 * Helper function to create a properly configured circuit breaker.
 *
 * @param name - Circuit breaker name
 * @param config - Circuit breaker configuration
 * @returns New circuit breaker instance
 *
 * @example
 * ```typescript
 * const breaker = createCircuitBreaker('api-calls', {
 *   failureThreshold: 10,
 *   successThreshold: 3,
 *   timeout: 30000,
 * });
 * ```
 */
export function createCircuitBreaker(
  name: string,
  config: CircuitBreaker['config'] = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
  }
): CircuitBreaker {
  return {
    name,
    state: 'closed',
    config,
    metrics: {
      totalRequests: 0,
      failedRequests: 0,
      successfulRequests: 0,
    },
  };
}

/**
 * Check if a circuit breaker is in a specific state
 *
 * @param breaker - Circuit breaker to check
 * @param state - State to check for
 * @returns True if breaker is in the specified state
 */
export function isInState(
  breaker: CircuitBreaker,
  state: CircuitState
): boolean {
  return breaker.state === state;
}

/**
 * Get the current state of a circuit breaker
 *
 * @param breaker - Circuit breaker to check
 * @returns Current state
 */
export function getState(breaker: CircuitBreaker): CircuitState {
  return breaker.state;
}

/**
 * Calculate failure rate for a circuit breaker
 *
 * @param breaker - Circuit breaker to analyze
 * @returns Failure rate (0-1) or 0 if no requests
 */
export function getFailureRate(breaker: CircuitBreaker): number {
  if (breaker.metrics.totalRequests === 0) {
    return 0;
  }

  return breaker.metrics.failedRequests / breaker.metrics.totalRequests;
}

/**
 * Calculate success rate for a circuit breaker
 *
 * @param breaker - Circuit breaker to analyze
 * @returns Success rate (0-1) or 0 if no requests
 */
export function getSuccessRate(breaker: CircuitBreaker): number {
  if (breaker.metrics.totalRequests === 0) {
    return 0;
  }

  return breaker.metrics.successfulRequests / breaker.metrics.totalRequests;
}
