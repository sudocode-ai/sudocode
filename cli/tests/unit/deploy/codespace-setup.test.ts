/**
 * Unit tests for Codespace setup utilities
 *
 * These tests verify that setup functions construct correct commands
 * without actually executing them in a real Codespace.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sshModule from '../../../src/deploy/utils/codespace-ssh.js';
import {
  installClaudeCode,
  installSudocodeGlobally,
  initializeSudocodeProject,
  startSudocodeServer
} from '../../../src/deploy/utils/codespace-setup.js';

// Mock the SSH module
vi.mock('../../../src/deploy/utils/codespace-ssh.js');

describe('Codespace Setup Utilities', () => {
  const mockCodespaceName = 'test-codespace-abc123';
  let execInCodespaceMock: any;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    execInCodespaceMock = vi.mocked(sshModule.execInCodespace);
  });

  describe('installClaudeCode', () => {
    it('should execute installation command with correct parameters', async () => {
      execInCodespaceMock.mockResolvedValue('Installation complete');

      await installClaudeCode(mockCodespaceName);

      expect(execInCodespaceMock).toHaveBeenCalledWith(
        mockCodespaceName,
        'curl -fsSL https://claude.ai/install.sh | bash',
        {
          timeout: 300000,      // 5 minutes
          streamOutput: true
        }
      );
    });

    it('should throw error if installation fails', async () => {
      execInCodespaceMock.mockRejectedValue(new Error('Installation failed'));

      await expect(installClaudeCode(mockCodespaceName))
        .rejects.toThrow('Installation failed');
    });
  });

  describe('installSudocodeGlobally', () => {
    it('should execute npm install with correct packages and timeout', async () => {
      execInCodespaceMock.mockResolvedValue('Packages installed');

      await installSudocodeGlobally(mockCodespaceName);

      expect(execInCodespaceMock).toHaveBeenCalledWith(
        mockCodespaceName,
        'npm install -g @sudocode-ai/cli @sudocode-ai/local-server',
        {
          timeout: 300000,      // 5 minutes
          streamOutput: true
        }
      );
    });

    it('should stream output during installation', async () => {
      execInCodespaceMock.mockResolvedValue('Packages installed');

      await installSudocodeGlobally(mockCodespaceName);

      const callOptions = execInCodespaceMock.mock.calls[0][2];
      expect(callOptions.streamOutput).toBe(true);
    });

    it('should throw error if npm install fails', async () => {
      execInCodespaceMock.mockRejectedValue(new Error('npm install failed'));

      await expect(installSudocodeGlobally(mockCodespaceName))
        .rejects.toThrow('npm install failed');
    });
  });

  describe('initializeSudocodeProject', () => {
    it('should check for existing .sudocode directory first', async () => {
      execInCodespaceMock
        .mockResolvedValueOnce('0')  // .sudocode doesn't exist
        .mockResolvedValueOnce('');  // sudocode init completes

      await initializeSudocodeProject(mockCodespaceName);

      // First call checks for directory
      expect(execInCodespaceMock).toHaveBeenNthCalledWith(
        1,
        mockCodespaceName,
        'test -d .sudocode && echo "1" || echo "0"',
        { streamOutput: false }
      );

      // Second call runs init
      expect(execInCodespaceMock).toHaveBeenNthCalledWith(
        2,
        mockCodespaceName,
        'sudocode init',
        { timeout: 10000 }
      );
    });

    it('should skip initialization if .sudocode already exists', async () => {
      execInCodespaceMock.mockResolvedValue('1');  // .sudocode exists

      await initializeSudocodeProject(mockCodespaceName);

      // Only one call to check for directory
      expect(execInCodespaceMock).toHaveBeenCalledTimes(1);
      expect(execInCodespaceMock).toHaveBeenCalledWith(
        mockCodespaceName,
        'test -d .sudocode && echo "1" || echo "0"',
        { streamOutput: false }
      );
    });

    it('should handle whitespace in directory check result', async () => {
      execInCodespaceMock
        .mockResolvedValueOnce('  0\n')  // .sudocode doesn't exist (with whitespace)
        .mockResolvedValueOnce('');      // sudocode init completes

      await initializeSudocodeProject(mockCodespaceName);

      expect(execInCodespaceMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('startSudocodeServer', () => {
    it('should start server with nohup in background', async () => {
      execInCodespaceMock.mockResolvedValue('');

      await startSudocodeServer(mockCodespaceName, 3000, 72);

      expect(execInCodespaceMock).toHaveBeenCalledWith(
        mockCodespaceName,
        'nohup sudocode server start --host 0.0.0.0 --port 3000 --keep-alive 72h ' +
        '> /tmp/sudocode-3000.log 2>&1 &',
        {
          streamOutput: false,
          timeout: 5000
        }
      );
    });

    it('should use custom port and keep-alive duration', async () => {
      execInCodespaceMock.mockResolvedValue('');

      await startSudocodeServer(mockCodespaceName, 8080, 24);

      const command = execInCodespaceMock.mock.calls[0][1];
      expect(command).toContain('--port 8080');
      expect(command).toContain('--keep-alive 24h');
      expect(command).toContain('> /tmp/sudocode-8080.log');
    });

    it('should not stream output for background process', async () => {
      execInCodespaceMock.mockResolvedValue('');

      await startSudocodeServer(mockCodespaceName, 3000, 72);

      const callOptions = execInCodespaceMock.mock.calls[0][2];
      expect(callOptions.streamOutput).toBe(false);
    });

    it('should use short timeout for background start', async () => {
      execInCodespaceMock.mockResolvedValue('');

      await startSudocodeServer(mockCodespaceName, 3000, 72);

      const callOptions = execInCodespaceMock.mock.calls[0][2];
      expect(callOptions.timeout).toBe(5000);  // 5 seconds
    });

    it('should redirect both stdout and stderr to log file', async () => {
      execInCodespaceMock.mockResolvedValue('');

      await startSudocodeServer(mockCodespaceName, 3000, 72);

      const command = execInCodespaceMock.mock.calls[0][1];
      expect(command).toContain('2>&1');  // stderr redirected to stdout
    });
  });
});
