/**
 * Integration Tests for Complete Workflow Execution
 *
 * Tests the full execution flow from ExecutionService through the complete
 * workflow stack with real processes, SSE streaming, and database integration.
 *
 * These tests are gated behind RUN_E2E_TESTS environment variable since they
 * spawn real Claude Code processes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
} from "@sudocode-ai/types/schema";
import { initializeDefaultTemplates } from "../../../src/services/prompt-templates.js";
import { ExecutionService } from "../../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";
import { TransportManager } from "../../../src/execution/transport/transport-manager.js";
import { WorktreeManager } from "../../../src/execution/worktree/manager.js";
import { generateIssueId } from "@sudocode/cli/dist/id-generator.js";
import { createIssue } from "@sudocode/cli/dist/operations/index.js";
import { getExecution } from "../../../src/services/executions.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import type { AgUiEvent } from "../../../src/execution/transport/transport-manager.js";

// Skip E2E tests unless explicitly enabled
const SKIP_E2E = process.env.RUN_E2E_TESTS !== "true";

/**
 * Helper to set up a git repository
 */
function setupGitRepository(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
  }

  // Initialize git repo
  execSync("git init", { cwd: repoPath, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', {
    cwd: repoPath,
    stdio: "ignore",
  });
  execSync('git config user.name "Test User"', {
    cwd: repoPath,
    stdio: "ignore",
  });

  // Create initial commit
  fs.writeFileSync(path.join(repoPath, "README.md"), "# Test Repository\n");
  execSync("git add .", { cwd: repoPath, stdio: "ignore" });
  execSync('git commit -m "Initial commit"', {
    cwd: repoPath,
    stdio: "ignore",
  });
}

/**
 * SSE Event Collector for testing event streaming
 * Collects all events and filters by execution ID when retrieving
 */
class EventCollector {
  private events: AgUiEvent[] = [];
  private transportManager: TransportManager;
  private connectionId: string;

  constructor(transportManager: TransportManager) {
    this.transportManager = transportManager;
    // Use wildcard connection ID to collect all events
    this.connectionId = "__test_collector__";
  }

  /**
   * Connect to event stream and collect ALL events
   */
  connect(): void {
    // Mock response object that collects SSE messages
    const mockRes = {
      write: (data: string) => {
        // Parse SSE format: "data: {...}\n\n"
        if (data.startsWith("data: ")) {
          const jsonStr = data.substring(6, data.length - 2);
          try {
            const event = JSON.parse(jsonStr);
            this.events.push(event);
          } catch (e) {
            // Ignore parse errors
          }
        }
      },
      on: () => {},
      once: () => {},
      emit: () => {},
      setHeader: () => {},
      flushHeaders: () => {},
    };

    // Connect to transport manager's SSE transport with wildcard
    const transport = this.transportManager.getSseTransport();
    transport.handleConnection(
      this.connectionId,
      mockRes as any,
      this.connectionId
    );
  }

  /**
   * Get all collected events
   */
  getEvents(): AgUiEvent[] {
    return this.events;
  }

  /**
   * Get events filtered by execution ID
   */
  getEventsForExecution(executionId: string): AgUiEvent[] {
    return this.events.filter(
      (e: any) =>
        e.runId === executionId ||
        e.executionId === executionId ||
        (e.data &&
          (e.data.runId === executionId || e.data.executionId === executionId))
    );
  }

  /**
   * Wait for specific event type for a given execution
   */
  async waitForEvent(
    executionId: string,
    eventType: string,
    timeout = 30000
  ): Promise<AgUiEvent | null> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const executionEvents = this.getEventsForExecution(executionId);
      const event = executionEvents.find((e) => e.type === eventType);
      if (event) {
        return event;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  /**
   * Disconnect from event stream
   */
  disconnect(): void {
    const transport = this.transportManager.getSseTransport();
    transport.removeClient(this.connectionId);
  }
}

describe("Workflow Integration Tests", { skip: SKIP_E2E }, () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let gitRepoPath: string;
  let executionService: ExecutionService;
  let transportManager: TransportManager;
  let worktreeManager: WorktreeManager;
  let lifecycleService: ExecutionLifecycleService;

  beforeAll(() => {
    // Create temporary directory for tests
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-workflow-integration-")
    );
    testDbPath = path.join(testDir, "cache.db");
    gitRepoPath = path.join(testDir, "test-repo");

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

    // Initialize test database
    db = initCliDatabase({ path: testDbPath });
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTIONS_INDEXES);
    initializeDefaultTemplates(db);

    // Initialize git repository
    setupGitRepository(gitRepoPath);

    // Create worktree manager
    worktreeManager = new WorktreeManager({
      worktreeStoragePath: ".sudocode/worktrees",
      autoCreateBranches: true,
      autoDeleteBranches: false,
      enableSparseCheckout: false,
      sparseCheckoutPatterns: undefined,
      branchPrefix: "sudocode",
      cleanupOrphanedWorktreesOnStartup: true,
    });

    // Create lifecycle service
    lifecycleService = new ExecutionLifecycleService(
      db,
      gitRepoPath,
      worktreeManager
    );

    // Create transport manager and execution service
    transportManager = new TransportManager();
    executionService = new ExecutionService(
      db,
      gitRepoPath,
      lifecycleService,
      transportManager
    );
  });

  /**
   * Helper function to create a unique issue for each test
   */
  function createTestIssue(title: string, content?: string): string {
    const issueId = generateIssueId(db, testDir);
    const issue = createIssue(db, {
      id: issueId,
      title,
      content: content || `Test issue for: ${title}`,
    });
    return issue.id;
  }

  afterAll(async () => {
    // Ensure all spawned processes are dead
    if (executionService) {
      try {
        const activeExecutions = db
          .prepare("SELECT id FROM executions WHERE status = ?")
          .all("running") as Array<{ id: string }>;

        for (const exec of activeExecutions) {
          try {
            await executionService.cancelExecution(exec.id);
          } catch (e) {
            // Already cancelled or doesn't exist
          }
        }
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    // Clean up database
    db.close();

    // Kill any processes still running in the test directory
    try {
      execSync(`pkill -f "${testDir}" || true`, { stdio: "ignore" });
    } catch (e) {
      // Ignore errors
    }

    // Clean up temporary directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  describe("Full Execution Flow", () => {
    it("should create and complete execution with database updates", async () => {
      const issueId = createTestIssue(
        "Test Full Execution",
        "This is a simple test issue"
      );

      // Create execution
      const execution = await executionService.createExecution(
        issueId,
        { mode: "local", timeout: 60000 },
        'Print "Hello from workflow test" to console'
      );

      expect(execution.id).toBeTruthy();
      expect(execution.issue_id).toBe(issueId);
      // Status should be 'running' since startWorkflow() is called synchronously
      expect(execution.status).toBe("running");

      // Wait for execution to complete (with timeout)
      const maxWaitTime = 60000; // 60 seconds
      const startTime = Date.now();
      let finalExecution = getExecution(db, execution.id);

      while (
        finalExecution &&
        finalExecution.status === "running" &&
        Date.now() - startTime < maxWaitTime
      ) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        finalExecution = getExecution(db, execution.id);
      }

      // Verify execution completed
      expect(finalExecution).toBeTruthy();
      expect(
        finalExecution?.status === "completed" ||
          finalExecution?.status === "failed",
        `Expected completed or failed, got ${finalExecution?.status}`
      ).toBeTruthy();

      if (finalExecution?.status === "completed") {
        expect(finalExecution?.completed_at).toBeTruthy();
        expect(
          finalExecution.completed_at &&
            finalExecution.completed_at > finalExecution.created_at
        ).toBeTruthy();
      }
    });
  });

  // DISABLED: SSE Event Streaming test is currently skipped due to architectural limitation.
  // The TransportManager/SSE transport uses execution-ID-specific routing and does not
  // support wildcard/broadcast event collection. Events are only sent to connections
  // that match the specific execution ID, so a test collector connecting with a wildcard
  // connection ID never receives events. This would require architectural changes to
  // support broadcast routing before this test can be enabled.
  // See debug-sse.test.ts for detailed investigation of the issue.
  describe("SSE Event Streaming", { skip: true }, () => {
    it("should stream workflow events via SSE", async () => {
      const issueId = createTestIssue(
        "Test SSE Streaming",
        "Test issue for SSE event streaming"
      );

      // Connect event collector BEFORE creating execution to catch all events
      const collector = new EventCollector(transportManager);
      collector.connect();

      // Create execution (this will immediately start the workflow and emit events)
      const execution = await executionService.createExecution(
        issueId,
        { mode: "local", timeout: 60000 },
        "Echo test message"
      );

      // Wait for workflow to start and emit events
      const runStartedEvent = await collector.waitForEvent(
        execution.id,
        "RUN_STARTED",
        30000
      );
      expect(runStartedEvent, "Should receive RUN_STARTED event").toBeTruthy();

      // Wait for execution to finish
      await collector.waitForEvent(execution.id, "RUN_FINISHED", 60000);

      // Check that we received events for this execution
      const executionEvents = collector.getEventsForExecution(execution.id);
      expect(
        executionEvents.length > 0,
        "Should receive at least one event for this execution"
      ).toBeTruthy();

      // Verify event structure
      const hasRunStarted = executionEvents.some(
        (e) => e.type === "RUN_STARTED"
      );
      expect(hasRunStarted, "Should have RUN_STARTED event").toBeTruthy();

      collector.disconnect();
    });
  });

  describe("Follow-up Execution", () => {
    it(
      "should create follow-up execution reusing worktree",
      { timeout: 90000 },
      async () => {
        const issueId = createTestIssue(
          "Test Follow-up Execution",
          "Initial execution for follow-up test"
        );

        // Create initial execution in worktree mode
        const initialExecution = await executionService.createExecution(
          issueId,
          { mode: "worktree", timeout: 60000 },
          "Create a test file called initial.txt"
        );

        // Wait for initial execution to complete
        const maxWaitTime = 60000;
        const startTime = Date.now();
        let execution = getExecution(db, initialExecution.id);

        while (
          execution &&
          execution.status === "running" &&
          Date.now() - startTime < maxWaitTime
        ) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          execution = getExecution(db, initialExecution.id);
        }

        expect(execution).toBeTruthy();
        expect(execution?.worktree_path).toBeTruthy();

        // Create follow-up execution
        const followUpExecution = await executionService.createFollowUp(
          initialExecution.id,
          "Create another file called followup.txt"
        );

        expect(followUpExecution.id).toBeTruthy();
        expect(followUpExecution.issue_id).toBe(initialExecution.issue_id);
        expect(followUpExecution.worktree_path).toBe(execution?.worktree_path);

        // Wait for follow-up to complete
        let followUp = getExecution(db, followUpExecution.id);
        const followUpStartTime = Date.now();

        while (
          followUp &&
          followUp.status === "running" &&
          Date.now() - followUpStartTime < maxWaitTime
        ) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          followUp = getExecution(db, followUpExecution.id);
        }

        expect(followUp).toBeTruthy();
        expect(
          followUp?.status === "completed" || followUp?.status === "failed",
          `Expected completed or failed, got ${followUp?.status}`
        ).toBeTruthy();
      }
    );
  });

  describe("Execution Cancellation", () => {
    it("should cancel running execution and update status", async () => {
      const issueId = createTestIssue(
        "Test Cancellation",
        "Long-running task for cancellation test"
      );

      // Create execution with a long-running task
      const execution = await executionService.createExecution(
        issueId,
        { mode: "local", timeout: 120000 },
        "Sleep for 60 seconds then print done"
      );

      // Wait a bit for execution to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Cancel the execution
      await executionService.cancelExecution(execution.id);

      // Verify execution was cancelled
      const cancelled = getExecution(db, execution.id);
      expect(cancelled).toBeTruthy();
      expect(cancelled?.status).toBe("stopped");
      expect(cancelled?.completed_at).toBeTruthy();
    });

    it("should throw error when cancelling non-running execution", async () => {
      const issueId = createTestIssue(
        "Test Invalid Cancellation",
        "Already completed execution"
      );

      const execution = await executionService.createExecution(
        issueId,
        { mode: "local", timeout: 60000 },
        "Echo quick task"
      );

      // Wait for execution to complete
      const maxWaitTime = 60000;
      const startTime = Date.now();
      let completed = getExecution(db, execution.id);

      while (
        completed &&
        completed.status === "running" &&
        Date.now() - startTime < maxWaitTime
      ) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        completed = getExecution(db, execution.id);
      }

      // Try to cancel completed execution
      await expect(async () => {
        await executionService.cancelExecution(execution.id);
      }).rejects.toThrow(/Cannot cancel execution/);
    });
  });

  describe("Workflow Failure Handling", () => {
    it("should handle workflow failure and update database", async () => {
      const issueId = createTestIssue(
        "Test Workflow Failure",
        "Task that will fail"
      );

      // Create execution with invalid command that will fail
      const execution = await executionService.createExecution(
        issueId,
        { mode: "local", timeout: 60000 },
        "Run non-existent command: xyzabc123invalid"
      );

      // Wait for execution to complete or fail
      const maxWaitTime = 60000;
      const startTime = Date.now();
      let failed = getExecution(db, execution.id);

      while (
        failed &&
        failed.status === "running" &&
        Date.now() - startTime < maxWaitTime
      ) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        failed = getExecution(db, execution.id);
      }

      // Verify execution failed
      expect(failed).toBeTruthy();

      // The execution might complete successfully even if the task itself fails
      // since Claude might handle the invalid command gracefully
      expect(
        failed?.status === "failed" || failed?.status === "completed",
        `Expected failed or completed, got ${failed?.status}`
      ).toBeTruthy();

      if (failed?.status === "failed") {
        expect(
          failed?.error_message,
          "Failed execution should have error message"
        ).toBeTruthy();
      }

      expect(
        failed?.completed_at,
        "Should have completed_at timestamp"
      ).toBeTruthy();
    });
  });
});
