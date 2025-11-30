/**
 * Tests for Worktree Manager
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import fs from "fs";

// Mock CLI module imports that setupWorktreeEnvironment uses
// These need to be mocked before importing WorktreeManager
vi.mock("@sudocode-ai/cli/dist/db.js", () => ({
  initDatabase: vi.fn(() => ({
    close: vi.fn(), // Mock the close method that setupWorktreeEnvironment calls
  })),
}));

vi.mock("@sudocode-ai/cli/dist/import.js", () => ({
  importFromJSONL: vi.fn().mockResolvedValue(undefined),
}));

import { WorktreeManager } from "../../../../src/execution/worktree/manager.js";
import type { IGitCli } from "../../../../src/execution/worktree/git-cli.js";
import type {
  WorktreeConfig,
  WorktreeCreateParams,
  WorktreeInfo,
} from "../../../../src/execution/worktree/types.js";

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
    this.calls.push({ method: "worktreeAdd", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async worktreeRemove(
    _repoPath: string,
    _worktreePath: string,
    _force?: boolean
  ): Promise<void> {
    this.calls.push({ method: "worktreeRemove", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async worktreePrune(_repoPath: string): Promise<void> {
    this.calls.push({ method: "worktreePrune", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async worktreeList(_repoPath: string): Promise<WorktreeInfo[]> {
    this.calls.push({ method: "worktreeList", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
    return this.worktreeListResult;
  }

  async createBranch(
    _repoPath: string,
    _branchName: string,
    _baseBranch: string
  ): Promise<void> {
    this.calls.push({ method: "createBranch", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async deleteBranch(
    _repoPath: string,
    _branchName: string,
    _force?: boolean
  ): Promise<void> {
    this.calls.push({ method: "deleteBranch", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async configureSparseCheckout(
    _worktreePath: string,
    _patterns: string[]
  ): Promise<void> {
    this.calls.push({
      method: "configureSparseCheckout",
      args: arguments as any,
    });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async isValidRepo(_repoPath: string): Promise<boolean> {
    this.calls.push({ method: "isValidRepo", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
    return true;
  }

  async listBranches(_repoPath: string): Promise<string[]> {
    this.calls.push({ method: "listBranches", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
    return ["main", "develop", "feature/test"];
  }

  async getCurrentCommit(_repoPath: string): Promise<string> {
    this.calls.push({ method: "getCurrentCommit", args: arguments as any });
    if (this.shouldThrow) throw this.shouldThrow;
    return "abc123def456789";
  }

  getCallCount(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  getCall(method: string, index = 0): any {
    const methodCalls = this.calls.filter((c) => c.method === method);
    return methodCalls[index]?.args;
  }
}

describe("WorktreeManager", () => {
  let manager: WorktreeManager;
  let mockGit: MockGitCli;
  let config: WorktreeConfig;

  beforeEach(() => {
    config = {
      worktreeStoragePath: ".sudocode/worktrees",
      autoCreateBranches: true,
      autoDeleteBranches: false,
      enableSparseCheckout: false,
      sparseCheckoutPatterns: undefined,
      branchPrefix: "sudocode",
      cleanupOrphanedWorktreesOnStartup: true,
    };

    mockGit = new MockGitCli();

    // Mock fs functions for setupWorktreeEnvironment
    vi.spyOn(fs, "existsSync").mockImplementation((path: any) => {
      // Worktree directories exist
      if (path.includes("/worktree")) return true;
      // JSONL files don't exist in worktree initially
      if (path.includes("worktree") && path.includes(".jsonl")) return false;
      // JSONL files exist in main repo
      if (path.includes("/repo/.sudocode") && path.includes(".jsonl"))
        return true;
      // Config exists in main repo
      if (path.includes("/repo/.sudocode/config.json")) return true;
      return true;
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as any);
    vi.spyOn(fs, "rmSync").mockImplementation(() => {});
    vi.spyOn(fs, "realpathSync").mockImplementation((path: any) => path);
    vi.spyOn(fs, "statSync").mockImplementation(() => ({ size: 1000 }) as any);
    vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

    manager = new WorktreeManager(config, mockGit);
  });

  afterEach(() => {
    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("createWorktree", () => {
    it("should create branch if createBranch is true", async () => {
      const params: WorktreeCreateParams = {
        repoPath: "/repo",
        branchName: "feature-branch",
        worktreePath: "/worktree/feature",
        baseBranch: "main",
        createBranch: true,
      };

      await manager.createWorktree(params);

      // Should NOT get current commit when baseBranch is provided
      expect(mockGit.getCallCount("getCurrentCommit")).toBe(0);

      // Should create branch from base branch
      expect(mockGit.getCallCount("createBranch")).toBe(1);
      const branchCall = mockGit.getCall("createBranch", 0);
      expect(branchCall[0]).toBe("/repo");
      expect(branchCall[1]).toBe("feature-branch");
      expect(branchCall[2]).toBe("main"); // Uses baseBranch
    });

    it("should create branch from HEAD when baseBranch is not provided", async () => {
      const params: WorktreeCreateParams = {
        repoPath: "/repo",
        branchName: "feature-branch",
        worktreePath: "/worktree/feature",
        // No baseBranch provided
        createBranch: true,
      };

      await manager.createWorktree(params);

      // Should get current commit when baseBranch is not provided
      expect(mockGit.getCallCount("getCurrentCommit")).toBe(1);
      const commitCall = mockGit.getCall("getCurrentCommit", 0);
      expect(commitCall[0]).toBe("/repo");

      // Should create branch from current commit SHA
      expect(mockGit.getCallCount("createBranch")).toBe(1);
      const branchCall = mockGit.getCall("createBranch", 0);
      expect(branchCall[0]).toBe("/repo");
      expect(branchCall[1]).toBe("feature-branch");
      expect(branchCall[2]).toBe("abc123def456789"); // commit SHA from HEAD
    });

    it("should not create branch if createBranch is false", async () => {
      const params: WorktreeCreateParams = {
        repoPath: "/repo",
        branchName: "existing-branch",
        worktreePath: "/worktree/feature",
        baseBranch: "main",
        createBranch: false,
      };

      await manager.createWorktree(params);

      expect(mockGit.getCallCount("createBranch")).toBe(0);
    });

    it("should call git worktree add", async () => {
      const params: WorktreeCreateParams = {
        repoPath: "/repo",
        branchName: "feature-branch",
        worktreePath: "/worktree/feature",
        baseBranch: "main",
        createBranch: false,
      };

      await manager.createWorktree(params);

      expect(mockGit.getCallCount("worktreeAdd")).toBe(1);
      const call = mockGit.getCall("worktreeAdd", 0);
      expect(call[0]).toBe("/repo");
      expect(call[1]).toBe("/worktree/feature");
      expect(call[2]).toBe("feature-branch");
    });

    it("should configure sparse checkout when enabled", async () => {
      config.enableSparseCheckout = true;
      config.sparseCheckoutPatterns = ["src", "docs"];

      const params: WorktreeCreateParams = {
        repoPath: "/repo",
        branchName: "feature-branch",
        worktreePath: "/worktree/feature",
        baseBranch: "main",
        createBranch: false,
      };

      await manager.createWorktree(params);

      expect(mockGit.getCallCount("configureSparseCheckout")).toBe(1);
      const call = mockGit.getCall("configureSparseCheckout", 0);
      expect(call[0]).toBe("/worktree/feature");
      expect(call[1]).toEqual(["src", "docs"]);
    });

    it("should not configure sparse checkout when disabled", async () => {
      config.enableSparseCheckout = false;

      const params: WorktreeCreateParams = {
        repoPath: "/repo",
        branchName: "feature-branch",
        worktreePath: "/worktree/feature",
        baseBranch: "main",
        createBranch: false,
      };

      await manager.createWorktree(params);

      expect(mockGit.getCallCount("configureSparseCheckout")).toBe(0);
    });

    it("should throw error if worktree path does not exist after creation", async () => {
      let callCount = 0;
      vi.spyOn(fs, "existsSync").mockImplementation(() => {
        callCount++;
        return callCount === 1;
      });

      const params: WorktreeCreateParams = {
        repoPath: "/repo",
        branchName: "feature-branch",
        worktreePath: "/worktree/feature",
        baseBranch: "main",
        createBranch: false,
      };

      await expect(async () => {
        await manager.createWorktree(params);
      }).rejects.toThrow();
    });
  });

  describe("isWorktreeValid", () => {
    it("should return true when worktree exists and is registered", async () => {
      mockGit.worktreeListResult = [
        {
          path: "/worktree/feature",
          branch: "feature-branch",
          commit: "abc123",
          isMain: false,
          isLocked: false,
        },
      ];

      const isValid = await manager.isWorktreeValid(
        "/repo",
        "/worktree/feature"
      );
      expect(isValid).toBe(true);
    });

    it("should return false when worktree path does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const isValid = await manager.isWorktreeValid(
        "/repo",
        "/worktree/feature"
      );
      expect(isValid).toBe(false);
      expect(mockGit.getCallCount("worktreeList")).toBe(0);
    });

    it("should return false when worktree exists but is not registered", async () => {
      mockGit.worktreeListResult = [
        {
          path: "/worktree/other",
          branch: "other-branch",
          commit: "abc123",
          isMain: false,
          isLocked: false,
        },
      ];

      const isValid = await manager.isWorktreeValid(
        "/repo",
        "/worktree/feature"
      );
      expect(isValid).toBe(false);
    });

    it("should return false on error", async () => {
      mockGit.shouldThrow = new Error("Git error");

      const isValid = await manager.isWorktreeValid(
        "/repo",
        "/worktree/feature"
      );
      expect(isValid).toBe(false);
    });
  });

  describe("cleanupWorktree", () => {
    it("should remove worktree and cleanup metadata", async () => {
      mockGit.worktreeListResult = [
        {
          path: "/worktree/feature",
          branch: "feature-branch",
          commit: "abc123",
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree("/worktree/feature", "/repo");

      expect(mockGit.getCallCount("worktreeRemove")).toBe(1);
      expect(mockGit.getCallCount("worktreePrune")).toBe(1);
    });

    it("should delete branch when autoDeleteBranches is true", async () => {
      config.autoDeleteBranches = true;

      mockGit.worktreeListResult = [
        {
          path: "/worktree/feature",
          branch: "feature-branch",
          commit: "abc123",
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree("/worktree/feature", "/repo");

      expect(mockGit.getCallCount("deleteBranch")).toBe(1);
      const call = mockGit.getCall("deleteBranch", 0);
      expect(call[1]).toBe("feature-branch");
      expect(call[2]).toBe(true); // force delete
    });

    it("should not delete branch when autoDeleteBranches is false", async () => {
      config.autoDeleteBranches = false;

      mockGit.worktreeListResult = [
        {
          path: "/worktree/feature",
          branch: "feature-branch",
          commit: "abc123",
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree("/worktree/feature", "/repo");

      expect(mockGit.getCallCount("deleteBranch")).toBe(0);
    });

    it("should not delete detached HEAD", async () => {
      config.autoDeleteBranches = true;

      mockGit.worktreeListResult = [
        {
          path: "/worktree/feature",
          branch: "(detached)",
          commit: "abc123",
          isMain: false,
          isLocked: false,
        },
      ];

      await manager.cleanupWorktree("/worktree/feature", "/repo");

      expect(mockGit.getCallCount("deleteBranch")).toBe(0);
    });
  });

  describe("listWorktrees", () => {
    it("should delegate to git CLI", async () => {
      const worktrees: WorktreeInfo[] = [
        {
          path: "/repo",
          branch: "main",
          commit: "abc123",
          isMain: true,
          isLocked: false,
        },
        {
          path: "/worktree/feature",
          branch: "feature-branch",
          commit: "def456",
          isMain: false,
          isLocked: false,
        },
      ];

      mockGit.worktreeListResult = worktrees;

      const result = await manager.listWorktrees("/repo");

      expect(mockGit.getCallCount("worktreeList")).toBe(1);
      expect(result).toEqual(worktrees);
    });
  });

  describe("getConfig", () => {
    it("should return a copy of the config", () => {
      const returnedConfig = manager.getConfig();

      expect(returnedConfig).toEqual(config);
      expect(returnedConfig).not.toBe(config);
    });
  });
});
