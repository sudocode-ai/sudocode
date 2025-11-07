/**
 * Integration tests for Milestone 1: Completion Summary System
 * Tests the full flow of completing issues/specs with reflection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { initDatabase } from "../../src/db.js";
import { createIssue } from "../../src/operations/issues.js";
import { createSpec } from "../../src/operations/specs.js";
import { handleIssueComplete, handleSpecComplete } from "../../src/cli/completion-commands.js";
import type Database from "better-sqlite3";
import type { CommandContext } from "../../src/types.js";

describe("Milestone 1: Completion Summary Integration", () => {
  let tmpDir: string;
  let gitDir: string;
  let db: Database.Database;
  let ctx: CommandContext;

  beforeEach(() => {
    // Create temp directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "completion-integration-"));
    gitDir = path.join(tmpDir, "git-repo");
    fs.mkdirSync(gitDir);

    // Initialize git repo
    execSync("git init", { cwd: gitDir });
    execSync("git config user.email 'test@example.com'", { cwd: gitDir });
    execSync("git config user.name 'Test User'", { cwd: gitDir });
    execSync("git config commit.gpgsign false", { cwd: gitDir });

    // Create initial commit
    fs.writeFileSync(path.join(gitDir, "README.md"), "# Test Repo");
    execSync("git add .", { cwd: gitDir });
    execSync('git commit -m "Initial commit"', { cwd: gitDir });

    // Initialize database
    const dbPath = path.join(tmpDir, "cache.db");
    db = initDatabase({ path: dbPath });

    ctx = {
      db,
      outputDir: tmpDir,
      jsonOutput: false,
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Issue Completion Flow", () => {
    it("should complete issue with basic reflection", async () => {
      // Create an issue
      const issue = createIssue(
        db,
        "Test Issue",
        "This is a test issue for completion",
        { tags: ["testing", "integration"] }
      );

      // Make some git commits
      const srcDir = path.join(gitDir, "src");
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, "feature.ts"), "export function test() {}");
      execSync("git add .", { cwd: gitDir });
      const startCommit = execSync('git rev-parse HEAD', { cwd: gitDir }).toString().trim();
      execSync('git commit -m "Add feature"', { cwd: gitDir });

      fs.writeFileSync(path.join(srcDir, "feature.test.ts"), "test('works', () => {})");
      execSync("git add .", { cwd: gitDir });
      execSync('git commit -m "Add tests"', { cwd: gitDir });
      const endCommit = execSync('git rev-parse HEAD', { cwd: gitDir }).toString().trim();

      // Complete issue with reflection
      const summary = {
        what_worked: ["TypeScript implementation", "Unit tests"],
        what_failed: ["Initial attempt without types"],
        blocking_factors: ["Had to research async patterns"],
        key_decisions: [
          {
            decision: "Use async/await",
            rationale: "Better error handling",
            alternatives_considered: ["Callbacks", "Promises"],
          },
        ],
        code_patterns_introduced: ["Async function pattern"],
        dependencies_discovered: ["none"],
        git_commit_range: { start: startCommit, end: endCommit },
        files_modified: ["src/feature.ts", "src/feature.test.ts"],
        time_to_complete: 2,
      };

      await handleIssueComplete(ctx, issue.id, {
        summary: JSON.stringify(summary),
      });

      // Verify issue is closed
      const updatedIssue = db
        .prepare("SELECT * FROM issues WHERE id = ?")
        .get(issue.id) as any;
      expect(updatedIssue.status).toBe("closed");

      // Verify completion summary is stored
      expect(updatedIssue.completion_summary).toBeDefined();
      const stored = JSON.parse(updatedIssue.completion_summary);
      expect(stored.what_worked).toContain("TypeScript implementation");
      expect(stored.what_failed).toContain("Initial attempt without types");
      expect(stored.key_decisions).toHaveLength(1);
      expect(stored.key_decisions[0].decision).toBe("Use async/await");
      expect(stored.git_commit_range.start).toBe(startCommit);
      expect(stored.git_commit_range.end).toBe(endCommit);
    });

    it("should complete issue without reflection (basic summary)", async () => {
      // Create an issue
      const issue = createIssue(db, "Simple Issue", "Quick fix");

      // Complete without providing summary
      await handleIssueComplete(ctx, issue.id, {});

      // Verify issue is closed
      const updatedIssue = db
        .prepare("SELECT * FROM issues WHERE id = ?")
        .get(issue.id) as any;
      expect(updatedIssue.status).toBe("closed");

      // completion_summary should be null or undefined if not provided
      expect(updatedIssue.completion_summary).toBeUndefined();
    });

    it("should handle git analysis for issue completion", async () => {
      // Create an issue
      const issue = createIssue(
        db,
        "Git Analysis Test",
        "Test git history analysis"
      );

      // Make multiple commits with different file types
      const srcDir = path.join(gitDir, "src");
      const testDir = path.join(gitDir, "tests");
      fs.mkdirSync(srcDir);
      fs.mkdirSync(testDir);

      fs.writeFileSync(path.join(srcDir, "auth.ts"), "export const auth = {}");
      execSync("git add .", { cwd: gitDir });
      const startCommit = execSync('git rev-parse HEAD', { cwd: gitDir }).toString().trim();
      execSync('git commit -m "Add auth module"', { cwd: gitDir });

      fs.writeFileSync(path.join(testDir, "auth.test.ts"), "test auth");
      execSync("git add .", { cwd: gitDir });
      execSync('git commit -m "Add auth tests"', { cwd: gitDir });

      fs.writeFileSync(path.join(srcDir, "db.ts"), "export const db = {}");
      execSync("git add .", { cwd: gitDir });
      execSync('git commit -m "Add database module"', { cwd: gitDir });
      const endCommit = execSync('git rev-parse HEAD', { cwd: gitDir }).toString().trim();

      // Complete with git range
      const summary = {
        what_worked: ["Modular architecture"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
        git_commit_range: { start: startCommit, end: endCommit },
        files_modified: ["src/auth.ts", "tests/auth.test.ts", "src/db.ts"],
      };

      await handleIssueComplete(ctx, issue.id, {
        summary: JSON.stringify(summary),
      });

      // Verify git info is stored
      const updatedIssue = db
        .prepare("SELECT * FROM issues WHERE id = ?")
        .get(issue.id) as any;
      const stored = JSON.parse(updatedIssue.completion_summary);
      expect(stored.git_commit_range).toBeDefined();
      expect(stored.files_modified).toHaveLength(3);
      expect(stored.files_modified).toContain("src/auth.ts");
      expect(stored.files_modified).toContain("src/db.ts");
    });
  });

  describe("Spec Completion Flow", () => {
    it("should complete spec with reflection", async () => {
      // Create a spec
      const spec = createSpec(
        db,
        "Test Spec",
        "This is a test spec for completion",
        { tags: ["testing", "integration"] }
      );

      // Make some commits
      fs.writeFileSync(path.join(gitDir, "spec-impl.ts"), "export const impl = {}");
      execSync("git add .", { cwd: gitDir });
      const startCommit = execSync('git rev-parse HEAD', { cwd: gitDir }).toString().trim();
      execSync('git commit -m "Implement spec"', { cwd: gitDir });
      const endCommit = execSync('git rev-parse HEAD', { cwd: gitDir }).toString().trim();

      // Complete spec with reflection
      const summary = {
        what_worked: ["Clear requirements"],
        what_failed: ["Ambiguous edge cases"],
        blocking_factors: [],
        key_decisions: [
          {
            decision: "Use TypeScript generics",
            rationale: "Type safety",
            alternatives_considered: ["Any types"],
          },
        ],
        code_patterns_introduced: ["Generic factory pattern"],
        dependencies_discovered: [],
        git_commit_range: { start: startCommit, end: endCommit },
        test_results: { passed: 10, failed: 0, coverage: 85 },
        time_to_complete: 4,
      };

      await handleSpecComplete(ctx, spec.id, {
        summary: JSON.stringify(summary),
      });

      // Verify spec is archived
      const updatedSpec = db
        .prepare("SELECT * FROM specs WHERE id = ?")
        .get(spec.id) as any;
      expect(updatedSpec.archived).toBe(true);

      // Verify completion summary with test results
      const stored = JSON.parse(updatedSpec.completion_summary);
      expect(stored.what_worked).toContain("Clear requirements");
      expect(stored.test_results).toBeDefined();
      expect(stored.test_results.passed).toBe(10);
      expect(stored.test_results.coverage).toBe(85);
      expect(stored.time_to_complete).toBe(4);
    });

    it("should complete spec without git info", async () => {
      // Create a spec
      const spec = createSpec(db, "Simple Spec", "No git tracking");

      // Complete without git info
      const summary = {
        what_worked: ["Simple implementation"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      await handleSpecComplete(ctx, spec.id, {
        summary: JSON.stringify(summary),
      });

      // Verify spec is archived
      const updatedSpec = db
        .prepare("SELECT * FROM specs WHERE id = ?")
        .get(spec.id) as any;
      expect(updatedSpec.archived).toBe(true);

      // Verify completion summary without git info
      const stored = JSON.parse(updatedSpec.completion_summary);
      expect(stored.what_worked).toContain("Simple implementation");
      expect(stored.git_commit_range).toBeUndefined();
    });
  });

  describe("Completion Summary Serialization", () => {
    it("should handle complex completion summaries", async () => {
      const issue = createIssue(db, "Complex Issue", "Many learnings");

      const complexSummary = {
        what_worked: [
          "Pattern A",
          "Pattern B",
          "Pattern C with special characters: <>&\"'",
        ],
        what_failed: [
          "Approach 1",
          "Approach 2: failed due to race condition",
        ],
        blocking_factors: [
          "Waiting for dependency update",
          "Unclear requirements",
          "Performance issues in CI",
        ],
        key_decisions: [
          {
            decision: "Use cache layer",
            rationale: "Reduce database load by 70%",
            alternatives_considered: [
              "Optimized queries",
              "Database sharding",
              "Read replicas",
            ],
          },
          {
            decision: "Migrate to async",
            rationale: "Non-blocking I/O",
            alternatives_considered: ["Worker threads", "Child processes"],
          },
        ],
        code_patterns_introduced: [
          "Cache-aside pattern",
          "Repository pattern",
          "Factory pattern",
        ],
        dependencies_discovered: [
          "redis@^4.0.0",
          "ioredis@^5.0.0",
        ],
        test_results: {
          passed: 150,
          failed: 2,
          coverage: 92.5,
        },
        time_to_complete: 12.5,
      };

      await handleIssueComplete(ctx, {
        issueId: issue.id,
        summary: JSON.stringify(complexSummary),
      });

      // Verify complex data is properly serialized and retrieved
      const updatedIssue = db
        .prepare("SELECT * FROM issues WHERE id = ?")
        .get(issue.id) as any;
      const stored = JSON.parse(updatedIssue.completion_summary);

      expect(stored.what_worked).toHaveLength(3);
      expect(stored.what_failed).toHaveLength(2);
      expect(stored.blocking_factors).toHaveLength(3);
      expect(stored.key_decisions).toHaveLength(2);
      expect(stored.key_decisions[0].alternatives_considered).toHaveLength(3);
      expect(stored.code_patterns_introduced).toHaveLength(3);
      expect(stored.dependencies_discovered).toHaveLength(2);
      expect(stored.test_results.coverage).toBe(92.5);
      expect(stored.time_to_complete).toBe(12.5);
    });

    it("should handle special characters and escaping", async () => {
      const issue = createIssue(db, "Special Chars", "Test escaping");

      const summary = {
        what_worked: [
          'Pattern with "quotes"',
          "Pattern with 'single quotes'",
          "Pattern with newline\ncharacter",
          "Pattern with tab\tcharacter",
        ],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      await handleIssueComplete(ctx, issue.id, {
        summary: JSON.stringify(summary),
      });

      const updatedIssue = db
        .prepare("SELECT * FROM issues WHERE id = ?")
        .get(issue.id) as any;
      const stored = JSON.parse(updatedIssue.completion_summary);

      expect(stored.what_worked[0]).toContain('"quotes"');
      expect(stored.what_worked[1]).toContain("'single quotes'");
      expect(stored.what_worked[2]).toContain("\n");
      expect(stored.what_worked[3]).toContain("\t");
    });
  });

  describe("Error Handling", () => {
    it("should handle non-existent issue", async () => {
      await expect(
        handleIssueComplete(ctx, "NON-EXISTENT", {
          summary: JSON.stringify({
            what_worked: [],
            what_failed: [],
            blocking_factors: [],
            key_decisions: [],
            code_patterns_introduced: [],
            dependencies_discovered: [],
          }),
        })
      ).rejects.toThrow();
    });

    it("should handle non-existent spec", async () => {
      await expect(
        handleSpecComplete(ctx, "NON-EXISTENT", {
          summary: JSON.stringify({
            what_worked: [],
            what_failed: [],
            blocking_factors: [],
            key_decisions: [],
            code_patterns_introduced: [],
            dependencies_discovered: [],
          }),
        })
      ).rejects.toThrow();
    });

    it("should handle malformed JSON summary", async () => {
      const issue = createIssue(db, "Test Issue", "Description");

      await expect(
        handleIssueComplete(ctx, issue.id, {
          summary: "{invalid json}",
        })
      ).rejects.toThrow();
    });
  });
});
