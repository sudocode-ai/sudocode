/**
 * Integration tests for Project Agent Action Lifecycle
 *
 * Tests the full lifecycle of project agent actions:
 * - Action proposal
 * - Approval workflow
 * - Action execution
 * - Event emission
 * - Result verification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ActionManager } from "../../src/services/project-agent-actions.js";
import { createEventBus, destroyEventBus, getEventBus } from "../../src/services/event-bus.js";
import {
  getProjectAgentAction,
  createProjectAgentExecution,
} from "../../src/services/project-agent-db.js";
import type { ProjectAgentConfig } from "@sudocode-ai/types";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { initDatabase } from "../../src/services/db.js";

describe("Project Agent Action Lifecycle Integration", () => {
  let db: Database.Database;
  let tmpDir: string;
  let actionManager: ActionManager;
  let projectAgentExecution: any;
  let eventBus: any;

  beforeEach(async () => {
    // Create temporary directory for test database
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-agent-test-"));
    const dbPath = path.join(tmpDir, "test.db");

    // Initialize database
    db = initDatabase({ path: dbPath });

    // Create test project agent execution
    const config: ProjectAgentConfig = {
      useWorktree: false,
      mode: "monitoring",
      autoApprove: {
        enabled: false,
        allowedActions: [],
      },
      monitoring: {
        watchExecutions: true,
        checkInterval: 60000,
        stalledExecutionThreshold: 3600000,
      },
    };

    projectAgentExecution = createProjectAgentExecution(db, {
      mode: "monitoring",
      config,
      worktreePath: null,
    });

    // Initialize EventBus
    eventBus = await createEventBus({
      db,
      baseDir: tmpDir,
      debounceDelay: 100,
    });

    // Create ActionManager (no ExecutionService for basic tests)
    actionManager = new ActionManager(db, config, tmpDir);
  });

  afterEach(async () => {
    // Cleanup
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

  describe("Action Proposal", () => {
    it("should create a proposed action", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "modify_spec",
        targetId: "spec_test_123",
        targetType: "spec",
        payload: {
          spec_id: "spec_test_123",
          title: "Updated spec title",
        },
        justification: "Spec needs clarification based on recent feedback",
        priority: "high",
      });

      expect(action).toBeDefined();
      expect(action.status).toBe("proposed");
      expect(action.action_type).toBe("modify_spec");
      expect(action.priority).toBe("high");
      expect(action.justification).toBe("Spec needs clarification based on recent feedback");
    });

    it("should increment actions_proposed metric", async () => {
      const executionBefore = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(projectAgentExecution.id) as any;

      await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "create_relationship",
        payload: {
          from_id: "issue_1",
          to_id: "spec_1",
          type: "implements",
        },
        justification: "Link issue to spec",
      });

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(projectAgentExecution.id) as any;

      expect(executionAfter.actions_proposed).toBe(
        executionBefore.actions_proposed + 1
      );
    });

    it("should auto-approve actions if configured", async () => {
      // Create ActionManager with auto-approve enabled
      const autoApproveConfig: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: {
          enabled: true,
          allowedActions: ["create_relationship"],
        },
        monitoring: {
          watchExecutions: true,
          checkInterval: 60000,
          stalledExecutionThreshold: 3600000,
        },
      };

      const autoApproveManager = new ActionManager(
        db,
        autoApproveConfig,
        tmpDir
      );

      // Mock CLI client to avoid actual execution
      (autoApproveManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ success: true }),
      };

      const action = await autoApproveManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "create_relationship",
        payload: {
          from_id: "issue_1",
          to_id: "spec_1",
          type: "implements",
        },
        justification: "Auto-approve test",
      });

      // Action should be auto-approved and executed
      // Wait a bit for async approval to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedAction = getProjectAgentAction(db, action.id);
      expect(updatedAction?.status).toMatch(/approved|executing|completed/);
    });
  });

  describe("Action Approval Workflow", () => {
    it("should approve a proposed action", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "update_issue_status",
        payload: {
          issue_id: "issue_test_123",
          status: "completed",
        },
        justification: "Issue work is complete",
      });

      // Mock CLI client to avoid actual execution
      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ id: "issue_test_123", status: "completed" }),
      };

      await actionManager.approveAction(action.id);

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedAction = getProjectAgentAction(db, action.id);
      expect(updatedAction?.status).toMatch(/approved|executing|completed/);
    });

    it("should reject a proposed action", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "modify_spec",
        payload: {
          spec_id: "spec_test_123",
        },
        justification: "Test rejection",
      });

      await actionManager.rejectAction(action.id, "Not needed at this time");

      const updatedAction = getProjectAgentAction(db, action.id);
      expect(updatedAction?.status).toBe("rejected");
      expect(updatedAction?.error_message).toBe("Not needed at this time");
    });

    it("should increment actions_approved metric on approval", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "create_relationship",
        payload: {},
        justification: "Test",
      });

      // Mock CLI client
      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ success: true }),
      };

      const executionBefore = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(projectAgentExecution.id) as any;

      await actionManager.approveAction(action.id);

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(projectAgentExecution.id) as any;

      expect(executionAfter.actions_approved).toBe(
        executionBefore.actions_approved + 1
      );
    });

    it("should increment actions_rejected metric on rejection", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "modify_spec",
        payload: {},
        justification: "Test",
      });

      const executionBefore = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(projectAgentExecution.id) as any;

      await actionManager.rejectAction(action.id, "Test rejection");

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(projectAgentExecution.id) as any;

      expect(executionAfter.actions_rejected).toBe(
        executionBefore.actions_rejected + 1
      );
    });
  });

  describe("Action Execution", () => {
    it("should execute an approved action", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "create_relationship",
        payload: {
          from_id: "issue_1",
          to_id: "spec_1",
          type: "implements",
        },
        justification: "Test execution",
      });

      // Mock CLI client
      const mockExec = vi.fn().mockResolvedValue({ success: true });
      (actionManager as any).cliClient = {
        exec: mockExec,
      };

      await actionManager.approveAction(action.id);

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify CLI was called
      expect(mockExec).toHaveBeenCalled();

      const updatedAction = getProjectAgentAction(db, action.id);
      expect(updatedAction?.status).toMatch(/executing|completed/);
    });

    it("should handle execution errors", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "modify_spec",
        payload: {
          spec_id: "nonexistent",
        },
        justification: "Test error handling",
      });

      // Mock CLI client to throw error
      (actionManager as any).cliClient = {
        exec: vi.fn().mockRejectedValue(new Error("Spec not found")),
      };

      await actionManager.approveAction(action.id);

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedAction = getProjectAgentAction(db, action.id);
      expect(updatedAction?.status).toBe("failed");
      expect(updatedAction?.error_message).toContain("Spec not found");
    });

    it("should emit events after successful execution", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "create_relationship",
        payload: {
          from_id: "issue_1",
          to_id: "spec_1",
          type: "implements",
        },
        justification: "Test event emission",
      });

      // Mock CLI client
      (actionManager as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ success: true }),
      };

      // Subscribe to events
      const events: any[] = [];
      eventBus.subscribeAll((event: any) => {
        events.push(event);
      });

      await actionManager.approveAction(action.id);

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have emitted relationship:created event
      const relationshipEvent = events.find(
        (e) => e.type === "relationship:created"
      );
      expect(relationshipEvent).toBeDefined();
    });
  });

  describe("Action Listing", () => {
    it("should list all actions", async () => {
      // Create multiple actions
      await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "modify_spec",
        payload: {},
        justification: "Test 1",
      });

      await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "create_relationship",
        payload: {},
        justification: "Test 2",
      });

      const actions = actionManager.listActions();
      expect(actions.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter actions by status", async () => {
      const action1 = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "modify_spec",
        payload: {},
        justification: "Test proposed",
      });

      const action2 = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "create_relationship",
        payload: {},
        justification: "Test rejected",
      });

      await actionManager.rejectAction(action2.id, "Test");

      const proposedActions = actionManager.listActions({ status: "proposed" });
      const rejectedActions = actionManager.listActions({ status: "rejected" });

      expect(proposedActions.some((a) => a.id === action1.id)).toBe(true);
      expect(rejectedActions.some((a) => a.id === action2.id)).toBe(true);
      expect(proposedActions.some((a) => a.id === action2.id)).toBe(false);
    });

    it("should limit number of returned actions", async () => {
      // Create multiple actions
      for (let i = 0; i < 5; i++) {
        await actionManager.proposeAction({
          projectAgentExecutionId: projectAgentExecution.id,
          actionType: "modify_spec",
          payload: {},
          justification: `Test ${i}`,
        });
      }

      const actions = actionManager.listActions({ limit: 3 });
      expect(actions.length).toBe(3);
    });
  });

  describe("Action Retrieval", () => {
    it("should get action by ID", async () => {
      const action = await actionManager.proposeAction({
        projectAgentExecutionId: projectAgentExecution.id,
        actionType: "modify_spec",
        payload: {},
        justification: "Test",
      });

      const retrieved = actionManager.getAction(action.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(action.id);
      expect(retrieved?.action_type).toBe("modify_spec");
    });

    it("should return null for nonexistent action", () => {
      const retrieved = actionManager.getAction("nonexistent_id");
      expect(retrieved).toBeNull();
    });
  });
});
