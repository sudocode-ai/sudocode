/**
 * Unit tests for Escalation MCP Tools
 *
 * Tests escalate_to_user and notify_user tool handlers.
 * Uses mock API client since MCP server now only uses HTTP API.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WorkflowMCPContext, WorkflowAPIClientInterface } from "../../../../src/workflow/mcp/types.js";
import {
  handleEscalateToUser,
  handleNotifyUser,
} from "../../../../src/workflow/mcp/tools/escalation.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("Escalation MCP Tools", () => {
  let context: WorkflowMCPContext;
  let mockApiClient: WorkflowAPIClientInterface;

  beforeEach(() => {
    // Create mock API client
    mockApiClient = {
      getWorkflowStatus: vi.fn(),
      completeWorkflow: vi.fn(),
      executeIssue: vi.fn(),
      getExecutionStatus: vi.fn(),
      cancelExecution: vi.fn(),
      getExecutionTrajectory: vi.fn(),
      getExecutionChanges: vi.fn(),
      escalateToUser: vi.fn().mockResolvedValue({
        status: "pending",
        escalation_id: "esc-123",
        message: "Escalation request created. Your session will end here.",
      }),
      notifyUser: vi.fn().mockResolvedValue({
        success: true,
        delivered: true,
      }),
    };

    // Create context
    context = {
      workflowId: "wf-test1",
      apiClient: mockApiClient,
      repoPath: "/test/repo",
    };
  });

  // ===========================================================================
  // handleEscalateToUser Tests
  // ===========================================================================

  describe("handleEscalateToUser", () => {
    it("should create a pending escalation", async () => {
      const result = await handleEscalateToUser(context, {
        message: "Need user input",
      });

      expect(result.status).toBe("pending");
      expect(result.escalation_id).toBe("esc-123");
      expect(mockApiClient.escalateToUser).toHaveBeenCalledWith({
        message: "Need user input",
      });
    });

    it("should pass options to API", async () => {
      await handleEscalateToUser(context, {
        message: "Choose an option",
        options: ["Yes", "No"],
      });

      expect(mockApiClient.escalateToUser).toHaveBeenCalledWith({
        message: "Choose an option",
        options: ["Yes", "No"],
      });
    });

    it("should pass context to API", async () => {
      await handleEscalateToUser(context, {
        message: "Need input",
        context: { issueId: "i-123" },
      });

      expect(mockApiClient.escalateToUser).toHaveBeenCalledWith({
        message: "Need input",
        context: { issueId: "i-123" },
      });
    });

    it("should return auto_approved in full_auto mode", async () => {
      (mockApiClient.escalateToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: "auto_approved",
        message: "Escalation auto-approved (workflow is in full_auto mode).",
      });

      const result = await handleEscalateToUser(context, {
        message: "Proceed?",
      });

      expect(result.status).toBe("auto_approved");
    });

    it("should propagate API errors", async () => {
      (mockApiClient.escalateToUser as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Workflow not found")
      );

      await expect(
        handleEscalateToUser(context, { message: "Help" })
      ).rejects.toThrow("Workflow not found");
    });

    it("should propagate pending escalation error", async () => {
      (mockApiClient.escalateToUser as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Workflow already has a pending escalation")
      );

      await expect(
        handleEscalateToUser(context, { message: "Another escalation" })
      ).rejects.toThrow("pending escalation");
    });
  });

  // ===========================================================================
  // handleNotifyUser Tests
  // ===========================================================================

  describe("handleNotifyUser", () => {
    it("should return success for notification", async () => {
      const result = await handleNotifyUser(context, {
        message: "Progress update",
      });

      expect(result.success).toBe(true);
      expect(result.delivered).toBe(true);
      expect(mockApiClient.notifyUser).toHaveBeenCalledWith({
        message: "Progress update",
      });
    });

    it("should accept different notification levels", async () => {
      await handleNotifyUser(context, {
        message: "Warning!",
        level: "warning",
      });

      expect(mockApiClient.notifyUser).toHaveBeenCalledWith({
        message: "Warning!",
        level: "warning",
      });
    });

    it("should accept error level", async () => {
      await handleNotifyUser(context, {
        message: "Error occurred",
        level: "error",
      });

      expect(mockApiClient.notifyUser).toHaveBeenCalledWith({
        message: "Error occurred",
        level: "error",
      });
    });

    it("should accept info level", async () => {
      await handleNotifyUser(context, {
        message: "Info message",
        level: "info",
      });

      expect(mockApiClient.notifyUser).toHaveBeenCalledWith({
        message: "Info message",
        level: "info",
      });
    });

    it("should handle undelivered notification", async () => {
      (mockApiClient.notifyUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        delivered: false,
      });

      const result = await handleNotifyUser(context, {
        message: "Update",
      });

      expect(result.success).toBe(true);
      expect(result.delivered).toBe(false);
    });

    it("should propagate API errors", async () => {
      (mockApiClient.notifyUser as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Server unavailable")
      );

      await expect(
        handleNotifyUser(context, { message: "Update" })
      ).rejects.toThrow("Server unavailable");
    });
  });
});
