/**
 * Unit tests for Execution MCP Tools
 *
 * Tests execute_issue, execution_status, and execution_cancel tool handlers.
 * Uses mock API client since MCP server now only uses HTTP API.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WorkflowMCPContext, WorkflowAPIClientInterface } from "../../../../src/workflow/mcp/types.js";
import {
  handleExecuteIssue,
  handleExecutionStatus,
  handleExecutionCancel,
} from "../../../../src/workflow/mcp/tools/execution.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("Execution MCP Tools", () => {
  let context: WorkflowMCPContext;
  let mockApiClient: WorkflowAPIClientInterface;

  beforeEach(() => {
    // Create mock API client
    mockApiClient = {
      getWorkflowStatus: vi.fn(),
      completeWorkflow: vi.fn(),
      executeIssue: vi.fn().mockResolvedValue({
        execution_id: "exec-new",
        worktree_path: "/test/worktree",
        branch_name: "sudocode/exec-new",
        status: "pending",
      }),
      getExecutionStatus: vi.fn().mockResolvedValue({
        id: "exec-1",
        status: "running",
        started_at: new Date().toISOString(),
      }),
      cancelExecution: vi.fn().mockResolvedValue({
        success: true,
        message: "Execution cancelled",
        final_status: "cancelled",
      }),
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
  // execute_issue Tests
  // ===========================================================================

  describe("handleExecuteIssue", () => {
    it("should create execution for valid issue", async () => {
      const result = await handleExecuteIssue(context, {
        issue_id: "i-1",
        worktree_mode: "create_root",
      });

      expect(result.success).toBe(true);
      expect(result.execution_id).toBe("exec-new");
      expect(result.worktree_path).toBe("/test/worktree");
      expect(result.branch_name).toBe("sudocode/exec-new");
      expect(mockApiClient.executeIssue).toHaveBeenCalledWith({
        issue_id: "i-1",
        worktree_mode: "create_root",
      });
    });

    it("should pass agent_type to API", async () => {
      await handleExecuteIssue(context, {
        issue_id: "i-1",
        agent_type: "codex",
        worktree_mode: "create_root",
      });

      expect(mockApiClient.executeIssue).toHaveBeenCalledWith({
        issue_id: "i-1",
        agent_type: "codex",
        worktree_mode: "create_root",
      });
    });

    it("should pass worktree_id for use_root mode", async () => {
      await handleExecuteIssue(context, {
        issue_id: "i-1",
        worktree_mode: "use_root",
        worktree_id: "exec-previous",
      });

      expect(mockApiClient.executeIssue).toHaveBeenCalledWith({
        issue_id: "i-1",
        worktree_mode: "use_root",
        worktree_id: "exec-previous",
      });
    });

    it("should pass worktree_id for use_branch mode", async () => {
      await handleExecuteIssue(context, {
        issue_id: "i-1",
        worktree_mode: "use_branch",
        worktree_id: "exec-previous",
      });

      expect(mockApiClient.executeIssue).toHaveBeenCalledWith({
        issue_id: "i-1",
        worktree_mode: "use_branch",
        worktree_id: "exec-previous",
      });
    });

    it("should propagate API errors", async () => {
      (mockApiClient.executeIssue as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Issue not in workflow")
      );

      await expect(
        handleExecuteIssue(context, {
          issue_id: "i-other",
          worktree_mode: "create_root",
        })
      ).rejects.toThrow("Issue not in workflow");
    });

    it("should handle running status from API", async () => {
      (mockApiClient.executeIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
        execution_id: "exec-running",
        worktree_path: "/test/worktree",
        branch_name: "sudocode/exec-running",
        status: "running",
      });

      const result = await handleExecuteIssue(context, {
        issue_id: "i-1",
        worktree_mode: "create_root",
      });

      expect(result.status).toBe("running");
    });
  });

  // ===========================================================================
  // execution_status Tests
  // ===========================================================================

  describe("handleExecutionStatus", () => {
    it("should return execution data", async () => {
      const result = await handleExecutionStatus(context, {
        execution_id: "exec-1",
      });

      expect(result.id).toBe("exec-1");
      expect(result.status).toBe("running");
      expect(mockApiClient.getExecutionStatus).toHaveBeenCalledWith({
        execution_id: "exec-1",
      });
    });

    it("should include exit_code when present", async () => {
      (mockApiClient.getExecutionStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "exec-1",
        status: "completed",
        exit_code: 0,
      });

      const result = await handleExecutionStatus(context, {
        execution_id: "exec-1",
      });

      expect(result.exit_code).toBe(0);
    });

    it("should include error when present", async () => {
      (mockApiClient.getExecutionStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "exec-1",
        status: "failed",
        error: "Something failed",
      });

      const result = await handleExecutionStatus(context, {
        execution_id: "exec-1",
      });

      expect(result.error).toBe("Something failed");
    });

    it("should include summary when present", async () => {
      (mockApiClient.getExecutionStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "exec-1",
        status: "completed",
        summary: "Implemented feature X",
      });

      const result = await handleExecutionStatus(context, {
        execution_id: "exec-1",
      });

      expect(result.summary).toBe("Implemented feature X");
    });

    it("should map files_changed paths", async () => {
      (mockApiClient.getExecutionStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "exec-1",
        status: "completed",
        files_changed: [
          { path: "file1.ts", additions: 10, deletions: 5 },
          { path: "file2.ts", additions: 20, deletions: 0 },
        ],
      });

      const result = await handleExecutionStatus(context, {
        execution_id: "exec-1",
      });

      expect(result.files_changed).toEqual(["file1.ts", "file2.ts"]);
    });

    it("should propagate API errors", async () => {
      (mockApiClient.getExecutionStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Execution not found")
      );

      await expect(
        handleExecutionStatus(context, { execution_id: "exec-nonexistent" })
      ).rejects.toThrow("Execution not found");
    });
  });

  // ===========================================================================
  // execution_cancel Tests
  // ===========================================================================

  describe("handleExecutionCancel", () => {
    it("should call API cancelExecution", async () => {
      const result = await handleExecutionCancel(context, {
        execution_id: "exec-1",
      });

      expect(result.success).toBe(true);
      expect(result.final_status).toBe("cancelled");
      expect(mockApiClient.cancelExecution).toHaveBeenCalledWith({
        execution_id: "exec-1",
      });
    });

    it("should include reason in response", async () => {
      (mockApiClient.cancelExecution as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        message: "User requested cancellation",
        final_status: "cancelled",
      });

      const result = await handleExecutionCancel(context, {
        execution_id: "exec-1",
        reason: "User requested cancellation",
      });

      expect(result.message).toBe("User requested cancellation");
    });

    it("should pass reason to API", async () => {
      await handleExecutionCancel(context, {
        execution_id: "exec-1",
        reason: "User requested",
      });

      expect(mockApiClient.cancelExecution).toHaveBeenCalledWith({
        execution_id: "exec-1",
        reason: "User requested",
      });
    });

    it("should propagate API errors for non-existent execution", async () => {
      (mockApiClient.cancelExecution as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Execution not found")
      );

      await expect(
        handleExecutionCancel(context, { execution_id: "exec-nonexistent" })
      ).rejects.toThrow("Execution not found");
    });

    it("should propagate API errors for completed execution", async () => {
      (mockApiClient.cancelExecution as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Cannot cancel execution")
      );

      await expect(
        handleExecutionCancel(context, { execution_id: "exec-1" })
      ).rejects.toThrow("Cannot cancel execution");
    });
  });
});
