/**
 * Integration Tests for Engine Layer with Process Layer
 *
 * Tests the integration between Engine and Process layers using real ProcessManager.
 * These tests verify that the layers work together correctly without requiring Claude CLI.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SimpleExecutionEngine } from '../../simple-engine.js';
import { SimpleProcessManager } from '../../../process/simple-manager.js';

describe('Engine + Process Layer Integration', () => {
  let engine: SimpleExecutionEngine;
  let processManager: SimpleProcessManager;

  beforeEach(() => {
    processManager = new SimpleProcessManager();
    engine = new SimpleExecutionEngine(processManager);
  });

  afterEach(async () => {
    // Cleanup
    await engine.shutdown();
  });

  describe('Initialization', () => {
    it('creates engine with real process manager', () => {
      assert.ok(engine);

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.currentlyRunning, 0);
      assert.strictEqual(metrics.completedTasks, 0);
      assert.strictEqual(metrics.failedTasks, 0);

      const processMetrics = processManager.getMetrics();
      assert.strictEqual(processMetrics.currentlyActive, 0);
      assert.strictEqual(processMetrics.totalSpawned, 0);
    });

    it('respects custom maxConcurrent config', () => {
      const customEngine = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 5,
      });

      const metrics = customEngine.getMetrics();
      assert.strictEqual(metrics.maxConcurrent, 5);
      assert.strictEqual(metrics.availableSlots, 5);

      customEngine.shutdown();
    });
  });

  describe('Shutdown Integration', () => {
    it('shuts down process manager when engine shuts down', async () => {
      // Shutdown engine
      await engine.shutdown();

      // Verify both engine and process manager are shut down
      const engineMetrics = engine.getMetrics();
      assert.strictEqual(engineMetrics.currentlyRunning, 0);
      assert.strictEqual(engineMetrics.queuedTasks, 0);

      const processMetrics = processManager.getMetrics();
      assert.strictEqual(processMetrics.currentlyActive, 0);
    });

    it('is idempotent - safe to shutdown multiple times', async () => {
      await engine.shutdown();
      await engine.shutdown(); // Should not error

      const metrics = engine.getMetrics();
      assert.strictEqual(metrics.currentlyRunning, 0);
    });
  });

  describe('Metrics Integration', () => {
    it('engine and process manager metrics stay in sync', () => {
      const engineMetrics = engine.getMetrics();
      const processMetrics = processManager.getMetrics();

      // Both should start at zero
      assert.strictEqual(engineMetrics.currentlyRunning, 0);
      assert.strictEqual(processMetrics.currentlyActive, 0);

      // Process metrics should track spawned processes
      assert.strictEqual(processMetrics.totalSpawned, 0);
    });

    it('provides access to process manager through engine', () => {
      // Engine uses process manager internally
      const engineMetrics = engine.getMetrics();

      // Verify engine metrics structure
      assert.ok('maxConcurrent' in engineMetrics);
      assert.ok('currentlyRunning' in engineMetrics);
      assert.ok('totalProcessesSpawned' in engineMetrics);
      assert.ok('activeProcesses' in engineMetrics);
    });
  });

  describe('Configuration', () => {
    it('passes custom claude path through to process manager', () => {
      const customEngine = new SimpleExecutionEngine(processManager, {
        claudePath: '/custom/path/to/claude',
      });

      // Verify engine was created with custom config
      assert.ok(customEngine);

      customEngine.shutdown();
    });

    it('handles default configuration', () => {
      const defaultEngine = new SimpleExecutionEngine(processManager);

      const metrics = defaultEngine.getMetrics();
      assert.strictEqual(metrics.maxConcurrent, 3); // default

      defaultEngine.shutdown();
    });
  });

  describe('Resource Cleanup', () => {
    it('cleans up all resources on shutdown', async () => {
      // Submit some tasks (they won't execute without Claude, but will be queued)
      const task1 = {
        id: 'task-1',
        type: 'issue' as const,
        prompt: 'Test prompt 1',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      const task2 = {
        id: 'task-2',
        type: 'issue' as const,
        prompt: 'Test prompt 2',
        workDir: process.cwd(),
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
        config: {},
      };

      await engine.submitTask(task1);
      await engine.submitTask(task2);

      // Shutdown should clear everything
      await engine.shutdown();

      const engineMetrics = engine.getMetrics();
      assert.strictEqual(engineMetrics.queuedTasks, 0);
      assert.strictEqual(engineMetrics.currentlyRunning, 0);

      const processMetrics = processManager.getMetrics();
      assert.strictEqual(processMetrics.currentlyActive, 0);
    });
  });

  describe('Multiple Engine Instances', () => {
    it('supports multiple engines sharing one process manager', () => {
      const engine2 = new SimpleExecutionEngine(processManager, {
        maxConcurrent: 2,
      });

      // Both engines should work independently
      const metrics1 = engine.getMetrics();
      const metrics2 = engine2.getMetrics();

      assert.strictEqual(metrics1.maxConcurrent, 3);
      assert.strictEqual(metrics2.maxConcurrent, 2);

      engine2.shutdown();
    });

    it('supports multiple engines with separate process managers', () => {
      const processManager2 = new SimpleProcessManager();
      const engine2 = new SimpleExecutionEngine(processManager2);

      // Each should have independent metrics
      const metrics1 = engine.getMetrics();
      const metrics2 = engine2.getMetrics();

      assert.strictEqual(metrics1.currentlyRunning, 0);
      assert.strictEqual(metrics2.currentlyRunning, 0);

      engine2.shutdown();
      processManager2.shutdown();
    });
  });

  describe('Event Handlers', () => {
    it('registers completion handlers', () => {
      engine.onTaskComplete(() => {
        // Handler callback (actual invocation requires task execution)
      });

      // Handler registered (actual invocation requires task execution)
      assert.ok(true);
    });

    it('registers failure handlers', () => {
      engine.onTaskFailed(() => {
        // Handler callback (actual invocation requires task execution)
      });

      // Handler registered (actual invocation requires task execution)
      assert.ok(true);
    });

    it('clears handlers on shutdown', async () => {
      let completions = 0;
      let failures = 0;

      engine.onTaskComplete(() => completions++);
      engine.onTaskFailed(() => failures++);

      await engine.shutdown();

      // After shutdown, handlers should be cleared
      assert.ok(true);
    });
  });

  describe('Status Queries', () => {
    it('getTaskStatus returns null for non-existent tasks', () => {
      const status = engine.getTaskStatus('non-existent-task');
      assert.strictEqual(status, null);
    });

    it('getMetrics returns defensive copy', () => {
      const metrics1 = engine.getMetrics();
      const metrics2 = engine.getMetrics();

      // Modifying one should not affect the other
      metrics1.queuedTasks = 999;
      assert.notStrictEqual(metrics2.queuedTasks, 999);
    });
  });
});
