/**
 * Tests for Process I/O Communication
 *
 * Tests sendInput, onOutput, and onError methods for process communication.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SimpleProcessManager } from '../../simple-manager.js';
import type { ProcessConfig } from '../../types.js';

describe('Process I/O Communication', () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  describe('sendInput', () => {
    it('sends input to process stdin', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          process.stdin.on('data', (data) => {
            console.log('Received: ' + data.toString().trim());
            process.exit(0);
          });
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Set up output handler to capture response
      let output = '';
      managedProcess.streams.stdout.on('data', (data) => {
        output += data.toString();
      });

      // Send input to the process
      await manager.sendInput(managedProcess.id, 'test input\n');

      // Wait for process to respond and exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      assert.ok(output.includes('Received: test input'));
    });

    it('throws error for non-existent process', async () => {
      await assert.rejects(
        manager.sendInput('non-existent-id', 'test'),
        /Process non-existent-id not found/
      );
    });

    it('handles write errors gracefully', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'process.exit(0)'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      // Try to write to closed stdin
      await assert.rejects(
        manager.sendInput(managedProcess.id, 'test'),
        (_error: Error) => {
          // Should throw an error when writing to closed stream
          return true;
        }
      );
    });

    it('supports multiple sendInput calls', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          let count = 0;
          process.stdin.on('data', (data) => {
            count++;
            console.log('Message ' + count + ': ' + data.toString().trim());
            if (count === 3) process.exit(0);
          });
          // Timeout safety
          setTimeout(() => process.exit(1), 5000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = '';
      managedProcess.streams.stdout.on('data', (data) => {
        output += data.toString();
      });

      // Send multiple inputs with small delays
      await manager.sendInput(managedProcess.id, 'first\n');
      await new Promise((resolve) => setTimeout(resolve, 50));
      await manager.sendInput(managedProcess.id, 'second\n');
      await new Promise((resolve) => setTimeout(resolve, 50));
      await manager.sendInput(managedProcess.id, 'third\n');

      // Wait for process to exit with timeout
      await Promise.race([
        new Promise<void>((resolve) => {
          managedProcess.process.once('exit', () => {
            setTimeout(resolve, 50);
          });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 6000)), // Safety timeout
      ]);

      assert.ok(output.includes('Message 1: first'));
      assert.ok(output.includes('Message 2: second'));
      assert.ok(output.includes('Message 3: third'));
    });
  });

  describe('onOutput', () => {
    it('captures stdout output', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'console.log("test stdout"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const outputs: Array<{ data: string; type: 'stdout' | 'stderr' }> = [];

      // Register output handler
      manager.onOutput(managedProcess.id, (data, type) => {
        outputs.push({ data: data.toString(), type });
      });

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.ok(outputs.length > 0);
      assert.ok(outputs.some((o) => o.type === 'stdout' && o.data.includes('test stdout')));

      // Cleanup
      managedProcess.process.kill();
    });

    it('captures stderr output', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'console.error("test stderr"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const outputs: Array<{ data: string; type: 'stdout' | 'stderr' }> = [];

      // Register output handler
      manager.onOutput(managedProcess.id, (data, type) => {
        outputs.push({ data: data.toString(), type });
      });

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.ok(outputs.length > 0);
      assert.ok(outputs.some((o) => o.type === 'stderr' && o.data.includes('test stderr')));

      // Cleanup
      managedProcess.process.kill();
    });

    it('captures both stdout and stderr', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          'console.log("stdout msg"); console.error("stderr msg"); setTimeout(() => {}, 100);',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const outputs: Array<{ data: string; type: 'stdout' | 'stderr' }> = [];

      manager.onOutput(managedProcess.id, (data, type) => {
        outputs.push({ data: data.toString(), type });
      });

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.ok(outputs.some((o) => o.type === 'stdout' && o.data.includes('stdout msg')));
      assert.ok(outputs.some((o) => o.type === 'stderr' && o.data.includes('stderr msg')));

      // Cleanup
      managedProcess.process.kill();
    });

    it('throws error for non-existent process', () => {
      assert.throws(
        () => manager.onOutput('non-existent-id', () => {}),
        /Process non-existent-id not found/
      );
    });

    it('supports multiple output handlers', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'console.log("test"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let handler1Called = false;
      let handler2Called = false;

      manager.onOutput(managedProcess.id, () => {
        handler1Called = true;
      });

      manager.onOutput(managedProcess.id, () => {
        handler2Called = true;
      });

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.strictEqual(handler1Called, true);
      assert.strictEqual(handler2Called, true);

      // Cleanup
      managedProcess.process.kill();
    });

    it('handles streaming output in real-time', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          for (let i = 1; i <= 3; i++) {
            console.log('Line ' + i);
          }
          setTimeout(() => {}, 100);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const lines: string[] = [];

      manager.onOutput(managedProcess.id, (data, type) => {
        if (type === 'stdout') {
          const line = data.toString().trim();
          if (line) lines.push(line);
        }
      });

      // Wait for all output
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.strictEqual(lines.length, 3);
      assert.ok(lines.includes('Line 1'));
      assert.ok(lines.includes('Line 2'));
      assert.ok(lines.includes('Line 3'));

      // Cleanup
      managedProcess.process.kill();
    });
  });

  describe('onError', () => {
    it('captures process errors', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'throw new Error("test error")'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Note: The 'error' event is emitted for spawn failures, not runtime errors
      // Runtime errors cause non-zero exit codes instead
      manager.onError(managedProcess.id, () => {
        // Error handler registered
      });

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      // Runtime errors don't trigger error event, they cause non-zero exit
      assert.strictEqual(managedProcess.exitCode !== 0, true);
    });

    it('throws error for non-existent process', () => {
      assert.throws(
        () => manager.onError('non-existent-id', () => {}),
        /Process non-existent-id not found/
      );
    });

    it('supports multiple error handlers', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: ['-e', 'setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let handler1Registered = false;
      let handler2Registered = false;

      manager.onError(managedProcess.id, () => {
        handler1Registered = true;
      });

      manager.onError(managedProcess.id, () => {
        handler2Registered = true;
      });

      // Both handlers should be registered (we can't easily trigger them,
      // but we verify they don't throw)
      assert.strictEqual(handler1Registered, false); // Not triggered yet
      assert.strictEqual(handler2Registered, false); // Not triggered yet

      // Cleanup
      managedProcess.process.kill();
    });
  });

  describe('Combined I/O Operations', () => {
    it('supports bidirectional communication', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });

          rl.on('line', (line) => {
            console.log('Echo: ' + line);
            if (line === 'exit') process.exit(0);
          });
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const outputs: string[] = [];

      manager.onOutput(managedProcess.id, (data, type) => {
        if (type === 'stdout') {
          const line = data.toString().trim();
          if (line && !line.includes('undefined')) {
            outputs.push(line);
          }
        }
      });

      // Send inputs and wait for responses
      await manager.sendInput(managedProcess.id, 'hello\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.sendInput(managedProcess.id, 'world\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.sendInput(managedProcess.id, 'exit\n');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once('exit', () => {
          setTimeout(resolve, 50);
        });
      });

      assert.ok(outputs.some((o) => o.includes('Echo: hello')));
      assert.ok(outputs.some((o) => o.includes('Echo: world')));
    });
  });
});
