import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkflowBroadcastService } from "../../../src/services/workflow-broadcast-service.js";
import { WorkflowEventEmitter } from "../../../src/workflow/workflow-event-emitter.js";
import type { Workflow, WorkflowStep } from "@sudocode-ai/types";

// Mock the websocket module
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastWorkflowUpdate: vi.fn(),
  broadcastWorkflowStepUpdate: vi.fn(),
}));

import {
  broadcastWorkflowUpdate,
  broadcastWorkflowStepUpdate,
} from "../../../src/services/websocket.js";

const mockBroadcastWorkflowUpdate = vi.mocked(broadcastWorkflowUpdate);
const mockBroadcastWorkflowStepUpdate = vi.mocked(broadcastWorkflowStepUpdate);

describe("WorkflowBroadcastService", () => {
  let eventEmitter: WorkflowEventEmitter;
  let broadcastService: WorkflowBroadcastService;
  let getProjectId: (workflowId: string) => string | null;

  const mockWorkflow: Workflow = {
    id: "wf-123",
    title: "Test Workflow",
    source: { type: "issues", issueIds: ["i-1", "i-2"] },
    status: "pending",
    steps: [],
    baseBranch: "main",
    currentStepIndex: 0,
    config: {
      parallelism: "sequential",
      onFailure: "pause",
      autoCommitAfterStep: true,
      defaultAgentType: "claude-code",
      autonomyLevel: "human_in_the_loop",
    },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  const mockStep: WorkflowStep = {
    id: "step-1",
    issueId: "i-1",
    index: 0,
    dependencies: [],
    status: "pending",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    eventEmitter = new WorkflowEventEmitter();
    getProjectId = vi.fn().mockReturnValue("project-123");
    broadcastService = new WorkflowBroadcastService(eventEmitter, getProjectId);
  });

  describe("Workflow lifecycle events", () => {
    it("should broadcast workflow_started event", () => {
      eventEmitter.emit({
        type: "workflow_started",
        workflowId: "wf-123",
        workflow: mockWorkflow,
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "started",
        { workflow: mockWorkflow, timestamp: 1234567890 }
      );
    });

    it("should broadcast workflow_paused event", () => {
      eventEmitter.emit({
        type: "workflow_paused",
        workflowId: "wf-123",
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "paused",
        { timestamp: 1234567890, workflowId: "wf-123" }
      );
    });

    it("should broadcast workflow_resumed event", () => {
      eventEmitter.emit({
        type: "workflow_resumed",
        workflowId: "wf-123",
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "resumed",
        { timestamp: 1234567890, workflowId: "wf-123" }
      );
    });

    it("should broadcast workflow_completed event", () => {
      eventEmitter.emit({
        type: "workflow_completed",
        workflowId: "wf-123",
        workflow: { ...mockWorkflow, status: "completed" },
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "completed",
        {
          workflow: { ...mockWorkflow, status: "completed" },
          timestamp: 1234567890,
        }
      );
    });

    it("should broadcast workflow_failed event", () => {
      eventEmitter.emit({
        type: "workflow_failed",
        workflowId: "wf-123",
        error: "Something went wrong",
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "failed",
        { error: "Something went wrong", timestamp: 1234567890, workflowId: "wf-123" }
      );
    });

    it("should broadcast workflow_cancelled event", () => {
      eventEmitter.emit({
        type: "workflow_cancelled",
        workflowId: "wf-123",
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "cancelled",
        { timestamp: 1234567890, workflowId: "wf-123" }
      );
    });
  });

  describe("Step events", () => {
    it("should broadcast step_started event", () => {
      eventEmitter.emit({
        type: "step_started",
        workflowId: "wf-123",
        step: mockStep,
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowStepUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "started",
        { step: mockStep, timestamp: 1234567890, workflowId: "wf-123" }
      );
    });

    it("should broadcast step_completed event", () => {
      eventEmitter.emit({
        type: "step_completed",
        workflowId: "wf-123",
        step: { ...mockStep, status: "completed" },
        executionId: "exec-456",
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowStepUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "completed",
        {
          step: { ...mockStep, status: "completed" },
          executionId: "exec-456",
          timestamp: 1234567890,
          workflowId: "wf-123",
        }
      );
    });

    it("should broadcast step_failed event", () => {
      eventEmitter.emit({
        type: "step_failed",
        workflowId: "wf-123",
        step: { ...mockStep, status: "failed" },
        error: "Step failed",
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowStepUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "failed",
        {
          step: { ...mockStep, status: "failed" },
          error: "Step failed",
          timestamp: 1234567890,
          workflowId: "wf-123",
        }
      );
    });

    it("should broadcast step_skipped event", () => {
      eventEmitter.emit({
        type: "step_skipped",
        workflowId: "wf-123",
        step: { ...mockStep, status: "skipped" },
        reason: "Dependency failed",
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowStepUpdate).toHaveBeenCalledWith(
        "project-123",
        "wf-123",
        "skipped",
        {
          step: { ...mockStep, status: "skipped" },
          reason: "Dependency failed",
          timestamp: 1234567890,
          workflowId: "wf-123",
        }
      );
    });
  });

  describe("Error handling", () => {
    it("should handle missing projectId gracefully", () => {
      // Dispose the default service and create one with null getProjectId
      broadcastService.dispose();

      const nullGetProjectId = vi.fn().mockReturnValue(null);
      const service = new WorkflowBroadcastService(eventEmitter, nullGetProjectId);

      // Should not throw
      eventEmitter.emit({
        type: "workflow_started",
        workflowId: "wf-unknown",
        workflow: mockWorkflow,
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).not.toHaveBeenCalled();
      expect(nullGetProjectId).toHaveBeenCalledWith("wf-unknown");

      service.dispose();
    });

    it("should not broadcast orchestrator_wakeup events", () => {
      eventEmitter.emit({
        type: "orchestrator_wakeup",
        workflowId: "wf-123",
        payload: { eventCount: 1, executionId: "exec-456" },
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).not.toHaveBeenCalled();
      expect(mockBroadcastWorkflowStepUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Lifecycle", () => {
    it("should unsubscribe on dispose", () => {
      expect(eventEmitter.listenerCount).toBe(1);

      broadcastService.dispose();

      expect(eventEmitter.listenerCount).toBe(0);

      // Events should no longer be broadcast
      eventEmitter.emit({
        type: "workflow_started",
        workflowId: "wf-123",
        workflow: mockWorkflow,
        timestamp: 1234567890,
      });

      expect(mockBroadcastWorkflowUpdate).not.toHaveBeenCalled();
    });
  });
});
