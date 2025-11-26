/**
 * End-to-End Tests for Claude Code Agent Execution
 *
 * These tests verify the full execution flow with the actual Claude Code CLI.
 * Tests are skipped by default and require claude to be installed and available.
 *
 * ⚠️ These tests make REAL AI API calls (optimized with simple math prompts).
 * Full suite runs in ~30 seconds. Complex multi-step workflow tests are skipped by default.
 *
 * To run these tests:
 * 1. Install Claude Code CLI (https://claude.com/claude-code)
 * 2. Authenticate: claude login
 * 3. Set environment variable: RUN_E2E_TESTS=true
 * 4. Run: RUN_E2E_TESTS=true npm --prefix server test -- --run claude-execution.test.ts
 *
 * Test coverage:
 * - Basic execution with structured output
 * - Resilience layer with retry logic
 * - Adapter validation and configuration building
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
  createProcessManager,
} from "agent-execution-engine";
import { ClaudeCodeAdapter } from "../../src/execution/adapters/claude-adapter.js";
import type { ClaudeCodeConfig } from "@sudocode-ai/types/agents";
import type { ExecutionTask } from "agent-execution-engine";

// Skip E2E tests by default (they require claude to be installed)
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

/**
 * Check if Claude Code CLI is available on the system
 */
async function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_PATH, ["--version"]);
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}

describe.skipIf(SKIP_E2E)("Claude Code E2E Tests", () => {
  let tempDir: string;
  let adapter: ClaudeCodeAdapter;

  beforeEach(async () => {
    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-e2e-"));

    // Create test file
    await fs.writeFile(
      path.join(tempDir, "test.txt"),
      "Hello from Claude E2E test"
    );

    adapter = new ClaudeCodeAdapter();
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should check claude availability", { timeout: 10000 }, async () => {
    const available = await checkClaudeAvailable();
    expect(available).toBe(true);
  });

  describe("Structured Mode Execution", () => {
    it(
      "should execute simple task with claude",
      { timeout: 120000 },
      async () => {
        const config: ClaudeCodeConfig = {
          workDir: tempDir,
          claudePath: CLAUDE_PATH,
          print: true,
          outputFormat: "stream-json",
          verbose: true,
          dangerouslySkipPermissions: true,
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
        const config: ClaudeCodeConfig = {
          workDir: tempDir,
          claudePath: CLAUDE_PATH,
          print: true,
          outputFormat: "stream-json",
          verbose: true,
          dangerouslySkipPermissions: true,
          model: "sonnet",
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
        const config: ClaudeCodeConfig = {
          workDir: tempDir,
          claudePath: CLAUDE_PATH,
          print: true,
          outputFormat: "stream-json",
          verbose: true,
          dangerouslySkipPermissions: true,
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
      const validConfig: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
      };

      const errors = adapter.validateConfig(validConfig);
      expect(errors).toEqual([]);
    });

    it("should detect missing workDir", () => {
      const invalidConfig: ClaudeCodeConfig = {
        workDir: "",
        claudePath: CLAUDE_PATH,
      };

      const errors = adapter.validateConfig(invalidConfig);
      expect(errors).toContain("workDir is required");
    });

    it("should build process config correctly", () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        model: "sonnet",
        dangerouslySkipPermissions: true,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe(CLAUDE_PATH);
      expect(processConfig.workDir).toBe(tempDir);
      expect(processConfig.args).toContain("--print");
      expect(processConfig.args).toContain("--output-format");
      expect(processConfig.args).toContain("stream-json");
      expect(processConfig.args).toContain("--verbose");
      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("sonnet");
      expect(processConfig.args).toContain("--dangerously-skip-permissions");
    });

    it("should build process config without dangerouslySkipPermissions", () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        dangerouslySkipPermissions: false,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).not.toContain("--dangerously-skip-permissions");
      expect(processConfig.args).toContain("--print");
      expect(processConfig.args).toContain("--output-format");
    });

    it("should provide default configuration", () => {
      const defaults = adapter.getDefaultConfig();

      expect(defaults.claudePath).toBe("claude");
      expect(defaults.print).toBe(true);
      expect(defaults.outputFormat).toBe("stream-json");
      expect(defaults.verbose).toBe(true);
      expect(defaults.dangerouslySkipPermissions).toBe(false);
    });

    it("should expose correct metadata", () => {
      expect(adapter.metadata.name).toBe("claude-code");
      expect(adapter.metadata.displayName).toBe("Claude Code");
      expect(adapter.metadata.supportedModes).toContain("structured");
      expect(adapter.metadata.supportsStreaming).toBe(true);
      expect(adapter.metadata.supportsStructuredOutput).toBe(true);
    });

    it("should allow custom model values", () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        model: "opus",
      };

      const errors = adapter.validateConfig(config);
      expect(errors).toEqual([]);

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--model");
      expect(processConfig.args).toContain("opus");
    });
  });

  describe("Advanced Configuration", () => {
    it("should handle environment variables", () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        env: {
          CUSTOM_VAR: "test-value",
        },
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.env).toEqual({ CUSTOM_VAR: "test-value" });
    });

    it("should handle allowed tools configuration", () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        allowedTools: ["Bash(git:*)", "Edit", "Read"],
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--allowed-tools");
      // Tools are passed as separate arguments, not comma-joined
      expect(processConfig.args).toContain("Bash(git:*)");
      expect(processConfig.args).toContain("Edit");
      expect(processConfig.args).toContain("Read");
    });

    it("should handle system prompt configuration", () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        systemPrompt: "You are a helpful coding assistant.",
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--system-prompt");
      expect(processConfig.args).toContain("You are a helpful coding assistant.");
    });

    it("should handle permission mode configuration", () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        permissionMode: "bypassPermissions",
      };

      const processConfig = adapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--permission-mode");
      expect(processConfig.args).toContain("bypassPermissions");
    });
  });
});
