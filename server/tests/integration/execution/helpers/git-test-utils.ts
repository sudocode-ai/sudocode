/**
 * Git Test Utilities
 *
 * Helper functions for creating and managing test git repositories
 * for integration testing of worktree sync functionality.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

/**
 * Create a test git repository
 *
 * @returns Path to the created repository
 */
export function createTestRepo(): string {
  // Create temp directory
  const repoPath = mkdtempSync(path.join(tmpdir(), 'git-test-'));

  // Initialize git repo
  execSync('git init', { cwd: repoPath, stdio: 'pipe' });

  // Configure git user (required for commits)
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', {
    cwd: repoPath,
    stdio: 'pipe',
  });

  // Create initial commit (required for branches)
  fs.writeFileSync(path.join(repoPath, '.gitkeep'), '');
  execSync('git add .gitkeep', { cwd: repoPath, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: repoPath, stdio: 'pipe' });

  return repoPath;
}

/**
 * Commit a file to the repository
 *
 * @param repoPath - Path to git repository
 * @param filePath - Relative path to file within repo
 * @param content - File content
 * @param message - Commit message
 */
export function commitFile(
  repoPath: string,
  filePath: string,
  content: string,
  message: string
): void {
  const fullPath = path.join(repoPath, filePath);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(fullPath, content);

  // Stage and commit
  execSync(`git add ${escapeShellArg(filePath)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execSync(`git commit -m ${escapeShellArg(message)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

/**
 * Create a new branch
 *
 * @param repoPath - Path to git repository
 * @param branchName - Name of the branch to create
 * @param fromRef - Optional reference to create branch from (defaults to current HEAD)
 * @param checkout - Whether to checkout the new branch (defaults to true)
 */
export function createBranch(
  repoPath: string,
  branchName: string,
  fromRef?: string,
  checkout = true
): void {
  if (fromRef) {
    execSync(
      `git branch ${escapeShellArg(branchName)} ${escapeShellArg(fromRef)}`,
      { cwd: repoPath, stdio: 'pipe' }
    );
  } else {
    execSync(`git branch ${escapeShellArg(branchName)}`, {
      cwd: repoPath,
      stdio: 'pipe',
    });
  }

  if (checkout) {
    checkoutBranch(repoPath, branchName);
  }
}

/**
 * Checkout a branch
 *
 * @param repoPath - Path to git repository
 * @param branchName - Name of the branch to checkout
 */
export function checkoutBranch(repoPath: string, branchName: string): void {
  execSync(`git checkout ${escapeShellArg(branchName)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

/**
 * Create a git worktree
 *
 * @param repoPath - Path to main git repository
 * @param worktreePath - Path where worktree should be created
 * @param branch - Branch name for the worktree
 */
export function createWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string
): void {
  execSync(
    `git worktree add ${escapeShellArg(worktreePath)} ${escapeShellArg(branch)}`,
    { cwd: repoPath, stdio: 'pipe' }
  );
}

/**
 * Delete a file in the repository
 *
 * @param repoPath - Path to git repository
 * @param filePath - Relative path to file within repo
 * @param message - Commit message
 */
export function deleteFile(
  repoPath: string,
  filePath: string,
  message: string
): void {
  execSync(`git rm ${escapeShellArg(filePath)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execSync(`git commit -m ${escapeShellArg(message)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

/**
 * Modify an existing file
 *
 * @param repoPath - Path to git repository
 * @param filePath - Relative path to file within repo
 * @param content - New file content
 * @param message - Commit message
 */
export function modifyFile(
  repoPath: string,
  filePath: string,
  content: string,
  message: string
): void {
  const fullPath = path.join(repoPath, filePath);

  // Update file
  fs.writeFileSync(fullPath, content);

  // Stage and commit
  execSync(`git add ${escapeShellArg(filePath)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execSync(`git commit -m ${escapeShellArg(message)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

/**
 * Get the current branch name
 *
 * @param repoPath - Path to git repository
 * @returns Current branch name
 */
export function getCurrentBranch(repoPath: string): string {
  const output = execSync('git branch --show-current', {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return output.trim();
}

/**
 * Get the current commit SHA
 *
 * @param repoPath - Path to git repository
 * @returns Current commit SHA
 */
export function getCurrentCommit(repoPath: string): string {
  const output = execSync('git rev-parse HEAD', {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return output.trim();
}

/**
 * Clean up a test repository
 *
 * @param repoPath - Path to repository to delete
 */
export function cleanupTestRepo(repoPath: string): void {
  try {
    // Remove worktrees first if any exist
    try {
      const worktrees = execSync('git worktree list --porcelain', {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: 'pipe',
      });

      const worktreePaths = worktrees
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.substring('worktree '.length))
        .filter((p) => p !== repoPath); // Don't include main repo

      worktreePaths.forEach((worktreePath) => {
        try {
          execSync(`git worktree remove ${escapeShellArg(worktreePath)} --force`, {
            cwd: repoPath,
            stdio: 'pipe',
          });
        } catch {
          // Ignore errors
        }
      });
    } catch {
      // Ignore errors listing worktrees
    }

    // Remove the repository directory
    rmSync(repoPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors during cleanup
    console.warn(`Failed to cleanup test repo ${repoPath}:`, error);
  }
}

/**
 * Escape shell argument for safe command execution
 *
 * @param arg - Argument to escape
 * @returns Escaped argument
 */
function escapeShellArg(arg: string): string {
  // Escape single quotes and wrap in single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Create a test repository with two branches that have conflicting changes
 *
 * @param scenario - Scenario configuration
 * @returns Object with repo path and branch names
 */
export interface ConflictScenario {
  /** Name of the scenario */
  name: string;
  /** Setup function to create branches and conflicts */
  setup: (repoPath: string) => void;
}

/**
 * Setup a basic branched repository (for testing merge base, diffs, etc.)
 *
 * @returns Object with repo path and branch names
 */
export function setupBranchedRepo(): { repo: string; branches: string[] } {
  const repo = createTestRepo();

  // Create two branches from main
  commitFile(repo, 'file1.ts', 'content 1', 'Add file1');

  createBranch(repo, 'branch1');
  commitFile(repo, 'file2.ts', 'content 2', 'Add file2 on branch1');

  checkoutBranch(repo, 'main');
  createBranch(repo, 'branch2');
  commitFile(repo, 'file3.ts', 'content 3', 'Add file3 on branch2');

  checkoutBranch(repo, 'main');

  return { repo, branches: ['main', 'branch1', 'branch2'] };
}

/**
 * Create a binary file (PNG image)
 *
 * @param repoPath - Path to git repository
 * @param filePath - Relative path to file within repo
 * @param message - Commit message
 */
export function createBinaryFile(
  repoPath: string,
  filePath: string,
  message: string
): void {
  const fullPath = path.join(repoPath, filePath);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create a minimal PNG file (1x1 black pixel)
  const pngData = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001010300000025db56ca00000003504c5445000000a77a3dda0000000174524e530040e6d8660000000a4944415408d76360000000020001e221bc330000000049454e44ae426082',
    'hex'
  );
  fs.writeFileSync(fullPath, pngData);

  // Stage and commit
  execSync(`git add ${escapeShellArg(filePath)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execSync(`git commit -m ${escapeShellArg(message)}`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
}
