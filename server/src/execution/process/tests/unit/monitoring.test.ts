/**
 * Tests for Process Monitoring and Metrics
 *
 * Tests the monitoring and metrics retrieval methods:
 * - getProcess: Retrieve specific process by ID
 * - getActiveProcesses: Get all active processes
 * - getMetrics: Get process manager metrics
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SimpleProcessManager } from '../../simple-manager.js';
import type { ProcessConfig } from '../../types.js';

describe('Process Monitoring and Metrics', () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  afterEach(async () => {
    // Clean up any active processes
    await manager.shutdown();
  });

  describe('getProcess', () => {
    it('returns process when it exists', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const spawned = await manager.acquireProcess(config);
      const retrieved = manager.getProcess(spawned.id);

      assert.ok(retrieved, 'Process should be found');
      assert.strictEqual(retrieved.id, spawned.id);
      assert.strictEqual(retrieved.pid, spawned.pid);
      assert.strictEqual(retrieved.status, spawned.status);
    });

    it('returns null when process does not exist', () => {
      const result = manager.getProcess('nonexistent-id');
      assert.strictEqual(result, null);
    });

    it('returns null for empty string ID', () => {
      const result = manager.getProcess('');
      assert.strictEqual(result, null);
    });

    it('returns same object reference for multiple calls', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const spawned = await manager.acquireProcess(config);
      const retrieved1 = manager.getProcess(spawned.id);
      const retrieved2 = manager.getProcess(spawned.id);

      assert.strictEqual(retrieved1, retrieved2, 'Should return same object reference');
    });

    it('returns process that matches activeProcesses map', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const spawned = await manager.acquireProcess(config);
      const retrieved = manager.getProcess(spawned.id);
      const allActive = manager.getActiveProcesses();

      assert.ok(allActive.includes(retrieved!));
    });
  });

  describe('getActiveProcesses', () => {
    it('returns empty array when no processes exist', () => {
      const processes = manager.getActiveProcesses();
      assert.ok(Array.isArray(processes));
      assert.strictEqual(processes.length, 0);
    });

    it('returns array with single process', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const spawned = await manager.acquireProcess(config);
      const processes = manager.getActiveProcesses();

      assert.strictEqual(processes.length, 1);
      assert.strictEqual(processes[0].id, spawned.id);
    });

    it('returns array with multiple processes', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const spawned1 = await manager.acquireProcess(config);
      const spawned2 = await manager.acquireProcess(config);
      const spawned3 = await manager.acquireProcess(config);

      const processes = manager.getActiveProcesses();

      assert.strictEqual(processes.length, 3);

      const ids = processes.map(p => p.id);
      assert.ok(ids.includes(spawned1.id));
      assert.ok(ids.includes(spawned2.id));
      assert.ok(ids.includes(spawned3.id));
    });

    it('returns new array instance on each call', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);

      const processes1 = manager.getActiveProcesses();
      const processes2 = manager.getActiveProcesses();

      assert.notStrictEqual(processes1, processes2, 'Should return new array instance');
      assert.deepStrictEqual(processes1, processes2, 'But arrays should contain same elements');
    });

    it('returns array that can be safely modified', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);
      const processes = manager.getActiveProcesses();

      // Modify the returned array
      processes.pop();
      processes.push({} as any);

      // Original should be unchanged
      const refreshedProcesses = manager.getActiveProcesses();
      assert.strictEqual(refreshedProcesses.length, 1);
    });

    it('reflects changes as processes are added', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      assert.strictEqual(manager.getActiveProcesses().length, 0);

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getActiveProcesses().length, 1);

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getActiveProcesses().length, 2);
    });

    it('excludes processes after they exit', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const spawned = await manager.acquireProcess(config);
      assert.strictEqual(manager.getActiveProcesses().length, 1);

      // Wait for process to exit and be cleaned up (5s cleanup delay)
      await new Promise(resolve => setTimeout(resolve, 5100));

      const processes = manager.getActiveProcesses();
      assert.strictEqual(
        processes.filter(p => p.id === spawned.id).length,
        0,
        'Process should be removed after cleanup delay'
      );
    });
  });

  describe('getMetrics', () => {
    it('returns metrics object with correct structure', () => {
      const metrics = manager.getMetrics();

      assert.ok(typeof metrics === 'object');
      assert.ok('totalSpawned' in metrics);
      assert.ok('currentlyActive' in metrics);
      assert.ok('totalCompleted' in metrics);
      assert.ok('totalFailed' in metrics);
      assert.ok('averageDuration' in metrics);
    });

    it('returns initial metrics when no processes spawned', () => {
      const metrics = manager.getMetrics();

      assert.strictEqual(metrics.totalSpawned, 0);
      assert.strictEqual(metrics.currentlyActive, 0);
      assert.strictEqual(metrics.totalCompleted, 0);
      assert.strictEqual(metrics.totalFailed, 0);
      assert.strictEqual(metrics.averageDuration, 0);
    });

    it('returns copy of metrics, not reference', () => {
      const metrics1 = manager.getMetrics();
      const metrics2 = manager.getMetrics();

      assert.notStrictEqual(metrics1, metrics2, 'Should return different object instances');
      assert.deepStrictEqual(metrics1, metrics2, 'But values should be equal');
    });

    it('returned object cannot mutate internal metrics', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);

      const metrics = manager.getMetrics();
      assert.strictEqual(metrics.totalSpawned, 1);

      // Try to mutate the returned object
      metrics.totalSpawned = 999;
      metrics.currentlyActive = 888;

      // Original should be unchanged
      const freshMetrics = manager.getMetrics();
      assert.strictEqual(freshMetrics.totalSpawned, 1);
      assert.strictEqual(freshMetrics.currentlyActive, 1);
    });

    it('tracks totalSpawned correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      assert.strictEqual(manager.getMetrics().totalSpawned, 0);

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getMetrics().totalSpawned, 1);

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getMetrics().totalSpawned, 2);

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getMetrics().totalSpawned, 3);
    });

    it('tracks currentlyActive correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      assert.strictEqual(manager.getMetrics().currentlyActive, 0);

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getMetrics().currentlyActive, 1);

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getMetrics().currentlyActive, 2);
    });

    it('tracks totalCompleted correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = manager.getMetrics();
      assert.strictEqual(metrics.totalCompleted, 1);
      assert.strictEqual(metrics.totalFailed, 0);
    });

    it('decrements currentlyActive when process exits', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);
      assert.strictEqual(manager.getMetrics().currentlyActive, 1);

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 100));

      assert.strictEqual(manager.getMetrics().currentlyActive, 0);
    });

    it('calculates averageDuration correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      // Spawn multiple processes
      await manager.acquireProcess(config);
      await manager.acquireProcess(config);

      // Wait for processes to exit
      await new Promise(resolve => setTimeout(resolve, 200));

      const metrics = manager.getMetrics();
      assert.ok(metrics.averageDuration > 0, 'Average duration should be greater than 0');
      assert.ok(metrics.averageDuration < 1000, 'Average duration should be reasonable');
    });

    it('handles failed processes in metrics', async () => {
      const config: ProcessConfig = {
        executablePath: 'sh',
        args: ['-c', 'exit 1'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = manager.getMetrics();
      assert.strictEqual(metrics.totalFailed, 1);
      assert.strictEqual(metrics.totalCompleted, 0);
    });
  });

  describe('Integration: All Monitoring Methods', () => {
    it('work together to provide consistent view', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      // Spawn some processes
      const p1 = await manager.acquireProcess(config);
      const p2 = await manager.acquireProcess(config);

      // All methods should show consistent state
      const metrics = manager.getMetrics();
      const activeProcesses = manager.getActiveProcesses();
      const process1 = manager.getProcess(p1.id);
      const process2 = manager.getProcess(p2.id);

      assert.strictEqual(metrics.currentlyActive, 2);
      assert.strictEqual(activeProcesses.length, 2);
      assert.ok(process1);
      assert.ok(process2);
      assert.ok(activeProcesses.includes(process1!));
      assert.ok(activeProcesses.includes(process2!));
    });
  });
});
