/**
 * Tests for API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SudocodeAPIClient, APIError } from "../../src/api-client.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("SudocodeAPIClient", () => {
  let client: SudocodeAPIClient;

  beforeEach(() => {
    client = new SudocodeAPIClient({
      serverUrl: "http://localhost:3000",
      projectId: "test-project",
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("strips trailing slash from server URL", () => {
      const clientWithSlash = new SudocodeAPIClient({
        serverUrl: "http://localhost:3000/",
        projectId: "test",
      });
      // Access private field via any for testing
      expect((clientWithSlash as any).serverUrl).toBe("http://localhost:3000");
    });
  });

  describe("request handling", () => {
    it("makes GET request with correct headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { executions: [], count: 0 },
        }),
      });

      await client.listExecutions({});

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions",
        expect.objectContaining({
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Project-ID": "test-project",
          },
        })
      );
    });

    it("makes POST request with body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { execution_id: "exec-123", status: "pending" },
        }),
      });

      await client.startExecution({
        issue_id: "i-test",
        agent_type: "claude-code",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/issues/i-test/executions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            agent_type: "claude-code",
            model: undefined,
            prompt: undefined,
          }),
        })
      );
    });

    it("throws APIError on non-JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html>Error page</html>",
      });

      await expect(client.listExecutions({})).rejects.toThrow(
        "Server returned non-JSON response"
      );
    });

    it("throws APIError on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: false,
          error: "Not found",
        }),
      });

      await expect(client.listExecutions({})).rejects.toThrow(APIError);
    });

    it("throws APIError on success:false response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: false,
          error: "Operation failed",
        }),
      });

      await expect(client.listExecutions({})).rejects.toThrow("Operation failed");
    });
  });

  describe("query string building", () => {
    it("builds query string from params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { executions: [], count: 0 },
        }),
      });

      await client.listExecutions({
        status: ["running", "pending"],
        limit: 10,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("status=running");
      expect(url).toContain("status=pending");
      expect(url).toContain("limit=10");
    });

    it("omits undefined params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { executions: [], count: 0 },
        }),
      });

      await client.listExecutions({
        limit: 5,
        // status is undefined
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain("status");
      expect(url).toContain("limit=5");
    });
  });

  describe("execution methods", () => {
    it("listExecutions returns executions", async () => {
      const mockData = {
        executions: [{ id: "exec-1", status: "running", agent_type: "claude-code" }],
        count: 1,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true, data: mockData }),
      });

      const result = await client.listExecutions({});
      expect(result).toEqual(mockData);
    });

    it("showExecution wraps execution in result object", async () => {
      const mockExecution = { id: "exec-1", status: "completed" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true, data: mockExecution }),
      });

      const result = await client.showExecution({ execution_id: "exec-1" });
      expect(result).toEqual({ execution: mockExecution });
    });

    it("cancelExecution calls cancel endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { success: true, message: "Cancelled", final_status: "cancelled" },
        }),
      });

      await client.cancelExecution({ execution_id: "exec-1", reason: "Test" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-1/cancel",
        expect.anything()
      );
    });
  });

  describe("inspection methods", () => {
    it("getExecutionChain transforms response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { rootId: "exec-root", executions: [] },
        }),
      });

      const result = await client.getExecutionChain({ execution_id: "exec-1" });
      expect(result.root_id).toBe("exec-root");
    });

    it("getExecutionTrajectory calls correct endpoint with params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: {
            execution_id: "exec-1",
            entries: [],
            summary: { total_entries: 0, tool_calls: 0, errors: 0 },
          },
        }),
      });

      await client.getExecutionTrajectory({
        execution_id: "exec-1",
        max_entries: 100,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "http://localhost:3000/api/executions/exec-1/trajectory?max_entries=100"
      );
    });

    it("getExecutionChanges calls correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: {
            execution_id: "exec-1",
            files: [],
            commits: [],
            summary: { files_changed: 0, total_additions: 0, total_deletions: 0 },
          },
        }),
      });

      await client.getExecutionChanges({
        execution_id: "exec-1",
        include_diff: true,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "http://localhost:3000/api/executions/exec-1/changes?include_diff=true"
      );
    });
  });

  describe("overview methods", () => {
    it("getProjectStatus calls correct endpoint", async () => {
      const mockData = {
        ready_issues: [{ id: "i-123", title: "Test", priority: 1 }],
        active_executions: [],
        running_workflows: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true, data: mockData }),
      });

      const result = await client.getProjectStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/project/status",
        expect.anything()
      );
      expect(result).toEqual(mockData);
    });
  });

  describe("adhoc execution", () => {
    it("startAdhocExecution calls correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { execution_id: "exec-adhoc", status: "pending" },
        }),
      });

      await client.startAdhocExecution({
        prompt: "Run tests",
        agent_type: "claude-code",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            prompt: "Run tests",
            agent_type: "claude-code",
            model: undefined,
          }),
        })
      );
    });
  });

  describe("follow-up", () => {
    it("createFollowUp calls correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: {
            execution_id: "exec-follow",
            parent_execution_id: "exec-1",
            status: "pending",
          },
        }),
      });

      const result = await client.createFollowUp({
        execution_id: "exec-1",
        feedback: "Please also add tests",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/executions/exec-1/follow-up",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ feedback: "Please also add tests" }),
        })
      );
      expect(result.parent_execution_id).toBe("exec-1");
    });
  });

  describe("workflow methods", () => {
    it("listWorkflows calls correct endpoint with filters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { workflows: [], count: 0 },
        }),
      });

      await client.listWorkflows({ status: ["running"], limit: 10 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/workflows");
      expect(url).toContain("status=running");
      expect(url).toContain("limit=10");
    });

    it("showWorkflow calls correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { id: "wf-1", status: "running" },
        }),
      });

      await client.showWorkflow({ workflow_id: "wf-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-1",
        expect.anything()
      );
    });

    it("getWorkflowStatus calls status endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { id: "wf-1", status: "running", steps: [] },
        }),
      });

      await client.getWorkflowStatus({ workflow_id: "wf-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-1/status",
        expect.anything()
      );
    });

    it("createWorkflow calls POST endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { id: "wf-new", status: "pending" },
        }),
      });

      await client.createWorkflow({
        source: "s-spec123",
        config: { parallel: true },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            source: "s-spec123",
            config: { parallel: true },
          }),
        })
      );
    });

    it("startWorkflow calls start endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { status: "running" },
        }),
      });

      await client.startWorkflow({ workflow_id: "wf-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-1/start",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("pauseWorkflow calls pause endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { status: "paused" },
        }),
      });

      await client.pauseWorkflow({ workflow_id: "wf-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-1/pause",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("cancelWorkflow calls cancel endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { status: "cancelled" },
        }),
      });

      await client.cancelWorkflow({ workflow_id: "wf-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-1/cancel",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("resumeWorkflow calls resume endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { status: "running" },
        }),
      });

      await client.resumeWorkflow({ workflow_id: "wf-1" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/workflows/wf-1/resume",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("error handling", () => {
    it("handles AbortError from timeout", async () => {
      // Mock fetch to throw AbortError (what happens on timeout)
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(client.listExecutions({})).rejects.toThrow("timeout");
    });

    it("handles connection refused errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fetch failed: ECONNREFUSED"));

      await expect(client.listExecutions({})).rejects.toThrow(
        "Cannot connect to server"
      );
    });

    it("preserves APIError properties", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: false,
          message: "Execution not found",
        }),
      });

      try {
        await client.showExecution({ execution_id: "nonexistent" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(APIError);
        expect((error as APIError).statusCode).toBe(404);
        expect((error as APIError).message).toBe("Execution not found");
      }
    });
  });

  describe("tags filter", () => {
    it("includes tags in query string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { executions: [], count: 0 },
        }),
      });

      await client.listExecutions({ tags: ["project-assistant", "test"] });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("tags=project-assistant");
      expect(url).toContain("tags=test");
    });
  });

});
