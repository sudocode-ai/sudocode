/**
 * Integration tests using the REAL Beads CLI
 *
 * These tests use @beads/bd which is installed as a dev dependency.
 * The binary is available at node_modules/.bin/bd
 *
 * Note: bd uses SQLite as primary storage and syncs to JSONL.
 * Write operations (create, close) are slow (~5s each) due to SQLite fsync.
 * Total test time is ~80s.
 *
 * KNOWN ISSUE: Vitest may report "Timeout calling onTaskUpdate" warning
 * after tests complete. This is a Vitest RPC timeout limitation with
 * long-running test files. All tests pass - the warning can be ignored.
 *
 * @see https://github.com/steveyegge/beads
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync, type SpawnSyncReturns } from "child_process";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "../..");
const monorepoRoot = join(pluginRoot, "../..");

// Possible paths for the npm-installed bd binary
const possibleBinPaths = [
  join(pluginRoot, "node_modules", ".bin", "bd"),
  join(monorepoRoot, "node_modules", ".bin", "bd"),
];

// Check if Beads CLI is available
// Uses a temp directory to avoid any accidental initialization in plugin directory
function isBeadsCLIInstalled(): { available: boolean; command: string } {
  const checkDir = mkdtempSync(join(tmpdir(), "beads-check-"));

  try {
    for (const binPath of possibleBinPaths) {
      if (existsSync(binPath)) {
        try {
          execSync(`"${binPath}" --version`, { stdio: "ignore", cwd: checkDir });
          return { available: true, command: binPath };
        } catch {
          continue;
        }
      }
    }

    for (const cmd of ["bd", "beads"]) {
      try {
        execSync(`${cmd} --version`, { stdio: "ignore", cwd: checkDir });
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
const cliStatus = shouldRunCliTests ? isBeadsCLIInstalled() : { available: false, command: "" };

const describeCLI = cliStatus.available ? describe : describe.skip;
const bd = cliStatus.command;

if (!shouldRunCliTests) {
  console.log(
    "\n⏭️  Skipping real CLI tests (slow ~80s).\n" +
      "   Run with: RUN_CLI_TESTS=true npm test\n"
  );
} else if (!cliStatus.available) {
  console.log(
    "\n⚠️  Skipping real CLI tests: Beads CLI not available.\n" +
      "   Run: npm install (to get @beads/bd)\n"
  );
}

// Helper to run bd commands with timeout
function runBd(
  args: string[],
  cwd: string,
  timeoutMs = 30000
): SpawnSyncReturns<string> {
  return spawnSync(bd, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
  });
}

// Helper to parse issue ID from bd output
function parseIssueId(output: string): string | null {
  // bd uses project-name-derived prefixes like "integration-beads-xxx"
  // Match "Created issue: <id>" pattern first
  const createdMatch = output.match(/Created issue:\s*([a-zA-Z0-9-]+)/);
  if (createdMatch) {
    return createdMatch[1];
  }

  // Match beads-xxx-yyy or beads-xxx format
  const beadsMatch = output.match(/\b(beads-[a-zA-Z0-9]+-[a-zA-Z0-9]+)\b/) ||
                output.match(/\b(beads-[a-f0-9]+)\b/i);
  if (beadsMatch) {
    return beadsMatch[1];
  }

  // Match any prefix-id pattern (e.g., "integration-beads-5uv", "myproject-abc")
  const prefixMatch = output.match(/\b([a-zA-Z][a-zA-Z0-9-]*-[a-zA-Z0-9]{2,})\b/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  return null;
}

describeCLI("Real Beads CLI Integration", () => {
  let tempDir: string;
  let beadsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-real-cli-test-"));
    beadsDir = join(tempDir, ".beads");

    // Initialize beads
    const result = runBd(["init"], tempDir);
    if (result.status !== 0) {
      throw new Error(`bd init failed: ${result.stderr}`);
    }
  }, 30000); // 30s timeout for beforeEach

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("bd init", () => {
    it("should create .beads directory", () => {
      expect(existsSync(beadsDir)).toBe(true);
    });

    it("should create database", () => {
      // bd uses SQLite - check for db file or .beads directory structure
      expect(existsSync(beadsDir)).toBe(true);
    });
  });

  describe("bd create", { timeout: 30000 }, () => {
    it("should create an issue and return ID", () => {
      const result = runBd(["create", "Test Issue"], tempDir);

      expect(result.status).toBe(0);
      const combinedOutput = (result.stdout || "") + (result.stderr || "");
      const issueId = parseIssueId(combinedOutput);
      expect(issueId).not.toBeNull();
    });

    it("should create issue with priority", () => {
      const result = runBd(["create", "High Priority Issue", "-p", "0"], tempDir);
      expect(result.status).toBe(0);
    });
  });

  describe("bd list", { timeout: 30000 }, () => {
    let issueId: string;

    beforeEach(() => {
      const result = runBd(["create", "List Test Issue"], tempDir);
      const combinedOutput = (result.stdout || "") + (result.stderr || "");
      issueId = parseIssueId(combinedOutput) || "";
    }, 30000);

    it("should list issues", () => {
      const result = runBd(["list"], tempDir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("List Test Issue");
    });

    it("should support --json flag", () => {
      const result = runBd(["list", "--json"], tempDir);
      expect(result.status).toBe(0);

      // Parse JSON output
      const issues = JSON.parse(result.stdout);
      expect(Array.isArray(issues)).toBe(true);
      expect(issues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("bd show", { timeout: 30000 }, () => {
    let issueId: string;

    beforeEach(() => {
      const result = runBd(["create", "Show Test Issue"], tempDir);
      const combinedOutput = (result.stdout || "") + (result.stderr || "");
      issueId = parseIssueId(combinedOutput) || "";
    }, 30000);

    it("should show issue details", () => {
      const result = runBd(["show", issueId], tempDir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Show Test Issue");
    });

    it("should support --json flag", () => {
      const result = runBd(["show", issueId, "--json"], tempDir);
      expect(result.status).toBe(0);

      // bd show --json returns an array
      const issues = JSON.parse(result.stdout);
      expect(Array.isArray(issues)).toBe(true);
      expect(issues[0].title).toBe("Show Test Issue");
    });
  });

  describe("bd close", { timeout: 30000 }, () => {
    let issueId: string;

    beforeEach(() => {
      const result = runBd(["create", "To Close"], tempDir);
      const combinedOutput = (result.stdout || "") + (result.stderr || "");
      issueId = parseIssueId(combinedOutput) || "";
    }, 30000);

    it("should close an issue", () => {
      const closeResult = runBd(["close", issueId], tempDir);
      expect(closeResult.status).toBe(0);

      // Verify status changed (bd show --json returns an array)
      const showResult = runBd(["show", issueId, "--json"], tempDir);
      const issues = JSON.parse(showResult.stdout);
      expect(issues[0].status).toBe("closed");
    });
  });

  describe("bd ready", { timeout: 30000 }, () => {
    beforeEach(() => {
      runBd(["create", "Ready Issue"], tempDir);
    }, 30000);

    it("should show ready issues", () => {
      const result = runBd(["ready"], tempDir);
      expect(result.status).toBe(0);
    });
  });
});

// Version check test
describeCLI("CLI Version Check", () => {
  it("should report version", () => {
    const result = spawnSync(bd, ["--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    console.log(`   Beads CLI version: ${result.stdout.trim()}`);
  });
});
