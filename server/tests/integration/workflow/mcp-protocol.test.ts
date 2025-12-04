/**
 * Integration tests for Workflow MCP Server Protocol
 *
 * Tests the full MCP protocol flow by spawning the server
 * as a subprocess and communicating via stdio.
 *
 * NOTE: The MCP server now uses HTTP API instead of direct DB access.
 * Tests spawn a real test server and the MCP server communicates with it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  createTestServer,
  createTestIssues,
  type TestServer,
} from "./helpers/workflow-test-server.js";
import { createTestWorkflow } from "./helpers/workflow-test-setup.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("Workflow MCP Protocol", () => {
  let testDir: string;
  let testServer: TestServer;
  let mcpProcess: ChildProcess | null = null;

  // Path to the built MCP server entry point
  const mcpServerPath = path.join(
    __dirname,
    "../../../dist/workflow/mcp/index.js"
  );

  beforeAll(async () => {
    // Create temp directory for git repo simulation
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-mcp-test-"));

    // Initialize as a git repo (required for worktree operations)
    const { execSync } = await import("child_process");
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync('git config user.name "Test"', { cwd: testDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: testDir,
      stdio: "pipe",
    });
    fs.writeFileSync(path.join(testDir, ".gitkeep"), "");
    execSync("git add . && git commit -m 'init'", {
      cwd: testDir,
      stdio: "pipe",
    });

    // Start test server
    testServer = await createTestServer({
      repoPath: testDir,
      mockExecutor: true,
    });
  });

  afterAll(async () => {
    if (mcpProcess) {
      mcpProcess.kill();
      mcpProcess = null;
    }

    // Shutdown test server
    await testServer.shutdown();

    // Clean up temp directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean up database between tests
    testServer.db.exec("DELETE FROM workflow_events");
    testServer.db.exec("DELETE FROM workflows");
    testServer.db.exec("DELETE FROM executions");
    testServer.db.exec("DELETE FROM issues");
  });

  // ===========================================================================
  // Test Data Helpers
  // ===========================================================================

  function insertTestWorkflow() {
    // Create issues first
    createTestIssues(testServer.db, [
      { id: "i-1", title: "Issue 1" },
      { id: "i-2", title: "Issue 2" },
    ]);

    // Create workflow
    createTestWorkflow(testServer.db, {
      id: "wf-test1",
      title: "Test Workflow",
      source: { type: "issues", issueIds: ["i-1", "i-2"] },
      status: "running",
      steps: [
        {
          id: "step-1",
          issueId: "i-1",
          index: 0,
          dependencies: [],
          status: "completed",
        },
        {
          id: "step-2",
          issueId: "i-2",
          index: 1,
          dependencies: ["step-1"],
          status: "pending",
        },
      ],
      config: {
        parallelism: "sequential",
        onFailure: "pause",
        defaultAgentType: "claude-code",
        autonomyLevel: "human_in_the_loop",
      },
    });
  }

  // ===========================================================================
  // MCP Protocol Helpers
  // ===========================================================================

  interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: Record<string, unknown>;
  }

  interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number;
    result?: unknown;
    error?: {
      code: number;
      message: string;
      data?: unknown;
    };
  }

  /**
   * Spawn the MCP server and return a client interface.
   */
  function spawnMCPServer(workflowId: string): Promise<{
    send: (request: JsonRpcRequest) => void;
    receive: () => Promise<JsonRpcResponse>;
    close: () => void;
  }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("node", [
        mcpServerPath,
        "--workflow-id",
        workflowId,
        "--server-url",
        testServer.baseUrl,
        "--project-id",
        testServer.projectId,
        "--repo-path",
        testDir,
      ]);

      mcpProcess = proc;

      let buffer = "";
      const responseQueue: JsonRpcResponse[] = [];
      const waitingResolvers: ((response: JsonRpcResponse) => void)[] = [];

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();

        // Parse complete JSON-RPC messages (newline-delimited)
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line) as JsonRpcResponse;
              if (waitingResolvers.length > 0) {
                const resolver = waitingResolvers.shift()!;
                resolver(response);
              } else {
                responseQueue.push(response);
              }
            } catch {
              // Ignore non-JSON lines (like stderr redirected)
            }
          }
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        // Server logs to stderr - this is expected
        const msg = data.toString();
        if (msg.includes("Started") || msg.includes("connected")) {
          // Server is ready
          resolve({
            send: (request: JsonRpcRequest) => {
              proc.stdin.write(JSON.stringify(request) + "\n");
            },
            receive: () => {
              return new Promise((res) => {
                if (responseQueue.length > 0) {
                  res(responseQueue.shift()!);
                } else {
                  waitingResolvers.push(res);
                }
              });
            },
            close: () => {
              proc.kill();
              mcpProcess = null;
            },
          });
        }
      });

      proc.on("error", reject);

      // Timeout if server doesn't start
      setTimeout(() => {
        reject(new Error("MCP server failed to start within timeout"));
      }, 10000);
    });
  }

  // ===========================================================================
  // Tests
  // ===========================================================================

  it("should list available tools", async () => {
    insertTestWorkflow();

    const client = await spawnMCPServer("wf-test1");

    try {
      // Send tools/list request
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      const response = await client.receive();

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as { tools: Array<{ name: string }> };
      const toolNames = result.tools.map((t) => t.name);

      expect(toolNames).toContain("workflow_status");
      expect(toolNames).toContain("workflow_complete");
      expect(toolNames).toContain("execute_issue");
      expect(toolNames).toContain("execution_status");
      expect(toolNames).toContain("execution_cancel");
      expect(toolNames).toContain("execution_trajectory");
      expect(toolNames).toContain("execution_changes");
      expect(toolNames).toContain("escalate_to_user");
      expect(toolNames).toContain("notify_user");
    } finally {
      client.close();
    }
  });

  it("should handle workflow_status tool call", async () => {
    insertTestWorkflow();

    const client = await spawnMCPServer("wf-test1");

    try {
      // Call workflow_status tool
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "workflow_status",
          arguments: {},
        },
      });

      const response = await client.receive();

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as {
        content: Array<{ type: string; text: string }>;
      };
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const data = JSON.parse(result.content[0].text);
      expect(data.workflow.id).toBe("wf-test1");
      expect(data.workflow.status).toBe("running");
      expect(data.steps).toHaveLength(2);
      expect(data.readySteps).toContain("step-2");
    } finally {
      client.close();
    }
  });

  it("should handle workflow_complete tool call", async () => {
    insertTestWorkflow();

    const client = await spawnMCPServer("wf-test1");

    try {
      // Call workflow_complete tool
      client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "workflow_complete",
          arguments: {
            summary: "All tasks completed successfully",
            status: "completed",
          },
        },
      });

      const response = await client.receive();

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.workflow_status).toBe("completed");

      // Verify database was updated
      const workflow = testServer.db
        .prepare("SELECT status FROM workflows WHERE id = ?")
        .get("wf-test1") as { status: string };
      expect(workflow.status).toBe("completed");
    } finally {
      client.close();
    }
  });

  it("should return error for unknown tool", async () => {
    insertTestWorkflow();

    const client = await spawnMCPServer("wf-test1");

    try {
      client.send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "unknown_tool",
          arguments: {},
        },
      });

      const response = await client.receive();

      // Should return error response
      expect(response.result).toBeDefined();
      const result = response.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBe(true);
    } finally {
      client.close();
    }
  });

  it("should handle execution_status for non-existent execution", async () => {
    insertTestWorkflow();

    const client = await spawnMCPServer("wf-test1");

    try {
      client.send({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "execution_status",
          arguments: {
            execution_id: "exec-nonexistent",
          },
        },
      });

      const response = await client.receive();

      expect(response.result).toBeDefined();
      const result = response.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBe(true);

      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain("not found");
    } finally {
      client.close();
    }
  });

  it("should handle escalate_to_user in human_in_the_loop mode", async () => {
    insertTestWorkflow();

    const client = await spawnMCPServer("wf-test1");

    try {
      client.send({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "escalate_to_user",
          arguments: {
            message: "Need user input for decision",
            options: ["Option A", "Option B"],
          },
        },
      });

      const response = await client.receive();

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("pending");
      expect(data.escalation_id).toBeDefined();
    } finally {
      client.close();
    }
  });

  it("should handle notify_user", async () => {
    insertTestWorkflow();

    const client = await spawnMCPServer("wf-test1");

    try {
      client.send({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "notify_user",
          arguments: {
            message: "Progress update: Step 1 complete",
            level: "info",
          },
        },
      });

      const response = await client.receive();

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
    } finally {
      client.close();
    }
  });
});
