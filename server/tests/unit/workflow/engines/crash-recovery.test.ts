/**
 * Crash Recovery Tests
 *
 * Tests for OrchestratorWorkflowEngine's crash recovery functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { OrchestratorWorkflowEngine } from "../../../../src/workflow/engines/orchestrator-engine.js";
import { WorkflowWakeupService } from "../../../../src/workflow/services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../../../../src/workflow/services/prompt-builder.js";
import { WorkflowEventEmitter } from "../../../../src/workflow/workflow-event-emitter.js";
import type { ExecutionService } from "../../../../src/services/execution-service.js";

describe("Crash Recovery", () => {
  let db: Database.Database;
  let mockExecutionService: ExecutionService;
  let wakeupService: WorkflowWakeupService;
  let eventEmitter: WorkflowEventEmitter;
  let engine: OrchestratorWorkflowEngine;

  beforeEach(() => {
    // Create in-memory database with required tables
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        steps TEXT NOT NULL DEFAULT '[]',
        worktree_path TEXT,
        branch_name TEXT,
        base_branch TEXT NOT NULL,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        orchestrator_execution_id TEXT,
        orchestrator_session_id TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE workflow_events (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        type TEXT NOT NULL,
        step_id TEXT,
        execution_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        processed_at TEXT
      );

      CREATE TABLE executions (
        id TEXT PRIMARY KEY,
        issue_id TEXT,
        issue_uuid TEXT,
        agent_type TEXT NOT NULL,
        mode TEXT,
        prompt TEXT,
        config TEXT,
        status TEXT NOT NULL,
        session_id TEXT,
        started_at TEXT,
        completed_at TEXT,
        exit_code INTEGER,
        error_message TEXT,
        before_commit TEXT,
        after_commit TEXT,
        target_branch TEXT,
        branch_name TEXT,
        worktree_path TEXT,
        parent_execution_id TEXT,
        summary TEXT,
        files_changed TEXT,
        workflow_execution_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT
      );

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        from_uuid TEXT NOT NULL,
        from_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        to_uuid TEXT NOT NULL,
        to_type TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE specs (
        id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT
      );
    `);

    // Mock execution service
    mockExecutionService = {
      cancelExecution: vi.fn().mockResolvedValue(undefined),
      createExecution: vi.fn().mockResolvedValue({
        id: "exec-new",
        session_id: "session-new",
        status: "running",
        branch_name: "test-branch",
      }),
      createFollowUp: vi.fn().mockResolvedValue({
        id: "follow-up-123",
        session_id: "session-123",
      }),
    } as unknown as ExecutionService;

    eventEmitter = new WorkflowEventEmitter();

    wakeupService = new WorkflowWakeupService({
      db,
      executionService: mockExecutionService,
      promptBuilder: new WorkflowPromptBuilder(),
      eventEmitter,
      config: { batchWindowMs: 1000 },
    });

    engine = new OrchestratorWorkflowEngine({
      db,
      executionService: mockExecutionService,
      wakeupService,
      eventEmitter,
      config: {
        repoPath: "/test/repo",
        dbPath: "/test/.sudocode/cache.db",
      },
    });
  });

  afterEach(() => {
    engine.dispose();
    wakeupService.stop();
    db.close();
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  function insertWorkflow(data: {
    id: string;
    status: string;
    orchestratorExecutionId?: string;
    steps?: Array<{ id: string; issueId: string; status: string }>;
  }) {
    const now = new Date().toISOString();
    const steps = JSON.stringify(
      data.steps || [{ id: "step-1", issueId: "i-abc", status: "pending", index: 0, dependencies: [] }]
    );

    db.prepare(`
      INSERT INTO workflows (
        id, title, source, status, steps, base_branch,
        orchestrator_execution_id, config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      "Test Workflow",
      JSON.stringify({ type: "goal", goal: "Test" }),
      data.status,
      steps,
      "main",
      data.orchestratorExecutionId || null,
      "{}",
      now,
      now
    );
  }

  function insertExecution(data: {
    id: string;
    status: string;
    workflowExecutionId?: string;
  }) {
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO executions (
        id, agent_type, status, workflow_execution_id,
        target_branch, branch_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      "claude-code",
      data.status,
      data.workflowExecutionId || null,
      "main",
      "test-branch",
      now,
      now
    );
  }

  // ===========================================================================
  // Orphaned Workflow Detection
  // ===========================================================================

  describe("orphaned workflow detection", () => {
    it("should detect workflows with dead orchestrator", async () => {
      // Workflow is running but orchestrator execution is completed
      insertWorkflow({
        id: "wf-orphan",
        status: "running",
        orchestratorExecutionId: "exec-dead",
      });

      insertExecution({
        id: "exec-dead",
        status: "completed", // Orchestrator is dead
      });

      const consoleSpy = vi.spyOn(console, "log");

      await engine.recoverOrphanedWorkflows();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Recovering workflow wf-orphan")
      );
    });

    it("should skip workflows with running orchestrator", async () => {
      insertWorkflow({
        id: "wf-healthy",
        status: "running",
        orchestratorExecutionId: "exec-running",
      });

      insertExecution({
        id: "exec-running",
        status: "running", // Orchestrator is still running
      });

      const consoleSpy = vi.spyOn(console, "log");

      await engine.recoverOrphanedWorkflows();

      // Should not attempt recovery
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Recovering workflow wf-healthy")
      );
    });

    it("should skip workflows without orchestrator execution", async () => {
      insertWorkflow({
        id: "wf-no-orch",
        status: "running",
        // No orchestratorExecutionId
      });

      const consoleSpy = vi.spyOn(console, "warn");

      await engine.recoverOrphanedWorkflows();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("running but no orchestrator")
      );
    });

    it("should skip workflows not in running status", async () => {
      insertWorkflow({
        id: "wf-pending",
        status: "pending",
        orchestratorExecutionId: "exec-123",
      });

      insertWorkflow({
        id: "wf-completed",
        status: "completed",
        orchestratorExecutionId: "exec-456",
      });

      const consoleSpy = vi.spyOn(console, "log");

      await engine.recoverOrphanedWorkflows();

      // Recovery count should be 0
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Recovery complete: 0/0")
      );
    });
  });

  // ===========================================================================
  // Recovery Actions
  // ===========================================================================

  describe("recovery actions", () => {
    it("should record recovery event", async () => {
      insertWorkflow({
        id: "wf-orphan",
        status: "running",
        orchestratorExecutionId: "exec-dead",
      });

      insertExecution({
        id: "exec-dead",
        status: "failed",
      });

      await engine.recoverOrphanedWorkflows();

      // Check event was recorded
      const events = db
        .prepare("SELECT * FROM workflow_events WHERE workflow_id = ?")
        .all("wf-orphan") as Array<{
          type: string;
          payload: string;
        }>;

      expect(events.length).toBeGreaterThanOrEqual(1);
      const recoveryEvent = events.find((e) => e.type === "orchestrator_wakeup");
      expect(recoveryEvent).toBeDefined();

      const payload = JSON.parse(recoveryEvent!.payload);
      expect(payload.reason).toBe("recovery");
      expect(payload.previousStatus).toBe("failed");
    });

    it("should handle recovery errors gracefully", async () => {
      insertWorkflow({
        id: "wf-orphan",
        status: "running",
        orchestratorExecutionId: "exec-dead",
      });

      insertExecution({
        id: "exec-dead",
        status: "failed",
      });

      // Make wakeup fail
      vi.spyOn(wakeupService, "triggerWakeup").mockRejectedValue(
        new Error("Wakeup failed")
      );

      const consoleSpy = vi.spyOn(console, "error");

      // Should not throw
      await expect(engine.recoverOrphanedWorkflows()).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to recover workflow"),
        expect.any(Error)
      );
    });

    it("should recover multiple orphaned workflows", async () => {
      insertWorkflow({
        id: "wf-orphan-1",
        status: "running",
        orchestratorExecutionId: "exec-dead-1",
      });

      insertWorkflow({
        id: "wf-orphan-2",
        status: "running",
        orchestratorExecutionId: "exec-dead-2",
      });

      insertExecution({ id: "exec-dead-1", status: "failed" });
      insertExecution({ id: "exec-dead-2", status: "completed" });

      const consoleSpy = vi.spyOn(console, "log");

      await engine.recoverOrphanedWorkflows();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Recovery complete: 2/2")
      );
    });
  });

  // ===========================================================================
  // Stale Execution Cleanup
  // ===========================================================================

  describe("stale execution cleanup", () => {
    it("should mark stale running executions as failed", async () => {
      // Execution was running when server crashed
      insertExecution({
        id: "exec-stale",
        status: "running",
        workflowExecutionId: "wf-123",
      });

      await engine.markStaleExecutionsAsFailed();

      const exec = db
        .prepare("SELECT status, error_message FROM executions WHERE id = ?")
        .get("exec-stale") as { status: string; error_message: string };

      expect(exec.status).toBe("failed");
      expect(exec.error_message).toContain("server restarted");
    });

    it("should not affect executions without workflow context", async () => {
      insertExecution({
        id: "exec-no-wf",
        status: "running",
        // No workflowExecutionId
      });

      await engine.markStaleExecutionsAsFailed();

      const exec = db
        .prepare("SELECT status FROM executions WHERE id = ?")
        .get("exec-no-wf") as { status: string };

      expect(exec.status).toBe("running"); // Unchanged
    });

    it("should handle multiple stale executions", async () => {
      insertExecution({
        id: "exec-stale-1",
        status: "running",
        workflowExecutionId: "wf-1",
      });

      insertExecution({
        id: "exec-stale-2",
        status: "running",
        workflowExecutionId: "wf-2",
      });

      const consoleSpy = vi.spyOn(console, "log");

      await engine.markStaleExecutionsAsFailed();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Marked 2 stale executions as failed")
      );
    });

    it("should not log when no stale executions found", async () => {
      // No stale executions
      const consoleSpy = vi.spyOn(console, "log");

      await engine.markStaleExecutionsAsFailed();

      // Should only log the "Checking for stale executions" message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Checking for stale executions")
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Marked")
      );
    });
  });
});
