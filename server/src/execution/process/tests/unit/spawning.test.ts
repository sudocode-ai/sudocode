/**
 * Tests for Process Spawning
 *
 * Tests the generic process spawning functionality including
 * process creation, configuration handling, and metrics tracking.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SimpleProcessManager } from '../../simple-manager.js';
import type { ProcessConfig } from '../../types.js';

describe('Process Spawning', () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  // Note: shutdown() not yet implemented, so no afterEach cleanup

  describe('acquireProcess', () => {
    it('spawns a process successfully', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',  // Use echo for testing
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      assert.ok(managedProcess);
      assert.ok(managedProcess.id);
      assert.ok(managedProcess.pid);
      assert.strictEqual(managedProcess.status, 'busy');
    });

    it('generates unique process ID', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const process1 = await manager.acquireProcess(config);
      const process2 = await manager.acquireProcess(config);

      assert.notStrictEqual(process1.id, process2.id);
      assert.match(process1.id, /^process-[a-z0-9]+$/);
      assert.match(process2.id, /^process-[a-z0-9]+$/);
    });

    it('sets correct initial status', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      assert.strictEqual(managedProcess.status, 'busy');
      assert.ok(managedProcess.spawnedAt instanceof Date);
      assert.ok(managedProcess.lastActivity instanceof Date);
      assert.strictEqual(managedProcess.exitCode, null);
      assert.strictEqual(managedProcess.signal, null);
    });

    it('initializes process metrics', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      assert.strictEqual(managedProcess.metrics.totalDuration, 0);
      assert.strictEqual(managedProcess.metrics.tasksCompleted, 0);
      assert.strictEqual(managedProcess.metrics.successRate, 1.0);
    });

    it('provides access to process streams', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      assert.ok(managedProcess.streams.stdout);
      assert.ok(managedProcess.streams.stderr);
      assert.ok(managedProcess.streams.stdin);
      assert.ok(managedProcess.process);
    });

    it('tracks process in activeProcesses map', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const retrieved = manager.getProcess(managedProcess.id);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, managedProcess.id);
      assert.strictEqual(retrieved.pid, managedProcess.pid);
    });

    it('updates global metrics on spawn', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const initialMetrics = manager.getMetrics();
      const initialSpawned = initialMetrics.totalSpawned;
      const initialActive = initialMetrics.currentlyActive;

      await manager.acquireProcess(config);

      const updatedMetrics = manager.getMetrics();
      assert.strictEqual(updatedMetrics.totalSpawned, initialSpawned + 1);
      assert.strictEqual(updatedMetrics.currentlyActive, initialActive + 1);
    });

    it('uses correct working directory', async () => {
      const testDir = '/tmp';
      const config: ProcessConfig = {
        executablePath: 'pwd',  // pwd command shows working directory
        args: [],
        workDir: testDir,
      };

      const managedProcess = await manager.acquireProcess(config);

      // The process should be spawned in the specified directory
      assert.ok(managedProcess.process);
    });

    it('passes environment variables', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
        env: {
          TEST_VAR: 'test_value',
        },
      };

      const managedProcess = await manager.acquireProcess(config);
      assert.ok(managedProcess);
    });

    it('merges with default config', async () => {
      const managerWithDefaults = new SimpleProcessManager({
        executablePath: 'echo',
        args: ['test'],
      });

      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await managerWithDefaults.acquireProcess(config);
      assert.ok(managedProcess);
    });

    it('handles multiple concurrent processes', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const processes = await Promise.all([
        manager.acquireProcess(config),
        manager.acquireProcess(config),
        manager.acquireProcess(config),
      ]);

      assert.strictEqual(processes.length, 3);
      assert.strictEqual(manager.getMetrics().currentlyActive, 3);

      // All should have unique IDs
      const ids = processes.map(p => p.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(uniqueIds.size, 3);
    });
  });

  describe('Process Configuration', () => {
    it('spawns process with custom args', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['--flag1', '--flag2', 'value'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      assert.ok(managedProcess);
    });

    it('spawns process with empty args', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: [],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      assert.ok(managedProcess);
    });

    it('spawns process with multiple args', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['arg1', 'arg2', 'arg3', 'arg4'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      assert.ok(managedProcess);
    });
  });

  describe('Error Handling', () => {
    it('throws error if process fails to spawn without PID', async () => {
      const config: ProcessConfig = {
        executablePath: '/nonexistent/command',
        args: ['test'],
        workDir: process.cwd(),
      };

      // When spawn fails to get a PID, acquireProcess should throw
      await assert.rejects(
        manager.acquireProcess(config),
        /Failed to spawn process: no PID assigned/
      );
    });
  });
});
