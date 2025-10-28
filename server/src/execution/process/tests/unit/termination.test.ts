/**
 * Tests for Process Termination
 *
 * Tests terminateProcess, releaseProcess, and shutdown methods
 * with graceful shutdown and SIGKILL fallback.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SimpleProcessManager } from '../../simple-manager.js';
import type { ProcessConfig } from '../../types.js';

describe('Process Termination', () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  describe('terminateProcess', () => {
    it('terminates a running process with SIGTERM', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ], // Exit immediately on SIGTERM
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const processId = managedProcess.id;

      // Terminate the process
      await manager.terminateProcess(processId);

      // Process should be terminated
      assert.strictEqual(managedProcess.process.killed, true);
      // Status will be 'crashed' after process exits during grace period
      assert.strictEqual(managedProcess.status, 'crashed');
    });

    it('sets status to terminating then crashed', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Capture status before termination starts
      const beforeStatus = managedProcess.status;
      assert.strictEqual(beforeStatus, 'busy');

      await manager.terminateProcess(managedProcess.id);

      // After termination completes, process has exited so status is crashed
      assert.strictEqual(managedProcess.status, 'crashed');
    });

    it('waits up to 2 seconds for graceful shutdown', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          // Exit gracefully after receiving SIGTERM
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(0), 50);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const start = Date.now();
      await manager.terminateProcess(managedProcess.id);
      const duration = Date.now() - start;

      // Process should exit faster than the 2-second grace period
      // (includes Node.js startup overhead and signal handling)
      assert.ok(duration < 1800); // Much less than 2 seconds
    });

    it('sends SIGKILL if process does not exit gracefully', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          // Ignore SIGTERM
          process.on('SIGTERM', () => {});
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      await manager.terminateProcess(managedProcess.id);

      // Process should eventually be killed
      assert.strictEqual(managedProcess.process.killed, true);
    });

    it('accepts custom signal parameter', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGINT", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Use SIGINT instead of SIGTERM
      await manager.terminateProcess(managedProcess.id, 'SIGINT');

      assert.strictEqual(managedProcess.process.killed, true);
    });

    it('is idempotent - safe to call multiple times', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Call terminate multiple times (only first call actually terminates)
      await manager.terminateProcess(managedProcess.id);
      await manager.terminateProcess(managedProcess.id); // Already terminated - returns immediately
      await manager.terminateProcess(managedProcess.id); // Already terminated - returns immediately

      // Should not throw errors
      assert.strictEqual(managedProcess.process.killed, true);
    });

    it('returns immediately for non-existent process', async () => {
      // Should not throw error
      await manager.terminateProcess('non-existent-id');
    });

    it('returns immediately for already terminated process', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(0)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit naturally
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      const start = Date.now();
      await manager.terminateProcess(managedProcess.id);
      const duration = Date.now() - start;

      // Should return immediately without waiting 2 seconds
      assert.ok(duration < 500);
    });
  });

  describe('releaseProcess', () => {
    it('terminates the process', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      await manager.releaseProcess(managedProcess.id);

      assert.strictEqual(managedProcess.process.killed, true);
    });

    it('is equivalent to terminateProcess with default signal', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      await manager.releaseProcess(managedProcess.id);

      // After completion, process has exited so status is crashed
      assert.strictEqual(managedProcess.status, 'crashed');
      assert.strictEqual(managedProcess.process.killed, true);
    });

    it('does not throw for non-existent process', async () => {
      // Should not throw error
      await manager.releaseProcess('non-existent-id');
    });
  });

  describe('shutdown', () => {
    it('terminates all active processes', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      // Spawn multiple processes
      const process1 = await manager.acquireProcess(config);
      const process2 = await manager.acquireProcess(config);
      const process3 = await manager.acquireProcess(config);

      // Shutdown all processes
      await manager.shutdown();

      // All processes should be killed
      assert.strictEqual(process1.process.killed, true);
      assert.strictEqual(process2.process.killed, true);
      assert.strictEqual(process3.process.killed, true);
    });

    it('terminates processes in parallel', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          // Exit gracefully after receiving SIGTERM
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(0), 50);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      // Spawn 3 processes
      await manager.acquireProcess(config);
      await manager.acquireProcess(config);
      await manager.acquireProcess(config);

      const start = Date.now();
      await manager.shutdown();
      const duration = Date.now() - start;

      // If sequential, would take 3 * ~1000ms = 3000ms
      // If parallel, should take ~1000ms (much less than sequential)
      assert.ok(duration < 2000); // Much less than sequential (3000ms)
    });

    it('handles empty process list', async () => {
      // Should not throw error when no processes are running
      await manager.shutdown();
    });

    it('is idempotent - safe to call multiple times', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);

      // Call shutdown multiple times (first call terminates, rest are no-ops)
      await manager.shutdown();
      await manager.shutdown(); // No processes left - returns immediately
      await manager.shutdown(); // No processes left - returns immediately

      // Should not throw errors
    });

    it('handles mix of running and terminated processes', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const configExit: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(0)'],
        workDir: process.cwd(),
      };

      // Spawn running and exiting processes
      const running = await manager.acquireProcess(config);
      const exiting = await manager.acquireProcess(configExit);

      // Wait for exiting process to finish
      await new Promise<void>((resolve) => {
        exiting.process.once('exit', () => setTimeout(resolve, 50));
      });

      // Shutdown should handle both
      await manager.shutdown();

      assert.strictEqual(running.process.killed, true);
    });
  });

  describe('Graceful Shutdown Scenarios', () => {
    it('allows process to clean up during grace period', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          let cleaned = false;
          process.on('SIGTERM', () => {
            cleaned = true;
            console.log('cleaned');
            process.exit(0);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = '';
      managedProcess.streams.stdout.on('data', (data) => {
        output += data.toString();
      });

      // Small delay to ensure listener is ready
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.terminateProcess(managedProcess.id);

      // Give a bit more time for output to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Process should have had time to clean up
      assert.ok(output.includes('cleaned'));
    });

    it('force kills process that ignores SIGTERM', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          // Ignore SIGTERM completely
          process.on('SIGTERM', () => {
            console.log('ignored');
            // Don't exit
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = '';
      managedProcess.streams.stdout.on('data', (data) => {
        output += data.toString();
      });

      // Small delay to ensure listener is ready
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.terminateProcess(managedProcess.id);

      // Give a bit more time for output to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Process should be killed despite ignoring SIGTERM
      assert.strictEqual(managedProcess.process.killed, true);
      assert.ok(output.includes('ignored'));
    });
  });
});
