/**
 * Integration test for resolve-conflicts using git stages
 *
 * This test verifies that resolve-conflicts correctly uses git stages
 * (base/ours/theirs) from the git index for proper three-way merging.
 *
 * Key behaviors tested:
 * - Reading base/ours/theirs from git index stages (:1:, :2:, :3:)
 * - Performing true 3-way merge with actual base (not empty array)
 * - Handling missing base stage (file added in both branches)
 * - Graceful handling when not in a git merge state
 *
 * Note: Tests run in isolated temporary directories and do not affect
 * the user's active git repository.
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
    // Expected behavior:
    // 1. Detects we're in a git merge state
    // 2. Reads base from :1:issues.jsonl
    // 3. Reads ours from :2:issues.jsonl
    // 4. Reads theirs from :3:issues.jsonl
    // 5. Calls mergeThreeWay(base, ours, theirs) with actual base
    // 6. Merges using YAML expansion for text fields
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

  it("should handle file added in both branches (missing base stage)", async () => {
    // Initialize git repo
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    // Initial commit with README (no issues.jsonl yet)
    const readmePath = path.join(tmpDir, "README.md");
    fs.writeFileSync(readmePath, "# Test Repo\n");
    git(["add", "README.md"], tmpDir);
    git(["commit", "-m", "Initial commit"], tmpDir);

    // Branch A: Add issues.jsonl with one issue
    git(["checkout", "-b", "branch-a"], tmpDir);
    const issuesPath = path.join(tmpDir, "issues.jsonl");
    const issueContent = `{"id":"i-new","uuid":"uuid-new","title":"New Issue","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, issueContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Add issues.jsonl"], tmpDir);

    // Branch B: Add issues.jsonl with different issue
    git(["checkout", "main"], tmpDir);
    git(["checkout", "-b", "branch-b"], tmpDir);
    const differentIssueContent = `{"id":"i-different","uuid":"uuid-different","title":"Different Issue","status":"open","priority":2,"created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, differentIssueContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Add different issues.jsonl"], tmpDir);

    // Merge branch-b into branch-a (creates conflict)
    git(["checkout", "branch-a"], tmpDir);
    git(["merge", "branch-b"], tmpDir);

    // Verify git stages - base stage doesn't exist for files added in both branches
    try {
      git(["show", ":1:issues.jsonl"], tmpDir);
      throw new Error("Expected stage 1 to not exist for added file");
    } catch (err: any) {
      // Expected - stage 1 (base) doesn't exist
      expect(
        err.message.includes("exists on disk, but not in") ||
          err.message.includes("path") ||
          err.status === 128
      ).toBe(true);
    }

    // Stages 2 (ours) and 3 (theirs) should exist
    const stage2 = git(["show", ":2:issues.jsonl"], tmpDir);
    const stage3 = git(["show", ":3:issues.jsonl"], tmpDir);
    expect(stage2).toBe(issueContent);
    expect(stage3).toBe(differentIssueContent);

    // Run resolve-conflicts
    // Should handle missing base gracefully by using empty array
    await handleResolveConflicts(ctx, {});

    // Read resolved file
    const resolved = await readJSONL(issuesPath);

    // Both issues should be included (different UUIDs, simulated 3-way merge)
    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.id).sort()).toEqual(
      ["i-different", "i-new"].sort()
    );
  });

  it("should merge non-overlapping edits to different paragraphs via YAML expansion", async () => {
    // This test demonstrates the KEY VALUE of YAML expansion:
    // When two branches edit DIFFERENT paragraphs of the same multi-line field,
    // YAML line-level merging should preserve both edits.

    // Initialize git repo
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    const issuesPath = path.join(tmpDir, "issues.jsonl");

    // Base version: Multi-paragraph description
    const baseContent = `{"id":"i-doc","uuid":"uuid-doc","title":"Documentation","description":"## Overview\\n\\nThis is the overview paragraph.\\n\\n## Details\\n\\nThis is the details paragraph.\\n\\n## Conclusion\\n\\nThis is the conclusion paragraph.","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, baseContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Initial commit"], tmpDir);

    // Branch A: Edit ONLY the overview paragraph (line 3)
    git(["checkout", "-b", "branch-a"], tmpDir);
    const oursContent = `{"id":"i-doc","uuid":"uuid-doc","title":"Documentation","description":"## Overview\\n\\nThis is the UPDATED overview paragraph from branch A.\\n\\n## Details\\n\\nThis is the details paragraph.\\n\\n## Conclusion\\n\\nThis is the conclusion paragraph.","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, oursContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Update overview"], tmpDir);

    // Branch B: Edit ONLY the conclusion paragraph (line 9)
    git(["checkout", "main"], tmpDir);
    git(["checkout", "-b", "branch-b"], tmpDir);
    const theirsContent = `{"id":"i-doc","uuid":"uuid-doc","title":"Documentation","description":"## Overview\\n\\nThis is the overview paragraph.\\n\\n## Details\\n\\nThis is the details paragraph.\\n\\n## Conclusion\\n\\nThis is the UPDATED conclusion paragraph from branch B.","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, theirsContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Update conclusion"], tmpDir);

    // Merge branch-b into branch-a
    git(["checkout", "branch-a"], tmpDir);
    git(["merge", "branch-b"], tmpDir);

    // Verify git stages exist
    const stages = verifyGitStages(tmpDir, "issues.jsonl");
    expect(stages.base).toBe(baseContent);
    expect(stages.ours).toBe(oursContent);
    expect(stages.theirs).toBe(theirsContent);

    // Run resolve-conflicts
    await handleResolveConflicts(ctx, {});

    // Read resolved file
    const resolved = await readJSONL(issuesPath);
    expect(resolved).toHaveLength(1);

    const mergedIssue = resolved[0];

    // THE KEY ASSERTION: YAML expansion enables line-level merging
    // Both edits should be preserved because they're on different lines:
    // - Branch A's edit to overview (line 3)
    // - Branch B's edit to conclusion (line 9)
    //
    // With YAML expansion, git sees these as non-overlapping changes
    // and auto-merges them without conflicts.
    expect(mergedIssue.description).toContain("UPDATED overview paragraph from branch A");
    expect(mergedIssue.description).toContain("UPDATED conclusion paragraph from branch B");
    expect(mergedIssue.description).toContain("## Details"); // Unchanged section preserved

    // Verify no conflict markers remain
    const finalContent = fs.readFileSync(issuesPath, "utf8");
    expect(finalContent).not.toContain("<<<<<<< HEAD");
    expect(finalContent).not.toContain("=======");
    expect(finalContent).not.toContain(">>>>>>>");
  });

  it("should handle non-conflicted files gracefully", async () => {
    // Create a normal (non-conflicted) issues.jsonl file
    const issuesPath = path.join(tmpDir, "issues.jsonl");
    const content = `{"id":"i-normal","uuid":"uuid-1","title":"Normal Issue","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, content);

    // Run resolve-conflicts on non-conflicted file
    // Should complete successfully as a no-op
    await expect(handleResolveConflicts(ctx, {})).resolves.toBeUndefined();

    // File should be unchanged
    const afterContent = fs.readFileSync(issuesPath, "utf8");
    expect(afterContent).toBe(content);
  });

  it("should NOT delete file content when run on non-conflicted file in git repo", async () => {
    // This is the CRITICAL data loss bug test
    // Previously, running resolve-conflicts on a non-conflicted file would:
    // 1. tryGetGitStages() returns { base: [], ours: [], theirs: [] } (not null!)
    // 2. mergeThreeWay([], [], []) produces empty result
    // 3. Empty result gets written to file → DATA LOSS

    // Initialize git repo
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    const issuesPath = path.join(tmpDir, "issues.jsonl");

    // Create a normal issues.jsonl with important data
    const importantData = `{"id":"i-important","uuid":"uuid-important","title":"Critical Data","description":"This data must NOT be lost!","status":"open","priority":0,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":["critical","production"]}
`;
    fs.writeFileSync(issuesPath, importantData);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Add important data"], tmpDir);

    // Verify file is NOT in conflict state
    const output = execFileSync("git", ["ls-files", "-u", "issues.jsonl"], {
      cwd: tmpDir,
      encoding: "utf8",
    });
    expect(output.trim()).toBe(""); // No unmerged entries

    // Run resolve-conflicts (should be a no-op)
    await handleResolveConflicts(ctx, {});

    // CRITICAL ASSERTION: File content must be preserved
    const afterContent = fs.readFileSync(issuesPath, "utf8");
    expect(afterContent).toBe(importantData);
    expect(afterContent).toContain("Critical Data");
    expect(afterContent).toContain("This data must NOT be lost!");
    expect(afterContent.length).toBeGreaterThan(0);
  });

  it("should NOT delete file content when run on already-resolved file", async () => {
    // Test the scenario where conflicts existed but were already resolved
    // Running resolve-conflicts again should NOT delete the resolved data

    // Setup git repo with merge that was already resolved
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    const issuesPath = path.join(tmpDir, "issues.jsonl");

    // Base version
    const baseContent = `{"id":"i-resolved","uuid":"uuid-1","title":"Resolved Issue","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, baseContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Initial commit"], tmpDir);

    // Branch A
    git(["checkout", "-b", "branch-a"], tmpDir);
    const branchAContent = `{"id":"i-resolved","uuid":"uuid-1","title":"Resolved Issue","description":"Modified by A","status":"in_progress","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":["branch-a"]}
`;
    fs.writeFileSync(issuesPath, branchAContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Branch A changes"], tmpDir);

    // Branch B
    git(["checkout", "main"], tmpDir);
    git(["checkout", "-b", "branch-b"], tmpDir);
    const branchBContent = `{"id":"i-resolved","uuid":"uuid-1","title":"Resolved Issue","description":"Modified by B","status":"open","priority":2,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":["branch-b"]}
`;
    fs.writeFileSync(issuesPath, branchBContent);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Branch B changes"], tmpDir);

    // Merge and create conflict
    git(["checkout", "branch-a"], tmpDir);
    git(["merge", "branch-b"], tmpDir); // Creates conflict

    // Manually resolve the conflict (simulating user resolution)
    const manuallyResolvedContent = `{"id":"i-resolved","uuid":"uuid-1","title":"Resolved Issue","description":"Manually merged A and B","status":"in_progress","priority":2,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":["branch-a","branch-b"]}
`;
    fs.writeFileSync(issuesPath, manuallyResolvedContent);

    // Mark as resolved with git add
    git(["add", "issues.jsonl"], tmpDir);

    // Verify file is no longer in conflict state (no unmerged entries)
    const output = execFileSync("git", ["ls-files", "-u", "issues.jsonl"], {
      cwd: tmpDir,
      encoding: "utf8",
    });
    expect(output.trim()).toBe(""); // No unmerged entries after git add

    // Run resolve-conflicts (should be a no-op since already resolved)
    await handleResolveConflicts(ctx, {});

    // CRITICAL ASSERTION: Manually resolved content must be preserved
    const afterContent = fs.readFileSync(issuesPath, "utf8");
    expect(afterContent).toBe(manuallyResolvedContent);
    expect(afterContent).toContain("Manually merged A and B");
    expect(afterContent.length).toBeGreaterThan(0);
  });

  it("should NOT delete file content when run on file that never had conflicts", async () => {
    // Test running resolve-conflicts on a file that was never in conflict

    // Initialize git repo
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    const issuesPath = path.join(tmpDir, "issues.jsonl");

    // Create and commit issues.jsonl (never had conflicts)
    const cleanData = `{"id":"i-clean","uuid":"uuid-clean","title":"Clean Issue","description":"Never been in conflict","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, cleanData);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Add clean file"], tmpDir);

    // Run resolve-conflicts
    await handleResolveConflicts(ctx, {});

    // CRITICAL ASSERTION: Clean data must be preserved
    const afterContent = fs.readFileSync(issuesPath, "utf8");
    expect(afterContent).toBe(cleanData);
    expect(afterContent).toContain("Never been in conflict");
    expect(afterContent.length).toBeGreaterThan(0);
  });

  it("should handle partial conflicts (only one JSONL file in conflict)", async () => {
    // Test scenario where issues.jsonl has conflict but specs.jsonl doesn't
    // Previously this could delete specs.jsonl content

    // Setup git repo with conflict in issues.jsonl only
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    const issuesPath = path.join(tmpDir, "issues.jsonl");
    const specsPath = path.join(tmpDir, "specs.jsonl");

    // Initial commit with both files
    const issuesBase = `{"id":"i-1","uuid":"uuid-1","title":"Issue","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    const specsBase = `{"id":"s-1","uuid":"uuid-s1","title":"Important Spec","description":"This spec must be preserved!","file_path":".sudocode/specs/s-1.md","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, issuesBase);
    fs.writeFileSync(specsPath, specsBase);
    git(["add", "."], tmpDir);
    git(["commit", "-m", "Initial commit"], tmpDir);

    // Branch A: Only modify issues.jsonl
    git(["checkout", "-b", "branch-a"], tmpDir);
    const issuesA = `{"id":"i-1","uuid":"uuid-1","title":"Issue","description":"Modified by A","status":"in_progress","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, issuesA);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Modify issues only"], tmpDir);

    // Branch B: Only modify issues.jsonl (differently)
    git(["checkout", "main"], tmpDir);
    git(["checkout", "-b", "branch-b"], tmpDir);
    const issuesB = `{"id":"i-1","uuid":"uuid-1","title":"Issue","description":"Modified by B","status":"open","priority":2,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
`;
    fs.writeFileSync(issuesPath, issuesB);
    git(["add", "issues.jsonl"], tmpDir);
    git(["commit", "-m", "Modify issues differently"], tmpDir);

    // Merge (creates conflict in issues.jsonl only)
    git(["checkout", "branch-a"], tmpDir);
    git(["merge", "branch-b"], tmpDir);

    // Verify only issues.jsonl is in conflict
    const issuesConflict = execFileSync(
      "git",
      ["ls-files", "-u", "issues.jsonl"],
      { cwd: tmpDir, encoding: "utf8" }
    );
    const specsConflict = execFileSync(
      "git",
      ["ls-files", "-u", "specs.jsonl"],
      { cwd: tmpDir, encoding: "utf8" }
    );
    expect(issuesConflict.trim().length).toBeGreaterThan(0); // Has conflict
    expect(specsConflict.trim()).toBe(""); // No conflict

    // Run resolve-conflicts
    await handleResolveConflicts(ctx, {});

    // CRITICAL ASSERTION: specs.jsonl must be preserved (it wasn't in conflict)
    const specsAfter = fs.readFileSync(specsPath, "utf8");
    expect(specsAfter).toBe(specsBase);
    expect(specsAfter).toContain("This spec must be preserved!");
    expect(specsAfter.length).toBeGreaterThan(0);

    // issues.jsonl should be resolved
    const issuesAfter = fs.readFileSync(issuesPath, "utf8");
    expect(issuesAfter).not.toContain("<<<<<<< HEAD");
    expect(issuesAfter.length).toBeGreaterThan(0);
  });

  it("should ignore conflicts in non-JSONL files", async () => {
    // Test that resolve-conflicts only handles issues.jsonl and specs.jsonl
    // and doesn't try to resolve conflicts in other files like README.md

    // Setup git repo with conflicts in both JSONL and non-JSONL files
    git(["init"], tmpDir);
    git(["config", "user.email", "test@example.com"], tmpDir);
    git(["config", "user.name", "Test User"], tmpDir);

    const issuesPath = path.join(tmpDir, "issues.jsonl");
    const readmePath = path.join(tmpDir, "README.md");

    // Initial commit with both files
    const issuesBase = `{"id":"i-1","uuid":"uuid-1","title":"Issue","status":"open","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
`;
    const readmeBase = "# Project\n\nBase content.\n";
    fs.writeFileSync(issuesPath, issuesBase);
    fs.writeFileSync(readmePath, readmeBase);
    git(["add", "."], tmpDir);
    git(["commit", "-m", "Initial commit"], tmpDir);

    // Branch A: Modify both files
    git(["checkout", "-b", "branch-a"], tmpDir);
    const issuesA = `{"id":"i-1","uuid":"uuid-1","title":"Issue","description":"Modified by A","status":"in_progress","priority":1,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
`;
    const readmeA = "# Project\n\nModified by branch A.\n";
    fs.writeFileSync(issuesPath, issuesA);
    fs.writeFileSync(readmePath, readmeA);
    git(["add", "."], tmpDir);
    git(["commit", "-m", "Modify both files"], tmpDir);

    // Branch B: Modify both files differently
    git(["checkout", "main"], tmpDir);
    git(["checkout", "-b", "branch-b"], tmpDir);
    const issuesB = `{"id":"i-1","uuid":"uuid-1","title":"Issue","description":"Modified by B","status":"open","priority":2,"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
`;
    const readmeB = "# Project\n\nModified by branch B.\n";
    fs.writeFileSync(issuesPath, issuesB);
    fs.writeFileSync(readmePath, readmeB);
    git(["add", "."], tmpDir);
    git(["commit", "-m", "Modify both files differently"], tmpDir);

    // Merge (creates conflicts in both files)
    git(["checkout", "branch-a"], tmpDir);
    git(["merge", "branch-b"], tmpDir);

    // Verify both files are in conflict
    const issuesConflict = execFileSync(
      "git",
      ["ls-files", "-u", "issues.jsonl"],
      { cwd: tmpDir, encoding: "utf8" }
    );
    const readmeConflict = execFileSync(
      "git",
      ["ls-files", "-u", "README.md"],
      { cwd: tmpDir, encoding: "utf8" }
    );
    expect(issuesConflict.trim().length).toBeGreaterThan(0); // Has conflict
    expect(readmeConflict.trim().length).toBeGreaterThan(0); // Has conflict

    // Run resolve-conflicts (should only resolve issues.jsonl)
    await handleResolveConflicts(ctx, {});

    // issues.jsonl should be resolved
    const issuesAfter = fs.readFileSync(issuesPath, "utf8");
    expect(issuesAfter).not.toContain("<<<<<<< HEAD");
    expect(issuesAfter.length).toBeGreaterThan(0);

    // README.md should STILL have conflict markers (not touched by resolve-conflicts)
    const readmeAfter = fs.readFileSync(readmePath, "utf8");
    expect(readmeAfter).toContain("<<<<<<< HEAD");
    expect(readmeAfter).toContain("=======");
    expect(readmeAfter).toContain(">>>>>>>");

    // Verify README.md is still in git conflict state
    const readmeStillConflicted = execFileSync(
      "git",
      ["ls-files", "-u", "README.md"],
      { cwd: tmpDir, encoding: "utf8" }
    );
    expect(readmeStillConflicted.trim().length).toBeGreaterThan(0);
  });
});
