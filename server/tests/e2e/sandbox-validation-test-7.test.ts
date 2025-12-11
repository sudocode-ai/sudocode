/**
 * Sandbox Validation Test 7: Bash Network Commands (curl/wget) Without Prompts
 *
 * This test verifies that bash network commands (curl, wget) work without user prompts
 * when WebFetch is allowed in the sandbox configuration.
 *
 * Test Type: Positive test (should succeed)
 * Priority: High - validates bash network automation
 *
 * Expected Behavior:
 * - curl command should execute successfully
 * - wget command should work
 * - No permission prompts should appear
 * - Network responses should be returned
 * - Both HTTP and HTTPS should work
 *
 * Failure Modes:
 * - User prompt appears (breaks automation)
 * - Command blocked by sandbox
 * - Network access denied
 * - Sandbox interferes with network operations
 *
 * Part of: s-2bvw (Sandbox Configuration Validation Tests)
 *
 * @group e2e
 * @group sandbox
 * @group network
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
 * with WebFetch allowed (enables network commands without prompts)
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
        "WebFetch",
        "Bash",
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

describe.skipIf(SKIP_E2E)("Test 7: Bash Network Commands (curl/wget) Without Prompts", () => {
  let tempDir: string;
  let adapter: ClaudeCodeAdapter;

  beforeEach(async () => {
    // Verify Claude is available
    const available = await checkClaudeAvailable();
    if (!available) {
      throw new Error("Claude Code CLI not available. Install and authenticate before running tests.");
    }

    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-7-"));

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
    "should execute curl command successfully",
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
          id: "test-7-curl",
          type: "issue",
          prompt: "Run `curl https://example.com` and show me a brief summary of the response. Just tell me if it succeeded and what you found.",
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

        // Verify curl command executed and returned content
        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should contain some indication of successful HTTP response
        const hasSuccessIndicators =
          lowerOutput.includes("example") ||
          lowerOutput.includes("html") ||
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("200") ||
          lowerOutput.includes("ok");

        expect(hasSuccessIndicators).toBe(true);

        // CRITICAL: Should NOT contain permission prompts or blocks
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("not allowed")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should execute curl with HTTP (not just HTTPS)",
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
          id: "test-7-curl-http",
          type: "issue",
          prompt: "Run `curl http://example.com` (note: HTTP not HTTPS) and tell me if it succeeded. Brief response only.",
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
          lowerOutput.includes("example") ||
          lowerOutput.includes("200") ||
          lowerOutput.includes("ok");

        expect(hasSuccessIndicators).toBe(true);

        // Should NOT be blocked
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should execute wget command successfully",
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
          id: "test-7-wget",
          type: "issue",
          prompt: "Run `wget -O - https://example.com` and tell me if it succeeded. Brief response only.",
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

        // Should succeed and mention content
        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("example") ||
          lowerOutput.includes("html") ||
          lowerOutput.includes("200") ||
          lowerOutput.includes("saved");

        expect(hasSuccessIndicators).toBe(true);

        // Should NOT be blocked
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
        expect(lowerOutput.includes("not allowed")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should execute multiple curl commands to different domains",
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
          id: "test-7-multiple-domains",
          type: "issue",
          prompt: "Run `curl https://example.com` and then `curl https://www.iana.org`. Tell me if both succeeded. Brief response.",
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

        // Should mention both succeeded or both domains
        const hasBothDomains =
          (lowerOutput.includes("example") || lowerOutput.includes("both")) &&
          (lowerOutput.includes("iana") || lowerOutput.includes("both"));

        const hasSuccessIndicators =
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("both") ||
          lowerOutput.includes("200");

        expect(hasBothDomains || hasSuccessIndicators).toBe(true);

        // CRITICAL: No prompts should appear for second domain
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should execute curl and save output to file",
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
          id: "test-7-curl-save",
          type: "issue",
          prompt: "Run `curl -o output.html https://example.com` to save the output to a file. Then verify the file was created. Tell me if it worked.",
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

        // Should mention file was created or download succeeded
        const hasSuccessIndicators =
          lowerOutput.includes("created") ||
          lowerOutput.includes("saved") ||
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("file");

        expect(hasSuccessIndicators).toBe(true);

        // Verify file was actually created
        const outputFilePath = path.join(tempDir, "output.html");
        const fileExists = await fs.access(outputFilePath)
          .then(() => true)
          .catch(() => false);

        expect(fileExists).toBe(true);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should execute curl with headers",
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
          id: "test-7-curl-headers",
          type: "issue",
          prompt: "Run `curl -I https://example.com` to get only headers. Tell me if it succeeded and if you see HTTP headers.",
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

        // Should mention headers or HTTP status
        const hasHeaderIndicators =
          lowerOutput.includes("header") ||
          lowerOutput.includes("http") ||
          lowerOutput.includes("200") ||
          lowerOutput.includes("content-type") ||
          lowerOutput.includes("succeed");

        expect(hasHeaderIndicators).toBe(true);

        // Should NOT be blocked
        expect(lowerOutput.includes("permission denied")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should not show user prompts during network operations",
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
          id: "test-7-no-prompts",
          type: "issue",
          prompt: "Run `curl https://example.com` and immediately tell me if it succeeded. I need this to run without any user interaction.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        const taskId = await engine.submitTask(task);
        const result = await engine.waitForTask(taskId);

        // The key test: execution should complete successfully
        // If a user prompt appeared, the task would hang or fail
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();

        const output = result.output || "";
        const lowerOutput = output.toLowerCase();

        // Should succeed
        expect(
          lowerOutput.includes("succeed") ||
          lowerOutput.includes("successfully") ||
          lowerOutput.includes("example")
        ).toBe(true);

        // CRITICAL: No indication of prompts or blocks
        expect(lowerOutput.includes("waiting for approval")).toBe(false);
        expect(lowerOutput.includes("user approval")).toBe(false);
        expect(lowerOutput.includes("permission prompt")).toBe(false);
        expect(lowerOutput.includes("blocked")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );
});
