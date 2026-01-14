import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { GitContextDetector } from '../../../src/deploy/git-context';

// Mock child_process
vi.mock('child_process');

describe('GitContextDetector', () => {
  const mockExecSync = vi.mocked(execSync);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGitRepository', () => {
    it('should return true when in a git repository', () => {
      mockExecSync.mockReturnValue('.git\n' as any);

      const result = GitContextDetector.isGitRepository();

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --git-dir', {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    });

    it('should return false when not in a git repository', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const result = GitContextDetector.isGitRepository();

      expect(result).toBe(false);
    });

    it('should use custom cwd when provided', () => {
      mockExecSync.mockReturnValue('.git\n' as any);
      const customCwd = '/custom/path';

      GitContextDetector.isGitRepository(customCwd);

      expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --git-dir', {
        cwd: customCwd,
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', () => {
      mockExecSync.mockReturnValue('main\n' as any);

      const result = GitContextDetector.getCurrentBranch();

      expect(result).toBe('main');
      expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    });

    it('should trim whitespace from branch name', () => {
      mockExecSync.mockReturnValue('  feature/test  \n' as any);

      const result = GitContextDetector.getCurrentBranch();

      expect(result).toBe('feature/test');
    });

    it('should throw error when branch name is empty', () => {
      mockExecSync.mockReturnValue('' as any);

      expect(() => GitContextDetector.getCurrentBranch()).toThrow('Could not determine current branch');
    });

    it('should throw error when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Git error');
      });

      expect(() => GitContextDetector.getCurrentBranch()).toThrow('Failed to get current branch');
    });

    it('should use custom cwd when provided', () => {
      mockExecSync.mockReturnValue('main\n' as any);
      const customCwd = '/custom/path';

      GitContextDetector.getCurrentBranch(customCwd);

      expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', {
        cwd: customCwd,
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    });
  });

  describe('parseRemote', () => {
    it('should parse HTTPS remote URL with .git suffix', () => {
      const remote = 'https://github.com/owner/repo.git';

      const result = GitContextDetector.parseRemote(remote);

      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse HTTPS remote URL without .git suffix', () => {
      const remote = 'https://github.com/owner/repo';

      const result = GitContextDetector.parseRemote(remote);

      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH remote URL with .git suffix', () => {
      const remote = 'git@github.com:owner/repo.git';

      const result = GitContextDetector.parseRemote(remote);

      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH remote URL without .git suffix', () => {
      const remote = 'git@github.com:owner/repo';

      const result = GitContextDetector.parseRemote(remote);

      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should handle owner and repo with hyphens and underscores', () => {
      const remote = 'https://github.com/my-org_name/my-repo_name.git';

      const result = GitContextDetector.parseRemote(remote);

      expect(result).toEqual({ owner: 'my-org_name', repo: 'my-repo_name' });
    });

    it('should throw error for empty remote URL', () => {
      expect(() => GitContextDetector.parseRemote('')).toThrow('Remote URL is empty');
    });

    it('should throw error for invalid remote URL format', () => {
      const remote = 'https://gitlab.com/owner/repo.git';

      expect(() => GitContextDetector.parseRemote(remote)).toThrow('Invalid GitHub remote URL format');
    });

    it('should throw error for malformed GitHub URL', () => {
      const remote = 'https://github.com/invalid';

      expect(() => GitContextDetector.parseRemote(remote)).toThrow('Invalid GitHub remote URL format');
    });

    it('should throw error when owner is missing', () => {
      const remote = 'https://github.com//repo.git';

      expect(() => GitContextDetector.parseRemote(remote)).toThrow('Invalid GitHub remote URL format');
    });
  });

  describe('detectContext', () => {
    beforeEach(() => {
      // Default mocks for successful detection
      mockExecSync.mockImplementation((command: string) => {
        if (command === 'git rev-parse --git-dir') {
          return '.git\n' as any;
        }
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          return 'main\n' as any;
        }
        if (command === 'git config --get remote.origin.url') {
          return 'https://github.com/owner/repo.git\n' as any;
        }
        return '' as any;
      });
    });

    it('should detect context from git repository', () => {
      const result = GitContextDetector.detectContext();

      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'main'
      });
    });

    it('should throw error when not in git repository', () => {
      mockExecSync.mockImplementation((command: string) => {
        if (command === 'git rev-parse --git-dir') {
          throw new Error('Not a git repository');
        }
        return '' as any;
      });

      expect(() => GitContextDetector.detectContext()).toThrow('Not in a git repository');
    });

    it('should use branch override from options', () => {
      const result = GitContextDetector.detectContext({ branch: 'feature/test' });

      expect(result.branch).toBe('feature/test');
      // Should not call git command for branch
      expect(mockExecSync).not.toHaveBeenCalledWith(
        'git rev-parse --abbrev-ref HEAD',
        expect.any(Object)
      );
    });

    it('should use repo override from options', () => {
      const result = GitContextDetector.detectContext({ repo: 'custom-owner/custom-repo' });

      expect(result).toEqual({
        owner: 'custom-owner',
        repo: 'custom-repo',
        branch: 'main'
      });
      // Should not call git command for remote
      expect(mockExecSync).not.toHaveBeenCalledWith(
        'git config --get remote.origin.url',
        expect.any(Object)
      );
    });

    it('should throw error for invalid repo override format', () => {
      expect(() => GitContextDetector.detectContext({ repo: 'invalid' })).toThrow('Invalid --repo format');
    });

    it('should throw error when no remote.origin.url found', () => {
      mockExecSync.mockImplementation((command: string) => {
        if (command === 'git rev-parse --git-dir') {
          return '.git\n' as any;
        }
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          return 'main\n' as any;
        }
        if (command === 'git config --get remote.origin.url') {
          return '' as any;
        }
        return '' as any;
      });

      expect(() => GitContextDetector.detectContext()).toThrow('No remote.origin.url found');
    });

    it('should throw error when remote.origin.url command fails', () => {
      mockExecSync.mockImplementation((command: string) => {
        if (command === 'git rev-parse --git-dir') {
          return '.git\n' as any;
        }
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          return 'main\n' as any;
        }
        if (command === 'git config --get remote.origin.url') {
          throw new Error('Git config failed');
        }
        return '' as any;
      });

      expect(() => GitContextDetector.detectContext()).toThrow('Failed to detect git context');
    });

    it('should use custom cwd when provided', () => {
      const customCwd = '/custom/path';

      GitContextDetector.detectContext({ cwd: customCwd });

      expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --git-dir', {
        cwd: customCwd,
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    });

    it('should handle SSH remote URL', () => {
      mockExecSync.mockImplementation((command: string) => {
        if (command === 'git rev-parse --git-dir') {
          return '.git\n' as any;
        }
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          return 'main\n' as any;
        }
        if (command === 'git config --get remote.origin.url') {
          return 'git@github.com:ssh-owner/ssh-repo.git\n' as any;
        }
        return '' as any;
      });

      const result = GitContextDetector.detectContext();

      expect(result).toEqual({
        owner: 'ssh-owner',
        repo: 'ssh-repo',
        branch: 'main'
      });
    });

    it('should override both branch and repo', () => {
      const result = GitContextDetector.detectContext({
        branch: 'feature/custom',
        repo: 'override-owner/override-repo'
      });

      expect(result).toEqual({
        owner: 'override-owner',
        repo: 'override-repo',
        branch: 'feature/custom'
      });
    });
  });
});
