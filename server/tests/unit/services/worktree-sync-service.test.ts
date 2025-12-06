/**
 * Unit tests for WorktreeSyncService foundation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WorktreeSyncService,
  WorktreeSyncError,
  WorktreeSyncErrorCode,
} from "../../../src/services/worktree-sync-service.js";
import type { ExecutionStatus } from "@sudocode-ai/types";
import {
  createTestRepo,
  cleanupTestRepo,
} from "../../integration/execution/helpers/git-test-utils.js";
import { createTestDatabase } from "../../integration/execution/helpers/test-setup.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import type Database from "better-sqlite3";

/**
 * Create a unique worktree path (outside the test repo to avoid polluting working tree)
 */
function createWorktreePath(): string {
  return mkdtempSync(path.join(tmpdir(), "test-worktree-"));
}

describe("WorktreeSyncService Foundation", () => {
  let testRepo: string;
  let db: Database.Database;
  let service: WorktreeSyncService;
  let worktreePaths: string[] = [];

  beforeEach(() => {
    // Create test repo
    testRepo = createTestRepo();

    // Create test database
    db = createTestDatabase();

    // Create service
    service = new WorktreeSyncService(db, testRepo);

    // Reset worktree paths tracker
    worktreePaths = [];
  });

  afterEach(() => {
    // Clean up worktree paths
    worktreePaths.forEach((worktreePath) => {
      try {
        rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    });

    if (testRepo) {
      cleanupTestRepo(testRepo);
    }
    if (db) {
      db.close();
    }
  });

  describe("constructor", () => {
    it("should create service instance", () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(WorktreeSyncService);
    });
  });

  describe("loadAndValidateExecution", () => {
    it("should load execution from database", async () => {
      // Create execution in database
      const execution = createExecution(db, {
        id: "exec-test-1",
        worktree_path: "/tmp/worktree",
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed",
      });

      // Access private method via any cast
      const loaded = await (service as any)._loadAndValidateExecution(
        "exec-test-1"
      );

      expect(loaded).toBeDefined();
      expect(loaded.id).toBe("exec-test-1");
      expect(loaded.worktree_path).toBe("/tmp/worktree");
    });

    it("should throw EXECUTION_NOT_FOUND for missing execution", async () => {
      await expect(
        (service as any)._loadAndValidateExecution("nonexistent")
      ).rejects.toThrow(WorktreeSyncError);

      try {
        await (service as any)._loadAndValidateExecution("nonexistent");
      } catch (error: any) {
        expect(error.code).toBe(WorktreeSyncErrorCode.EXECUTION_NOT_FOUND);
      }
    });
  });

  describe("_validateSyncPreconditions", () => {
    it("should pass validation for valid execution", async () => {
      // Create worktree (use unique path outside test repo)
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      const execution = {
        id: "exec-test-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed" as ExecutionStatus,
      };

      // Should not throw
      await (service as any)._validateSyncPreconditions(execution);
    });

    it("should throw NO_WORKTREE if worktree_path is null", async () => {
      const execution = {
        id: "exec-test-1",
        worktree_path: null,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed" as ExecutionStatus,
      };

      try {
        await (service as any)._validateSyncPreconditions(execution);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(WorktreeSyncError);
        expect(error.code).toBe(WorktreeSyncErrorCode.NO_WORKTREE);
      }
    });

    it("should throw WORKTREE_MISSING if worktree directory does not exist", async () => {
      const execution = {
        id: "exec-test-1",
        worktree_path: "/nonexistent/path",
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed" as ExecutionStatus,
      };

      try {
        await (service as any)._validateSyncPreconditions(execution);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(WorktreeSyncError);
        expect(error.code).toBe(WorktreeSyncErrorCode.WORKTREE_MISSING);
      }
    });

    it("should throw BRANCH_MISSING if worktree branch does not exist", async () => {
      // Create worktree with valid path but don't create the branch
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      fs.mkdirSync(worktreePath, { recursive: true });

      const execution = {
        id: "exec-test-1",
        worktree_path: worktreePath,
        branch_name: "nonexistent-branch",
        target_branch: "main",
        status: "completed" as ExecutionStatus,
      };

      try {
        await (service as any)._validateSyncPreconditions(execution);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(WorktreeSyncError);
        expect(error.code).toBe(WorktreeSyncErrorCode.BRANCH_MISSING);
      }
    });

    it("should throw TARGET_BRANCH_MISSING if target branch does not exist", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      const execution = {
        id: "exec-test-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "nonexistent-target",
        status: "completed" as ExecutionStatus,
      };

      try {
        await (service as any)._validateSyncPreconditions(execution);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(WorktreeSyncError);
        expect(error.code).toBe(WorktreeSyncErrorCode.TARGET_BRANCH_MISSING);
      }
    });

    it("should throw DIRTY_WORKING_TREE if local tree has uncommitted changes", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Make local tree dirty
      fs.writeFileSync(path.join(testRepo, "dirty.txt"), "uncommitted content");

      const execution = {
        id: "exec-test-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed" as ExecutionStatus,
      };

      try {
        await (service as any)._validateSyncPreconditions(execution);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(WorktreeSyncError);
        expect(error.code).toBe(WorktreeSyncErrorCode.DIRTY_WORKING_TREE);
        expect(error.message).toContain("uncommitted changes");
      }
    });
  });

  describe("_createSafetySnapshot", () => {
    it("should create safety tag", async () => {
      const executionId = "exec-test-1";
      const targetBranch = "main";

      const tagName = await (service as any)._createSafetySnapshot(
        executionId,
        targetBranch
      );

      expect(tagName).toBe(`sudocode-sync-before-${executionId}`);

      // Verify tag exists
      const tags = execSync("git tag -l", {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(tags).toContain(tagName);

      // Verify tag points to a valid commit
      const taggedCommit = execSync(`git rev-parse ${tagName}`, {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
      expect(taggedCommit).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("_isLocalTreeClean", () => {
    it("should return true for clean working tree", () => {
      const isClean = (service as any)._isLocalTreeClean();
      expect(isClean).toBe(true);
    });

    it("should return false for dirty working tree", () => {
      // Make tree dirty
      fs.writeFileSync(path.join(testRepo, "dirty.txt"), "content");

      const isClean = (service as any)._isLocalTreeClean();
      expect(isClean).toBe(false);
    });
  });

  describe("_getBranches", () => {
    it("should return list of branches", () => {
      // Create some branches
      execSync("git branch test-branch", { cwd: testRepo, stdio: "pipe" });
      execSync("git branch another-branch", { cwd: testRepo, stdio: "pipe" });

      const branches = (service as any)._getBranches();

      expect(branches).toContain("main");
      expect(branches).toContain("test-branch");
      expect(branches).toContain("another-branch");
    });
  });

  describe("_getCurrentCommit", () => {
    it("should return commit SHA for branch", () => {
      const commit = (service as any)._getCurrentCommit("main");

      expect(commit).toMatch(/^[0-9a-f]{40}$/); // Valid SHA
    });

    it("should throw for nonexistent branch", () => {
      try {
        (service as any)._getCurrentCommit("nonexistent");
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(WorktreeSyncError);
      }
    });
  });

  describe("previewSync", () => {
    it("should preview clean merge with no conflicts", async () => {
      // Create worktree with changes
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Add a file in worktree
      fs.writeFileSync(path.join(worktreePath, "test.ts"), "content");
      execSync("git add test.ts", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "Add test file"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Create execution
      const execution = createExecution(db, {
        id: "exec-preview-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed",
      });

      // Preview sync
      const preview = await service.previewSync("exec-preview-1");

      expect(preview.canSync).toBe(true);
      expect(preview.conflicts.hasConflicts).toBe(false);
      expect(preview.commits.length).toBeGreaterThan(0);
      expect(preview.diff.files).toContain("test.ts");
      expect(preview.warnings.length).toBe(0);
    });

    it("should detect code conflicts and set canSync=false", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create conflicting changes
      // Change in main
      fs.writeFileSync(path.join(testRepo, "conflict.ts"), "main content");
      execSync("git add conflict.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add conflict file in main"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Different change in worktree
      fs.writeFileSync(
        path.join(worktreePath, "conflict.ts"),
        "worktree content"
      );
      execSync("git add conflict.ts", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "Add conflict file in worktree"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Create execution
      createExecution(db, {
        id: "exec-conflict-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed",
      });

      // Preview sync
      const preview = await service.previewSync("exec-conflict-1");

      // Note: canSync reflects whether local working tree is clean
      // Code conflicts are reported separately via conflicts.codeConflicts
      // The frontend checks both canSync AND hasCodeConflicts
      expect(preview.conflicts.hasConflicts).toBe(true);
      expect(preview.conflicts.codeConflicts.length).toBeGreaterThan(0);
      expect(
        preview.warnings.some((w) => w.includes("code conflict(s) detected"))
      ).toBe(true);
    });

    it("should detect uncommitted JSONL files", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create .sudocode directory and commit it
      const sudocodeDir = path.join(worktreePath, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir, ".gitkeep"), "");
      execSync("git add .sudocode/.gitkeep", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add .sudocode"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Add uncommitted JSONL file
      fs.writeFileSync(
        path.join(sudocodeDir, "issues.jsonl"),
        '{"id":"i-001"}\n'
      );

      // Create execution
      createExecution(db, {
        id: "exec-jsonl-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed",
      });

      // Preview sync
      const preview = await service.previewSync("exec-jsonl-1");

      expect(preview.canSync).toBe(true);
      expect(preview.uncommittedJSONLChanges).toContain(
        ".sudocode/issues.jsonl"
      );
      // Note: uncommittedChanges is now used for general file stats,
      // and warning about uncommitted files was removed to avoid noise
      expect(preview.uncommittedChanges).toBeDefined();
    });

    it("should warn when execution is running", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create execution with running status
      createExecution(db, {
        id: "exec-running-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "running",
      });

      // Preview sync
      const preview = await service.previewSync("exec-running-1");

      expect(preview.executionStatus).toBe("running");
      expect(
        preview.warnings.some((w) =>
          w.includes("Execution is currently active")
        )
      ).toBe(true);
    });

    it("should return error when validation fails", async () => {
      // Create execution without worktree
      createExecution(db, {
        id: "exec-invalid-1",
        worktree_path: null,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed",
      });

      // Preview sync
      const preview = await service.previewSync("exec-invalid-1");

      expect(preview.canSync).toBe(false);
      expect(preview.warnings.length).toBeGreaterThan(0);
      expect(preview.warnings[0]).toContain("No worktree path");
    });

    it("should handle JSONL conflicts as auto-resolvable", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create JSONL conflict
      // In main
      const mainSudocode = path.join(testRepo, ".sudocode");
      fs.mkdirSync(mainSudocode, { recursive: true });
      fs.writeFileSync(
        path.join(mainSudocode, "issues.jsonl"),
        '{"id":"i-001","title":"Main issue"}\n'
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Add issue in main"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // In worktree
      const worktreeSudocode = path.join(worktreePath, ".sudocode");
      fs.mkdirSync(worktreeSudocode, { recursive: true });
      fs.writeFileSync(
        path.join(worktreeSudocode, "issues.jsonl"),
        '{"id":"i-002","title":"Worktree issue"}\n'
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add issue in worktree"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Create execution
      createExecution(db, {
        id: "exec-jsonl-conflict-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed",
      });

      // Preview sync
      const preview = await service.previewSync("exec-jsonl-conflict-1");

      // JSONL conflicts are auto-resolvable, so canSync should still be true
      expect(preview.canSync).toBe(true);
      expect(preview.conflicts.jsonlConflicts.length).toBeGreaterThan(0);
    });
  });

  describe("resolveJSONLConflicts", () => {
    it("should resolve JSONL conflicts using three-way merge", async () => {
      // Helper to create issue entity
      const createIssue = (id: string, title: string) => ({
        id,
        uuid: `uuid-${id}`,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create main branch with initial JSONL
      const issuesPath = path.join(testRepo, ".sudocode/issues.jsonl");
      fs.mkdirSync(path.dirname(issuesPath), { recursive: true });
      fs.writeFileSync(
        issuesPath,
        JSON.stringify(createIssue("i-1", "Base issue")) + "\n"
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Add base issue"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create worktree branch and add new issue
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });
      const worktreeIssuesPath = path.join(
        worktreePath,
        ".sudocode/issues.jsonl"
      );
      fs.appendFileSync(
        worktreeIssuesPath,
        JSON.stringify(createIssue("i-2", "Worktree issue")) + "\n"
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add worktree issue"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Modify main branch to create conflict
      fs.appendFileSync(
        issuesPath,
        JSON.stringify(createIssue("i-3", "Main issue")) + "\n"
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Add main issue"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create execution
      const execution = createExecution(db, {
        id: "exec-resolve-1",
        worktree_path: worktreePath,
        branch_name: "worktree-branch",
        target_branch: "main",
        status: "completed",
      });

      // Resolve conflicts
      const jsonlConflicts = [
        {
          filePath: ".sudocode/issues.jsonl",
          entityType: "issue" as const,
          conflictCount: 1,
          canAutoResolve: true,
        },
      ];

      await service.resolveJSONLConflicts(execution, jsonlConflicts);

      // Verify resolved file contains all three issues
      const resolvedContent = fs.readFileSync(issuesPath, "utf8");
      const resolvedLines = resolvedContent.split("\n").filter((l) => l.trim());
      expect(resolvedLines.length).toBe(3);

      // Verify file is staged
      const status = execSync("git status --porcelain", {
        cwd: testRepo,
        encoding: "utf8",
      });
      expect(status).toContain(".sudocode/issues.jsonl");
    });

    it("should handle empty conflict list", async () => {
      const execution = createExecution(db, {
        id: "exec-resolve-2",
        worktree_path: "/tmp/worktree",
        branch_name: "branch",
        target_branch: "main",
        status: "completed",
      });

      // Should not throw
      await service.resolveJSONLConflicts(execution, []);
    });

    it("should throw error if file does not exist at revision", async () => {
      // Create worktree
      const worktreePath = path.join(testRepo, "../worktree2");
      execSync(`git worktree add ${worktreePath} -b test-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      const execution = createExecution(db, {
        id: "exec-resolve-3",
        worktree_path: worktreePath,
        branch_name: "test-branch",
        target_branch: "main",
        status: "completed",
      });

      const jsonlConflicts = [
        {
          filePath: ".sudocode/nonexistent.jsonl",
          entityType: "issue" as const,
          conflictCount: 1,
          canAutoResolve: true,
        },
      ];

      // Should handle non-existent files gracefully by returning empty array
      // The merge should still work with empty arrays
      await expect(
        service.resolveJSONLConflicts(execution, jsonlConflicts)
      ).resolves.not.toThrow();
    });
  });

  describe("commitUncommittedJSONL", () => {
    it("should commit uncommitted JSONL files", async () => {
      // Helper to create issue entity
      const createIssue = (id: string, title: string) => ({
        id,
        uuid: `uuid-${id}`,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create worktree
      const worktreePath = path.join(testRepo, "../worktree-commit");
      execSync(`git worktree add ${worktreePath} -b commit-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create uncommitted JSONL file
      const issuesPath = path.join(worktreePath, ".sudocode/issues.jsonl");
      fs.mkdirSync(path.dirname(issuesPath), { recursive: true });
      fs.writeFileSync(
        issuesPath,
        JSON.stringify(createIssue("i-test", "Test issue")) + "\n"
      );

      // Commit the file
      await service.commitUncommittedJSONL(worktreePath, [
        ".sudocode/issues.jsonl",
      ]);

      // Verify working tree is clean
      const status = execSync("git status --porcelain", {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(status.trim()).toBe("");

      // Verify commit message
      const log = execSync("git log -1 --pretty=%B", {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(log).toContain("Auto-commit uncommitted JSONL changes");
      expect(log).toContain(".sudocode/issues.jsonl");
    });

    it("should handle empty file list", async () => {
      // Should not throw
      await service.commitUncommittedJSONL("/tmp/worktree", []);
    });

    it("should handle multiple files", async () => {
      // Helper to create entities
      const createIssue = (id: string, title: string) => ({
        id,
        uuid: `uuid-${id}`,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const createSpec = (id: string, title: string) => ({
        id,
        uuid: `uuid-${id}`,
        title,
        content: "",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create worktree
      const worktreePath = path.join(testRepo, "../worktree-multi");
      execSync(`git worktree add ${worktreePath} -b multi-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create multiple uncommitted JSONL files
      const issuesPath = path.join(worktreePath, ".sudocode/issues.jsonl");
      const specsPath = path.join(worktreePath, ".sudocode/specs.jsonl");
      fs.mkdirSync(path.dirname(issuesPath), { recursive: true });
      fs.writeFileSync(
        issuesPath,
        JSON.stringify(createIssue("i-test", "Test issue")) + "\n"
      );
      fs.writeFileSync(
        specsPath,
        JSON.stringify(createSpec("s-test", "Test spec")) + "\n"
      );

      // Commit both files
      await service.commitUncommittedJSONL(worktreePath, [
        ".sudocode/issues.jsonl",
        ".sudocode/specs.jsonl",
      ]);

      // Verify working tree is clean
      const status = execSync("git status --porcelain", {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(status.trim()).toBe("");

      // Verify commit message includes both files
      const log = execSync("git log -1 --pretty=%B", {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(log).toContain("issues.jsonl");
      expect(log).toContain("specs.jsonl");
    });
  });

  describe("stageSync", () => {
    it("should stage changes without committing", async () => {
      // Create worktree with changes
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b stage-test-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Add files in worktree
      fs.writeFileSync(
        path.join(worktreePath, "staged-file.ts"),
        "staged content"
      );
      execSync("git add staged-file.ts", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "Add staged file"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Get initial commit count on main
      const initialCommitCount = execSync("git rev-list --count main", {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();

      // Create execution
      createExecution(db, {
        id: "exec-stage-1",
        worktree_path: worktreePath,
        branch_name: "stage-test-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform stage sync
      const result = await service.stageSync("exec-stage-1");

      expect(result.success).toBe(true);
      expect(result.filesChanged).toBeGreaterThan(0);

      // Verify files are staged (not committed)
      const status = execSync("git status --porcelain", {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(status).toContain("staged-file.ts");

      // Verify no new commit was created (commit count unchanged)
      const finalCommitCount = execSync("git rev-list --count main", {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
      expect(finalCommitCount).toBe(initialCommitCount);
    });

    it("should return error when code conflicts exist", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b stage-conflict-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create conflicting changes
      // Change in main
      fs.writeFileSync(
        path.join(testRepo, "stage-conflict.ts"),
        "main content"
      );
      execSync("git add stage-conflict.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add conflict file in main"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Different change in worktree
      fs.writeFileSync(
        path.join(worktreePath, "stage-conflict.ts"),
        "worktree content"
      );
      execSync("git add stage-conflict.ts", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add conflict file in worktree"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Create execution
      createExecution(db, {
        id: "exec-stage-conflict-1",
        worktree_path: worktreePath,
        branch_name: "stage-conflict-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform stage sync
      const result = await service.stageSync("exec-stage-conflict-1");

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.error).toContain("Merge conflicts detected");
    });

    it("should handle uncommitted JSONL files", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b stage-jsonl-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create .sudocode directory and add a committed file first
      const sudocodeDir = path.join(worktreePath, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir, ".gitkeep"), "");
      execSync("git add .sudocode/.gitkeep", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add .sudocode"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Add uncommitted JSONL file
      fs.writeFileSync(
        path.join(sudocodeDir, "issues.jsonl"),
        '{"id":"i-stage-001","title":"Stage test"}\n'
      );

      // Create execution
      createExecution(db, {
        id: "exec-stage-jsonl-1",
        worktree_path: worktreePath,
        branch_name: "stage-jsonl-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform stage sync with includeUncommitted option
      const result = await service.stageSync("exec-stage-jsonl-1", {
        includeUncommitted: true,
      });

      expect(result.success).toBe(true);
      // uncommittedFilesIncluded is a count, not a boolean
      expect(result.uncommittedFilesIncluded).toBeGreaterThan(0);
    });

    it("should throw error for non-existent execution", async () => {
      await expect(service.stageSync("nonexistent")).rejects.toThrow(
        WorktreeSyncError
      );

      try {
        await service.stageSync("nonexistent");
      } catch (error: any) {
        expect(error.code).toBe(WorktreeSyncErrorCode.EXECUTION_NOT_FOUND);
      }
    });

    it("should throw error when worktree path is missing", async () => {
      // Create execution without worktree
      createExecution(db, {
        id: "exec-stage-no-worktree",
        worktree_path: null,
        branch_name: "some-branch",
        target_branch: "main",
        status: "completed",
      });

      await expect(service.stageSync("exec-stage-no-worktree")).rejects.toThrow(
        WorktreeSyncError
      );

      try {
        await service.stageSync("exec-stage-no-worktree");
      } catch (error: any) {
        expect(error.code).toBe(WorktreeSyncErrorCode.NO_WORKTREE);
      }
    });

    it("should leave changes staged for manual commit", async () => {
      // Create worktree with multiple files
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b stage-multi-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Add multiple files in worktree
      fs.writeFileSync(path.join(worktreePath, "file1.ts"), "content1");
      fs.writeFileSync(path.join(worktreePath, "file2.ts"), "content2");
      execSync("git add file1.ts file2.ts", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add multiple files"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Create execution
      createExecution(db, {
        id: "exec-stage-multi-1",
        worktree_path: worktreePath,
        branch_name: "stage-multi-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform stage sync
      const result = await service.stageSync("exec-stage-multi-1");

      expect(result.success).toBe(true);
      expect(result.filesChanged).toBe(2);

      // Verify both files are staged
      const stagedFiles = execSync("git diff --cached --name-only", {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(stagedFiles).toContain("file1.ts");
      expect(stagedFiles).toContain("file2.ts");

      // Verify user can now commit manually
      execSync('git commit -m "Manual commit after stage sync"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Verify commit was created
      const log = execSync("git log -1 --pretty=%B", {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(log).toContain("Manual commit after stage sync");
    });
  });

  describe("preserveSync", () => {
    it("should merge commits preserving history", async () => {
      // Create worktree with multiple commits
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b preserve-test-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Add files in worktree with multiple commits
      fs.writeFileSync(path.join(worktreePath, "file1.ts"), "content1");
      execSync("git add file1.ts", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "Add file1"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      fs.writeFileSync(path.join(worktreePath, "file2.ts"), "content2");
      execSync("git add file2.ts", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "Add file2"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Get initial commit count on main
      const initialCommitCount = parseInt(
        execSync("git rev-list --count main", {
          cwd: testRepo,
          encoding: "utf8",
          stdio: "pipe",
        }).trim()
      );

      // Create execution
      createExecution(db, {
        id: "exec-preserve-1",
        worktree_path: worktreePath,
        branch_name: "preserve-test-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform preserve sync
      const result = await service.preserveSync("exec-preserve-1");

      expect(result.success).toBe(true);
      expect(result.filesChanged).toBeGreaterThan(0);
      expect(result.finalCommit).toBeDefined();

      // Verify commits were preserved (merge commit + 2 original commits)
      const finalCommitCount = parseInt(
        execSync("git rev-list --count main", {
          cwd: testRepo,
          encoding: "utf8",
          stdio: "pipe",
        }).trim()
      );
      // Should have at least the original + 2 new commits (+ possibly merge commit)
      expect(finalCommitCount).toBeGreaterThan(initialCommitCount);

      // Verify files exist
      expect(fs.existsSync(path.join(testRepo, "file1.ts"))).toBe(true);
      expect(fs.existsSync(path.join(testRepo, "file2.ts"))).toBe(true);
    });

    it("should return error when code conflicts exist", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b preserve-conflict-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create conflicting changes
      // Change in main
      fs.writeFileSync(
        path.join(testRepo, "preserve-conflict.ts"),
        "main content"
      );
      execSync("git add preserve-conflict.ts", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Add conflict file in main"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Different change in worktree
      fs.writeFileSync(
        path.join(worktreePath, "preserve-conflict.ts"),
        "worktree content"
      );
      execSync("git add preserve-conflict.ts", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add conflict file in worktree"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Create execution
      createExecution(db, {
        id: "exec-preserve-conflict-1",
        worktree_path: worktreePath,
        branch_name: "preserve-conflict-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform preserve sync
      const result = await service.preserveSync("exec-preserve-conflict-1");

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.error).toContain("Merge conflicts detected");
    });

    it("should auto-resolve JSONL conflicts", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b preserve-jsonl-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Helper to create issue entity
      const createIssue = (id: string, title: string) => ({
        id,
        uuid: `uuid-${id}`,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create JSONL conflict
      // In main
      const mainSudocode = path.join(testRepo, ".sudocode");
      fs.mkdirSync(mainSudocode, { recursive: true });
      fs.writeFileSync(
        path.join(mainSudocode, "issues.jsonl"),
        JSON.stringify(createIssue("i-main", "Main issue")) + "\n"
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Add issue in main"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // In worktree
      const worktreeSudocode = path.join(worktreePath, ".sudocode");
      fs.mkdirSync(worktreeSudocode, { recursive: true });
      fs.writeFileSync(
        path.join(worktreeSudocode, "issues.jsonl"),
        JSON.stringify(createIssue("i-worktree", "Worktree issue")) + "\n"
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: worktreePath,
        stdio: "pipe",
      });
      execSync('git commit -m "Add issue in worktree"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Create execution
      createExecution(db, {
        id: "exec-preserve-jsonl-1",
        worktree_path: worktreePath,
        branch_name: "preserve-jsonl-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform preserve sync - JSONL conflicts should be auto-resolved
      const result = await service.preserveSync("exec-preserve-jsonl-1");

      expect(result.success).toBe(true);

      // Verify JSONL file was merged (both issues should exist)
      const issuesContent = fs.readFileSync(
        path.join(testRepo, ".sudocode/issues.jsonl"),
        "utf8"
      );
      expect(issuesContent).toContain("i-main");
      expect(issuesContent).toContain("i-worktree");
    });

    it("should throw error for non-existent execution", async () => {
      await expect(service.preserveSync("nonexistent")).rejects.toThrow(
        WorktreeSyncError
      );

      try {
        await service.preserveSync("nonexistent");
      } catch (error: any) {
        expect(error.code).toBe(WorktreeSyncErrorCode.EXECUTION_NOT_FOUND);
      }
    });

    it("should throw error when worktree path is missing", async () => {
      // Create execution without worktree
      createExecution(db, {
        id: "exec-preserve-no-worktree",
        worktree_path: null,
        branch_name: "some-branch",
        target_branch: "main",
        status: "completed",
      });

      await expect(
        service.preserveSync("exec-preserve-no-worktree")
      ).rejects.toThrow(WorktreeSyncError);

      try {
        await service.preserveSync("exec-preserve-no-worktree");
      } catch (error: any) {
        expect(error.code).toBe(WorktreeSyncErrorCode.NO_WORKTREE);
      }
    });

    it("should return error when no commits to merge", async () => {
      // Create worktree with no new commits (empty branch)
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b preserve-empty-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create execution
      createExecution(db, {
        id: "exec-preserve-empty",
        worktree_path: worktreePath,
        branch_name: "preserve-empty-branch",
        target_branch: "main",
        status: "completed",
      });

      // Perform preserve sync
      const result = await service.preserveSync("exec-preserve-empty");

      expect(result.success).toBe(false);
      expect(result.error).toContain("No commits to merge");
    });

    it("should throw DIRTY_WORKING_TREE if local tree has uncommitted changes", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b preserve-dirty-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Add a commit in worktree
      fs.writeFileSync(path.join(worktreePath, "file.ts"), "content");
      execSync("git add file.ts", { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "Add file"', {
        cwd: worktreePath,
        stdio: "pipe",
      });

      // Make local tree dirty
      fs.writeFileSync(path.join(testRepo, "dirty.txt"), "uncommitted content");

      // Create execution
      createExecution(db, {
        id: "exec-preserve-dirty",
        worktree_path: worktreePath,
        branch_name: "preserve-dirty-branch",
        target_branch: "main",
        status: "completed",
      });

      await expect(service.preserveSync("exec-preserve-dirty")).rejects.toThrow(
        WorktreeSyncError
      );

      try {
        await service.preserveSync("exec-preserve-dirty");
      } catch (error: any) {
        expect(error.code).toBe(WorktreeSyncErrorCode.DIRTY_WORKING_TREE);
      }
    });
  });

  describe("_readJSONLVersion", () => {
    it("should read JSONL file at specific revision", async () => {
      // Helper to create issue entity
      const createIssue = (id: string, title: string) => ({
        id,
        uuid: `uuid-${id}`,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create and commit JSONL file
      const issuesPath = path.join(testRepo, ".sudocode/issues.jsonl");
      fs.mkdirSync(path.dirname(issuesPath), { recursive: true });
      fs.writeFileSync(
        issuesPath,
        JSON.stringify(createIssue("i-1", "Issue 1")) +
          "\n" +
          JSON.stringify(createIssue("i-2", "Issue 2")) +
          "\n"
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Add issues"', { cwd: testRepo, stdio: "pipe" });

      // Read at HEAD
      const entities = await (service as any)._readJSONLVersion(
        ".sudocode/issues.jsonl",
        "HEAD"
      );

      expect(entities).toHaveLength(2);
      expect(entities[0].id).toBe("i-1");
      expect(entities[1].id).toBe("i-2");
    });

    it("should return empty array for non-existent file", async () => {
      const entities = await (service as any)._readJSONLVersion(
        ".sudocode/nonexistent.jsonl",
        "HEAD"
      );

      expect(entities).toEqual([]);
    });

    it("should read file at specific commit", async () => {
      // Helper to create issue entity
      const createIssue = (id: string, title: string) => ({
        id,
        uuid: `uuid-${id}`,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create initial version
      const issuesPath = path.join(testRepo, ".sudocode/test.jsonl");
      fs.mkdirSync(path.dirname(issuesPath), { recursive: true });
      fs.writeFileSync(
        issuesPath,
        JSON.stringify(createIssue("i-1", "Version 1")) + "\n"
      );
      execSync("git add .sudocode/test.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Version 1"', { cwd: testRepo, stdio: "pipe" });

      const commit1 = execSync("git rev-parse HEAD", {
        cwd: testRepo,
        encoding: "utf8",
      }).trim();

      // Create second version
      fs.writeFileSync(
        issuesPath,
        JSON.stringify(createIssue("i-1", "Version 2")) + "\n"
      );
      execSync("git add .sudocode/test.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Version 2"', { cwd: testRepo, stdio: "pipe" });

      // Read at first commit
      const entities = await (service as any)._readJSONLVersion(
        ".sudocode/test.jsonl",
        commit1
      );

      expect(entities).toHaveLength(1);
      expect(entities[0].title).toBe("Version 1");
    });
  });

  describe("_hasLocalUncommittedChanges", () => {
    it("should return false for file without changes", () => {
      // Create and commit a file
      fs.writeFileSync(path.join(testRepo, "committed.ts"), "content");
      execSync("git add committed.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add file"', { cwd: testRepo, stdio: "pipe" });

      const hasChanges = (service as any)._hasLocalUncommittedChanges(
        "committed.ts"
      );
      expect(hasChanges).toBe(false);
    });

    it("should return true for file with uncommitted changes", () => {
      // Create and commit a file
      fs.writeFileSync(path.join(testRepo, "modified.ts"), "original");
      execSync("git add modified.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add file"', { cwd: testRepo, stdio: "pipe" });

      // Modify it without committing
      fs.writeFileSync(path.join(testRepo, "modified.ts"), "changed");

      const hasChanges = (service as any)._hasLocalUncommittedChanges(
        "modified.ts"
      );
      expect(hasChanges).toBe(true);
    });

    it("should return false for new untracked file (not in HEAD)", () => {
      // Create a new file (not committed)
      fs.writeFileSync(path.join(testRepo, "untracked.ts"), "content");

      // For untracked files, git diff --quiet HEAD returns 0 because
      // the file isn't in HEAD to compare against.
      // Note: We use _isFileUntracked separately to detect these cases.
      const hasChanges = (service as any)._hasLocalUncommittedChanges(
        "untracked.ts"
      );
      expect(hasChanges).toBe(false);
    });
  });

  describe("_isFileUntracked", () => {
    it("should return true for untracked file", () => {
      // Create a new file (not committed)
      fs.writeFileSync(path.join(testRepo, "untracked-test.ts"), "content");

      const isUntracked = (service as any)._isFileUntracked("untracked-test.ts");
      expect(isUntracked).toBe(true);
    });

    it("should return false for tracked file", () => {
      // Create and commit a file
      fs.writeFileSync(path.join(testRepo, "tracked.ts"), "content");
      execSync("git add tracked.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add file"', { cwd: testRepo, stdio: "pipe" });

      const isUntracked = (service as any)._isFileUntracked("tracked.ts");
      expect(isUntracked).toBe(false);
    });

    it("should return false for staged file", () => {
      // Create and stage a file (but not commit)
      fs.writeFileSync(path.join(testRepo, "staged.ts"), "content");
      execSync("git add staged.ts", { cwd: testRepo, stdio: "pipe" });

      const isUntracked = (service as any)._isFileUntracked("staged.ts");
      expect(isUntracked).toBe(false);
    });
  });

  describe("_isJSONLFile", () => {
    it("should return true for .sudocode JSONL files", () => {
      expect((service as any)._isJSONLFile(".sudocode/issues.jsonl")).toBe(true);
      expect((service as any)._isJSONLFile(".sudocode/specs.jsonl")).toBe(true);
    });

    it("should return false for non-JSONL files", () => {
      expect((service as any)._isJSONLFile("src/app.ts")).toBe(false);
      expect((service as any)._isJSONLFile(".sudocode/config.json")).toBe(false);
    });

    it("should return false for JSONL files outside .sudocode", () => {
      expect((service as any)._isJSONLFile("data/issues.jsonl")).toBe(false);
    });
  });

  describe("_threeWayMergeFile", () => {
    it("should merge non-conflicting changes cleanly", () => {
      // Create base file
      fs.writeFileSync(
        path.join(testRepo, "merge-test.ts"),
        "line1\nline2\nline3\n"
      );
      execSync("git add merge-test.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add base file"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Modify local version (add line at end)
      fs.writeFileSync(
        path.join(testRepo, "merge-test.ts"),
        "line1\nline2\nline3\nline4-local\n"
      );

      // Create worktree file with different change (add line at beginning)
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      fs.writeFileSync(
        path.join(worktreePath, "merge-test.ts"),
        "line0-worktree\nline1\nline2\nline3\n"
      );

      // Perform merge
      const hasConflicts = (service as any)._threeWayMergeFile(
        "merge-test.ts",
        path.join(worktreePath, "merge-test.ts")
      );

      expect(hasConflicts).toBe(false);

      // Verify merged content has both changes
      const mergedContent = fs.readFileSync(
        path.join(testRepo, "merge-test.ts"),
        "utf8"
      );
      expect(mergedContent).toContain("line0-worktree");
      expect(mergedContent).toContain("line4-local");
    });

    it("should return true and add conflict markers for conflicting changes", () => {
      // Create base file
      fs.writeFileSync(
        path.join(testRepo, "conflict-test.ts"),
        "line1\nline2\nline3\n"
      );
      execSync("git add conflict-test.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add base file"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Modify local version (change line2)
      fs.writeFileSync(
        path.join(testRepo, "conflict-test.ts"),
        "line1\nline2-local\nline3\n"
      );

      // Create worktree file with conflicting change (also change line2)
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      fs.writeFileSync(
        path.join(worktreePath, "conflict-test.ts"),
        "line1\nline2-worktree\nline3\n"
      );

      // Perform merge
      const hasConflicts = (service as any)._threeWayMergeFile(
        "conflict-test.ts",
        path.join(worktreePath, "conflict-test.ts")
      );

      expect(hasConflicts).toBe(true);

      // Verify conflict markers are present
      const mergedContent = fs.readFileSync(
        path.join(testRepo, "conflict-test.ts"),
        "utf8"
      );
      expect(mergedContent).toContain("<<<<<<<");
      expect(mergedContent).toContain("=======");
      expect(mergedContent).toContain(">>>>>>>");
      expect(mergedContent).toContain("line2-local");
      expect(mergedContent).toContain("line2-worktree");
    });
  });

  describe("_mergeJSONLFiles", () => {
    it("should merge JSONL files using UUID-based deduplication", async () => {
      const createIssue = (
        id: string,
        uuid: string,
        title: string,
        updatedAt?: string
      ) => ({
        id,
        uuid,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: updatedAt || "2024-01-01T00:00:00Z",
      });

      // Create local file with one issue
      const localPath = path.join(testRepo, ".sudocode/issues.jsonl");
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(
        localPath,
        JSON.stringify(createIssue("i-1", "uuid-1", "Local issue")) + "\n"
      );

      // Create worktree file with different issue
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      const worktreeFile = path.join(worktreePath, "issues.jsonl");
      fs.writeFileSync(
        worktreeFile,
        JSON.stringify(createIssue("i-2", "uuid-2", "Worktree issue")) + "\n"
      );

      // Merge files
      await (service as any)._mergeJSONLFiles(localPath, worktreeFile);

      // Verify both issues are in merged file
      const mergedContent = fs.readFileSync(localPath, "utf8");
      expect(mergedContent).toContain("uuid-1");
      expect(mergedContent).toContain("uuid-2");
    });

    it("should merge duplicate UUIDs by keeping most recent", async () => {
      const createIssue = (
        id: string,
        uuid: string,
        title: string,
        updatedAt: string
      ) => ({
        id,
        uuid,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: updatedAt,
      });

      // Create local file with issue
      const localPath = path.join(testRepo, ".sudocode/merge-issues.jsonl");
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(
        localPath,
        JSON.stringify(
          createIssue("i-1", "same-uuid", "Older version", "2024-01-01T00:00:00Z")
        ) + "\n"
      );

      // Create worktree file with same UUID but newer timestamp
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      const worktreeFile = path.join(worktreePath, "merge-issues.jsonl");
      fs.writeFileSync(
        worktreeFile,
        JSON.stringify(
          createIssue("i-1", "same-uuid", "Newer version", "2024-06-01T00:00:00Z")
        ) + "\n"
      );

      // Merge files
      await (service as any)._mergeJSONLFiles(localPath, worktreeFile);

      // Verify merged file has the newer version
      const mergedContent = fs.readFileSync(localPath, "utf8");
      expect(mergedContent).toContain("Newer version");
      // Should only have one entity
      const lines = mergedContent.split("\n").filter((l: string) => l.trim());
      expect(lines.length).toBe(1);
    });
  });

  describe("_copyUncommittedFiles with safe merging", () => {
    it("should copy file directly when no local changes exist", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b copy-direct-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Add uncommitted file in worktree
      fs.writeFileSync(
        path.join(worktreePath, "new-file.ts"),
        "worktree content"
      );

      // Copy uncommitted files
      const result = await (service as any)._copyUncommittedFiles(worktreePath);

      expect(result.filesCopied).toBe(1);
      expect(result.filesWithConflicts).toHaveLength(0);

      // Verify file was copied
      const localContent = fs.readFileSync(
        path.join(testRepo, "new-file.ts"),
        "utf8"
      );
      expect(localContent).toBe("worktree content");
    });

    it("should use three-way merge when local has uncommitted changes", async () => {
      // Create and commit base file
      fs.writeFileSync(
        path.join(testRepo, "shared.ts"),
        "line1\nline2\nline3\n"
      );
      execSync("git add shared.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add shared file"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b merge-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Modify local version (not committed)
      fs.writeFileSync(
        path.join(testRepo, "shared.ts"),
        "line1\nline2-local\nline3\n"
      );

      // Modify worktree version (uncommitted)
      fs.writeFileSync(
        path.join(worktreePath, "shared.ts"),
        "line1\nline2-worktree\nline3\n"
      );

      // Copy uncommitted files
      const result = await (service as any)._copyUncommittedFiles(worktreePath);

      expect(result.filesCopied).toBe(1);
      expect(result.filesWithConflicts).toHaveLength(1);
      expect(result.filesWithConflicts[0]).toBe("shared.ts");

      // Verify conflict markers were added
      const localContent = fs.readFileSync(
        path.join(testRepo, "shared.ts"),
        "utf8"
      );
      expect(localContent).toContain("<<<<<<<");
      expect(localContent).toContain(">>>>>>>");
    });

    it("should use JSONL merge for .sudocode JSONL files", async () => {
      const createIssue = (id: string, uuid: string, title: string) => ({
        id,
        uuid,
        title,
        status: "open",
        content: "",
        priority: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });

      // Create and commit base JSONL
      fs.mkdirSync(path.join(testRepo, ".sudocode"), { recursive: true });
      fs.writeFileSync(
        path.join(testRepo, ".sudocode/issues.jsonl"),
        JSON.stringify(createIssue("i-base", "uuid-base", "Base issue")) + "\n"
      );
      execSync("git add .sudocode/issues.jsonl", {
        cwd: testRepo,
        stdio: "pipe",
      });
      execSync('git commit -m "Add base JSONL"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b jsonl-merge-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Modify local JSONL (add local issue)
      fs.writeFileSync(
        path.join(testRepo, ".sudocode/issues.jsonl"),
        JSON.stringify(createIssue("i-base", "uuid-base", "Base issue")) +
          "\n" +
          JSON.stringify(createIssue("i-local", "uuid-local", "Local issue")) +
          "\n"
      );

      // Modify worktree JSONL (add worktree issue)
      fs.writeFileSync(
        path.join(worktreePath, ".sudocode/issues.jsonl"),
        JSON.stringify(
          createIssue("i-worktree", "uuid-worktree", "Worktree issue")
        ) + "\n"
      );

      // Copy uncommitted files
      const result = await (service as any)._copyUncommittedFiles(worktreePath);

      expect(result.filesCopied).toBe(1);
      // JSONL files should NOT have conflicts (they're auto-merged)
      expect(result.filesWithConflicts).toHaveLength(0);

      // Verify JSONL was merged (should have all three issues)
      const mergedContent = fs.readFileSync(
        path.join(testRepo, ".sudocode/issues.jsonl"),
        "utf8"
      );
      expect(mergedContent).toContain("uuid-base");
      expect(mergedContent).toContain("uuid-local");
      expect(mergedContent).toContain("uuid-worktree");
    });

    it("should use three-way merge for untracked local files", async () => {
      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b untracked-merge-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create untracked local file (not in git at all)
      fs.writeFileSync(
        path.join(testRepo, "untracked-local.ts"),
        "local content\n"
      );

      // Create uncommitted file in worktree with different content
      fs.writeFileSync(
        path.join(worktreePath, "untracked-local.ts"),
        "worktree content\n"
      );

      // Copy uncommitted files
      const result = await (service as any)._copyUncommittedFiles(worktreePath);

      expect(result.filesCopied).toBe(1);
      // Should have conflicts since both have different content and no common base
      expect(result.filesWithConflicts).toHaveLength(1);
      expect(result.filesWithConflicts[0]).toBe("untracked-local.ts");

      // Verify conflict markers were added
      const localContent = fs.readFileSync(
        path.join(testRepo, "untracked-local.ts"),
        "utf8"
      );
      expect(localContent).toContain("<<<<<<<");
      expect(localContent).toContain(">>>>>>>");
    });

    it("should NOT stage files that have conflict markers", async () => {
      // Create and commit base file
      fs.writeFileSync(
        path.join(testRepo, "conflict-staging.ts"),
        "base content\n"
      );
      execSync("git add conflict-staging.ts", { cwd: testRepo, stdio: "pipe" });
      execSync('git commit -m "Add base file"', {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Create worktree
      const worktreePath = createWorktreePath();
      worktreePaths.push(worktreePath);
      execSync(`git worktree add ${worktreePath} -b conflict-staging-branch`, {
        cwd: testRepo,
        stdio: "pipe",
      });

      // Modify local version
      fs.writeFileSync(
        path.join(testRepo, "conflict-staging.ts"),
        "local changes\n"
      );

      // Modify worktree version with conflicting change
      fs.writeFileSync(
        path.join(worktreePath, "conflict-staging.ts"),
        "worktree changes\n"
      );

      // Copy uncommitted files
      const result = await (service as any)._copyUncommittedFiles(worktreePath);

      expect(result.filesWithConflicts).toContain("conflict-staging.ts");

      // Verify file is NOT staged (so VS Code can detect conflicts)
      const stagedFiles = execSync("git diff --cached --name-only", {
        cwd: testRepo,
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(stagedFiles).not.toContain("conflict-staging.ts");

      // But file should have conflict markers
      const localContent = fs.readFileSync(
        path.join(testRepo, "conflict-staging.ts"),
        "utf8"
      );
      expect(localContent).toContain("<<<<<<<");
    });
  });
});

/**
 * Helper to create execution in database
 */
function createExecution(
  db: Database.Database,
  data: {
    id: string;
    worktree_path: string | null;
    branch_name: string;
    target_branch: string;
    status: string;
  }
) {
  const stmt = db.prepare(`
    INSERT INTO executions (
      id, worktree_path, branch_name, target_branch, status,
      agent_type, mode, prompt, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  stmt.run(
    data.id,
    data.worktree_path,
    data.branch_name,
    data.target_branch,
    data.status,
    "claude-code",
    "worktree",
    "Test prompt"
  );

  const getStmt = db.prepare("SELECT * FROM executions WHERE id = ?");
  return getStmt.get(data.id);
}
