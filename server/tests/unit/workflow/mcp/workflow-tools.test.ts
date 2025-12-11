/**
 * Unit tests for Workflow MCP Tools
 *
 * Tests workflow_status and workflow_complete tool handlers.
 * Uses mock API client since MCP server now only uses HTTP API.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WorkflowMCPContext, WorkflowAPIClientInterface } from "../../../../src/workflow/mcp/types.js";
import {
  handleWorkflowStatus,
  handleWorkflowComplete,
} from "../../../../src/workflow/mcp/tools/workflow.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("Workflow MCP Tools", () => {
  let context: WorkflowMCPContext;
  let mockApiClient: WorkflowAPIClientInterface;

  beforeEach(() => {
    // Create mock API client
    mockApiClient = {
      getWorkflowStatus: vi.fn().mockResolvedValue({
        workflow: {
          id: "wf-test1",
          title: "Test Workflow",
          status: "running",
          source: { type: "issues", issueIds: ["i-1", "i-2"] },
          config: {
            parallelism: "sequential",
            onFailure: "pause",
            defaultAgentType: "claude-code",
          },
        },
        steps: [
          {
            id: "step-1",
            issueId: "i-1",
            issueTitle: "First Issue",
            status: "completed",
            executionId: "exec-1",
            dependsOn: [],
          },
          {
            id: "step-2",
            issueId: "i-2",
            issueTitle: "Second Issue",
            status: "pending",
            dependsOn: ["step-1"],
          },
        ],
        activeExecutions: [],
        readySteps: ["step-2"],
      }),
      completeWorkflow: vi.fn().mockResolvedValue({
        success: true,
        workflow_status: "completed",
        completed_at: new Date().toISOString(),
      }),
      executeIssue: vi.fn(),
      getExecutionStatus: vi.fn(),
      cancelExecution: vi.fn(),
      getExecutionTrajectory: vi.fn(),
      getExecutionChanges: vi.fn(),
      escalateToUser: vi.fn(),
      notifyUser: vi.fn(),
    };

    // Create context
    context = {
      workflowId: "wf-test1",
      apiClient: mockApiClient,
      repoPath: "/test/repo",
    };
  });

  // ===========================================================================
  // workflow_status Tests
  // ===========================================================================

  describe("handleWorkflowStatus", () => {
    it("should return workflow with steps", async () => {
      const result = await handleWorkflowStatus(context);

      expect(result.workflow.id).toBe("wf-test1");
      expect(result.workflow.title).toBe("Test Workflow");
      expect(result.workflow.status).toBe("running");
      expect(result.steps).toHaveLength(2);
      expect(mockApiClient.getWorkflowStatus).toHaveBeenCalled();
    });

    it("should include issue titles in steps", async () => {
      const result = await handleWorkflowStatus(context);

      expect(result.steps[0].issueTitle).toBe("First Issue");
      expect(result.steps[1].issueTitle).toBe("Second Issue");
    });

    it("should include active executions", async () => {
      (mockApiClient.getWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        workflow: { id: "wf-test1", title: "Test", status: "running", source: {}, config: {} },
        steps: [],
        activeExecutions: [
          { id: "exec-1", stepId: "step-1", status: "running", startedAt: new Date().toISOString() },
        ],
        readySteps: [],
      });

      const result = await handleWorkflowStatus(context);

      expect(result.activeExecutions).toHaveLength(1);
      expect(result.activeExecutions[0].id).toBe("exec-1");
      expect(result.activeExecutions[0].status).toBe("running");
    });

    it("should include ready steps", async () => {
      const result = await handleWorkflowStatus(context);

      expect(result.readySteps).toContain("step-2");
    });

    it("should propagate API errors", async () => {
      (mockApiClient.getWorkflowStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Workflow not found")
      );

      context.workflowId = "wf-nonexistent";

      await expect(handleWorkflowStatus(context)).rejects.toThrow("Workflow not found");
    });
  });

  // ===========================================================================
  // workflow_complete Tests
  // ===========================================================================

  describe("handleWorkflowComplete", () => {
    it("should update status to completed", async () => {
      const result = await handleWorkflowComplete(context, {
        summary: "All done!",
      });

      expect(result.success).toBe(true);
      expect(result.workflow_status).toBe("completed");
      expect(result.completed_at).toBeDefined();
      expect(mockApiClient.completeWorkflow).toHaveBeenCalledWith({
        summary: "All done!",
        status: "completed",
      });
    });

    it("should update status to failed when specified", async () => {
      (mockApiClient.completeWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        workflow_status: "failed",
        completed_at: new Date().toISOString(),
      });

      const result = await handleWorkflowComplete(context, {
        summary: "Something went wrong",
        status: "failed",
      });

      expect(result.workflow_status).toBe("failed");
      expect(mockApiClient.completeWorkflow).toHaveBeenCalledWith({
        summary: "Something went wrong",
        status: "failed",
      });
    });

    it("should propagate API error for already-completed workflow", async () => {
      (mockApiClient.completeWorkflow as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Workflow already completed. Cannot complete again.")
      );

      await expect(
        handleWorkflowComplete(context, { summary: "Done again" })
      ).rejects.toThrow("already completed");
    });

    it("should propagate API error for already-failed workflow", async () => {
      (mockApiClient.completeWorkflow as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Workflow already failed. Cannot complete again.")
      );

      await expect(
        handleWorkflowComplete(context, { summary: "Try again" })
      ).rejects.toThrow("already failed");
    });

    it("should propagate API error for cancelled workflow", async () => {
      (mockApiClient.completeWorkflow as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Workflow was cancelled. Cannot complete a cancelled workflow.")
      );

      await expect(
        handleWorkflowComplete(context, { summary: "Complete anyway" })
      ).rejects.toThrow("cancelled");
    });

    it("should propagate API error for active executions", async () => {
      (mockApiClient.completeWorkflow as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Cannot complete workflow: 1 execution(s) still active.")
      );

      await expect(
        handleWorkflowComplete(context, { summary: "Complete" })
      ).rejects.toThrow("execution(s) still active");
    });

    it("should allow failed status (API handles validation)", async () => {
      (mockApiClient.completeWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        workflow_status: "failed",
        completed_at: new Date().toISOString(),
      });

      const result = await handleWorkflowComplete(context, {
        summary: "Giving up",
        status: "failed",
      });

      expect(result.workflow_status).toBe("failed");
    });

    it("should propagate API error for non-existent workflow", async () => {
      (mockApiClient.completeWorkflow as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Workflow not found: wf-nonexistent")
      );

      context.workflowId = "wf-nonexistent";

      await expect(
        handleWorkflowComplete(context, { summary: "Done" })
      ).rejects.toThrow("Workflow not found");
    });
  });
});
