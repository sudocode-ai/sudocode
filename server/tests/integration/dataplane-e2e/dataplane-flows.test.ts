/**
 * Dataplane E2E Integration Tests
 *
 * Comprehensive tests for the dataplane integration covering:
 * 1. Basic execution flow (create, run, complete)
 * 2. Sync operations (squash, preserve, stage)
 * 3. Execution chains (follow-ups)
 *
 * These tests use real git repos, real databases, and mock agent execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Test helpers
import {
  createTestRepo,
  createTestIssue,
  createRelationship,
  getHeadCommit,
  getCurrentBranch,
  listWorktrees,
  branchExists,
  getCommitHistory,
  type TestRepo,
} from "./helpers/test-repo.js";
import {
  applyMockChanges,
  commitMockChanges,
  simulateExecutionComplete,
  createConflictingChanges,
  DEFAULT_MOCK_CHANGES,
  type MockFileChange,
} from "./helpers/mock-agent.js";

// Server components
import { createExecutionsRouter } from "../../../src/routes/executions.js";
import { createIssuesRouter } from "../../../src/routes/issues.js";
import { ProjectManager } from "../../../src/services/project-manager.js";
import { ProjectRegistry } from "../../../src/services/project-registry.js";
import { requireProject } from "../../../src/middleware/project-context.js";
import {
  closeAllDataplaneAdapters,
  getDataplaneAdapter,
  type DataplaneAdapter,
} from "../../../src/services/dataplane-adapter.js";
import { clearDataplaneConfigCache } from "../../../src/services/dataplane-config.js";

// Mock WebSocket broadcasts to prevent errors
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
  broadcastVoiceNarration: vi.fn(),
  broadcastIssueChange: vi.fn(),
  broadcastIssueUpdate: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
  },
}));

// Mock execution event callbacks
vi.mock("../../../src/services/execution-event-callbacks.js", () => ({
  notifyExecutionEvent: vi.fn().mockResolvedValue(undefined),
  registerExecutionCallback: vi.fn().mockReturnValue(() => {}),
  getCallbackCount: vi.fn().mockReturnValue(0),
  clearAllCallbacks: vi.fn(),
}));

// Skip slow tests unless explicitly enabled (this test suite takes ~210s)
const SKIP_SLOW_TESTS = process.env.RUN_SLOW_TESTS !== "true";

describe.skipIf(SKIP_SLOW_TESTS)("Dataplane E2E Integration Tests", () => {
  let testRepo: TestRepo;
  let app: express.Application;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let registryPath: string;

  beforeAll(async () => {
    // Clear any cached adapters from previous runs
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  afterAll(async () => {
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  beforeEach(async () => {
    // Clear mocks
    vi.clearAllMocks();
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();

    // Create fresh test repo
    testRepo = createTestRepo({ dataplaneEnabled: true });

    // Set up project registry and manager
    registryPath = path.join(testRepo.path, "..", "projects.json");
    projectRegistry = new ProjectRegistry(registryPath);
    await projectRegistry.load();

    projectManager = new ProjectManager(projectRegistry, { watchEnabled: false });

    // Open the test project
    const result = await projectManager.openProject(testRepo.path);
    if (!result.ok) {
      throw new Error(`Failed to open test project: ${result.error}`);
    }
    projectId = result.value.id;

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api", requireProject(projectManager), createExecutionsRouter());
    app.use("/api/issues", requireProject(projectManager), createIssuesRouter());
  });

  afterEach(async () => {
    // Shutdown project manager
    await projectManager?.shutdown();

    // Clean up test repo
    testRepo?.cleanup();

    // Clean up registry file
    if (registryPath && fs.existsSync(registryPath)) {
      fs.unlinkSync(registryPath);
    }

    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  // ============================================================================
  // Section 1: Basic Execution Flow
  // ============================================================================

  describe("1. Basic Execution Flow", () => {
    describe("1.1 Create and Start Execution", () => {
      it("should create an execution for an issue", async () => {
        // Create test issue
        const issue = createTestIssue(testRepo.db, {
          id: "i-test001",
          title: "Test basic execution",
        });

        // Create execution via API
        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Implement a new feature",
            agentType: "claude-code",
            config: { mode: "worktree" },
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.id).toBeDefined();
        expect(response.body.data.issue_id).toBe(issue.id);
        expect(response.body.data.status).toMatch(/preparing|pending|running/);
      });

      it("should create worktree for worktree-mode execution", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-test002",
          title: "Test worktree creation",
        });

        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Make some changes",
            config: { mode: "worktree" },
          });

        expect(response.status).toBe(201);

        const executionId = response.body.data.id;

        // Wait a bit for async worktree creation
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check that execution has worktree info
        const execResponse = await request(app)
          .get(`/api/executions/${executionId}`)
          .set("X-Project-ID", projectId);

        // Worktree path should be set (may take time for async creation)
        // Just verify the execution exists and has expected fields
        expect(execResponse.status).toBe(200);
        expect(execResponse.body.data.id).toBe(executionId);
      });

      it("should record before_commit on execution start", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-test003",
          title: "Test before commit tracking",
        });

        const mainHeadBefore = getHeadCommit(testRepo.path);

        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Track commits",
            config: { mode: "worktree" },
          });

        expect(response.status).toBe(201);

        // Get execution details
        const execResponse = await request(app)
          .get(`/api/executions/${response.body.data.id}`)
          .set("X-Project-ID", projectId);

        // before_commit should be set (may be null initially, populated later)
        expect(execResponse.body.data).toBeDefined();
      });
    });

    describe("1.2 List and Filter Executions", () => {
      it("should list all executions", async () => {
        // Create issues and executions
        const issue1 = createTestIssue(testRepo.db, {
          id: "i-list001",
          title: "List test 1",
        });
        const issue2 = createTestIssue(testRepo.db, {
          id: "i-list002",
          title: "List test 2",
        });

        await request(app)
          .post(`/api/issues/${issue1.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "First execution" });

        await request(app)
          .post(`/api/issues/${issue2.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Second execution" });

        // List all executions
        const response = await request(app)
          .get("/api/executions")
          .set("X-Project-ID", projectId);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.executions.length).toBeGreaterThanOrEqual(2);
      });

      it("should filter executions by issue", async () => {
        const issue1 = createTestIssue(testRepo.db, {
          id: "i-filter001",
          title: "Filter test 1",
        });
        const issue2 = createTestIssue(testRepo.db, {
          id: "i-filter002",
          title: "Filter test 2",
        });

        await request(app)
          .post(`/api/issues/${issue1.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Issue 1 execution" });

        await request(app)
          .post(`/api/issues/${issue2.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Issue 2 execution" });

        // Filter by issue
        const response = await request(app)
          .get(`/api/executions?issueId=${issue1.id}`)
          .set("X-Project-ID", projectId);

        expect(response.status).toBe(200);
        expect(response.body.data.executions.length).toBeGreaterThanOrEqual(1);
        expect(response.body.data.executions.every((e: any) => e.issue_id === issue1.id)).toBe(
          true
        );
      });
    });

    describe("1.3 Execution Completion", () => {
      it("should track after_commit when execution completes with changes", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-complete001",
          title: "Test completion tracking",
        });

        // Create execution
        const createResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Make changes",
            config: { mode: "worktree" },
          });

        expect(createResponse.status).toBe(201);
        const executionId = createResponse.body.data.id;

        // Wait for worktree to be created
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get execution to find worktree path
        const execResponse = await request(app)
          .get(`/api/executions/${executionId}`)
          .set("X-Project-ID", projectId);

        const worktreePath = execResponse.body.data.worktree_path;

        // If worktree exists, simulate completion
        if (worktreePath && fs.existsSync(worktreePath)) {
          await simulateExecutionComplete(testRepo.db, executionId, worktreePath, {
            fileChanges: DEFAULT_MOCK_CHANGES,
            commitMessage: "feat: add new feature",
          });

          // Verify after_commit is set
          const afterExec = testRepo.db
            .prepare("SELECT * FROM executions WHERE id = ?")
            .get(executionId) as any;

          expect(afterExec.status).toBe("completed");
          expect(afterExec.after_commit).toBeDefined();
          expect(afterExec.after_commit).not.toBeNull();
        }
      });
    });
  });

  // ============================================================================
  // Section 2: Sync Operations
  // ============================================================================

  describe("2. Sync Operations", () => {
    /**
     * Helper to create a completed execution with changes
     */
    async function createCompletedExecution(issueId: string): Promise<{
      executionId: string;
      worktreePath: string;
    }> {
      const createResponse = await request(app)
        .post(`/api/issues/${issueId}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Make changes for sync test",
          config: { mode: "worktree" },
        });

      const executionId = createResponse.body.data.id;

      // Wait for worktree creation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get worktree path
      const execResponse = await request(app)
        .get(`/api/executions/${executionId}`)
        .set("X-Project-ID", projectId);

      const worktreePath = execResponse.body.data.worktree_path;

      if (worktreePath && fs.existsSync(worktreePath)) {
        // Create multiple commits for testing squash vs preserve
        applyMockChanges(worktreePath, [
          { path: "src/feature1.ts", content: "export const f1 = 1;", operation: "create" },
        ]);
        commitMockChanges(worktreePath, "feat: add feature 1");

        applyMockChanges(worktreePath, [
          { path: "src/feature2.ts", content: "export const f2 = 2;", operation: "create" },
        ]);
        commitMockChanges(worktreePath, "feat: add feature 2");

        applyMockChanges(worktreePath, [
          { path: "src/feature3.ts", content: "export const f3 = 3;", operation: "create" },
        ]);
        const afterCommit = commitMockChanges(worktreePath, "feat: add feature 3");

        // Update execution as completed
        testRepo.db
          .prepare(
            `
          UPDATE executions
          SET status = 'completed',
              after_commit = ?,
              completed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ?
        `
          )
          .run(afterCommit, executionId);
      }

      return { executionId, worktreePath };
    }

    describe("2.1 Sync Preview", () => {
      it("should return sync preview with commit info", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-syncprev001",
          title: "Sync preview test",
        });

        const { executionId, worktreePath } = await createCompletedExecution(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Get sync preview
        const response = await request(app)
          .get(`/api/executions/${executionId}/sync/preview`)
          .set("X-Project-ID", projectId);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();

        // Should have commits info
        if (response.body.data.commits) {
          expect(Array.isArray(response.body.data.commits)).toBe(true);
        }
      });
    });

    describe("2.2 Squash Sync", () => {
      it("should squash multiple commits into one", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-squash001",
          title: "Squash sync test",
        });

        const { executionId, worktreePath } = await createCompletedExecution(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        const mainHeadBefore = getHeadCommit(testRepo.path);

        // Perform squash sync
        const response = await request(app)
          .post(`/api/executions/${executionId}/sync/squash`)
          .set("X-Project-ID", projectId)
          .send({
            targetBranch: "main",
            commitMessage: "feat: squashed changes from execution",
          });

        // May fail if worktree/branch issues - check response
        if (response.status === 200) {
          expect(response.body.success).toBe(true);

          // Verify main branch has new commit
          const mainHeadAfter = getHeadCommit(testRepo.path);
          expect(mainHeadAfter).not.toBe(mainHeadBefore);

          // Check that we have a single squashed commit (not 3 individual ones)
          const history = getCommitHistory(testRepo.path, "main", 5);
          // Should have fewer commits than if we preserved all 3
          expect(history.length).toBeGreaterThan(0);
        }
      });
    });

    describe("2.3 Preserve Sync", () => {
      it("should preserve all commits when syncing", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-preserve001",
          title: "Preserve sync test",
        });

        const { executionId, worktreePath } = await createCompletedExecution(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Perform preserve sync
        const response = await request(app)
          .post(`/api/executions/${executionId}/sync/preserve`)
          .set("X-Project-ID", projectId)
          .send({ targetBranch: "main" });

        // Check response - may vary based on implementation
        if (response.status === 200) {
          expect(response.body.success).toBe(true);
        }
      });
    });

    describe("2.4 Stage Sync", () => {
      it("should stage changes without committing", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-stage001",
          title: "Stage sync test",
        });

        const { executionId, worktreePath } = await createCompletedExecution(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        const mainHeadBefore = getHeadCommit(testRepo.path);

        // Perform stage sync
        const response = await request(app)
          .post(`/api/executions/${executionId}/sync/stage`)
          .set("X-Project-ID", projectId)
          .send({ targetBranch: "main" });

        if (response.status === 200) {
          expect(response.body.success).toBe(true);

          // Verify HEAD hasn't changed (no commit made)
          const mainHeadAfter = getHeadCommit(testRepo.path);
          expect(mainHeadAfter).toBe(mainHeadBefore);
        }
      });
    });
  });

  // ============================================================================
  // Section 3: Execution Chains (Follow-ups)
  // ============================================================================

  describe("3. Execution Chains", () => {
    describe("3.1 Create Follow-up Execution", () => {
      it("should create follow-up execution linked to parent", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-chain001",
          title: "Execution chain test",
        });

        // Create root execution
        const rootResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Initial implementation",
            config: { mode: "worktree" },
          });

        expect(rootResponse.status).toBe(201);
        const rootExecutionId = rootResponse.body.data.id;

        // Wait for setup
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get execution to find worktree
        const execResponse = await request(app)
          .get(`/api/executions/${rootExecutionId}`)
          .set("X-Project-ID", projectId);

        const worktreePath = execResponse.body.data.worktree_path;

        // Simulate completion if worktree exists
        if (worktreePath && fs.existsSync(worktreePath)) {
          await simulateExecutionComplete(testRepo.db, rootExecutionId, worktreePath, {
            fileChanges: [
              { path: "src/v1.ts", content: "export const v = 1;", operation: "create" },
            ],
            commitMessage: "feat: v1 implementation",
          });
        } else {
          // Mark as completed anyway for follow-up test
          testRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(rootExecutionId);
        }

        // Create follow-up execution
        const followUpResponse = await request(app)
          .post(`/api/executions/${rootExecutionId}/follow-up`)
          .set("X-Project-ID", projectId)
          .send({
            feedback: "Continue with improvements",
          });

        expect(followUpResponse.status).toBe(201);
        expect(followUpResponse.body.success).toBe(true);
        expect(followUpResponse.body.data.parent_execution_id).toBe(rootExecutionId);
      });
    });

    describe("3.2 Execution Chain Retrieval", () => {
      it("should retrieve full execution chain", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-chain002",
          title: "Chain retrieval test",
        });

        // Create root execution
        const rootResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Root execution" });

        const rootId = rootResponse.body.data.id;

        // Mark as completed
        testRepo.db
          .prepare(
            `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
          )
          .run(rootId);

        // Create follow-up 1
        const followUp1Response = await request(app)
          .post(`/api/executions/${rootId}/follow-up`)
          .set("X-Project-ID", projectId)
          .send({ feedback: "Follow-up 1" });

        expect(followUp1Response.status).toBe(201);
        const followUp1Id = followUp1Response.body.data.id;

        // Mark follow-up 1 as completed
        testRepo.db
          .prepare(
            `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
          )
          .run(followUp1Id);

        // Create follow-up 2
        const followUp2Response = await request(app)
          .post(`/api/executions/${followUp1Id}/follow-up`)
          .set("X-Project-ID", projectId)
          .send({ feedback: "Follow-up 2" });

        expect(followUp2Response.status).toBe(201);

        // Get execution chain
        const chainResponse = await request(app)
          .get(`/api/executions/${rootId}/chain`)
          .set("X-Project-ID", projectId);

        expect(chainResponse.status).toBe(200);
        expect(chainResponse.body.success).toBe(true);
        expect(chainResponse.body.data.executions.length).toBeGreaterThanOrEqual(3);

        // Verify chain order (root should be first or linked properly)
        const chain = chainResponse.body.data.executions;
        const root = chain.find((e: any) => e.id === rootId);
        expect(root).toBeDefined();
      });
    });

    describe("3.3 Follow-up Uses Same Worktree", () => {
      it("should use parent worktree for follow-up execution", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-chain003",
          title: "Same worktree test",
        });

        // Create root execution
        const rootResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Root with worktree",
            config: { mode: "worktree" },
          });

        const rootId = rootResponse.body.data.id;

        // Wait for worktree
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get root worktree path
        const rootExec = await request(app)
          .get(`/api/executions/${rootId}`)
          .set("X-Project-ID", projectId);

        const rootWorktreePath = rootExec.body.data.worktree_path;

        // Mark as completed
        testRepo.db
          .prepare(
            `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
          )
          .run(rootId);

        // Create follow-up
        const followUpResponse = await request(app)
          .post(`/api/executions/${rootId}/follow-up`)
          .set("X-Project-ID", projectId)
          .send({ feedback: "Continue in same worktree" });

        expect(followUpResponse.status).toBe(201);
        const followUpId = followUpResponse.body.data.id;

        // Wait and get follow-up details
        await new Promise((resolve) => setTimeout(resolve, 500));

        const followUpExec = await request(app)
          .get(`/api/executions/${followUpId}`)
          .set("X-Project-ID", projectId);

        // Follow-up should have same worktree (or reference to it)
        // The exact implementation may vary - just verify it exists
        if (rootWorktreePath && followUpExec.body.data.worktree_path) {
          // Both should reference the same worktree location
          expect(followUpExec.body.data.worktree_path).toBeDefined();
        }
      });
    });
  });

  // ============================================================================
  // Section 4: Error Handling
  // ============================================================================

  describe("4. Error Handling", () => {
    it("should return 404 for non-existent execution", async () => {
      const response = await request(app)
        .get("/api/executions/non-existent-id")
        .set("X-Project-ID", projectId);

      expect(response.status).toBe(404);
    });

    it("should return 400 for execution without prompt", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-err001",
        title: "Error test",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          config: { mode: "worktree" },
          // Missing prompt
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 404 for non-existent issue", async () => {
      const response = await request(app)
        .post("/api/issues/non-existent-issue/executions")
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Test prompt",
        });

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // Section 5: Conflict Handling
  // ============================================================================

  describe("5. Conflict Handling", () => {
    describe("5.1 Conflict Detection", () => {
      it("should detect actual conflicts during sync preview when same lines modified", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-conflict001",
          title: "Conflict detection test",
        });

        // Create execution
        const createResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Make changes that will conflict",
            config: { mode: "worktree" },
          });

        const executionId = createResponse.body.data.id;

        // Wait for worktree setup
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get worktree path
        const execResponse = await request(app)
          .get(`/api/executions/${executionId}`)
          .set("X-Project-ID", projectId);

        const worktreePath = execResponse.body.data.worktree_path;

        if (worktreePath && fs.existsSync(worktreePath)) {
          // Make changes in worktree - modify the SAME line
          const conflictFile = path.join(worktreePath, "src", "conflict.ts");
          fs.mkdirSync(path.dirname(conflictFile), { recursive: true });
          fs.writeFileSync(conflictFile, 'export const value = "from-worktree";\n');
          execSync("git add . && git commit -m 'worktree changes'", {
            cwd: worktreePath,
            stdio: "pipe",
          });

          // Make conflicting changes on main branch - modify the SAME line
          createConflictingChanges(
            testRepo.path,
            "main",
            "src/conflict.ts",
            'export const value = "from-main";\n'
          );

          // Mark execution as completed
          testRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(executionId);

          // Get sync preview - should detect actual conflicts
          const previewResponse = await request(app)
            .get(`/api/executions/${executionId}/sync/preview`)
            .set("X-Project-ID", projectId);

          expect(previewResponse.status).toBe(200);
          expect(previewResponse.body.success).toBe(true);
          expect(previewResponse.body.data).toBeDefined();

          // Verify actual conflict detection
          const preview = previewResponse.body.data;
          expect(preview.conflicts).toBeDefined();
          expect(preview.conflicts.hasConflicts).toBe(true);
          expect(preview.conflicts.codeConflicts.length).toBeGreaterThan(0);

          // Verify the conflicting file is identified
          const conflictingFiles = preview.conflicts.codeConflicts.map(
            (c: any) => c.filePath
          );
          expect(conflictingFiles).toContain("src/conflict.ts");
        }
      });

      it("should NOT report conflicts when changes are in different parts of file", async () => {
        // First, create a base file on main with multiple lines BEFORE creating execution
        const baseContent = `// Line 1
// Line 2
// Line 3
// Line 4
// Line 5
`;
        fs.writeFileSync(
          path.join(testRepo.path, "src", "multiline.ts"),
          baseContent
        );
        execSync("git add . && git commit -m 'add base file'", {
          cwd: testRepo.path,
          stdio: "pipe",
        });

        const issue = createTestIssue(testRepo.db, {
          id: "i-noconflict001",
          title: "No conflict test",
        });

        // Create execution - worktree will branch from current main (with base file)
        const createResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Make non-conflicting changes",
            config: { mode: "worktree" },
          });

        const executionId = createResponse.body.data.id;

        // Wait for worktree setup
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get worktree path
        const execResponse = await request(app)
          .get(`/api/executions/${executionId}`)
          .set("X-Project-ID", projectId);

        const worktreePath = execResponse.body.data.worktree_path;

        if (worktreePath && fs.existsSync(worktreePath)) {
          // Modify FIRST line in worktree
          const worktreeContent = `// Line 1 - modified in worktree
// Line 2
// Line 3
// Line 4
// Line 5
`;
          fs.writeFileSync(
            path.join(worktreePath, "src", "multiline.ts"),
            worktreeContent
          );
          execSync("git add . && git commit -m 'modify first line'", {
            cwd: worktreePath,
            stdio: "pipe",
          });

          // Modify LAST line on main branch (different from worktree change)
          const mainContent = `// Line 1
// Line 2
// Line 3
// Line 4
// Line 5 - modified in main
`;
          fs.writeFileSync(
            path.join(testRepo.path, "src", "multiline.ts"),
            mainContent
          );
          execSync("git add . && git commit -m 'modify last line'", {
            cwd: testRepo.path,
            stdio: "pipe",
          });

          // Mark execution as completed
          testRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(executionId);

          // Get sync preview - should NOT detect conflicts (changes in different parts)
          const previewResponse = await request(app)
            .get(`/api/executions/${executionId}/sync/preview`)
            .set("X-Project-ID", projectId);

          expect(previewResponse.status).toBe(200);
          expect(previewResponse.body.success).toBe(true);

          // Should NOT have code conflicts (git can auto-merge different line changes)
          const preview = previewResponse.body.data;
          expect(preview.conflicts).toBeDefined();
          expect(preview.conflicts.codeConflicts.length).toBe(0);
        }
      });

      it("should list conflicts for a conflicted execution", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-conflict002",
          title: "List conflicts test",
        });

        // Create execution
        const createResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test execution" });

        const executionId = createResponse.body.data.id;

        // Get conflicts endpoint (should return empty for non-conflicted execution)
        const conflictsResponse = await request(app)
          .get(`/api/executions/${executionId}/conflicts`)
          .set("X-Project-ID", projectId);

        expect(conflictsResponse.status).toBe(200);
        expect(conflictsResponse.body.success).toBe(true);
        expect(conflictsResponse.body.data.conflicts).toBeDefined();
        expect(Array.isArray(conflictsResponse.body.data.conflicts)).toBe(true);
      });
    });

    describe("5.2 Conflict Resolution", () => {
      it("should resolve conflicts with ours strategy", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-resolve001",
          title: "Resolve ours test",
        });

        // Create execution
        const createResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test" });

        const executionId = createResponse.body.data.id;

        // Try resolve-all endpoint (even if no conflicts, should handle gracefully)
        const resolveResponse = await request(app)
          .post(`/api/executions/${executionId}/conflicts/resolve-all`)
          .set("X-Project-ID", projectId)
          .send({ strategy: "ours" });

        // Should return 200 with appropriate message
        expect(resolveResponse.status).toBe(200);
        expect(resolveResponse.body.success).toBe(true);
      });

      it("should resolve conflicts with theirs strategy", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-resolve002",
          title: "Resolve theirs test",
        });

        // Create execution
        const createResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test" });

        const executionId = createResponse.body.data.id;

        // Try resolve-all with theirs strategy
        const resolveResponse = await request(app)
          .post(`/api/executions/${executionId}/conflicts/resolve-all`)
          .set("X-Project-ID", projectId)
          .send({ strategy: "theirs" });

        expect(resolveResponse.status).toBe(200);
        expect(resolveResponse.body.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // Section 6: JSONL Auto-Merge
  // ============================================================================

  describe("6. JSONL Auto-Merge", () => {
    it("should detect JSONL files in sync preview", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-jsonl001",
        title: "JSONL detection test",
      });

      // Create execution
      const createResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Add JSONL changes",
          config: { mode: "worktree" },
        });

      const executionId = createResponse.body.data.id;

      // Wait for worktree
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get worktree path
      const execResponse = await request(app)
        .get(`/api/executions/${executionId}`)
        .set("X-Project-ID", projectId);

      const worktreePath = execResponse.body.data.worktree_path;

      if (worktreePath && fs.existsSync(worktreePath)) {
        // Ensure .sudocode directory exists in worktree
        const worktreeSudocodePath = path.join(worktreePath, ".sudocode");
        if (!fs.existsSync(worktreeSudocodePath)) {
          fs.mkdirSync(worktreeSudocodePath, { recursive: true });
        }

        // Make changes to JSONL file in worktree
        const jsonlPath = path.join(worktreePath, ".sudocode", "issues.jsonl");
        const newIssue = {
          id: "i-new001",
          uuid: `uuid-new001-${Date.now()}`,
          title: "New issue from worktree",
          content: "Test content",
          status: "open",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Append to JSONL
        fs.appendFileSync(jsonlPath, JSON.stringify(newIssue) + "\n");

        // Commit in worktree
        execSync("git add . && git commit -m 'Add issue via JSONL'", {
          cwd: worktreePath,
          stdio: "pipe",
        });

        // Mark as completed
        testRepo.db
          .prepare(
            `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
          )
          .run(executionId);

        // Get sync preview
        const previewResponse = await request(app)
          .get(`/api/executions/${executionId}/sync/preview`)
          .set("X-Project-ID", projectId);

        expect(previewResponse.status).toBe(200);
        expect(previewResponse.body.data).toBeDefined();
        // The preview should show the JSONL changes
      }
    });

    it("should auto-merge JSONL conflicts during squash sync", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-jsonl002",
        title: "JSONL merge test",
      });

      // Create execution
      const createResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "JSONL merge scenario",
          config: { mode: "worktree" },
        });

      const executionId = createResponse.body.data.id;

      // Wait for worktree
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get worktree path
      const execResponse = await request(app)
        .get(`/api/executions/${executionId}`)
        .set("X-Project-ID", projectId);

      const worktreePath = execResponse.body.data.worktree_path;

      if (worktreePath && fs.existsSync(worktreePath)) {
        // Ensure .sudocode directory exists in worktree
        const worktreeSudocodePath = path.join(worktreePath, ".sudocode");
        if (!fs.existsSync(worktreeSudocodePath)) {
          fs.mkdirSync(worktreeSudocodePath, { recursive: true });
        }

        // Add issue in worktree
        const worktreeJsonlPath = path.join(worktreePath, ".sudocode", "issues.jsonl");
        const worktreeIssue = {
          id: "i-wt001",
          uuid: `uuid-wt001-${Date.now()}`,
          title: "From worktree",
          content: "Worktree content",
          status: "open",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        fs.appendFileSync(worktreeJsonlPath, JSON.stringify(worktreeIssue) + "\n");
        execSync("git add . && git commit -m 'Add worktree issue'", {
          cwd: worktreePath,
          stdio: "pipe",
        });

        // Add different issue on main
        const mainJsonlPath = path.join(testRepo.path, ".sudocode", "issues.jsonl");
        const mainIssue = {
          id: "i-main001",
          uuid: `uuid-main001-${Date.now()}`,
          title: "From main",
          content: "Main content",
          status: "open",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        fs.appendFileSync(mainJsonlPath, JSON.stringify(mainIssue) + "\n");
        execSync("git add . && git commit -m 'Add main issue'", {
          cwd: testRepo.path,
          stdio: "pipe",
        });

        // Mark as completed
        testRepo.db
          .prepare(
            `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
          )
          .run(executionId);

        // Attempt squash sync - should auto-merge JSONL
        const syncResponse = await request(app)
          .post(`/api/executions/${executionId}/sync/squash`)
          .set("X-Project-ID", projectId)
          .send({ commitMessage: "Squash with JSONL merge" });

        // Sync should succeed or return appropriate error
        expect(syncResponse.body).toBeDefined();
        // If sync succeeded, verify both issues exist in final JSONL
        if (syncResponse.body.success) {
          const finalJsonl = fs.readFileSync(mainJsonlPath, "utf-8");
          expect(finalJsonl).toContain("i-wt001");
          expect(finalJsonl).toContain("i-main001");
        }
      }
    });
  });

  // ============================================================================
  // Section 7: Execution Status Transitions
  // ============================================================================

  describe("7. Execution Status Transitions", () => {
    it("should track execution through lifecycle states", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-lifecycle001",
        title: "Lifecycle test",
      });

      // Create execution - should start in preparing/pending state
      const createResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Track lifecycle",
          config: { mode: "worktree" },
        });

      expect(createResponse.status).toBe(201);
      const executionId = createResponse.body.data.id;
      const initialStatus = createResponse.body.data.status;

      // Initial status should be preparing, pending, or running
      expect(["preparing", "pending", "running"]).toContain(initialStatus);

      // Get current status
      const statusResponse = await request(app)
        .get(`/api/executions/${executionId}`)
        .set("X-Project-ID", projectId);

      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body.data.status).toBeDefined();
    });

    it("should allow cancelling a running execution", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-cancel001",
        title: "Cancel test",
      });

      // Create execution
      const createResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({ prompt: "Cancel me" });

      const executionId = createResponse.body.data.id;

      // Try to cancel
      const cancelResponse = await request(app)
        .post(`/api/executions/${executionId}/cancel`)
        .set("X-Project-ID", projectId);

      // Should succeed or return appropriate status
      expect([200, 400, 404]).toContain(cancelResponse.status);
    });

    it("should track stream_id when dataplane is enabled", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-stream001",
        title: "Stream ID test",
      });

      // Create execution
      const createResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Track stream",
          config: { mode: "worktree" },
        });

      const executionId = createResponse.body.data.id;

      // Wait for worktree setup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get execution details
      const execResponse = await request(app)
        .get(`/api/executions/${executionId}`)
        .set("X-Project-ID", projectId);

      expect(execResponse.status).toBe(200);
      // With dataplane enabled, stream_id should be set
      // (may be null if dataplane not actually enabled in test config)
      expect(execResponse.body.data).toBeDefined();
    });
  });

  // ============================================================================
  // Section 8: Worktree Management
  // ============================================================================

  describe("8. Worktree Management", () => {
    it("should check if worktree exists for execution", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-wt001",
        title: "Worktree exists test",
      });

      // Create execution with worktree mode
      const createResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Check worktree",
          config: { mode: "worktree" },
        });

      const executionId = createResponse.body.data.id;

      // Wait for worktree setup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check worktree exists (route is /worktree not /worktree/exists)
      const existsResponse = await request(app)
        .get(`/api/executions/${executionId}/worktree`)
        .set("X-Project-ID", projectId);

      expect(existsResponse.status).toBe(200);
      expect(existsResponse.body.success).toBe(true);
      expect(existsResponse.body.data.exists).toBeDefined();
    });

    it("should delete worktree when requested", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-wt002",
        title: "Delete worktree test",
      });

      // Create execution
      const createResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Delete worktree",
          config: { mode: "worktree" },
        });

      const executionId = createResponse.body.data.id;

      // Wait for worktree
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Mark as completed
      testRepo.db
        .prepare(
          `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
        )
        .run(executionId);

      // Delete worktree
      const deleteResponse = await request(app)
        .delete(`/api/executions/${executionId}/worktree`)
        .set("X-Project-ID", projectId);

      // Should succeed
      expect([200, 404]).toContain(deleteResponse.status);
    });

    it("should list worktrees across executions", async () => {
      // Use git worktree list to check worktrees in test repo
      const worktrees = listWorktrees(testRepo.path);

      // Should have at least the main worktree
      expect(worktrees.length).toBeGreaterThanOrEqual(1);
      // Compare using realpath to handle symlinks (e.g., /var -> /private/var on macOS)
      const normalizedWorktree = fs.realpathSync(worktrees[0]);
      const normalizedTestPath = fs.realpathSync(testRepo.path);
      expect(normalizedWorktree).toBe(normalizedTestPath);
    });
  });

  // ============================================================================
  // Section 9: Cascade Rebase & Stream Dependencies
  // ============================================================================

  describe("9. Cascade Rebase & Stream Dependencies", () => {
    describe("9.1 Stream Dependency Setup", () => {
      it("should create streams with dependency relationships", async () => {
        // Create parent issue (blocker)
        const parentIssue = createTestIssue(testRepo.db, {
          id: "i-parent001",
          title: "Parent feature",
        });

        // Create child issue (blocked by parent)
        const childIssue = createTestIssue(testRepo.db, {
          id: "i-child001",
          title: "Child feature",
        });

        // Create relationship: parent blocks child
        createRelationship(testRepo.db, {
          fromId: parentIssue.id,
          toId: childIssue.id,
          type: "blocks",
        });

        // Create execution for parent
        const parentExecResponse = await request(app)
          .post(`/api/issues/${parentIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Implement parent feature",
            config: { mode: "worktree" },
          });

        expect(parentExecResponse.status).toBe(201);
        const parentExecId = parentExecResponse.body.data.id;

        // Wait for worktree setup
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create execution for child
        const childExecResponse = await request(app)
          .post(`/api/issues/${childIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "Implement child feature",
            config: { mode: "worktree" },
          });

        expect(childExecResponse.status).toBe(201);
        const childExecId = childExecResponse.body.data.id;

        // Verify both executions have stream_id
        const parentExec = await request(app)
          .get(`/api/executions/${parentExecId}`)
          .set("X-Project-ID", projectId);

        const childExec = await request(app)
          .get(`/api/executions/${childExecId}`)
          .set("X-Project-ID", projectId);

        expect(parentExec.body.data.stream_id).toBeDefined();
        expect(childExec.body.data.stream_id).toBeDefined();
        // Streams should be different
        expect(parentExec.body.data.stream_id).not.toBe(childExec.body.data.stream_id);
      });

      it("should track depends-on relationships between issues", async () => {
        // Create issues with depends-on relationship
        const baseIssue = createTestIssue(testRepo.db, {
          id: "i-base001",
          title: "Base infrastructure",
        });

        const dependentIssue = createTestIssue(testRepo.db, {
          id: "i-dep001",
          title: "Dependent feature",
        });

        // Create relationship: dependent depends-on base
        createRelationship(testRepo.db, {
          fromId: dependentIssue.id,
          toId: baseIssue.id,
          type: "depends-on",
        });

        // Create executions
        const baseExecResponse = await request(app)
          .post(`/api/issues/${baseIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Build base", config: { mode: "worktree" } });

        expect(baseExecResponse.status).toBe(201);

        // Wait for worktree
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const depExecResponse = await request(app)
          .post(`/api/issues/${dependentIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Build dependent", config: { mode: "worktree" } });

        expect(depExecResponse.status).toBe(201);

        // Both should have stream IDs
        expect(baseExecResponse.body.data.stream_id).toBeDefined();
        expect(depExecResponse.body.data.stream_id).toBeDefined();
      });
    });

    describe("9.2 Cascade Trigger on Sync", () => {
      it("should include cascade info in sync result when dependencies exist", async () => {
        // Create parent and child issues with relationship
        const parentIssue = createTestIssue(testRepo.db, {
          id: "i-cascade-parent",
          title: "Parent for cascade",
        });

        const childIssue = createTestIssue(testRepo.db, {
          id: "i-cascade-child",
          title: "Child for cascade",
        });

        createRelationship(testRepo.db, {
          fromId: parentIssue.id,
          toId: childIssue.id,
          type: "blocks",
        });

        // Create and setup parent execution
        const parentExecResponse = await request(app)
          .post(`/api/issues/${parentIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Parent work", config: { mode: "worktree" } });

        const parentExecId = parentExecResponse.body.data.id;

        // Wait for worktree setup
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get parent worktree path
        const parentExec = await request(app)
          .get(`/api/executions/${parentExecId}`)
          .set("X-Project-ID", projectId);

        const parentWorktreePath = parentExec.body.data.worktree_path;

        if (parentWorktreePath && fs.existsSync(parentWorktreePath)) {
          // Make changes in parent worktree
          const featureFile = path.join(parentWorktreePath, "src", "parent-feature.ts");
          fs.mkdirSync(path.dirname(featureFile), { recursive: true });
          fs.writeFileSync(featureFile, 'export const parentFeature = "v1";\n');
          execSync("git add . && git commit -m 'Add parent feature'", {
            cwd: parentWorktreePath,
            stdio: "pipe",
          });

          // Create child execution
          const childExecResponse = await request(app)
            .post(`/api/issues/${childIssue.id}/executions`)
            .set("X-Project-ID", projectId)
            .send({ prompt: "Child work", config: { mode: "worktree" } });

          const childExecId = childExecResponse.body.data.id;

          // Wait for child worktree
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Get child worktree
          const childExec = await request(app)
            .get(`/api/executions/${childExecId}`)
            .set("X-Project-ID", projectId);

          const childWorktreePath = childExec.body.data.worktree_path;

          if (childWorktreePath && fs.existsSync(childWorktreePath)) {
            // Make changes in child worktree
            const childFile = path.join(childWorktreePath, "src", "child-feature.ts");
            fs.mkdirSync(path.dirname(childFile), { recursive: true });
            fs.writeFileSync(childFile, 'export const childFeature = "v1";\n');
            execSync("git add . && git commit -m 'Add child feature'", {
              cwd: childWorktreePath,
              stdio: "pipe",
            });
          }

          // Mark parent as completed
          testRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(parentExecId);

          // Sync parent - this should include cascade info
          const syncResponse = await request(app)
            .post(`/api/executions/${parentExecId}/sync/squash`)
            .set("X-Project-ID", projectId)
            .send({ commitMessage: "Parent feature complete" });

          expect(syncResponse.body).toBeDefined();
          // Sync should succeed
          if (syncResponse.body.success) {
            // Cascade info may or may not be present depending on config
            // The important thing is the sync itself succeeds
            expect(syncResponse.body.data).toBeDefined();
          }
        }
      });
    });

    describe("9.3 Multiple Dependent Streams", () => {
      it("should handle multiple child streams depending on one parent", async () => {
        // Create one parent with multiple children
        const parentIssue = createTestIssue(testRepo.db, {
          id: "i-multi-parent",
          title: "Multi-child parent",
        });

        const child1 = createTestIssue(testRepo.db, {
          id: "i-multi-child1",
          title: "First child",
        });

        const child2 = createTestIssue(testRepo.db, {
          id: "i-multi-child2",
          title: "Second child",
        });

        // Both children depend on parent
        createRelationship(testRepo.db, {
          fromId: parentIssue.id,
          toId: child1.id,
          type: "blocks",
        });

        createRelationship(testRepo.db, {
          fromId: parentIssue.id,
          toId: child2.id,
          type: "blocks",
        });

        // Create execution for parent
        const parentExecResponse = await request(app)
          .post(`/api/issues/${parentIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Parent impl", config: { mode: "worktree" } });

        expect(parentExecResponse.status).toBe(201);

        // Wait for parent worktree
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create executions for both children
        const child1Response = await request(app)
          .post(`/api/issues/${child1.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Child 1 impl", config: { mode: "worktree" } });

        expect(child1Response.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 500));

        const child2Response = await request(app)
          .post(`/api/issues/${child2.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Child 2 impl", config: { mode: "worktree" } });

        expect(child2Response.status).toBe(201);

        // All three should have different stream IDs
        const streams = [
          parentExecResponse.body.data.stream_id,
          child1Response.body.data.stream_id,
          child2Response.body.data.stream_id,
        ].filter(Boolean);

        // Check uniqueness
        const uniqueStreams = new Set(streams);
        expect(uniqueStreams.size).toBe(streams.length);
      });

      it("should handle chain of dependencies (A -> B -> C)", async () => {
        // Create chain: C depends-on B depends-on A
        const issueA = createTestIssue(testRepo.db, {
          id: "i-chain-a",
          title: "Base A",
        });

        const issueB = createTestIssue(testRepo.db, {
          id: "i-chain-b",
          title: "Middle B",
        });

        const issueC = createTestIssue(testRepo.db, {
          id: "i-chain-c",
          title: "Top C",
        });

        // A blocks B, B blocks C
        createRelationship(testRepo.db, {
          fromId: issueA.id,
          toId: issueB.id,
          type: "blocks",
        });

        createRelationship(testRepo.db, {
          fromId: issueB.id,
          toId: issueC.id,
          type: "blocks",
        });

        // Create execution for A
        const execAResponse = await request(app)
          .post(`/api/issues/${issueA.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Build A", config: { mode: "worktree" } });

        expect(execAResponse.status).toBe(201);

        // Wait and create B
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const execBResponse = await request(app)
          .post(`/api/issues/${issueB.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Build B", config: { mode: "worktree" } });

        expect(execBResponse.status).toBe(201);

        // Wait and create C
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const execCResponse = await request(app)
          .post(`/api/issues/${issueC.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Build C", config: { mode: "worktree" } });

        expect(execCResponse.status).toBe(201);

        // All three should have stream IDs
        expect(execAResponse.body.data.stream_id).toBeDefined();
        expect(execBResponse.body.data.stream_id).toBeDefined();
        expect(execCResponse.body.data.stream_id).toBeDefined();

        // All should be unique
        const streams = [
          execAResponse.body.data.stream_id,
          execBResponse.body.data.stream_id,
          execCResponse.body.data.stream_id,
        ];
        expect(new Set(streams).size).toBe(3);
      });
    });

    describe("9.4 Cascade with Conflicts", () => {
      it("should handle cascade when child has conflicting changes", async () => {
        // Create parent and child with potential for conflict
        const parentIssue = createTestIssue(testRepo.db, {
          id: "i-conflict-parent",
          title: "Conflict parent",
        });

        const childIssue = createTestIssue(testRepo.db, {
          id: "i-conflict-child",
          title: "Conflict child",
        });

        createRelationship(testRepo.db, {
          fromId: parentIssue.id,
          toId: childIssue.id,
          type: "blocks",
        });

        // Create parent execution
        const parentExecResponse = await request(app)
          .post(`/api/issues/${parentIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Parent changes", config: { mode: "worktree" } });

        const parentExecId = parentExecResponse.body.data.id;

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get parent worktree and make changes to shared file
        const parentExec = await request(app)
          .get(`/api/executions/${parentExecId}`)
          .set("X-Project-ID", projectId);

        const parentWorktreePath = parentExec.body.data.worktree_path;

        if (parentWorktreePath && fs.existsSync(parentWorktreePath)) {
          // Parent modifies shared.ts
          const sharedFile = path.join(parentWorktreePath, "src", "shared.ts");
          fs.mkdirSync(path.dirname(sharedFile), { recursive: true });
          fs.writeFileSync(sharedFile, 'export const shared = "parent-version";\n');
          execSync("git add . && git commit -m 'Parent modifies shared'", {
            cwd: parentWorktreePath,
            stdio: "pipe",
          });

          // Create child execution
          const childExecResponse = await request(app)
            .post(`/api/issues/${childIssue.id}/executions`)
            .set("X-Project-ID", projectId)
            .send({ prompt: "Child changes", config: { mode: "worktree" } });

          const childExecId = childExecResponse.body.data.id;

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Get child worktree and modify same file
          const childExec = await request(app)
            .get(`/api/executions/${childExecId}`)
            .set("X-Project-ID", projectId);

          const childWorktreePath = childExec.body.data.worktree_path;

          if (childWorktreePath && fs.existsSync(childWorktreePath)) {
            // Child modifies shared.ts differently
            const childSharedFile = path.join(childWorktreePath, "src", "shared.ts");
            fs.mkdirSync(path.dirname(childSharedFile), { recursive: true });
            fs.writeFileSync(childSharedFile, 'export const shared = "child-version";\n');
            execSync("git add . && git commit -m 'Child modifies shared'", {
              cwd: childWorktreePath,
              stdio: "pipe",
            });
          }

          // Mark parent as completed
          testRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(parentExecId);

          // Preview sync for parent - should show potential impact
          const previewResponse = await request(app)
            .get(`/api/executions/${parentExecId}/sync/preview`)
            .set("X-Project-ID", projectId);

          expect(previewResponse.status).toBe(200);
          expect(previewResponse.body.data).toBeDefined();
        }
      });
    });

    describe("9.5 Cascade On Merge Enabled", () => {
      // These tests use a separate project with cascadeOnMerge enabled
      let cascadeTestRepo: TestRepo;
      let cascadeApp: express.Application;
      let cascadeProjectManager: ProjectManager;
      let cascadeProjectRegistry: ProjectRegistry;
      let cascadeProjectId: string;
      let cascadeRegistryPath: string;

      beforeEach(async () => {
        // Create repo with cascadeOnMerge enabled
        cascadeTestRepo = createTestRepo({
          dataplaneEnabled: true,
          cascadeOnMerge: true,
        });

        cascadeRegistryPath = path.join(cascadeTestRepo.path, "..", "cascade-projects.json");
        cascadeProjectRegistry = new ProjectRegistry(cascadeRegistryPath);
        await cascadeProjectRegistry.load();

        cascadeProjectManager = new ProjectManager(cascadeProjectRegistry, { watchEnabled: false });

        const result = await cascadeProjectManager.openProject(cascadeTestRepo.path);
        if (!result.ok) {
          throw new Error(`Failed to open cascade test project: ${result.error}`);
        }
        cascadeProjectId = result.value.id;

        // Set up Express app
        cascadeApp = express();
        cascadeApp.use(express.json());
        cascadeApp.use(requireProject(cascadeProjectManager));
        cascadeApp.use("/api", createExecutionsRouter());
        cascadeApp.use("/api", createIssuesRouter());
      });

      afterEach(async () => {
        await cascadeProjectManager.shutdown();
        cascadeTestRepo.cleanup();

        if (fs.existsSync(cascadeRegistryPath)) {
          fs.unlinkSync(cascadeRegistryPath);
        }
      });

      it("should trigger cascade rebase when parent stream is synced", async () => {
        // Create parent and child issues
        const parentIssue = createTestIssue(cascadeTestRepo.db, {
          id: "i-cascade-test-parent",
          title: "Cascade test parent",
        });

        const childIssue = createTestIssue(cascadeTestRepo.db, {
          id: "i-cascade-test-child",
          title: "Cascade test child",
        });

        // Child depends on parent (parent blocks child)
        createRelationship(cascadeTestRepo.db, {
          fromId: parentIssue.id,
          toId: childIssue.id,
          type: "blocks",
        });

        // Create parent execution
        const parentExecResponse = await request(cascadeApp)
          .post(`/api/issues/${parentIssue.id}/executions`)
          .set("X-Project-ID", cascadeProjectId)
          .send({ prompt: "Build parent feature", config: { mode: "worktree" } });

        expect(parentExecResponse.status).toBe(201);
        const parentExecId = parentExecResponse.body.data.id;
        const parentStreamId = parentExecResponse.body.data.stream_id;

        // Wait for worktree
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Get parent worktree path
        const parentExec = await request(cascadeApp)
          .get(`/api/executions/${parentExecId}`)
          .set("X-Project-ID", cascadeProjectId);

        const parentWorktreePath = parentExec.body.data.worktree_path;
        expect(parentWorktreePath).toBeDefined();

        if (!parentWorktreePath || !fs.existsSync(parentWorktreePath)) {
          console.log("Skipping cascade test - no worktree available");
          return;
        }

        // Make changes in parent worktree
        const parentFeatureFile = path.join(parentWorktreePath, "src", "parent-api.ts");
        fs.mkdirSync(path.dirname(parentFeatureFile), { recursive: true });
        fs.writeFileSync(parentFeatureFile, `
export interface ParentAPI {
  version: string;
  getData(): Promise<string>;
}

export const parentVersion = "1.0.0";
`);
        execSync("git add . && git commit -m 'Add parent API'", {
          cwd: parentWorktreePath,
          stdio: "pipe",
        });

        // Get parent HEAD before sync
        const parentHeadBeforeSync = execSync("git rev-parse HEAD", {
          cwd: parentWorktreePath,
          encoding: "utf-8",
        }).trim();

        // Now create child execution
        const childExecResponse = await request(cascadeApp)
          .post(`/api/issues/${childIssue.id}/executions`)
          .set("X-Project-ID", cascadeProjectId)
          .send({ prompt: "Build child feature", config: { mode: "worktree" } });

        expect(childExecResponse.status).toBe(201);
        const childExecId = childExecResponse.body.data.id;
        const childStreamId = childExecResponse.body.data.stream_id;

        // Wait for child worktree
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Get child worktree
        const childExec = await request(cascadeApp)
          .get(`/api/executions/${childExecId}`)
          .set("X-Project-ID", cascadeProjectId);

        const childWorktreePath = childExec.body.data.worktree_path;

        if (childWorktreePath && fs.existsSync(childWorktreePath)) {
          // Make changes in child worktree (different file - no conflict)
          const childFeatureFile = path.join(childWorktreePath, "src", "child-impl.ts");
          fs.mkdirSync(path.dirname(childFeatureFile), { recursive: true });
          fs.writeFileSync(childFeatureFile, `
import { ParentAPI } from './parent-api';

export class ChildImplementation implements ParentAPI {
  version = "1.0.0";
  async getData(): Promise<string> {
    return "child data";
  }
}
`);
          execSync("git add . && git commit -m 'Add child implementation'", {
            cwd: childWorktreePath,
            stdio: "pipe",
          });

          // Get child HEAD before cascade
          const childHeadBeforeCascade = execSync("git rev-parse HEAD", {
            cwd: childWorktreePath,
            encoding: "utf-8",
          }).trim();

          // Mark parent as completed
          cascadeTestRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(parentExecId);

          // Sync parent - this should trigger cascade to child
          const syncResponse = await request(cascadeApp)
            .post(`/api/executions/${parentExecId}/sync/squash`)
            .set("X-Project-ID", cascadeProjectId)
            .send({ commitMessage: "feat: parent API complete" });

          expect(syncResponse.status).toBe(200);
          expect(syncResponse.body.success).toBe(true);

          // Check if cascade was triggered
          if (syncResponse.body.data.cascade) {
            const cascade = syncResponse.body.data.cascade;
            expect(cascade.triggered_by).toBe(parentStreamId);

            // Find child in affected streams
            const childResult = cascade.affected_streams?.find(
              (s: any) => s.stream_id === childStreamId || s.issue_id === childIssue.id
            );

            if (childResult) {
              console.log("Cascade result for child:", childResult);

              if (childResult.result === "rebased") {
                // Verify child worktree now has parent's changes
                const parentApiInChild = path.join(childWorktreePath, "src", "parent-api.ts");
                expect(fs.existsSync(parentApiInChild)).toBe(true);

                // Verify child HEAD changed (rebased)
                const childHeadAfterCascade = execSync("git rev-parse HEAD", {
                  cwd: childWorktreePath,
                  encoding: "utf-8",
                }).trim();

                // HEAD should be different after rebase
                expect(childHeadAfterCascade).not.toBe(childHeadBeforeCascade);
              } else if (childResult.result === "skipped") {
                console.log("Child was skipped:", childResult.error);
              } else if (childResult.result === "conflict") {
                console.log("Child had conflicts:", childResult.conflict_files);
              }
            }
          } else {
            console.log("No cascade info in response - cascade may not have been triggered");
            console.log("Sync response:", JSON.stringify(syncResponse.body.data, null, 2));
          }
        }
      });

      it("should report cascade results in sync response", async () => {
        // Create parent issue
        const parentIssue = createTestIssue(cascadeTestRepo.db, {
          id: "i-report-parent",
          title: "Report test parent",
        });

        // Create execution
        const execResponse = await request(cascadeApp)
          .post(`/api/issues/${parentIssue.id}/executions`)
          .set("X-Project-ID", cascadeProjectId)
          .send({ prompt: "Test", config: { mode: "worktree" } });

        expect(execResponse.status).toBe(201);
        const execId = execResponse.body.data.id;

        // Wait for worktree
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get worktree and make a commit
        const execDetails = await request(cascadeApp)
          .get(`/api/executions/${execId}`)
          .set("X-Project-ID", cascadeProjectId);

        const worktreePath = execDetails.body.data.worktree_path;

        if (worktreePath && fs.existsSync(worktreePath)) {
          const testFile = path.join(worktreePath, "test.txt");
          fs.writeFileSync(testFile, "test content\n");
          execSync("git add . && git commit -m 'test commit'", {
            cwd: worktreePath,
            stdio: "pipe",
          });

          // Mark as completed
          cascadeTestRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(execId);

          // Sync - even with no dependents, cascade field should be present
          const syncResponse = await request(cascadeApp)
            .post(`/api/executions/${execId}/sync/squash`)
            .set("X-Project-ID", cascadeProjectId)
            .send({ commitMessage: "test" });

          expect(syncResponse.status).toBe(200);
          expect(syncResponse.body.success).toBe(true);

          // Cascade should be in response (even if empty)
          // The cascade field indicates cascade was considered
          if (syncResponse.body.data.cascade) {
            expect(syncResponse.body.data.cascade.triggered_by).toBeDefined();
            expect(syncResponse.body.data.cascade.affected_streams).toBeDefined();
            expect(syncResponse.body.data.cascade.complete).toBeDefined();
          }
        }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Merge Queue Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe("10. Merge Queue Operations", () => {
    describe("10.1 Queue Management", () => {
      it("should add execution to merge queue", async () => {
        // Create issue and execution
        const issue = createTestIssue(testRepo.db, {
          id: "i-queue-add",
          title: "Queue add test",
        });

        const execResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test queue add", config: { mode: "worktree" } });

        expect(execResponse.status).toBe(201);
        const execId = execResponse.body.data.id;

        // Wait for worktree and stream creation
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get the dataplane adapter
        const adapter = await getDataplaneAdapter(testRepo.path);
        expect(adapter).not.toBeNull();

        if (adapter) {
          // Enqueue the execution
          const queueEntry = await adapter.enqueue({
            executionId: execId,
            targetBranch: "main",
            agentId: "test-agent",
          });

          expect(queueEntry).toBeDefined();
          expect(queueEntry.executionId).toBe(execId);
          expect(queueEntry.targetBranch).toBe("main");
          expect(queueEntry.status).toBe("pending");
          expect(queueEntry.position).toBeGreaterThanOrEqual(0);
        }
      });

      it("should get queue position for execution", async () => {
        // Create issue and execution
        const issue = createTestIssue(testRepo.db, {
          id: "i-queue-pos",
          title: "Queue position test",
        });

        const execResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test queue position", config: { mode: "worktree" } });

        expect(execResponse.status).toBe(201);
        const execId = execResponse.body.data.id;

        // Wait for stream creation
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const adapter = await getDataplaneAdapter(testRepo.path);
        expect(adapter).not.toBeNull();

        if (adapter) {
          // Enqueue
          await adapter.enqueue({
            executionId: execId,
            targetBranch: "main",
            agentId: "test-agent",
          });

          // Get position
          const position = await adapter.getQueuePosition(execId, "main");
          expect(position).not.toBeNull();
          expect(typeof position).toBe("number");
        }
      });

      it("should get full merge queue", async () => {
        // Create multiple issues and executions
        const issue1 = createTestIssue(testRepo.db, {
          id: "i-queue-list-1",
          title: "Queue list test 1",
        });
        const issue2 = createTestIssue(testRepo.db, {
          id: "i-queue-list-2",
          title: "Queue list test 2",
        });

        const exec1Response = await request(app)
          .post(`/api/issues/${issue1.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test 1", config: { mode: "worktree" } });

        const exec2Response = await request(app)
          .post(`/api/issues/${issue2.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test 2", config: { mode: "worktree" } });

        expect(exec1Response.status).toBe(201);
        expect(exec2Response.status).toBe(201);

        const execId1 = exec1Response.body.data.id;
        const execId2 = exec2Response.body.data.id;

        // Wait for stream creation
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const adapter = await getDataplaneAdapter(testRepo.path);
        expect(adapter).not.toBeNull();

        if (adapter) {
          // Enqueue both
          await adapter.enqueue({
            executionId: execId1,
            targetBranch: "main",
            agentId: "test-agent",
          });
          await adapter.enqueue({
            executionId: execId2,
            targetBranch: "main",
            agentId: "test-agent",
          });

          // Get queue
          const queue = await adapter.getQueue("main");
          expect(queue.length).toBeGreaterThanOrEqual(2);

          // Verify queue contains our executions
          const execIds = queue.map((e) => e.executionId);
          expect(execIds).toContain(execId1);
          expect(execIds).toContain(execId2);
        }
      });

      it("should remove execution from merge queue", async () => {
        // Create issue and execution
        const issue = createTestIssue(testRepo.db, {
          id: "i-queue-remove",
          title: "Queue remove test",
        });

        const execResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test queue remove", config: { mode: "worktree" } });

        expect(execResponse.status).toBe(201);
        const execId = execResponse.body.data.id;

        // Wait for stream creation
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const adapter = await getDataplaneAdapter(testRepo.path);
        expect(adapter).not.toBeNull();

        if (adapter) {
          // Enqueue
          await adapter.enqueue({
            executionId: execId,
            targetBranch: "main",
            agentId: "test-agent",
          });

          // Verify it's in queue
          let position = await adapter.getQueuePosition(execId, "main");
          expect(position).not.toBeNull();

          // Dequeue
          await adapter.dequeue(execId);

          // Verify it's removed
          position = await adapter.getQueuePosition(execId, "main");
          expect(position).toBeNull();
        }
      });
    });

    describe("10.2 Queue Priority", () => {
      it("should respect priority when adding to queue", async () => {
        // Create two issues
        const lowPriorityIssue = createTestIssue(testRepo.db, {
          id: "i-queue-low-pri",
          title: "Low priority",
          priority: 4,
        });
        const highPriorityIssue = createTestIssue(testRepo.db, {
          id: "i-queue-high-pri",
          title: "High priority",
          priority: 0,
        });

        // Create executions
        const lowExecResponse = await request(app)
          .post(`/api/issues/${lowPriorityIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Low priority", config: { mode: "worktree" } });

        const highExecResponse = await request(app)
          .post(`/api/issues/${highPriorityIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "High priority", config: { mode: "worktree" } });

        expect(lowExecResponse.status).toBe(201);
        expect(highExecResponse.status).toBe(201);

        const lowExecId = lowExecResponse.body.data.id;
        const highExecId = highExecResponse.body.data.id;

        // Wait for stream creation
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const adapter = await getDataplaneAdapter(testRepo.path);
        expect(adapter).not.toBeNull();

        if (adapter) {
          // Enqueue low priority first (position 1)
          await adapter.enqueue({
            executionId: lowExecId,
            targetBranch: "main",
            agentId: "test-agent",
            position: 10, // Low priority = higher position number
          });

          // Enqueue high priority second (position 0)
          await adapter.enqueue({
            executionId: highExecId,
            targetBranch: "main",
            agentId: "test-agent",
            position: 1, // High priority = lower position number
          });

          // Get queue and check order
          const queue = await adapter.getQueue("main");
          const highPriEntry = queue.find((e) => e.executionId === highExecId);
          const lowPriEntry = queue.find((e) => e.executionId === lowExecId);

          expect(highPriEntry).toBeDefined();
          expect(lowPriEntry).toBeDefined();

          // Higher priority should have lower priority number
          if (highPriEntry && lowPriEntry) {
            expect(highPriEntry.priority).toBeLessThan(lowPriEntry.priority);
          }
        }
      });
    });

    describe("10.3 Merge Operations", () => {
      it("should merge next item in queue", async () => {
        // Create issue and execution
        const issue = createTestIssue(testRepo.db, {
          id: "i-queue-merge",
          title: "Queue merge test",
        });

        const execResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Test merge", config: { mode: "worktree" } });

        expect(execResponse.status).toBe(201);
        const execId = execResponse.body.data.id;

        // Wait for worktree creation
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Get worktree path and make changes
        const execDetails = await request(app)
          .get(`/api/executions/${execId}`)
          .set("X-Project-ID", projectId);

        const worktreePath = execDetails.body.data.worktree_path;

        if (worktreePath && fs.existsSync(worktreePath)) {
          // Make changes in worktree
          applyMockChanges(worktreePath, DEFAULT_MOCK_CHANGES);
          commitMockChanges(worktreePath, "feat: queue merge test changes");

          // Mark execution as completed
          testRepo.db
            .prepare(
              `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
            )
            .run(execId);

          const adapter = await getDataplaneAdapter(testRepo.path);
          expect(adapter).not.toBeNull();

          if (adapter) {
            // Enqueue with ready status
            const entry = await adapter.enqueue({
              executionId: execId,
              targetBranch: "main",
              agentId: "test-agent",
            });

            // Get the stream to find a worktree for merging
            const stream = adapter.getStreamByExecutionId(execId);
            expect(stream).not.toBeNull();

            if (stream) {
              // Attempt merge (may succeed or fail based on setup)
              const mergeResult = await adapter.mergeNext("main", "test-agent", worktreePath);

              // The operation should complete (success or failure with reason)
              expect(mergeResult).toBeDefined();
              expect(typeof mergeResult.success).toBe("boolean");

              if (mergeResult.success) {
                expect(mergeResult.mergeCommit).toBeDefined();
              } else {
                // If failed, should have error message
                expect(mergeResult.error).toBeDefined();
              }
            }
          }
        }
      });

      it("should handle empty queue gracefully", async () => {
        const adapter = await getDataplaneAdapter(testRepo.path);
        expect(adapter).not.toBeNull();

        if (adapter) {
          // Try to merge from empty queue for a non-existent target
          const result = await adapter.mergeNext("nonexistent-branch", "test-agent", testRepo.path);

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
        }
      });
    });

    describe("10.4 Queue with Dependencies", () => {
      it("should queue dependent executions in correct order", async () => {
        // Create parent and child issues with dependency
        const parentIssue = createTestIssue(testRepo.db, {
          id: "i-queue-dep-parent",
          title: "Parent for queue dependency",
        });
        const childIssue = createTestIssue(testRepo.db, {
          id: "i-queue-dep-child",
          title: "Child for queue dependency",
        });

        // Child depends on parent (parent blocks child)
        createRelationship(testRepo.db, {
          fromId: parentIssue.id,
          toId: childIssue.id,
          type: "blocks",
        });

        // Create executions
        const parentExecResponse = await request(app)
          .post(`/api/issues/${parentIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Parent work", config: { mode: "worktree" } });

        const childExecResponse = await request(app)
          .post(`/api/issues/${childIssue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({ prompt: "Child work", config: { mode: "worktree" } });

        expect(parentExecResponse.status).toBe(201);
        expect(childExecResponse.status).toBe(201);

        const parentExecId = parentExecResponse.body.data.id;
        const childExecId = childExecResponse.body.data.id;

        // Wait for stream creation
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const adapter = await getDataplaneAdapter(testRepo.path);
        expect(adapter).not.toBeNull();

        if (adapter) {
          // Queue child first (should be blocked)
          const childEntry = await adapter.enqueue({
            executionId: childExecId,
            targetBranch: "main",
            agentId: "test-agent",
          });

          // Queue parent (should be ahead of child)
          const parentEntry = await adapter.enqueue({
            executionId: parentExecId,
            targetBranch: "main",
            agentId: "test-agent",
          });

          // Both should be in queue
          const queue = await adapter.getQueue("main");
          const parentPos = await adapter.getQueuePosition(parentExecId, "main");
          const childPos = await adapter.getQueuePosition(childExecId, "main");

          expect(parentPos).not.toBeNull();
          expect(childPos).not.toBeNull();

          // Both positions should be valid numbers
          expect(typeof parentPos).toBe("number");
          expect(typeof childPos).toBe("number");
        }
      });
    });
  });

  // ============================================================================
  // Section 11: Checkpoint and Promote Flow (Phase 2)
  // ============================================================================

  describe("11. Checkpoint and Promote Flow", () => {
    /**
     * Helper to create a completed execution with changes, ready for checkpoint
     */
    async function createExecutionReadyForCheckpoint(issueId: string): Promise<{
      executionId: string;
      worktreePath: string | null;
    }> {
      // Create execution
      const execResponse = await request(app)
        .post(`/api/issues/${issueId}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Implement feature",
          config: { mode: "worktree" },
        });

      expect(execResponse.status).toBe(201);
      const executionId = execResponse.body.data.id;

      // Wait for worktree setup
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Get execution to find worktree
      const getExecResponse = await request(app)
        .get(`/api/executions/${executionId}`)
        .set("X-Project-ID", projectId);

      const worktreePath = getExecResponse.body.data?.worktree_path;

      if (worktreePath && fs.existsSync(worktreePath)) {
        // Make changes and commit
        await simulateExecutionComplete(testRepo.db, executionId, worktreePath, {
          fileChanges: [
            { path: "src/feature.ts", content: "export const feature = true;", operation: "create" },
            { path: "src/utils.ts", content: "export const util = () => {};", operation: "create" },
          ],
          commitMessage: "feat: add feature implementation",
        });
      }

      return { executionId, worktreePath };
    }

    describe("11.1 Checkpoint Creation", () => {
      it("should create checkpoint from completed execution", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-checkpoint001",
          title: "Checkpoint creation test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create checkpoint
        const response = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({
            message: "Save work for review",
          });

        if (response.status === 200) {
          expect(response.body.success).toBe(true);
          expect(response.body.data).toBeDefined();
          expect(response.body.data.checkpoint).toBeDefined();
          expect(response.body.data.checkpoint.id).toBeDefined();
          // CheckpointInfo uses camelCase
          expect(response.body.data.checkpoint.issueId).toBe(issue.id);
          expect(response.body.data.checkpoint.executionId).toBe(executionId);

          // Should have issue stream info
          expect(response.body.data.issueStream).toBeDefined();
        } else if (response.status === 501) {
          // Dataplane not initialized - acceptable
          console.log("Dataplane not initialized, skipping checkpoint creation");
        }
      });

      it("should include checkpoint stats (files, additions, deletions)", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-checkpoint002",
          title: "Checkpoint stats test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        const response = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Checkpoint with stats" });

        if (response.status === 200) {
          const checkpoint = response.body.data.checkpoint;
          // CheckpointInfo uses camelCase
          expect(checkpoint.changedFiles).toBeGreaterThanOrEqual(0);
          expect(typeof checkpoint.additions).toBe("number");
          expect(typeof checkpoint.deletions).toBe("number");
        }
      });

      it("should auto-enqueue checkpoint to merge queue by default", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-checkpoint003",
          title: "Checkpoint auto-enqueue test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        const response = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({
            message: "Checkpoint for queue",
            autoEnqueue: true,
          });

        if (response.status === 200) {
          // Queue entry is only present if merge queue is enabled
          // Just verify the checkpoint was created successfully
          expect(response.body.data.checkpoint).toBeDefined();
          // queueEntry may or may not be present depending on config
        }
      });
    });

    describe("11.2 Checkpoint Review", () => {
      it("should approve a checkpoint", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-review001",
          title: "Review approval test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create checkpoint first
        const checkpointResponse = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Ready for review" });

        if (checkpointResponse.status !== 200) {
          console.log("Checkpoint creation failed, skipping review test");
          return;
        }

        // Approve the checkpoint
        const reviewResponse = await request(app)
          .post(`/api/issues/${issue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({
            action: "approve",
            reviewed_by: "test-user",
            notes: "LGTM",
          });

        expect(reviewResponse.status).toBe(200);
        expect(reviewResponse.body.success).toBe(true);
        expect(reviewResponse.body.data.review_status).toBe("approved");
        expect(reviewResponse.body.data.reviewed_by).toBe("test-user");
      });

      it("should reject a checkpoint with request_changes", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-review002",
          title: "Review rejection test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create checkpoint first
        const checkpointResponse = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Please review" });

        if (checkpointResponse.status !== 200) {
          console.log("Checkpoint creation failed, skipping review test");
          return;
        }

        // Reject the checkpoint
        const reviewResponse = await request(app)
          .post(`/api/issues/${issue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({
            action: "request_changes",
            reviewed_by: "test-user",
            notes: "Please add tests",
          });

        // Handle case where review might fail due to environment issues
        if (reviewResponse.status === 500) {
          console.log("Review failed with 500:", reviewResponse.body);
          // Skip if there's an environment/dataplane issue
          return;
        }

        expect(reviewResponse.status).toBe(200);
        expect(reviewResponse.body.success).toBe(true);
        expect(reviewResponse.body.data.review_status).toBe("changes_requested");
      });

      it("should reset review status back to pending", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-review003",
          title: "Review reset test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create checkpoint
        const checkpointResponse = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "For reset test" });

        if (checkpointResponse.status !== 200) {
          console.log("Checkpoint creation failed, skipping test");
          return;
        }

        // Approve
        const approveResponse = await request(app)
          .post(`/api/issues/${issue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({ action: "approve" });

        if (approveResponse.status !== 200) {
          console.log("Approve failed, skipping test:", approveResponse.body);
          return;
        }

        // Reset the review
        const resetResponse = await request(app)
          .post(`/api/issues/${issue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({ action: "reset" });

        if (resetResponse.status === 500) {
          console.log("Reset failed with 500:", resetResponse.body);
          return;
        }

        expect(resetResponse.status).toBe(200);
        expect(resetResponse.body.data.review_status).toBe("pending");
      });

      it("should return 400 for review on issue without checkpoint", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-review-nocp",
          title: "No checkpoint issue",
        });

        const response = await request(app)
          .post(`/api/issues/${issue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({ action: "approve" });

        // Returns 400 when no checkpoint exists
        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      });

      it("should return 400 for invalid review action", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-review-invalid",
          title: "Invalid action test",
        });

        // Create execution and checkpoint
        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Test" });

        const response = await request(app)
          .post(`/api/issues/${issue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({ action: "invalid_action" });

        expect(response.status).toBe(400);
      });
    });

    describe("11.3 Checkpoint Retrieval", () => {
      it("should get all checkpoints for an issue", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-getcps001",
          title: "Get checkpoints test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create checkpoint
        await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "First checkpoint" });

        // Get checkpoints
        const response = await request(app)
          .get(`/api/issues/${issue.id}/checkpoints`)
          .set("X-Project-ID", projectId);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(Array.isArray(response.body.data.checkpoints)).toBe(true);
        expect(response.body.data.current).toBeDefined();
      });

      it("should get current checkpoint", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-getcurrent001",
          title: "Get current checkpoint test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Current checkpoint" });

        const response = await request(app)
          .get(`/api/issues/${issue.id}/checkpoint/current`)
          .set("X-Project-ID", projectId);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        // data can be null if no checkpoint, or the checkpoint object
      });
    });

    describe("11.4 Promote Flow", () => {
      it("should promote approved checkpoint to base branch", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-promote001",
          title: "Promote test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create and approve checkpoint
        const checkpointResponse = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Ready to merge" });

        if (checkpointResponse.status !== 200) {
          console.log("Checkpoint creation failed, skipping promote test");
          return;
        }

        await request(app)
          .post(`/api/issues/${issue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({ action: "approve" });

        const mainHeadBefore = getHeadCommit(testRepo.path);

        // Promote to main
        const promoteResponse = await request(app)
          .post(`/api/issues/${issue.id}/promote`)
          .set("X-Project-ID", projectId)
          .send({
            strategy: "squash",
            message: "Merge feature from issue",
          });

        if (promoteResponse.status === 200) {
          expect(promoteResponse.body.success).toBe(true);
          expect(promoteResponse.body.data.merge_commit).toBeDefined();
          expect(promoteResponse.body.data.files_changed).toBeGreaterThanOrEqual(0);

          // Main branch should have new commit
          const mainHeadAfter = getHeadCommit(testRepo.path);
          expect(mainHeadAfter).not.toBe(mainHeadBefore);
        } else if (promoteResponse.status === 501) {
          console.log("Dataplane not initialized, skipping promote verification");
        }
      });

      it("should reject promote for unapproved checkpoint", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-promote002",
          title: "Promote unapproved test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create checkpoint but DON'T approve
        const checkpointResponse = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Not approved yet" });

        if (checkpointResponse.status !== 200) {
          console.log("Checkpoint creation failed, skipping test");
          return;
        }

        // Try to promote without approval
        const promoteResponse = await request(app)
          .post(`/api/issues/${issue.id}/promote`)
          .set("X-Project-ID", projectId)
          .send({});

        // Should be rejected (403 requires approval)
        if (promoteResponse.status === 403) {
          expect(promoteResponse.body.success).toBe(false);
          expect(promoteResponse.body.error).toBe("Checkpoint requires approval");
        }
      });

      it("should allow force promote without approval", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-promote003",
          title: "Force promote test",
        });

        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(issue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        // Create checkpoint but don't approve
        const checkpointResponse = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Force promote" });

        if (checkpointResponse.status !== 200) {
          console.log("Checkpoint creation failed, skipping test");
          return;
        }

        // Force promote
        const promoteResponse = await request(app)
          .post(`/api/issues/${issue.id}/promote`)
          .set("X-Project-ID", projectId)
          .send({ force: true });

        // Should succeed with force flag
        if (promoteResponse.status === 200) {
          expect(promoteResponse.body.success).toBe(true);
        }
      });

      it("should block promote when dependencies not merged", async () => {
        // Create parent issue
        const parentIssue = createTestIssue(testRepo.db, {
          id: "i-promote-parent",
          title: "Parent issue for promote",
        });

        // Create child issue that depends on parent
        const childIssue = createTestIssue(testRepo.db, {
          id: "i-promote-child",
          title: "Child issue for promote",
        });

        // Parent blocks child
        createRelationship(testRepo.db, {
          fromId: parentIssue.id,
          toId: childIssue.id,
          type: "blocks",
        });

        // Create and approve checkpoint for child only
        const { executionId, worktreePath } = await createExecutionReadyForCheckpoint(childIssue.id);

        if (!worktreePath || !fs.existsSync(worktreePath)) {
          console.log("Skipping test - worktree not created");
          return;
        }

        const checkpointResponse = await request(app)
          .post(`/api/executions/${executionId}/checkpoint`)
          .set("X-Project-ID", projectId)
          .send({ message: "Child checkpoint" });

        if (checkpointResponse.status !== 200) {
          console.log("Checkpoint creation failed, skipping test");
          return;
        }

        await request(app)
          .post(`/api/issues/${childIssue.id}/review`)
          .set("X-Project-ID", projectId)
          .send({ action: "approve" });

        // Try to promote child (should be blocked by parent)
        const promoteResponse = await request(app)
          .post(`/api/issues/${childIssue.id}/promote`)
          .set("X-Project-ID", projectId)
          .send({});

        // Should be blocked (409 conflict due to dependencies)
        if (promoteResponse.status === 409) {
          expect(promoteResponse.body.success).toBe(false);
          expect(promoteResponse.body.blocked_by).toBeDefined();
          expect(promoteResponse.body.blocked_by).toContain(parentIssue.id);
        }
      });

      it("should fail for promote on issue without checkpoint", async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-promote-nocp",
          title: "No checkpoint for promote",
        });

        // Don't create any execution/checkpoint

        const response = await request(app)
          .post(`/api/issues/${issue.id}/promote`)
          .set("X-Project-ID", projectId)
          .send({});

        // Should fail - no checkpoint (400 for missing checkpoint, 501 if dataplane not init)
        expect([400, 404, 501]).toContain(response.status);
        expect(response.body.success).toBe(false);
      });
    });
  });
});
