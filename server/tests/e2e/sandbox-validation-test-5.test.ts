/**
 * Sandbox Validation Test 5: WebFetch Without User Prompts
 *
 * This test verifies that the WebFetch tool works without user prompts
 * when WebFetch is allowed in the sandbox configuration.
 *
 * Test Type: Positive test (should succeed)
 * Priority: Critical - validates network automation
 *
 * Expected Behavior:
 * - WebFetch tool should execute successfully
 * - No permission prompts should appear for domain approval
 * - Content should be returned
 * - Multiple domains should work without additional prompts
 *
 * Failure Modes:
 * - User prompt appears (breaks automation - CRITICAL)
 * - Fetch blocked by permissions
 * - Network error
 * - Timeout waiting for user input
 *
 * Part of: s-2bvw (Sandbox Configuration Validation Tests)
 * Issue: i-1js9
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

describe.skipIf(SKIP_E2E)("Test 5: WebFetch Without User Prompts", () => {
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-5-"));

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
    "should fetch https://example.com without user prompts",
    { timeout: 120000 },
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
        timeout: 90000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-5-webfetch-example",
          type: "issue",
          prompt:
            "Fetch https://example.com and show me the content. Just tell me what you found.",
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

        // Verify content was fetched
        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should contain indication of successful fetch
        const hasSuccessIndicators =
          lowerOutput.includes("example") ||
          lowerOutput.includes("domain") ||
          lowerOutput.includes("content") ||
          lowerOutput.includes("fetch") ||
          lowerOutput.includes("html") ||
          lowerOutput.includes("website");

        expect(hasSuccessIndicators).toBe(true);

        // CRITICAL: Should NOT contain permission prompts or blocks
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("not allowed")).toBe(false);
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
        expect(lowerOutput.includes("user approval")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should fetch multiple domains without prompts",
    { timeout: 120000 },
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
        timeout: 90000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-5-multiple-domains",
          type: "issue",
          prompt:
            "Fetch https://example.com and then fetch https://www.iana.org. Tell me if both fetches succeeded.",
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

        // Should indicate both fetches succeeded
        const hasBothDomains =
          (lowerOutput.includes("example") || lowerOutput.includes("both")) &&
          (lowerOutput.includes("iana") || lowerOutput.includes("both"));

        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("both") ||
          lowerOutput.includes("fetched");

        expect(hasBothDomains || hasSuccessIndicators).toBe(true);

        // CRITICAL: No prompts should appear for second domain
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should fetch different domains in sequence without prompts",
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
          id: "test-5-sequential-domains",
          type: "issue",
          prompt:
            "Fetch these URLs in order: https://example.com, https://www.iana.org, and https://httpbin.org/get. Tell me if all three succeeded.",
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
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should fetch and parse JSON content",
    { timeout: 120000 },
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
        timeout: 90000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-5-json-fetch",
          type: "issue",
          prompt:
            "Fetch https://httpbin.org/json and tell me what JSON content you received. Brief summary only.",
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

        // Should mention JSON content
        const hasJsonIndicators =
          lowerOutput.includes("json") ||
          lowerOutput.includes("data") ||
          lowerOutput.includes("object") ||
          lowerOutput.includes("slideshow");

        expect(hasJsonIndicators).toBe(true);

        // Should NOT be blocked
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should complete fetch without hanging on permissions",
    { timeout: 120000 },
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
        timeout: 90000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-5-no-hang",
          type: "issue",
          prompt:
            "Fetch https://example.com immediately and tell me the result. This must complete without any user interaction.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        const taskId = await engine.submitTask(task);
        const result = await engine.waitForTask(taskId);

        // The key test: execution should complete successfully
        // If a user prompt appeared, the task would hang or timeout
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should succeed
        expect(
          lowerOutput.includes("fetch") ||
            lowerOutput.includes("example") ||
            lowerOutput.includes("content") ||
            lowerOutput.includes("successfully")
        ).toBe(true);

        // CRITICAL: No indication of prompts or waiting
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
        expect(lowerOutput.includes("user approval")).toBe(false);
        expect(lowerOutput.includes("permission prompt")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should handle HTTPS correctly without security prompts",
    { timeout: 120000 },
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
        timeout: 90000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-5-https",
          type: "issue",
          prompt:
            "Fetch https://www.google.com (note: HTTPS) and confirm it worked. Brief response.",
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

        // Should succeed
        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("worked") ||
          lowerOutput.includes("google") ||
          lowerOutput.includes("fetch");

        expect(hasSuccessIndicators).toBe(true);

        // Should NOT have security or permission issues
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("certificate")).toBe(false);
        expect(lowerOutput.includes("security warning")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );
});
