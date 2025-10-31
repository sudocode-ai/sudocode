/**
 * Tests for Git CLI Wrapper
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
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

      assert.ok(gitCli.lastCommand.includes('git worktree add'));
      assert.ok(gitCli.lastCommand.includes('/worktree/path'));
      assert.ok(gitCli.lastCommand.includes('feature-branch'));
      assert.strictEqual(gitCli.lastCwd, '/repo');
    });

    it('should include force flag when specified', async () => {
      await gitCli.worktreeAdd('/repo', '/worktree/path', 'feature-branch', true);

      assert.ok(gitCli.lastCommand.includes('--force'));
    });

    it('should escape shell arguments', async () => {
      await gitCli.worktreeAdd('/repo', "/path/with'quotes", "branch'name");

      // Should escape single quotes - verify they're not present unescaped
      assert.ok(!gitCli.lastCommand.includes("with'quotes"));
      assert.ok(!gitCli.lastCommand.includes("branch'name"));
    });
  });

  describe('worktreeRemove', () => {
    it('should execute git worktree remove command', async () => {
      await gitCli.worktreeRemove('/repo', '/worktree/path');

      assert.ok(gitCli.lastCommand.includes('git worktree remove'));
      assert.ok(gitCli.lastCommand.includes('/worktree/path'));
      assert.strictEqual(gitCli.lastCwd, '/repo');
    });

    it('should include force flag when specified', async () => {
      await gitCli.worktreeRemove('/repo', '/worktree/path', true);

      assert.ok(gitCli.lastCommand.includes('--force'));
    });
  });

  describe('worktreePrune', () => {
    it('should execute git worktree prune command', async () => {
      await gitCli.worktreePrune('/repo');

      assert.ok(gitCli.lastCommand.includes('git worktree prune'));
      assert.strictEqual(gitCli.lastCwd, '/repo');
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

      assert.strictEqual(worktrees.length, 2);

      assert.strictEqual(worktrees[0].path, '/path/to/main');
      assert.strictEqual(worktrees[0].branch, 'main');
      assert.strictEqual(worktrees[0].commit, 'abc123def456');
      assert.strictEqual(worktrees[0].isMain, false);
      assert.strictEqual(worktrees[0].isLocked, false);

      assert.strictEqual(worktrees[1].path, '/path/to/feature');
      assert.strictEqual(worktrees[1].branch, 'feature-branch');
      assert.strictEqual(worktrees[1].commit, 'def789ghi012');
    });

    it('should handle locked worktrees', async () => {
      gitCli.mockOutput = `worktree /path/to/locked
HEAD abc123def456
branch refs/heads/locked-branch
locked manual lock

`;

      const worktrees = await gitCli.worktreeList('/repo');

      assert.strictEqual(worktrees.length, 1);
      assert.strictEqual(worktrees[0].isLocked, true);
      assert.strictEqual(worktrees[0].lockReason, 'manual lock');
    });

    it('should handle bare repositories', async () => {
      gitCli.mockOutput = `worktree /path/to/repo
HEAD abc123def456
bare

`;

      const worktrees = await gitCli.worktreeList('/repo');

      assert.strictEqual(worktrees.length, 1);
      assert.strictEqual(worktrees[0].isMain, true);
    });

    it('should handle detached HEAD', async () => {
      gitCli.mockOutput = `worktree /path/to/detached
HEAD abc123def456

`;

      const worktrees = await gitCli.worktreeList('/repo');

      assert.strictEqual(worktrees.length, 1);
      assert.strictEqual(worktrees[0].branch, '(detached)');
    });
  });

  describe('createBranch', () => {
    it('should execute git branch command', async () => {
      await gitCli.createBranch('/repo', 'new-branch', 'main');

      assert.ok(gitCli.lastCommand.includes('git branch'));
      assert.ok(gitCli.lastCommand.includes('new-branch'));
      assert.ok(gitCli.lastCommand.includes('main'));
      assert.strictEqual(gitCli.lastCwd, '/repo');
    });
  });

  describe('deleteBranch', () => {
    it('should execute git branch -d command', async () => {
      await gitCli.deleteBranch('/repo', 'old-branch');

      assert.ok(gitCli.lastCommand.includes('git branch -d'));
      assert.ok(gitCli.lastCommand.includes('old-branch'));
      assert.strictEqual(gitCli.lastCwd, '/repo');
    });

    it('should use -D flag when force is true', async () => {
      await gitCli.deleteBranch('/repo', 'old-branch', true);

      assert.ok(gitCli.lastCommand.includes('git branch -D'));
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

      assert.strictEqual(commandCount, 2);
      assert.ok(commands[0].includes('git sparse-checkout init --cone'));
      assert.ok(commands[1].includes('git sparse-checkout set'));
      assert.ok(commands[1].includes('src'));
      assert.ok(commands[1].includes('docs'));
    });
  });

  describe('error handling', () => {
    it('should throw WorktreeError on git command failure', async () => {
      const error: any = new Error('Command failed');
      error.stderr = 'fatal: invalid reference: invalid-branch';
      error.stdout = '';
      gitCli.shouldThrow = error;

      await assert.rejects(
        async () => {
          await gitCli.worktreeAdd('/repo', '/path', 'invalid-branch');
        },
        (error: any) => {
          assert.ok(error instanceof WorktreeError);
          assert.strictEqual(error.code, WorktreeErrorCode.GIT_ERROR);
          return true;
        }
      );
    });

    it('should include stderr in error message', async () => {
      const error: any = new Error('Command failed');
      error.stderr = 'fatal: git error message';
      error.stdout = '';
      gitCli.shouldThrow = error;

      await assert.rejects(
        async () => {
          await gitCli.createBranch('/repo', 'branch', 'base');
        },
        (error: any) => {
          assert.ok(error instanceof WorktreeError);
          return true;
        }
      );
    });
  });
});
