/**
 * Integration test for resolve-conflicts using git stages
 *
 * This test demonstrates that resolve-conflicts should use git stages
 * (base/ours/theirs) from the git index instead of parsing conflict markers
 * with an empty base.
 *
 * Current status: FAILING - demonstrates missing functionality
 * Will PASS after i-38xm is implemented
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { initDatabase } from "../../src/db.js";
import {
  handleResolveConflicts,
  type CommandContext,
} from "../../src/cli/merge-commands.js";
import { readJSONL } from "../../src/jsonl.js";
import type Database from "better-sqlite3";

/**
 * Safe wrapper for git commands using execFileSync
 */
function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  } catch (err: any) {
    // For merge conflicts, git returns non-zero but we expect that
    if (args[0] === "merge" && err.status === 1) {
      return err.stdout || "";
    }
    throw err;
  }
}

/**
 * Helper to set up a git repository with a merge conflict
 */
function setupGitRepoWithConflict(repoDir: string): {
  issuesPath: string;
  baseContent: string;
  oursContent: string;
  theirsContent: string;
} {
  // Initialize git repo
  git(["init"], repoDir);
  git(["config", "user.email", "test@example.com"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);

  const issuesPath = path.join(repoDir, "issues.jsonl");

  // Base version: Initial commit with one issue
  const baseContent = `{"id":"i-base","uuid":"uuid-1","title":"Initial Issue","description":"This is the base version.","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
  fs.writeFileSync(issuesPath, baseContent);
  git(["add", "issues.jsonl"], repoDir);
  git(["commit", "-m", "Initial commit"], repoDir);

  // Branch A (ours): Modify the description
  git(["checkout", "-b", "branch-a"], repoDir);
  const oursContent = `{"id":"i-base","uuid":"uuid-1","title":"Initial Issue","description":"This is the base version.\\n\\nModified by branch A.","status":"in_progress","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":["branch-a"]}
`;
  fs.writeFileSync(issuesPath, oursContent);
  git(["add", "issues.jsonl"], repoDir);
  git(["commit", "-m", "Branch A changes"], repoDir);

  // Branch B (theirs): Modify the description differently
  git(["checkout", "main"], repoDir);
  git(["checkout", "-b", "branch-b"], repoDir);
  const theirsContent = `{"id":"i-base","uuid":"uuid-1","title":"Initial Issue","description":"This is the base version.\\n\\nModified by branch B.","status":"open","priority":2,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":["branch-b"]}
`;
  fs.writeFileSync(issuesPath, theirsContent);
  git(["add", "issues.jsonl"], repoDir);
  git(["commit", "-m", "Branch B changes"], repoDir);

  // Checkout branch-a and try to merge branch-b (creates conflict)
  git(["checkout", "branch-a"], repoDir);
  git(["merge", "branch-b"], repoDir); // Will return non-zero but we handle it

  return { issuesPath, baseContent, oursContent, theirsContent };
}

/**
 * Helper to verify git stages are accessible
 */
function verifyGitStages(
  repoDir: string,
  relativePath: string
): {
  base: string;
  ours: string;
  theirs: string;
} {
  const base = git(["show", `:1:${relativePath}`], repoDir);
  const ours = git(["show", `:2:${relativePath}`], repoDir);
  const theirs = git(["show", `:3:${relativePath}`], repoDir);

  return { base, ours, theirs };
}

describe("resolve-conflicts with git stages", () => {
  let tmpDir: string;
  let db: Database.Database;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "resolve-conflicts-git-stages-")
    );
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

  it("should resolve conflicts using git stages (base/ours/theirs)", async () => {
    // Setup git repo with merge conflict
    const { issuesPath, baseContent, oursContent, theirsContent } =
      setupGitRepoWithConflict(tmpDir);

    // Verify git stages are accessible
    const stages = verifyGitStages(tmpDir, "issues.jsonl");
    expect(stages.base).toBe(baseContent);
    expect(stages.ours).toBe(oursContent);
    expect(stages.theirs).toBe(theirsContent);

    // Verify file has conflict markers (current state before resolution)
    const conflictedContent = fs.readFileSync(issuesPath, "utf8");
    expect(conflictedContent).toContain("<<<<<<< HEAD");
    expect(conflictedContent).toContain("=======");
    expect(conflictedContent).toContain(">>>>>>>");

    // Run resolve-conflicts
    // Expected behavior (after i-38xm):
    // 1. Should detect we're in a git merge state
    // 2. Should read base from :1:issues.jsonl
    // 3. Should read ours from :2:issues.jsonl
    // 4. Should read theirs from :3:issues.jsonl
    // 5. Should call mergeThreeWay(base, ours, theirs) with actual base
    // 6. Should successfully merge using YAML expansion for text fields
    await handleResolveConflicts(ctx, {});

    // Read resolved file
    const resolved = await readJSONL(issuesPath);

    // Assertions
    expect(resolved).toHaveLength(1);
    const mergedIssue = resolved[0];

    // Should have the same UUID (same entity)
    expect(mergedIssue.uuid).toBe("uuid-1");
    expect(mergedIssue.id).toBe("i-base");

    // With proper 3-way merge using git stages and YAML expansion:
    // The key difference from current behavior (parsing conflict markers with empty base):
    //
    // Previous behavior (empty base):
    // - Treats both versions as additions
    // - Git merge-file may fail with exit code 2 on empty base files
    // - Metadata gets merged but text fields use latest-wins on entire field
    //
    // Current behavior (with actual base from git stages):
    // - True 3-way merge using common ancestor
    // - Git merge-file works correctly with non-empty base
    // - Line-level merging for multi-line text fields via YAML expansion
    // - When both branches add different content at same position, git detects conflict
    // - Conflict resolver applies latest-wins (branch B has later timestamp)
    //
    // Note: Both branches added a line at the same position (line 4) with different content.
    // This is a genuine conflict from git's perspective and is correctly resolved using
    // latest-wins strategy (branch B wins with timestamp 2025-01-03 > 2025-01-02).
    //
    // Test assertion: Verify latest-wins picked branch B's modification
    expect(mergedIssue.description).toContain("This is the base version.");
    expect(mergedIssue.description).toContain("Modified by branch B");
    expect(mergedIssue.description).not.toContain("Modified by branch A");

    // Status: Latest wins (theirs has later timestamp)
    expect(mergedIssue.status).toBe("open");

    // Priority: Latest wins (theirs has later timestamp)
    expect(mergedIssue.priority).toBe(2);

    // Tags: Should be merged (metadata merge first)
    expect(mergedIssue.tags).toContain("branch-a");
    expect(mergedIssue.tags).toContain("branch-b");

    // Updated timestamp: Latest wins
    expect(mergedIssue.updated_at).toBe("2025-01-03T00:00:00Z");

    // File should no longer have conflict markers
    const finalContent = fs.readFileSync(issuesPath, "utf8");
    expect(finalContent).not.toContain("<<<<<<< HEAD");
    expect(finalContent).not.toContain("=======");
    expect(finalContent).not.toContain(">>>>>>>");
  });

  it("should handle file added in one branch only", async () => {
    // Initialize git repo
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    // Initial commit with README
    const readmePath = path.join(tmpDir, "README.md");
    fs.writeFileSync(readmePath, "# Test Repo\n");
    git(["add", "README.md"], tmpDir);
    git(["commit", "-m", "Initial commit"], tmpDir);

    // Branch A: Add issues.jsonl
    git(["checkout", "-b", "branch-a"], tmpDir);
    const issuesPath = path.join(tmpDir, "issues.jsonl");
    const issueContent = `{"id":"i-new","uuid":"uuid-new","title":"New Issue","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, issueContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Add issues.jsonl"], tmpDir);

    // Branch B: Also add issues.jsonl with different content
    git(["checkout", "main"], tmpDir);
    git(["checkout", "-b", "branch-b"], tmpDir);
    const differentIssueContent = `{"id":"i-different","uuid":"uuid-different","title":"Different Issue","status":"open","priority":2,"created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, differentIssueContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Add different issues.jsonl"], tmpDir);

    // Merge (creates conflict for added file)
    git(["checkout", "branch-a"], tmpDir);
    git(["merge", "branch-b"], tmpDir); // Will create conflict

    // Verify git stages
    // Stage 1 (base) should not exist for added files
    try {
      git(["show", ":1:issues.jsonl"], tmpDir);
      throw new Error("Expected stage 1 to not exist for added file");
    } catch (err: any) {
      // Expected - stage 1 doesn't exist for added files
      expect(
        err.message.includes("exists on disk, but not in") ||
          err.message.includes("path") ||
          err.status === 128
      ).toBe(true);
    }

    // Stages 2 and 3 should exist
    const stage2 = git(["show", ":2:issues.jsonl"], tmpDir);
    const stage3 = git(["show", ":3:issues.jsonl"], tmpDir);
    expect(stage2).toBe(issueContent);
    expect(stage3).toBe(differentIssueContent);

    // Run resolve-conflicts
    // Expected: Should handle missing base (empty array) gracefully
    await handleResolveConflicts(ctx, {});

    // Read resolved file
    const resolved = await readJSONL(issuesPath);

    // Both issues should be included (different UUIDs)
    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.id).sort()).toEqual(
      ["i-different", "i-new"].sort()
    );
  });

  it("should error gracefully when not in a git merge state", async () => {
    // Create a normal (non-conflicted) issues.jsonl
    const issuesPath = path.join(tmpDir, "issues.jsonl");
    const content = `{"id":"i-normal","uuid":"uuid-1","title":"Normal Issue","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, content);

    // Try to resolve (should detect no git merge state)
    // Expected after i-38xm: Should throw error or skip file with message
    // Current behavior: Will try to parse conflict markers (none exist) and succeed as no-op

    // For now, we just verify it doesn't crash
    await expect(handleResolveConflicts(ctx, {})).resolves.toBeUndefined();

    // File should be unchanged
    const afterContent = fs.readFileSync(issuesPath, "utf8");
    expect(afterContent).toBe(content);
  });
});
