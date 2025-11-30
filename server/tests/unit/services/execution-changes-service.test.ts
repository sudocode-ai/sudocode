/**
 * Tests for ExecutionChangesService
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionChangesService } from "../../../src/services/execution-changes-service.js";
import { createTestDatabase } from "../../integration/execution/helpers/test-setup.js";
import {
  createTestRepo,
  cleanupTestRepo,
  commitFile,
} from "../../integration/execution/helpers/git-test-utils.js";
import type Database from "better-sqlite3";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

describe("ExecutionChangesService", () => {
  let db: Database.Database;
  let testRepo: string;
  let service: ExecutionChangesService;

  beforeEach(() => {
    // Create test database
    db = createTestDatabase();

    // Create test git repository
    testRepo = createTestRepo();

    // Create service
    service = new ExecutionChangesService(db, testRepo);
  });

  afterEach(() => {
    if (testRepo) {
      cleanupTestRepo(testRepo);
    }
    if (db) {
      db.close();
    }
  });

  describe("getChanges - Scenario A: Committed Changes", () => {
    it("should calculate committed changes between two commits", async () => {
      // Create execution with commits
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make some changes
      commitFile(testRepo, "file1.ts", "console.log('hello');", "Add file1");
      commitFile(testRepo, "file2.ts", "const x = 1;\nconst y = 2;", "Add file2");

      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution in database
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-1", "claude-code", "main", "main", "completed", beforeCommit, afterCommit);

      // Get changes
      const result = await service.getChanges("exec-1");

      // Assertions
      expect(result.available).toBe(true);
      expect(result.uncommitted).toBe(false);
      expect(result.commitRange).toEqual({
        before: beforeCommit,
        after: afterCommit,
      });
      expect(result.changes).toBeDefined();
      expect(result.changes!.files).toHaveLength(2);
      expect(result.changes!.summary.totalFiles).toBe(2);
      expect(result.changes!.summary.totalAdditions).toBeGreaterThan(0);
      expect(result.changes!.summary.totalDeletions).toBe(0);

      // Check file details
      const file1 = result.changes!.files.find((f) => f.path === "file1.ts");
      expect(file1).toBeDefined();
      expect(file1!.status).toBe("A"); // Added
      expect(file1!.additions).toBe(1);
      expect(file1!.deletions).toBe(0);

      const file2 = result.changes!.files.find((f) => f.path === "file2.ts");
      expect(file2).toBeDefined();
      expect(file2!.status).toBe("A"); // Added
      expect(file2!.additions).toBe(2);
      expect(file2!.deletions).toBe(0);
    });

    it("should handle modified files", async () => {
      // Create initial file
      commitFile(testRepo, "existing.ts", "line 1\nline 2\nline 3", "Initial");
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Modify file (remove 1 line, add 2 lines)
      commitFile(testRepo, "existing.ts", "line 1\nline 2 modified\nline 3\nline 4", "Modify");
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-2", "claude-code", "main", "main", "completed", beforeCommit, afterCommit);

      // Get changes
      const result = await service.getChanges("exec-2");

      expect(result.available).toBe(true);
      expect(result.changes!.files).toHaveLength(1);

      const file = result.changes!.files[0];
      expect(file.path).toBe("existing.ts");
      expect(file.status).toBe("M"); // Modified
      expect(file.additions).toBeGreaterThan(0);
      expect(file.deletions).toBeGreaterThan(0);
    });

    it("should handle deleted files", async () => {
      // Create and delete a file
      commitFile(testRepo, "to-delete.ts", "content", "Add file");
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Delete file
      fs.unlinkSync(path.join(testRepo, "to-delete.ts"));
      execSync("git add to-delete.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Delete file"', { cwd: testRepo, stdio: "pipe" });

      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-3", "claude-code", "main", "main", "completed", beforeCommit, afterCommit);

      // Get changes
      const result = await service.getChanges("exec-3");

      expect(result.available).toBe(true);
      expect(result.changes!.files).toHaveLength(1);

      const file = result.changes!.files[0];
      expect(file.path).toBe("to-delete.ts");
      expect(file.status).toBe("D"); // Deleted
      expect(file.additions).toBe(0);
      expect(file.deletions).toBeGreaterThan(0);
    });

    it("should handle binary files", async () => {
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Add a binary file (PNG-like header)
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      fs.writeFileSync(path.join(testRepo, "image.png"), binaryContent);
      execSync("git add image.png", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add binary"', { cwd: testRepo, stdio: "pipe" });

      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-4", "claude-code", "main", "main", "completed", beforeCommit, afterCommit);

      // Get changes
      const result = await service.getChanges("exec-4");

      expect(result.available).toBe(true);
      expect(result.changes!.files).toHaveLength(1);

      const file = result.changes!.files[0];
      expect(file.path).toBe("image.png");
      expect(file.status).toBe("A");
      // Binary files are handled (exact stats depend on git's binary detection)
      expect(file.additions).toBeGreaterThanOrEqual(0);
      expect(file.deletions).toBe(0);
    });
  });

  describe("getChanges - Scenario B: Uncommitted Changes", () => {
    it("should calculate uncommitted changes in working tree", async () => {
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make uncommitted changes
      fs.writeFileSync(path.join(testRepo, "uncommitted.ts"), "const x = 1;");
      execSync("git add uncommitted.ts", { cwd: testRepo, stdio: "pipe" });

      // Create execution without after_commit
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("exec-5", "claude-code", "main", "main", "completed", beforeCommit);

      // Get changes
      const result = await service.getChanges("exec-5");

      expect(result.available).toBe(true);
      expect(result.uncommitted).toBe(true);
      expect(result.commitRange).toBeNull();
      expect(result.changes!.files).toHaveLength(1);
      expect(result.changes!.files[0].path).toBe("uncommitted.ts");
      expect(result.changes!.files[0].status).toBe("A");
    });

    it("should handle after_commit == before_commit as uncommitted", async () => {
      const commit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make uncommitted changes
      fs.writeFileSync(path.join(testRepo, "test.ts"), "const y = 2;");
      execSync("git add test.ts", { cwd: testRepo, stdio: "pipe" });

      // Create execution with same before and after commit
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-6", "claude-code", "main", "main", "completed", commit, commit);

      // Get changes
      const result = await service.getChanges("exec-6");

      expect(result.available).toBe(true);
      expect(result.uncommitted).toBe(true);
      expect(result.commitRange).toBeNull();
      expect(result.changes!.files.length).toBeGreaterThan(0);
    });
  });

  describe("getChanges - Scenario C: No Changes", () => {
    it("should return empty changes when no modifications", async () => {
      const commit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution without any changes
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-7", "claude-code", "main", "main", "completed", commit, commit);

      // Get changes
      const result = await service.getChanges("exec-7");

      expect(result.available).toBe(true);
      expect(result.uncommitted).toBe(true);
      expect(result.changes!.files).toHaveLength(0);
      expect(result.changes!.summary.totalFiles).toBe(0);
      expect(result.changes!.summary.totalAdditions).toBe(0);
      expect(result.changes!.summary.totalDeletions).toBe(0);
    });
  });

  describe("getChanges - Error Cases", () => {
    it("should return unavailable for non-existent execution", async () => {
      const result = await service.getChanges("nonexistent");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("incomplete_execution");
    });

    it("should return unavailable for incomplete execution (running)", async () => {
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("exec-8", "claude-code", "main", "main", "running", "abc123");

      const result = await service.getChanges("exec-8");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("incomplete_execution");
    });

    it("should return unavailable when before_commit is missing", async () => {
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status)
        VALUES (?, ?, ?, ?, ?)
      `).run("exec-9", "claude-code", "main", "main", "completed");

      const result = await service.getChanges("exec-9");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("missing_commits");
    });

    it("should return unavailable when commits not found (garbage collected)", async () => {
      // Create execution with fake commit SHAs
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-10", "claude-code", "main", "main", "completed", "0".repeat(40), "1".repeat(40));

      const result = await service.getChanges("exec-10");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("commits_not_found");
    });

    it("should return unavailable when worktree deleted with uncommitted changes", async () => {
      const commit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution with worktree path that doesn't exist
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, worktree_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-11", "claude-code", "main", "main", "completed", commit, "/nonexistent/worktree");

      const result = await service.getChanges("exec-11");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("worktree_deleted_with_uncommitted_changes");
    });
  });

  describe("Summary Calculation", () => {
    it("should correctly sum up statistics", async () => {
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create multiple files with different stats
      commitFile(testRepo, "file1.ts", "line1\nline2\nline3", "Add file1");
      commitFile(testRepo, "file2.ts", "a\nb\nc\nd\ne", "Add file2");
      commitFile(testRepo, "file3.ts", "x", "Add file3");

      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-12", "claude-code", "main", "main", "completed", beforeCommit, afterCommit);

      const result = await service.getChanges("exec-12");

      expect(result.available).toBe(true);
      expect(result.changes!.summary.totalFiles).toBe(3);
      expect(result.changes!.summary.totalAdditions).toBe(9); // 3 + 5 + 1
      expect(result.changes!.summary.totalDeletions).toBe(0);
    });
  });

  describe("Deleted Resources", () => {
    it("should handle deleted branch gracefully", async () => {
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make a commit
      commitFile(testRepo, "file1.ts", "content", "Add file");
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution with branch that doesn't exist
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("exec-13", "claude-code", "main", "deleted-branch", "completed", beforeCommit, afterCommit);

      const result = await service.getChanges("exec-13");

      // Should still show captured changes
      expect(result.available).toBe(true);
      expect(result.captured).toBeDefined();
      expect(result.branchName).toBe("deleted-branch");
      expect(result.branchExists).toBe(false);
      expect(result.current).toBeUndefined(); // No current state since branch is deleted
    });

    it("should track worktree existence", async () => {
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make a commit to have different before and after
      commitFile(testRepo, "file1.ts", "content", "Add file");
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution with worktree path that doesn't exist
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit, worktree_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("exec-14", "claude-code", "main", "main", "completed", beforeCommit, afterCommit, "/nonexistent/worktree");

      const result = await service.getChanges("exec-14");

      expect(result.worktreeExists).toBe(false);
    });

    it("should calculate current state from main repo when worktree is deleted", async () => {
      // Create a test branch
      execSync("git checkout -b test-branch", { cwd: testRepo, stdio: "pipe" });

      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make a commit on the branch
      commitFile(testRepo, "file1.ts", "content", "Add file");
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make additional commit
      commitFile(testRepo, "file2.ts", "more content", "Add another file");
      const currentHead = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Switch back to main
      execSync("git checkout main", { cwd: testRepo, stdio: "pipe" });

      // Create execution with deleted worktree
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit, worktree_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("exec-15", "claude-code", "main", "test-branch", "completed", beforeCommit, afterCommit, "/nonexistent/worktree");

      const result = await service.getChanges("exec-15");

      // Should calculate current state from main repo
      expect(result.available).toBe(true);
      expect(result.worktreeExists).toBe(false);
      expect(result.branchExists).toBe(true);
      expect(result.branchName).toBe("test-branch");

      // Should have both captured and current states
      expect(result.captured).toBeDefined();
      expect(result.captured!.files).toHaveLength(1); // Only file1.ts at completion time

      expect(result.current).toBeDefined();
      expect(result.current!.files).toHaveLength(2); // Both file1.ts and file2.ts now
      expect(result.additionalCommits).toBe(1); // One commit since completion
    });

    it("should show only captured state when both branch and worktree are deleted", async () => {
      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make a commit
      commitFile(testRepo, "file1.ts", "content", "Add file");
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Create execution with deleted branch and worktree
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit, worktree_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("exec-16", "claude-code", "main", "deleted-branch", "completed", beforeCommit, afterCommit, "/nonexistent/worktree");

      const result = await service.getChanges("exec-16");

      expect(result.available).toBe(true);
      expect(result.captured).toBeDefined();
      expect(result.branchExists).toBe(false);
      expect(result.worktreeExists).toBe(false);
      expect(result.current).toBeUndefined(); // No current state
      expect(result.additionalCommits).toBe(0);
    });

    it("should use main repo path for branch operations even with deleted worktree", async () => {
      // Create a test branch
      execSync("git checkout -b feature-branch", { cwd: testRepo, stdio: "pipe" });

      const beforeCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Make commits
      commitFile(testRepo, "feature.ts", "feature code", "Add feature");
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf-8",
      }).trim();

      // Switch back to main
      execSync("git checkout main", { cwd: testRepo, stdio: "pipe" });

      // Create execution with non-existent worktree but existing branch
      db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, before_commit, after_commit, worktree_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("exec-17", "claude-code", "main", "feature-branch", "completed", beforeCommit, afterCommit, "/deleted/worktree");

      const result = await service.getChanges("exec-17");

      // Should successfully get changes using main repo path
      expect(result.available).toBe(true);
      expect(result.worktreeExists).toBe(false);
      expect(result.branchExists).toBe(true);
      expect(result.captured).toBeDefined();
      expect(result.captured!.files.some(f => f.path === "feature.ts")).toBe(true);
    });
  });
});
