/**
 * Tests for ExecutionLifecycleService
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode/cli/dist/db.js";
import { EXECUTIONS_TABLE, EXECUTIONS_INDEXES } from "@sudocode/types/schema";
import {
  ExecutionLifecycleService,
  sanitizeForBranchName,
} from "../../../src/services/execution-lifecycle.js";
import {
  getExecution,
  updateExecution,
} from "../../../src/services/executions.js";
import { generateIssueId } from "@sudocode/cli/dist/id-generator.js";
import { createIssue } from "@sudocode/cli/dist/operations/index.js";
import type { IWorktreeManager } from "../../../src/execution/worktree/manager.js";
import type {
  WorktreeConfig,
  WorktreeCreateParams,
  WorktreeInfo,
} from "../../../src/execution/worktree/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ExecutionLifecycleService", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testIssueTitle: string;

  before(() => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-test-lifecycle-")
    );
    testDbPath = path.join(testDir, "cache.db");

    // Set SUDOCODE_DIR environment variable
    process.env.SUDOCODE_DIR = testDir;

    // Create config.json for ID generation
    const configPath = path.join(testDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Initialize test database (with both CLI and server tables)
    db = initCliDatabase({ path: testDbPath });
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTIONS_INDEXES);

    // Create a test issue to use in execution tests
    const issueId = generateIssueId(db, testDir);
    const issue = createIssue(db, {
      id: issueId,
      title: "Test Issue for Lifecycle",
      content: "This is a test issue",
    });
    testIssueId = issue.id;
    testIssueTitle = issue.title;
  });

  after(() => {
    // Clean up database
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  describe("createExecutionWithWorktree", () => {
    it("should create execution with worktree", async () => {
      // Create mock worktree manager
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      const result = await service.createExecutionWithWorktree({
        issueId: testIssueId,
        issueTitle: testIssueTitle,
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
      });

      // Verify execution was created
      assert.ok(result.execution);
      assert.strictEqual(result.execution.issue_id, testIssueId);
      assert.strictEqual(result.execution.agent_type, "claude-code");
      assert.strictEqual(result.execution.target_branch, "main");
      assert.strictEqual(result.execution.status, "running");

      // Verify branch name format
      assert.ok(result.branchName.startsWith("sudocode/"));
      assert.ok(result.branchName.includes("test-issue-for-lifecycle"));

      // Verify worktree path format
      assert.ok(result.worktreePath.includes(".sudocode/worktrees"));

      // Verify worktree manager was called
      assert.strictEqual(mockWorktreeManager.createWorktreeCalls.length, 1);
      const createCall = mockWorktreeManager.createWorktreeCalls[0];
      assert.strictEqual(createCall.repoPath, testDir);
      assert.strictEqual(createCall.baseBranch, "main");
      assert.strictEqual(createCall.createBranch, true);

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });

    it("should cleanup worktree if execution creation fails", async () => {
      // Create mock that succeeds worktree creation
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      // Mock execution creation failure by using invalid issue ID
      try {
        await service.createExecutionWithWorktree({
          issueId: "invalid-issue-id",
          issueTitle: "Test",
          agentType: "claude-code",
          targetBranch: "main",
          repoPath: testDir,
        });
        assert.fail("Should have thrown error");
      } catch (error) {
        // Expected error
      }

      // Verify worktree cleanup was called
      assert.strictEqual(mockWorktreeManager.cleanupWorktreeCalls.length, 1);
    });

    it("should generate sanitized branch names", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      const result = await service.createExecutionWithWorktree({
        issueId: testIssueId,
        issueTitle: "Fix Bug: Auth / Login Issues!",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
      });

      // Branch name should be sanitized
      assert.ok(result.branchName.includes("fix-bug-auth-login-issues"));
      assert.ok(!result.branchName.includes(":"));
      assert.ok(!result.branchName.includes("!"));

      // Check that the title portion (after last slash) is sanitized
      const titlePortion = result.branchName.split("/").pop();
      assert.ok(titlePortion);
      assert.ok(
        !titlePortion.includes(":"),
        "sanitized portion should not contain colon"
      );
      assert.ok(
        !titlePortion.includes("!"),
        "sanitized portion should not contain exclamation"
      );

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });
  });

  describe("cleanupExecution", () => {
    it("should cleanup execution worktree", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      // Create execution with worktree
      const result = await service.createExecutionWithWorktree({
        issueId: testIssueId,
        issueTitle: testIssueTitle,
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
      });

      // Cleanup execution
      await service.cleanupExecution(result.execution.id);

      // Verify worktree cleanup was called
      assert.strictEqual(mockWorktreeManager.cleanupWorktreeCalls.length, 1);
      assert.strictEqual(
        mockWorktreeManager.cleanupWorktreeCalls[0].worktreePath,
        result.worktreePath
      );

      // Verify execution worktree_path was cleared
      const execution = getExecution(db, result.execution.id);
      assert.strictEqual(execution?.worktree_path, null);

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });

    it("should handle non-existent execution gracefully", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      // Should not throw for non-existent execution
      await service.cleanupExecution("non-existent-id");

      // Verify worktree cleanup was not called
      assert.strictEqual(mockWorktreeManager.cleanupWorktreeCalls.length, 0);
    });

    it("should handle execution without worktree", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      // Create execution with worktree
      const result = await service.createExecutionWithWorktree({
        issueId: testIssueId,
        issueTitle: testIssueTitle,
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
      });

      // Manually clear worktree_path
      updateExecution(db, result.execution.id, {
        worktree_path: null,
      });

      // Cleanup should succeed without calling worktree manager
      await service.cleanupExecution(result.execution.id);

      // Verify worktree cleanup was not called
      assert.strictEqual(mockWorktreeManager.cleanupWorktreeCalls.length, 0);

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });
  });

  describe("cleanupOrphanedWorktrees", () => {
    it("should cleanup worktrees without execution records", async () => {
      const mockWorktreeManager = createMockWorktreeManager({
        worktrees: [
          {
            path: path.join(testDir, ".sudocode/worktrees/orphaned-exec-id"),
            branch: "sudocode/test-branch",
            commit: "abc123",
            isMain: false,
            isLocked: false,
          },
        ],
      });

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      await service.cleanupOrphanedWorktrees();

      // Verify cleanup was called for orphaned worktree
      assert.strictEqual(mockWorktreeManager.cleanupWorktreeCalls.length, 1);
      assert.ok(
        mockWorktreeManager.cleanupWorktreeCalls[0].worktreePath.includes(
          "orphaned-exec-id"
        )
      );
    });

    it("should cleanup worktrees for completed executions", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      // Create execution with worktree
      const result = await service.createExecutionWithWorktree({
        issueId: testIssueId,
        issueTitle: testIssueTitle,
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
      });

      // Mark execution as completed
      updateExecution(db, result.execution.id, {
        status: "completed",
      });

      // Add worktree to mock list
      mockWorktreeManager.worktrees.push({
        path: result.worktreePath,
        branch: result.branchName,
        commit: "abc123",
        isMain: false,
        isLocked: false,
      });

      // Reset call counts
      mockWorktreeManager.cleanupWorktreeCalls = [];

      await service.cleanupOrphanedWorktrees();

      // Verify cleanup was called
      assert.strictEqual(mockWorktreeManager.cleanupWorktreeCalls.length, 1);
      assert.strictEqual(
        mockWorktreeManager.cleanupWorktreeCalls[0].worktreePath,
        result.worktreePath
      );
    });

    it("should not cleanup worktrees for running executions", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      // Create execution with worktree (status=running)
      const result = await service.createExecutionWithWorktree({
        issueId: testIssueId,
        issueTitle: testIssueTitle,
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
      });

      // Add worktree to mock list
      mockWorktreeManager.worktrees.push({
        path: result.worktreePath,
        branch: result.branchName,
        commit: "abc123",
        isMain: false,
        isLocked: false,
      });

      // Reset call counts
      mockWorktreeManager.cleanupWorktreeCalls = [];

      await service.cleanupOrphanedWorktrees();

      // Verify cleanup was NOT called (execution still running)
      assert.strictEqual(mockWorktreeManager.cleanupWorktreeCalls.length, 0);

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });
  });

  describe("sanitizeForBranchName", () => {
    it("should convert to lowercase", () => {
      assert.strictEqual(
        sanitizeForBranchName("UPPERCASE Text"),
        "uppercase-text"
      );
    });

    it("should replace spaces with hyphens", () => {
      assert.strictEqual(sanitizeForBranchName("fix auth bug"), "fix-auth-bug");
    });

    it("should replace slashes with hyphens", () => {
      assert.strictEqual(
        sanitizeForBranchName("feature/auth/login"),
        "feature-auth-login"
      );
    });

    it("should remove special characters", () => {
      assert.strictEqual(sanitizeForBranchName("fix: bug! @#$%"), "fix-bug");
    });

    it("should remove consecutive hyphens", () => {
      assert.strictEqual(
        sanitizeForBranchName("fix   bug---here"),
        "fix-bug-here"
      );
    });

    it("should remove leading/trailing hyphens", () => {
      assert.strictEqual(sanitizeForBranchName("  -fix bug-  "), "fix-bug");
    });

    it("should limit length to 50 characters", () => {
      const longString = "a".repeat(100);
      const result = sanitizeForBranchName(longString);
      assert.strictEqual(result.length, 50);
    });

    it("should handle empty string", () => {
      assert.strictEqual(sanitizeForBranchName(""), "");
    });

    it("should handle string with only special characters", () => {
      assert.strictEqual(sanitizeForBranchName("@#$%^&*()"), "");
    });
  });
});

/**
 * Create a mock worktree manager for testing
 */
function createMockWorktreeManager(options?: {
  worktrees?: WorktreeInfo[];
}): IWorktreeManager & {
  createWorktreeCalls: WorktreeCreateParams[];
  cleanupWorktreeCalls: { worktreePath: string; repoPath?: string }[];
  worktrees: WorktreeInfo[];
} {
  const mockConfig: WorktreeConfig = {
    worktreeStoragePath: ".sudocode/worktrees",
    autoCreateBranches: true,
    autoDeleteBranches: false,
    enableSparseCheckout: false,
    sparseCheckoutPatterns: undefined,
    branchPrefix: "sudocode",
    cleanupOrphanedWorktreesOnStartup: true,
  };

  const mock = {
    createWorktreeCalls: [] as WorktreeCreateParams[],
    cleanupWorktreeCalls: [] as { worktreePath: string; repoPath?: string }[],
    worktrees: options?.worktrees || ([] as WorktreeInfo[]),

    async createWorktree(params: WorktreeCreateParams): Promise<void> {
      mock.createWorktreeCalls.push(params);
      // Simulate successful creation
    },

    async ensureWorktreeExists(): Promise<void> {
      // No-op for tests
    },

    async cleanupWorktree(
      worktreePath: string,
      repoPath?: string
    ): Promise<void> {
      mock.cleanupWorktreeCalls.push({ worktreePath, repoPath });
      // Remove from worktrees list if present
      const index = mock.worktrees.findIndex((w) => w.path === worktreePath);
      if (index !== -1) {
        mock.worktrees.splice(index, 1);
      }
    },

    async isWorktreeValid(): Promise<boolean> {
      return true;
    },

    async listWorktrees(): Promise<WorktreeInfo[]> {
      return [...mock.worktrees];
    },

    getConfig(): WorktreeConfig {
      return { ...mockConfig };
    },

    async isValidRepo(): Promise<boolean> {
      return true;
    },

    async listBranches(): Promise<string[]> {
      return ["main", "develop", "feature/test"];
    },
  };

  return mock;
}
