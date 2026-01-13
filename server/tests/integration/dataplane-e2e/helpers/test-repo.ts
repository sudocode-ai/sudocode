/**
 * Test Repository Helper
 *
 * Creates and manages temporary git repositories for integration testing.
 * Each test gets an isolated repo with proper git config, initial commit,
 * and sudocode directory structure.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  ISSUES_TABLE,
  ISSUES_INDEXES,
  SPECS_TABLE,
  SPECS_INDEXES,
  RELATIONSHIPS_TABLE,
  RELATIONSHIPS_INDEXES,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";

export interface TestRepo {
  /** Root directory of the test repo */
  path: string;
  /** Path to .sudocode directory */
  sudocodePath: string;
  /** Path to worktrees directory */
  worktreesPath: string;
  /** SQLite database instance */
  db: Database.Database;
  /** Path to the database file */
  dbPath: string;
  /** Clean up the test repo */
  cleanup: () => void;
}

export interface CreateTestRepoOptions {
  /** Enable dataplane integration */
  dataplaneEnabled?: boolean;
  /** Enable cascade on merge (requires dataplaneEnabled) */
  cascadeOnMerge?: boolean;
  /** Use unified database model (dataplane tables in cache.db with prefix) */
  useUnifiedDb?: boolean;
  /** Table prefix for dataplane tables (default: 'dp_') */
  tablePrefix?: string;
  /** Additional config options */
  config?: Record<string, any>;
}

/**
 * Create a fresh test repository with full sudocode setup
 */
export function createTestRepo(
  options: CreateTestRepoOptions = {}
): TestRepo {
  const {
    dataplaneEnabled = true,
    cascadeOnMerge = false,
    useUnifiedDb = false,
    tablePrefix = "dp_",
    config = {},
  } = options;

  // Create temp directory
  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sudocode-dataplane-e2e-")
  );

  // Initialize git repo
  execSync("git init", { cwd: testDir, stdio: "pipe" });
  execSync('git config user.email "test@sudocode.ai"', {
    cwd: testDir,
    stdio: "pipe",
  });
  execSync('git config user.name "Sudocode Test"', {
    cwd: testDir,
    stdio: "pipe",
  });

  // Create initial files
  fs.writeFileSync(
    path.join(testDir, "README.md"),
    "# Test Project\n\nThis is a test project for dataplane e2e tests.\n"
  );

  // Create src directory and index.ts
  fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(testDir, "src", "index.ts"),
    'export const greeting = "Hello, World!";\n'
  );

  // Create initial commit
  execSync("git add .", { cwd: testDir, stdio: "pipe" });
  execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: "pipe" });

  // Create .sudocode directory structure
  const sudocodePath = path.join(testDir, ".sudocode");
  const worktreesPath = path.join(sudocodePath, "worktrees");
  const issuesPath = path.join(sudocodePath, "issues");
  const specsPath = path.join(sudocodePath, "specs");

  fs.mkdirSync(sudocodePath, { recursive: true });
  fs.mkdirSync(worktreesPath, { recursive: true });
  fs.mkdirSync(issuesPath, { recursive: true });
  fs.mkdirSync(specsPath, { recursive: true });

  // Create config.json
  const dataplaneConfig = dataplaneEnabled
    ? useUnifiedDb
      ? {
          enabled: true,
          tablePrefix: tablePrefix,
          cascadeOnMerge: cascadeOnMerge,
          // Don't set dbPath - unified mode uses the shared database
        }
      : {
          enabled: true,
          dbPath: "dataplane.db",
          cascadeOnMerge: cascadeOnMerge,
        }
    : { enabled: false };

  const configContent = {
    version: "0.1.0",
    id_prefix: {
      spec: "TEST-S",
      issue: "TEST-I",
    },
    worktree: {
      worktreeStoragePath: ".sudocode/worktrees",
      autoCreateBranches: true,
      autoDeleteBranches: false,
      branchPrefix: "sudocode",
      cleanupOrphanedWorktreesOnStartup: false,
    },
    dataplane: dataplaneConfig,
    ...config,
  };

  fs.writeFileSync(
    path.join(sudocodePath, "config.json"),
    JSON.stringify(configContent, null, 2)
  );

  // Initialize database
  const dbPath = path.join(sudocodePath, "cache.db");
  const db = initCliDatabase({ path: dbPath });

  // Create required tables
  db.exec(ISSUES_TABLE);
  db.exec(ISSUES_INDEXES);
  db.exec(SPECS_TABLE);
  db.exec(SPECS_INDEXES);
  db.exec(RELATIONSHIPS_TABLE);
  db.exec(RELATIONSHIPS_INDEXES);
  db.exec(EXECUTIONS_TABLE);
  db.exec(EXECUTIONS_INDEXES);

  // Run migrations
  runMigrations(db);

  // Create empty JSONL files
  fs.writeFileSync(path.join(sudocodePath, "issues.jsonl"), "");
  fs.writeFileSync(path.join(sudocodePath, "specs.jsonl"), "");

  const cleanup = () => {
    try {
      db.close();
    } catch (e) {
      // Ignore close errors
    }

    // Kill any git processes still using the directory
    try {
      execSync(`pkill -f "${testDir}" || true`, { stdio: "ignore" });
    } catch (e) {
      // Ignore errors
    }

    // Small delay to let processes terminate
    try {
      execSync("sleep 0.1", { stdio: "ignore" });
    } catch (e) {
      // Ignore errors
    }

    // Remove test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  };

  return {
    path: testDir,
    sudocodePath,
    worktreesPath,
    db,
    dbPath,
    cleanup,
  };
}

/**
 * Create a test issue in the database
 */
export function createTestIssue(
  db: Database.Database,
  data: {
    id: string;
    title: string;
    content?: string;
    status?: string;
    priority?: number;
  }
) {
  const uuid = `uuid-${data.id}-${Date.now()}`;

  db.prepare(
    `
    INSERT INTO issues (id, uuid, title, content, status, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `
  ).run(
    data.id,
    uuid,
    data.title,
    data.content || `Content for ${data.title}`,
    data.status || "open",
    data.priority ?? 2
  );

  return { id: data.id, uuid };
}

/**
 * Get the current HEAD commit hash
 */
export function getHeadCommit(repoPath: string): string {
  return execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(repoPath: string): string {
  return execSync("git branch --show-current", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}

/**
 * Create a commit with file changes
 */
export function createCommit(
  repoPath: string,
  message: string,
  files: Record<string, string>
): string {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  execSync("git add .", { cwd: repoPath, stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { cwd: repoPath, stdio: "pipe" });

  return getHeadCommit(repoPath);
}

/**
 * List all worktrees in a repo
 */
export function listWorktrees(repoPath: string): string[] {
  const output = execSync("git worktree list --porcelain", {
    cwd: repoPath,
    encoding: "utf-8",
  });

  const worktrees: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      worktrees.push(line.replace("worktree ", ""));
    }
  }

  return worktrees;
}

/**
 * Check if a branch exists
 */
export function branchExists(repoPath: string, branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify ${branchName}`, {
      cwd: repoPath,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get commit history for a branch
 */
export function getCommitHistory(
  repoPath: string,
  branch: string = "HEAD",
  limit: number = 10
): Array<{ hash: string; message: string }> {
  const output = execSync(
    `git log ${branch} --format="%H|%s" -n ${limit}`,
    { cwd: repoPath, encoding: "utf-8" }
  );

  return output
    .trim()
    .split("\n")
    .filter((line) => line)
    .map((line) => {
      const [hash, message] = line.split("|");
      return { hash, message };
    });
}

/**
 * Create a relationship between entities
 */
export function createRelationship(
  db: Database.Database,
  data: {
    fromId: string;
    toId: string;
    type: "blocks" | "implements" | "depends-on" | "references" | "discovered-from" | "related";
    fromType?: "issue" | "spec";
    toType?: "issue" | "spec";
  }
) {
  const fromType = data.fromType || "issue";
  const toType = data.toType || "issue";
  const fromUuid = `uuid-${data.fromId}-${Date.now()}`;
  const toUuid = `uuid-${data.toId}-${Date.now()}`;

  db.prepare(
    `
    INSERT INTO relationships (from_id, from_uuid, from_type, to_id, to_uuid, to_type, relationship_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `
  ).run(data.fromId, fromUuid, fromType, data.toId, toUuid, toType, data.type);

  return { fromId: data.fromId, toId: data.toId };
}
