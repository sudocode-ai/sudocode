/**
 * End-to-End Tests for GitHub Copilot Agent Execution
 *
 * These tests verify the full execution flow with the actual GitHub Copilot CLI.
 * Tests are skipped by default and require copilot CLI to be installed and available.
 *
 * ⚠️ These tests make REAL AI API calls (optimized with simple math prompts).
 * Full suite runs in ~30 seconds.
 *
 * To run these tests:
 * 1. Install GitHub Copilot CLI (npm install -g @github/copilot-cli)
 * 2. Authenticate: copilot auth
 * 3. Set environment variable: RUN_E2E_TESTS=true
 * 4. Run: RUN_E2E_TESTS=true npm --prefix server test -- --run copilot-execution.test.ts
 *
 * Test coverage:
 * - Basic execution with Copilot CLI
 * - Resilience layer integration
 * - Adapter configuration and validation
 * - Tool permissions and model selection
 *
 * @group e2e
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import {
  SimpleExecutionEngine,
  ResilientExecutor,
  LinearOrchestrator,
  createProcessManager,
} from "agent-execution-engine";
import { CopilotAdapter } from "../../src/execution/adapters/copilot-adapter.js";
import type { CopilotConfig } from "@sudocode-ai/types/agents";
import type { ExecutionTask, WorkflowDefinition } from "agent-execution-engine";

// Skip E2E tests by default (they require copilot CLI to be installed)
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

const COPILOT_PATH = process.env.COPILOT_PATH || "copilot";

/**
 * Check if GitHub Copilot CLI is available on the system
 */
async function checkCopilotAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(COPILOT_PATH, ["--version"]);
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}

describe.skipIf(SKIP_E2E)("Copilot E2E Tests", () => {
  let tempDir: string;
  let adapter: CopilotAdapter;

  beforeEach(async () => {
    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-e2e-"));

    // Create test file
    await fs.writeFile(
      path.join(tempDir, "test.txt"),
      "Hello from Copilot E2E test"
    );

    adapter = new CopilotAdapter();
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should check copilot CLI availability", { timeout: 10000 }, async () => {
    const available = await checkCopilotAvailable();
    expect(available).toBe(true);
  });

  describe("Structured Mode Execution", () => {
    it(
      "should execute simple task with copilot",
      { timeout: 120000 },
      async () => {
        const config: CopilotConfig = {
          workDir: tempDir,
          copilotPath: COPILOT_PATH,
          allowAllTools: true, // Auto-approve all tool executions
          model: "claude-sonnet-4.5", // Use valid Copilot model
        };

        const processConfig = adapter.buildProcessConfig(config);
        const processManager = createProcessManager({
          ...processConfig,
          mode: "structured",
          timeout: 30000,
        });

        const engine = new SimpleExecutionEngine(processManager, {
          defaultProcessConfig: processConfig,
          maxConcurrent: 1,
        });

        try {
          const task: ExecutionTask = {
            id: "test-task-1",
            type: "issue",
            prompt: "What is 2 + 2? Reply with just the number.",
            workDir: tempDir,
            priority: 0,
            dependencies: [],
            config: {},
            createdAt: new Date(),
          };

          const taskId = await engine.submitTask(task);
          const result = await engine.waitForTask(taskId);

          expect(result).toBeDefined();
          expect(result.success).toBe(true);
          expect(result.output).toBeDefined();
        } finally {
          await engine.shutdown();
        }
      }
    );

    it(
      "should handle task with specific model",
      { timeout: 120000 },
      async () => {
        const config: CopilotConfig = {
          workDir: tempDir,
          copilotPath: COPILOT_PATH,
          allowAllTools: true,
          model: "gpt-5", // Use valid Copilot model
        };

        const processConfig = adapter.buildProcessConfig(config);
        const processManager = createProcessManager({
          ...processConfig,
          mode: "structured",
          timeout: 30000,
        });

        const engine = new SimpleExecutionEngine(processManager, {
          defaultProcessConfig: processConfig,
          maxConcurrent: 1,
        });

        try {
          const task: ExecutionTask = {
            id: "test-task-2",
            type: "issue",
            prompt: "What is 5 + 3? Reply with just the number.",
            workDir: tempDir,
            priority: 0,
            dependencies: [],
            config: {},
            createdAt: new Date(),
          };

          const taskId = await engine.submitTask(task);
          const result = await engine.waitForTask(taskId);

          expect(result).toBeDefined();
          expect(result.success).toBe(true);
          expect(result.output).toBeDefined();
        } finally {
          await engine.shutdown();
        }
      }
    );
  });

  describe("Execution with Resilience Layer", () => {
    it(
      "should execute task with retry logic",
      { timeout: 180000 },
      async () => {
        const config: CopilotConfig = {
          workDir: tempDir,
          copilotPath: COPILOT_PATH,
          allowAllTools: true,
          model: "claude-sonnet-4.5",
        };

        const processConfig = adapter.buildProcessConfig(config);
        const processManager = createProcessManager({
          ...processConfig,
          mode: "structured",
          timeout: 60000,
        });

        const engine = new SimpleExecutionEngine(processManager, {
          defaultProcessConfig: processConfig,
          maxConcurrent: 1,
        });
        const executor = new ResilientExecutor(engine, {
          maxAttempts: 3,
          backoff: {
            type: "exponential",
            baseDelayMs: 1000,
            maxDelayMs: 30000,
            jitter: true,
          },
          retryableErrors: ["timeout", "ECONNREFUSED"],
          retryableExitCodes: [1],
        });

        try {
          const task: ExecutionTask = {
            id: "test-task-4",
            type: "issue",
            prompt: "What is 10 - 2? Reply with just the number.",
            workDir: tempDir,
            priority: 0,
            dependencies: [],
            config: {},
            createdAt: new Date(),
          };

          const result = await executor.executeTask(task);

          expect(result).toBeDefined();
          expect(result.success).toBe(true);
          expect(result.totalAttempts).toBeGreaterThanOrEqual(1);
          expect(result.totalAttempts).toBeLessThanOrEqual(3);
        } finally {
          await engine.shutdown();
        }
      }
    );
  });

  describe("Adapter Integration", () => {
    it("should validate configuration", () => {
      const validConfig: CopilotConfig = {
        workDir: tempDir,
        copilotPath: COPILOT_PATH,
        allowAllTools: true,
        model: "gpt-4o",
      };

      const errors = adapter.validateConfig(validConfig);
      expect(errors).toEqual([]);
    });

    it("should detect missing workDir", () => {
      const invalidConfig: CopilotConfig = {
        workDir: "",
        copilotPath: COPILOT_PATH,
      };

      const errors = adapter.validateConfig(invalidConfig);
      expect(errors).toContain("workDir is required");
    });

    it("should detect conflicting tool permissions", () => {
      const config1: CopilotConfig = {
        workDir: tempDir,
        allowAllTools: true,
        allowTool: "bash",
      };

      const errors1 = adapter.validateConfig(config1);
      expect(errors1.length).toBeGreaterThan(0);
      expect(errors1.some((e) => e.includes("allowTool is ignored"))).toBe(
        true
      );

      const config2: CopilotConfig = {
        workDir: tempDir,
        allowAllTools: true,
        denyTool: "bash",
      };

      const errors2 = adapter.validateConfig(config2);
      expect(errors2.length).toBeGreaterThan(0);
      expect(errors2.some((e) => e.includes("denyTool takes precedence"))).toBe(
        true
      );
    });

    it("should build process config correctly", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        copilotPath: COPILOT_PATH,
        allowAllTools: true,
        model: "gpt-4o",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe(COPILOT_PATH);
      expect(processConfig.workDir).toBe(tempDir);
      expect(processConfig.args).toContain("--no-color");
      expect(processConfig.args).toContain("--log-level");
      expect(processConfig.args).toContain("debug");
      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("gpt-4o");
      expect(processConfig.args).toContain("--allow-all-tools");
    });

    it("should build process config with specific tool permissions", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        copilotPath: COPILOT_PATH,
        allowTool: "bash,read_file",
        denyTool: "web_search",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain("--allow-tool");
      expect(processConfig.args).toContain("bash,read_file");
      expect(processConfig.args).toContain("--deny-tool");
      expect(processConfig.args).toContain("web_search");
    });

    it("should build process config without allowAllTools", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        copilotPath: COPILOT_PATH,
        allowAllTools: false,
        model: "gpt-4o",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).not.toContain("--allow-all-tools");
      expect(processConfig.args).toContain("--no-color");
      expect(processConfig.args).toContain("--log-level");
    });

    it("should provide default configuration", () => {
      const defaults = adapter.getDefaultConfig();

      expect(defaults.copilotPath).toBe("copilot");
      expect(defaults.allowAllTools).toBe(true);
      expect(defaults.model).toBeUndefined(); // Use account default
    });

    it("should expose correct metadata", () => {
      expect(adapter.metadata.name).toBe("copilot");
      expect(adapter.metadata.displayName).toBe("GitHub Copilot");
      expect(adapter.metadata.supportedModes).toContain("structured");
      expect(adapter.metadata.supportedModes).toContain("interactive");
      expect(adapter.metadata.supportsStreaming).toBe(true);
      expect(adapter.metadata.supportsStructuredOutput).toBe(true);
    });

    it("should handle custom copilot path", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        copilotPath: "/custom/path/to/copilot",
        allowAllTools: true,
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.executablePath).toBe("/custom/path/to/copilot");
    });
  });

  describe("Advanced Configuration", () => {
    it("should handle additional directories", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        copilotPath: COPILOT_PATH,
        addDir: ["/path/to/lib1", "/path/to/lib2"],
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--add-dir");
      expect(processConfig.args).toContain("/path/to/lib1");
      expect(processConfig.args).toContain("/path/to/lib2");
    });

    it("should handle disabled MCP servers", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        copilotPath: COPILOT_PATH,
        disableMcpServer: ["server1", "server2"],
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--disable-mcp-server");
      expect(processConfig.args).toContain("server1");
      expect(processConfig.args).toContain("server2");
    });

    it("should detect empty paths in addDir", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        addDir: ["", "/valid/path"],
      };

      const errors = adapter.validateConfig(config);
      expect(errors.some((e) => e.includes("addDir contains empty path"))).toBe(
        true
      );
    });

    it("should detect empty server names in disableMcpServer", () => {
      const config: CopilotConfig = {
        workDir: tempDir,
        disableMcpServer: ["", "valid-server"],
      };

      const errors = adapter.validateConfig(config);
      expect(
        errors.some((e) => e.includes("disableMcpServer contains empty server name"))
      ).toBe(true);
    });
  });

  describe("Multi-Step Workflow", () => {
    it(
      "should execute multi-step workflow",
      { timeout: 180000 },
      async () => {
        const config: CopilotConfig = {
          workDir: tempDir,
          copilotPath: COPILOT_PATH,
          allowAllTools: true,
          model: "claude-sonnet-4.5",
        };

        const processConfig = adapter.buildProcessConfig(config);
        const processManager = createProcessManager({
          ...processConfig,
          mode: "structured",
          timeout: 60000,
        });

        const engine = new SimpleExecutionEngine(processManager, {
          defaultProcessConfig: processConfig,
          maxConcurrent: 1,
        });
        const executor = new ResilientExecutor(engine);
        const orchestrator = new LinearOrchestrator(executor);

        try {
          const workflow: WorkflowDefinition = {
            id: "test-workflow-1",
            steps: [
              {
                id: "step-1",
                taskType: "issue",
                prompt: "What is 5 + 3?",
                taskConfig: {},
              },
              {
                id: "step-2",
                taskType: "issue",
                prompt: "What is 10 - 2?",
                taskConfig: {},
                dependencies: ["step-1"],
              },
            ],
            config: {
              checkpointInterval: 1,
              continueOnStepFailure: false,
            },
          };

          const executionId = await orchestrator.startWorkflow(workflow, tempDir, {
            executionId: `workflow-test-${Date.now()}`,
          });
          const execution = await orchestrator.waitForWorkflow(executionId);

          expect(execution).toBeDefined();
          expect(execution.status).toBe("completed");
          expect(execution.stepResults).toHaveLength(2);
          expect(execution.stepResults[0].success).toBe(true);
          expect(execution.stepResults[1].success).toBe(true);
        } finally {
          await engine.shutdown();
        }
      }
    );
  });
});
