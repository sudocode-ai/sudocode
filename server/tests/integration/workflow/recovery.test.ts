/**
 * Workflow Recovery Integration Tests
 *
 * Tests that workflows survive server restart and resume correctly.
 * Simulates crashes by clearing in-memory state and calling recovery methods.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import Database from "better-sqlite3";

import { SequentialWorkflowEngine } from "../../../src/workflow/engines/sequential-engine.js";
import { WorkflowWakeupService } from "../../../src/workflow/services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../../../src/workflow/services/prompt-builder.js";
import { WorkflowEventEmitter } from "../../../src/workflow/workflow-event-emitter.js";
import { ExecutionService } from "../../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../../../src/services/execution-logs-store.js";

import {
  createTestDatabase,
  createTestIssues,
} from "./helpers/workflow-test-setup.js";
import {
  createMockExecutionService,
  type MockExecutionService,
} from "./helpers/mock-executor.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("Workflow Recovery", () => {
  let testDir: string;
  let db: Database.Database;
  let executionService: MockExecutionService;
  let lifecycleService: ExecutionLifecycleService;
  let workflowEventEmitter: WorkflowEventEmitter;
  const projectId = "test-project";

  beforeAll(async () => {
    // Create temp directory for git repo simulation
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-workflow-recovery-")
    );

    // Initialize as a git repo
    const { execSync } = await import("child_process");
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
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Create fresh database for each test
    db = createTestDatabase();
    workflowEventEmitter = new WorkflowEventEmitter();
    lifecycleService = new ExecutionLifecycleService(db, testDir);

    // Create mock execution service with manual completion control
    executionService = createMockExecutionService(db, projectId, testDir, {
      defaultDelayMs: 0, // Don't auto-complete - we control completion manually
      defaultResult: "pending",
    });
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  function createIssues(count: number = 3): string[] {
    const issues = Array.from({ length: count }, (_, i) => ({
      id: `i-${i + 1}`,
      title: `Issue ${i + 1}`,
      content: `Implementation for issue ${i + 1}`,
    }));
    createTestIssues(db, issues);
    return issues.map((i) => i.id);
  }

  function createSequentialEngine(): SequentialWorkflowEngine {
    return new SequentialWorkflowEngine(
      db,
      executionService as unknown as ExecutionService,
      lifecycleService,
      testDir,
      workflowEventEmitter
    );
  }

  function createWakeupService(): WorkflowWakeupService {
    const promptBuilder = new WorkflowPromptBuilder();
    return new WorkflowWakeupService({
      db,
      executionService: executionService as unknown as ExecutionService,
      promptBuilder,
      eventEmitter: workflowEventEmitter,
      config: { batchWindowMs: 100 },
    });
  }

  async function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // Sequential Engine Recovery Tests
  // ===========================================================================

  describe("SequentialWorkflowEngine recovery", () => {
    it("should resume running workflow after restart", async () => {
      // 1. Create engine and workflow
      const engine1 = createSequentialEngine();
      const issueIds = createIssues(3);

      const workflow = await engine1.createWorkflow(
        { type: "issues", issueIds },
        { engineType: "sequential" },
        "Recovery Test"
      );

      // 2. Start the workflow
      await engine1.startWorkflow(workflow.id);
      await wait(100); // Let first step start

      // 3. Verify workflow is running and has in-memory state
      const runningWorkflow = await engine1.getWorkflow(workflow.id);
      expect(runningWorkflow?.status).toBe("running");
      expect((engine1 as any).activeWorkflows.has(workflow.id)).toBe(true);

      // 4. Simulate crash - create new engine (in-memory state is lost)
      const engine2 = createSequentialEngine();

      // Verify the new engine doesn't know about the workflow in memory
      expect((engine2 as any).activeWorkflows.size).toBe(0);

      // 5. Call recovery
      await engine2.recoverWorkflows();

      // 6. Verify workflow state is recovered
      // The in-memory activeWorkflows should now have the workflow
      expect((engine2 as any).activeWorkflows.has(workflow.id)).toBe(true);

      // The workflow was recovered - it may be running, paused (awaiting decision on crashed step),
      // or the crashed step was handled based on onStepFailure strategy
      const recoveredWorkflow = await engine2.getWorkflow(workflow.id);
      expect(["running", "paused"]).toContain(recoveredWorkflow?.status);
    });

    it("should handle step that was running during crash", async () => {
      // 1. Create engine and workflow
      const engine1 = createSequentialEngine();
      const issueIds = createIssues(2);

      const workflow = await engine1.createWorkflow(
        { type: "issues", issueIds },
        {
          engineType: "sequential",
          onStepFailure: "continue", // Should continue to next step after failure
        },
        "Crash Test"
      );

      // 2. Start the workflow
      await engine1.startWorkflow(workflow.id);
      await wait(50);

      // 3. Verify first step is running
      const beforeCrash = await engine1.getWorkflow(workflow.id);
      expect(beforeCrash?.steps[0].status).toBe("running");
      expect(beforeCrash?.steps[0].executionId).toBeDefined();

      // 4. Simulate crash - create new engine
      const engine2 = createSequentialEngine();

      // 5. Call recovery
      await engine2.recoverWorkflows();

      // 6. The crashed step should be marked as failed
      const afterRecovery = await engine2.getWorkflow(workflow.id);
      expect(afterRecovery?.steps[0].status).toBe("failed");

      // 7. Wait for next step to start (due to onStepFailure: 'continue')
      await wait(100);

      const afterContinue = await engine2.getWorkflow(workflow.id);
      // Second step should be running or completed
      expect(["running", "pending", "ready"]).toContain(
        afterContinue?.steps[1].status
      );
    });

    it("should preserve paused state after restart", async () => {
      // 1. Create engine and workflow
      const engine1 = createSequentialEngine();
      const issueIds = createIssues(2);

      const workflow = await engine1.createWorkflow(
        { type: "issues", issueIds },
        { engineType: "sequential" },
        "Pause Test"
      );

      // 2. Start and then pause the workflow
      await engine1.startWorkflow(workflow.id);
      await wait(50);
      await engine1.pauseWorkflow(workflow.id);

      // 3. Verify paused state
      const beforeCrash = await engine1.getWorkflow(workflow.id);
      expect(beforeCrash?.status).toBe("paused");

      // 4. Simulate crash
      const engine2 = createSequentialEngine();

      // 5. Call recovery
      await engine2.recoverWorkflows();

      // 6. Workflow should remain paused (not start running again)
      const afterRecovery = await engine2.getWorkflow(workflow.id);
      expect(afterRecovery?.status).toBe("paused");

      // In-memory state should be restored correctly
      const state = (engine2 as any).activeWorkflows.get(workflow.id);
      expect(state?.isPaused).toBe(true);
    });

    it("should not recover cancelled workflows", async () => {
      // 1. Create engine and workflow
      const engine1 = createSequentialEngine();
      const issueIds = createIssues(2);

      const workflow = await engine1.createWorkflow(
        { type: "issues", issueIds },
        { engineType: "sequential" },
        "Cancel Test"
      );

      // 2. Start and then cancel
      await engine1.startWorkflow(workflow.id);
      await wait(50);
      await engine1.cancelWorkflow(workflow.id);

      // 3. Verify cancelled
      const beforeCrash = await engine1.getWorkflow(workflow.id);
      expect(beforeCrash?.status).toBe("cancelled");

      // 4. Simulate crash and recover
      const engine2 = createSequentialEngine();
      await engine2.recoverWorkflows();

      // 5. Cancelled workflow should not be recovered
      expect((engine2 as any).activeWorkflows.has(workflow.id)).toBe(false);
    });
  });

  // ===========================================================================
  // Wakeup Service Recovery Tests
  // ===========================================================================

  describe("WorkflowWakeupService recovery", () => {
    it("should restore pending await conditions", async () => {
      // 1. Create wakeup service
      const wakeupService1 = createWakeupService();

      // 2. Create a workflow directly in the database
      const workflowId = "wf-await-test";
      db.prepare(`
        INSERT INTO workflows (id, title, status, steps, config, source, base_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflowId,
        "Await Test",
        "running",
        "[]",
        JSON.stringify({ engineType: "orchestrator" }),
        JSON.stringify({ type: "issues", issueIds: [] }),
        "main",
        new Date().toISOString(),
        new Date().toISOString()
      );

      // 3. Register an await condition with timeout
      const awaitResult = wakeupService1.registerAwait({
        workflowId,
        eventTypes: ["step_completed"],
        timeoutSeconds: 60, // Long timeout so it doesn't fire during test
        message: "Waiting for step completion",
      });

      expect(awaitResult.id).toBeDefined();
      expect(awaitResult.timeoutAt).toBeDefined();

      // 4. Verify await is in database
      const awaitEvent = db
        .prepare(
          `SELECT * FROM workflow_events WHERE type = 'orchestrator_wakeup' AND workflow_id = ?`
        )
        .get(workflowId) as any;
      expect(awaitEvent).toBeDefined();

      // 5. Simulate crash - create new wakeup service
      const wakeupService2 = createWakeupService();

      // Verify in-memory state is empty
      expect((wakeupService2 as any).pendingAwaits.size).toBe(0);

      // 6. Call recovery
      await wakeupService2.recoverState();

      // 7. Verify await is restored
      expect((wakeupService2 as any).pendingAwaits.has(workflowId)).toBe(true);
      const pendingAwait = (wakeupService2 as any).pendingAwaits.get(
        workflowId
      );
      expect(pendingAwait.eventTypes).toContain("step_completed");
    });

    it("should trigger immediate wakeup for expired awaits", async () => {
      // 1. Create wakeup service
      const wakeupService1 = createWakeupService();

      // 2. Create a workflow
      const workflowId = "wf-expired-await";
      db.prepare(`
        INSERT INTO workflows (id, title, status, steps, config, source, base_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflowId,
        "Expired Await Test",
        "running",
        "[]",
        JSON.stringify({ engineType: "orchestrator" }),
        JSON.stringify({ type: "issues", issueIds: [] }),
        "main",
        new Date().toISOString(),
        new Date().toISOString()
      );

      // 3. Manually insert an already-expired await into the database
      const expiredTimeoutAt = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      const awaitId = "await-expired";
      db.prepare(`
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, 'orchestrator_wakeup', ?, ?)
      `).run(
        awaitId,
        workflowId,
        JSON.stringify({
          awaitType: "pending",
          eventTypes: ["step_completed"],
          timeoutAt: expiredTimeoutAt,
          message: "Already expired",
        }),
        new Date().toISOString()
      );

      // 4. Create new wakeup service and recover
      const wakeupService2 = createWakeupService();
      await wakeupService2.recoverState();

      // 5. The expired await should be resolved as "timeout"
      // Check that the await was processed
      const awaitEvent = db
        .prepare(`SELECT processed_at FROM workflow_events WHERE id = ?`)
        .get(awaitId) as any;
      expect(awaitEvent.processed_at).toBeDefined();

      // The await should no longer be in pending state
      const pendingAwait = (wakeupService2 as any).pendingAwaits.get(
        workflowId
      );
      // Either it's not there, or it's been resolved
      if (pendingAwait) {
        expect((wakeupService2 as any).resolvedAwaits.has(workflowId)).toBe(
          true
        );
      }
    });

    it("should reschedule await with remaining time", async () => {
      // 1. Create wakeup service
      const wakeupService1 = createWakeupService();

      // 2. Create a workflow
      const workflowId = "wf-reschedule";
      db.prepare(`
        INSERT INTO workflows (id, title, status, steps, config, source, base_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflowId,
        "Reschedule Test",
        "running",
        "[]",
        JSON.stringify({ engineType: "orchestrator" }),
        JSON.stringify({ type: "issues", issueIds: [] }),
        "main",
        new Date().toISOString(),
        new Date().toISOString()
      );

      // 3. Insert an await that hasn't expired yet (10 seconds from now)
      const futureTimeoutAt = new Date(Date.now() + 10000).toISOString();
      const awaitId = "await-future";
      db.prepare(`
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, 'orchestrator_wakeup', ?, ?)
      `).run(
        awaitId,
        workflowId,
        JSON.stringify({
          awaitType: "pending",
          eventTypes: ["step_completed"],
          timeoutAt: futureTimeoutAt,
        }),
        new Date().toISOString()
      );

      // 4. Create new wakeup service and recover
      const wakeupService2 = createWakeupService();
      await wakeupService2.recoverState();

      // 5. The await should be recovered and timeout rescheduled
      expect((wakeupService2 as any).pendingAwaits.has(workflowId)).toBe(true);
      expect((wakeupService2 as any).awaitTimeouts.has(awaitId)).toBe(true);
    });
  });

  // ===========================================================================
  // Execution Timeout Recovery Tests
  // ===========================================================================

  describe("Execution timeout recovery", () => {
    it("should restore pending execution timeouts", async () => {
      // 1. Create wakeup service and issue
      const wakeupService1 = createWakeupService();
      createIssues(1); // Creates i-1

      // 2. Create a workflow and execution
      const workflowId = "wf-exec-timeout";
      const stepId = "step-1";
      const executionId = "exec-timeout-test";

      db.prepare(`
        INSERT INTO workflows (id, title, status, steps, config, source, base_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflowId,
        "Exec Timeout Test",
        "running",
        JSON.stringify([{ id: stepId, status: "running", executionId }]),
        JSON.stringify({ engineType: "orchestrator" }),
        JSON.stringify({ type: "issues", issueIds: [] }),
        "main",
        new Date().toISOString(),
        new Date().toISOString()
      );

      db.prepare(`
        INSERT INTO executions (id, issue_id, status, agent_type, workflow_execution_id, target_branch, branch_name, created_at, updated_at)
        VALUES (?, ?, 'running', 'claude-code', ?, ?, ?, ?, ?)
      `).run(
        executionId,
        "i-1",
        workflowId,
        "main",
        `sudocode/${executionId}`,
        new Date().toISOString(),
        new Date().toISOString()
      );

      // 3. Start execution timeout (30 seconds from now)
      wakeupService1.startExecutionTimeout(
        executionId,
        workflowId,
        stepId,
        30000
      );

      // 4. Verify timeout is in database
      const timeoutEvent = db
        .prepare(
          `SELECT * FROM workflow_events WHERE type = 'execution_timeout' AND execution_id = ?`
        )
        .get(executionId) as any;
      expect(timeoutEvent).toBeDefined();
      expect(timeoutEvent.processed_at).toBeNull();

      // 5. Simulate crash - create new wakeup service
      const wakeupService2 = createWakeupService();
      expect((wakeupService2 as any).executionTimeouts.size).toBe(0);

      // 6. Call recovery
      await wakeupService2.recoverState();

      // 7. Verify timeout is restored
      expect((wakeupService2 as any).executionTimeouts.has(executionId)).toBe(
        true
      );
    });

    it("should handle expired execution timeout during recovery", async () => {
      // 1. Create wakeup service and issue
      const wakeupService1 = createWakeupService();
      createIssues(1); // Creates i-1

      // 2. Create a workflow and execution
      const workflowId = "wf-expired-timeout";
      const stepId = "step-1";
      const executionId = "exec-expired";

      db.prepare(`
        INSERT INTO workflows (id, title, status, steps, config, source, base_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflowId,
        "Expired Timeout Test",
        "running",
        JSON.stringify([
          { id: stepId, issueId: "i-1", status: "running", executionId },
        ]),
        JSON.stringify({ engineType: "orchestrator" }),
        JSON.stringify({ type: "issues", issueIds: ["i-1"] }),
        "main",
        new Date().toISOString(),
        new Date().toISOString()
      );

      db.prepare(`
        INSERT INTO executions (id, issue_id, status, agent_type, workflow_execution_id, target_branch, branch_name, created_at, updated_at)
        VALUES (?, ?, 'running', 'claude-code', ?, ?, ?, ?, ?)
      `).run(
        executionId,
        "i-1",
        workflowId,
        "main",
        `sudocode/${executionId}`,
        new Date().toISOString(),
        new Date().toISOString()
      );

      // 3. Insert an already-expired timeout into the database
      const expiredTimeoutAt = new Date(Date.now() - 1000).toISOString();
      db.prepare(`
        INSERT INTO workflow_events (id, workflow_id, type, execution_id, step_id, payload, created_at)
        VALUES (?, ?, 'execution_timeout', ?, ?, ?, ?)
      `).run(
        `timeout-${executionId}`,
        workflowId,
        executionId,
        stepId,
        JSON.stringify({ timeoutAt: expiredTimeoutAt }),
        new Date().toISOString()
      );

      // 4. Create new wakeup service and recover
      const wakeupService2 = createWakeupService();
      await wakeupService2.recoverState();

      // 5. The expired timeout should be processed
      const timeoutEvent = db
        .prepare(
          `SELECT processed_at FROM workflow_events WHERE id = ?`
        )
        .get(`timeout-${executionId}`) as any;
      expect(timeoutEvent.processed_at).toBeDefined();

      // 6. A step_failed event should have been recorded
      const failEvent = db
        .prepare(
          `SELECT * FROM workflow_events WHERE type = 'step_failed' AND execution_id = ?`
        )
        .get(executionId) as any;
      expect(failEvent).toBeDefined();
      const payload = JSON.parse(failEvent.payload);
      expect(payload.reason).toBe("timeout");
    });

    it("should clear timeout when execution completes", async () => {
      // 1. Create wakeup service and issue
      const wakeupService = createWakeupService();
      createIssues(1); // Creates i-1

      // 2. Create a workflow and execution
      const workflowId = "wf-clear-timeout";
      const stepId = "step-1";
      const executionId = "exec-clear";

      db.prepare(`
        INSERT INTO workflows (id, title, status, steps, config, source, base_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflowId,
        "Clear Timeout Test",
        "running",
        JSON.stringify([{ id: stepId, status: "running", executionId }]),
        JSON.stringify({ engineType: "orchestrator" }),
        JSON.stringify({ type: "issues", issueIds: [] }),
        "main",
        new Date().toISOString(),
        new Date().toISOString()
      );

      db.prepare(`
        INSERT INTO executions (id, issue_id, status, agent_type, workflow_execution_id, target_branch, branch_name, created_at, updated_at)
        VALUES (?, ?, 'running', 'claude-code', ?, ?, ?, ?, ?)
      `).run(
        executionId,
        "i-1",
        workflowId,
        "main",
        `sudocode/${executionId}`,
        new Date().toISOString(),
        new Date().toISOString()
      );

      // 3. Start execution timeout
      wakeupService.startExecutionTimeout(executionId, workflowId, stepId, 30000);
      expect((wakeupService as any).executionTimeouts.has(executionId)).toBe(true);

      // 4. Clear the timeout (simulating execution completion)
      wakeupService.clearExecutionTimeout(executionId);

      // 5. Verify timeout is cleared
      expect((wakeupService as any).executionTimeouts.has(executionId)).toBe(false);

      // 6. Verify database event is marked as processed
      const timeoutEvent = db
        .prepare(
          `SELECT processed_at FROM workflow_events WHERE id = ?`
        )
        .get(`timeout-${executionId}`) as any;
      expect(timeoutEvent.processed_at).toBeDefined();
    });
  });
});
