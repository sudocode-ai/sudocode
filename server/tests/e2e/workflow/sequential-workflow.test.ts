/**
 * End-to-End Tests for Sequential Workflow Engine
 *
 * These tests verify the full workflow lifecycle using the SequentialWorkflowEngine.
 * Uses mock execution service to avoid AI API calls while testing real workflow logic.
 *
 * Test coverage:
 * - Full lifecycle (create → start → execute all steps → complete)
 * - Pause and resume during execution
 * - Cancel during execution
 * - Dependency handling (topological order, parallel execution)
 * - Failure scenarios (pause, stop, skip_dependents, continue)
 * - Retry and skip operations
 *
 * @group e2e
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

import {
  createTestServer,
  createTestIssues,
  createIssueDependencies,
  type TestServer,
} from "../../integration/workflow/helpers/workflow-test-server.js";
import type { MockExecutionService } from "../../integration/workflow/helpers/mock-executor.js";
import {
  waitFor,
  waitForWorkflowStatus,
  getWorkflow,
} from "../../integration/workflow/helpers/workflow-test-setup.js";

// Skip E2E tests by default (they require more setup time)
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

// =============================================================================
// Test Suite
// =============================================================================

describe.skipIf(SKIP_E2E)("Sequential Workflow E2E", () => {
  let testDir: string;
  let testServer: TestServer;

  beforeAll(async () => {
    // Create temp directory for git repo
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-seq-e2e-"));

    // Initialize as a git repo
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync('git config user.name "Test"', { cwd: testDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: testDir,
      stdio: "pipe",
    });
    fs.writeFileSync(path.join(testDir, ".gitkeep"), "");
    execSync("git add . && git commit -m 'init'", {
      cwd: testDir,
      stdio: "pipe",
    });
  });

  afterAll(() => {
    // Clean up temp directory
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Create fresh server for each test
    testServer = await createTestServer({
      repoPath: testDir,
      engineType: "sequential",
      mockExecutor: true,
      mockExecutorOptions: {
        defaultDelayMs: 0, // Manual control over completions
      },
    });
  });

  afterEach(async () => {
    if (testServer) {
      await testServer.shutdown();
    }
  });

  // ===========================================================================
  // Full Lifecycle Tests
  // ===========================================================================

  describe("Full Lifecycle", () => {
    it(
      "should execute workflow: create -> start -> execute all steps -> complete",
      { timeout: 30000 },
      async () => {
        // 1. Create test issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Setup project structure" },
          { id: "i-2", title: "Implement core feature" },
          { id: "i-3", title: "Add tests" },
        ]);

        // 2. Create workflow via API
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2", "i-3"] },
          { parallelism: "sequential", onFailure: "pause" },
          "E2E Test Workflow"
        );

        expect(workflow.id).toBeDefined();
        expect(workflow.status).toBe("pending");
        expect(workflow.steps).toHaveLength(3);

        // 3. Start workflow
        await testServer.api.startWorkflow(workflow.id);

        // Wait for first step to be running
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.status === "running" && w.steps[0].status === "running";
        }, 5000);

        // 4. Complete each step in order
        const mockExecutor = testServer.executionService as MockExecutionService;

        // Complete step 1
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        const control1 = mockExecutor.getExecutionControl(step1ExecId);
        expect(control1).toBeDefined();
        control1!.complete("Step 1 completed");

        // Wait for step 2 to be running
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[1].status === "running";
        }, 5000);

        // Complete step 2
        const step2ExecId = getWorkflow(testServer.db, workflow.id)!.steps[1]
          .executionId!;
        const control2 = mockExecutor.getExecutionControl(step2ExecId);
        control2!.complete("Step 2 completed");

        // Wait for step 3 to be running
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[2].status === "running";
        }, 5000);

        // Complete step 3
        const step3ExecId = getWorkflow(testServer.db, workflow.id)!.steps[2]
          .executionId!;
        const control3 = mockExecutor.getExecutionControl(step3ExecId);
        control3!.complete("Step 3 completed");

        // 5. Wait for workflow to complete
        const completed = await waitForWorkflowStatus(
          testServer.db,
          workflow.id,
          "completed",
          10000
        );

        expect(completed.status).toBe("completed");
        expect(completed.steps.every((s) => s.status === "completed")).toBe(
          true
        );
        expect(completed.completedAt).toBeDefined();
      }
    );

    it(
      "should pause and resume workflow during execution",
      { timeout: 30000 },
      async () => {
        // Create issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Task 1" },
          { id: "i-2", title: "Task 2" },
        ]);

        // Create and start workflow
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2"] },
          { parallelism: "sequential" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for first step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Pause the workflow
        await testServer.api.pauseWorkflow(workflow.id);

        // Complete the running execution
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.complete("Done");

        // Verify workflow is paused
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.status === "paused";
        }, 5000);

        const paused = getWorkflow(testServer.db, workflow.id)!;
        expect(paused.status).toBe("paused");

        // Resume the workflow
        await testServer.api.resumeWorkflow(workflow.id);

        // Wait for step 2 to start running
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[1].status === "running";
        }, 5000);

        // Complete step 2
        const step2ExecId = getWorkflow(testServer.db, workflow.id)!.steps[1]
          .executionId!;
        mockExecutor.getExecutionControl(step2ExecId)!.complete("Done");

        // Wait for workflow to complete
        const completed = await waitForWorkflowStatus(
          testServer.db,
          workflow.id,
          "completed",
          10000
        );

        expect(completed.status).toBe("completed");
      }
    );

    it("should cancel workflow during execution", { timeout: 30000 }, async () => {
      // Create issues
      createTestIssues(testServer.db, [
        { id: "i-1", title: "Task 1" },
        { id: "i-2", title: "Task 2" },
      ]);

      // Create and start workflow
      const workflow = await testServer.api.createWorkflow({
        type: "issues",
        issueIds: ["i-1", "i-2"],
      });
      await testServer.api.startWorkflow(workflow.id);

      // Wait for first step to start
      await waitFor(() => {
        const w = getWorkflow(testServer.db, workflow.id);
        return w?.steps[0].status === "running";
      }, 5000);

      // Cancel the workflow
      await testServer.api.cancelWorkflow(workflow.id);

      // Verify workflow is cancelled
      const cancelled = await waitForWorkflowStatus(
        testServer.db,
        workflow.id,
        "cancelled",
        5000
      );

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.completedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // Dependency Handling Tests
  // ===========================================================================

  describe("Dependency Handling", () => {
    it(
      "should execute steps in topological order based on dependencies",
      { timeout: 30000 },
      async () => {
        // Create issues with dependencies
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Base feature" },
          { id: "i-2", title: "Depends on base" },
          { id: "i-3", title: "Final step" },
        ]);

        // Create dependencies: i-1 blocks i-2, i-2 blocks i-3
        createIssueDependencies(testServer.db, [
          { from: "i-1", to: "i-2", type: "blocks" },
          { from: "i-2", to: "i-3", type: "blocks" },
        ]);

        // Create and start workflow
        const workflow = await testServer.api.createWorkflow({
          type: "issues",
          issueIds: ["i-1", "i-2", "i-3"],
        });
        await testServer.api.startWorkflow(workflow.id);

        // Verify initial order
        const initialWorkflow = getWorkflow(testServer.db, workflow.id)!;
        const stepIssueOrder = initialWorkflow.steps.map((s) => s.issueId);

        // i-1 should come before i-2, and i-2 should come before i-3
        expect(stepIssueOrder.indexOf("i-1")).toBeLessThan(
          stepIssueOrder.indexOf("i-2")
        );
        expect(stepIssueOrder.indexOf("i-2")).toBeLessThan(
          stepIssueOrder.indexOf("i-3")
        );

        // Complete steps one by one, waiting for each to run first
        const mockExecutor = testServer.executionService as MockExecutionService;

        // Wait for and complete step 1
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);
        const step1 = getWorkflow(testServer.db, workflow.id)!.steps[0];
        mockExecutor.getExecutionControl(step1.executionId!)?.complete("Done");

        // Wait for and complete step 2
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[1].status === "running";
        }, 5000);
        const step2 = getWorkflow(testServer.db, workflow.id)!.steps[1];
        mockExecutor.getExecutionControl(step2.executionId!)?.complete("Done");

        // Wait for and complete step 3
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[2].status === "running";
        }, 5000);
        const step3 = getWorkflow(testServer.db, workflow.id)!.steps[2];
        mockExecutor.getExecutionControl(step3.executionId!)?.complete("Done");

        // Wait for completion
        await waitForWorkflowStatus(testServer.db, workflow.id, "completed", 10000);
      }
    );

    it(
      "should wait for blocking dependencies before starting a step",
      { timeout: 30000 },
      async () => {
        // Create issues with dependency
        createTestIssues(testServer.db, [
          { id: "i-1", title: "First" },
          { id: "i-2", title: "Second (depends on first)" },
        ]);

        createIssueDependencies(testServer.db, [
          { from: "i-1", to: "i-2", type: "blocks" },
        ]);

        // Create and start workflow
        const workflow = await testServer.api.createWorkflow({
          type: "issues",
          issueIds: ["i-1", "i-2"],
        });
        await testServer.api.startWorkflow(workflow.id);

        // Wait for first step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Verify second step is still pending (blocked by dependency)
        const runningWorkflow = getWorkflow(testServer.db, workflow.id)!;
        expect(runningWorkflow.steps[1].status).toBe("pending");

        // Complete first step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = runningWorkflow.steps[0].executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.complete("Done");

        // Now second step should start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[1].status === "running";
        }, 5000);

        // Complete second step
        const w = getWorkflow(testServer.db, workflow.id)!;
        mockExecutor.getExecutionControl(w.steps[1].executionId!)!.complete(
          "Done"
        );

        // Wait for completion
        await waitForWorkflowStatus(testServer.db, workflow.id, "completed", 10000);
      }
    );

    it(
      "should execute parallel-ready steps in batch when parallelism=auto",
      { timeout: 30000 },
      async () => {
        // Create independent issues (no dependencies between them)
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Independent A" },
          { id: "i-2", title: "Independent B" },
          { id: "i-3", title: "Independent C" },
        ]);

        // Create workflow with auto parallelism
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2", "i-3"] },
          { parallelism: "parallel" }
        );

        expect(workflow.config.parallelism).toBe("parallel");
        await testServer.api.startWorkflow(workflow.id);

        const mockExecutor = testServer.executionService as MockExecutionService;

        // Complete each step as it runs
        for (let i = 0; i < 3; i++) {
          await waitFor(() => {
            const w = getWorkflow(testServer.db, workflow.id);
            return w?.steps[i]?.status === "running";
          }, 5000);

          const w = getWorkflow(testServer.db, workflow.id)!;
          const step = w.steps[i];
          mockExecutor.getExecutionControl(step.executionId!)?.complete("Done");
        }

        await waitForWorkflowStatus(testServer.db, workflow.id, "completed", 10000);
      }
    );
  });

  // ===========================================================================
  // Failure Scenarios
  // ===========================================================================

  describe("Failure Scenarios", () => {
    it(
      "should pause workflow on step failure when onFailure=pause",
      { timeout: 30000 },
      async () => {
        // Create issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Will fail" },
          { id: "i-2", title: "Should not run" },
        ]);

        // Create workflow with pause on failure
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2"] },
          { onFailure: "pause" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for first step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Fail the first step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.fail("Simulated failure");

        // Workflow should be paused
        const paused = await waitForWorkflowStatus(
          testServer.db,
          workflow.id,
          "paused",
          10000
        );

        expect(paused.status).toBe("paused");
        // Step should be "pending" (resumable) not "failed" when onFailure=pause
        // The executionId is preserved so the session can be resumed
        expect(paused.steps[0].status).toBe("pending");
        expect(paused.steps[0].executionId).toBe(step1ExecId);
        // Step 2 should not have run - could be "pending" or "ready" depending on timing
        expect(["pending", "ready"]).toContain(paused.steps[1].status);
      }
    );

    it(
      "should fail workflow immediately when onFailure=stop",
      { timeout: 30000 },
      async () => {
        // Create issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Will fail" },
          { id: "i-2", title: "Should not run" },
        ]);

        // Create workflow with stop on failure
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2"] },
          { onFailure: "stop" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for first step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Fail the first step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.fail("Critical failure");

        // Workflow should fail
        const failed = await waitForWorkflowStatus(
          testServer.db,
          workflow.id,
          "failed",
          10000
        );

        expect(failed.status).toBe("failed");
        expect(failed.steps[0].status).toBe("failed");
      }
    );

    it(
      "should skip dependent steps when onFailure=skip_dependents",
      { timeout: 30000 },
      async () => {
        // Create issues with dependencies
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Will fail" },
          { id: "i-2", title: "Depends on i-1" },
          { id: "i-3", title: "Independent" },
        ]);

        createIssueDependencies(testServer.db, [
          { from: "i-1", to: "i-2", type: "blocks" },
        ]);

        // Create workflow with skip_dependents on failure
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2", "i-3"] },
          { onFailure: "skip_dependents", parallelism: "sequential" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for first step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Fail the first step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.fail("i-1 failed");

        // Wait for dependent step to be skipped
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          // Find the step for i-2
          const step2 = w?.steps.find((s) => s.issueId === "i-2");
          return step2?.status === "skipped";
        }, 5000);

        // Verify the dependent step (i-2) is skipped, but i-3 continues
        const w = getWorkflow(testServer.db, workflow.id)!;
        const step2 = w.steps.find((s) => s.issueId === "i-2")!;
        expect(step2.status).toBe("skipped");

        // Complete remaining steps
        mockExecutor.completeAll("Done");

        // Wait for completion (may complete or continue based on remaining steps)
        await waitFor(() => {
          const workflow = getWorkflow(testServer.db, w.id);
          if (!workflow) return false;
          return (
            workflow.status === "completed" ||
            workflow.steps.every(
              (s) =>
                s.status === "completed" ||
                s.status === "skipped" ||
                s.status === "failed"
            )
          );
        }, 10000);
      }
    );

    it(
      "should resume workflow after failure when onFailure=pause",
      { timeout: 30000 },
      async () => {
        // Create issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Will fail then succeed on resume" },
          { id: "i-2", title: "Should run after resume completes" },
        ]);

        // Create workflow with pause on failure
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2"] },
          { onFailure: "pause" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Fail the step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.fail("First attempt failed");

        // Wait for workflow to pause
        await waitForWorkflowStatus(testServer.db, workflow.id, "paused", 5000);

        // Verify step is pending (resumable) with executionId preserved
        const pausedWorkflow = getWorkflow(testServer.db, workflow.id)!;
        expect(pausedWorkflow.steps[0].status).toBe("pending");
        expect(pausedWorkflow.steps[0].executionId).toBe(step1ExecId);

        // Resume the workflow - this should retry the pending step (resuming session)
        await testServer.api.resumeWorkflow(workflow.id);

        // Wait for step to start running again
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Complete the step this time
        const resumedWorkflow = getWorkflow(testServer.db, workflow.id)!;
        const resumeExecId = resumedWorkflow.steps[0].executionId!;
        mockExecutor.getExecutionControl(resumeExecId)!.complete("Success!");

        // Wait for step 2 to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[1].status === "running";
        }, 5000);

        // Complete step 2
        const w = getWorkflow(testServer.db, workflow.id)!;
        mockExecutor.getExecutionControl(w.steps[1].executionId!)!.complete("Done");

        // Workflow should complete
        const completed = await waitForWorkflowStatus(
          testServer.db,
          workflow.id,
          "completed",
          10000
        );
        expect(completed.steps[0].status).toBe("completed");
        expect(completed.steps[1].status).toBe("completed");
      }
    );

    it(
      "should retry a failed step with session resume (onFailure=stop)",
      { timeout: 30000 },
      async () => {
        // Create issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Will fail then succeed on retry" },
        ]);

        // Create workflow with stop on failure (step will be marked "failed")
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1"] },
          { onFailure: "stop" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Fail the step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.fail("First attempt failed");

        // Wait for workflow to fail
        await waitForWorkflowStatus(testServer.db, workflow.id, "failed", 5000);

        // Verify step is marked as failed with executionId preserved
        const failedWorkflow = getWorkflow(testServer.db, workflow.id)!;
        expect(failedWorkflow.steps[0].status).toBe("failed");
        expect(failedWorkflow.steps[0].executionId).toBe(step1ExecId);

        // Get step ID and retry the step (should resume session by default)
        const stepId = failedWorkflow.steps[0].id;
        const response = await fetch(
          `${testServer.baseUrl}/api/workflows/${workflow.id}/steps/${stepId}/retry`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }
        );
        expect(response.ok).toBe(true);

        // Wait for step to start running again
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Verify workflow recovered from failed state
        const recoveredWorkflow = getWorkflow(testServer.db, workflow.id)!;
        expect(recoveredWorkflow.status).toBe("running");

        // Complete the step this time
        const retryExecId = recoveredWorkflow.steps[0].executionId!;
        mockExecutor.getExecutionControl(retryExecId)!.complete("Success!");

        // Workflow should complete
        await waitForWorkflowStatus(testServer.db, workflow.id, "completed", 10000);
      }
    );

    it(
      "should retry a failed step with fresh start when requested",
      { timeout: 30000 },
      async () => {
        // Create issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Will fail then succeed with fresh start" },
        ]);

        // Create workflow with stop on failure
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1"] },
          { onFailure: "stop" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Fail the step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.fail("First attempt failed");

        // Wait for workflow to fail
        await waitForWorkflowStatus(testServer.db, workflow.id, "failed", 5000);

        // Get step ID and retry with freshStart=true
        const failedWorkflow = getWorkflow(testServer.db, workflow.id)!;
        const stepId = failedWorkflow.steps[0].id;
        const response = await fetch(
          `${testServer.baseUrl}/api/workflows/${workflow.id}/steps/${stepId}/retry`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ freshStart: true }),
          }
        );
        expect(response.ok).toBe(true);

        // Wait for step to start running again
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Verify a new execution was created (executionId should be different)
        const recoveredWorkflow = getWorkflow(testServer.db, workflow.id)!;
        expect(recoveredWorkflow.status).toBe("running");
        expect(recoveredWorkflow.steps[0].executionId).not.toBe(step1ExecId);

        // Complete the step
        const newExecId = recoveredWorkflow.steps[0].executionId!;
        mockExecutor.getExecutionControl(newExecId)!.complete("Success!");

        // Workflow should complete
        await waitForWorkflowStatus(testServer.db, workflow.id, "completed", 10000);
      }
    );

    it(
      "should skip a paused step and continue workflow",
      { timeout: 30000 },
      async () => {
        // Create issues
        createTestIssues(testServer.db, [
          { id: "i-1", title: "Will fail" },
          { id: "i-2", title: "Should run after skip" },
        ]);

        // Create workflow with pause on failure
        const workflow = await testServer.api.createWorkflow(
          { type: "issues", issueIds: ["i-1", "i-2"] },
          { onFailure: "pause" }
        );
        await testServer.api.startWorkflow(workflow.id);

        // Wait for step to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        // Fail the step
        const mockExecutor = testServer.executionService as MockExecutionService;
        const step1ExecId = getWorkflow(testServer.db, workflow.id)!.steps[0]
          .executionId!;
        mockExecutor.getExecutionControl(step1ExecId)!.fail("Unrecoverable");

        // Wait for workflow to pause
        await waitForWorkflowStatus(testServer.db, workflow.id, "paused", 5000);

        // Get step ID - step is "pending" (resumable) when onFailure=pause
        const pausedWorkflow = getWorkflow(testServer.db, workflow.id)!;
        const stepId = pausedWorkflow.steps[0].id;
        expect(pausedWorkflow.steps[0].status).toBe("pending");

        // Skip the step via API (works on any non-terminal status)
        const response = await fetch(
          `${testServer.baseUrl}/api/workflows/${workflow.id}/steps/${stepId}/skip`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "Not critical" }),
          }
        );
        expect(response.ok).toBe(true);

        // Wait for step 2 to start
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[1].status === "running";
        }, 5000);

        // Verify step 1 is skipped
        const afterSkip = getWorkflow(testServer.db, workflow.id)!;
        expect(afterSkip.steps[0].status).toBe("skipped");

        // Complete step 2
        mockExecutor.completeAll("Done");

        // Wait for completion
        await waitForWorkflowStatus(
          testServer.db,
          workflow.id,
          "completed",
          10000
        );
      }
    );
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    it("should handle empty workflow gracefully", async () => {
      // Create workflow with no issues (goal-based with no initial work)
      // Goal-based workflows require orchestrator engine
      const workflow = await testServer.api.createWorkflow(
        {
          type: "goal",
          goal: "Build something",
        },
        {
          engineType: "orchestrator",
        }
      );

      expect(workflow.status).toBe("pending");
      expect(workflow.steps).toHaveLength(0);
      expect(workflow.config.engineType).toBe("orchestrator");
    });

    it("should handle single-step workflow", { timeout: 30000 }, async () => {
      createTestIssues(testServer.db, [{ id: "i-1", title: "Only task" }]);

      const workflow = await testServer.api.createWorkflow({
        type: "issues",
        issueIds: ["i-1"],
      });
      await testServer.api.startWorkflow(workflow.id);

      // Wait for step to start
      await waitFor(() => {
        const w = getWorkflow(testServer.db, workflow.id);
        return w?.steps[0].status === "running";
      }, 5000);

      // Complete it
      const mockExecutor = testServer.executionService as MockExecutionService;
      mockExecutor.completeAll("Done");

      // Should complete
      const completed = await waitForWorkflowStatus(
        testServer.db,
        workflow.id,
        "completed",
        10000
      );

      expect(completed.steps).toHaveLength(1);
      expect(completed.steps[0].status).toBe("completed");
    });

    it(
      "should reject starting an already running workflow",
      { timeout: 10000 },
      async () => {
        createTestIssues(testServer.db, [{ id: "i-1", title: "Task" }]);

        const workflow = await testServer.api.createWorkflow({
          type: "issues",
          issueIds: ["i-1"],
        });
        await testServer.api.startWorkflow(workflow.id);

        // Try to start again - should fail
        await expect(testServer.api.startWorkflow(workflow.id)).rejects.toThrow();
      }
    );

    it(
      "should reject pausing a non-running workflow",
      { timeout: 10000 },
      async () => {
        createTestIssues(testServer.db, [{ id: "i-1", title: "Task" }]);

        const workflow = await testServer.api.createWorkflow({
          type: "issues",
          issueIds: ["i-1"],
        });

        // Try to pause pending workflow - should fail
        await expect(testServer.api.pauseWorkflow(workflow.id)).rejects.toThrow();
      }
    );

    it(
      "should reject cancelling a completed workflow",
      { timeout: 30000 },
      async () => {
        createTestIssues(testServer.db, [{ id: "i-1", title: "Task" }]);

        const workflow = await testServer.api.createWorkflow({
          type: "issues",
          issueIds: ["i-1"],
        });
        await testServer.api.startWorkflow(workflow.id);

        // Wait for step to start and complete it
        await waitFor(() => {
          const w = getWorkflow(testServer.db, workflow.id);
          return w?.steps[0].status === "running";
        }, 5000);

        const mockExecutor = testServer.executionService as MockExecutionService;
        mockExecutor.completeAll("Done");

        await waitForWorkflowStatus(testServer.db, workflow.id, "completed", 10000);

        // Try to cancel completed workflow - should fail
        await expect(testServer.api.cancelWorkflow(workflow.id)).rejects.toThrow();
      }
    );
  });
});
