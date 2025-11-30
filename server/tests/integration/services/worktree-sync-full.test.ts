/**
 * Comprehensive Integration Tests for Phase 2 Squash Sync
 *
 * Tests the complete squash sync workflow from preview to completion,
 * including all edge cases and error scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type Database from "better-sqlite3";
import { WorktreeSyncService } from "../../../src/services/worktree-sync-service.js";
import { GitSyncCli } from "../../../src/execution/worktree/git-sync-cli.js";
import {
  createTestRepo,
  commitFile,
  checkoutBranch,
  modifyFile,
  cleanupTestRepo,
  getCurrentCommit,
} from "../execution/helpers/git-test-utils.js";
import {
  createTestDatabase,
  createExecution,
  updateExecution,
} from "../execution/helpers/test-setup.js";

/**
 * Setup full test environment with repo, worktree, execution, and database
 */
function setupFullTestEnvironment() {
  // Create test repo
  const repo = createTestRepo();

  // Rename default branch to main (createTestRepo creates main branch)
  try {
    execSync("git branch -M main", { cwd: repo, stdio: "pipe" });
  } catch {
    // Branch already named main
  }

  // Create test database
  const db = createTestDatabase();

  // Create issue first (required for foreign key)
  db.prepare(`
    INSERT INTO issues (uuid, id, title, content, status, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run("uuid-i-test", "i-test", "Test issue", "", "open", 1);

  // Create execution record
  const execution = createExecution(db, {
    id: "exec-test-1",
    issue_id: "i-test",
    target_branch: "main",
    branch_name: "worktree-branch",
    status: "completed",
  });

  // Create worktree
  const worktreePath = path.join(repo, "..", "worktree");
  execSync(`git worktree add ${worktreePath} -b worktree-branch`, {
    cwd: repo,
    stdio: "pipe",
  });

  // Update execution with worktree path
  updateExecution(db, execution.id, { worktree_path: worktreePath });

  // Create GitSyncCli for verification
  const gitSync = new GitSyncCli(repo);

  return {
    repo,
    worktree: worktreePath,
    execution: { ...execution, worktree_path: worktreePath },
    db,
    gitSync,
  };
}

/**
 * Helper to create issue entity
 */
function createIssue(id: string, title: string, status = "open") {
  return {
    id,
    uuid: `uuid-${id}`,
    title,
    status,
    content: "",
    priority: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Helper to create spec entity
 */
function createSpec(id: string, title: string) {
  return {
    id,
    uuid: `uuid-${id}`,
    title,
    content: "",
    priority: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("Full squash sync workflow - happy path", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should complete full sync from preview to database update", async () => {
    // Make changes in worktree
    commitFile(testEnv.worktree, "feature.ts", "new feature", "Add feature");
    commitFile(testEnv.worktree, "test.ts", "tests", "Add tests");

    // Step 1: Preview
    const preview = await service.previewSync(testEnv.execution.id);
    expect(preview.canSync).toBe(true);
    expect(preview.commits.length).toBe(2);
    expect(preview.diff.files).toContain("feature.ts");
    expect(preview.diff.files).toContain("test.ts");
    expect(preview.conflicts.hasConflicts).toBe(false);

    // Step 2: Squash sync
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);
    expect(result.finalCommit).toBeDefined();
    expect(result.filesChanged).toBe(2);

    // Step 3: Verify commit created
    const commits = testEnv.gitSync.getCommitList("HEAD~1", "HEAD");
    expect(commits.length).toBe(1);
    expect(commits[0].message).toContain("Squash merge");

    // Step 4: Verify files synced
    expect(fs.existsSync(path.join(testEnv.repo, "feature.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testEnv.repo, "test.ts"))).toBe(true);
  });
});

describe("JSONL conflict resolution", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should auto-resolve JSONL conflicts during squash", async () => {
    // Create base JSONL file in main BEFORE the worktree was created
    // Need to add it to both branches
    const baseIssue = createIssue("i-001", "Base issue");

    // Add to main
    commitFile(
      testEnv.repo,
      ".sudocode/issues.jsonl",
      JSON.stringify(baseIssue) + "\n",
      "Add base issue"
    );

    // Merge main into worktree to get the base file
    execSync("git merge main", {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });

    // Worktree: add new issue (append-only)
    const worktreeIssue = createIssue("i-002", "Worktree issue");
    const worktreeContent = fs.readFileSync(
      path.join(testEnv.worktree, ".sudocode/issues.jsonl"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(testEnv.worktree, ".sudocode/issues.jsonl"),
      worktreeContent + JSON.stringify(worktreeIssue) + "\n"
    );
    execSync("git add .sudocode/issues.jsonl", {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });
    execSync('git commit -m "Add worktree issue"', {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });

    // Main: add code file (no JSONL changes)
    checkoutBranch(testEnv.repo, "main");
    commitFile(testEnv.repo, "main-feature.ts", "main feature", "Add main feature");

    // Squash should succeed
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);

    // Verify merged JSONL contains both issues
    const issuesContent = fs.readFileSync(
      path.join(testEnv.repo, ".sudocode/issues.jsonl"),
      "utf8"
    );
    expect(issuesContent).toContain("i-001");
    expect(issuesContent).toContain("i-002");
    expect(issuesContent).not.toContain("<<<<<<<"); // No conflict markers
  });
});

describe("Uncommitted JSONL handling", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should include uncommitted JSONL changes in sync", async () => {
    // Commit some changes
    commitFile(testEnv.worktree, "feature.ts", "code", "Add feature");

    // Create .sudocode directory and commit it first
    const sudocodeDir = path.join(testEnv.worktree, ".sudocode");
    fs.mkdirSync(sudocodeDir, { recursive: true });
    fs.writeFileSync(path.join(sudocodeDir, ".gitkeep"), "");
    execSync("git add .sudocode/.gitkeep", {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });
    execSync('git commit -m "Add .sudocode directory"', {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });

    // Add uncommitted JSONL changes
    const issue = createIssue("i-new", "Uncommitted issue");
    fs.writeFileSync(
      path.join(sudocodeDir, "issues.jsonl"),
      JSON.stringify(issue) + "\n"
    );

    // Preview should detect uncommitted JSONL
    const preview = await service.previewSync(testEnv.execution.id);
    expect(preview.uncommittedJSONLChanges).toContain(".sudocode/issues.jsonl");
    expect(
      preview.warnings.some((w) => w.includes("uncommitted JSONL"))
    ).toBe(true);

    // Squash should include them
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);
    expect(result.uncommittedJSONLIncluded).toBe(true);

    // Verify JSONL synced
    const issuesContent = fs.readFileSync(
      path.join(testEnv.repo, ".sudocode/issues.jsonl"),
      "utf8"
    );
    expect(issuesContent).toContain("i-new");
  });
});

describe("Code conflict handling", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should block sync when code conflicts exist", async () => {
    // Create initial file in main
    commitFile(testEnv.repo, "shared.ts", "version 1", "Initial version");

    // Worktree: modify
    commitFile(testEnv.worktree, "shared.ts", "version 2", "Update to v2");

    // Main: also modify (create conflict)
    checkoutBranch(testEnv.repo, "main");
    modifyFile(testEnv.repo, "shared.ts", "version 3", "Update to v3");

    // Preview should detect code conflict
    const preview = await service.previewSync(testEnv.execution.id);
    expect(preview.conflicts.codeConflicts.length).toBe(1);
    expect(preview.canSync).toBe(false);
    expect(
      preview.warnings.some((w) => w.includes("code conflict"))
    ).toBe(true);

    // Squash should fail gracefully
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("code conflict");
  });
});

describe("Safety and rollback", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should create safety tag before sync", async () => {
    commitFile(testEnv.worktree, "feature.ts", "code", "Add feature");

    const beforeTags = execSync("git tag -l", {
      cwd: testEnv.repo,
      encoding: "utf8",
    });

    await service.squashSync(testEnv.execution.id);

    const afterTags = execSync("git tag -l", {
      cwd: testEnv.repo,
      encoding: "utf8",
    });
    expect(afterTags).toContain(`sudocode-sync-before-${testEnv.execution.id}`);
    expect(afterTags).not.toBe(beforeTags);
  });
});

describe("Validation failures", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should fail if local working tree is dirty", async () => {
    // Make local tree dirty
    fs.writeFileSync(path.join(testEnv.repo, "dirty.txt"), "uncommitted");

    const preview = await service.previewSync(testEnv.execution.id);
    expect(preview.canSync).toBe(false);
    expect(
      preview.warnings.some((w) => w.includes("uncommitted changes"))
    ).toBe(true);
  });

  it("should fail if worktree missing", async () => {
    // Remove worktree
    fs.rmSync(testEnv.worktree, { recursive: true, force: true });

    const preview = await service.previewSync(testEnv.execution.id);
    expect(preview.canSync).toBe(false);
    expect(
      preview.warnings.some((w) => w.includes("no longer exists"))
    ).toBe(true);
  });
});

describe("Multiple JSONL files", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should handle multiple JSONL files in sync", async () => {
    // Create base JSONL files in main
    const baseIssue = createIssue("i-base", "Base issue");
    const baseSpec = createSpec("s-base", "Base spec");

    commitFile(
      testEnv.repo,
      ".sudocode/issues.jsonl",
      JSON.stringify(baseIssue) + "\n",
      "Add base issues"
    );
    commitFile(
      testEnv.repo,
      ".sudocode/specs.jsonl",
      JSON.stringify(baseSpec) + "\n",
      "Add base specs"
    );

    // Merge main into worktree to get the base files
    execSync("git merge main", {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });

    // Worktree: add new entities (append-only)
    const worktreeIssue = createIssue("i-001", "Issue from worktree");
    const worktreeSpec = createSpec("s-001", "Spec from worktree");

    const issuesContent = fs.readFileSync(
      path.join(testEnv.worktree, ".sudocode/issues.jsonl"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(testEnv.worktree, ".sudocode/issues.jsonl"),
      issuesContent + JSON.stringify(worktreeIssue) + "\n"
    );

    const specsContent = fs.readFileSync(
      path.join(testEnv.worktree, ".sudocode/specs.jsonl"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(testEnv.worktree, ".sudocode/specs.jsonl"),
      specsContent + JSON.stringify(worktreeSpec) + "\n"
    );

    execSync("git add .sudocode/issues.jsonl .sudocode/specs.jsonl", {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });
    execSync('git commit -m "Add worktree entities"', {
      cwd: testEnv.worktree,
      stdio: "pipe",
    });

    // Main: add code file (no JSONL changes)
    checkoutBranch(testEnv.repo, "main");
    commitFile(testEnv.repo, "main-code.ts", "code", "Add main code");

    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);

    // Verify both JSONL files were synced
    const issues = fs.readFileSync(
      path.join(testEnv.repo, ".sudocode/issues.jsonl"),
      "utf8"
    );
    const specs = fs.readFileSync(
      path.join(testEnv.repo, ".sudocode/specs.jsonl"),
      "utf8"
    );

    expect(issues).toContain("i-base");
    expect(issues).toContain("i-001");
    expect(specs).toContain("s-base");
    expect(specs).toContain("s-001");
  });
});

describe("Large changesets", () => {
  let testEnv: ReturnType<typeof setupFullTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupFullTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it("should handle syncing 50+ files", async () => {
    // Create 50 files in worktree
    for (let i = 0; i < 50; i++) {
      commitFile(
        testEnv.worktree,
        `file${i}.ts`,
        `content ${i}`,
        `Add file ${i}`
      );
    }

    const preview = await service.previewSync(testEnv.execution.id);
    expect(preview.commits.length).toBe(50);
    expect(preview.diff.files.length).toBe(50);

    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);
    expect(result.filesChanged).toBe(50);

    // Verify all files exist
    for (let i = 0; i < 50; i++) {
      expect(fs.existsSync(path.join(testEnv.repo, `file${i}.ts`))).toBe(true);
    }
  });
});
