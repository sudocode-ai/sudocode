import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { GitContextDetector } from '../../../src/remote/git-context';

vi.mock('child_process');

describe('GitContextDetector', () => {
  let detector: GitContextDetector;

  beforeEach(() => {
    detector = new GitContextDetector();
    vi.clearAllMocks();
  });

  describe('isGitRepository', () => {
    it('should return true when in a git repository', () => {
      vi.mocked(execSync).mockReturnValue('.git' as any);

      const result = detector.isGitRepository();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('git rev-parse --git-dir', {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    });

    it('should return false when not in a git repository', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not a git repository');
      });

      const result = detector.isGitRepository();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', () => {
      vi.mocked(execSync).mockReturnValue('main\n' as any);

      const result = detector.getCurrentBranch();

      expect(result).toBe('main');
      expect(execSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    });

    it('should trim whitespace from branch name', () => {
      vi.mocked(execSync).mockReturnValue('  feature/test  \n' as any);

      const result = detector.getCurrentBranch();

      expect(result).toBe('feature/test');
    });

    it('should throw error when not in a git repository', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not a git repository');
      });

      expect(() => detector.getCurrentBranch()).toThrow(
        'Failed to get current branch: not in a git repository'
      );
    });
  });

  describe('getRemoteUrl', () => {
    it('should get URL for origin remote by default', () => {
      vi.mocked(execSync).mockReturnValue(
        'https://github.com/owner/repo.git\n' as any
      );

      const result = detector.getRemoteUrl();

      expect(result).toBe('https://github.com/owner/repo.git');
      expect(execSync).toHaveBeenCalledWith('git remote get-url origin', {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    });

    it('should get URL for specified remote', () => {
      vi.mocked(execSync).mockReturnValue(
        'git@github.com:owner/repo.git\n' as any
      );

      const result = detector.getRemoteUrl('upstream');

      expect(result).toBe('git@github.com:owner/repo.git');
      expect(execSync).toHaveBeenCalledWith('git remote get-url upstream', {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    });

    it('should throw error when remote does not exist', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('No such remote');
      });

      expect(() => detector.getRemoteUrl('invalid')).toThrow(
        "Failed to get remote URL for 'invalid'"
      );
    });
  });

  describe('parseRemote', () => {
    describe('HTTPS format', () => {
      it('should parse HTTPS URL with .git suffix', () => {
        const result = detector.parseRemote('https://github.com/owner/repo.git');

        expect(result).toEqual({
          owner: 'owner',
          repo: 'repo',
        });
      });

      it('should parse HTTPS URL without .git suffix', () => {
        const result = detector.parseRemote('https://github.com/owner/repo');

        expect(result).toEqual({
          owner: 'owner',
          repo: 'repo',
        });
      });

      it('should parse HTTP URL (non-HTTPS)', () => {
        const result = detector.parseRemote('http://github.com/owner/repo.git');

        expect(result).toEqual({
          owner: 'owner',
          repo: 'repo',
        });
      });

      it('should handle different hostnames', () => {
        const result = detector.parseRemote('https://gitlab.com/org/project.git');

        expect(result).toEqual({
          owner: 'org',
          repo: 'project',
        });
      });
    });

    describe('SSH format', () => {
      it('should parse SSH URL with .git suffix', () => {
        const result = detector.parseRemote('git@github.com:owner/repo.git');

        expect(result).toEqual({
          owner: 'owner',
          repo: 'repo',
        });
      });

      it('should parse SSH URL without .git suffix', () => {
        const result = detector.parseRemote('git@github.com:owner/repo');

        expect(result).toEqual({
          owner: 'owner',
          repo: 'repo',
        });
      });

      it('should handle different hostnames', () => {
        const result = detector.parseRemote('git@gitlab.com:org/project.git');

        expect(result).toEqual({
          owner: 'org',
          repo: 'project',
        });
      });
    });

    describe('error handling', () => {
      it('should throw error for invalid URL format', () => {
        expect(() => detector.parseRemote('invalid-url')).toThrow(
          'Unable to parse git remote URL: invalid-url'
        );
      });

      it('should throw error for malformed HTTPS URL', () => {
        expect(() => detector.parseRemote('https://github.com/invalid')).toThrow(
          'Unable to parse git remote URL'
        );
      });

      it('should throw error for malformed SSH URL', () => {
        expect(() => detector.parseRemote('git@github.com:invalid')).toThrow(
          'Unable to parse git remote URL'
        );
      });
    });
  });

  describe('detectContext', () => {
    beforeEach(() => {
      // Mock isGitRepository to return true by default
      vi.spyOn(detector, 'isGitRepository').mockReturnValue(true);
    });

    it('should detect full context from git repository', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('main');
      vi.spyOn(detector, 'getRemoteUrl').mockReturnValue(
        'https://github.com/owner/repo.git'
      );

      const result = detector.detectContext();

      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
      });
    });

    it('should throw error when not in git repository', () => {
      vi.spyOn(detector, 'isGitRepository').mockReturnValue(false);

      expect(() => detector.detectContext()).toThrow('Not in a git repository');
    });

    it('should override branch when provided', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('main');
      vi.spyOn(detector, 'getRemoteUrl').mockReturnValue(
        'https://github.com/owner/repo.git'
      );

      const result = detector.detectContext({ branch: 'feature/test' });

      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'feature/test',
      });
      expect(detector.getCurrentBranch).not.toHaveBeenCalled();
    });

    it('should override owner when provided', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('main');
      vi.spyOn(detector, 'getRemoteUrl').mockReturnValue(
        'https://github.com/detected-owner/repo.git'
      );

      const result = detector.detectContext({ owner: 'override-owner' });

      expect(result).toEqual({
        owner: 'override-owner',
        repo: 'repo',
        branch: 'main',
      });
    });

    it('should override repo when provided', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('main');
      vi.spyOn(detector, 'getRemoteUrl').mockReturnValue(
        'https://github.com/owner/detected-repo.git'
      );

      const result = detector.detectContext({ repo: 'override-repo' });

      expect(result).toEqual({
        owner: 'owner',
        repo: 'override-repo',
        branch: 'main',
      });
    });

    it('should skip remote detection when both owner and repo are provided', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('main');
      const getRemoteUrlSpy = vi.spyOn(detector, 'getRemoteUrl');

      const result = detector.detectContext({
        owner: 'custom-owner',
        repo: 'custom-repo',
      });

      expect(result).toEqual({
        owner: 'custom-owner',
        repo: 'custom-repo',
        branch: 'main',
      });
      expect(getRemoteUrlSpy).not.toHaveBeenCalled();
    });

    it('should use custom remote name when provided', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('main');
      vi.spyOn(detector, 'getRemoteUrl').mockReturnValue(
        'git@github.com:upstream-owner/upstream-repo.git'
      );

      const result = detector.detectContext({ remote: 'upstream' });

      expect(result).toEqual({
        owner: 'upstream-owner',
        repo: 'upstream-repo',
        branch: 'main',
      });
      expect(detector.getRemoteUrl).toHaveBeenCalledWith('upstream');
    });

    it('should work with SSH remote format', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('develop');
      vi.spyOn(detector, 'getRemoteUrl').mockReturnValue(
        'git@github.com:ssh-owner/ssh-repo.git'
      );

      const result = detector.detectContext();

      expect(result).toEqual({
        owner: 'ssh-owner',
        repo: 'ssh-repo',
        branch: 'develop',
      });
    });

    it('should combine multiple overrides', () => {
      vi.spyOn(detector, 'getCurrentBranch').mockReturnValue('main');
      vi.spyOn(detector, 'getRemoteUrl').mockReturnValue(
        'https://github.com/detected-owner/detected-repo.git'
      );

      const result = detector.detectContext({
        owner: 'override-owner',
        branch: 'override-branch',
      });

      expect(result).toEqual({
        owner: 'override-owner',
        repo: 'detected-repo',
        branch: 'override-branch',
      });
    });
  });
});
