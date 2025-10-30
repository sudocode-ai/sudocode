/**
 * Tests for Circuit Breaker Implementation
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  CircuitBreakerManager,
  createCircuitBreaker,
  isInState,
  getState,
  getFailureRate,
  getSuccessRate,
} from '../../circuit-breaker.js';

describe('Circuit Breaker', () => {
  describe('CircuitBreakerManager', () => {
    let manager: CircuitBreakerManager;

    beforeEach(() => {
      manager = new CircuitBreakerManager();
    });

    describe('getOrCreate', () => {
      it('should create new circuit breaker with default config', () => {
        const breaker = manager.getOrCreate('test-service');

        assert.strictEqual(breaker.name, 'test-service');
        assert.strictEqual(breaker.state, 'closed');
        assert.strictEqual(breaker.config.failureThreshold, 5);
        assert.strictEqual(breaker.config.successThreshold, 2);
        assert.strictEqual(breaker.config.timeout, 60000);
      });

      it('should create new circuit breaker with custom config', () => {
        const breaker = manager.getOrCreate('test-service', {
          failureThreshold: 10,
          successThreshold: 3,
          timeout: 30000,
        });

        assert.strictEqual(breaker.config.failureThreshold, 10);
        assert.strictEqual(breaker.config.successThreshold, 3);
        assert.strictEqual(breaker.config.timeout, 30000);
      });

      it('should return existing circuit breaker on subsequent calls', () => {
        const breaker1 = manager.getOrCreate('test-service');
        const breaker2 = manager.getOrCreate('test-service');

        assert.strictEqual(breaker1, breaker2);
      });

      it('should create separate breakers for different names', () => {
        const breaker1 = manager.getOrCreate('service-1');
        const breaker2 = manager.getOrCreate('service-2');

        assert.notStrictEqual(breaker1, breaker2);
        assert.strictEqual(breaker1.name, 'service-1');
        assert.strictEqual(breaker2.name, 'service-2');
      });
    });

    describe('get', () => {
      it('should return null for non-existent breaker', () => {
        const breaker = manager.get('non-existent');
        assert.strictEqual(breaker, null);
      });

      it('should return existing breaker', () => {
        const created = manager.getOrCreate('test-service');
        const retrieved = manager.get('test-service');

        assert.strictEqual(created, retrieved);
      });
    });

    describe('State Transitions', () => {
      describe('closed to open', () => {
        it('should open circuit after failure threshold reached', () => {
          const breaker = manager.getOrCreate('test-service', {
            failureThreshold: 3,
            successThreshold: 2,
            timeout: 60000,
          });

          assert.strictEqual(breaker.state, 'closed');

          // Record failures up to threshold
          manager.recordFailure('test-service', new Error('Failure 1'));
          assert.strictEqual(breaker.state, 'closed');

          manager.recordFailure('test-service', new Error('Failure 2'));
          assert.strictEqual(breaker.state, 'closed');

          manager.recordFailure('test-service', new Error('Failure 3'));
          assert.strictEqual(breaker.state, 'open');
        });

        it('should not open circuit if failures below threshold', () => {
          const breaker = manager.getOrCreate('test-service', {
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 60000,
          });

          manager.recordFailure('test-service', new Error('Failure 1'));
          manager.recordFailure('test-service', new Error('Failure 2'));

          assert.strictEqual(breaker.state, 'closed');
        });
      });

      describe('open to half-open', () => {
        it('should transition to half-open after timeout', async () => {
          const breaker = manager.getOrCreate('test-service', {
            failureThreshold: 2,
            successThreshold: 2,
            timeout: 100, // Short timeout for testing
          });

          // Open the circuit
          manager.recordFailure('test-service', new Error('Failure 1'));
          manager.recordFailure('test-service', new Error('Failure 2'));
          assert.strictEqual(breaker.state, 'open');

          // Before timeout, should still reject
          assert.strictEqual(manager.canExecute('test-service'), false);

          // Wait for timeout
          await new Promise((resolve) => setTimeout(resolve, 150));

          // canExecute should transition to half-open
          assert.strictEqual(manager.canExecute('test-service'), true);
          assert.strictEqual(breaker.state, 'half-open');
        });

        it('should not transition before timeout elapsed', () => {
          const breaker = manager.getOrCreate('test-service', {
            failureThreshold: 2,
            successThreshold: 2,
            timeout: 60000,
          });

          // Open the circuit
          manager.recordFailure('test-service', new Error('Failure 1'));
          manager.recordFailure('test-service', new Error('Failure 2'));

          assert.strictEqual(breaker.state, 'open');
          assert.strictEqual(manager.canExecute('test-service'), false);
        });
      });

      describe('half-open to closed', () => {
        it('should close circuit after success threshold in half-open', async () => {
          const breaker = manager.getOrCreate('test-service', {
            failureThreshold: 2,
            successThreshold: 2,
            timeout: 100,
          });

          // Open the circuit
          manager.recordFailure('test-service', new Error('Failure 1'));
          manager.recordFailure('test-service', new Error('Failure 2'));
          assert.strictEqual(breaker.state, 'open');

          // Wait for timeout and transition to half-open
          await new Promise((resolve) => setTimeout(resolve, 150));
          manager.canExecute('test-service');
          assert.strictEqual(breaker.state, 'half-open');

          // Record successes
          manager.recordSuccess('test-service');
          assert.strictEqual(breaker.state, 'half-open');

          manager.recordSuccess('test-service');
          assert.strictEqual(breaker.state, 'closed');
        });

        it('should reset failure count when closing', async () => {
          const breaker = manager.getOrCreate('test-service', {
            failureThreshold: 2,
            successThreshold: 2,
            timeout: 100,
          });

          // Open the circuit
          manager.recordFailure('test-service', new Error('Failure 1'));
          manager.recordFailure('test-service', new Error('Failure 2'));

          // Transition to half-open and close
          await new Promise((resolve) => setTimeout(resolve, 150));
          manager.canExecute('test-service');
          manager.recordSuccess('test-service');
          manager.recordSuccess('test-service');

          assert.strictEqual(breaker.state, 'closed');
          assert.strictEqual(breaker.metrics.failedRequests, 0);
        });
      });

      describe('half-open to open', () => {
        it('should reopen on failure in half-open state', async () => {
          const breaker = manager.getOrCreate('test-service', {
            failureThreshold: 2,
            successThreshold: 2,
            timeout: 100,
          });

          // Open the circuit
          manager.recordFailure('test-service', new Error('Failure 1'));
          manager.recordFailure('test-service', new Error('Failure 2'));

          // Transition to half-open
          await new Promise((resolve) => setTimeout(resolve, 150));
          manager.canExecute('test-service');
          assert.strictEqual(breaker.state, 'half-open');

          // Any failure reopens the circuit
          manager.recordFailure('test-service', new Error('Failure 3'));
          assert.strictEqual(breaker.state, 'open');
        });
      });
    });

    describe('canExecute', () => {
      it('should return true for closed circuit', () => {
        manager.getOrCreate('test-service');
        assert.strictEqual(manager.canExecute('test-service'), true);
      });

      it('should return false for open circuit before timeout', () => {
        const breaker = manager.getOrCreate('test-service', {
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 60000,
        });

        manager.recordFailure('test-service', new Error('Failure 1'));
        manager.recordFailure('test-service', new Error('Failure 2'));

        assert.strictEqual(breaker.state, 'open');
        assert.strictEqual(manager.canExecute('test-service'), false);
      });

      it('should return true for half-open circuit', async () => {
        const breaker = manager.getOrCreate('test-service', {
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100,
        });

        manager.recordFailure('test-service', new Error('Failure 1'));
        manager.recordFailure('test-service', new Error('Failure 2'));

        await new Promise((resolve) => setTimeout(resolve, 150));
        manager.canExecute('test-service');

        assert.strictEqual(breaker.state, 'half-open');
        assert.strictEqual(manager.canExecute('test-service'), true);
      });

      it('should return true for non-existent breaker', () => {
        assert.strictEqual(manager.canExecute('non-existent'), true);
      });
    });

    describe('recordSuccess', () => {
      it('should update metrics on success', () => {
        const breaker = manager.getOrCreate('test-service');

        manager.recordSuccess('test-service');

        assert.strictEqual(breaker.metrics.totalRequests, 1);
        assert.strictEqual(breaker.metrics.successfulRequests, 1);
        assert.ok(breaker.metrics.lastSuccessTime instanceof Date);
      });

      it('should track multiple successes', () => {
        const breaker = manager.getOrCreate('test-service');

        manager.recordSuccess('test-service');
        manager.recordSuccess('test-service');
        manager.recordSuccess('test-service');

        assert.strictEqual(breaker.metrics.totalRequests, 3);
        assert.strictEqual(breaker.metrics.successfulRequests, 3);
      });
    });

    describe('recordFailure', () => {
      it('should update metrics on failure', () => {
        const breaker = manager.getOrCreate('test-service');

        manager.recordFailure('test-service', new Error('Test error'));

        assert.strictEqual(breaker.metrics.totalRequests, 1);
        assert.strictEqual(breaker.metrics.failedRequests, 1);
        assert.ok(breaker.metrics.lastFailureTime instanceof Date);
      });

      it('should track multiple failures', () => {
        const breaker = manager.getOrCreate('test-service', {
          failureThreshold: 10,
          successThreshold: 2,
          timeout: 60000,
        });

        manager.recordFailure('test-service', new Error('Error 1'));
        manager.recordFailure('test-service', new Error('Error 2'));

        assert.strictEqual(breaker.metrics.totalRequests, 2);
        assert.strictEqual(breaker.metrics.failedRequests, 2);
      });
    });

    describe('reset', () => {
      it('should reset circuit to closed state', () => {
        const breaker = manager.getOrCreate('test-service', {
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 60000,
        });

        // Open the circuit
        manager.recordFailure('test-service', new Error('Failure 1'));
        manager.recordFailure('test-service', new Error('Failure 2'));
        assert.strictEqual(breaker.state, 'open');

        // Reset
        manager.reset('test-service');

        assert.strictEqual(breaker.state, 'closed');
        assert.strictEqual(breaker.metrics.failedRequests, 0);
        assert.strictEqual(breaker.metrics.successfulRequests, 0);
      });

      it('should handle reset of non-existent breaker', () => {
        // Should not throw
        manager.reset('non-existent');
      });
    });

    describe('getAll', () => {
      it('should return empty map initially', () => {
        const all = manager.getAll();
        assert.strictEqual(all.size, 0);
      });

      it('should return all created breakers', () => {
        manager.getOrCreate('service-1');
        manager.getOrCreate('service-2');
        manager.getOrCreate('service-3');

        const all = manager.getAll();
        assert.strictEqual(all.size, 3);
        assert.ok(all.has('service-1'));
        assert.ok(all.has('service-2'));
        assert.ok(all.has('service-3'));
      });

      it('should return a copy of the map', () => {
        manager.getOrCreate('service-1');

        const all1 = manager.getAll();
        const all2 = manager.getAll();

        assert.notStrictEqual(all1, all2);
      });
    });
  });

  describe('createCircuitBreaker', () => {
    it('should create breaker with default config', () => {
      const breaker = createCircuitBreaker('test-service');

      assert.strictEqual(breaker.name, 'test-service');
      assert.strictEqual(breaker.state, 'closed');
      assert.strictEqual(breaker.config.failureThreshold, 5);
      assert.strictEqual(breaker.config.successThreshold, 2);
      assert.strictEqual(breaker.config.timeout, 60000);
      assert.strictEqual(breaker.metrics.totalRequests, 0);
    });

    it('should create breaker with custom config', () => {
      const breaker = createCircuitBreaker('test-service', {
        failureThreshold: 10,
        successThreshold: 3,
        timeout: 30000,
      });

      assert.strictEqual(breaker.config.failureThreshold, 10);
      assert.strictEqual(breaker.config.successThreshold, 3);
      assert.strictEqual(breaker.config.timeout, 30000);
    });
  });

  describe('isInState', () => {
    it('should return true for matching state', () => {
      const breaker = createCircuitBreaker('test-service');

      assert.strictEqual(isInState(breaker, 'closed'), true);
      assert.strictEqual(isInState(breaker, 'open'), false);
      assert.strictEqual(isInState(breaker, 'half-open'), false);
    });

    it('should work for all states', () => {
      const breaker = createCircuitBreaker('test-service');

      breaker.state = 'open';
      assert.strictEqual(isInState(breaker, 'open'), true);

      breaker.state = 'half-open';
      assert.strictEqual(isInState(breaker, 'half-open'), true);

      breaker.state = 'closed';
      assert.strictEqual(isInState(breaker, 'closed'), true);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const breaker = createCircuitBreaker('test-service');

      assert.strictEqual(getState(breaker), 'closed');

      breaker.state = 'open';
      assert.strictEqual(getState(breaker), 'open');

      breaker.state = 'half-open';
      assert.strictEqual(getState(breaker), 'half-open');
    });
  });

  describe('getFailureRate', () => {
    it('should return 0 for no requests', () => {
      const breaker = createCircuitBreaker('test-service');
      assert.strictEqual(getFailureRate(breaker), 0);
    });

    it('should calculate correct failure rate', () => {
      const breaker = createCircuitBreaker('test-service');

      breaker.metrics.totalRequests = 10;
      breaker.metrics.failedRequests = 3;

      assert.strictEqual(getFailureRate(breaker), 0.3);
    });

    it('should return 1 for all failures', () => {
      const breaker = createCircuitBreaker('test-service');

      breaker.metrics.totalRequests = 5;
      breaker.metrics.failedRequests = 5;

      assert.strictEqual(getFailureRate(breaker), 1);
    });

    it('should return 0 for no failures', () => {
      const breaker = createCircuitBreaker('test-service');

      breaker.metrics.totalRequests = 10;
      breaker.metrics.failedRequests = 0;

      assert.strictEqual(getFailureRate(breaker), 0);
    });
  });

  describe('getSuccessRate', () => {
    it('should return 0 for no requests', () => {
      const breaker = createCircuitBreaker('test-service');
      assert.strictEqual(getSuccessRate(breaker), 0);
    });

    it('should calculate correct success rate', () => {
      const breaker = createCircuitBreaker('test-service');

      breaker.metrics.totalRequests = 10;
      breaker.metrics.successfulRequests = 7;

      assert.strictEqual(getSuccessRate(breaker), 0.7);
    });

    it('should return 1 for all successes', () => {
      const breaker = createCircuitBreaker('test-service');

      breaker.metrics.totalRequests = 5;
      breaker.metrics.successfulRequests = 5;

      assert.strictEqual(getSuccessRate(breaker), 1);
    });

    it('should return 0 for no successes', () => {
      const breaker = createCircuitBreaker('test-service');

      breaker.metrics.totalRequests = 10;
      breaker.metrics.successfulRequests = 0;

      assert.strictEqual(getSuccessRate(breaker), 0);
    });
  });
});
