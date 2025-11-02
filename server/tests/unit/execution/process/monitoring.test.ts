/**
 * Tests for Process Monitoring and Metrics
 *
 * Tests the monitoring and metrics retrieval methods:
 * - getProcess: Retrieve specific process by ID
 * - getActiveProcesses: Get all active processes
 * - getMetrics: Get process manager metrics
 */

import { describe, it, beforeEach, afterEach , expect } from 'vitest'
import { SimpleProcessManager } from '../../../../src/execution/process/simple-manager.js';
import type { ProcessConfig } from '../../../../src/execution/process/types.js';

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

      expect(retrieved, 'Process should be found').toBeTruthy();
      expect(retrieved?.id).toBe(spawned.id);
      expect(retrieved?.pid).toBe(spawned.pid);
      expect(retrieved?.status).toBe(spawned.status);
    });

    it('returns null when process does not exist', () => {
      const result = manager.getProcess('nonexistent-id');
      expect(result).toBe(null);
    });

    it('returns null for empty string ID', () => {
      const result = manager.getProcess('');
      expect(result).toBe(null);
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

      expect(retrieved1, 'Should return same object reference').toBe(retrieved2);
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

      expect(allActive.includes(retrieved!)).toBeTruthy();
    });
  });

  describe('getActiveProcesses', () => {
    it('returns empty array when no processes exist', () => {
      const processes = manager.getActiveProcesses();
      expect(Array.isArray(processes)).toBeTruthy();
      expect(processes.length).toBe(0);
    });

    it('returns array with single process', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const spawned = await manager.acquireProcess(config);
      const processes = manager.getActiveProcesses();

      expect(processes.length).toBe(1);
      expect(processes[0].id).toBe(spawned.id);
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

      expect(processes.length).toBe(3);

      const ids = processes.map(p => p.id);
      expect(ids.includes(spawned1.id)).toBeTruthy();
      expect(ids.includes(spawned2.id)).toBeTruthy();
      expect(ids.includes(spawned3.id)).toBeTruthy();
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

      expect(processes1, 'Should return new array instance').not.toBe(processes2);
      expect(processes1, 'But arrays should contain same elements').toEqual(processes2);
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
      expect(refreshedProcesses.length).toBe(1);
    });

    it('reflects changes as processes are added', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      expect(manager.getActiveProcesses().length).toBe(0);

      await manager.acquireProcess(config);
      expect(manager.getActiveProcesses().length).toBe(1);

      await manager.acquireProcess(config);
      expect(manager.getActiveProcesses().length).toBe(2);
    });

    it('excludes processes after they exit', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const spawned = await manager.acquireProcess(config);
      expect(manager.getActiveProcesses().length).toBe(1);

      // Wait for process to exit and be cleaned up (5s cleanup delay)
      await new Promise(resolve => setTimeout(resolve, 5100));

      const processes = manager.getActiveProcesses();
      expect(
        processes.filter(p => p.id === spawned.id).length,
        'Process should be removed after cleanup delay'
      ).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('returns metrics object with correct structure', () => {
      const metrics = manager.getMetrics();

      expect(typeof metrics === 'object').toBeTruthy();
      expect('totalSpawned' in metrics).toBeTruthy();
      expect('currentlyActive' in metrics).toBeTruthy();
      expect('totalCompleted' in metrics).toBeTruthy();
      expect('totalFailed' in metrics).toBeTruthy();
      expect('averageDuration' in metrics).toBeTruthy();
    });

    it('returns initial metrics when no processes spawned', () => {
      const metrics = manager.getMetrics();

      expect(metrics.totalSpawned).toBe(0);
      expect(metrics.currentlyActive).toBe(0);
      expect(metrics.totalCompleted).toBe(0);
      expect(metrics.totalFailed).toBe(0);
      expect(metrics.averageDuration).toBe(0);
    });

    it('returns copy of metrics, not reference', () => {
      const metrics1 = manager.getMetrics();
      const metrics2 = manager.getMetrics();

      expect(metrics1, 'Should return different object instances').not.toBe(metrics2);
      expect(metrics1, 'But values should be equal').toEqual(metrics2);
    });

    it('returned object cannot mutate internal metrics', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);

      const metrics = manager.getMetrics();
      expect(metrics.totalSpawned).toBe(1);

      // Try to mutate the returned object
      metrics.totalSpawned = 999;
      metrics.currentlyActive = 888;

      // Original should be unchanged
      const freshMetrics = manager.getMetrics();
      expect(freshMetrics.totalSpawned).toBe(1);
      expect(freshMetrics.currentlyActive).toBe(1);
    });

    it('tracks totalSpawned correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      expect(manager.getMetrics().totalSpawned).toBe(0);

      await manager.acquireProcess(config);
      expect(manager.getMetrics().totalSpawned).toBe(1);

      await manager.acquireProcess(config);
      expect(manager.getMetrics().totalSpawned).toBe(2);

      await manager.acquireProcess(config);
      expect(manager.getMetrics().totalSpawned).toBe(3);
    });

    it('tracks currentlyActive correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      expect(manager.getMetrics().currentlyActive).toBe(0);

      await manager.acquireProcess(config);
      expect(manager.getMetrics().currentlyActive).toBe(1);

      await manager.acquireProcess(config);
      expect(manager.getMetrics().currentlyActive).toBe(2);
    });

    it('tracks totalCompleted correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit and metrics to update
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          // Give the manager time to update metrics
          setTimeout(resolve, 100);
        });
      });

      const metrics = manager.getMetrics();
      expect(metrics.totalCompleted).toBe(1);
      expect(metrics.totalFailed).toBe(0);
    });

    it('decrements currentlyActive when process exits', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);
      expect(manager.getMetrics().currentlyActive).toBe(1);

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(manager.getMetrics().currentlyActive).toBe(0);
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
      expect(metrics.averageDuration > 0, 'Average duration should be greater than 0').toBeTruthy();
      expect(metrics.averageDuration < 1000, 'Average duration should be reasonable').toBeTruthy();
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
      expect(metrics.totalFailed).toBe(1);
      expect(metrics.totalCompleted).toBe(0);
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

      expect(metrics.currentlyActive).toBe(2);
      expect(activeProcesses.length).toBe(2);
      expect(process1).toBeTruthy();
      expect(process2).toBeTruthy();
      expect(activeProcesses.includes(process1!)).toBeTruthy();
      expect(activeProcesses.includes(process2!)).toBeTruthy();
    });
  });
});
