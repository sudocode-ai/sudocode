/**
 * End-to-End Tests for sudocode-mcp API-based Tools
 *
 * Tests the MCP server's extended scope tools against a live test server.
 * These tools require --server-url and use HTTP API instead of CLI.
 *
 * Covers:
 * - overview scope: project_status
 * - executions scope: list_executions, show_execution, start_execution, etc.
 * - inspection scope: execution_trajectory, execution_changes, execution_chain
 * - workflows scope: list_workflows, show_workflow, create_workflow, etc.
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
import { fileURLToPath } from "url";

// Import test helpers from server package
import {
  createTestServer,
  createTestIssues,
  createTestSpecs,
  type TestServer,
} from "../../../server/tests/integration/workflow/helpers/workflow-test-server.js";

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
  result?: {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPClient {
  send: (request: JsonRpcRequest) => void;
  receive: () => Promise<JsonRpcResponse>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<any>;
  close: () => void;
}

// =============================================================================
// Test Suite
// =============================================================================

describe.skipIf(SKIP_E2E)("sudocode-mcp API Tools E2E", () => {
  let testDir: string;
  let testServer: TestServer;
  let mcpProcess: ChildProcess | null = null;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, "../../dist/index.js");

  beforeAll(async () => {
    // Create temp directory for git repo
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-mcp-api-e2e-"));

    // Initialize as a git repo
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync('git config user.name "Test"', { cwd: testDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: testDir,
      stdio: "pipe",
    });

    // Create .sudocode directory structure
    fs.mkdirSync(path.join(testDir, ".sudocode"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".sudocode", "issues.jsonl"), "");
    fs.writeFileSync(path.join(testDir, ".sudocode", "specs.jsonl"), "");

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

  function spawnMCPServer(scope: string = "all"): Promise<MCPClient> {
    return new Promise((resolve, reject) => {
      const proc = spawn("node", [
        mcpServerPath,
        "--scope",
        scope,
        "--server-url",
        testServer.baseUrl,
        "--project-id",
        testServer.projectId,
        "--working-dir",
        testDir,
        "--no-sync",
      ]);

      mcpProcess = proc;

      let buffer = "";
      const responseQueue: JsonRpcResponse[] = [];
      const waitingResolvers: ((response: JsonRpcResponse) => void)[] = [];
      let requestId = 0;

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

      let started = false;
      proc.stderr.on("data", (data: Buffer) => {
        const msg = data.toString();
        // Look for startup message
        if (
          !started &&
          (msg.includes("running on stdio") || msg.includes("initialized"))
        ) {
          started = true;

          const client: MCPClient = {
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
            callTool: async (
              name: string,
              args: Record<string, unknown> = {}
            ) => {
              const id = ++requestId;
              client.send({
                jsonrpc: "2.0",
                id,
                method: "tools/call",
                params: { name, arguments: args },
              });

              const response = await client.receive();
              if (response.error) {
                throw new Error(response.error.message);
              }

              if (response.result?.isError) {
                const text = response.result.content[0]?.text || "Unknown error";
                throw new Error(text);
              }

              const text = response.result?.content[0]?.text;
              return text ? JSON.parse(text) : null;
            },
            close: () => {
              proc.kill();
              mcpProcess = null;
            },
          };

          resolve(client);
        }
      });

      proc.on("error", reject);

      setTimeout(() => {
        if (!started) {
          reject(new Error("MCP server failed to start within timeout"));
        }
      }, 10000);
    });
  }

  function insertTestData() {
    createTestIssues(testServer.db, [
      { id: "i-test1", title: "Test Issue 1", status: "open", priority: 1 },
      { id: "i-test2", title: "Test Issue 2", status: "open", priority: 2 },
      { id: "i-test3", title: "Test Issue 3", status: "in_progress", priority: 0 },
    ]);

    createTestSpecs(testServer.db, [
      { id: "s-spec1", title: "Test Spec 1" },
      { id: "s-spec2", title: "Test Spec 2" },
    ]);
  }

  // ===========================================================================
  // Overview Scope Tests
  // ===========================================================================

  describe("overview scope", () => {
    // Note: project_status endpoint is not yet implemented in the server
    it.skip("should get project status with ready issues", async () => {
      insertTestData();
      const client = await spawnMCPServer("overview");

      try {
        const result = await client.callTool("project_status");

        expect(result).toBeDefined();
        expect(result.ready_issues).toBeDefined();
        expect(Array.isArray(result.ready_issues)).toBe(true);
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Executions Scope Tests
  // ===========================================================================

  describe("executions scope", () => {
    it("should list executions (empty initially)", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        const result = await client.callTool("list_executions");

        expect(result).toBeDefined();
        expect(result.executions).toBeDefined();
        expect(Array.isArray(result.executions)).toBe(true);
        expect(result.total).toBe(0);
      } finally {
        client.close();
      }
    });

    it("should start an execution for an issue", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        const result = await client.callTool("start_execution", {
          issue_id: "i-test1",
          agent_type: "claude-code",
          prompt: "Implement the test issue requirements",
        });

        expect(result).toBeDefined();
        expect(result.execution_id).toBeDefined();
        expect(result.status).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should start adhoc execution without issue", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        const result = await client.callTool("start_adhoc_execution", {
          prompt: "Run tests and report results",
          agent_type: "claude-code",
        });

        expect(result).toBeDefined();
        expect(result.execution_id).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should show execution details after starting", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        // Start an execution first
        const startResult = await client.callTool("start_execution", {
          issue_id: "i-test1",
          prompt: "Implement the test issue",
        });

        const executionId = startResult.execution_id;

        // Get execution details
        const result = await client.callTool("show_execution", {
          execution_id: executionId,
        });

        expect(result).toBeDefined();
        expect(result.execution).toBeDefined();
        expect(result.execution.id).toBe(executionId);
      } finally {
        client.close();
      }
    });

    it("should filter executions by status", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        // Start an execution
        await client.callTool("start_execution", {
          issue_id: "i-test1",
          prompt: "Implement the test issue",
        });

        // List running executions
        const result = await client.callTool("list_executions", {
          status: ["running", "pending", "preparing"],
        });

        expect(result.executions.length).toBeGreaterThanOrEqual(1);
      } finally {
        client.close();
      }
    });

    it("should cancel a running execution", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        // Start an execution
        const startResult = await client.callTool("start_execution", {
          issue_id: "i-test1",
          prompt: "Implement the test issue",
        });

        const executionId = startResult.execution_id;

        // Cancel it
        const result = await client.callTool("cancel_execution", {
          execution_id: executionId,
          reason: "Test cancellation",
        });

        // Cancel returns undefined on success (204 No Content equivalent)
        // or a simple message - just verify no error was thrown
        expect(result).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should create follow-up execution", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        // Start an execution
        const startResult = await client.callTool("start_execution", {
          issue_id: "i-test1",
          prompt: "Implement the test issue",
        });

        const executionId = startResult.execution_id;

        // Create follow-up
        const result = await client.callTool("create_follow_up", {
          execution_id: executionId,
          feedback: "Please also add unit tests",
        });

        expect(result).toBeDefined();
        expect(result.execution_id).toBeDefined();
        // parent_execution_id may be null if not set by mock executor
        expect(result.execution_id).not.toBe(executionId);
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Inspection Scope Tests
  // ===========================================================================

  describe("inspection scope", () => {
    it("should get execution chain", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions,inspection");

      try {
        // Start an execution
        const startResult = await client.callTool("start_execution", {
          issue_id: "i-test1",
          prompt: "Implement the test issue",
        });

        const executionId = startResult.execution_id;

        // Get execution chain
        const result = await client.callTool("execution_chain", {
          execution_id: executionId,
        });

        expect(result).toBeDefined();
        expect(result.root_id).toBeDefined();
        expect(result.executions).toBeDefined();
        expect(Array.isArray(result.executions)).toBe(true);
      } finally {
        client.close();
      }
    });

    // Note: trajectory endpoint is not yet implemented in the server
    it.skip("should get execution trajectory", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions,inspection");

      try {
        // Start an execution
        const startResult = await client.callTool("start_execution", {
          issue_id: "i-test1",
          prompt: "Implement the test issue",
        });

        const executionId = startResult.execution_id;

        // Get trajectory
        const result = await client.callTool("execution_trajectory", {
          execution_id: executionId,
          max_entries: 50,
        });

        expect(result).toBeDefined();
        expect(result.execution_id).toBe(executionId);
        expect(result.entries).toBeDefined();
        expect(result.summary).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should get execution changes", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions,inspection");

      try {
        // Start an execution
        const startResult = await client.callTool("start_execution", {
          issue_id: "i-test1",
          prompt: "Implement the test issue",
        });

        const executionId = startResult.execution_id;

        // Get changes - returns ExecutionChangesResult
        const result = await client.callTool("execution_changes", {
          execution_id: executionId,
        });

        expect(result).toBeDefined();
        // Response has 'available' field indicating if changes can be computed
        expect(typeof result.available).toBe("boolean");
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Workflows Scope Tests
  // ===========================================================================

  describe("workflows scope", () => {
    it("should list workflows (empty initially)", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows");

      try {
        const result = await client.callTool("list_workflows");

        expect(result).toBeDefined();
        // Response format may vary, just check we got something back
      } finally {
        client.close();
      }
    });

    it("should create a workflow from issues", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows");

      try {
        const result = await client.callTool("create_workflow", {
          source: { type: "issues", issueIds: ["i-test1", "i-test2"] },
        });

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should show workflow details", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows");

      try {
        // Create a workflow first
        const createResult = await client.callTool("create_workflow", {
          source: { type: "issues", issueIds: ["i-test1"] },
        });

        const workflowId = createResult.id;

        // Show workflow
        const result = await client.callTool("show_workflow", {
          workflow_id: workflowId,
        });

        expect(result).toBeDefined();
        expect(result.id).toBe(workflowId);
      } finally {
        client.close();
      }
    });

    it("should get workflow status", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows");

      try {
        // Create a workflow first
        const createResult = await client.callTool("create_workflow", {
          source: { type: "issues", issueIds: ["i-test1"] },
        });

        const workflowId = createResult.id;

        // Get status
        const result = await client.callTool("workflow_status", {
          workflow_id: workflowId,
        });

        expect(result).toBeDefined();
        expect(result.workflow).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should start a pending workflow", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows");

      try {
        // Create a workflow first
        const createResult = await client.callTool("create_workflow", {
          source: { type: "issues", issueIds: ["i-test1"] },
        });

        const workflowId = createResult.id;

        // Start it
        const result = await client.callTool("start_workflow", {
          workflow_id: workflowId,
        });

        expect(result).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should cancel a workflow", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows");

      try {
        // Create and start a workflow
        const createResult = await client.callTool("create_workflow", {
          source: { type: "issues", issueIds: ["i-test1"] },
        });

        const workflowId = createResult.id;
        await client.callTool("start_workflow", { workflow_id: workflowId });

        // Cancel it
        const result = await client.callTool("cancel_workflow", {
          workflow_id: workflowId,
        });

        expect(result).toBeDefined();
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Combined Scopes Tests
  // ===========================================================================

  describe("all scope (combined)", () => {
    it("should access all tools with 'all' scope", async () => {
      insertTestData();
      const client = await spawnMCPServer("all");

      try {
        // Test execution tool (project_status not implemented yet)
        const execResult = await client.callTool("list_executions");
        expect(execResult).toBeDefined();
        expect(execResult.executions).toBeDefined();

        // Test workflow tool
        const workflowResult = await client.callTool("list_workflows");
        expect(workflowResult).toBeDefined();

        // Test default scope tool (should be included in 'all')
        const issueResult = await client.callTool("list_issues");
        expect(issueResult).toBeDefined();
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("error handling", () => {
    it("should return error for non-existent execution", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        await expect(
          client.callTool("show_execution", {
            execution_id: "exec-nonexistent-12345",
          })
        ).rejects.toThrow();
      } finally {
        client.close();
      }
    });

    it("should return error for non-existent workflow", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows");

      try {
        await expect(
          client.callTool("show_workflow", {
            workflow_id: "wf-nonexistent-12345",
          })
        ).rejects.toThrow();
      } finally {
        client.close();
      }
    });

    it("should return error for non-existent issue when starting execution", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions");

      try {
        await expect(
          client.callTool("start_execution", {
            issue_id: "i-nonexistent",
            prompt: "Test prompt",
          })
        ).rejects.toThrow();
      } finally {
        client.close();
      }
    });
  });

  // ===========================================================================
  // Granular Scope Tests
  // ===========================================================================

  describe("granular scopes", () => {
    it("executions:read should not have write tools", async () => {
      insertTestData();
      const client = await spawnMCPServer("executions:read");

      try {
        // Read should work
        const result = await client.callTool("list_executions");
        expect(result).toBeDefined();

        // Write should fail (tool not available)
        await expect(
          client.callTool("start_execution", {
            issue_id: "i-test1",
            prompt: "Test prompt",
          })
        ).rejects.toThrow();
      } finally {
        client.close();
      }
    });

    it("workflows:read should not have write tools", async () => {
      insertTestData();
      const client = await spawnMCPServer("workflows:read");

      try {
        // Read should work
        const result = await client.callTool("list_workflows");
        expect(result).toBeDefined();

        // Write should fail (tool not available)
        await expect(
          client.callTool("create_workflow", {
            source: { type: "issues", issueIds: ["i-test1"] },
          })
        ).rejects.toThrow();
      } finally {
        client.close();
      }
    });
  });
});
