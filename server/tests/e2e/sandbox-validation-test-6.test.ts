/**
 * Sandbox Validation Test 6: Multiple Domain Fetches Without User Prompts
 *
 * This test verifies that all domains are allowed without prompts when
 * WebFetch is enabled in the sandbox configuration.
 *
 * Test Type: Positive test (should succeed)
 * Priority: Critical - validates multi-domain network access
 *
 * Expected Behavior:
 * - Fetches to github.com and npmjs.com should both succeed
 * - No permission prompts should appear
 * - Different domains should be allowed seamlessly
 * - Automation should not be blocked by domain approval prompts
 *
 * Failure Modes:
 * - Prompt appears for second domain (breaks automation - CRITICAL)
 * - Either fetch is blocked by permissions
 * - Network error or timeout
 * - Waiting for user input that never comes
 *
 * Part of: s-2bvw (Sandbox Configuration Validation Tests)
 * Issue: i-5yxe
 *
 * @group e2e
 * @group sandbox
 * @group network
 * @group critical
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import {
  SimpleExecutionEngine,
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

/**
 * Create sandbox configuration matching s-24lu specification
 * with WebFetch allowed (enables network fetches without prompts)
 */
function createSandboxSettings() {
  return {
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      excludedCommands: ["docker"],
      network: {
        allowUnixSockets: ["/var/run/docker.sock"],
        allowLocalBinding: true,
      },
    },
    permissions: {
      allow: [
        "Read(./**)",
        "Read(**)",
        "WebFetch", // Critical: enables all domains without prompts
      ],
      deny: [
        "Read(/**)",
        "Read(~/**)",
        "Read(~/.ssh/**)",
        "Read(**/.env)",
        "Read(**/secrets.json)",
        "Read(**/*.pem)",
        "Edit(.sudocode/.claude-settings.json)",
        "Edit(.claude-settings.json)",
      ],
    },
  };
}

describe.skipIf(SKIP_E2E)("Test 6: Multiple Domain Fetches Without Prompts", () => {
  let tempDir: string;
  let adapter: ClaudeCodeAdapter;

  beforeEach(async () => {
    // Verify Claude is available
    const available = await checkClaudeAvailable();
    if (!available) {
      throw new Error(
        "Claude Code CLI not available. Install and authenticate before running tests."
      );
    }

    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-6-"));

    // Create .sudocode directory
    const sudocodeDir = path.join(tempDir, ".sudocode");
    await fs.mkdir(sudocodeDir, { recursive: true });

    // Write sandbox settings with WebFetch allowed
    const settingsPath = path.join(sudocodeDir, ".claude-settings.json");
    await fs.writeFile(
      settingsPath,
      JSON.stringify(createSandboxSettings(), null, 2)
    );

    adapter = new ClaudeCodeAdapter();
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it(
    "should fetch github.com and npmjs.com without prompts",
    { timeout: 180000 },
    async () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        settingsFile: path.join(tempDir, ".sudocode", ".claude-settings.json"),
      };

      const processConfig = adapter.buildProcessConfig(config);
      const processManager = createProcessManager({
        ...processConfig,
        mode: "structured",
        timeout: 150000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-6-github-npm",
          type: "issue",
          prompt:
            "Fetch https://github.com and https://npmjs.com and tell me if both fetches succeeded. Brief response only.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        const taskId = await engine.submitTask(task);
        const result = await engine.waitForTask(taskId);

        // Verify execution succeeded
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should indicate both fetches succeeded
        const hasGithub = lowerOutput.includes("github");
        const hasNpm = lowerOutput.includes("npm");
        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("both") ||
          lowerOutput.includes("fetched") ||
          lowerOutput.includes("worked");

        // At least one domain should be mentioned AND success indicated
        expect(hasGithub || hasNpm).toBe(true);
        expect(hasSuccessIndicators).toBe(true);

        // CRITICAL: No prompts should appear for second domain
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("not allowed")).toBe(false);
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
        expect(lowerOutput.includes("user approval")).toBe(false);
        expect(lowerOutput.includes("permission prompt")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should fetch github.com first, then npmjs.com without second prompt",
    { timeout: 180000 },
    async () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        settingsFile: path.join(tempDir, ".sudocode", ".claude-settings.json"),
      };

      const processConfig = adapter.buildProcessConfig(config);
      const processManager = createProcessManager({
        ...processConfig,
        mode: "structured",
        timeout: 150000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-6-sequential",
          type: "issue",
          prompt:
            "First fetch https://github.com, then fetch https://npmjs.com. Tell me if both fetches succeeded in order.",
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

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should mention both domains
        const hasGithub = lowerOutput.includes("github");
        const hasNpm = lowerOutput.includes("npm");
        expect(hasGithub || hasNpm).toBe(true);

        // Should indicate success
        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("both") ||
          lowerOutput.includes("fetched");

        expect(hasSuccessIndicators).toBe(true);

        // CRITICAL: No prompts should appear for second domain
        // This is the key test - second domain should not trigger a prompt
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
        expect(lowerOutput.includes("user approval")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should fetch npmjs.com first, then github.com without second prompt",
    { timeout: 180000 },
    async () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        settingsFile: path.join(tempDir, ".sudocode", ".claude-settings.json"),
      };

      const processConfig = adapter.buildProcessConfig(config);
      const processManager = createProcessManager({
        ...processConfig,
        mode: "structured",
        timeout: 150000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-6-reverse-order",
          type: "issue",
          prompt:
            "First fetch https://npmjs.com, then fetch https://github.com. Tell me if both fetches succeeded.",
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

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should mention domains or success
        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("both") ||
          lowerOutput.includes("github") ||
          lowerOutput.includes("npm") ||
          lowerOutput.includes("fetched");

        expect(hasSuccessIndicators).toBe(true);

        // CRITICAL: No prompts should appear
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should fetch multiple different domains without any prompts",
    { timeout: 240000 },
    async () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        settingsFile: path.join(tempDir, ".sudocode", ".claude-settings.json"),
      };

      const processConfig = adapter.buildProcessConfig(config);
      const processManager = createProcessManager({
        ...processConfig,
        mode: "structured",
        timeout: 210000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-6-many-domains",
          type: "issue",
          prompt:
            "Fetch these URLs: https://github.com, https://npmjs.com, and https://example.com. Tell me if all three succeeded.",
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

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should indicate success for multiple fetches
        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("all") ||
          lowerOutput.includes("three") ||
          lowerOutput.includes("fetched");

        expect(hasSuccessIndicators).toBe(true);

        // CRITICAL: No prompts should appear for any domain
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
        expect(lowerOutput.includes("user approval")).toBe(false);
        expect(lowerOutput.includes("permission prompt")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should complete multi-domain fetch without hanging on permissions",
    { timeout: 180000 },
    async () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        settingsFile: path.join(tempDir, ".sudocode", ".claude-settings.json"),
      };

      const processConfig = adapter.buildProcessConfig(config);
      const processManager = createProcessManager({
        ...processConfig,
        mode: "structured",
        timeout: 150000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-6-no-hang",
          type: "issue",
          prompt:
            "Immediately fetch both https://github.com and https://npmjs.com. This must complete without any user interaction. Brief response.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        const taskId = await engine.submitTask(task);
        const result = await engine.waitForTask(taskId);

        // The key test: execution should complete successfully
        // If a user prompt appeared for the second domain, the task would hang or timeout
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should succeed
        expect(
          lowerOutput.includes("fetch") ||
            lowerOutput.includes("github") ||
            lowerOutput.includes("npm") ||
            lowerOutput.includes("successfully") ||
            lowerOutput.includes("both")
        ).toBe(true);

        // CRITICAL: No indication of prompts or waiting
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
        expect(lowerOutput.includes("user approval")).toBe(false);
        expect(lowerOutput.includes("permission prompt")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("permission denied")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should handle real-world npm registry and github api without prompts",
    { timeout: 180000 },
    async () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        settingsFile: path.join(tempDir, ".sudocode", ".claude-settings.json"),
      };

      const processConfig = adapter.buildProcessConfig(config);
      const processManager = createProcessManager({
        ...processConfig,
        mode: "structured",
        timeout: 150000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-6-real-apis",
          type: "issue",
          prompt:
            "Fetch https://registry.npmjs.org/react and https://api.github.com. Tell me if both API fetches succeeded.",
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

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should indicate API success
        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("both") ||
          lowerOutput.includes("api") ||
          lowerOutput.includes("react") ||
          lowerOutput.includes("github");

        expect(hasSuccessIndicators).toBe(true);

        // Should NOT have permission issues
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );
});
