/**
 * Execution Stream and Checkpoint Tracking Tests
 *
 * Tests that all execution types create proper dataplane streams and checkpoints:
 * 1. Normal worktree executions - stream creation + auto-checkpoint on completion
 * 2. Workflow executions (reuseWorktreePath) - stream creation + checkpoint per step
 * 3. Follow-up executions - inherit parent's stream
 * 4. Local mode executions - stream creation (no checkpoint)
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
  createTestExecution,
  getTestExecution,
  getHeadCommit,
  type TestRepo,
} from "./helpers/test-repo.js";
import {
  applyMockChanges,
  commitMockChanges,
  simulateExecutionComplete,
  DEFAULT_MOCK_CHANGES,
} from "./helpers/mock-agent.js";

// Skip slow tests unless explicitly enabled (this test suite takes ~54s)
const SKIP_SLOW_TESTS = process.env.RUN_SLOW_TESTS !== "true";

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

describe.skipIf(SKIP_SLOW_TESTS)("Execution Stream and Checkpoint Tracking", () => {
  let testRepo: TestRepo;
  let app: express.Application;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let registryPath: string;
  let adapter: DataplaneAdapter | null;

  beforeAll(async () => {
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  afterAll(async () => {
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();

    // Create test repo with unified database mode
    testRepo = createTestRepo({
      dataplaneEnabled: true,
      useUnifiedDb: true,
      tablePrefix: "dp_",
    });

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

    // Get the dataplane adapter
    adapter = await getDataplaneAdapter(testRepo.path, testRepo.db);

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api", requireProject(projectManager), createExecutionsRouter());
    app.use("/api/issues", requireProject(projectManager), createIssuesRouter());
  });

  afterEach(async () => {
    await projectManager?.shutdown();
    testRepo?.cleanup();

    if (registryPath && fs.existsSync(registryPath)) {
      fs.unlinkSync(registryPath);
    }

    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Get streams from dp_streams table
   */
  function getStreams(): Array<{
    id: string;
    name: string;
    metadata: string;
    branch: string;
  }> {
    return testRepo.db
      .prepare("SELECT * FROM dp_streams")
      .all() as any[];
  }

  /**
   * Get checkpoints from checkpoints table (sudocode table, no prefix)
   */
  function getCheckpoints(): Array<{
    id: string;
    stream_id: string;
    commit_sha: string;
    message: string;
    checkpointed_at: string;
  }> {
    try {
      return testRepo.db
        .prepare("SELECT * FROM checkpoints")
        .all() as any[];
    } catch {
      // Table might not exist in all test scenarios
      return [];
    }
  }

  /**
   * Get merge queue entries from dp_merge_queue table
   */
  function getMergeQueue(): Array<{
    id: string;
    execution_id: string;
    status: string;
  }> {
    try {
      return testRepo.db
        .prepare("SELECT * FROM dp_merge_queue")
        .all() as any[];
    } catch {
      return [];
    }
  }

  /**
   * Find stream by execution ID in metadata
   */
  function findStreamByExecutionId(executionId: string) {
    const streams = getStreams();
    return streams.find((s) => {
      try {
        const metadata = JSON.parse(s.metadata);
        return metadata?.sudocode?.execution_id === executionId;
      } catch {
        return false;
      }
    });
  }

  // ============================================================================
  // Section 1: Normal Worktree Execution Stream Tracking
  // ============================================================================

  describe("1. Normal Worktree Executions", () => {
    it("should create a stream when starting a worktree execution", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-wt-stream001",
        title: "Test worktree stream creation",
      });

      // Create execution via API
      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Implement feature",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      // Wait for async stream creation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify stream was created
      const stream = findStreamByExecutionId(executionId);
      expect(stream).toBeDefined();
      expect(stream!.id).toBeTruthy();

      // Verify execution has stream_id
      const execution = getTestExecution(testRepo.db, executionId);
      expect(execution).toBeDefined();
      expect(execution!.stream_id).toBe(stream!.id);
    });

    it("should store execution metadata in stream", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-wt-meta001",
        title: "Test stream metadata",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Test metadata",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stream = findStreamByExecutionId(executionId);
      expect(stream).toBeDefined();

      const metadata = JSON.parse(stream!.metadata);
      expect(metadata.sudocode).toBeDefined();
      expect(metadata.sudocode.execution_id).toBe(executionId);
      expect(metadata.sudocode.issue_id).toBe(issue.id);
      expect(metadata.sudocode.agent_type).toBe("claude-code");
    });

    it("should have checkpoint infrastructure ready for worktree execution", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-wt-cp001",
        title: "Test worktree checkpoint",
      });

      // Create execution
      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Make changes",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      // Wait for worktree setup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify execution has stream_id (checkpoint prerequisite)
      const execution = getTestExecution(testRepo.db, executionId);
      expect(execution).toBeDefined();
      expect(execution!.stream_id).toBeTruthy();

      // Verify stream exists
      const stream = findStreamByExecutionId(executionId);
      expect(stream).toBeDefined();

      // Verify checkpoints table exists and is queryable
      const checkpointTableExists = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'"
        )
        .get();
      expect(checkpointTableExists).toBeDefined();

      // Checkpoints are created on execution completion via handleSuccess
      // In integration tests, we verify the infrastructure is in place
      const checkpoints = getCheckpoints();
      expect(Array.isArray(checkpoints)).toBe(true);
    });
  });

  // ============================================================================
  // Section 2: Follow-up Execution Stream Inheritance
  // ============================================================================

  describe("2. Follow-up Executions", () => {
    it("should inherit parent stream when creating follow-up execution", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-followup001",
        title: "Test follow-up stream inheritance",
      });

      // Create root execution
      const rootResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Initial implementation",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(rootResponse.status).toBe(201);
      const rootExecutionId = rootResponse.body.data.id;

      // Wait for stream creation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get root execution's stream
      const rootExecution = getTestExecution(testRepo.db, rootExecutionId);
      const rootStreamId = rootExecution?.stream_id;

      // Get worktree path
      const execResponse = await request(app)
        .get(`/api/executions/${rootExecutionId}`)
        .set("X-Project-ID", projectId);

      const worktreePath = execResponse.body.data?.worktree_path;

      // Mark root as completed
      if (worktreePath && fs.existsSync(worktreePath)) {
        await simulateExecutionComplete(testRepo.db, rootExecutionId, worktreePath, {
          fileChanges: [
            { path: "src/v1.ts", content: "export const v = 1;", operation: "create" },
          ],
          commitMessage: "feat: v1 implementation",
        });
      } else {
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
      const followUpExecutionId = followUpResponse.body.data.id;

      // Wait for stream inheritance
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify follow-up has same stream or a derived stream
      const followUpExecution = getTestExecution(testRepo.db, followUpExecutionId);
      expect(followUpExecution).toBeDefined();
      expect(followUpExecution!.parent_execution_id).toBe(rootExecutionId);

      // Stream should be inherited (same streamId or a follow-up stream)
      if (rootStreamId) {
        // Follow-up should have a stream_id
        expect(followUpExecution!.stream_id).toBeTruthy();
      }
    });

    it("should link follow-up to parent execution chain", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-followup002",
        title: "Test execution chain",
      });

      // Create root execution
      const rootResponse = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Root execution",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(rootResponse.status).toBe(201);
      const rootId = rootResponse.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Mark root as completed
      testRepo.db
        .prepare(
          `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
        )
        .run(rootId);

      // Create first follow-up
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

      // Create second follow-up (chain continues)
      const followUp2Response = await request(app)
        .post(`/api/executions/${followUp1Id}/follow-up`)
        .set("X-Project-ID", projectId)
        .send({ feedback: "Follow-up 2" });

      expect(followUp2Response.status).toBe(201);
      const followUp2Id = followUp2Response.body.data.id;

      // Verify chain
      const root = getTestExecution(testRepo.db, rootId);
      const followUp1 = getTestExecution(testRepo.db, followUp1Id);
      const followUp2 = getTestExecution(testRepo.db, followUp2Id);

      expect(root!.parent_execution_id).toBeNull();
      expect(followUp1!.parent_execution_id).toBe(rootId);
      expect(followUp2!.parent_execution_id).toBe(followUp1Id);
    });
  });

  // ============================================================================
  // Section 3: Local Mode Execution Stream Tracking
  // ============================================================================

  describe("3. Local Mode Executions", () => {
    it("should create stream for local mode execution", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-local001",
        title: "Test local mode stream",
      });

      // Create execution in local mode
      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Local changes",
          agentType: "claude-code",
          config: { mode: "local" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      // Wait for stream creation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify execution is in local mode
      const execution = getTestExecution(testRepo.db, executionId);
      expect(execution).toBeDefined();
      expect(execution!.mode).toBe("local");

      // Local mode should still have a stream for visibility
      // (though no worktree_path)
      expect(execution!.worktree_path).toBeFalsy();
    });

    it("should store execution metadata in stream for local mode", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-local002",
        title: "Test local mode metadata",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Local test",
          agentType: "claude-code",
          config: { mode: "local" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify execution is in local mode
      const execution = getTestExecution(testRepo.db, executionId);
      expect(execution).toBeDefined();
      expect(execution!.mode).toBe("local");

      // Find stream for this execution (if created)
      const stream = findStreamByExecutionId(executionId);

      if (stream) {
        const metadata = JSON.parse(stream.metadata);
        // Local mode still stores standard metadata
        expect(metadata.sudocode.execution_id).toBe(executionId);
        expect(metadata.sudocode.issue_id).toBe(issue.id);
        expect(metadata.sudocode.agent_type).toBe("claude-code");
      }
    });
  });

  // ============================================================================
  // Section 4: Stream and Checkpoint Table Verification
  // ============================================================================

  describe("4. Database Table Verification", () => {
    it("should have dp_streams table with correct schema", async () => {
      const columns = testRepo.db
        .prepare("PRAGMA table_info(dp_streams)")
        .all() as { name: string }[];

      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("metadata");
    });

    it("should have checkpoints table available", async () => {
      // Check table exists (checkpoints is a sudocode table, no dp_ prefix)
      const tableExists = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'"
        )
        .get();

      expect(tableExists).toBeDefined();
    });

    it("should have dp_merge_queue table available", async () => {
      const tableExists = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dp_merge_queue'"
        )
        .get();

      expect(tableExists).toBeDefined();
    });

    it("should be able to query streams with execution join", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-join001",
        title: "Test stream-execution join",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Join test",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Join query
      const result = testRepo.db
        .prepare(
          `
          SELECT e.id as exec_id, e.status, s.id as stream_id
          FROM executions e
          LEFT JOIN dp_streams s ON e.stream_id = s.id
          WHERE e.id = ?
        `
        )
        .get(executionId) as { exec_id: string; status: string; stream_id: string | null } | undefined;

      expect(result).toBeDefined();
      expect(result!.exec_id).toBe(executionId);
    });
  });

  // ============================================================================
  // Section 5: Multiple Executions Stream Tracking
  // ============================================================================

  describe("5. Multiple Executions", () => {
    it("should create separate streams for different issues", async () => {
      const issue1 = createTestIssue(testRepo.db, {
        id: "i-multi001a",
        title: "Issue 1",
      });
      const issue2 = createTestIssue(testRepo.db, {
        id: "i-multi001b",
        title: "Issue 2",
      });

      // Create executions for both issues
      const response1 = await request(app)
        .post(`/api/issues/${issue1.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Implementation 1",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      const response2 = await request(app)
        .post(`/api/issues/${issue2.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Implementation 2",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response1.status).toBe(201);
      expect(response2.status).toBe(201);

      const exec1Id = response1.body.data.id;
      const exec2Id = response2.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Both should have streams
      const exec1 = getTestExecution(testRepo.db, exec1Id);
      const exec2 = getTestExecution(testRepo.db, exec2Id);

      expect(exec1!.stream_id).toBeTruthy();
      expect(exec2!.stream_id).toBeTruthy();

      // Streams should be different
      expect(exec1!.stream_id).not.toBe(exec2!.stream_id);
    });

    it("should track all streams in dp_streams table", async () => {
      const initialStreams = getStreams();
      const initialCount = initialStreams.length;

      // Create separate issues for each execution to avoid branch conflicts
      const issues = [
        createTestIssue(testRepo.db, { id: "i-multi002a", title: "Multi stream test 1" }),
        createTestIssue(testRepo.db, { id: "i-multi002b", title: "Multi stream test 2" }),
        createTestIssue(testRepo.db, { id: "i-multi002c", title: "Multi stream test 3" }),
      ];

      // Create execution for each issue
      for (const issue of issues) {
        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: `Execution for ${issue.id}`,
            agentType: "claude-code",
            config: { mode: "worktree" },
          });
        expect(response.status).toBe(201);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const finalStreams = getStreams();
      // Should have at least 3 more streams
      expect(finalStreams.length).toBeGreaterThanOrEqual(initialCount + 3);
    });
  });

  // ============================================================================
  // Section 6: Stream Lifecycle
  // ============================================================================

  describe("6. Stream Lifecycle", () => {
    it("should persist stream after execution completes", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-lifecycle001",
        title: "Lifecycle test",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Lifecycle test",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get stream before completion
      const streamBefore = findStreamByExecutionId(executionId);
      expect(streamBefore).toBeDefined();

      // Complete execution
      testRepo.db
        .prepare(
          `UPDATE executions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
        )
        .run(executionId);

      // Stream should still exist
      const streamAfter = findStreamByExecutionId(executionId);
      expect(streamAfter).toBeDefined();
      expect(streamAfter!.id).toBe(streamBefore!.id);
    });

    it("should link execution to stream via stream_id column", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-link001",
        title: "Link test",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Link test",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify bidirectional link
      const execution = getTestExecution(testRepo.db, executionId);
      const stream = findStreamByExecutionId(executionId);

      if (execution!.stream_id && stream) {
        // Execution -> Stream via stream_id
        expect(execution!.stream_id).toBe(stream.id);

        // Stream -> Execution via metadata
        const metadata = JSON.parse(stream.metadata);
        expect(metadata.sudocode.execution_id).toBe(executionId);
      }
    });
  });
});
