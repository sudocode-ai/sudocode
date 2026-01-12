/**
 * Integration tests for worktree sync conflict detection
 *
 * Tests the full conflict detection workflow using real git repositories
 * with various conflict scenarios.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConflictDetector } from "../../../src/execution/worktree/conflict-detector.js";
import { GitSyncCli } from "../../../src/execution/worktree/git-sync-cli.js";
import {
  createTestRepo,
  commitFile,
  createBranch,
  checkoutBranch,
  modifyFile,
  deleteFile,
  cleanupTestRepo,
  setupBranchedRepo,
  createBinaryFile,
} from "./helpers/git-test-utils.js";
import * as fs from "fs";
import * as path from "path";

describe("ConflictDetector Integration", () => {
  let testRepo: string;

  afterEach(() => {
    if (testRepo) {
      cleanupTestRepo(testRepo);
    }
  });

  describe("Scenario 1: Clean Merge (No Conflicts)", () => {
    it("should detect no conflicts when branches merge cleanly", () => {
      // Setup: main and branch1 modify different files
      testRepo = createTestRepo();

      // main: Add file1.ts
      commitFile(testRepo, "file1.ts", "export const a = 1;", "Add file1");

      // branch1: Add file2.ts (different file)
      createBranch(testRepo, "branch1");
      commitFile(testRepo, "file2.ts", "export const b = 2;", "Add file2");

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(false);
      expect(report.jsonlConflicts).toHaveLength(0);
      expect(report.codeConflicts).toHaveLength(0);
      expect(report.totalFiles).toBe(0);
      expect(report.summary).toBe("No conflicts detected");
    });
  });

  describe("Scenario 2: JSONL Conflicts Only", () => {
    it("should detect and classify JSONL conflicts as auto-resolvable", () => {
      // Setup: both branches modify issues.jsonl
      testRepo = createTestRepo();

      // Create .sudocode directory in main
      const sudocodeDir = path.join(testRepo, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      commitFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","title":"Issue 1","status":"open"}\n',
        "Add issues.jsonl"
      );

      // branch1: Modify the same issue differently
      createBranch(testRepo, "branch1");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","title":"Issue 1 Modified","status":"in_progress"}\n',
        "Update issue on branch1"
      );

      // main: Also modify the same issue
      checkoutBranch(testRepo, "main");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","title":"Issue 1 Updated","status":"closed"}\n',
        "Update issue on main"
      );

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts).toHaveLength(1);
      expect(report.jsonlConflicts[0].entityType).toBe("issue");
      expect(report.jsonlConflicts[0].canAutoResolve).toBe(true);
      expect(report.jsonlConflicts[0].filePath).toContain("issues.jsonl");
      expect(report.codeConflicts).toHaveLength(0);
      expect(report.summary).toContain("auto-resolvable");
    });

    it("should classify specs.jsonl as spec entity type", () => {
      // Setup: both branches modify specs.jsonl
      testRepo = createTestRepo();

      // Create .sudocode directory in main
      const sudocodeDir = path.join(testRepo, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      commitFile(
        testRepo,
        ".sudocode/specs.jsonl",
        '{"id":"s-001","title":"Spec 1"}\n',
        "Add specs.jsonl"
      );

      // branch1: Modify spec
      createBranch(testRepo, "branch1");
      modifyFile(
        testRepo,
        ".sudocode/specs.jsonl",
        '{"id":"s-001","title":"Spec 1 Modified"}\n',
        "Update spec on branch1"
      );

      // main: Also modify spec
      checkoutBranch(testRepo, "main");
      modifyFile(
        testRepo,
        ".sudocode/specs.jsonl",
        '{"id":"s-001","title":"Spec 1 Updated"}\n',
        "Update spec on main"
      );

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts).toHaveLength(1);
      expect(report.jsonlConflicts[0].entityType).toBe("spec");
      expect(report.jsonlConflicts[0].canAutoResolve).toBe(true);
    });
  });

  describe("Scenario 3: Code Conflicts Only", () => {
    it("should detect code conflicts requiring manual resolution", () => {
      // Setup: both branches modify the same code file
      testRepo = createTestRepo();

      // Create initial file
      commitFile(
        testRepo,
        "src/utils.ts",
        "export function foo() {\n  return 1;\n}\n",
        "Add utils.ts"
      );

      // branch1: Modify function
      createBranch(testRepo, "branch1");
      modifyFile(
        testRepo,
        "src/utils.ts",
        "export function foo() {\n  return 2;\n}\n",
        "Change return value to 2"
      );

      // main: Also modify same function
      checkoutBranch(testRepo, "main");
      modifyFile(
        testRepo,
        "src/utils.ts",
        "export function foo() {\n  return 3;\n}\n",
        "Change return value to 3"
      );

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.codeConflicts).toHaveLength(1);
      expect(report.codeConflicts[0].conflictType).toBe("content");
      expect(report.codeConflicts[0].canAutoResolve).toBe(false);
      expect(report.codeConflicts[0].filePath).toContain("src/utils.ts");
      expect(report.codeConflicts[0].description).toContain("modified");
      expect(report.codeConflicts[0].resolutionStrategy).toBeDefined();
      expect(report.jsonlConflicts).toHaveLength(0);
      expect(report.summary).toContain("manual resolution");
    });
  });

  describe("Scenario 4: Mixed Conflicts", () => {
    it("should handle both JSONL and code conflicts", () => {
      // Setup: both branches modify both JSONL and code files
      testRepo = createTestRepo();

      // Create initial files
      const sudocodeDir = path.join(testRepo, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      commitFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","title":"Issue 1"}\n',
        "Add issues.jsonl"
      );
      commitFile(
        testRepo,
        "src/main.ts",
        "export const version = 1;",
        "Add main.ts"
      );

      // branch1: Modify both files
      createBranch(testRepo, "branch1");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","title":"Issue 1 from branch1"}\n',
        "Update issue on branch1"
      );
      modifyFile(
        testRepo,
        "src/main.ts",
        "export const version = 2;",
        "Update version on branch1"
      );

      // main: Also modify both files
      checkoutBranch(testRepo, "main");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","title":"Issue 1 from main"}\n',
        "Update issue on main"
      );
      modifyFile(
        testRepo,
        "src/main.ts",
        "export const version = 3;",
        "Update version on main"
      );

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts).toHaveLength(1);
      expect(report.codeConflicts).toHaveLength(1);
      expect(report.totalFiles).toBe(2);
      expect(report.summary).toContain("auto-resolvable");
      expect(report.summary).toContain("manual resolution");
    });
  });

  describe("Scenario 5: Multiple Files", () => {
    it("should detect conflicts across multiple files", () => {
      // Setup: conflicts in multiple JSONL and code files
      testRepo = createTestRepo();

      // Create initial files
      const sudocodeDir = path.join(testRepo, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      commitFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001"}\n',
        "Add issues.jsonl"
      );
      commitFile(
        testRepo,
        ".sudocode/specs.jsonl",
        '{"id":"s-001"}\n',
        "Add specs.jsonl"
      );
      commitFile(testRepo, "src/file1.ts", "export const a = 1;", "Add file1");
      commitFile(testRepo, "src/file2.ts", "export const b = 1;", "Add file2");

      // branch1: Modify all files
      createBranch(testRepo, "branch1");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","branch":"branch1"}\n',
        "Update issues"
      );
      modifyFile(
        testRepo,
        ".sudocode/specs.jsonl",
        '{"id":"s-001","branch":"branch1"}\n',
        "Update specs"
      );
      modifyFile(
        testRepo,
        "src/file1.ts",
        "export const a = 2;",
        "Update file1"
      );
      modifyFile(
        testRepo,
        "src/file2.ts",
        "export const b = 2;",
        "Update file2"
      );

      // main: Also modify all files
      checkoutBranch(testRepo, "main");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","branch":"main"}\n',
        "Update issues on main"
      );
      modifyFile(
        testRepo,
        ".sudocode/specs.jsonl",
        '{"id":"s-001","branch":"main"}\n',
        "Update specs on main"
      );
      modifyFile(
        testRepo,
        "src/file1.ts",
        "export const a = 3;",
        "Update file1 on main"
      );
      modifyFile(
        testRepo,
        "src/file2.ts",
        "export const b = 3;",
        "Update file2 on main"
      );

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts).toHaveLength(2); // issues + specs
      expect(report.codeConflicts).toHaveLength(2); // file1 + file2
      expect(report.totalFiles).toBe(4);

      // Verify JSONL conflicts are properly classified
      const issuesConflict = report.jsonlConflicts.find((c) =>
        c.filePath.includes("issues.jsonl")
      );
      const specsConflict = report.jsonlConflicts.find((c) =>
        c.filePath.includes("specs.jsonl")
      );
      expect(issuesConflict?.entityType).toBe("issue");
      expect(specsConflict?.entityType).toBe("spec");
    });
  });

  describe("Scenario 6: Binary File Conflict", () => {
    it("should handle binary file conflicts", () => {
      // Setup: both branches modify a binary file
      testRepo = createTestRepo();

      // Create binary file (PNG image)
      createBinaryFile(testRepo, "assets/image.png", "Add image");

      // branch1: Modify binary (replace with different content)
      createBranch(testRepo, "branch1");
      const image1 = Buffer.from(
        "89504e470d0a1a0a0000000d494844520000000200000002010300000025db56ca00000003504c5445000000a77a3dda0000000174524e530040e6d8660000000a4944415408d76360000000020001e221bc330000000049454e44ae426082",
        "hex"
      );
      fs.writeFileSync(path.join(testRepo, "assets/image.png"), image1);
      // Don't use commitFile here - it overwrites binary content with empty string
      require("child_process").execSync("git add assets/image.png", { cwd: testRepo, stdio: "pipe" });
      require("child_process").execSync('git commit -m "Update image on branch1"', { cwd: testRepo, stdio: "pipe" });

      // main: Also modify binary (different content)
      checkoutBranch(testRepo, "main");
      const image2 = Buffer.from(
        "89504e470d0a1a0a0000000d494844520000000300000003010300000025db56ca00000003504c5445000000a77a3dda0000000174524e530040e6d8660000000a4944415408d76360000000020001e221bc330000000049454e44ae426082",
        "hex"
      );
      fs.writeFileSync(path.join(testRepo, "assets/image.png"), image2);
      // Don't use commitFile here - it overwrites binary content with empty string
      require("child_process").execSync("git add assets/image.png", { cwd: testRepo, stdio: "pipe" });
      require("child_process").execSync('git commit -m "Update image on main"', { cwd: testRepo, stdio: "pipe" });

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.codeConflicts).toHaveLength(1);
      expect(report.codeConflicts[0].filePath).toContain("image.png");
      expect(report.codeConflicts[0].canAutoResolve).toBe(false);
    });
  });

  describe("Scenario 7: Nested Directories", () => {
    it("should handle conflicts in nested directory structures", () => {
      // Setup: conflicts in deeply nested files
      testRepo = createTestRepo();

      // Create nested file
      commitFile(
        testRepo,
        "src/components/ui/Button.tsx",
        "export const Button = () => <button>v1</button>;",
        "Add Button component"
      );

      // branch1: Modify nested file
      createBranch(testRepo, "branch1");
      modifyFile(
        testRepo,
        "src/components/ui/Button.tsx",
        "export const Button = () => <button>v2</button>;",
        "Update Button on branch1"
      );

      // main: Also modify nested file
      checkoutBranch(testRepo, "main");
      modifyFile(
        testRepo,
        "src/components/ui/Button.tsx",
        "export const Button = () => <button>v3</button>;",
        "Update Button on main"
      );

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.codeConflicts).toHaveLength(1);
      expect(report.codeConflicts[0].filePath).toContain(
        "src/components/ui/Button.tsx"
      );
    });
  });

  describe("Scenario 8: .sudocode directory at different paths", () => {
    it("should detect JSONL conflicts in .sudocode directory", () => {
      // Setup: .sudocode directory with conflicts
      testRepo = createTestRepo();

      // Create .sudocode/issues.jsonl
      const sudocodeDir = path.join(testRepo, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      commitFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","v":1}\n',
        "Add issues"
      );

      // branch1: Modify issues
      createBranch(testRepo, "branch1");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","v":2}\n',
        "Update v to 2"
      );

      // main: Also modify issues
      checkoutBranch(testRepo, "main");
      modifyFile(
        testRepo,
        ".sudocode/issues.jsonl",
        '{"id":"i-001","v":3}\n',
        "Update v to 3"
      );

      // Detect conflicts
      const detector = new ConflictDetector(testRepo);
      const report = detector.detectConflicts("branch1", "main");

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts.length).toBeGreaterThan(0);
      expect(report.jsonlConflicts[0].canAutoResolve).toBe(true);
      expect(report.jsonlConflicts[0].filePath).toMatch(
        /\.sudocode.*issues\.jsonl/
      );
    });
  });
});

describe("GitSyncCli Integration", () => {
  let testRepo: string;

  afterEach(() => {
    if (testRepo) {
      cleanupTestRepo(testRepo);
    }
  });

  describe("getMergeBase", () => {
    it("should find merge base correctly", () => {
      const { repo, branches } = setupBranchedRepo();
      testRepo = repo;

      const gitSync = new GitSyncCli(repo);
      const mergeBase = gitSync.getMergeBase("branch1", "branch2");

      expect(mergeBase).toMatch(/^[0-9a-f]{40}$/); // Valid SHA
    });

    it("should find same merge base for main and feature branch", () => {
      testRepo = createTestRepo();

      // Create feature branch and add commits
      createBranch(testRepo, "feature");
      commitFile(testRepo, "feature.ts", "feature code", "Add feature");

      const gitSync = new GitSyncCli(testRepo);
      const mergeBase = gitSync.getMergeBase("main", "feature");

      expect(mergeBase).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("getDiff", () => {
    it("should get diff between commits", () => {
      testRepo = createTestRepo();

      const gitSync = new GitSyncCli(testRepo);
      const beforeCommit = gitSync.getMergeBase("main", "main"); // Get current HEAD

      // Add files
      commitFile(testRepo, "file1.ts", "content 1", "Add file1");
      commitFile(testRepo, "file2.ts", "content 2", "Add file2");

      const afterCommit = gitSync.getMergeBase("main", "main"); // Get new HEAD

      const diff = gitSync.getDiff(beforeCommit, afterCommit);

      expect(diff.files).toContain("file1.ts");
      expect(diff.files).toContain("file2.ts");
      expect(diff.additions).toBeGreaterThan(0);
    });
  });

  describe("getCommitList", () => {
    it("should get commit list between refs", () => {
      testRepo = createTestRepo();

      // Create branch with commits
      createBranch(testRepo, "feature");
      commitFile(testRepo, "file1.ts", "content 1", "First commit");
      commitFile(testRepo, "file2.ts", "content 2", "Second commit");

      const gitSync = new GitSyncCli(testRepo);
      const commits = gitSync.getCommitList("main", "feature");

      expect(commits.length).toBeGreaterThan(0);
      expect(commits[0]).toHaveProperty("sha");
      expect(commits[0]).toHaveProperty("message");
      expect(commits[0]).toHaveProperty("author");
      expect(commits[0]).toHaveProperty("email");
      expect(commits[0]).toHaveProperty("timestamp");

      // Verify commit messages
      const messages = commits.map((c) => c.message);
      expect(messages).toContain("Second commit");
      expect(messages).toContain("First commit");
    });
  });

  describe("isWorkingTreeClean", () => {
    it("should detect clean working tree", () => {
      testRepo = createTestRepo();

      const gitSync = new GitSyncCli(testRepo);
      expect(gitSync.isWorkingTreeClean()).toBe(true);
    });

    it("should detect dirty working tree", () => {
      testRepo = createTestRepo();

      // Make uncommitted change to a tracked file (not untracked)
      // Note: untracked files are ignored by isWorkingTreeClean()
      fs.writeFileSync(path.join(testRepo, ".gitkeep"), "modified content");

      const gitSync = new GitSyncCli(testRepo);
      expect(gitSync.isWorkingTreeClean()).toBe(false);
    });

    it("should ignore untracked files", () => {
      testRepo = createTestRepo();

      // Add untracked file - should be ignored
      fs.writeFileSync(path.join(testRepo, "untracked.txt"), "untracked content");

      const gitSync = new GitSyncCli(testRepo);
      expect(gitSync.isWorkingTreeClean()).toBe(true);
    });
  });

  describe("getUncommittedFiles", () => {
    it("should detect uncommitted JSONL changes", () => {
      testRepo = createTestRepo();

      // Create and commit .sudocode directory first
      const sudocodeDir = path.join(testRepo, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      commitFile(
        testRepo,
        ".sudocode/.gitkeep",
        "",
        "Create .sudocode directory"
      );

      // Add uncommitted JSONL file
      fs.writeFileSync(
        path.join(sudocodeDir, "issues.jsonl"),
        '{"id":"i-001","uncommitted":true}\n'
      );

      const gitSync = new GitSyncCli(testRepo);
      const uncommitted = gitSync.getUncommittedFiles();

      expect(uncommitted).toContain(".sudocode/issues.jsonl");
    });

    it("should filter uncommitted files by pattern", () => {
      testRepo = createTestRepo();

      // Create and commit .sudocode directory first
      fs.mkdirSync(path.join(testRepo, ".sudocode"), { recursive: true });
      commitFile(
        testRepo,
        ".sudocode/.gitkeep",
        "",
        "Create .sudocode directory"
      );

      // Add multiple uncommitted files
      fs.writeFileSync(path.join(testRepo, "file1.ts"), "content");
      fs.writeFileSync(path.join(testRepo, "file2.js"), "content");
      fs.writeFileSync(
        path.join(testRepo, ".sudocode/issues.jsonl"),
        "content"
      );

      const gitSync = new GitSyncCli(testRepo);

      // Get all uncommitted
      const all = gitSync.getUncommittedFiles();
      expect(all.length).toBeGreaterThanOrEqual(3);

      // Filter for JSONL only
      const jsonlFiles = all.filter((f) => f.endsWith(".jsonl"));
      expect(jsonlFiles.length).toBeGreaterThan(0);
      expect(jsonlFiles[0]).toContain("issues.jsonl");
    });
  });

  describe("createSafetyTag", () => {
    it("should create a safety tag", () => {
      testRepo = createTestRepo();

      const gitSync = new GitSyncCli(testRepo);
      const currentCommit = gitSync.getMergeBase("main", "main");

      // Create safety tag
      gitSync.createSafetyTag("safety-tag-test", currentCommit);

      // Verify tag exists
      const { execSync } = require("child_process");
      const tags = execSync("git tag -l", { cwd: testRepo, encoding: "utf8" });
      expect(tags).toContain("safety-tag-test");
    });
  });

  describe("checkMergeConflicts", () => {
    it("should detect no conflicts for clean merge", () => {
      testRepo = createTestRepo();

      // Create two branches with different files
      commitFile(testRepo, "file1.ts", "content 1", "Add file1");

      createBranch(testRepo, "branch1");
      commitFile(testRepo, "file2.ts", "content 2", "Add file2 on branch1");

      checkoutBranch(testRepo, "main");
      createBranch(testRepo, "branch2");
      commitFile(testRepo, "file3.ts", "content 3", "Add file3 on branch2");

      const gitSync = new GitSyncCli(testRepo);
      const result = gitSync.checkMergeConflicts("branch1", "branch2");

      expect(result.hasConflicts).toBe(false);
      expect(result.conflictingFiles).toHaveLength(0);
    });

    it("should detect conflicts for conflicting changes", () => {
      testRepo = createTestRepo();

      // Create file on main
      commitFile(testRepo, "shared.ts", "version 1", "Create shared file");

      // branch1: modify file
      createBranch(testRepo, "branch1");
      modifyFile(testRepo, "shared.ts", "version 2", "Update to v2");

      // main: also modify file
      checkoutBranch(testRepo, "main");
      modifyFile(testRepo, "shared.ts", "version 3", "Update to v3");

      const gitSync = new GitSyncCli(testRepo);
      const result = gitSync.checkMergeConflicts("branch1", "main");

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictingFiles).toContain("shared.ts");
    });
  });
});
