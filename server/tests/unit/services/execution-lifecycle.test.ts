/**
 * Tests for ExecutionLifecycleService
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
} from "@sudocode-ai/types/schema";
import {
  ExecutionLifecycleService,
  sanitizeForBranchName,
} from "../../../src/services/execution-lifecycle.js";
import {
  getExecution,
  updateExecution,
} from "../../../src/services/executions.js";
import { generateIssueId } from "@sudocode-ai/cli/dist/id-generator.js";
import { createIssue } from "@sudocode-ai/cli/dist/operations/index.js";
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

  beforeAll(() => {
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
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, testDir);
    const issue = createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test Issue for Lifecycle",
      content: "This is a test issue",
    });
    testIssueId = issue.id;
    testIssueTitle = issue.title;
  });

  afterAll(() => {
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
      expect(result.execution).toBeTruthy();
      expect(result.execution.issue_id).toBe(testIssueId);
      expect(result.execution.agent_type).toBe("claude-code");
      expect(result.execution.target_branch).toBe("main");
      expect(result.execution.status).toBe("running");

      // Verify branch name format
      expect(result.branchName.startsWith("sudocode/")).toBeTruthy();
      expect(
        result.branchName.includes("test-issue-for-lifecycle")
      ).toBeTruthy();

      // Verify worktree path format
      expect(result.worktreePath.includes(".sudocode/worktrees")).toBeTruthy();

      // Verify worktree manager was called
      expect(mockWorktreeManager.createWorktreeCalls.length).toBe(1);
      const createCall = mockWorktreeManager.createWorktreeCalls[0];
      expect(createCall.repoPath).toBe(testDir);
      expect(createCall.baseBranch).toBe("main");
      expect(createCall.createBranch).toBe(true);

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });

    it("should capture before_commit when creating execution", async () => {
      // Create a real git repo for this test
      const gitTestDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-test-git-")
      );

      try {
        // Initialize git repo
        const { execSync } = await import("child_process");
        execSync("git init -b main", { cwd: gitTestDir });
        execSync('git config user.email "test@example.com"', {
          cwd: gitTestDir,
        });
        execSync('git config user.name "Test User"', { cwd: gitTestDir });

        // Create initial commit
        fs.writeFileSync(path.join(gitTestDir, "README.md"), "# Test\n");
        execSync("git add .", { cwd: gitTestDir });
        execSync('git commit -m "Initial commit"', { cwd: gitTestDir });

        // Get the current commit SHA
        const expectedCommit = execSync("git rev-parse HEAD", {
          cwd: gitTestDir,
          encoding: "utf-8",
        }).trim();

        // Create mock worktree manager
        const mockWorktreeManager = createMockWorktreeManager();

        const service = new ExecutionLifecycleService(
          db,
          gitTestDir,
          mockWorktreeManager
        );

        const result = await service.createExecutionWithWorktree({
          issueId: testIssueId,
          issueTitle: testIssueTitle,
          agentType: "claude-code",
          targetBranch: "main",
          repoPath: gitTestDir,
        });

        // Verify before_commit was captured
        expect(result.execution.before_commit).toBe(expectedCommit);
        expect(result.execution.before_commit).toMatch(/^[0-9a-f]{40}$/);

        // Cleanup: Mark execution as completed
        updateExecution(db, result.execution.id, {
          status: "completed",
        });
      } finally {
        // Clean up git test directory
        if (fs.existsSync(gitTestDir)) {
          fs.rmSync(gitTestDir, { recursive: true, force: true });
        }
      }
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
        expect.fail("Should have thrown error");
      } catch (error) {
        // Expected error
      }

      // Verify worktree cleanup was called
      expect(mockWorktreeManager.cleanupWorktreeCalls.length).toBe(1);
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
      expect(
        result.branchName.includes("fix-bug-auth-login-issues")
      ).toBeTruthy();
      expect(!result.branchName.includes(":")).toBeTruthy();
      expect(!result.branchName.includes("!")).toBeTruthy();

      // Check that the title portion (after last slash) is sanitized
      const titlePortion = result.branchName.split("/").pop();
      expect(titlePortion).toBeTruthy();
      expect(!titlePortion?.includes(":")).toBeTruthy();
      expect(!titlePortion?.includes("!")).toBeTruthy();

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });

    it("should create target branch when createTargetBranch is true", async () => {
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
        targetBranch: "new-feature-branch",
        repoPath: testDir,
        createTargetBranch: true,
      });

      // Verify execution was created
      expect(result.execution).toBeTruthy();
      expect(result.execution.target_branch).toBe("new-feature-branch");

      // Verify createBranch was called
      expect(mockWorktreeManager.createBranchCalls.length).toBe(1);
      expect(mockWorktreeManager.createBranchCalls[0].branchName).toBe(
        "new-feature-branch"
      );
      expect(mockWorktreeManager.createBranchCalls[0].baseBranch).toBe("main"); // current branch

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });

    it("should not create target branch when createTargetBranch is false", async () => {
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
        createTargetBranch: false,
      });

      // Verify createBranch was NOT called
      expect(mockWorktreeManager.createBranchCalls.length).toBe(0);

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });

    it("should throw error for non-existent branch when createTargetBranch is false", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      await expect(
        service.createExecutionWithWorktree({
          issueId: testIssueId,
          issueTitle: testIssueTitle,
          agentType: "claude-code",
          targetBranch: "non-existent-branch",
          repoPath: testDir,
          createTargetBranch: false,
        })
      ).rejects.toThrow("Target branch does not exist: non-existent-branch");
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
      expect(mockWorktreeManager.cleanupWorktreeCalls.length).toBe(1);
      expect(mockWorktreeManager.cleanupWorktreeCalls[0].worktreePath).toBe(
        result.worktreePath
      );

      // Verify execution worktree_path is still set (for follow-up executions)
      const execution = getExecution(db, result.execution.id);
      expect(execution?.worktree_path).toBe(result.worktreePath);

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
      expect(mockWorktreeManager.cleanupWorktreeCalls.length).toBe(0);
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
      expect(mockWorktreeManager.cleanupWorktreeCalls.length).toBe(0);

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
      expect(mockWorktreeManager.cleanupWorktreeCalls.length).toBe(1);
      expect(
        mockWorktreeManager.cleanupWorktreeCalls[0].worktreePath.includes(
          "orphaned-exec-id"
        )
      ).toBeTruthy();
    });

    it("should preserve worktrees for completed executions", async () => {
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

      // Verify cleanup was NOT called (execution record still exists)
      expect(mockWorktreeManager.cleanupWorktreeCalls.length).toBe(0);
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
      expect(mockWorktreeManager.cleanupWorktreeCalls.length).toBe(0);

      // Cleanup: Mark execution as completed to allow subsequent tests
      updateExecution(db, result.execution.id, {
        status: "completed",
      });
    });
  });

  describe("createWorkflowWorktree", () => {
    it("should create workflow worktree with proper branch naming", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      const result = await service.createWorkflowWorktree({
        workflowId: "wf-12345678",
        workflowTitle: "My Test Workflow",
        baseBranch: "main",
        repoPath: testDir,
      });

      // Verify branch name format: sudocode/workflow/{id-without-wf-prefix}/{sanitized-title}
      expect(result.branchName.startsWith("sudocode/workflow/")).toBeTruthy();
      // The wf- prefix is stripped, so it should be 12345678 not wf-12345678
      expect(result.branchName.includes("12345678")).toBeTruthy();
      expect(result.branchName.includes("my-test-workflow")).toBeTruthy();

      // Verify worktree path format
      expect(result.worktreePath.includes(".sudocode/worktrees")).toBeTruthy();
      expect(result.worktreePath.includes("workflow-wf-12345678")).toBeTruthy();

      // Verify worktree manager was called
      expect(mockWorktreeManager.createWorktreeCalls.length).toBe(1);
      const createCall = mockWorktreeManager.createWorktreeCalls[0];
      expect(createCall.baseBranch).toBe("main");
      expect(createCall.createBranch).toBe(true);
    });

    it("should reuse existing worktree path when provided", async () => {
      // This test requires a real git worktree since the implementation
      // validates the worktree and uses git commands to get the branch name.
      // For unit tests, we'll create a minimal mock that shows the behavior.

      // Create a real git repo for this test
      const gitTestDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-test-reuse-")
      );

      try {
        // Initialize git repo
        const { execSync } = await import("child_process");
        execSync("git init -b main", { cwd: gitTestDir });
        execSync('git config user.email "test@example.com"', { cwd: gitTestDir });
        execSync('git config user.name "Test User"', { cwd: gitTestDir });
        fs.writeFileSync(path.join(gitTestDir, "README.md"), "# Test\n");
        execSync("git add .", { cwd: gitTestDir });
        execSync('git commit -m "Initial commit"', { cwd: gitTestDir });
        execSync("git checkout -b existing-branch", { cwd: gitTestDir });

        const mockWorktreeManager = createMockWorktreeManager();

        const service = new ExecutionLifecycleService(
          db,
          testDir,
          mockWorktreeManager
        );

        const result = await service.createWorkflowWorktree({
          workflowId: "wf-12345678",
          workflowTitle: "My Test Workflow",
          baseBranch: "main",
          repoPath: testDir,
          reuseWorktreePath: gitTestDir,
        });

        // Should return existing path and branch
        expect(result.worktreePath).toBe(gitTestDir);
        expect(result.branchName).toBe("existing-branch");

        // Should NOT create new worktree
        expect(mockWorktreeManager.createWorktreeCalls.length).toBe(0);
      } finally {
        // Cleanup
        fs.rmSync(gitTestDir, { recursive: true, force: true });
      }
    });

    it("should throw error when reuseWorktreePath does not exist", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      await expect(
        service.createWorkflowWorktree({
          workflowId: "wf-12345678",
          workflowTitle: "My Test Workflow",
          baseBranch: "main",
          repoPath: testDir,
          reuseWorktreePath: "/non/existent/path",
        })
      ).rejects.toThrow("Cannot reuse worktree: path does not exist");
    });

    it("should handle branch name collision with suffix", async () => {
      // Branch format is: {prefix}/workflow/{workflowId without 'wf-' prefix, first 8 chars}/{sanitized-title}
      // For workflowId "wf-12345678", it becomes "sudocode/workflow/12345678/my-test-workflow"
      const mockWorktreeManager = createMockWorktreeManager({
        branches: ["main", "sudocode/workflow/12345678/my-test-workflow"],
      });

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      const result = await service.createWorkflowWorktree({
        workflowId: "wf-12345678",
        workflowTitle: "My Test Workflow",
        baseBranch: "main",
        repoPath: testDir,
      });

      // Should have collision suffix (-2) since base branch exists
      // Collision detection starts at suffix=1 and checks if branch exists before incrementing
      expect(result.branchName.endsWith("-2")).toBeTruthy();
    });

    it("should throw error for invalid repo path", async () => {
      const mockWorktreeManager = createMockWorktreeManager();
      // Override isValidRepo to return false
      mockWorktreeManager.isValidRepo = async () => false;

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      await expect(
        service.createWorkflowWorktree({
          workflowId: "wf-12345678",
          workflowTitle: "My Test Workflow",
          baseBranch: "main",
          repoPath: "/invalid/repo",
        })
      ).rejects.toThrow("Not a git repository");
    });

    it("should sanitize workflow title in branch name", async () => {
      const mockWorktreeManager = createMockWorktreeManager();

      const service = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );

      const result = await service.createWorkflowWorktree({
        workflowId: "wf-abc123",
        workflowTitle: "Fix: Bug / Auth Issues!",
        baseBranch: "main",
        repoPath: testDir,
      });

      // Branch should be sanitized - extract the title portion after the last slash
      const titlePortion = result.branchName.split("/").pop();
      expect(titlePortion?.includes("fix-bug-auth-issues")).toBeTruthy();
      expect(!titlePortion?.includes(":")).toBeTruthy();
      expect(!titlePortion?.includes("!")).toBeTruthy();
    });
  });

  describe("sanitizeForBranchName", () => {
    it("should convert to lowercase", () => {
      expect(sanitizeForBranchName("UPPERCASE Text")).toBe("uppercase-text");
    });

    it("should replace spaces with hyphens", () => {
      expect(sanitizeForBranchName("fix auth bug")).toBe("fix-auth-bug");
    });

    it("should replace slashes with hyphens", () => {
      expect(sanitizeForBranchName("feature/auth/login")).toBe(
        "feature-auth-login"
      );
    });

    it("should remove special characters", () => {
      expect(sanitizeForBranchName("fix: bug! @#$%")).toBe("fix-bug");
    });

    it("should remove consecutive hyphens", () => {
      expect(sanitizeForBranchName("fix   bug---here")).toBe("fix-bug-here");
    });

    it("should remove leading/trailing hyphens", () => {
      expect(sanitizeForBranchName("  -fix bug-  ")).toBe("fix-bug");
    });

    it("should limit length to 50 characters", () => {
      const longString = "a".repeat(100);
      const result = sanitizeForBranchName(longString);
      expect(result.length).toBe(50);
    });

    it("should handle empty string", () => {
      expect(sanitizeForBranchName("")).toBe("");
    });

    it("should handle string with only special characters", () => {
      expect(sanitizeForBranchName("@#$%^&*()")).toBe("");
    });
  });
});

/**
 * Create a mock worktree manager for testing
 */
function createMockWorktreeManager(options?: {
  worktrees?: WorktreeInfo[];
  currentBranch?: string;
  branches?: string[];
}): IWorktreeManager & {
  createWorktreeCalls: WorktreeCreateParams[];
  cleanupWorktreeCalls: { worktreePath: string; repoPath?: string }[];
  createBranchCalls: { branchName: string; baseBranch: string }[];
  worktrees: WorktreeInfo[];
  branches: string[];
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
    createBranchCalls: [] as { branchName: string; baseBranch: string }[],
    worktrees: options?.worktrees || ([] as WorktreeInfo[]),
    branches: options?.branches || ["main", "develop", "feature/test"],
    currentBranch: options?.currentBranch || "main",

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
      return [...mock.branches];
    },

    async getCurrentBranch(): Promise<string> {
      return mock.currentBranch;
    },

    async createBranch(
      _repoPath: string,
      branchName: string,
      baseBranch: string
    ): Promise<void> {
      mock.createBranchCalls.push({ branchName, baseBranch });
      // Add to branches list
      mock.branches.push(branchName);
    },
  };

  return mock;
}
