/**
 * Unit tests for Inspection MCP Tools
 *
 * Tests execution_trajectory and execution_changes tool handlers.
 * Uses mock API client since MCP server now only uses HTTP API.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WorkflowMCPContext, WorkflowAPIClientInterface } from "../../../../src/workflow/mcp/types.js";
import {
  handleExecutionTrajectory,
  handleExecutionChanges,
} from "../../../../src/workflow/mcp/tools/inspection.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("Inspection MCP Tools", () => {
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
      getExecutionTrajectory: vi.fn().mockResolvedValue({
        execution_id: "exec-1",
        entries: [
          {
            type: "tool_call",
            timestamp: "2025-01-01T00:00:00.000Z",
            tool_name: "Read",
            tool_args: { path: "/test" },
          },
          {
            type: "tool_result",
            timestamp: "2025-01-01T00:00:01.000Z",
            tool_name: "Read",
            content: "file contents",
          },
        ],
        summary: {
          total_entries: 2,
          tool_calls: 1,
          errors: 0,
          duration_ms: 1000,
        },
      }),
      getExecutionChanges: vi.fn().mockResolvedValue({
        execution_id: "exec-1",
        files: [
          { path: "src/index.ts", additions: 10, deletions: 2, status: "modified" },
          { path: "src/new.ts", additions: 50, deletions: 0, status: "added" },
        ],
        commits: [
          {
            hash: "abc123",
            message: "Add feature",
            author: "Test User",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        ],
        summary: {
          files_changed: 2,
          total_additions: 60,
          total_deletions: 2,
        },
      }),
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
  // execution_trajectory Tests
  // ===========================================================================

  describe("handleExecutionTrajectory", () => {
    it("should return entries from API", async () => {
      const result = await handleExecutionTrajectory(context, {
        execution_id: "exec-1",
      });

      expect(result.execution_id).toBe("exec-1");
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].type).toBe("tool_call");
      expect(result.entries[0].tool_name).toBe("Read");
      expect(result.entries[1].type).toBe("tool_result");
      expect(mockApiClient.getExecutionTrajectory).toHaveBeenCalledWith({
        execution_id: "exec-1",
      });
    });

    it("should pass max_entries to API", async () => {
      await handleExecutionTrajectory(context, {
        execution_id: "exec-1",
        max_entries: 10,
      });

      expect(mockApiClient.getExecutionTrajectory).toHaveBeenCalledWith({
        execution_id: "exec-1",
        max_entries: 10,
      });
    });

    it("should return summary statistics", async () => {
      const result = await handleExecutionTrajectory(context, {
        execution_id: "exec-1",
      });

      expect(result.summary.total_entries).toBe(2);
      expect(result.summary.tool_calls).toBe(1);
      expect(result.summary.errors).toBe(0);
      expect(result.summary.duration_ms).toBe(1000);
    });

    it("should handle empty entries", async () => {
      (mockApiClient.getExecutionTrajectory as ReturnType<typeof vi.fn>).mockResolvedValue({
        execution_id: "exec-1",
        entries: [],
        summary: {
          total_entries: 0,
          tool_calls: 0,
          errors: 0,
        },
      });

      const result = await handleExecutionTrajectory(context, {
        execution_id: "exec-1",
      });

      expect(result.entries).toHaveLength(0);
      expect(result.summary.total_entries).toBe(0);
    });

    it("should propagate API errors", async () => {
      (mockApiClient.getExecutionTrajectory as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Execution not found")
      );

      await expect(
        handleExecutionTrajectory(context, { execution_id: "exec-nonexistent" })
      ).rejects.toThrow("Execution not found");
    });

    it("should include error entries in response", async () => {
      (mockApiClient.getExecutionTrajectory as ReturnType<typeof vi.fn>).mockResolvedValue({
        execution_id: "exec-1",
        entries: [
          { type: "tool_call", timestamp: "2025-01-01T00:00:00.000Z", tool_name: "Read" },
          { type: "error", timestamp: "2025-01-01T00:00:01.000Z", content: "Something failed" },
        ],
        summary: { total_entries: 2, tool_calls: 1, errors: 1 },
      });

      const result = await handleExecutionTrajectory(context, {
        execution_id: "exec-1",
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries[1].type).toBe("error");
      expect(result.summary.errors).toBe(1);
    });

    it("should include message entries", async () => {
      (mockApiClient.getExecutionTrajectory as ReturnType<typeof vi.fn>).mockResolvedValue({
        execution_id: "exec-1",
        entries: [
          { type: "message", timestamp: "2025-01-01T00:00:00.000Z", content: "Working on it..." },
        ],
        summary: { total_entries: 1, tool_calls: 0, errors: 0 },
      });

      const result = await handleExecutionTrajectory(context, {
        execution_id: "exec-1",
      });

      expect(result.entries[0].type).toBe("message");
      expect(result.entries[0].content).toBe("Working on it...");
    });
  });

  // ===========================================================================
  // execution_changes Tests
  // ===========================================================================

  describe("handleExecutionChanges", () => {
    it("should return file list from API", async () => {
      const result = await handleExecutionChanges(context, {
        execution_id: "exec-1",
      });

      expect(result.execution_id).toBe("exec-1");
      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.files[0].status).toBe("modified");
      expect(result.files[1].path).toBe("src/new.ts");
      expect(result.files[1].status).toBe("added");
      expect(mockApiClient.getExecutionChanges).toHaveBeenCalledWith({
        execution_id: "exec-1",
      });
    });

    it("should return summary statistics", async () => {
      const result = await handleExecutionChanges(context, {
        execution_id: "exec-1",
      });

      expect(result.summary.files_changed).toBe(2);
      expect(result.summary.total_additions).toBe(60);
      expect(result.summary.total_deletions).toBe(2);
    });

    it("should include commits", async () => {
      const result = await handleExecutionChanges(context, {
        execution_id: "exec-1",
      });

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].hash).toBe("abc123");
      expect(result.commits[0].message).toBe("Add feature");
    });

    it("should pass include_diff to API", async () => {
      await handleExecutionChanges(context, {
        execution_id: "exec-1",
        include_diff: true,
      });

      expect(mockApiClient.getExecutionChanges).toHaveBeenCalledWith({
        execution_id: "exec-1",
        include_diff: true,
      });
    });

    it("should propagate API errors", async () => {
      (mockApiClient.getExecutionChanges as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Changes not available")
      );

      await expect(
        handleExecutionChanges(context, { execution_id: "exec-nonexistent" })
      ).rejects.toThrow("Changes not available");
    });

    it("should handle deleted files", async () => {
      (mockApiClient.getExecutionChanges as ReturnType<typeof vi.fn>).mockResolvedValue({
        execution_id: "exec-1",
        files: [
          { path: "src/old.ts", additions: 0, deletions: 100, status: "deleted" },
        ],
        commits: [],
        summary: { files_changed: 1, total_additions: 0, total_deletions: 100 },
      });

      const result = await handleExecutionChanges(context, {
        execution_id: "exec-1",
      });

      expect(result.files[0].status).toBe("deleted");
    });

    it("should handle renamed files", async () => {
      (mockApiClient.getExecutionChanges as ReturnType<typeof vi.fn>).mockResolvedValue({
        execution_id: "exec-1",
        files: [
          { path: "src/new-name.ts", additions: 0, deletions: 0, status: "renamed" },
        ],
        commits: [],
        summary: { files_changed: 1, total_additions: 0, total_deletions: 0 },
      });

      const result = await handleExecutionChanges(context, {
        execution_id: "exec-1",
      });

      expect(result.files[0].status).toBe("renamed");
    });
  });
});
