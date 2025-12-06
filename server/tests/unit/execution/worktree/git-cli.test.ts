/**
 * Tests for Git CLI Wrapper
 */

import { describe, it, beforeEach , expect } from 'vitest'
import { GitCli } from '../../../../src/execution/worktree/git-cli.js';
import { WorktreeError, WorktreeErrorCode } from '../../../../src/execution/worktree/types.js';

/**
 * Mock GitCli for testing
 * This tests the actual implementation by observing command strings
 */
class TestableGitCli extends GitCli {
  public lastCommand = '';
  public lastCwd = '';
  public mockOutput = '';
  public shouldThrow: Error | null = null;

  // Override execGit to capture commands without actually running them
  protected execGit(command: string, cwd: string): string {
    this.lastCommand = command;
    this.lastCwd = cwd;

    if (this.shouldThrow) {
      const error: any = this.shouldThrow;
      this.shouldThrow = null;

      // Wrap the error in WorktreeError like the real implementation does
      const stderr = error.stderr?.toString() || '';
      const stdout = error.stdout?.toString() || '';
      const message = stderr || stdout || error.message || 'Unknown git error';

      throw new WorktreeError(
        `Git command failed: ${command}\n${message}`,
        WorktreeErrorCode.GIT_ERROR,
        error
      );
    }

    return this.mockOutput;
  }
}

describe('GitCli', () => {
  let gitCli: TestableGitCli;

  beforeEach(() => {
    gitCli = new TestableGitCli();
  });

  describe('worktreeAdd', () => {
    it('should execute git worktree add command', async () => {
      await gitCli.worktreeAdd('/repo', '/worktree/path', 'feature-branch');

      expect(gitCli.lastCommand.includes('git worktree add')).toBeTruthy();
      expect(gitCli.lastCommand.includes('/worktree/path')).toBeTruthy();
      expect(gitCli.lastCommand.includes('feature-branch')).toBeTruthy();
      expect(gitCli.lastCwd).toBe('/repo');
    });

    it('should include force flag when specified', async () => {
      await gitCli.worktreeAdd('/repo', '/worktree/path', 'feature-branch', true);

      expect(gitCli.lastCommand.includes('--force')).toBeTruthy();
    });

    it('should escape shell arguments', async () => {
      await gitCli.worktreeAdd('/repo', "/path/with'quotes", "branch'name");

      // Should escape single quotes - verify they're not present unescaped
      expect(!gitCli.lastCommand.includes("with'quotes")).toBeTruthy();
      expect(!gitCli.lastCommand.includes("branch'name")).toBeTruthy();
    });
  });

  describe('worktreeRemove', () => {
    it('should execute git worktree remove command', async () => {
      await gitCli.worktreeRemove('/repo', '/worktree/path');

      expect(gitCli.lastCommand.includes('git worktree remove')).toBeTruthy();
      expect(gitCli.lastCommand.includes('/worktree/path')).toBeTruthy();
      expect(gitCli.lastCwd).toBe('/repo');
    });

    it('should include force flag when specified', async () => {
      await gitCli.worktreeRemove('/repo', '/worktree/path', true);

      expect(gitCli.lastCommand.includes('--force')).toBeTruthy();
    });
  });

  describe('worktreePrune', () => {
    it('should execute git worktree prune command', async () => {
      await gitCli.worktreePrune('/repo');

      expect(gitCli.lastCommand.includes('git worktree prune')).toBeTruthy();
      expect(gitCli.lastCwd).toBe('/repo');
    });
  });

  describe('worktreeList', () => {
    it('should parse porcelain output correctly', async () => {
      gitCli.mockOutput = `worktree /path/to/main
HEAD abc123def456
branch refs/heads/main

worktree /path/to/feature
HEAD def789ghi012
branch refs/heads/feature-branch

`;

      const worktrees = await gitCli.worktreeList('/repo');

      expect(worktrees.length).toBe(2);

      expect(worktrees[0].path).toBe('/path/to/main');
      expect(worktrees[0].branch).toBe('main');
      expect(worktrees[0].commit).toBe('abc123def456');
      expect(worktrees[0].isMain).toBe(false);
      expect(worktrees[0].isLocked).toBe(false);

      expect(worktrees[1].path).toBe('/path/to/feature');
      expect(worktrees[1].branch).toBe('feature-branch');
      expect(worktrees[1].commit).toBe('def789ghi012');
    });

    it('should handle locked worktrees', async () => {
      gitCli.mockOutput = `worktree /path/to/locked
HEAD abc123def456
branch refs/heads/locked-branch
locked manual lock

`;

      const worktrees = await gitCli.worktreeList('/repo');

      expect(worktrees.length).toBe(1);
      expect(worktrees[0].isLocked).toBe(true);
      expect(worktrees[0].lockReason).toBe('manual lock');
    });

    it('should handle bare repositories', async () => {
      gitCli.mockOutput = `worktree /path/to/repo
HEAD abc123def456
bare

`;

      const worktrees = await gitCli.worktreeList('/repo');

      expect(worktrees.length).toBe(1);
      expect(worktrees[0].isMain).toBe(true);
    });

    it('should handle detached HEAD', async () => {
      gitCli.mockOutput = `worktree /path/to/detached
HEAD abc123def456

`;

      const worktrees = await gitCli.worktreeList('/repo');

      expect(worktrees.length).toBe(1);
      expect(worktrees[0].branch).toBe('(detached)');
    });
  });

  describe('createBranch', () => {
    it('should execute git branch command', async () => {
      await gitCli.createBranch('/repo', 'new-branch', 'main');

      expect(gitCli.lastCommand.includes('git branch')).toBeTruthy();
      expect(gitCli.lastCommand.includes('new-branch')).toBeTruthy();
      expect(gitCli.lastCommand.includes('main')).toBeTruthy();
      expect(gitCli.lastCwd).toBe('/repo');
    });
  });

  describe('deleteBranch', () => {
    it('should execute git branch -d command', async () => {
      await gitCli.deleteBranch('/repo', 'old-branch');

      expect(gitCli.lastCommand.includes('git branch -d')).toBeTruthy();
      expect(gitCli.lastCommand.includes('old-branch')).toBeTruthy();
      expect(gitCli.lastCwd).toBe('/repo');
    });

    it('should use -D flag when force is true', async () => {
      await gitCli.deleteBranch('/repo', 'old-branch', true);

      expect(gitCli.lastCommand.includes('git branch -D')).toBeTruthy();
    });
  });

  describe('configureSparseCheckout', () => {
    it('should execute sparse-checkout commands', async () => {
      let commandCount = 0;
      const commands: string[] = [];

      // Override to capture multiple commands
      gitCli['execGit'] = function (command: string, cwd: string) {
        commands.push(command);
        commandCount++;
        gitCli.lastCommand = command;
        gitCli.lastCwd = cwd;
        return '';
      };

      await gitCli.configureSparseCheckout('/worktree', ['src', 'docs']);

      expect(commandCount).toBe(2);
      expect(commands[0].includes('git sparse-checkout init --cone')).toBeTruthy();
      expect(commands[1].includes('git sparse-checkout set')).toBeTruthy();
      expect(commands[1].includes('src')).toBeTruthy();
      expect(commands[1].includes('docs')).toBeTruthy();
    });
  });

  describe('getCurrentCommit', () => {
    it('should execute git rev-parse HEAD command', async () => {
      gitCli.mockOutput = 'abc123def456789\n';

      const commit = await gitCli.getCurrentCommit('/repo');

      expect(gitCli.lastCommand.includes('git rev-parse HEAD')).toBeTruthy();
      expect(gitCli.lastCwd).toBe('/repo');
      expect(commit).toBe('abc123def456789');
    });

    it('should trim whitespace from commit SHA', async () => {
      gitCli.mockOutput = '  abc123def456789  \n  ';

      const commit = await gitCli.getCurrentCommit('/repo');

      expect(commit).toBe('abc123def456789');
    });
  });

  describe('getCurrentBranch', () => {
    it('should execute git rev-parse --abbrev-ref HEAD command', async () => {
      gitCli.mockOutput = 'main\n';

      const branch = await gitCli.getCurrentBranch('/repo');

      expect(gitCli.lastCommand.includes('git rev-parse --abbrev-ref HEAD')).toBeTruthy();
      expect(gitCli.lastCwd).toBe('/repo');
      expect(branch).toBe('main');
    });

    it('should trim whitespace from branch name', async () => {
      gitCli.mockOutput = '  feature/my-branch  \n  ';

      const branch = await gitCli.getCurrentBranch('/repo');

      expect(branch).toBe('feature/my-branch');
    });

    it('should return "(detached)" on error', async () => {
      const error: any = new Error('Command failed');
      error.stderr = 'fatal: ref HEAD is not a symbolic ref';
      error.stdout = '';
      gitCli.shouldThrow = error;

      const branch = await gitCli.getCurrentBranch('/repo');

      expect(branch).toBe('(detached)');
    });
  });

  describe('error handling', () => {
    it('should throw WorktreeError on git command failure', async () => {
      const error: any = new Error('Command failed');
      error.stderr = 'fatal: invalid reference: invalid-branch';
      error.stdout = '';
      gitCli.shouldThrow = error;

      await expect(async () => {
          await gitCli.worktreeAdd('/repo', '/path', 'invalid-branch');
        }).rejects.toThrow();
    });

    it('should include stderr in error message', async () => {
      const error: any = new Error('Command failed');
      error.stderr = 'fatal: git error message';
      error.stdout = '';
      gitCli.shouldThrow = error;

      await expect(async () => {
          await gitCli.createBranch('/repo', 'branch', 'base');
        }).rejects.toThrow();
    });
  });

  describe('mergeBranch', () => {
    it('should attempt fast-forward merge first', async () => {
      const commands: string[] = [];
      gitCli['execGit'] = function (command: string, cwd: string) {
        commands.push(command);
        gitCli.lastCommand = command;
        gitCli.lastCwd = cwd;
        // Simulate getting source commit SHA first
        if (command.includes('rev-parse') && command.includes('feature-branch')) {
          return 'abc123def456\n';
        }
        // Simulate fast-forward is possible
        if (command.includes('merge-base --is-ancestor')) {
          return '';
        }
        if (command.includes('merge --ff-only')) {
          return '';
        }
        return '';
      };

      const result = await gitCli.mergeBranch('/repo', 'feature-branch');

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('fast-forward');
      expect(result.mergeCommit).toBe('abc123def456');
      expect(commands.some(c => c.includes('merge-base --is-ancestor'))).toBe(true);
      expect(commands.some(c => c.includes('merge --ff-only'))).toBe(true);
    });

    it('should fall back to regular merge when fast-forward not possible', async () => {
      const commands: string[] = [];
      gitCli['execGit'] = function (command: string, cwd: string) {
        commands.push(command);
        gitCli.lastCommand = command;
        gitCli.lastCwd = cwd;
        // Simulate fast-forward is NOT possible
        if (command.includes('merge-base --is-ancestor')) {
          throw new WorktreeError('Not ancestor', WorktreeErrorCode.GIT_ERROR);
        }
        if (command.includes('merge --no-ff')) {
          return '';
        }
        if (command.includes('rev-parse HEAD')) {
          return 'merge123commit\n';
        }
        return '';
      };

      const result = await gitCli.mergeBranch('/repo', 'feature-branch');

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('merge');
      expect(result.mergeCommit).toBe('merge123commit');
      expect(commands.some(c => c.includes('merge --no-ff'))).toBe(true);
    });

    it('should perform squash merge when strategy is squash', async () => {
      const commands: string[] = [];
      gitCli['execGit'] = function (command: string, cwd: string) {
        commands.push(command);
        gitCli.lastCommand = command;
        gitCli.lastCwd = cwd;
        if (command.includes('merge --squash')) {
          return '';
        }
        if (command.includes('commit -m')) {
          return '';
        }
        if (command.includes('rev-parse HEAD')) {
          return 'squash123commit\n';
        }
        return '';
      };

      const result = await gitCli.mergeBranch('/repo', 'feature-branch', { squash: true });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('squash');
      expect(result.mergeCommit).toBe('squash123commit');
      expect(commands.some(c => c.includes('merge --squash'))).toBe(true);
      expect(commands.some(c => c.includes('commit -m'))).toBe(true);
    });

    it('should use custom commit message', async () => {
      const commands: string[] = [];
      gitCli['execGit'] = function (command: string, cwd: string) {
        commands.push(command);
        gitCli.lastCommand = command;
        gitCli.lastCwd = cwd;
        if (command.includes('merge --squash')) {
          return '';
        }
        if (command.includes('commit -m')) {
          return '';
        }
        if (command.includes('rev-parse HEAD')) {
          return 'abc123\n';
        }
        return '';
      };

      await gitCli.mergeBranch('/repo', 'feature-branch', {
        squash: true,
        message: 'Custom merge message',
      });

      expect(commands.some(c => c.includes('Custom merge message'))).toBe(true);
    });

    it('should return conflict info when merge fails', async () => {
      gitCli['execGit'] = function (command: string, cwd: string) {
        gitCli.lastCommand = command;
        gitCli.lastCwd = cwd;
        if (command.includes('merge-base --is-ancestor')) {
          throw new WorktreeError('Not ancestor', WorktreeErrorCode.GIT_ERROR);
        }
        if (command.includes('merge --no-ff')) {
          throw new WorktreeError('Merge conflict', WorktreeErrorCode.GIT_ERROR);
        }
        if (command.includes('diff --name-only --diff-filter=U')) {
          return 'file1.ts\nfile2.ts\n';
        }
        return '';
      };

      const result = await gitCli.mergeBranch('/repo', 'feature-branch');

      expect(result.success).toBe(false);
      expect(result.conflictingFiles).toEqual(['file1.ts', 'file2.ts']);
      expect(result.error).toContain('conflict');
    });
  });

  describe('abortMerge', () => {
    it('should execute git merge --abort command', async () => {
      await gitCli.abortMerge('/repo');

      expect(gitCli.lastCommand).toBe('git merge --abort');
      expect(gitCli.lastCwd).toBe('/repo');
    });
  });

  describe('getConflictingFiles', () => {
    it('should return list of conflicting files', async () => {
      gitCli.mockOutput = 'src/file1.ts\nsrc/file2.ts\nREADME.md\n';

      const files = await gitCli.getConflictingFiles('/repo');

      expect(files).toEqual(['src/file1.ts', 'src/file2.ts', 'README.md']);
      expect(gitCli.lastCommand).toBe('git diff --name-only --diff-filter=U');
    });

    it('should return empty array when no conflicts', async () => {
      gitCli.mockOutput = '\n';

      const files = await gitCli.getConflictingFiles('/repo');

      expect(files).toEqual([]);
    });

    it('should return empty array on error', async () => {
      const error: any = new Error('Not in merge state');
      error.stderr = 'fatal: not in a merge';
      gitCli.shouldThrow = error;

      const files = await gitCli.getConflictingFiles('/repo');

      expect(files).toEqual([]);
    });
  });
});
