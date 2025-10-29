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
      const testDir = process.cwd();
      const config: ProcessConfig = {
        executablePath: 'pwd',  // pwd command shows working directory
        args: [],
        workDir: testDir,
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify the working directory by reading stdout
      const output = await new Promise<string>((resolve) => {
        let data = '';
        managedProcess.streams.stdout.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        managedProcess.process.on('exit', () => {
          resolve(data.trim());
        });
      });

      assert.strictEqual(output, testDir);
    });

    it('passes environment variables', async () => {
      const config: ProcessConfig = {
        executablePath: 'sh',
        args: ['-c', 'echo $TEST_VAR'],
        workDir: process.cwd(),
        env: {
          TEST_VAR: 'test_value',
        },
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify environment variable is accessible in the spawned process
      const output = await new Promise<string>((resolve) => {
        let data = '';
        managedProcess.streams.stdout.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        managedProcess.process.on('exit', () => {
          resolve(data.trim());
        });
      });

      assert.strictEqual(output, 'test_value');
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
        args: ['hello', 'world'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify args are passed correctly
      const output = await new Promise<string>((resolve) => {
        let data = '';
        managedProcess.streams.stdout.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        managedProcess.process.on('exit', () => {
          resolve(data.trim());
        });
      });

      assert.strictEqual(output, 'hello world');
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

      // Verify all args are passed
      const output = await new Promise<string>((resolve) => {
        let data = '';
        managedProcess.streams.stdout.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        managedProcess.process.on('exit', () => {
          resolve(data.trim());
        });
      });

      assert.strictEqual(output, 'arg1 arg2 arg3 arg4');
    });

    it('configures stdio as pipes', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify all streams are available (piped)
      assert.ok(managedProcess.streams.stdin, 'stdin should be piped');
      assert.ok(managedProcess.streams.stdout, 'stdout should be piped');
      assert.ok(managedProcess.streams.stderr, 'stderr should be piped');
      assert.ok(managedProcess.streams.stdin.writable, 'stdin should be writable');
      assert.ok(managedProcess.streams.stdout.readable, 'stdout should be readable');
      assert.ok(managedProcess.streams.stderr.readable, 'stderr should be readable');
    });

    it('inherits parent environment variables', async () => {
      // Set a parent env var
      const originalPath = process.env.PATH;
      assert.ok(originalPath, 'PATH should exist in parent environment');

      const config: ProcessConfig = {
        executablePath: 'sh',
        args: ['-c', 'echo $PATH'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify parent env var is accessible
      const output = await new Promise<string>((resolve) => {
        let data = '';
        managedProcess.streams.stdout.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        managedProcess.process.on('exit', () => {
          resolve(data.trim());
        });
      });

      assert.strictEqual(output, originalPath);
    });

    it('merges custom env with parent env', async () => {
      const config: ProcessConfig = {
        executablePath: 'sh',
        args: ['-c', 'echo $PATH:$CUSTOM_VAR'],
        workDir: process.cwd(),
        env: {
          CUSTOM_VAR: 'custom_value',
        },
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify both parent and custom env vars are accessible
      const output = await new Promise<string>((resolve) => {
        let data = '';
        managedProcess.streams.stdout.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        managedProcess.process.on('exit', () => {
          resolve(data.trim());
        });
      });

      assert.ok(output.includes(process.env.PATH!), 'Should include parent PATH');
      assert.ok(output.includes('custom_value'), 'Should include custom env var');
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

  describe('ManagedProcess Structure', () => {
    it('returns complete ManagedProcess object', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify all required fields exist
      assert.ok(managedProcess.id, 'Should have id');
      assert.ok(managedProcess.pid, 'Should have pid');
      assert.ok(managedProcess.status, 'Should have status');
      assert.ok(managedProcess.spawnedAt, 'Should have spawnedAt');
      assert.ok(managedProcess.lastActivity, 'Should have lastActivity');
      assert.ok(managedProcess.process, 'Should have process');
      assert.ok(managedProcess.streams, 'Should have streams');
      assert.ok(managedProcess.metrics, 'Should have metrics');

      // Verify field types
      assert.strictEqual(typeof managedProcess.id, 'string');
      assert.strictEqual(typeof managedProcess.pid, 'number');
      assert.strictEqual(typeof managedProcess.status, 'string');
      assert.ok(managedProcess.spawnedAt instanceof Date);
      assert.ok(managedProcess.lastActivity instanceof Date);
      assert.strictEqual(typeof managedProcess.process, 'object');
      assert.strictEqual(typeof managedProcess.streams, 'object');
      assert.strictEqual(typeof managedProcess.metrics, 'object');
    });

    it('initializes exit fields correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Exit fields should be null initially
      assert.strictEqual(managedProcess.exitCode, null);
      assert.strictEqual(managedProcess.signal, null);
    });

    it('initializes timestamps correctly', async () => {
      const before = new Date();
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const after = new Date();

      // Timestamps should be between before and after
      assert.ok(managedProcess.spawnedAt >= before);
      assert.ok(managedProcess.spawnedAt <= after);
      assert.ok(managedProcess.lastActivity >= before);
      assert.ok(managedProcess.lastActivity <= after);
    });

    it('initializes metrics with correct defaults', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify metrics structure and defaults
      assert.strictEqual(managedProcess.metrics.totalDuration, 0);
      assert.strictEqual(managedProcess.metrics.tasksCompleted, 0);
      assert.strictEqual(managedProcess.metrics.successRate, 1.0);
    });

    it('provides access to underlying ChildProcess', async () => {
      const config: ProcessConfig = {
        executablePath: 'sleep',
        args: ['0.1'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Verify ChildProcess methods are available
      assert.ok(typeof managedProcess.process.kill === 'function');
      assert.ok(typeof managedProcess.process.on === 'function');
      assert.ok(typeof managedProcess.process.once === 'function');
      assert.ok(managedProcess.process.stdin);
      assert.ok(managedProcess.process.stdout);
      assert.ok(managedProcess.process.stderr);
    });
  });
});
