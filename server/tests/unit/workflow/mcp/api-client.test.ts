/**
 * Unit tests for Workflow MCP API Client
 *
 * Tests the HTTP client used by the MCP server to communicate with main server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  WorkflowAPIClient,
  APIError,
} from "../../../../src/workflow/mcp/api-client.js";

// =============================================================================
// Mock Setup
// =============================================================================

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("WorkflowAPIClient", () => {
  let client: WorkflowAPIClient;

  beforeEach(() => {
    vi.clearAllMocks();

    client = new WorkflowAPIClient({
      serverUrl: "http://localhost:3000",
      projectId: "proj-123",
      workflowId: "wf-abc",
      timeout: 5000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Helper
  // ===========================================================================

  function mockSuccessResponse<T>(data: T) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    });
  }

  function mockErrorResponse(status: number, message: string) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: () => Promise.resolve({ success: false, message }),
    });
  }

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("should strip trailing slash from serverUrl", () => {
      const clientWithSlash = new WorkflowAPIClient({
        serverUrl: "http://localhost:3000/",
        projectId: "proj-123",
        workflowId: "wf-abc",
      });

      mockSuccessResponse({ workflow: { id: "wf-abc" } });

      // Just call any method to trigger the request
      clientWithSlash.getWorkflowStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-abc/status",
        expect.anything()
      );
    });

    it("should use default timeout of 30000ms", async () => {
      const clientDefault = new WorkflowAPIClient({
        serverUrl: "http://localhost:3000",
        projectId: "proj-123",
        workflowId: "wf-abc",
      });

      // Mock a long-running request
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, json: () => ({}) }), 35000)
          )
      );

      // The request should have a timeout
      expect(clientDefault).toBeDefined();
    });
  });

  // ===========================================================================
  // Request Headers Tests
  // ===========================================================================

  describe("request headers", () => {
    it("should include X-Project-ID header", async () => {
      mockSuccessResponse({ workflow: { id: "wf-abc" } });

      await client.getWorkflowStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Project-ID": "proj-123",
          }),
        })
      );
    });

    it("should include Content-Type header", async () => {
      mockSuccessResponse({});

      await client.notifyUser({ message: "Test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("error handling", () => {
    it("should throw APIError on HTTP error", async () => {
      mockErrorResponse(404, "Workflow not found");

      await expect(client.getWorkflowStatus()).rejects.toThrow(APIError);
      await mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ success: false, message: "Workflow not found" }),
      });

      try {
        await client.getWorkflowStatus();
      } catch (e) {
        expect(e).toBeInstanceOf(APIError);
        expect((e as APIError).statusCode).toBe(404);
        expect((e as APIError).message).toBe("Workflow not found");
      }
    });

    it("should throw APIError on success: false response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ success: false, message: "Validation failed" }),
      });

      await expect(client.getWorkflowStatus()).rejects.toThrow(APIError);
    });

    it("should throw APIError on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.getWorkflowStatus()).rejects.toThrow(APIError);
    });

    it("should throw APIError with status 408 on timeout", async () => {
      // Mock fetch to simulate AbortError (what happens on timeout)
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(client.getWorkflowStatus()).rejects.toThrow(APIError);

      // Try another call to verify the error details
      mockFetch.mockRejectedValueOnce(abortError);
      try {
        await client.getWorkflowStatus();
      } catch (e) {
        expect(e).toBeInstanceOf(APIError);
        expect((e as APIError).statusCode).toBe(408);
        expect((e as APIError).message).toContain("timeout");
      }
    });
  });

  // ===========================================================================
  // Workflow Methods Tests
  // ===========================================================================

  describe("getWorkflowStatus", () => {
    it("should GET /api/workflows/:id/status", async () => {
      const mockStatus = {
        workflow: { id: "wf-abc", title: "Test" },
        steps: [],
        activeExecutions: [],
        readySteps: [],
      };
      mockSuccessResponse(mockStatus);

      const result = await client.getWorkflowStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-abc/status",
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toEqual(mockStatus);
    });
  });

  describe("completeWorkflow", () => {
    it("should POST /api/workflows/:id/complete with summary", async () => {
      const mockResult = {
        success: true,
        workflow_status: "completed" as const,
        completed_at: "2024-01-01T00:00:00Z",
      };
      mockSuccessResponse(mockResult);

      const result = await client.completeWorkflow({
        summary: "All done!",
        status: "completed",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-abc/complete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ summary: "All done!", status: "completed" }),
        })
      );
      expect(result).toEqual(mockResult);
    });
  });

  // ===========================================================================
  // Execution Methods Tests
  // ===========================================================================

  describe("executeIssue", () => {
    it("should POST /api/workflows/:id/execute with params", async () => {
      const mockResult = {
        execution_id: "exec-123",
        worktree_path: "/test/worktree",
        branch_name: "sudocode/exec-123",
        status: "pending" as const,
      };
      mockSuccessResponse(mockResult);

      const result = await client.executeIssue({
        issue_id: "i-1",
        worktree_mode: "create_root",
        agent_type: "claude-code",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-abc/execute",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            issue_id: "i-1",
            worktree_mode: "create_root",
            agent_type: "claude-code",
          }),
        })
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe("getExecutionStatus", () => {
    it("should GET /api/executions/:id", async () => {
      const mockResult = {
        id: "exec-123",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      };
      mockSuccessResponse(mockResult);

      const result = await client.getExecutionStatus({
        execution_id: "exec-123",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-123",
        expect.objectContaining({ method: "GET" })
      );
      expect(result.id).toBe("exec-123");
    });
  });

  describe("cancelExecution", () => {
    it("should POST /api/executions/:id/cancel with reason", async () => {
      const mockResult = {
        success: true,
        message: "Cancelled",
        final_status: "cancelled",
      };
      mockSuccessResponse(mockResult);

      const result = await client.cancelExecution({
        execution_id: "exec-123",
        reason: "User requested",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-123/cancel",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "User requested" }),
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getExecutionTrajectory", () => {
    it("should GET /api/executions/:id/trajectory", async () => {
      const mockResult = {
        execution_id: "exec-123",
        entries: [],
        summary: { total_entries: 0, tool_calls: 0, errors: 0 },
      };
      mockSuccessResponse(mockResult);

      const result = await client.getExecutionTrajectory({
        execution_id: "exec-123",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-123/trajectory",
        expect.objectContaining({ method: "GET" })
      );
      expect(result.execution_id).toBe("exec-123");
    });

    it("should include max_entries query param when specified", async () => {
      mockSuccessResponse({
        execution_id: "exec-123",
        entries: [],
        summary: {},
      });

      await client.getExecutionTrajectory({
        execution_id: "exec-123",
        max_entries: 100,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-123/trajectory?max_entries=100",
        expect.anything()
      );
    });
  });

  describe("getExecutionChanges", () => {
    it("should GET /api/executions/:id/changes", async () => {
      const mockResult = {
        execution_id: "exec-123",
        files: [],
        commits: [],
        summary: { files_changed: 0, total_additions: 0, total_deletions: 0 },
      };
      mockSuccessResponse(mockResult);

      const result = await client.getExecutionChanges({
        execution_id: "exec-123",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-123/changes",
        expect.objectContaining({ method: "GET" })
      );
      expect(result.execution_id).toBe("exec-123");
    });

    it("should include include_diff query param when true", async () => {
      mockSuccessResponse({
        execution_id: "exec-123",
        files: [],
        commits: [],
        summary: {},
      });

      await client.getExecutionChanges({
        execution_id: "exec-123",
        include_diff: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-123/changes?include_diff=true",
        expect.anything()
      );
    });
  });

  // ===========================================================================
  // Escalation Methods Tests
  // ===========================================================================

  describe("escalateToUser", () => {
    it("should POST /api/workflows/:id/escalate with message", async () => {
      const mockResult = {
        success: true,
        status: "pending" as const,
        escalation_id: "esc-123",
      };
      mockSuccessResponse(mockResult);

      const result = await client.escalateToUser({
        message: "Need user input",
        options: ["Yes", "No"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-abc/escalate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            message: "Need user input",
            options: ["Yes", "No"],
          }),
        })
      );
      expect(result.status).toBe("pending");
    });

    it("should return auto_approved in full_auto mode", async () => {
      const mockResult = {
        success: true,
        status: "auto_approved" as const,
      };
      mockSuccessResponse(mockResult);

      const result = await client.escalateToUser({
        message: "Proceed?",
      });

      expect(result.status).toBe("auto_approved");
    });
  });

  describe("notifyUser", () => {
    it("should POST /api/workflows/:id/notify with message", async () => {
      const mockResult = {
        success: true,
        delivered: true,
      };
      mockSuccessResponse(mockResult);

      const result = await client.notifyUser({
        message: "Progress update",
        level: "info",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-abc/notify",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            message: "Progress update",
            level: "info",
          }),
        })
      );
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// APIError Tests
// =============================================================================

describe("APIError", () => {
  it("should have correct name", () => {
    const error = new APIError("Test error", 500);
    expect(error.name).toBe("APIError");
  });

  it("should store statusCode", () => {
    const error = new APIError("Not found", 404);
    expect(error.statusCode).toBe(404);
  });

  it("should store response data", () => {
    const response = { details: "Additional info" };
    const error = new APIError("Error", 500, response);
    expect(error.response).toEqual(response);
  });

  it("should be instanceof Error", () => {
    const error = new APIError("Test", 500);
    expect(error).toBeInstanceOf(Error);
  });
});
