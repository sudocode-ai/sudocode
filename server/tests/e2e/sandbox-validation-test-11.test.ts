/**
 * Sandbox Validation Test 11: Docker Commands Work (Excluded from Sandbox)
 *
 * This test verifies that Docker commands work correctly when excluded from sandbox
 * restrictions using the excludedCommands configuration.
 *
 * Test Type: Positive test (should succeed)
 * Priority: Medium - validates Docker exclusion
 *
 * Expected Behavior:
 * - Docker command should execute successfully
 * - Should return running containers
 * - No permission issues or blocks
 * - Unix socket access allowed via allowUnixSockets
 *
 * Failure Modes:
 * - Command blocked by sandbox
 * - Docker socket access denied
 * - Sandbox interferes with Docker execution
 *
 * Part of: s-2bvw (Sandbox Configuration Validation Tests)
 *
 * @group e2e
 * @group sandbox
 * @group docker
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
 * Check if Docker is installed and running
 */
async function checkDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["--version"]);
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }
      // Also check if daemon is running
      const psProc = spawn("docker", ["ps"]);
      psProc.on("close", (psCode) => {
        resolve(psCode === 0);
      });
      psProc.on("error", () => {
        resolve(false);
      });
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Create sandbox configuration matching s-24lu specification
 * with Docker excluded from sandbox restrictions
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

describe.skipIf(SKIP_E2E)("Test 11: Docker Commands Work (Excluded from Sandbox)", () => {
  let tempDir: string;
  let adapter: ClaudeCodeAdapter;

  beforeEach(async () => {
    // Verify Claude is available
    const claudeAvailable = await checkClaudeAvailable();
    if (!claudeAvailable) {
      throw new Error("Claude Code CLI not available. Install and authenticate before running tests.");
    }

    // Verify Docker is available
    const dockerAvailable = await checkDockerAvailable();
    if (!dockerAvailable) {
      throw new Error("Docker not available. Install Docker and ensure daemon is running.");
    }

    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-11-"));

    // Create .sudocode directory
    const sudocodeDir = path.join(tempDir, ".sudocode");
    await fs.mkdir(sudocodeDir, { recursive: true });

    // Write sandbox settings with Docker excluded
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
    "should execute docker ps command successfully",
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
          id: "test-11-docker-ps",
          type: "issue",
          prompt: "Run the command `docker ps` and show me the output. Reply with a brief summary of what containers are running.",
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

        // Verify the agent was able to execute docker command
        const output = result.output || "";
        // Output should mention containers or docker in some way
        const hasDockerContent =
          output.toLowerCase().includes("container") ||
          output.toLowerCase().includes("docker") ||
          output.toLowerCase().includes("image") ||
          output.toLowerCase().includes("running");

        expect(hasDockerContent).toBe(true);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should execute docker version command",
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
          id: "test-11-docker-version",
          type: "issue",
          prompt: "Run `docker --version` and tell me the version. Reply with just the version number.",
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

        // Verify output contains version information
        const output = result.output || "";
        expect(
          output.toLowerCase().includes("version") ||
          /\d+\.\d+/.test(output) // Contains version number pattern
        ).toBe(true);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should execute docker info command",
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
          id: "test-11-docker-info",
          type: "issue",
          prompt: "Run `docker info` and tell me how many containers exist in total. Reply with just the number.",
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

        // Verify output contains container information
        const output = result.output || "";
        expect(
          output.toLowerCase().includes("container") ||
          /\d+/.test(output) // Contains a number
        ).toBe(true);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should verify docker socket access is allowed",
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
          id: "test-11-docker-socket",
          type: "issue",
          prompt: "Run `docker ps -a` to list all containers (running and stopped). Tell me if the command succeeded and what you found.",
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

        // Verify docker command executed (socket access worked)
        const output = result.output || "";
        // Should not contain permission errors
        expect(output.toLowerCase().includes("permission denied")).toBe(false);
        expect(output.toLowerCase().includes("cannot connect")).toBe(false);
      } finally {
        await engine.shutdown();
      }
    }
  );
});
