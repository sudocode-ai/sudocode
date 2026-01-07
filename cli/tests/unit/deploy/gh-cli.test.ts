/**
 * Unit tests for GitHub CLI utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ghCli from '../../../src/deploy/utils/gh-cli';
import { exec } from 'child_process';
import { promisify } from 'util';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

const execPromise = promisify(exec);

describe('gh-cli utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkGhCliInstalled', () => {
    it('should succeed when gh CLI is installed', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, { stdout: 'gh version 2.40.0', stderr: '' });
        return {} as any;
      });

      await expect(ghCli.checkGhCliInstalled()).resolves.toBeUndefined();
    });

    it('should throw error when gh CLI is not installed', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(new Error('command not found'), { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(ghCli.checkGhCliInstalled()).rejects.toThrow(
        'GitHub CLI not found'
      );
    });
  });

  describe('checkGhAuthenticated', () => {
    it('should succeed when authenticated', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, { stdout: 'Logged in', stderr: '' });
        return {} as any;
      });

      await expect(ghCli.checkGhAuthenticated()).resolves.toBeUndefined();
    });

    it('should throw error when not authenticated', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(new Error('not logged in'), { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(ghCli.checkGhAuthenticated()).rejects.toThrow(
        'Not authenticated with GitHub'
      );
    });
  });

  describe('getCurrentGitRepo', () => {
    it('should parse SSH URL format', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, {
          stdout: 'git@github.com:owner/repo.git\n',
          stderr: ''
        });
        return {} as any;
      });

      const result = await ghCli.getCurrentGitRepo();
      expect(result).toBe('owner/repo');
    });

    it('should parse HTTPS URL format', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, {
          stdout: 'https://github.com/owner/repo.git\n',
          stderr: ''
        });
        return {} as any;
      });

      const result = await ghCli.getCurrentGitRepo();
      expect(result).toBe('owner/repo');
    });

    it('should throw error for non-GitHub URL', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, {
          stdout: 'https://gitlab.com/owner/repo.git\n',
          stderr: ''
        });
        return {} as any;
      });

      await expect(ghCli.getCurrentGitRepo()).rejects.toThrow(
        'Not a GitHub repository'
      );
    });
  });

  describe('createCodespace', () => {
    it('should create Codespace with correct configuration', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        expect(cmd).toContain('gh codespace create');
        expect(cmd).toContain('--repo owner/repo');
        expect(cmd).toContain('--machine basicLinux32gb');
        expect(cmd).toContain('--idle-timeout 240m');
        expect(cmd).toContain('--retention-period 336h');
        expect(cmd).not.toContain('--json'); // Verify --json NOT present

        callback(null, {
          stdout: 'friendly-space-abc123\n', // Plain text output
          stderr: ''
        });
        return {} as any;
      });

      const result = await ghCli.createCodespace({
        repository: 'owner/repo',
        machine: 'basicLinux32gb',
        idleTimeout: 240,
        retentionPeriod: 14
      });

      expect(result).toEqual({
        name: 'friendly-space-abc123',
        url: 'https://friendly-space-abc123.github.dev',
        state: 'Starting'
      });
    });

    it('should throw error on creation failure', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(new Error('API error'), { stdout: '', stderr: 'Error' });
        return {} as any;
      });

      await expect(
        ghCli.createCodespace({
          repository: 'owner/repo',
          machine: 'basicLinux32gb',
          idleTimeout: 240,
          retentionPeriod: 14
        })
      ).rejects.toThrow('Failed to create Codespace');
    });

    it('should convert 1 day to 24h', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        expect(cmd).toContain('--retention-period 24h');
        expect(cmd).not.toContain('--json');
        callback(null, {
          stdout: 'test-codespace\n',
          stderr: ''
        });
        return {} as any;
      });

      await ghCli.createCodespace({
        repository: 'owner/repo',
        machine: 'basicLinux32gb',
        idleTimeout: 240,
        retentionPeriod: 1
      });
    });

    it('should convert 30 days to 720h (maximum)', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        expect(cmd).toContain('--retention-period 720h');
        expect(cmd).not.toContain('--json');
        callback(null, {
          stdout: 'test-codespace\n',
          stderr: ''
        });
        return {} as any;
      });

      await ghCli.createCodespace({
        repository: 'owner/repo',
        machine: 'basicLinux32gb',
        idleTimeout: 240,
        retentionPeriod: 30
      });
    });

    it('should convert 7 days to 168h', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        expect(cmd).toContain('--retention-period 168h');
        expect(cmd).not.toContain('--json');
        callback(null, {
          stdout: 'test-codespace\n',
          stderr: ''
        });
        return {} as any;
      });

      await ghCli.createCodespace({
        repository: 'owner/repo',
        machine: 'basicLinux32gb',
        idleTimeout: 240,
        retentionPeriod: 7
      });
    });
  });

  describe('waitForCodespaceReady', () => {
    it('should return immediately when Codespace is Available', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, {
          stdout: JSON.stringify([
            { name: 'test-codespace', state: 'Available' }
          ]),
          stderr: ''
        });
        return {} as any;
      });

      await expect(
        ghCli.waitForCodespaceReady('test-codespace', 5)
      ).resolves.toBeUndefined();
    });

    it('should poll until Codespace becomes Available', async () => {
      let callCount = 0;

      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callCount++;
        const state = callCount < 3 ? 'Starting' : 'Available';

        callback(null, {
          stdout: JSON.stringify([{ name: 'test-codespace', state }]),
          stderr: ''
        });
        return {} as any;
      });

      await expect(
        ghCli.waitForCodespaceReady('test-codespace', 10)
      ).resolves.toBeUndefined();

      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it('should throw timeout error when maxRetries exceeded', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, {
          stdout: JSON.stringify([
            { name: 'test-codespace', state: 'Starting' }
          ]),
          stderr: ''
        });
        return {} as any;
      });

      await expect(
        ghCli.waitForCodespaceReady('test-codespace', 2)
      ).rejects.toThrow('did not become ready after 4s');
    }, 10000);

    it('should throw timeout error when Codespace not found', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, {
          stdout: JSON.stringify([]),
          stderr: ''
        });
        return {} as any;
      });

      await expect(
        ghCli.waitForCodespaceReady('nonexistent', 2)
      ).rejects.toThrow('did not become ready after 4s');
    });
  });

  describe('deleteCodespace', () => {
    it('should delete Codespace successfully', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        expect(cmd).toContain('gh codespace delete');
        expect(cmd).toContain('--codespace test-codespace');
        expect(cmd).toContain('--force');

        callback(null, { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(
        ghCli.deleteCodespace('test-codespace')
      ).resolves.toBeUndefined();
    });

    it('should throw error on deletion failure', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(new Error('Not found'), { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(ghCli.deleteCodespace('test-codespace')).rejects.toThrow(
        'Failed to delete Codespace test-codespace'
      );
    });
  });

  describe('listCodespaces', () => {
    it('should list all Codespaces', async () => {
      const mockCodespaces = [
        {
          name: 'codespace-1',
          repository: 'owner/repo1',
          state: 'Available',
          createdAt: '2024-01-01T00:00:00Z'
        },
        {
          name: 'codespace-2',
          repository: 'owner/repo2',
          state: 'Starting',
          createdAt: '2024-01-02T00:00:00Z'
        }
      ];

      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, {
          stdout: JSON.stringify(mockCodespaces),
          stderr: ''
        });
        return {} as any;
      });

      const result = await ghCli.listCodespaces();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'codespace-1',
        url: 'https://codespace-1.github.dev',
        state: 'Available',
        repository: 'owner/repo1',
        createdAt: '2024-01-01T00:00:00Z'
      });
      expect(result[1]).toEqual({
        name: 'codespace-2',
        url: 'https://codespace-2.github.dev',
        state: 'Starting',
        repository: 'owner/repo2',
        createdAt: '2024-01-02T00:00:00Z'
      });
    });

    it('should return empty array when no Codespaces exist', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(null, { stdout: '[]', stderr: '' });
        return {} as any;
      });

      const result = await ghCli.listCodespaces();
      expect(result).toEqual([]);
    });

    it('should throw error on list failure', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(new Error('API error'), { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(ghCli.listCodespaces()).rejects.toThrow(
        'Failed to list Codespaces'
      );
    });
  });

  describe('setPortVisibility', () => {
    it('should set port to public successfully', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        expect(cmd).toContain('gh codespace ports visibility');
        expect(cmd).toContain('3000:public');
        expect(cmd).toContain('--codespace test-codespace');

        callback(null, { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(
        ghCli.setPortVisibility('test-codespace', 3000, 'public')
      ).resolves.toBeUndefined();
    });

    it('should set port to private successfully', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        expect(cmd).toContain('3000:private');
        callback(null, { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(
        ghCli.setPortVisibility('test-codespace', 3000, 'private')
      ).resolves.toBeUndefined();
    });

    it('should throw error on visibility change failure', async () => {
      vi.mocked(exec).mockImplementation((cmd: any, callback: any) => {
        callback(new Error('Port not found'), { stdout: '', stderr: '' });
        return {} as any;
      });

      await expect(
        ghCli.setPortVisibility('test-codespace', 3000, 'public')
      ).rejects.toThrow('Failed to set port 3000 visibility');
    });
  });

  describe('getCodespacePortUrl', () => {
    it('should return correct URL format', async () => {
      const url = await ghCli.getCodespacePortUrl('friendly-space-abc123', 3000);
      expect(url).toBe('https://friendly-space-abc123-3000.app.github.dev');
    });

    it('should work with different port numbers', async () => {
      const url1 = await ghCli.getCodespacePortUrl('test-codespace', 8080);
      expect(url1).toBe('https://test-codespace-8080.app.github.dev');

      const url2 = await ghCli.getCodespacePortUrl('another-space', 5000);
      expect(url2).toBe('https://another-space-5000.app.github.dev');
    });
  });

  describe('waitForUrlAccessible', () => {
    // Mock global fetch
    const mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    beforeEach(() => {
      mockFetch.mockClear();
    });

    it('should return immediately when URL is accessible', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await expect(
        ghCli.waitForUrlAccessible('https://test-url.com')
      ).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('https://test-url.com');
    });

    it('should poll until URL becomes accessible', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve({ ok: true });
      });

      await expect(
        ghCli.waitForUrlAccessible('https://test-url.com', 5)
      ).resolves.toBeUndefined();

      expect(callCount).toBe(3);
    }, 10000);

    it('should ignore non-ok responses and continue polling', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: true });
      });

      await expect(
        ghCli.waitForUrlAccessible('https://test-url.com', 5)
      ).resolves.toBeUndefined();

      expect(callCount).toBe(2);
    });

    it('should throw timeout error when maxRetries exceeded', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(
        ghCli.waitForUrlAccessible('https://test-url.com', 2)
      ).rejects.toThrow('URL https://test-url.com not accessible after 4s');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should ignore various error types during polling', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('ECONNREFUSED'));
        } else if (callCount === 2) {
          return Promise.reject(new Error('ETIMEDOUT'));
        } else if (callCount === 3) {
          return Promise.resolve({ ok: false, status: 401 });
        }
        return Promise.resolve({ ok: true });
      });

      await expect(
        ghCli.waitForUrlAccessible('https://test-url.com', 10)
      ).resolves.toBeUndefined();

      expect(callCount).toBe(4);
    }, 10000);
  });
});
