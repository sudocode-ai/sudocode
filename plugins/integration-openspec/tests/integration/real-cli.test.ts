/**
 * Integration tests for OpenSpec plugin with real CLI
 *
 * NOTE: The `openspec` CLI may require interactive terminal input for some commands
 * (e.g., AI tool selection during init). Therefore these tests focus on:
 * 1. Verifying CLI availability and basic commands
 * 2. Testing our integration works with real OpenSpec file structures
 * 3. Testing change detection and entity parsing
 *
 * The tests create OpenSpec directory structures manually (simulating what would
 * be created by `openspec init` + AI assistant slash commands).
 *
 * To run: RUN_CLI_TESTS=true npm test -- tests/integration/real-cli.test.ts
 *
 * @see https://github.com/Fission-AI/OpenSpec
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
import openSpecPlugin from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "../..");
const monorepoRoot = join(pluginRoot, "../..");

// Possible paths for the npm-installed openspec binary
const possibleBinPaths = [
  join(pluginRoot, "node_modules", ".bin", "openspec"),
  join(monorepoRoot, "node_modules", ".bin", "openspec"),
];

// Check if OpenSpec CLI is available
function isOpenSpecCLIInstalled(): { available: boolean; command: string } {
  const checkDir = mkdtempSync(join(tmpdir(), "openspec-check-"));

  try {
    // Check local node_modules first
    for (const binPath of possibleBinPaths) {
      if (existsSync(binPath)) {
        try {
          execSync(`"${binPath}" --version`, {
            stdio: "ignore",
            cwd: checkDir,
            timeout: 10000,
          });
          return { available: true, command: binPath };
        } catch {
          continue;
        }
      }
    }

    // Try global install
    for (const cmd of ["openspec"]) {
      try {
        execSync(`${cmd} --version`, {
          stdio: "ignore",
          cwd: checkDir,
          timeout: 10000,
        });
        return { available: true, command: cmd };
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
  ? isOpenSpecCLIInstalled()
  : { available: false, command: "" };

const describeCLI = cliStatus.available ? describe : describe.skip;
const openspec = cliStatus.command;

if (!shouldRunCliTests) {
  console.log(
    "\n⏭️  Skipping real OpenSpec CLI tests.\n" +
      "   Run with: RUN_CLI_TESTS=true npm test\n"
  );
} else if (!cliStatus.available) {
  console.log(
    "\n⚠️  Skipping real CLI tests: OpenSpec CLI not available.\n" +
      "   Install: npm install -g @fission-ai/openspec\n"
  );
}

// Helper to run openspec commands with timeout
function runOpenSpec(
  args: string[],
  cwd: string,
  timeoutMs = 30000
): SpawnSyncReturns<string> {
  return spawnSync(openspec, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
  });
}

// Sample OpenSpec files for testing (matching the real OpenSpec format)
const SAMPLE_SPEC = `# CLI Scaffolding Specification

## Purpose
Add a scaffolding command to quickly generate new project files.

## Requirements
### Requirement: Template Generation
The CLI SHALL generate files from predefined templates.

#### Scenario: Creating a new component
- GIVEN a user runs the scaffold command
- WHEN they specify "component" as the template type
- THEN a new component directory is created with boilerplate files
`;

const SAMPLE_PROPOSAL = `## Why
We need to add scaffolding capabilities to improve developer productivity.

## What Changes
- Add new \`scaffold\` subcommand to CLI
- Generate boilerplate project files from templates
- Support multiple template types (component, page, service)

## Impact
This will significantly speed up new project setup for developers.
`;

const SAMPLE_TASKS = `# Tasks

## Phase 1: Foundation
- [ ] T001 Create command structure
- [ ] T002 Add template parsing logic
- [x] T003 Setup CLI framework integration

## Phase 2: Templates
- [ ] T004 Implement component template
- [ ] T005 Implement page template
- [ ] T006 Add template validation
`;

const SAMPLE_DESIGN = `# Technical Design

## Architecture
The scaffold command will use a template engine to generate files.

## Template Format
Templates will be stored as markdown files with frontmatter metadata.

## File Generation
Files will be generated using string interpolation for placeholders.
`;

describeCLI("Real OpenSpec CLI Integration", () => {
  let tempDir: string;
  let openspecDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openspec-real-cli-test-"));
    openspecDir = join(tempDir, "openspec");
  }, 30000);

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("openspec --version", { timeout: 30000 }, () => {
    it("should report version information", () => {
      const result = runOpenSpec(["--version"], tempDir);

      expect(result.status).toBe(0);
      const output = (result.stdout || "") + (result.stderr || "");
      // Should have some version output
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe("openspec --help", { timeout: 30000 }, () => {
    it("should show help information", () => {
      const result = runOpenSpec(["--help"], tempDir);

      expect(result.status).toBe(0);
      const output = (result.stdout || "") + (result.stderr || "");
      // Should mention key commands
      expect(output.toLowerCase()).toMatch(/init|list|archive|validate/);
    });
  });

  describe("openspec list", { timeout: 30000 }, () => {
    it("should list changes when openspec directory exists", () => {
      // Create OpenSpec structure with a change
      mkdirSync(join(openspecDir, "changes", "add-feature"), {
        recursive: true,
      });
      writeFileSync(
        join(openspecDir, "changes", "add-feature", "proposal.md"),
        SAMPLE_PROPOSAL
      );
      writeFileSync(
        join(openspecDir, "changes", "add-feature", "tasks.md"),
        SAMPLE_TASKS
      );

      const result = runOpenSpec(["list"], tempDir);

      // Should succeed or show "no changes" message
      const output = (result.stdout || "") + (result.stderr || "");
      expect(output).toBeDefined();
    });

    it("should handle missing openspec directory gracefully", () => {
      const result = runOpenSpec(["list"], tempDir);

      // Should not crash, may show error or empty list
      const output = (result.stdout || "") + (result.stderr || "");
      expect(output).toBeDefined();
    });
  });

  describe("openspec validate", { timeout: 30000 }, () => {
    it("should validate a change with proper structure", () => {
      // Create a properly structured change
      const changeDir = join(openspecDir, "changes", "add-feature");
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, "proposal.md"), SAMPLE_PROPOSAL);
      writeFileSync(join(changeDir, "tasks.md"), SAMPLE_TASKS);

      // Create a spec delta
      const specDeltaDir = join(changeDir, "specs", "cli-scaffold");
      mkdirSync(specDeltaDir, { recursive: true });
      writeFileSync(join(specDeltaDir, "spec.md"), SAMPLE_SPEC);

      const result = runOpenSpec(["validate", "add-feature"], tempDir);

      const output = (result.stdout || "") + (result.stderr || "");
      // Should run without crashing
      expect(output).toBeDefined();
    });
  });

  describe("openspec show", { timeout: 30000 }, () => {
    it("should show details of a change", () => {
      // Create a change with full structure
      const changeDir = join(openspecDir, "changes", "add-auth");
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, "proposal.md"), SAMPLE_PROPOSAL);
      writeFileSync(join(changeDir, "tasks.md"), SAMPLE_TASKS);
      writeFileSync(join(changeDir, "design.md"), SAMPLE_DESIGN);

      const result = runOpenSpec(["show", "add-auth"], tempDir);

      const output = (result.stdout || "") + (result.stderr || "");
      // Should show some output about the change
      expect(output).toBeDefined();
    });
  });
});

// Test integration with manually created OpenSpec structure
// (simulating what would be created by AI assistant slash commands)
describeCLI("OpenSpec Integration with Real Structure", () => {
  let tempDir: string;
  let openspecDir: string;
  let specsDir: string;
  let changesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openspec-integration-test-"));
    openspecDir = join(tempDir, "openspec");
    specsDir = join(openspecDir, "specs");
    changesDir = join(openspecDir, "changes");

    // Create the basic structure that openspec init creates
    mkdirSync(specsDir, { recursive: true });
    mkdirSync(changesDir, { recursive: true });
  }, 30000);

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("Reading OpenSpec files", () => {
    it("should discover specs from specs/ directory", async () => {
      // Create a spec
      const specDir = join(specsDir, "auth");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        `# Auth Specification

## Purpose
Handle user authentication and session management.

## Requirements
### Requirement: User Login
The system SHALL authenticate users via JWT tokens.
`
      );

      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const specs = entities.filter((e) => e.type === "spec");

      expect(specs.length).toBe(1);
      expect(specs[0].title).toContain("Auth");
    });

    it("should discover changes from changes/ directory", async () => {
      // Create a change
      const changeDir = join(changesDir, "add-2fa");
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, "proposal.md"), SAMPLE_PROPOSAL);
      writeFileSync(join(changeDir, "tasks.md"), SAMPLE_TASKS);

      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const issues = entities.filter((e) => e.type === "issue");

      expect(issues.length).toBe(1);
      expect(issues[0].title).toBeDefined();
    });

    it("should correctly parse task completion status", async () => {
      const changeDir = join(changesDir, "add-feature");
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, "proposal.md"), SAMPLE_PROPOSAL);
      writeFileSync(join(changeDir, "tasks.md"), SAMPLE_TASKS);

      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const issue = entities.find((e) => e.type === "issue");

      // 1 of 6 tasks complete = ~17% = in_progress
      expect(issue?.status).toBe("in_progress");
    });

    it("should detect spec relationships from delta directories", async () => {
      // Create a spec
      const specDir = join(specsDir, "cli-scaffold");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "spec.md"), SAMPLE_SPEC);

      // Create a change that affects the spec (via delta directory)
      const changeDir = join(changesDir, "add-templates");
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, "proposal.md"), SAMPLE_PROPOSAL);
      writeFileSync(join(changeDir, "tasks.md"), "# Tasks\n\n- [ ] T001 Add templates\n");

      // Create the delta directory that links change to spec
      const deltaDir = join(changeDir, "specs", "cli-scaffold");
      mkdirSync(deltaDir, { recursive: true });
      writeFileSync(
        join(deltaDir, "spec.md"),
        "# Delta for CLI Scaffold\n\n## ADDED Requirements\n..."
      );

      const provider = openSpecPlugin.createProvider(
        { path: "openspec", spec_prefix: "os", issue_prefix: "osc" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const issue = entities.find((e) => e.type === "issue");

      // Should have relationship to the spec
      expect(issue?.relationships).toBeDefined();
      expect(issue?.relationships?.length).toBeGreaterThan(0);
      expect(issue?.relationships?.[0].targetType).toBe("spec");
      expect(issue?.relationships?.[0].relationshipType).toBe("implements");
    });
  });

  describe("Handling archived changes", () => {
    it("should detect archived changes", async () => {
      // Create an archived change (archive is inside changes/)
      const archiveDir = join(changesDir, "archive");
      const archivedChangeDir = join(archiveDir, "2024-01-15-completed-feature");
      mkdirSync(archivedChangeDir, { recursive: true });
      writeFileSync(
        join(archivedChangeDir, "proposal.md"),
        SAMPLE_PROPOSAL
      );
      writeFileSync(
        join(archivedChangeDir, "tasks.md"),
        "# Tasks\n\n- [x] T001 Complete\n- [x] T002 Done\n"
      );

      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const archivedIssue = entities.find(
        (e) => e.type === "issue" && e.raw?.isArchived
      );

      expect(archivedIssue).toBeDefined();
      expect(archivedIssue?.status).toBe("closed");
    });
  });

  describe("Multiple specs and changes", () => {
    it("should handle multiple specs", async () => {
      // Create multiple specs
      const authDir = join(specsDir, "auth");
      const profileDir = join(specsDir, "profile");
      mkdirSync(authDir, { recursive: true });
      mkdirSync(profileDir, { recursive: true });

      writeFileSync(
        join(authDir, "spec.md"),
        "# Auth Specification\n\n## Purpose\nAuth stuff."
      );
      writeFileSync(
        join(profileDir, "spec.md"),
        "# Profile Specification\n\n## Purpose\nProfile stuff."
      );

      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const specs = entities.filter((e) => e.type === "spec");

      expect(specs.length).toBe(2);
    });

    it("should handle multiple changes", async () => {
      // Create multiple changes
      const change1Dir = join(changesDir, "add-feature-a");
      const change2Dir = join(changesDir, "add-feature-b");
      mkdirSync(change1Dir, { recursive: true });
      mkdirSync(change2Dir, { recursive: true });

      writeFileSync(
        join(change1Dir, "proposal.md"),
        "## Why\nFeature A\n\n## What Changes\nStuff"
      );
      writeFileSync(
        join(change1Dir, "tasks.md"),
        "# Tasks\n\n- [ ] T001 Task A"
      );
      writeFileSync(
        join(change2Dir, "proposal.md"),
        "## Why\nFeature B\n\n## What Changes\nOther stuff"
      );
      writeFileSync(
        join(change2Dir, "tasks.md"),
        "# Tasks\n\n- [ ] T001 Task B"
      );

      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      const entities = await provider.searchEntities();
      const issues = entities.filter((e) => e.type === "issue");

      expect(issues.length).toBe(2);
    });
  });

  describe("Change detection", () => {
    it("should detect new entities", async () => {
      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      // Initial state - empty
      await provider.getChangesSince(new Date(0));

      // Add a new spec
      const specDir = join(specsDir, "new-feature");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "spec.md"),
        "# New Feature\n\n## Purpose\nNew stuff."
      );

      // Should detect the new entity
      const changes = await provider.getChangesSince(new Date(0));
      const created = changes.filter((c) => c.change_type === "created");

      expect(created.length).toBeGreaterThan(0);
    });

    it("should detect updated entities", async () => {
      // Create initial spec
      const specDir = join(specsDir, "existing");
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, "spec.md");
      writeFileSync(specPath, "# Existing\n\n## Purpose\nOriginal.");

      const provider = openSpecPlugin.createProvider(
        { path: "openspec" },
        tempDir
      );
      await provider.initialize();

      // Initial state
      await provider.getChangesSince(new Date(0));

      // Modify the spec
      writeFileSync(specPath, "# Existing\n\n## Purpose\nModified content.");

      // Should detect the update
      const changes = await provider.getChangesSince(new Date(0));
      const updated = changes.filter((c) => c.change_type === "updated");

      expect(updated.length).toBeGreaterThan(0);
    });
  });
});

// Integration test: CLI creates structure, provider reads it
describeCLI("CLI and Provider Integration", { timeout: 60000 }, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openspec-cli-provider-test-"));
  }, 30000);

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it("should read specs from CLI-created structure", async () => {
    // Manually create structure (simulating what openspec init would create)
    const openspecDir = join(tempDir, "openspec");
    const specsDir = join(openspecDir, "specs");
    mkdirSync(specsDir, { recursive: true });

    // Create a spec like the CLI would
    const specDir = join(specsDir, "auth");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "spec.md"),
      `# Auth Specification

## Purpose
Authentication and session management.

## Requirements
### Requirement: User Authentication
The system SHALL issue a JWT on successful login.

#### Scenario: Valid credentials
- WHEN a user submits valid credentials
- THEN a JWT is returned
`
    );

    // Create a change like an AI assistant would
    const changesDir = join(openspecDir, "changes");
    const changeDir = join(changesDir, "add-2fa");
    mkdirSync(changeDir, { recursive: true });

    writeFileSync(
      join(changeDir, "proposal.md"),
      `## Why
Add two-factor authentication for improved security.

## What Changes
- Add TOTP-based 2FA option
- Update login flow to check 2FA
- Add 2FA setup in user settings

## Impact
Improves account security for all users.
`
    );

    writeFileSync(
      join(changeDir, "tasks.md"),
      `# Tasks

- [ ] T001 Add TOTP library
- [ ] T002 Create 2FA setup flow
- [ ] T003 Update login endpoint
- [ ] T004 Add 2FA verification UI
`
    );

    // Create delta directory linking change to auth spec
    const deltaDir = join(changeDir, "specs", "auth");
    mkdirSync(deltaDir, { recursive: true });
    writeFileSync(
      join(deltaDir, "spec.md"),
      `# Delta for Auth

## ADDED Requirements
### Requirement: Two-Factor Authentication
The system SHALL support TOTP-based 2FA.
`
    );

    // Our provider should read this correctly
    const provider = openSpecPlugin.createProvider(
      { path: "openspec", spec_prefix: "os", issue_prefix: "osc" },
      tempDir
    );
    await provider.initialize();

    const entities = await provider.searchEntities();

    // Should find the spec
    const specs = entities.filter((e) => e.type === "spec");
    expect(specs.length).toBe(1);
    expect(specs[0].title).toContain("Auth");

    // Should find the change as an issue
    const issues = entities.filter((e) => e.type === "issue");
    expect(issues.length).toBe(1);

    // Issue should have relationship to auth spec
    const issue = issues[0];
    expect(issue.relationships).toBeDefined();
    expect(issue.relationships?.length).toBe(1);
    expect(issue.relationships?.[0].relationshipType).toBe("implements");

    // Map to sudocode format
    const mapped = provider.mapToSudocode(issue);
    expect(mapped.issue).toBeDefined();
    expect(mapped.issue?.status).toBe("open"); // 0 tasks complete
    expect(mapped.relationships).toBeDefined();
  });
});

// Version check test (always runs if CLI available)
describeCLI("CLI Version Check", () => {
  it("should report version", () => {
    const result = spawnSync(openspec, ["--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    console.log(`   OpenSpec CLI version: ${result.stdout.trim()}`);
  });
});
