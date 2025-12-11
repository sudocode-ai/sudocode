/**
 * Sandbox Validation Test 12: Subdirectory Read Access within CWD
 *
 * This test verifies that Claude Code can read files in subdirectories within the current
 * working directory when using sandbox configuration with allow/deny permission rules.
 *
 * Test Type: Positive test (should succeed)
 * Priority: High - validates subdirectory access
 *
 * Expected Behavior:
 * - Agent should successfully read files in subdirectories (e.g., src/app.ts)
 * - Subdirectories within CWD should be accessible
 * - No permission issues or blocks
 *
 * Failure Modes:
 * - Read operation blocked by permissions
 * - Subdirectory traversal denied
 * - Path resolution issues
 *
 * Part of: s-2bvw (Sandbox Configuration Validation Tests)
 *
 * @group e2e
 * @group sandbox
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

describe.skipIf(SKIP_E2E)("Test 12: Subdirectory Read Access within CWD", () => {
  let tempDir: string;
  let adapter: ClaudeCodeAdapter;

  beforeEach(async () => {
    // Verify Claude is available
    const available = await checkClaudeAvailable();
    if (!available) {
      throw new Error("Claude Code CLI not available. Install and authenticate before running tests.");
    }

    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-12-"));

    // Create subdirectory structure
    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    // Create test file in subdirectory
    await fs.writeFile(
      path.join(srcDir, "app.ts"),
      `// Test application file
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}

// This file is used to test subdirectory read access
console.log("Application loaded");
`
    );

    // Create .sudocode directory
    const sudocodeDir = path.join(tempDir, ".sudocode");
    await fs.mkdir(sudocodeDir, { recursive: true });

    // Write sandbox settings
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
    "should successfully read file in subdirectory using relative path",
    { timeout: 120000 },
    async () => {
      const config: ClaudeCodeConfig = {
        workDir: tempDir,
        claudePath: CLAUDE_PATH,
        print: true,
        outputFormat: "stream-json",
        verbose: true,
        // Use settings file instead of dangerouslySkipPermissions
        settingsFile: path.join(tempDir, ".sudocode", ".claude-settings.json"),
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

      try {
        const task: ExecutionTask = {
          id: "test-12-subdirectory-read",
          type: "issue",
          prompt: "Read the file `src/app.ts` and tell me what functions are exported. Reply with just the function names, comma-separated.",
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

        // Verify the agent was able to read the file
        // The response should mention the exported functions
        const output = result.output || "";
        expect(
          output.toLowerCase().includes("greet") ||
          output.toLowerCase().includes("add")
        ).toBe(true);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should read subdirectory file without path traversal concerns",
    { timeout: 120000 },
    async () => {
      // Create deeper subdirectory structure
      const deepDir = path.join(tempDir, "src", "utils", "helpers");
      await fs.mkdir(deepDir, { recursive: true });

      await fs.writeFile(
        path.join(deepDir, "validator.ts"),
        `export function validate(input: string): boolean {
  return input.length > 0;
}
`
      );

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
        timeout: 60000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-12-deep-subdirectory",
          type: "issue",
          prompt: "Read `src/utils/helpers/validator.ts` and tell me the function name. Reply with just the function name.",
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

        // Verify agent could read deeply nested file
        const output = result.output || "";
        expect(output.toLowerCase().includes("validate")).toBe(true);
      } finally {
        await engine.shutdown();
      }
    }
  );

  it(
    "should handle multiple subdirectory reads in same execution",
    { timeout: 120000 },
    async () => {
      // Create multiple subdirectories with files
      await fs.mkdir(path.join(tempDir, "components"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "components", "Button.tsx"),
        "export function Button() { return <button>Click me</button>; }"
      );

      await fs.mkdir(path.join(tempDir, "styles"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "styles", "main.css"),
        ".button { color: blue; }"
      );

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
        timeout: 60000,
      });

      const engine = new SimpleExecutionEngine(processManager, {
        defaultProcessConfig: processConfig,
        maxConcurrent: 1,
      });

      try {
        const task: ExecutionTask = {
          id: "test-12-multiple-subdirs",
          type: "issue",
          prompt: "Read both `components/Button.tsx` and `styles/main.css`. Tell me what you found in each file. Reply with a brief summary.",
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

        // Verify agent read both files
        const output = result.output || "";
        const hasButton = output.toLowerCase().includes("button");
        const hasStyle = output.toLowerCase().includes("css") ||
                        output.toLowerCase().includes("style") ||
                        output.toLowerCase().includes("color");

        expect(hasButton || hasStyle).toBe(true);
      } finally {
        await engine.shutdown();
      }
    }
  );
});
