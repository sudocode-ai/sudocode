/**
 * Workflow Checkpoint Integration Tests
 *
 * Tests that workflow executions properly create checkpoints when steps complete.
 * This tests the fix for workflow commits being made on workflow branches instead of
 * stream branches - the checkpointSync function should use execution's after_commit
 * as the merge source when the stream branch doesn't have the commits.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
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
  type MockFileChange,
} from "./helpers/mock-agent.js";

// Skip slow tests unless explicitly enabled
const SKIP_SLOW_TESTS = process.env.RUN_SLOW_TESTS !== "true";

// Dataplane imports
import {
  closeAllDataplaneAdapters,
  getDataplaneAdapter,
  type DataplaneAdapter,
} from "../../../src/services/dataplane-adapter.js";
import { clearDataplaneConfigCache } from "../../../src/services/dataplane-config.js";

// Mock WebSocket broadcasts
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
  broadcastVoiceNarration: vi.fn(),
  broadcastIssueChange: vi.fn(),
  broadcastIssueUpdate: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
  },
}));

describe.skipIf(SKIP_SLOW_TESTS)("Workflow Checkpoint Creation", () => {
  let testRepo: TestRepo;
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

    // Get the dataplane adapter
    adapter = await getDataplaneAdapter(testRepo.path, testRepo.db);
  });

  afterEach(async () => {
    testRepo?.cleanup();
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
   * Get checkpoints from checkpoints table
   */
  function getCheckpoints(): Array<{
    id: string;
    issue_id: string;
    execution_id: string;
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
      return [];
    }
  }

  /**
   * Create a git worktree for an execution
   */
  function createWorktree(
    branchName: string,
    worktreePath: string
  ): void {
    // Create the branch first
    execSync(`git branch ${branchName}`, { cwd: testRepo.path, stdio: "pipe" });
    // Create worktree
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    execSync(`git worktree add "${worktreePath}" ${branchName}`, {
      cwd: testRepo.path,
      stdio: "pipe",
    });
  }

  /**
   * Clean up a worktree
   */
  function removeWorktree(worktreePath: string): void {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: testRepo.path,
        stdio: "pipe",
      });
    } catch {
      // Ignore errors during cleanup
    }
  }

  // ============================================================================
  // Test: Workflow Step Checkpoint Creation
  // ============================================================================

  describe("Workflow step checkpoint creation", () => {
    it("should create checkpoint when execution has commits on a different branch", async () => {
      // This tests the core fix: checkpointSync should use execution.after_commit
      // when the stream branch doesn't have the commits

      // 1. Create issue
      const issue = createTestIssue(testRepo.db, {
        id: "i-wf-cp001",
        title: "Workflow step 1",
      });

      // 2. Create worktree for execution
      const workflowBranch = "sudocode/workflow/test-wf/step-1";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-wf-cp001");
      createWorktree(workflowBranch, worktreePath);

      // 3. Get initial commit (before_commit)
      const beforeCommit = getHeadCommit(worktreePath);

      // 4. Create execution stream via dataplane
      expect(adapter).toBeDefined();
      const streamResult = await adapter!.createExecutionStream({
        executionId: "exec-wf-cp001",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-wf-cp001",
      });
      const streamId = streamResult.streamId;

      // 5. Create execution record
      createTestExecution(testRepo.db, {
        id: "exec-wf-cp001",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        target_branch: "main",
        branch_name: workflowBranch,
        worktree_path: worktreePath,
        before_commit: beforeCommit,
        stream_id: streamId,
        workflow_execution_id: "wf-test-001",
      });

      // 6. Make changes and commit in the worktree (simulating agent work)
      const fileChanges: MockFileChange[] = [
        {
          path: "src/step1.ts",
          content: 'export const step1 = "implemented";\n',
          operation: "create",
        },
      ];
      applyMockChanges(worktreePath, fileChanges);
      const afterCommit = commitMockChanges(worktreePath, "feat: implement step 1");

      // 7. Update execution with after_commit
      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(afterCommit, "exec-wf-cp001");

      // Note: The stream branch (stream/<streamId>) does NOT have these commits
      // They are on the workflow branch (sudocode/workflow/test-wf/step-1)
      // This is the scenario we're testing - checkpointSync should use after_commit

      // 8. Call checkpointSync
      const checkpointResult = await adapter!.checkpointSync(
        "exec-wf-cp001",
        testRepo.db,
        {
          worktreePath: worktreePath,
          message: "Checkpoint: step 1 complete",
          targetBranch: "main",
        }
      );

      // 9. Verify checkpoint was created
      expect(checkpointResult.success).toBe(true);
      expect(checkpointResult.checkpoint).toBeDefined();
      expect(checkpointResult.checkpoint!.id).toBeDefined();

      // 10. Verify checkpoint exists in database
      const checkpoints = getCheckpoints();
      const checkpoint = checkpoints.find((cp) => cp.execution_id === "exec-wf-cp001");
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.issue_id).toBe(issue.id);
      expect(checkpoint!.message).toContain("step 1");

      // Cleanup
      removeWorktree(worktreePath);
    });

    it("should handle multiple workflow steps with sequential checkpoints", async () => {
      // Create issues for workflow steps
      const step1Issue = createTestIssue(testRepo.db, {
        id: "i-wf-multi-s1",
        title: "Step 1: Setup",
      });
      const step2Issue = createTestIssue(testRepo.db, {
        id: "i-wf-multi-s2",
        title: "Step 2: Implementation",
      });

      // Create worktree for workflow
      const workflowBranch = "sudocode/workflow/multi-step/main";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-multi-step");
      createWorktree(workflowBranch, worktreePath);

      // === Step 1 ===
      const step1BeforeCommit = getHeadCommit(worktreePath);

      // Create stream for step 1
      const stream1Result = await adapter!.createExecutionStream({
        executionId: "exec-multi-s1",
        issueId: step1Issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-multi-s1",
      });

      // Create execution for step 1
      createTestExecution(testRepo.db, {
        id: "exec-multi-s1",
        issue_id: step1Issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: workflowBranch,
        worktree_path: worktreePath,
        before_commit: step1BeforeCommit,
        stream_id: stream1Result.streamId,
        workflow_execution_id: "wf-multi-001",
      });

      // Make step 1 changes
      applyMockChanges(worktreePath, [
        { path: "src/setup.ts", content: 'export const config = {};\n', operation: "create" },
      ]);
      const step1AfterCommit = commitMockChanges(worktreePath, "feat: setup config");

      // Update execution and checkpoint
      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(step1AfterCommit, "exec-multi-s1");

      const cp1Result = await adapter!.checkpointSync(
        "exec-multi-s1",
        testRepo.db,
        { worktreePath, message: "Checkpoint: setup complete", targetBranch: "main" }
      );
      expect(cp1Result.success).toBe(true);

      // === Step 2 ===
      const step2BeforeCommit = getHeadCommit(worktreePath);

      // Create stream for step 2
      const stream2Result = await adapter!.createExecutionStream({
        executionId: "exec-multi-s2",
        issueId: step2Issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-multi-s2",
      });

      // Create execution for step 2
      createTestExecution(testRepo.db, {
        id: "exec-multi-s2",
        issue_id: step2Issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: workflowBranch,
        worktree_path: worktreePath,
        before_commit: step2BeforeCommit,
        stream_id: stream2Result.streamId,
        workflow_execution_id: "wf-multi-001",
      });

      // Make step 2 changes
      applyMockChanges(worktreePath, [
        { path: "src/impl.ts", content: 'export function main() { return "done"; }\n', operation: "create" },
      ]);
      const step2AfterCommit = commitMockChanges(worktreePath, "feat: implement main");

      // Update execution and checkpoint
      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(step2AfterCommit, "exec-multi-s2");

      const cp2Result = await adapter!.checkpointSync(
        "exec-multi-s2",
        testRepo.db,
        { worktreePath, message: "Checkpoint: implementation complete", targetBranch: "main" }
      );
      expect(cp2Result.success).toBe(true);

      // Verify both checkpoints exist
      const checkpoints = getCheckpoints();
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);

      const cp1 = checkpoints.find((cp) => cp.execution_id === "exec-multi-s1");
      const cp2 = checkpoints.find((cp) => cp.execution_id === "exec-multi-s2");

      expect(cp1).toBeDefined();
      expect(cp2).toBeDefined();
      expect(cp1!.issue_id).toBe(step1Issue.id);
      expect(cp2!.issue_id).toBe(step2Issue.id);

      // Cleanup
      removeWorktree(worktreePath);
    });

    it("should not create checkpoint when there are no changes", async () => {
      // Create issue
      const issue = createTestIssue(testRepo.db, {
        id: "i-wf-nochange",
        title: "No changes step",
      });

      // Create worktree
      const workflowBranch = "sudocode/workflow/nochange/main";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-nochange");
      createWorktree(workflowBranch, worktreePath);

      const beforeCommit = getHeadCommit(worktreePath);

      // Create stream
      const streamResult = await adapter!.createExecutionStream({
        executionId: "exec-nochange",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-nochange",
      });

      // Create execution (no commits made - before_commit === after_commit)
      createTestExecution(testRepo.db, {
        id: "exec-nochange",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "completed",
        branch_name: workflowBranch,
        worktree_path: worktreePath,
        before_commit: beforeCommit,
        after_commit: beforeCommit, // Same as before - no changes
        stream_id: streamResult.streamId,
        workflow_execution_id: "wf-nochange-001",
      });

      // Try to checkpoint
      const checkpointResult = await adapter!.checkpointSync(
        "exec-nochange",
        testRepo.db,
        { worktreePath, message: "Checkpoint: no changes", targetBranch: "main" }
      );

      // Should fail or indicate no changes
      expect(checkpointResult.success).toBe(false);
      expect(checkpointResult.error).toContain("no changes");

      // Cleanup
      removeWorktree(worktreePath);
    });
  });

  // ============================================================================
  // Test: Issue Stream Creation and Reuse
  // ============================================================================

  describe("Issue stream management", () => {
    it("should create issue stream when checkpointing", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-issuestream",
        title: "Test issue stream creation",
      });

      // Create worktree
      const branch = "sudocode/exec-issuestream";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-issuestream");
      createWorktree(branch, worktreePath);

      const beforeCommit = getHeadCommit(worktreePath);

      // Create execution stream
      const streamResult = await adapter!.createExecutionStream({
        executionId: "exec-issuestream",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-issuestream",
      });

      // Create execution
      createTestExecution(testRepo.db, {
        id: "exec-issuestream",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: branch,
        worktree_path: worktreePath,
        before_commit: beforeCommit,
        stream_id: streamResult.streamId,
      });

      // Make changes
      applyMockChanges(worktreePath, [
        { path: "src/test.ts", content: 'export const test = true;\n', operation: "create" },
      ]);
      const afterCommit = commitMockChanges(worktreePath, "feat: add test");

      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(afterCommit, "exec-issuestream");

      // Checkpoint - this should create the issue stream
      const checkpointResult = await adapter!.checkpointSync(
        "exec-issuestream",
        testRepo.db,
        { worktreePath, message: "Checkpoint: test", targetBranch: "main" }
      );

      expect(checkpointResult.success).toBe(true);
      expect(checkpointResult.issueStream).toBeDefined();
      expect(checkpointResult.issueStream!.id).toBeTruthy();

      // Verify issue stream was created in dp_streams
      const streams = getStreams();
      const issueStream = streams.find((s) => {
        try {
          const meta = JSON.parse(s.metadata);
          return meta?.sudocode?.issue_id === issue.id && meta?.sudocode?.type === "issue";
        } catch {
          return false;
        }
      });
      expect(issueStream).toBeDefined();

      // Cleanup
      removeWorktree(worktreePath);
    });

    it("should reuse existing issue stream for multiple executions", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-reuse",
        title: "Reuse issue stream",
      });

      // === First execution ===
      const branch1 = "sudocode/exec-reuse-1";
      const worktree1 = path.join(testRepo.worktreesPath, "exec-reuse-1");
      createWorktree(branch1, worktree1);

      const before1 = getHeadCommit(worktree1);
      const stream1Result = await adapter!.createExecutionStream({
        executionId: "exec-reuse-1",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-reuse-1",
      });

      createTestExecution(testRepo.db, {
        id: "exec-reuse-1",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: branch1,
        worktree_path: worktree1,
        before_commit: before1,
        stream_id: stream1Result.streamId,
      });

      applyMockChanges(worktree1, [
        { path: "src/v1.ts", content: 'export const v = 1;\n', operation: "create" },
      ]);
      const after1 = commitMockChanges(worktree1, "feat: v1");
      testRepo.db.prepare(`UPDATE executions SET after_commit = ? WHERE id = ?`).run(after1, "exec-reuse-1");

      const cp1Result = await adapter!.checkpointSync("exec-reuse-1", testRepo.db, {
        worktreePath: worktree1,
        message: "Checkpoint: v1",
        targetBranch: "main",
      });
      expect(cp1Result.success).toBe(true);
      const issueStreamId = cp1Result.issueStream!.id;

      // Clean up first worktree
      removeWorktree(worktree1);

      // === Second execution ===
      const branch2 = "sudocode/exec-reuse-2";
      const worktree2 = path.join(testRepo.worktreesPath, "exec-reuse-2");
      createWorktree(branch2, worktree2);

      const before2 = getHeadCommit(worktree2);
      const stream2Result = await adapter!.createExecutionStream({
        executionId: "exec-reuse-2",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-reuse-2",
      });

      createTestExecution(testRepo.db, {
        id: "exec-reuse-2",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: branch2,
        worktree_path: worktree2,
        before_commit: before2,
        stream_id: stream2Result.streamId,
      });

      applyMockChanges(worktree2, [
        { path: "src/v2.ts", content: 'export const v = 2;\n', operation: "create" },
      ]);
      const after2 = commitMockChanges(worktree2, "feat: v2");
      testRepo.db.prepare(`UPDATE executions SET after_commit = ? WHERE id = ?`).run(after2, "exec-reuse-2");

      const cp2Result = await adapter!.checkpointSync("exec-reuse-2", testRepo.db, {
        worktreePath: worktree2,
        message: "Checkpoint: v2",
        targetBranch: "main",
      });
      expect(cp2Result.success).toBe(true);

      // Should reuse the same issue stream
      expect(cp2Result.issueStream!.id).toBe(issueStreamId);
      // Note: The 'created' flag uses a 1-second threshold which can be unreliable
      // in fast tests. The important thing is that the stream ID is the same.

      // Both checkpoints should reference the same issue stream
      const checkpoints = getCheckpoints();
      const issueCps = checkpoints.filter((cp) => cp.issue_id === issue.id);
      expect(issueCps.length).toBe(2);
      expect(issueCps[0].stream_id).toBe(issueStreamId);
      expect(issueCps[1].stream_id).toBe(issueStreamId);

      // Cleanup
      removeWorktree(worktree2);
    });
  });

  // ============================================================================
  // Test: Issue/Spec Snapshot Capture
  // ============================================================================

  describe("Snapshot capture", () => {
    /**
     * Helper to write JSONL files
     */
    function writeJSONL(
      basePath: string,
      relativePath: string,
      entities: any[]
    ): void {
      const fullDir = path.dirname(path.join(basePath, relativePath));
      fs.mkdirSync(fullDir, { recursive: true });
      fs.writeFileSync(
        path.join(basePath, relativePath),
        entities.map((e) => JSON.stringify(e)).join("\n") + "\n"
      );
    }

    /**
     * Create an issue JSONL entry
     */
    function createIssueJSONL(id: string, title: string, status: string = "open") {
      return {
        id,
        uuid: `uuid-${id}-${Date.now()}`,
        title,
        status,
        content: `Content for ${title}`,
        priority: 1,
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        file_path: `.sudocode/issues/${id}.md`,
        tags: [],
        relationships: [],
        feedback: [],
      };
    }

    /**
     * Create a spec JSONL entry
     */
    function createSpecJSONL(id: string, title: string) {
      return {
        id,
        uuid: `uuid-${id}-${Date.now()}`,
        title,
        content: `Content for ${title}`,
        priority: 1,
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        file_path: `.sudocode/specs/${id}.md`,
        tags: [],
        relationships: [],
      };
    }

    /**
     * Get checkpoints with snapshot data
     */
    function getCheckpointsWithSnapshots(): Array<{
      id: string;
      issue_id: string;
      execution_id: string;
      issue_snapshot: string | null;
      spec_snapshot: string | null;
    }> {
      try {
        return testRepo.db
          .prepare("SELECT id, issue_id, execution_id, issue_snapshot, spec_snapshot FROM checkpoints")
          .all() as any[];
      } catch {
        return [];
      }
    }

    it("should capture snapshot when JSONL issues change", async () => {
      // 1. Create baseline JSONL with one issue
      const baselineIssue = createIssueJSONL("i-snap-base", "Baseline Issue");
      writeJSONL(testRepo.path, ".sudocode/issues/issues.jsonl", [baselineIssue]);
      writeJSONL(testRepo.path, ".sudocode/specs/specs.jsonl", []);

      // Commit baseline
      execSync("git add .", { cwd: testRepo.path, stdio: "pipe" });
      execSync('git commit -m "Add baseline JSONL"', { cwd: testRepo.path, stdio: "pipe" });

      // 2. Create issue in database
      const issue = createTestIssue(testRepo.db, {
        id: "i-snap-test",
        title: "Snapshot test issue",
      });

      // 3. Create worktree
      const branch = "sudocode/snap-test";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-snap-test");
      createWorktree(branch, worktreePath);

      const beforeCommit = getHeadCommit(worktreePath);

      // 4. Create execution stream
      const streamResult = await adapter!.createExecutionStream({
        executionId: "exec-snap-test",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-snap-test",
      });

      // 5. Create execution
      createTestExecution(testRepo.db, {
        id: "exec-snap-test",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: branch,
        worktree_path: worktreePath,
        before_commit: beforeCommit,
        stream_id: streamResult.streamId,
      });

      // 6. Make JSONL changes in worktree (create new issue, modify existing)
      const modifiedIssue = { ...baselineIssue, title: "Modified Baseline Issue" };
      const newIssue = createIssueJSONL("i-snap-new", "New Issue");
      writeJSONL(worktreePath, ".sudocode/issues/issues.jsonl", [modifiedIssue, newIssue]);

      // 7. Also make a code change and commit
      fs.writeFileSync(path.join(worktreePath, "src", "snap-test.ts"), 'export const snap = "test";\n');
      execSync("git add .", { cwd: worktreePath, stdio: "pipe" });
      const afterCommit = execSync('git commit -m "feat: snapshot test changes"', {
        cwd: worktreePath,
        encoding: "utf-8",
      });
      const commitHash = getHeadCommit(worktreePath);

      // 8. Update execution
      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(commitHash, "exec-snap-test");

      // 9. Checkpoint
      const checkpointResult = await adapter!.checkpointSync(
        "exec-snap-test",
        testRepo.db,
        { worktreePath, message: "Checkpoint: snapshot test", targetBranch: "main" }
      );

      expect(checkpointResult.success).toBe(true);

      // 10. Verify snapshot was captured
      const checkpoints = getCheckpointsWithSnapshots();
      const checkpoint = checkpoints.find((cp) => cp.execution_id === "exec-snap-test");

      expect(checkpoint).toBeDefined();
      expect(checkpoint!.issue_snapshot).toBeTruthy();

      // Parse and verify snapshot contents
      const issueSnapshot = JSON.parse(checkpoint!.issue_snapshot!);
      expect(issueSnapshot.length).toBe(2); // modified + created

      const modified = issueSnapshot.find((c: any) => c.id === "i-snap-base");
      const created = issueSnapshot.find((c: any) => c.id === "i-snap-new");

      expect(modified?.changeType).toBe("modified");
      expect(modified?.changedFields).toContain("title");
      expect(created?.changeType).toBe("created");

      // Cleanup
      removeWorktree(worktreePath);
    });

    it("should capture empty snapshot when no JSONL changes", async () => {
      // 1. Create baseline JSONL
      const baselineIssue = createIssueJSONL("i-nochange", "No Change Issue");
      writeJSONL(testRepo.path, ".sudocode/issues/issues.jsonl", [baselineIssue]);

      // Commit baseline
      execSync("git add .", { cwd: testRepo.path, stdio: "pipe" });
      execSync('git commit -m "Add baseline for no-change test"', { cwd: testRepo.path, stdio: "pipe" });

      // 2. Create issue in database
      const issue = createTestIssue(testRepo.db, {
        id: "i-nochange-db",
        title: "No change test issue",
      });

      // 3. Create worktree
      const branch = "sudocode/nochange-test";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-nochange-test");
      createWorktree(branch, worktreePath);

      const beforeCommit = getHeadCommit(worktreePath);

      // 4. Create stream and execution
      const streamResult = await adapter!.createExecutionStream({
        executionId: "exec-nochange-test",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-nochange-test",
      });

      createTestExecution(testRepo.db, {
        id: "exec-nochange-test",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: branch,
        worktree_path: worktreePath,
        before_commit: beforeCommit,
        stream_id: streamResult.streamId,
      });

      // 5. Make ONLY code changes (no JSONL changes)
      fs.writeFileSync(path.join(worktreePath, "src", "code-only.ts"), 'export const code = "only";\n');
      execSync("git add .", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "feat: code only changes"', { cwd: worktreePath, stdio: "pipe" });
      const commitHash = getHeadCommit(worktreePath);

      // 6. Update execution and checkpoint
      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(commitHash, "exec-nochange-test");

      const checkpointResult = await adapter!.checkpointSync(
        "exec-nochange-test",
        testRepo.db,
        { worktreePath, message: "Checkpoint: code only", targetBranch: "main" }
      );

      expect(checkpointResult.success).toBe(true);

      // 7. Verify snapshot is null (no JSONL changes)
      const checkpoints = getCheckpointsWithSnapshots();
      const checkpoint = checkpoints.find((cp) => cp.execution_id === "exec-nochange-test");

      expect(checkpoint).toBeDefined();
      // No JSONL changes = null snapshots
      expect(checkpoint!.issue_snapshot).toBeNull();
      expect(checkpoint!.spec_snapshot).toBeNull();

      // Cleanup
      removeWorktree(worktreePath);
    });

    it("should capture spec changes in snapshot", async () => {
      // 1. Create baseline JSONL
      writeJSONL(testRepo.path, ".sudocode/issues/issues.jsonl", []);
      writeJSONL(testRepo.path, ".sudocode/specs/specs.jsonl", []);

      // Commit baseline
      execSync("git add .", { cwd: testRepo.path, stdio: "pipe" });
      execSync('git commit -m "Empty baseline for spec test"', { cwd: testRepo.path, stdio: "pipe" });

      // 2. Create issue in database
      const issue = createTestIssue(testRepo.db, {
        id: "i-spec-snap",
        title: "Spec snapshot test",
      });

      // 3. Create worktree
      const branch = "sudocode/spec-snap-test";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-spec-snap");
      createWorktree(branch, worktreePath);

      const beforeCommit = getHeadCommit(worktreePath);

      // 4. Create stream and execution
      const streamResult = await adapter!.createExecutionStream({
        executionId: "exec-spec-snap",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-spec-snap",
      });

      createTestExecution(testRepo.db, {
        id: "exec-spec-snap",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: branch,
        worktree_path: worktreePath,
        before_commit: beforeCommit,
        stream_id: streamResult.streamId,
      });

      // 5. Create a new spec in JSONL
      const newSpec = createSpecJSONL("s-new-spec", "New Spec");
      writeJSONL(worktreePath, ".sudocode/specs/specs.jsonl", [newSpec]);

      // Make code change and commit
      fs.writeFileSync(path.join(worktreePath, "src", "spec-test.ts"), 'export const spec = "test";\n');
      execSync("git add .", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "feat: add spec"', { cwd: worktreePath, stdio: "pipe" });
      const commitHash = getHeadCommit(worktreePath);

      // 6. Update execution and checkpoint
      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(commitHash, "exec-spec-snap");

      const checkpointResult = await adapter!.checkpointSync(
        "exec-spec-snap",
        testRepo.db,
        { worktreePath, message: "Checkpoint: spec change", targetBranch: "main" }
      );

      expect(checkpointResult.success).toBe(true);

      // 7. Verify spec snapshot was captured
      const checkpoints = getCheckpointsWithSnapshots();
      const checkpoint = checkpoints.find((cp) => cp.execution_id === "exec-spec-snap");

      expect(checkpoint).toBeDefined();
      expect(checkpoint!.spec_snapshot).toBeTruthy();

      const specSnapshot = JSON.parse(checkpoint!.spec_snapshot!);
      expect(specSnapshot.length).toBe(1);
      expect(specSnapshot[0].changeType).toBe("created");
      expect(specSnapshot[0].id).toBe("s-new-spec");

      // Cleanup
      removeWorktree(worktreePath);
    });

    it("should capture deleted entities in snapshot", async () => {
      // 1. Create baseline JSONL with an issue
      const issueToDelete = createIssueJSONL("i-to-delete", "Issue to be deleted");
      writeJSONL(testRepo.path, ".sudocode/issues/issues.jsonl", [issueToDelete]);

      // Commit baseline
      execSync("git add .", { cwd: testRepo.path, stdio: "pipe" });
      execSync('git commit -m "Add issue to delete"', { cwd: testRepo.path, stdio: "pipe" });

      // 2. Create issue in database
      const issue = createTestIssue(testRepo.db, {
        id: "i-delete-test",
        title: "Delete test issue",
      });

      // 3. Create worktree
      const branch = "sudocode/delete-test";
      const worktreePath = path.join(testRepo.worktreesPath, "exec-delete-test");
      createWorktree(branch, worktreePath);

      const beforeCommit = getHeadCommit(worktreePath);

      // 4. Create stream and execution
      const streamResult = await adapter!.createExecutionStream({
        executionId: "exec-delete-test",
        issueId: issue.id,
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "exec-delete-test",
      });

      createTestExecution(testRepo.db, {
        id: "exec-delete-test",
        issue_id: issue.id,
        agent_type: "claude-code",
        mode: "worktree",
        status: "running",
        branch_name: branch,
        worktree_path: worktreePath,
        before_commit: beforeCommit,
        stream_id: streamResult.streamId,
      });

      // 5. Delete the issue from JSONL (write empty)
      writeJSONL(worktreePath, ".sudocode/issues/issues.jsonl", []);

      // Make code change and commit
      fs.writeFileSync(path.join(worktreePath, "src", "delete-test.ts"), 'export const deleted = true;\n');
      execSync("git add .", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "feat: delete issue"', { cwd: worktreePath, stdio: "pipe" });
      const commitHash = getHeadCommit(worktreePath);

      // 6. Update execution and checkpoint
      testRepo.db
        .prepare(`UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`)
        .run(commitHash, "exec-delete-test");

      const checkpointResult = await adapter!.checkpointSync(
        "exec-delete-test",
        testRepo.db,
        { worktreePath, message: "Checkpoint: delete issue", targetBranch: "main" }
      );

      expect(checkpointResult.success).toBe(true);

      // 7. Verify snapshot captures deletion
      const checkpoints = getCheckpointsWithSnapshots();
      const checkpoint = checkpoints.find((cp) => cp.execution_id === "exec-delete-test");

      expect(checkpoint).toBeDefined();
      expect(checkpoint!.issue_snapshot).toBeTruthy();

      const issueSnapshot = JSON.parse(checkpoint!.issue_snapshot!);
      expect(issueSnapshot.length).toBe(1);
      expect(issueSnapshot[0].changeType).toBe("deleted");
      expect(issueSnapshot[0].id).toBe("i-to-delete");

      // Cleanup
      removeWorktree(worktreePath);
    });
  });
});
