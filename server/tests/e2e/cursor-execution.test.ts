/**
 * End-to-End Tests for Cursor Agent Execution
 *
 * These tests verify the full execution flow with the actual Cursor CLI (cursor-agent).
 * Tests are skipped by default and require cursor-agent to be installed and available.
 *
 * ⚠️ These tests make REAL AI API calls (optimized with simple math prompts).
 * Full suite runs in ~30 seconds. Complex multi-step workflow tests are skipped by default.
 *
 * To run these tests:
 * 1. Install cursor-agent CLI (https://cursor.com)
 * 2. Authenticate: cursor-agent login
 * 3. Set environment variable: RUN_E2E_TESTS=true
 * 4. Run: RUN_E2E_TESTS=true npm --prefix server test -- --run cursor-execution.test.ts
 *
 * Test coverage:
 * - 12 active tests: Basic execution, resilience, adapter validation (~30s total)
 * - 6 skipped tests: Complex workflows, timeouts, manual approval (slow/unreliable)
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
import { CursorAdapter } from "../../src/execution/adapters/cursor-adapter.js";
import type { CursorConfig } from "@sudocode-ai/types/agents";
import type { ExecutionTask, WorkflowDefinition } from "agent-execution-engine";

// Skip E2E tests by default (they require cursor-agent to be installed)
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

const CURSOR_PATH = process.env.CURSOR_PATH || "cursor-agent";

/**
 * Check if cursor-agent is available on the system
 */
async function checkCursorAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(CURSOR_PATH, ["--version"]);
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}

describe.skipIf(SKIP_E2E)("Cursor E2E Tests", () => {
  let tempDir: string;
  let adapter: CursorAdapter;

  beforeEach(async () => {
    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-e2e-"));

    // Create test file
    await fs.writeFile(
      path.join(tempDir, "test.txt"),
      "Hello from Cursor E2E test"
    );

    adapter = new CursorAdapter();
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should check cursor-agent availability", { timeout: 10000 }, async () => {
    const available = await checkCursorAvailable();
    expect(available).toBe(true);
  });

  describe("Structured Mode Execution", () => {
    it(
      "should execute simple task with cursor-agent",
      { timeout: 120000 },
      async () => {
        const config: CursorConfig = {
          workDir: tempDir,
          cursorPath: CURSOR_PATH,
          force: true, // Auto-approve all actions
          model: "auto",
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
        const config: CursorConfig = {
          workDir: tempDir,
          cursorPath: CURSOR_PATH,
          force: true,
          model: "sonnet-4.5",
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
        const config: CursorConfig = {
          workDir: tempDir,
          cursorPath: CURSOR_PATH,
          force: true,
          model: "auto",
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
      const validConfig: CursorConfig = {
        workDir: tempDir,
        cursorPath: CURSOR_PATH,
        force: true,
        model: "auto",
      };

      const errors = adapter.validateConfig(validConfig);
      expect(errors).toEqual([]);
    });

    it("should detect missing workDir", () => {
      const invalidConfig: CursorConfig = {
        workDir: "",
        cursorPath: CURSOR_PATH,
      };

      const errors = adapter.validateConfig(invalidConfig);
      expect(errors).toContain("workDir is required");
    });

    it("should build process config correctly", () => {
      const config: CursorConfig = {
        workDir: tempDir,
        cursorPath: CURSOR_PATH,
        force: true,
        model: "sonnet-4.5",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe(CURSOR_PATH);
      expect(processConfig.workDir).toBe(tempDir);
      expect(processConfig.args).toContain("-p");
      expect(processConfig.args).toContain("--output-format=stream-json");
      expect(processConfig.args).toContain("--force");
      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("sonnet-4.5");
    });

    it("should build process config without force", () => {
      const config: CursorConfig = {
        workDir: tempDir,
        cursorPath: CURSOR_PATH,
        force: false,
        model: "auto",
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).not.toContain("--force");
      expect(processConfig.args).toContain("-p");
      expect(processConfig.args).toContain("--output-format=stream-json");
    });

    it("should provide default configuration", () => {
      const defaults = adapter.getDefaultConfig();

      expect(defaults.cursorPath).toBe("cursor-agent");
      expect(defaults.force).toBe(true);
      expect(defaults.model).toBe("auto");
    });

    it("should expose correct metadata", () => {
      expect(adapter.metadata.name).toBe("cursor");
      expect(adapter.metadata.displayName).toBe("Cursor");
      expect(adapter.metadata.supportedModes).toContain("structured");
      expect(adapter.metadata.supportsStreaming).toBe(true);
      expect(adapter.metadata.supportsStructuredOutput).toBe(true);
    });

    it("should allow custom model values", () => {
      const config: CursorConfig = {
        workDir: tempDir,
        cursorPath: CURSOR_PATH,
        model: "custom-model-v1",
      };

      // Should not throw, just warn
      const errors = adapter.validateConfig(config);
      expect(errors).toEqual([]);

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("custom-model-v1");
    });
  });

  describe("Advanced Configuration", () => {
    it("should handle environment variables", () => {
      const config: CursorConfig = {
        workDir: tempDir,
        cursorPath: CURSOR_PATH,
        env: {
          CUSTOM_VAR: "test-value",
        },
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.env).toEqual({ CUSTOM_VAR: "test-value" });
    });
  });
});
