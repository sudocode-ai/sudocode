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

    it("cancelExecution calls stop endpoint", async () => {
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
        "http://localhost:3000/api/executions/exec-1/stop",
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
  });

});
