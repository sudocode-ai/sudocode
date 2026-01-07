/**
 * Unit tests for codespace-ssh utilities
 *
 * These tests mock the SSH command execution to verify:
 * - Command construction and quoting
 * - Timeout logic
 * - Polling retry counts
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as cp from 'child_process';

// Mock child_process before importing our module
vi.mock('child_process');

describe('codespace-ssh utilities', () => {
  let execInCodespace: any;
  let checkPortListening: any;
  let waitForPortListening: any;
  let killProcessOnPort: any;

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Import module after mocking
    const module = await import('../../../src/deploy/utils/codespace-ssh.js');
    execInCodespace = module.execInCodespace;
    checkPortListening = module.checkPortListening;
    waitForPortListening = module.waitForPortListening;
    killProcessOnPort = module.killProcessOnPort;
  });

  describe('execInCodespace', () => {
    it('should construct SSH command correctly', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, 'output', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await execInCodespace('test-codespace', 'echo hello', { streamOutput: false });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('gh codespace ssh --codespace test-codespace'),
        expect.objectContaining({ timeout: 120000 }),
        expect.any(Function)
      );
    });

    it('should properly escape double quotes in commands', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        // Verify the command has escaped quotes
        expect(cmd).toMatch(/echo \\"hello\\"/);
        callback(null, 'output', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await execInCodespace('test-codespace', 'echo "hello"', { streamOutput: false });
    });

    it('should wrap command with cd when cwd is specified', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        expect(cmd).toMatch(/cd \/workspaces\/myrepo && npm install/);
        callback(null, 'output', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await execInCodespace('test-codespace', 'npm install', {
        cwd: '/workspaces/myrepo',
        streamOutput: false
      });
    });

    it('should use default cwd of /workspaces/* when not specified', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        expect(cmd).toMatch(/cd \/workspaces\/\* && pwd/);
        callback(null, 'output', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await execInCodespace('test-codespace', 'pwd', { streamOutput: false });
    });

    it('should respect custom timeout', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        expect(opts.timeout).toBe(60000);
        callback(null, 'output', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await execInCodespace('test-codespace', 'echo test', {
        timeout: 60000,
        streamOutput: false
      });
    });

    it('should stream output when streamOutput is true', async () => {
      const mockStdoutOn = vi.fn();
      const mockStderrOn = vi.fn();
      const mockExec = vi.mocked(cp.exec);

      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, 'output', '');
        return {
          stdout: { on: mockStdoutOn },
          stderr: { on: mockStderrOn }
        } as any;
      }) as any);

      await execInCodespace('test-codespace', 'echo test', { streamOutput: true });

      expect(mockStdoutOn).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockStderrOn).toHaveBeenCalledWith('data', expect.any(Function));
    });

    it('should not stream output when streamOutput is false', async () => {
      const mockStdoutOn = vi.fn();
      const mockStderrOn = vi.fn();
      const mockExec = vi.mocked(cp.exec);

      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, 'output', '');
        return {
          stdout: { on: mockStdoutOn },
          stderr: { on: mockStderrOn }
        } as any;
      }) as any);

      await execInCodespace('test-codespace', 'echo test', { streamOutput: false });

      expect(mockStdoutOn).not.toHaveBeenCalled();
      expect(mockStderrOn).not.toHaveBeenCalled();
    });

    it('should reject with descriptive error on command failure', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(new Error('Command failed'), '', 'error output');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await expect(
        execInCodespace('test-codespace', 'failing-command', { streamOutput: false })
      ).rejects.toThrow(/Failed to execute in Codespace test-codespace: failing-command/);
    });
  });

  describe('checkPortListening', () => {
    it('should return true when port is listening', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, '1\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      const result = await checkPortListening('test-codespace', 3000);
      expect(result).toBe(true);
    });

    it('should return false when port is not listening', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, '0\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      const result = await checkPortListening('test-codespace', 3000);
      expect(result).toBe(false);
    });

    it('should return false on command error', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(new Error('SSH failed'), '', 'error');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      const result = await checkPortListening('test-codespace', 3000);
      expect(result).toBe(false);
    });

    it('should construct lsof command correctly', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        expect(cmd).toMatch(/lsof -ti:8080/);
        callback(null, '1\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await checkPortListening('test-codespace', 8080);
    });
  });

  describe('waitForPortListening', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve immediately if port is already listening', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, '1\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      const promise = waitForPortListening('test-codespace', 3000);
      await promise;

      expect(mockExec).toHaveBeenCalledTimes(1);
    });

    it('should poll with 2-second intervals', async () => {
      const mockExec = vi.mocked(cp.exec);
      let callCount = 0;

      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callCount++;
        // Succeed on third call
        callback(null, callCount === 3 ? '1\n' : '0\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      const promise = waitForPortListening('test-codespace', 3000);

      // Advance timers to trigger retries
      await vi.advanceTimersByTimeAsync(2000); // First retry
      await vi.advanceTimersByTimeAsync(2000); // Second retry
      await promise;

      expect(callCount).toBe(3);
    });

    it('should respect maxRetries parameter', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, '0\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      // Start the promise with immediate catch to prevent unhandled rejection
      let rejectionError: Error | null = null;
      const promise = waitForPortListening('test-codespace', 3000, 3).catch(err => {
        rejectionError = err;
        throw err;
      });

      // Advance through all retries
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      await expect(promise).rejects.toThrow(/Port 3000 not listening.*after 6s/);
      expect(mockExec).toHaveBeenCalledTimes(3);
      expect(rejectionError).toBeTruthy();
    });

    it('should use default maxRetries of 15', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, '0\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      // Start the promise with immediate catch to prevent unhandled rejection
      let rejectionError: Error | null = null;
      const promise = waitForPortListening('test-codespace', 3000).catch(err => {
        rejectionError = err;
        throw err;
      });

      // Advance through all default retries
      for (let i = 0; i < 15; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      await expect(promise).rejects.toThrow(/Port 3000 not listening.*after 30s/);
      expect(mockExec).toHaveBeenCalledTimes(15);
      expect(rejectionError).toBeTruthy();
    });

    it('should throw descriptive error on timeout', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(null, '0\n', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      // Start the promise with immediate catch to prevent unhandled rejection
      let rejectionError: Error | null = null;
      const promise = waitForPortListening('test-codespace', 8080, 5).catch(err => {
        rejectionError = err;
        throw err;
      });

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      await expect(promise).rejects.toThrow(
        'Port 8080 not listening in Codespace test-codespace after 10s'
      );
      expect(rejectionError).toBeTruthy();
    });
  });

  describe('killProcessOnPort', () => {
    it('should execute kill command silently', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        expect(cmd).toMatch(/lsof -ti:3000.*xargs kill -9/);
        callback(null, '', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await killProcessOnPort('test-codespace', 3000);
      expect(mockExec).toHaveBeenCalled();
    });

    it('should not throw on command failure', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        callback(new Error('No process found'), '', 'error');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await expect(killProcessOnPort('test-codespace', 3000)).resolves.not.toThrow();
    });

    it('should include "|| true" to ensure command always succeeds', async () => {
      const mockExec = vi.mocked(cp.exec);
      mockExec.mockImplementation(((cmd: string, opts: any, callback: any) => {
        expect(cmd).toMatch(/\|\| true/);
        callback(null, '', '');
        return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() } } as any;
      }) as any);

      await killProcessOnPort('test-codespace', 3000);
    });
  });
});
