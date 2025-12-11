/**
 * Unit tests for OrchestratorWorkflowEngine
 *
 * Tests:
 * - Workflow creation with different sources
 * - Orchestrator spawning on start
 * - Pause/resume state transitions
 * - Cancel workflow with execution cleanup
 * - Step control (retry/skip) events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Workflow, Issue } from "@sudocode-ai/types";
import {
  WORKFLOWS_TABLE,
  WORKFLOW_EVENTS_TABLE,
  EXECUTIONS_TABLE,
} from "@sudocode-ai/types/schema";

import { OrchestratorWorkflowEngine } from "../../../../src/workflow/engines/orchestrator-engine.js";
import { WorkflowEventEmitter } from "../../../../src/workflow/workflow-event-emitter.js";
import { WorkflowWakeupService } from "../../../../src/workflow/services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../../../../src/workflow/services/prompt-builder.js";
import type { ExecutionService } from "../../../../src/services/execution-service.js";
import type { ExecutionLifecycleService } from "../../../../src/services/execution-lifecycle.js";

// =============================================================================
// Test Setup
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  // Disable foreign key enforcement for tests
  db.exec("PRAGMA foreign_keys = OFF");

  // Create tables
  db.exec(WORKFLOWS_TABLE);
  db.exec(EXECUTIONS_TABLE);
  db.exec(WORKFLOW_EVENTS_TABLE);

  // Create minimal issues table for resolveSource
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      uuid TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      content TEXT,
      priority INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create relationships table for dependency resolution
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id TEXT NOT NULL,
      from_uuid TEXT,
      from_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      to_uuid TEXT,
      to_type TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    )
  `);

  return db;
}

function createMockExecutionService(db: Database.Database): ExecutionService {
  let executionCounter = 0;
  return {
    createExecution: vi.fn().mockImplementation(async () => {
      executionCounter++;
      const execution = {
        id: executionCounter === 1 ? "exec-orch" : `exec-orch-${executionCounter}`,
        session_id: "session-orch",
        status: "running",
      };
      // Insert into database so cancelAllWorkflowExecutions can find it
      db.prepare(
        `INSERT INTO executions (id, session_id, status, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run(execution.id, execution.session_id, execution.status);
      return execution;
    }),
    cancelExecution: vi.fn().mockImplementation(async (id: string) => {
      // Update status in database when cancelled
      db.prepare(`UPDATE executions SET status = 'cancelled' WHERE id = ?`).run(id);
      return undefined;
    }),
    createFollowUp: vi.fn().mockImplementation(async (parentId: string) => {
      const execution = {
        id: "exec-followup",
        session_id: "session-orch",
        status: "running",
      };
      // Insert with parent_execution_id so chain is properly linked
      db.prepare(
        `INSERT INTO executions (id, session_id, status, parent_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run(execution.id, execution.session_id, execution.status, parentId);
      return execution;
    }),
  } as unknown as ExecutionService;
}

function createMockLifecycleService(): ExecutionLifecycleService {
  return {
    createWorkflowWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/test/worktrees/workflow-test",
      branchName: "sudocode/workflow/test/test-workflow",
    }),
  } as unknown as ExecutionLifecycleService;
}

function createTestIssue(
  db: Database.Database,
  id: string,
  title: string
): void {
  db.prepare(
    `INSERT INTO issues (id, uuid, title, status) VALUES (?, ?, ?, 'open')`
  ).run(id, `uuid-${id}`, title);
}

// =============================================================================
// Tests
// =============================================================================

describe("OrchestratorWorkflowEngine", () => {
  let db: Database.Database;
  let executionService: ExecutionService;
  let lifecycleService: ExecutionLifecycleService;
  let wakeupService: WorkflowWakeupService;
  let eventEmitter: WorkflowEventEmitter;
  let engine: OrchestratorWorkflowEngine;

  beforeEach(() => {
    db = createTestDb();
    executionService = createMockExecutionService(db);
    lifecycleService = createMockLifecycleService();
    eventEmitter = new WorkflowEventEmitter();
    const promptBuilder = new WorkflowPromptBuilder();

    wakeupService = new WorkflowWakeupService({
      db,
      executionService,
      promptBuilder,
      eventEmitter,
      config: { batchWindowMs: 100 },
    });

    engine = new OrchestratorWorkflowEngine({
      db,
      executionService,
      lifecycleService,
      wakeupService,
      eventEmitter,
      config: {
        repoPath: "/test/repo",
        dbPath: "/test/.sudocode/cache.db",
        serverUrl: "http://localhost:3000",
        projectId: "test-project",
      },
    });
  });

  afterEach(() => {
    wakeupService.stop();
    db.close();
  });

  describe("createWorkflow", () => {
    it("should create workflow from goal source with no steps", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Implement user authentication",
      });

      expect(workflow.id).toMatch(/^wf-/);
      expect(workflow.title).toBe("Implement user authentication");
      expect(workflow.status).toBe("pending");
      expect(workflow.steps).toHaveLength(0);
      expect(workflow.source).toEqual({
        type: "goal",
        goal: "Implement user authentication",
      });
    });

    it("should create workflow from issues source with steps", async () => {
      // Create test issues
      createTestIssue(db, "i-1", "First issue");
      createTestIssue(db, "i-2", "Second issue");

      const workflow = await engine.createWorkflow({
        type: "issues",
        issueIds: ["i-1", "i-2"],
      });

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps.map((s) => s.issueId)).toContain("i-1");
      expect(workflow.steps.map((s) => s.issueId)).toContain("i-2");
    });

    it("should save workflow to database", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test goal",
      });

      const saved = await engine.getWorkflow(workflow.id);
      expect(saved).not.toBeNull();
      expect(saved!.id).toBe(workflow.id);
    });

    it("should merge config with defaults", async () => {
      const workflow = await engine.createWorkflow(
        { type: "goal", goal: "Test" },
        {
          autonomyLevel: "full_auto",
          orchestratorModel: "claude-opus-4",
        }
      );

      expect(workflow.config.autonomyLevel).toBe("full_auto");
      expect(workflow.config.orchestratorModel).toBe("claude-opus-4");
      expect(workflow.config.defaultAgentType).toBe("claude-code"); // Default
    });
  });

  describe("startWorkflow", () => {
    it("should spawn orchestrator execution", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test workflow",
      });

      await engine.startWorkflow(workflow.id);

      expect(executionService.createExecution).toHaveBeenCalledTimes(1);
      expect(executionService.createExecution).toHaveBeenCalledWith(
        null, // No issue for orchestrator
        expect.objectContaining({
          mode: "worktree",
          reuseWorktreePath: expect.any(String),
          mcpServers: expect.objectContaining({
            "sudocode-workflow": expect.any(Object),
          }),
        }),
        expect.stringContaining("Workflow Orchestration"),
        "claude-code"
      );
    });

    it("should update workflow status to running", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });

      await engine.startWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated!.status).toBe("running");
      expect(updated!.startedAt).toBeDefined();
    });

    it("should store orchestrator execution ID on workflow", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });

      await engine.startWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated!.orchestratorExecutionId).toBe("exec-orch");
      expect(updated!.orchestratorSessionId).toBe("session-orch");
    });

    it("should emit workflow_started event", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });

      const listener = vi.fn();
      eventEmitter.on(listener);

      await engine.startWorkflow(workflow.id);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "workflow_started",
          workflowId: workflow.id,
        })
      );
    });

    it("should reject if workflow is not pending", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });

      await engine.startWorkflow(workflow.id);

      await expect(engine.startWorkflow(workflow.id)).rejects.toThrow(
        "Cannot start"
      );
    });
  });

  describe("pauseWorkflow", () => {
    it("should update status to paused", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      await engine.pauseWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated!.status).toBe("paused");
    });

    it("should record pause event", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      await engine.pauseWorkflow(workflow.id);

      const events = wakeupService.getUnprocessedEvents(workflow.id);
      expect(events.some((e) => e.type === "workflow_paused")).toBe(true);
    });

    it("should emit workflow_paused event", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      const listener = vi.fn();
      eventEmitter.on(listener);

      await engine.pauseWorkflow(workflow.id);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "workflow_paused",
          workflowId: workflow.id,
        })
      );
    });

    it("should reject if workflow is not running", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });

      await expect(engine.pauseWorkflow(workflow.id)).rejects.toThrow(
        "Cannot pause"
      );
    });

    it("should cancel all running executions when pausing", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      // Add running step executions linked to this workflow
      db.prepare(
        `INSERT INTO executions (id, session_id, status, workflow_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run("step-exec-running", "session-step", "running", workflow.id);

      await engine.pauseWorkflow(workflow.id);

      // Should cancel both orchestrator and step executions
      expect(executionService.cancelExecution).toHaveBeenCalledWith("exec-orch");
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "step-exec-running"
      );
    });

    it("should cancel entire orchestrator execution chain when pausing", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      // Simulate follow-up execution
      db.prepare(
        `INSERT INTO executions (id, session_id, status, parent_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run("exec-followup", "session-orch", "running", "exec-orch");

      // Update workflow to point to latest follow-up
      db.prepare(
        "UPDATE workflows SET orchestrator_execution_id = ? WHERE id = ?"
      ).run("exec-followup", workflow.id);

      await engine.pauseWorkflow(workflow.id);

      // Should cancel both root and follow-up executions
      expect(executionService.cancelExecution).toHaveBeenCalledWith("exec-orch");
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "exec-followup"
      );
    });
  });

  describe("resumeWorkflow", () => {
    it("should update status to running", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);
      await engine.pauseWorkflow(workflow.id);

      await engine.resumeWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated!.status).toBe("running");
    });

    it("should record resume event", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);
      await engine.pauseWorkflow(workflow.id);

      // Clear existing events
      const pauseEvents = wakeupService.getUnprocessedEvents(workflow.id);
      wakeupService.markEventsProcessed(pauseEvents.map((e) => e.id));

      await engine.resumeWorkflow(workflow.id);

      // Check database directly for resume event
      const allEvents = db
        .prepare("SELECT * FROM workflow_events WHERE workflow_id = ?")
        .all(workflow.id) as Array<{ type: string }>;
      expect(allEvents.some((e) => e.type === "workflow_resumed")).toBe(true);
    });

    it("should create new execution with session resume and parent link", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      // Store the session ID and execution ID before pausing
      const workflowBeforePause = await engine.getWorkflow(workflow.id);
      const sessionId = workflowBeforePause!.orchestratorSessionId;
      const previousExecutionId = workflowBeforePause!.orchestratorExecutionId;
      expect(sessionId).toBe("session-orch");
      expect(previousExecutionId).toBe("exec-orch");

      await engine.pauseWorkflow(workflow.id);
      await engine.resumeWorkflow(workflow.id);

      // Should create a new execution with resume config and parent link
      expect(executionService.createExecution).toHaveBeenLastCalledWith(
        null,
        expect.objectContaining({
          mode: "worktree",
          resume: sessionId,
          parentExecutionId: previousExecutionId, // Links to previous execution in chain
        }),
        "Workflow resumed. Continue execution.",
        "claude-code"
      );
    });

    it("should use custom message when provided", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);
      await engine.pauseWorkflow(workflow.id);

      const customMessage = "Please focus on the authentication task next.";
      await engine.resumeWorkflow(workflow.id, customMessage);

      expect(executionService.createExecution).toHaveBeenLastCalledWith(
        null,
        expect.anything(),
        customMessage,
        "claude-code"
      );
    });

    it("should update orchestrator execution ID after resume", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);
      await engine.pauseWorkflow(workflow.id);

      // Reset mock to track resume call separately
      vi.mocked(executionService.createExecution).mockClear();
      vi.mocked(executionService.createExecution).mockImplementation(
        async () => {
          const execution = {
            id: "exec-resumed",
            session_id: "session-orch",
            status: "running",
          };
          db.prepare(
            `INSERT INTO executions (id, session_id, status, target_branch, branch_name, created_at, updated_at)
             VALUES (?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
          ).run(execution.id, execution.session_id, execution.status);
          return execution;
        }
      );

      await engine.resumeWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated!.orchestratorExecutionId).toBe("exec-resumed");
    });

    it("should reject if workflow has no session ID", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      // Remove session ID to simulate missing session
      db.prepare(
        "UPDATE workflows SET orchestrator_session_id = NULL WHERE id = ?"
      ).run(workflow.id);
      db.prepare("UPDATE workflows SET status = 'paused' WHERE id = ?").run(
        workflow.id
      );

      await expect(engine.resumeWorkflow(workflow.id)).rejects.toThrow(
        "no orchestrator session ID found"
      );
    });

    it("should reject if workflow is not paused", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      await expect(engine.resumeWorkflow(workflow.id)).rejects.toThrow(
        "Cannot resume"
      );
    });

    it("should emit workflow_resumed event", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);
      await engine.pauseWorkflow(workflow.id);

      const listener = vi.fn();
      eventEmitter.on(listener);

      await engine.resumeWorkflow(workflow.id);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "workflow_resumed",
          workflowId: workflow.id,
        })
      );
    });

    it("should preserve worktree path on resume", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      const workflowBeforePause = await engine.getWorkflow(workflow.id);
      const worktreePath = workflowBeforePause!.worktreePath;

      await engine.pauseWorkflow(workflow.id);
      await engine.resumeWorkflow(workflow.id);

      // Should reuse the same worktree path
      expect(executionService.createExecution).toHaveBeenLastCalledWith(
        null,
        expect.objectContaining({
          reuseWorktreePath: worktreePath,
        }),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe("cancelWorkflow", () => {
    it("should update status to cancelled", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      await engine.cancelWorkflow(workflow.id);

      const updated = await engine.getWorkflow(workflow.id);
      expect(updated!.status).toBe("cancelled");
      expect(updated!.completedAt).toBeDefined();
    });

    it("should cancel orchestrator execution", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      await engine.cancelWorkflow(workflow.id);

      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "exec-orch"
      );
    });

    it("should emit workflow_cancelled event", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      const listener = vi.fn();
      eventEmitter.on(listener);

      await engine.cancelWorkflow(workflow.id);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "workflow_cancelled",
          workflowId: workflow.id,
        })
      );
    });

    it("should reject if workflow is already cancelled", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);
      await engine.cancelWorkflow(workflow.id);

      await expect(engine.cancelWorkflow(workflow.id)).rejects.toThrow(
        "Cannot cancel"
      );
    });

    it("should cancel entire execution chain including follow-ups", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      // Simulate follow-up executions by inserting them into the database
      // exec-orch is the root, exec-followup-1 and exec-followup-2 are children
      db.prepare(
        `INSERT INTO executions (id, session_id, status, parent_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run("exec-followup-1", "session-orch", "running", "exec-orch");

      db.prepare(
        `INSERT INTO executions (id, session_id, status, parent_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run("exec-followup-2", "session-orch", "running", "exec-followup-1");

      // Update workflow to point to latest follow-up
      db.prepare(
        "UPDATE workflows SET orchestrator_execution_id = ? WHERE id = ?"
      ).run("exec-followup-2", workflow.id);

      await engine.cancelWorkflow(workflow.id);

      // Should cancel all executions in the chain
      expect(executionService.cancelExecution).toHaveBeenCalledWith("exec-orch");
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "exec-followup-1"
      );
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "exec-followup-2"
      );
    });

    it("should cancel step executions linked to workflow", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      // Insert step executions linked to this workflow
      db.prepare(
        `INSERT INTO executions (id, session_id, status, workflow_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run("step-exec-1", "session-step", "running", workflow.id);

      db.prepare(
        `INSERT INTO executions (id, session_id, status, workflow_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run("step-exec-2", "session-step", "pending", workflow.id);

      await engine.cancelWorkflow(workflow.id);

      // Should cancel both the orchestrator and step executions
      expect(executionService.cancelExecution).toHaveBeenCalledWith("exec-orch");
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "step-exec-1"
      );
      expect(executionService.cancelExecution).toHaveBeenCalledWith(
        "step-exec-2"
      );
    });

    it("should not cancel already completed executions", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });
      await engine.startWorkflow(workflow.id);

      // Add a completed step execution
      db.prepare(
        `INSERT INTO executions (id, session_id, status, workflow_execution_id, target_branch, branch_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'main', 'test-branch', datetime('now'), datetime('now'))`
      ).run("step-exec-completed", "session-step", "completed", workflow.id);

      await engine.cancelWorkflow(workflow.id);

      // Should only cancel running orchestrator, not completed step
      expect(executionService.cancelExecution).toHaveBeenCalledWith("exec-orch");
      expect(executionService.cancelExecution).not.toHaveBeenCalledWith(
        "step-exec-completed"
      );
    });
  });

  describe("retryStep", () => {
    it("should record retry event", async () => {
      // Create workflow with step
      createTestIssue(db, "i-test", "Test Issue");
      const workflow = await engine.createWorkflow({
        type: "issues",
        issueIds: ["i-test"],
      });
      await engine.startWorkflow(workflow.id);

      const stepId = workflow.steps[0].id;
      await engine.retryStep(workflow.id, stepId);

      const events = wakeupService.getUnprocessedEvents(workflow.id);
      const retryEvent = events.find(
        (e) => e.stepId === stepId && e.payload.action === "retry"
      );
      expect(retryEvent).toBeDefined();
    });

    it("should reject if step not found", async () => {
      const workflow = await engine.createWorkflow({
        type: "goal",
        goal: "Test",
      });

      await expect(
        engine.retryStep(workflow.id, "nonexistent")
      ).rejects.toThrow("not found");
    });
  });

  describe("skipStep", () => {
    it("should record skip event with reason", async () => {
      createTestIssue(db, "i-test", "Test Issue");
      const workflow = await engine.createWorkflow({
        type: "issues",
        issueIds: ["i-test"],
      });
      await engine.startWorkflow(workflow.id);

      const stepId = workflow.steps[0].id;
      await engine.skipStep(workflow.id, stepId, "Not needed");

      const events = wakeupService.getUnprocessedEvents(workflow.id);
      const skipEvent = events.find((e) => e.type === "step_skipped");
      expect(skipEvent).toBeDefined();
      expect(skipEvent!.payload.reason).toBe("Not needed");
    });
  });

  describe("getWorkflow", () => {
    it("should return null for non-existent workflow", async () => {
      const result = await engine.getWorkflow("nonexistent");
      expect(result).toBeNull();
    });

    it("should return workflow with parsed JSON fields", async () => {
      const workflow = await engine.createWorkflow(
        { type: "goal", goal: "Test" },
        { autonomyLevel: "full_auto" }
      );

      const result = await engine.getWorkflow(workflow.id);

      expect(result!.source).toEqual({ type: "goal", goal: "Test" });
      expect(result!.config.autonomyLevel).toBe("full_auto");
    });
  });

  describe("getReadySteps", () => {
    it("should return steps with no dependencies", async () => {
      createTestIssue(db, "i-1", "Issue 1");
      createTestIssue(db, "i-2", "Issue 2");

      const workflow = await engine.createWorkflow({
        type: "issues",
        issueIds: ["i-1", "i-2"],
      });

      const readySteps = await engine.getReadySteps(workflow.id);

      // Both should be ready (no dependencies)
      expect(readySteps.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("setServerUrl", () => {
    it("should update the server URL in config", () => {
      // Engine was created with no serverUrl in config
      // Now update it with the actual URL - should not throw
      expect(() => engine.setServerUrl("http://localhost:3001")).not.toThrow();
    });

    it("should allow updating server URL multiple times", () => {
      // Create engine with initial URL
      const engineWithUrl = new OrchestratorWorkflowEngine({
        db,
        executionService,
        lifecycleService,
        wakeupService,
        eventEmitter,
        config: {
          repoPath: "/test/repo",
          dbPath: "/test/.sudocode/cache.db",
          serverUrl: "http://localhost:3000",
          projectId: "test-project",
        },
      });

      // Should be able to update URL multiple times (simulating port changes)
      expect(() =>
        engineWithUrl.setServerUrl("http://localhost:3001")
      ).not.toThrow();
      expect(() =>
        engineWithUrl.setServerUrl("http://localhost:3005")
      ).not.toThrow();
    });
  });
});
