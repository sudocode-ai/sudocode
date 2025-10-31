/**
 * Tests for Worktree Manager
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { WorktreeManager } from '../../../../src/execution/worktree/manager.js';
import type { IGitCli } from '../../../../src/execution/worktree/git-cli.js';
import type {
  WorktreeConfig,
  WorktreeCreateParams,
  WorktreeInfo,
} from '../../../../src/execution/worktree/types.js';
import { WorktreeError, WorktreeErrorCode } from '../../../../src/execution/worktree/types.js';
import fs from 'fs';

/**
 * Mock Git CLI for testing
 */
class MockGitCli implements IGitCli {
  public calls: { method: string; args: any[] }[] = [];
  public worktreeListResult: WorktreeInfo[] = [];
  public shouldThrow: Error | null = null;

  async worktreeAdd(
    _repoPath: string,
    _worktreePath: string,
    _branch: string,
    _force?: boolean
  ): Promise<void> {
    this.calls.push({ method: 'worktreeAdd', args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async worktreeRemove(
    _repoPath: string,
    _worktreePath: string,
    _force?: boolean
  ): Promise<void> {
    this.calls.push({ method: 'worktreeRemove', args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async worktreePrune(_repoPath: string): Promise<void> {
    this.calls.push({ method: 'worktreePrune', args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async worktreeList(_repoPath: string): Promise<WorktreeInfo[]> {
    this.calls.push({ method: 'worktreeList', args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
    return this.worktreeListResult;
  }

  async createBranch(
    _repoPath: string,
    _branchName: string,
    _baseBranch: string
  ): Promise<void> {
    this.calls.push({ method: 'createBranch', args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async deleteBranch(
    _repoPath: string,
    _branchName: string,
    _force?: boolean
  ): Promise<void> {
    this.calls.push({ method: 'deleteBranch', args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async configureSparseCheckout(
    _worktreePath: string,
    _patterns: string[]
  ): Promise<void> {
    this.calls.push({ method: 'configureSparseCheckout', args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  getCallCount(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  getCall(method: string, index = 0): any {
    const methodCalls = this.calls.filter((c) => c.method === method);
    return methodCalls[index]?.args;
  }
}

describe('WorktreeManager', () => {
  let manager: WorktreeManager;
  let mockGit: MockGitCli;
  let config: WorktreeConfig;
  let originalExistsSync: typeof fs.existsSync;
  let originalMkdirSync: typeof fs.mkdirSync;
  let originalRmSync: typeof fs.rmSync;

  beforeEach(() => {
    config = {
      worktreeStoragePath: '.sudocode/worktrees',
      autoCreateBranches: true,
      autoDeleteBranches: false,
      enableSparseCheckout: false,
      sparseCheckoutPatterns: undefined,
      branchPrefix: 'sudocode',
      cleanupOrphanedWorktreesOnStartup: true,
    };

    mockGit = new MockGitCli();

    // Store original fs functions
    originalExistsSync = fs.existsSync;
    originalMkdirSync = fs.mkdirSync;
    originalRmSync = fs.rmSync;

    // Mock fs by default to return true
    (fs.existsSync as any) = () => true;
    (fs.mkdirSync as any) = () => {};
    (fs.rmSync as any) = () => {};

    manager = new WorktreeManager(config, mockGit);
  });

  afterEach(() => {
    // Restore original fs functions
    fs.existsSync = originalExistsSync;
    fs.mkdirSync = originalMkdirSync;
    fs.rmSync = originalRmSync;
  });

  describe('createWorktree', () => {
    it('should create branch if createBranch is true', async () => {
      const params: WorktreeCreateParams = {
        repoPath: '/repo',
        branchName: 'feature-branch',
        worktreePath: '/worktree/feature',
        baseBranch: 'main',
        createBranch: true,
      };

      await manager.createWorktree(params);

      assert.strictEqual(mockGit.getCallCount('createBranch'), 1);
      const call = mockGit.getCall('createBranch', 0);
      assert.strictEqual(call[0], '/repo');
      assert.strictEqual(call[1], 'feature-branch');
      assert.strictEqual(call[2], 'main');
    });

    it('should not create branch if createBranch is false', async () => {
      const params: WorktreeCreateParams = {
        repoPath: '/repo',
        branchName: 'existing-branch',
        worktreePath: '/worktree/feature',
        baseBranch: 'main',
        createBranch: false,
      };

      await manager.createWorktree(params);

      assert.strictEqual(mockGit.getCallCount('createBranch'), 0);
    });

    it('should call git worktree add', async () => {
      const params: WorktreeCreateParams = {
        repoPath: '/repo',
        branchName: 'feature-branch',
        worktreePath: '/worktree/feature',
        baseBranch: 'main',
        createBranch: false,
      };

      await manager.createWorktree(params);

      assert.strictEqual(mockGit.getCallCount('worktreeAdd'), 1);
      const call = mockGit.getCall('worktreeAdd', 0);
      assert.strictEqual(call[0], '/repo');
      assert.strictEqual(call[1], '/worktree/feature');
      assert.strictEqual(call[2], 'feature-branch');
    });

    it('should configure sparse checkout when enabled', async () => {
      config.enableSparseCheckout = true;
      config.sparseCheckoutPatterns = ['src', 'docs'];

      const params: WorktreeCreateParams = {
        repoPath: '/repo',
        branchName: 'feature-branch',
        worktreePath: '/worktree/feature',
        baseBranch: 'main',
        createBranch: false,
      };

      await manager.createWorktree(params);

      assert.strictEqual(mockGit.getCallCount('configureSparseCheckout'), 1);
      const call = mockGit.getCall('configureSparseCheckout', 0);
      assert.strictEqual(call[0], '/worktree/feature');
      assert.deepStrictEqual(call[1], ['src', 'docs']);
    });

    it('should not configure sparse checkout when disabled', async () => {
      config.enableSparseCheckout = false;

      const params: WorktreeCreateParams = {
        repoPath: '/repo',
        branchName: 'feature-branch',
        worktreePath: '/worktree/feature',
        baseBranch: 'main',
        createBranch: false,
      };

      await manager.createWorktree(params);

      assert.strictEqual(mockGit.getCallCount('configureSparseCheckout'), 0);
    });

    it('should throw error if worktree path does not exist after creation', async () => {
      let callCount = 0;
      (fs.existsSync as any) = () => {
        callCount++;
        return callCount === 1;
      };

      const params: WorktreeCreateParams = {
        repoPath: '/repo',
        branchName: 'feature-branch',
        worktreePath: '/worktree/feature',
        baseBranch: 'main',
        createBranch: false,
      };

      await assert.rejects(
        async () => {
          await manager.createWorktree(params);
        },
        (error: any) => {
          assert.ok(error instanceof WorktreeError);
          assert.strictEqual(error.code, WorktreeErrorCode.REPOSITORY_ERROR);
          assert.ok(error.message.includes('path does not exist'));
          return true;
        }
      );
    });
  });

  describe('isWorktreeValid', () => {
    it('should return true when worktree exists and is registered', async () => {
      mockGit.worktreeListResult = [
        {
          path: '/worktree/feature',
          branch: 'feature-branch',
          commit: 'abc123',
          isMain: false,
          isLocked: false,
        },
      ];

      const isValid = await manager.isWorktreeValid('/repo', '/worktree/feature');
      assert.strictEqual(isValid, true);
    });

    it('should return false when worktree path does not exist', async () => {
      (fs.existsSync as any) = () => false;

      const isValid = await manager.isWorktreeValid('/repo', '/worktree/feature');
      assert.strictEqual(isValid, false);
      assert.strictEqual(mockGit.getCallCount('worktreeList'), 0);
    });

    it('should return false when worktree exists but is not registered', async () => {
      mockGit.worktreeListResult = [
        {
          path: '/worktree/other',
          branch: 'other-branch',
          commit: 'abc123',
          isMain: false,
          isLocked: false,
        },
      ];

      const isValid = await manager.isWorktreeValid('/repo', '/worktree/feature');
      assert.strictEqual(isValid, false);
    });

    it('should return false on error', async () => {
      mockGit.shouldThrow = new Error('Git error');

      const isValid = await manager.isWorktreeValid('/repo', '/worktree/feature');
      assert.strictEqual(isValid, false);
    });
  });

  describe('cleanupWorktree', () => {
    it('should remove worktree and cleanup metadata', async () => {
      mockGit.worktreeListResult = [
        {
          path: '/worktree/feature',
          branch: 'feature-branch',
          commit: 'abc123',
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree('/worktree/feature', '/repo');

      assert.strictEqual(mockGit.getCallCount('worktreeRemove'), 1);
      assert.strictEqual(mockGit.getCallCount('worktreePrune'), 1);
    });

    it('should delete branch when autoDeleteBranches is true', async () => {
      config.autoDeleteBranches = true;

      mockGit.worktreeListResult = [
        {
          path: '/worktree/feature',
          branch: 'feature-branch',
          commit: 'abc123',
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree('/worktree/feature', '/repo');

      assert.strictEqual(mockGit.getCallCount('deleteBranch'), 1);
      const call = mockGit.getCall('deleteBranch', 0);
      assert.strictEqual(call[1], 'feature-branch');
      assert.strictEqual(call[2], true); // force delete
    });

    it('should not delete branch when autoDeleteBranches is false', async () => {
      config.autoDeleteBranches = false;

      mockGit.worktreeListResult = [
        {
          path: '/worktree/feature',
          branch: 'feature-branch',
          commit: 'abc123',
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree('/worktree/feature', '/repo');

      assert.strictEqual(mockGit.getCallCount('deleteBranch'), 0);
    });

    it('should not delete detached HEAD', async () => {
      config.autoDeleteBranches = true;

      mockGit.worktreeListResult = [
        {
          path: '/worktree/feature',
          branch: '(detached)',
          commit: 'abc123',
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree('/worktree/feature', '/repo');

      assert.strictEqual(mockGit.getCallCount('deleteBranch'), 0);
    });
  });

  describe('listWorktrees', () => {
    it('should delegate to git CLI', async () => {
      const worktrees: WorktreeInfo[] = [
        {
          path: '/repo',
          branch: 'main',
          commit: 'abc123',
          isMain: true,
          isLocked: false,
        },
        {
          path: '/worktree/feature',
          branch: 'feature-branch',
          commit: 'def456',
          isMain: false,
          isLocked: false,
        },
      ];

      mockGit.worktreeListResult = worktrees;

      const result = await manager.listWorktrees('/repo');

      assert.strictEqual(mockGit.getCallCount('worktreeList'), 1);
      assert.deepStrictEqual(result, worktrees);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const returnedConfig = manager.getConfig();

      assert.deepStrictEqual(returnedConfig, config);
      assert.notStrictEqual(returnedConfig, config);
    });
  });
});
