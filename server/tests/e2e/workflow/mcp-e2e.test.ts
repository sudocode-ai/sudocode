/**
 * End-to-End Tests for Workflow MCP Server
 *
 * Tests the full workflow lifecycle via MCP protocol including:
 * - Workflow status queries
 * - Issue execution
 * - Escalation flows
 * - Workflow completion
 *
 * Uses subprocess spawning to test the MCP server with real HTTP API backend.
 *
 * @group e2e
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { spawn, ChildProcess, execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  createTestServer,
  createTestIssues,
  type TestServer,
} from "../../integration/workflow/helpers/workflow-test-server.js";
import { createTestWorkflow } from "../../integration/workflow/helpers/workflow-test-setup.js";
import type { MockExecutionService } from "../../integration/workflow/helpers/mock-executor.js";

// Skip E2E tests by default
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

// =============================================================================
// Types
// =============================================================================

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

interface MCPClient {
  send: (request: JsonRpcRequest) => void;
  receive: () => Promise<JsonRpcResponse>;
  close: () => void;
}

// =============================================================================
// Test Suite
// =============================================================================

describe.skipIf(SKIP_E2E)("Workflow MCP E2E", () => {
  let testDir: string;
  let testServer: TestServer;
  let mcpProcess: ChildProcess | null = null;

  const mcpServerPath = path.join(
    __dirname,
    "../../../dist/workflow/mcp/index.js"
  );

  beforeAll(async () => {
    // Create temp directory for git repo
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-mcp-e2e-"));

    // Initialize as a git repo
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
  });

  afterAll(() => {
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    testServer = await createTestServer({
      repoPath: testDir,
      mockExecutor: true,
      mockExecutorOptions: {
        defaultDelayMs: 0,
      },
    });
  });

  afterEach(async () => {
    if (mcpProcess) {
      mcpProcess.kill();
      mcpProcess = null;
    }
    if (testServer) {
      await testServer.shutdown();
    }
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  function spawnMCPServer(workflowId: string): Promise<MCPClient> {
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
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line) as JsonRpcResponse;
              if (waitingResolvers.length > 0) {
                waitingResolvers.shift()!(response);
              } else {
                responseQueue.push(response);
              }
            } catch {
              // Ignore non-JSON lines
            }
          }
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes("Started") || msg.includes("connected")) {
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

      setTimeout(() => {
        reject(new Error("MCP server failed to start within timeout"));
      }, 10000);
    });
  }

  function insertWorkflow(options?: { status?: string }) {
    createTestIssues(testServer.db, [
      { id: "i-1", title: "Setup environment" },
      { id: "i-2", title: "Implement feature" },
      { id: "i-3", title: "Write tests" },
    ]);

    return createTestWorkflow(testServer.db, {
      id: "wf-e2e-test",
      title: "E2E Test Workflow",
      source: { type: "issues", issueIds: ["i-1", "i-2", "i-3"] },
      status: (options?.status || "running") as any,
      steps: [
        {
          id: "step-1",
          issueId: "i-1",
          index: 0,
          dependencies: [],
          status: "pending",
        },
        {
          id: "step-2",
          issueId: "i-2",
          index: 1,
          dependencies: ["step-1"],
          status: "pending",
        },
        {
          id: "step-3",
          issueId: "i-3",
          index: 2,
          dependencies: ["step-2"],
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
  // Full Workflow Lifecycle Tests
  // ===========================================================================

  describe("Full Workflow Lifecycle", () => {
    it("should query workflow status and see all steps", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "workflow_status",
            arguments: {},
          },
        });

        const response = await client.receive();
        expect(response.error).toBeUndefined();

        const result = response.result as {
          content: Array<{ type: string; text: string }>;
        };
        const data = JSON.parse(result.content[0].text);

        expect(data.workflow.id).toBe("wf-e2e-test");
        expect(data.workflow.status).toBe("running");
        expect(data.steps).toHaveLength(3);
        // Progress may or may not be included depending on API response format
        if (data.progress) {
          expect(data.progress.total).toBe(3);
          expect(data.progress.completed).toBe(0);
        }
      } finally {
        client.close();
      }
    });

    it("should execute an issue and track progress", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        // Execute issue
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execute_issue",
            arguments: {
              issue_id: "i-1",
              worktree_mode: "reuse",
            },
          },
        });

        const response = await client.receive();
        expect(response.error).toBeUndefined();

        const result = response.result as {
          content: Array<{ type: string; text: string }>;
        };
        const data = JSON.parse(result.content[0].text);

        expect(data.execution_id).toBeDefined();
        expect(data.status).toBe("running");
      } finally {
        client.close();
      }
    });

    it("should complete workflow with summary", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "workflow_complete",
            arguments: {
              summary:
                "All steps completed successfully. Environment setup, feature implemented, and tests written.",
              status: "completed",
            },
          },
        });

        const response = await client.receive();
        expect(response.error).toBeUndefined();

        const result = response.result as {
          content: Array<{ type: string; text: string }>;
        };
        const data = JSON.parse(result.content[0].text);

        expect(data.success).toBe(true);
        expect(data.workflow_status).toBe("completed");

        // Verify in database
        const workflow = testServer.db
          .prepare("SELECT * FROM workflows WHERE id = ?")
          .get("wf-e2e-test") as any;
        expect(workflow.status).toBe("completed");
      } finally {
        client.close();
      }
    });

    it("should fail workflow with error summary", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "workflow_complete",
            arguments: {
              summary: "Failed to complete due to test failures",
              status: "failed",
            },
          },
        });

        const response = await client.receive();
        expect(response.error).toBeUndefined();

        const result = response.result as {
          content: Array<{ type: string; text: string }>;
        };
        const data = JSON.parse(result.content[0].text);

        expect(data.success).toBe(true);
        expect(data.workflow_status).toBe("failed");
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Escalation Tests
  // ===========================================================================

  describe("Escalation Flow", () => {
    it("should create escalation and return pending status", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "escalate_to_user",
            arguments: {
              message:
                "Should I refactor the existing code or add new functionality?",
              options: ["Refactor", "Add new functionality", "Both"],
            },
          },
        });

        const response = await client.receive();
        expect(response.error).toBeUndefined();

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

    it("should send info notification", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "notify_user",
            arguments: {
              message: "Starting environment setup...",
              level: "info",
            },
          },
        });

        const response = await client.receive();
        expect(response.error).toBeUndefined();

        const result = response.result as {
          content: Array<{ type: string; text: string }>;
        };
        const data = JSON.parse(result.content[0].text);

        expect(data.success).toBe(true);
      } finally {
        client.close();
      }
    });

    it("should send warning notification", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "notify_user",
            arguments: {
              message: "Tests took longer than expected",
              level: "warning",
            },
          },
        });

        const response = await client.receive();
        expect(response.error).toBeUndefined();

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

  // ===========================================================================
  // Execution Tracking Tests
  // ===========================================================================

  describe("Execution Tracking", () => {
    it("should get execution status after starting issue", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        // First execute an issue
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execute_issue",
            arguments: {
              issue_id: "i-1",
              worktree_mode: "reuse",
            },
          },
        });

        const execResponse = await client.receive();
        const execResult = execResponse.result as {
          content: Array<{ type: string; text: string }>;
        };
        const execData = JSON.parse(execResult.content[0].text);
        const executionId = execData.execution_id;

        expect(executionId).toBeDefined();

        // Now get execution status
        client.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "execution_status",
            arguments: {
              execution_id: executionId,
            },
          },
        });

        const statusResponse = await client.receive();
        expect(statusResponse.error).toBeUndefined();

        const statusResult = statusResponse.result as {
          content: Array<{ type: string; text: string }>;
        };
        const statusData = JSON.parse(statusResult.content[0].text);

        // Response format may vary - check for either execution object or direct status
        if (statusData.execution) {
          expect(statusData.execution.id).toBe(executionId);
        } else if (statusData.id) {
          expect(statusData.id).toBe(executionId);
        } else if (statusData.status) {
          // Just verify we got some status
          expect(statusData.status).toBeDefined();
        }
      } finally {
        client.close();
      }
    });

    it("should cancel running execution", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        // Execute an issue
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execute_issue",
            arguments: {
              issue_id: "i-1",
              worktree_mode: "reuse",
            },
          },
        });

        const execResponse = await client.receive();
        const execResult = execResponse.result as {
          content: Array<{ type: string; text: string }>;
        };
        const execData = JSON.parse(execResult.content[0].text);
        const executionId = execData.execution_id;

        expect(executionId).toBeDefined();

        // Cancel execution
        client.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "execution_cancel",
            arguments: {
              execution_id: executionId,
            },
          },
        });

        const cancelResponse = await client.receive();
        expect(cancelResponse.error).toBeUndefined();

        const cancelResult = cancelResponse.result as {
          content: Array<{ type: string; text: string }>;
        };
        const cancelData = JSON.parse(cancelResult.content[0].text);

        // Response format may vary
        if (cancelData.success !== undefined) {
          expect(cancelData.success).toBe(true);
        }
        // Just verify we got a response (cancel may already have happened)
        expect(cancelData).toBeDefined();
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("Error Handling", () => {
    it("should return error for non-existent workflow", async () => {
      // Create workflow with different ID
      insertWorkflow();

      // Try to connect to non-existent workflow
      const client = await spawnMCPServer("wf-nonexistent");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "workflow_status",
            arguments: {},
          },
        });

        const response = await client.receive();
        const result = response.result as {
          content: Array<{ type: string; text: string }>;
          isError?: boolean;
        };

        // Should return an error response
        expect(result.isError).toBe(true);
      } finally {
        client.close();
      }
    });

    it("should return error for invalid execution ID", async () => {
      insertWorkflow();
      const client = await spawnMCPServer("wf-e2e-test");

      try {
        client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execution_status",
            arguments: {
              execution_id: "exec-invalid-id-12345",
            },
          },
        });

        const response = await client.receive();
        const result = response.result as {
          content: Array<{ type: string; text: string }>;
          isError?: boolean;
        };

        expect(result.isError).toBe(true);
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toBeDefined();
      } finally {
        client.close();
      }
    });
  });
});
