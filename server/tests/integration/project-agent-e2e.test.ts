/**
 * End-to-End Integration tests for Project Agent System
 *
 * Tests complete workflows from start to finish:
 * - Agent startup → Event listening → Action proposal → Approval → Execution → Result
 * - Multiple action types with different workflows
 * - Auto-approval workflows
 * - Error scenarios and recovery
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import {
  ProjectAgentExecutor,
  initProjectAgentExecutor,
  destroyProjectAgentExecutor,
} from "../../src/services/project-agent-executor.js";
import { ActionManager } from "../../src/services/project-agent-actions.js";
import { createEventBus, destroyEventBus, getEventBus } from "../../src/services/event-bus.js";
import {
  getProjectAgentAction,
  listProjectAgentActions,
} from "../../src/services/project-agent-db.js";
import type { ProjectAgentConfig } from "@sudocode-ai/types";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { initDatabase } from "../../src/services/db.js";

describe("Project Agent End-to-End Workflows", () => {
  let db: Database.Database;
  let tmpDir: string;
  let eventBus: any;
  let executor: ProjectAgentExecutor;
  let actionManager: ActionManager;
  let mockExecutionService: any;

  beforeEach(async () => {
    // Create temporary directory for test database
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-agent-e2e-test-"));
    const dbPath = path.join(tmpDir, "test.db");

    // Initialize database
    db = initDatabase({ path: dbPath });

    // Initialize EventBus
    eventBus = await createEventBus({
      db,
      baseDir: tmpDir,
      debounceDelay: 100,
    });

    // Mock ExecutionService
    mockExecutionService = {
      createExecution: vi.fn().mockResolvedValue({
        id: "exec_test_123",
        status: "running",
        worktree_path: "/tmp/worktree",
      }),
      pauseExecution: vi.fn().mockResolvedValue(undefined),
      resumeExecution: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    // Cleanup
    try {
      await destroyProjectAgentExecutor();
    } catch {
      // Ignore if not initialized
    }

    if (eventBus) {
      await destroyEventBus();
    }
    if (db) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Complete Action Lifecycle", () => {
    it("should handle full workflow: propose → approve → execute → complete", async () => {
      // Setup
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      expect(execution).toBeDefined();

      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      // Mock CLI client for execution
      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ success: true }),
      };

      // Step 1: Propose action
      const proposedAction = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "create_relationship",
        payload: {
          from_id: "issue_1",
          to_id: "spec_1",
          type: "implements",
        },
        justification: "Link issue to spec for tracking",
        priority: "high",
      });

      expect(proposedAction.status).toBe("proposed");

      // Step 2: Approve action
      await actionManager.approveAction(proposedAction.id);

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Step 3: Verify completion
      const completedAction = getProjectAgentAction(db, proposedAction.id);
      expect(completedAction?.status).toMatch(/approved|executing|completed/);

      // Step 4: Verify metrics updated
      const updatedExecution = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      expect(updatedExecution.actions_proposed).toBe(1);
      expect(updatedExecution.actions_approved).toBe(1);

      await executor.stop();
    });

    it("should handle rejection workflow: propose → reject", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      // Propose action
      const proposedAction = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "modify_spec",
        payload: { spec_id: "spec_123" },
        justification: "Update spec content",
      });

      // Reject action
      await actionManager.rejectAction(proposedAction.id, "Not needed at this time");

      const rejectedAction = getProjectAgentAction(db, proposedAction.id);
      expect(rejectedAction?.status).toBe("rejected");
      expect(rejectedAction?.error_message).toBe("Not needed at this time");

      // Verify metrics
      const updatedExecution = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      expect(updatedExecution.actions_proposed).toBe(1);
      expect(updatedExecution.actions_rejected).toBe(1);
      expect(updatedExecution.actions_approved).toBe(0);

      await executor.stop();
    });
  });

  describe("Auto-Approval Workflow", () => {
    it("should auto-approve and execute allowed actions", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: {
          enabled: true,
          allowedActions: ["create_relationship", "update_issue_status"],
        },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      // Mock CLI client
      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ success: true }),
      };

      // Propose allowed action
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "create_relationship",
        payload: {
          from_id: "issue_1",
          to_id: "spec_1",
          type: "implements",
        },
        justification: "Auto-approve test",
      });

      // Wait for auto-approval and execution
      await new Promise((resolve) => setTimeout(resolve, 200));

      const completedAction = getProjectAgentAction(db, action.id);
      expect(completedAction?.status).toMatch(/approved|executing|completed/);

      await executor.stop();
    });

    it("should NOT auto-approve disallowed actions", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: {
          enabled: true,
          allowedActions: ["create_relationship"],
        },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      // Propose disallowed action
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "modify_spec", // Not in allowedActions
        payload: { spec_id: "spec_123" },
        justification: "Should not auto-approve",
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 200));

      const actionAfter = getProjectAgentAction(db, action.id);
      expect(actionAfter?.status).toBe("proposed");

      await executor.stop();
    });
  });

  describe("Event-Driven Workflows", () => {
    it("should process events and update metrics", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();

      // Emit various events
      eventBus.emitEvent("filesystem:spec_created", {
        entityType: "spec",
        entityId: "spec_new",
      });

      eventBus.emitEvent("issue:status_changed", {
        entityType: "issue",
        entityId: "issue_123",
        oldStatus: "open",
        newStatus: "ready",
      });

      eventBus.emitEvent("execution:completed", {
        entityType: "execution",
        executionId: "exec_456",
      });

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 300));

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      expect(executionAfter.events_processed).toBeGreaterThanOrEqual(3);

      await executor.stop();
    });
  });

  describe("Multiple Action Types", () => {
    it("should handle create_relationship action", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ success: true }),
      };

      const action = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "create_relationship",
        payload: {
          from_id: "issue_1",
          to_id: "spec_1",
          type: "implements",
        },
        justification: "Test",
      });

      await actionManager.approveAction(action.id);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect((actionManager as any).cliClient.exec).toHaveBeenCalledWith([
        "link",
        "issue_1",
        "spec_1",
        "--type",
        "implements",
      ]);

      await executor.stop();
    });

    it("should handle update_issue_status action", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ id: "issue_123", status: "completed" }),
      };

      const action = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "update_issue_status",
        payload: {
          issue_id: "issue_123",
          status: "completed",
        },
        justification: "Issue work is done",
      });

      await actionManager.approveAction(action.id);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect((actionManager as any).cliClient.exec).toHaveBeenCalledWith([
        "status",
        "issue_123",
        "completed",
      ]);

      await executor.stop();
    });

    it("should handle start_execution action", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      const action = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "start_execution",
        payload: {
          issue_id: "issue_ready",
          config: { mode: "worktree" },
        },
        justification: "Issue is ready to execute",
      });

      await actionManager.approveAction(action.id);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockExecutionService.createExecution).toHaveBeenCalled();

      await executor.stop();
    });

    it("should handle pause_execution action", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      const action = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "pause_execution",
        payload: {
          execution_id: "exec_running",
        },
        justification: "Need to pause this execution",
      });

      await actionManager.approveAction(action.id);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockExecutionService.pauseExecution).toHaveBeenCalledWith("exec_running");

      await executor.stop();
    });
  });

  describe("Error Handling and Recovery", () => {
    it("should handle execution errors and mark action as failed", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      // Mock CLI to throw error
      (actionManager as any).cliClient = {
        exec: vi.fn().mockRejectedValue(new Error("CLI error: Spec not found")),
      };

      const action = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "modify_spec",
        payload: { spec_id: "nonexistent" },
        justification: "Test error handling",
      });

      await actionManager.approveAction(action.id);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const failedAction = getProjectAgentAction(db, action.id);
      expect(failedAction?.status).toBe("failed");
      expect(failedAction?.error_message).toContain("CLI error");

      await executor.stop();
    });

    it("should continue processing after action failure", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      // First action fails
      (actionManager as any).cliClient = {
        exec: vi.fn().mockRejectedValue(new Error("First action failed")),
      };

      const action1 = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "modify_spec",
        payload: {},
        justification: "Will fail",
      });

      await actionManager.approveAction(action1.id);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second action succeeds
      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ success: true }),
      };

      const action2 = await actionManager.proposeAction({
        projectAgentExecutionId: execution!.id,
        actionType: "create_relationship",
        payload: { from_id: "issue_1", to_id: "spec_1", type: "implements" },
        justification: "Will succeed",
      });

      await actionManager.approveAction(action2.id);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const failedAction = getProjectAgentAction(db, action1.id);
      const successAction = getProjectAgentAction(db, action2.id);

      expect(failedAction?.status).toBe("failed");
      expect(successAction?.status).toMatch(/approved|executing|completed/);

      await executor.stop();
    });

    it("should remain operational after event processing errors", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();

      // Emit event that might cause processing error
      eventBus.emitEvent("unknown:event_type", {
        entityType: "unknown",
        entityId: "error_prone",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still be running
      expect(executor.isRunning()).toBe(true);

      // Should still process normal events
      eventBus.emitEvent("issue:created", {
        entityType: "issue",
        entityId: "issue_normal",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      expect(executionAfter.events_processed).toBeGreaterThanOrEqual(2);

      await executor.stop();
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle multiple proposed actions", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      actionManager = new ActionManager(db, config, tmpDir, mockExecutionService);

      // Propose multiple actions
      const actions = [];
      for (let i = 0; i < 5; i++) {
        const action = await actionManager.proposeAction({
          projectAgentExecutionId: execution!.id,
          actionType: "create_relationship",
          payload: {
            from_id: `issue_${i}`,
            to_id: `spec_${i}`,
            type: "implements",
          },
          justification: `Action ${i}`,
        });
        actions.push(action);
      }

      const allActions = listProjectAgentActions(db, { status: "proposed" });
      expect(allActions.length).toBeGreaterThanOrEqual(5);

      await executor.stop();
    });

    it("should handle rapid event processing", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();

      // Emit many events rapidly
      for (let i = 0; i < 20; i++) {
        eventBus.emitEvent("issue:created", {
          entityType: "issue",
          entityId: `issue_${i}`,
        });
      }

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      expect(executionAfter.events_processed).toBeGreaterThanOrEqual(20);

      await executor.stop();
    });
  });
});
