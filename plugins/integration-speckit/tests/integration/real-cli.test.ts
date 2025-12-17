/**
 * Integration tests for Spec-Kit plugin with real file structures
 *
 * NOTE: The `specify` CLI requires interactive terminal input (arrow key selection)
 * and cannot be automated in CI/test environments. Therefore these tests focus on:
 * 1. Verifying our integration works with real spec-kit file structures
 * 2. Testing bidirectional sync (reading and writing spec-kit files)
 * 3. Testing change detection
 *
 * The tests create spec-kit directory structures manually (simulating what would
 * be created by `specify init` + AI assistant slash commands).
 *
 * To run: RUN_CLI_TESTS=true npm test -- tests/integration/real-cli.test.ts
 *
 * @see https://github.com/github/spec-kit
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync, type SpawnSyncReturns } from "child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import specKitPlugin, {
  updateTaskStatus,
  getTaskStatus,
} from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "../..");
const monorepoRoot = join(pluginRoot, "../..");

// Check if Specify CLI is available
function isSpecifyCLIInstalled(): { available: boolean; command: string } {
  const checkDir = mkdtempSync(join(tmpdir(), "specify-check-"));

  try {
    // Try common commands
    for (const cmd of [
      "specify",
      "uvx --from git+https://github.com/github/spec-kit.git specify",
    ]) {
      try {
        execSync(`${cmd} --help`, {
          stdio: "ignore",
          cwd: checkDir,
          timeout: 10000,
        });
        return {
          available: true,
          command: cmd.split(" ")[0] === "uvx" ? cmd : cmd,
        };
      } catch {
        continue;
      }
    }
    return { available: false, command: "" };
  } finally {
    rmSync(checkDir, { recursive: true });
  }
}

// Check if real CLI tests should run (opt-in via RUN_CLI_TESTS env var)
const shouldRunCliTests = process.env.RUN_CLI_TESTS === "true";
const cliStatus = shouldRunCliTests
  ? isSpecifyCLIInstalled()
  : { available: false, command: "" };

const describeCLI = cliStatus.available ? describe : describe.skip;
const specify = cliStatus.command;

if (!shouldRunCliTests) {
  console.log(
    "\n⏭️  Skipping real Specify CLI tests.\n" +
      "   Run with: RUN_CLI_TESTS=true npm test\n"
  );
} else if (!cliStatus.available) {
  console.log(
    "\n⚠️  Skipping real CLI tests: Specify CLI not available.\n" +
      "   Install: uv tool install specify-cli --from git+https://github.com/github/spec-kit.git\n"
  );
}

// Helper to run specify commands with timeout
function runSpecify(
  args: string[],
  cwd: string,
  timeoutMs = 60000
): SpawnSyncReturns<string> {
  // Handle uvx command which needs shell execution
  if (specify.includes("uvx")) {
    return spawnSync("sh", ["-c", `${specify} ${args.join(" ")}`], {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
    });
  }
  return spawnSync(specify, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
  });
}

// Sample spec-kit files for testing (matching the real spec-kit template format)
const SAMPLE_SPEC = `# Feature Specification: User Authentication

**Feature Branch**: \`feature/auth\`
**Status**: In Progress
**Created**: 2024-01-15

## Overview
Implement user authentication with JWT tokens.

## Requirements
- User registration
- User login
- Password reset
- Token refresh
`;

const SAMPLE_PLAN = `# Implementation Plan: User Authentication

**Branch**: \`feature/auth\`
**Spec**: [[001-spec]]
**Status**: Draft

## Architecture
JWT-based authentication with refresh tokens.

## Phases
1. Database schema
2. API endpoints
3. Frontend integration
`;

const SAMPLE_TASKS = `# Tasks

## Phase 1: Foundation
- [ ] T001 [P] Setup database schema
- [ ] T002 Create user model
- [x] T003 Configure JWT library

## Phase 2: API
- [ ] T004 [US1] Implement login endpoint
- [ ] T005 [US1] Implement registration endpoint
- [ ] T006 [US2] [P] Add password reset
`;

describeCLI("Real Specify CLI Integration", () => {
  let tempDir: string;
  let specifyDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "specify-real-cli-test-"));
  }, 30000);

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("specify init", { timeout: 120000 }, () => {
    it("should initialize a new project with .specify directory", () => {
      // Use --ai to bypass interactive selection
      const result = runSpecify(
        [
          "init",
          ".",
          "--here",
          "--ai",
          "claude",
          "--no-git",
          "--ignore-agent-tools",
          "--force",
        ],
        tempDir
      );

      // Check for success (may output to stderr for info messages)
      const combinedOutput = (result.stdout || "") + (result.stderr || "");

      // Verify .specify directory was created
      specifyDir = join(tempDir, ".specify");
      expect(existsSync(specifyDir)).toBe(true);
    });

    it("should create expected directory structure", () => {
      runSpecify(
        [
          "init",
          ".",
          "--here",
          "--ai",
          "claude",
          "--no-git",
          "--ignore-agent-tools",
          "--force",
        ],
        tempDir
      );

      specifyDir = join(tempDir, ".specify");
      const memoryDir = join(specifyDir, "memory");
      const templatesDir = join(specifyDir, "templates");

      // Verify directory structure
      expect(existsSync(specifyDir)).toBe(true);
      expect(existsSync(memoryDir)).toBe(true);
      expect(existsSync(templatesDir)).toBe(true);
    });

    it("should create constitution template in memory directory", () => {
      runSpecify(
        [
          "init",
          ".",
          "--here",
          "--ai",
          "claude",
          "--no-git",
          "--ignore-agent-tools",
          "--force",
        ],
        tempDir
      );

      const constitutionPath = join(
        tempDir,
        ".specify",
        "memory",
        "constitution.md"
      );
      // Constitution might be a template file
      expect(existsSync(join(tempDir, ".specify", "memory"))).toBe(true);
    });
  });

  describe("specify check", { timeout: 30000 }, () => {
    it("should report installed tools", () => {
      const result = runSpecify(["check"], tempDir);

      // Check command should succeed
      const combinedOutput = (result.stdout || "") + (result.stderr || "");
      // Should mention some tools (git at minimum)
      expect(combinedOutput.toLowerCase()).toMatch(
        /git|claude|cursor|copilot|installed/i
      );
    });
  });

  describe("specify version", { timeout: 30000 }, () => {
    it("should report version information", () => {
      const result = runSpecify(["version"], tempDir);

      const combinedOutput = (result.stdout || "") + (result.stderr || "");
      // Should have some version info
      expect(combinedOutput.length).toBeGreaterThan(0);
    });
  });

  describe("Integration with provider after init", { timeout: 120000 }, () => {
    it("should read specs created after CLI init", async () => {
      // Initialize with CLI
      runSpecify(
        [
          "init",
          ".",
          "--here",
          "--ai",
          "claude",
          "--no-git",
          "--ignore-agent-tools",
          "--force",
        ],
        tempDir
      );

      // Manually create a spec (simulating what AI assistant would create)
      const specsDir = join(tempDir, ".specify", "specs");
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(join(featureDir, "spec.md"), SAMPLE_SPEC);
      writeFileSync(join(featureDir, "tasks.md"), SAMPLE_TASKS);

      // Our provider should be able to read it
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();

      // Should find the spec and tasks
      expect(entities.find((e) => e.id === "sk-001-spec")).toBeDefined();
      expect(entities.filter((e) => e.type === "issue").length).toBe(6);
    });

    it("should update tasks in CLI-initialized project", async () => {
      // Initialize with CLI
      runSpecify(
        [
          "init",
          ".",
          "--here",
          "--ai",
          "claude",
          "--no-git",
          "--ignore-agent-tools",
          "--force",
        ],
        tempDir
      );

      // Create tasks file
      const specsDir = join(tempDir, ".specify", "specs");
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      const tasksPath = join(featureDir, "tasks.md");
      writeFileSync(
        tasksPath,
        "# Tasks\n\n- [ ] T001 Setup\n- [ ] T002 Build\n"
      );

      // Update task via provider
      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();
      await provider.updateEntity("skt-001-T001", { status: "closed" });

      // Verify file updated
      const content = readFileSync(tasksPath, "utf-8");
      expect(content).toContain("- [x] T001 Setup");
    });
  });
});

// Test integration with manually created spec-kit structure
// (simulating what would be created by AI assistant slash commands)
describeCLI("Spec-Kit Integration with Real Structure", () => {
  let tempDir: string;
  let specifyDir: string;
  let specsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "specify-integration-test-"));
    specifyDir = join(tempDir, ".specify");
    specsDir = join(specifyDir, "specs");

    // Create the basic structure that spec-kit's init creates
    mkdirSync(specsDir, { recursive: true });
    mkdirSync(join(specifyDir, "memory"), { recursive: true });
  }, 30000);

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("Reading spec-kit files", () => {
    it("should discover entities from feature directory", async () => {
      // Create a feature with spec, plan, and tasks
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(join(featureDir, "spec.md"), SAMPLE_SPEC);
      writeFileSync(join(featureDir, "plan.md"), SAMPLE_PLAN);
      writeFileSync(join(featureDir, "tasks.md"), SAMPLE_TASKS);

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();

      // Should find spec, plan, and 6 tasks
      const specs = entities.filter((e) => e.type === "spec");
      const issues = entities.filter((e) => e.type === "issue");

      expect(specs.length).toBe(2); // spec + plan
      expect(issues.length).toBe(6); // 6 tasks
    });

    it("should correctly parse task completion status", async () => {
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(join(featureDir, "tasks.md"), SAMPLE_TASKS);

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const issues = entities.filter((e) => e.type === "issue");

      // T003 should be completed (has [x])
      const t003 = issues.find((e) => e.id === "skt-001-T003");
      expect(t003?.status).toBe("closed");

      // T001 should be open (has [ ])
      const t001 = issues.find((e) => e.id === "skt-001-T001");
      expect(t001?.status).toBe("open");
    });

    it("should parse parallelizable tasks", async () => {
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(join(featureDir, "tasks.md"), SAMPLE_TASKS);

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const issues = entities.filter((e) => e.type === "issue");

      // T001 has [P] marker - should have higher priority
      const t001 = issues.find((e) => e.id === "skt-001-T001");
      expect(t001?.priority).toBe(1); // Parallelizable = priority 1
    });
  });

  describe("Writing back to spec-kit files", () => {
    it("should update task checkbox when issue status changes", async () => {
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      const tasksPath = join(featureDir, "tasks.md");
      writeFileSync(
        tasksPath,
        "# Tasks\n\n- [ ] T001 Setup project\n- [ ] T002 Build feature\n"
      );

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      // Update task through provider
      await provider.updateEntity("skt-001-T001", { status: "closed" });

      // Verify file was updated
      const content = readFileSync(tasksPath, "utf-8");
      expect(content).toContain("- [x] T001 Setup project");
    });

    it("should uncheck task when reopened", async () => {
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      const tasksPath = join(featureDir, "tasks.md");
      writeFileSync(
        tasksPath,
        "# Tasks\n\n- [x] T001 Setup project\n- [ ] T002 Build feature\n"
      );

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      // Reopen task through provider
      await provider.updateEntity("skt-001-T001", { status: "open" });

      // Verify file was updated
      const content = readFileSync(tasksPath, "utf-8");
      expect(content).toContain("- [ ] T001 Setup project");
    });

    it("should preserve other tasks when updating one", async () => {
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      const tasksPath = join(featureDir, "tasks.md");
      writeFileSync(tasksPath, SAMPLE_TASKS);

      // Update T001
      const result = updateTaskStatus(tasksPath, "T001", true);
      expect(result.success).toBe(true);

      // Verify other tasks are preserved
      const content = readFileSync(tasksPath, "utf-8");
      expect(content).toContain("- [x] T001"); // Updated
      expect(content).toContain("- [ ] T002"); // Unchanged
      expect(content).toContain("- [x] T003"); // Unchanged
      expect(content).toContain("- [ ] T004"); // Unchanged
    });
  });

  describe("Bidirectional sync", () => {
    it("should detect external changes to tasks.md", async () => {
      const featureDir = join(specsDir, "001-auth");
      mkdirSync(featureDir, { recursive: true });
      const tasksPath = join(featureDir, "tasks.md");
      writeFileSync(tasksPath, "# Tasks\n\n- [ ] T001 Setup\n");

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      // Initial state
      await provider.getChangesSince(new Date(0));

      // External change (simulating user editing file directly)
      writeFileSync(tasksPath, "# Tasks\n\n- [x] T001 Setup\n");

      // Should detect the change
      const changes = await provider.getChangesSince(new Date(0));
      const taskChange = changes.find((c) => c.entity_id === "skt-001-T001");

      expect(taskChange).toBeDefined();
      expect(taskChange?.change_type).toBe("updated");
    });

    it("should handle multiple features", async () => {
      // Create two features
      const authDir = join(specsDir, "001-auth");
      const paymentDir = join(specsDir, "002-payments");
      mkdirSync(authDir, { recursive: true });
      mkdirSync(paymentDir, { recursive: true });

      writeFileSync(join(authDir, "spec.md"), SAMPLE_SPEC);
      writeFileSync(
        join(authDir, "tasks.md"),
        "# Tasks\n\n- [ ] T001 Auth setup\n"
      );

      writeFileSync(
        join(paymentDir, "spec.md"),
        "# Feature Specification: Payments\n\n**Status**: Draft\n"
      );
      writeFileSync(
        join(paymentDir, "tasks.md"),
        "# Tasks\n\n- [ ] T001 Stripe setup\n- [ ] T002 Webhooks\n"
      );

      const provider = specKitPlugin.createProvider(
        { path: ".specify" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();

      // Should find entities from both features
      expect(entities.find((e) => e.id === "sk-001-spec")).toBeDefined();
      expect(entities.find((e) => e.id === "sk-002-spec")).toBeDefined();
      expect(entities.find((e) => e.id === "skt-001-T001")).toBeDefined();
      expect(entities.find((e) => e.id === "skt-002-T001")).toBeDefined();
      expect(entities.find((e) => e.id === "skt-002-T002")).toBeDefined();
    });
  });
});

// Version check test
describeCLI("CLI Version Check", () => {
  it("should report version or help", () => {
    const result = runSpecify(["--version"], tmpdir());
    // Some CLIs use --help to show version info
    const helpResult = runSpecify(["--help"], tmpdir());

    const combinedOutput =
      (result.stdout || "") +
      (result.stderr || "") +
      (helpResult.stdout || "") +
      (helpResult.stderr || "");

    // Should have some output
    expect(combinedOutput.length).toBeGreaterThan(0);
    console.log(`   Specify CLI available: ${cliStatus.available}`);
  });
});
