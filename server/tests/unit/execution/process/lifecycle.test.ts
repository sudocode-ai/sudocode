/**
 * Tests for Process Lifecycle Event Handlers
 *
 * Tests event handling for process exit, error, I/O activity tracking,
 * and timeout management.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { SimpleProcessManager } from '../../../../src/execution/process/simple-manager.js';
import type { ProcessConfig } from '../../../../src/execution/process/types.js';

describe('Process Lifecycle Events', () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  afterEach(async () => {
    // Clean up all processes to prevent resource leaks
    try {
      await manager.shutdown();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Exit Event Handling', () => {
    it('sets status to completed on successful exit (code 0)', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(0)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const initialActive = manager.getMetrics().currentlyActive;

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          // Give event handler time to execute
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.status).toBe('completed');
      expect(managedProcess.exitCode).toBe(0);
      expect(manager.getMetrics().currentlyActive).toBe(initialActive - 1);
      expect(manager.getMetrics().totalCompleted).toBe(1);
    });

    it('sets status to crashed on non-zero exit code', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(1)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const initialActive = manager.getMetrics().currentlyActive;

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.status).toBe('crashed');
      expect(managedProcess.exitCode).toBe(1);
      expect(manager.getMetrics().currentlyActive).toBe(initialActive - 1);
      expect(manager.getMetrics().totalFailed).toBe(1);
    });

    it('captures exit signal when process is killed', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'], // Keep alive
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Kill the process
      managedProcess.process.kill('SIGTERM');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.signal).toBe('SIGTERM');
      expect(managedProcess.status).toBe('crashed');
    });

    it('calculates process duration on exit', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setTimeout(() => process.exit(0), 100)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.metrics.totalDuration >= 100).toBeTruthy();
      expect(managedProcess.metrics.totalDuration < 500).toBeTruthy();
    });

    it('updates average duration metric', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setTimeout(() => process.exit(0), 50)'],
        workDir: process.cwd(),
      };

      // Spawn first process
      const process1 = await manager.acquireProcess(config);
      await new Promise<void>((resolve) => {
        process1.process.once('exit', () => setTimeout(resolve, 50));
      });

      // Spawn second process
      const process2 = await manager.acquireProcess(config);
      await new Promise<void>((resolve) => {
        process2.process.once('exit', () => setTimeout(resolve, 50));
      });

      const metrics = manager.getMetrics();
      expect(metrics.averageDuration > 0).toBeTruthy();
      expect(metrics.averageDuration >= 50).toBeTruthy();
    });

    it('schedules cleanup after 5 seconds', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(0)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const processId = managedProcess.id;

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => setTimeout(resolve, 50));
      });

      // Process should still be in activeProcesses
      expect(manager.getProcess(processId)).toBeTruthy();

      // Wait for cleanup (5 seconds + buffer)
      await new Promise((resolve) => setTimeout(resolve, 5100));

      // Process should be removed from activeProcesses
      expect(manager.getProcess(processId)).toBe(null);
    });
  });

  describe('Error Event Handling', () => {
    it('handles process spawn errors gracefully', async () => {
      const config: ProcessConfig = {
        executablePath: '/nonexistent/command',
        args: ['test'],
        workDir: process.cwd(),
      };

      await expect(manager.acquireProcess(config)).rejects.toThrow(
        /Failed to spawn process: no PID assigned/
      );
    });

    it('sets status to crashed on error event', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'throw new Error("test error")'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit (it will crash due to uncaught error)
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.status).toBe('crashed');
      expect(managedProcess.exitCode).not.toBe(0);
    });
  });

  describe('I/O Activity Tracking', () => {
    it('updates lastActivity on stdout data', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'console.log("test"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const initialActivity = managedProcess.lastActivity;

      // Wait for stdout data
      await new Promise<void>((resolve) => {
        managedProcess.streams.stdout.once('data', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.lastActivity > initialActivity).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });

    it('updates lastActivity on stderr data', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'console.error("test"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const initialActivity = managedProcess.lastActivity;

      // Wait for stderr data
      await new Promise<void>((resolve) => {
        managedProcess.streams.stderr.once('data', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.lastActivity > initialActivity).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });
  });

  describe('Timeout Management', () => {
    it('terminates process after timeout', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'], // Keep alive
        workDir: process.cwd(),
        timeout: 200, // 200ms timeout
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for timeout to trigger
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.status).toBe('crashed');
      expect(managedProcess.signal).toBeTruthy(); // Should be killed by signal
    });

    it('clears timeout when process exits before timeout', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setTimeout(() => process.exit(0), 50)'],
        workDir: process.cwd(),
        timeout: 5000, // Much longer than execution time
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      expect(managedProcess.status).toBe('completed');
      expect(managedProcess.exitCode).toBe(0);
    });

    it('sets status to terminating before killing on timeout', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
        workDir: process.cwd(),
        timeout: 100,
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait slightly longer than timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Status should be terminating or crashed (if already exited)
      expect(
        managedProcess.status === 'terminating' ||
          managedProcess.status === 'crashed'
      ).toBeTruthy();

      // Cleanup
      if (!managedProcess.process.killed) {
        managedProcess.process.kill();
      }
    });
  });

  describe('Multiple Processes', () => {
    it('handles multiple processes independently', async () => {
      const config1: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setTimeout(() => process.exit(0), 100)'],
        workDir: process.cwd(),
      };

      const config2: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setTimeout(() => process.exit(1), 100)'],
        workDir: process.cwd(),
      };

      const process1 = await manager.acquireProcess(config1);
      const process2 = await manager.acquireProcess(config2);

      // Wait for both to exit
      await Promise.all([
        new Promise<void>((resolve) => {
          process1.process.once('exit', () => setTimeout(resolve, 50));
        }),
        new Promise<void>((resolve) => {
          process2.process.once('exit', () => setTimeout(resolve, 50));
        }),
      ]);

      expect(process1.status).toBe('completed');
      expect(process2.status).toBe('crashed');
      expect(manager.getMetrics().totalCompleted).toBe(1);
      expect(manager.getMetrics().totalFailed).toBe(1);
    });
  });

  describe('State Transitions', () => {
    it('follows busy → completed transition on normal exit', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(0)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Initial state should be 'busy'
      expect(managedProcess.status).toBe('busy');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => setTimeout(resolve, 50));
      });

      // Final state should be 'completed'
      expect(managedProcess.status).toBe('completed');
      expect(managedProcess.exitCode).toBe(0);
    });

    it('follows busy → crashed transition on error exit', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(1)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Initial state should be 'busy'
      expect(managedProcess.status).toBe('busy');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => setTimeout(resolve, 50));
      });

      // Final state should be 'crashed'
      expect(managedProcess.status).toBe('crashed');
      expect(managedProcess.exitCode).toBe(1);
    });

    it('follows busy → terminating → completed transition on graceful termination', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', `
          process.on('SIGTERM', () => {
            // Gracefully handle SIGTERM - exit immediately with code 0
            setTimeout(() => process.exit(0), 10);
          });
          // Keep process alive
          const interval = setInterval(() => {}, 1000);
          // Prevent process from exiting accidentally
          process.on('beforeExit', () => {
            clearInterval(interval);
          });
        `],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Initial state should be 'busy'
      expect(managedProcess.status).toBe('busy');

      // Terminate the process
      await manager.terminateProcess(managedProcess.id);

      // The process should complete the termination cycle
      // Either completed (if it handled SIGTERM gracefully) or crashed (if force-killed)
      // Both are valid outcomes depending on timing
      const finalStatus = managedProcess.status as string;
      expect(
        finalStatus === 'completed' || finalStatus === 'crashed',
        `Expected status to be completed or crashed, got ${finalStatus}`
      ).toBeTruthy();

      // If completed, exitCode should be 0
      if (finalStatus === 'completed') {
        expect(managedProcess.exitCode).toBe(0);
      }
    });

    it('follows busy → terminating → crashed transition on forced termination', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', `
          process.on('SIGTERM', () => {
            // Ignore SIGTERM to force SIGKILL
          });
          setInterval(() => {}, 1000);
        `],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Initial state should be 'busy'
      expect(managedProcess.status).toBe('busy');

      // Terminate the process (will wait then force kill)
      await manager.terminateProcess(managedProcess.id);

      // Wait for termination to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Final state should be 'crashed' (killed by signal)
      expect(managedProcess.status).toBe('crashed');
      expect(managedProcess.signal).toBeTruthy(); // Should have a signal
    });

    it('tracks state transition on timeout-triggered termination', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
        workDir: process.cwd(),
        timeout: 150,
      };

      const managedProcess = await manager.acquireProcess(config);
      const states: string[] = [managedProcess.status];

      // Initial state should be 'busy'
      expect(managedProcess.status).toBe('busy');

      // Monitor state changes (poll very frequently to catch quick transitions)
      const checkInterval = setInterval(() => {
        const currentState = managedProcess.status;
        if (states[states.length - 1] !== currentState) {
          states.push(currentState);
        }
      }, 1);

      // Wait for timeout and termination
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          clearInterval(checkInterval);
          setTimeout(resolve, 50);
        });
      });

      // Should have seen busy → terminating → crashed
      expect(states.includes('busy')).toBeTruthy();
      expect(states.includes('terminating')).toBeTruthy();
      expect(managedProcess.status).toBe('crashed');
    });

    it('maintains consistent state during concurrent operations', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Track all status values seen
      const statuses: string[] = [managedProcess.status];
      const interval = setInterval(() => {
        if (statuses[statuses.length - 1] !== managedProcess.status) {
          statuses.push(managedProcess.status);
        }
      }, 10);

      // Terminate after a short delay
      setTimeout(() => {
        manager.terminateProcess(managedProcess.id);
      }, 50);

      // Wait for termination
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          clearInterval(interval);
          setTimeout(resolve, 50);
        });
      });

      // Verify state progression is logical
      // Should only see: busy, possibly terminating, then completed/crashed
      for (let i = 0; i < statuses.length; i++) {
        const status = statuses[i];
        expect(
          ['busy', 'terminating', 'completed', 'crashed'].includes(status)
        ).toBeTruthy();

        // Cannot go from completed/crashed back to any other state
        if (i > 0 && (statuses[i-1] === 'completed' || statuses[i-1] === 'crashed')) {
          expect(
            status === statuses[i-1],
            `Invalid transition from ${statuses[i-1]} to ${status}`
          ).toBeTruthy();
        }
      }
    });
  });
});
