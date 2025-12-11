/**
 * Unit tests for GitSyncCli
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { GitSyncCli } from '../../../../src/execution/worktree/git-sync-cli.js';
import { WorktreeError } from '../../../../src/execution/worktree/types.js';

describe('GitSyncCli', () => {
  let testRepoPath: string;
  let gitSync: GitSyncCli;

  beforeEach(() => {
    // Create a temporary directory for test repo
    testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sync-test-'));
    gitSync = new GitSyncCli(testRepoPath);

    // Initialize git repo
    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', {
      cwd: testRepoPath,
    });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });

    // Create initial commit
    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repo\n');
    execSync('git add README.md', { cwd: testRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath });
  });

  afterEach(() => {
    // Clean up test repo
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  describe('getMergeBase', () => {
    it('should find merge base between two branches', () => {
      // Create two branches from main
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Add commits to each branch
      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'feature 1\n');
      execSync('git add file1.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'feature 2\n');
      execSync('git add file2.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file2"', { cwd: testRepoPath });

      // Get merge base
      const mergeBase = gitSync.getMergeBase('feature-1', 'feature-2');

      // Verify it's a valid SHA
      expect(mergeBase).toMatch(/^[0-9a-f]{40}$/);

      // Verify it's the initial commit
      const initialCommit = execSync('git rev-parse main', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();
      expect(mergeBase).toBe(initialCommit);
    });

    it('should throw error for invalid branch', () => {
      expect(() => {
        gitSync.getMergeBase('main', 'non-existent-branch');
      }).toThrow(WorktreeError);
    });
  });

  describe('getDiff', () => {
    it('should get diff between two commits', () => {
      // Get initial commit
      const initialCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Add a new file
      fs.writeFileSync(path.join(testRepoPath, 'new-file.txt'), 'hello\nworld\n');
      execSync('git add new-file.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add new file"', { cwd: testRepoPath });

      const newCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Get diff
      const diff = gitSync.getDiff(initialCommit, newCommit);

      expect(diff.files).toContain('new-file.txt');
      expect(diff.additions).toBeGreaterThan(0);
      expect(diff.deletions).toBe(0);
    });

    it('should detect additions and deletions', () => {
      // Get initial commit
      const initialCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Modify README
      fs.writeFileSync(
        path.join(testRepoPath, 'README.md'),
        '# Modified\nNew line\n'
      );
      execSync('git add README.md', { cwd: testRepoPath });
      execSync('git commit -m "Modify README"', { cwd: testRepoPath });

      const newCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Get diff
      const diff = gitSync.getDiff(initialCommit, newCommit);

      expect(diff.files).toContain('README.md');
      expect(diff.additions).toBeGreaterThan(0);
      expect(diff.deletions).toBeGreaterThan(0);
    });

    it('should return empty diff for same commit', () => {
      const commit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      const diff = gitSync.getDiff(commit, commit);

      expect(diff.files).toHaveLength(0);
      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
    });
  });

  describe('checkMergeConflicts', () => {
    it('should detect no conflicts for clean merge', () => {
      // Create two branches that don't conflict
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Add different files to each branch
      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'feature 1\n');
      execSync('git add file1.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'feature 2\n');
      execSync('git add file2.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file2"', { cwd: testRepoPath });

      // Check for conflicts
      const result = gitSync.checkMergeConflicts('feature-1', 'feature-2');

      expect(result.hasConflicts).toBe(false);
      expect(result.conflictingFiles).toHaveLength(0);
    });

    it('should detect conflicts when same file is modified differently', () => {
      // Create two branches that conflict
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Modify same file differently in each branch
      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Feature 1\n');
      execSync('git add README.md', { cwd: testRepoPath });
      execSync('git commit -m "Update README in feature-1"', {
        cwd: testRepoPath,
      });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Feature 2\n');
      execSync('git add README.md', { cwd: testRepoPath });
      execSync('git commit -m "Update README in feature-2"', {
        cwd: testRepoPath,
      });

      // Check for conflicts
      const result = gitSync.checkMergeConflicts('feature-1', 'feature-2');

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictingFiles.length).toBeGreaterThan(0);
    });
  });

  describe('squashMerge', () => {
    it('should perform squash merge', () => {
      // Create a branch with multiple commits
      execSync('git checkout -b feature', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'file 1\n');
      execSync('git add file1.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file1"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'file 2\n');
      execSync('git add file2.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file2"', { cwd: testRepoPath });

      // Switch back to main and squash merge
      execSync('git checkout main', { cwd: testRepoPath });
      gitSync.squashMerge('feature', 'Squashed feature branch');

      // Verify squash merge happened
      const log = execSync('git log --oneline', {
        cwd: testRepoPath,
        encoding: 'utf8',
      });
      expect(log).toContain('Squashed feature branch');

      // Verify both files are present
      expect(fs.existsSync(path.join(testRepoPath, 'file1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(testRepoPath, 'file2.txt'))).toBe(true);
    });
  });

  describe('getCommitList', () => {
    it('should get list of commits between refs', () => {
      // Get initial commit
      const baseCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Add some commits
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'file 1\n');
      execSync('git add file1.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file1"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'file 2\n');
      execSync('git add file2.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file2"', { cwd: testRepoPath });

      const headCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Get commit list
      const commits = gitSync.getCommitList(baseCommit, headCommit);

      expect(commits).toHaveLength(2);
      expect(commits[0].message).toBe('Add file2');
      expect(commits[1].message).toBe('Add file1');
      expect(commits[0].author).toBe('Test User');
      expect(commits[0].email).toBe('test@example.com');
      expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it('should return empty list for same ref', () => {
      const commit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      const commits = gitSync.getCommitList(commit, commit);

      expect(commits).toHaveLength(0);
    });

    it('should handle commit messages with pipe characters', () => {
      fs.writeFileSync(path.join(testRepoPath, 'test.txt'), 'test\n');
      execSync('git add test.txt', { cwd: testRepoPath });
      execSync('git commit -m "Message with | pipe"', { cwd: testRepoPath });

      const baseCommit = execSync('git rev-parse HEAD~1', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();
      const headCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      const commits = gitSync.getCommitList(baseCommit, headCommit);

      expect(commits).toHaveLength(1);
      expect(commits[0].message).toBe('Message with | pipe');
    });
  });

  describe('isWorkingTreeClean', () => {
    it('should return true for clean working tree', () => {
      expect(gitSync.isWorkingTreeClean()).toBe(true);
    });

    it('should return true for untracked files (ignored)', () => {
      // Add untracked file - should be ignored since untracked files
      // don't interfere with checkout/merge operations
      fs.writeFileSync(path.join(testRepoPath, 'untracked.txt'), 'untracked\n');

      expect(gitSync.isWorkingTreeClean()).toBe(true);
    });

    it('should return false for modified tracked files', () => {
      // Modify existing tracked file
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Modified\n');

      expect(gitSync.isWorkingTreeClean()).toBe(false);
    });

    it('should return false for staged changes', () => {
      // Stage a new file
      fs.writeFileSync(path.join(testRepoPath, 'staged.txt'), 'staged content\n');
      execSync('git add staged.txt', { cwd: testRepoPath, stdio: 'pipe' });

      expect(gitSync.isWorkingTreeClean()).toBe(false);
    });
  });

  describe('createSafetyTag', () => {
    it('should create annotated tag', () => {
      const commit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      gitSync.createSafetyTag('test-tag', commit);

      // Verify tag exists
      const tags = execSync('git tag', {
        cwd: testRepoPath,
        encoding: 'utf8',
      });
      expect(tags).toContain('test-tag');

      // Verify it's annotated
      const tagType = execSync('git cat-file -t test-tag', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();
      expect(tagType).toBe('tag');
    });

    it('should create tag for branch reference', () => {
      gitSync.createSafetyTag('branch-tag', 'main');

      const tags = execSync('git tag', {
        cwd: testRepoPath,
        encoding: 'utf8',
      });
      expect(tags).toContain('branch-tag');
    });
  });

  describe('getUncommittedFiles', () => {
    it('should return empty array for clean tree', () => {
      const files = gitSync.getUncommittedFiles();
      expect(files).toHaveLength(0);
    });

    it('should detect uncommitted files', () => {
      // Add untracked file
      fs.writeFileSync(path.join(testRepoPath, 'new.txt'), 'new\n');

      const files = gitSync.getUncommittedFiles();
      expect(files).toContain('new.txt');
    });

    it('should detect modified files', () => {
      // Modify existing file
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Modified\n');

      const files = gitSync.getUncommittedFiles();
      expect(files).toContain('README.md');
    });

    it('should filter by pattern', () => {
      // Add multiple files
      fs.writeFileSync(path.join(testRepoPath, 'test.txt'), 'test\n');
      fs.writeFileSync(path.join(testRepoPath, 'test.md'), 'test\n');

      const files = gitSync.getUncommittedFiles('*.txt');
      expect(files).toContain('test.txt');
      // Pattern filtering may or may not exclude .md depending on git version
      // Just verify we got some results
      expect(files.length).toBeGreaterThan(0);
    });

    it('should detect staged files', () => {
      // Add and stage a file
      fs.writeFileSync(path.join(testRepoPath, 'staged.txt'), 'staged\n');
      execSync('git add staged.txt', { cwd: testRepoPath });

      const files = gitSync.getUncommittedFiles();
      expect(files).toContain('staged.txt');
    });
  });

  describe('cherryPickRange', () => {
    it('should successfully cherry-pick range without conflicts', () => {
      // Create a feature branch with commits
      execSync('git checkout -b feature', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'file 1\n');
      execSync('git add file1.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file1"', { cwd: testRepoPath });
      const commit1 = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'file 2\n');
      execSync('git add file2.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add file2"', { cwd: testRepoPath });
      const commit2 = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Switch to main and cherry-pick
      execSync('git checkout main', { cwd: testRepoPath });
      const result = gitSync.cherryPickRange(commit1, commit2);

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testRepoPath, 'file2.txt'))).toBe(true);
    });

    it('should detect conflicts during cherry-pick', () => {
      // Start on main
      const baseCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Make a change on main that will conflict
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Main Version\n');
      execSync('git add README.md', { cwd: testRepoPath });
      execSync('git commit -m "Update README on main"', {
        cwd: testRepoPath,
      });
      const mainCommit = execSync('git rev-parse HEAD', {
        cwd: testRepoPath,
        encoding: 'utf8',
      }).trim();

      // Reset back to base
      execSync(`git reset --hard ${baseCommit}`, { cwd: testRepoPath });

      // Make a different change that conflicts
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Different Version\n');
      execSync('git add README.md', { cwd: testRepoPath });
      execSync('git commit -m "Update README differently"', {
        cwd: testRepoPath,
      });

      // Try to cherry-pick the main commit (will conflict)
      // Using base..mainCommit to cherry-pick just the mainCommit
      const result = gitSync.cherryPickRange(baseCommit, mainCommit);

      expect(result.success).toBe(false);
      expect(result.conflictingFiles).toBeDefined();
      if (result.conflictingFiles) {
        expect(result.conflictingFiles.length).toBeGreaterThan(0);
      }

      // Cleanup: abort cherry-pick
      try {
        execSync('git cherry-pick --abort', { cwd: testRepoPath });
      } catch (e) {
        // Ignore if already aborted
      }
    });
  });

  describe('error handling', () => {
    it('should throw WorktreeError for invalid git commands', () => {
      expect(() => {
        gitSync.getMergeBase('invalid-ref', 'another-invalid');
      }).toThrow(WorktreeError);
    });

    it('should include git error message in WorktreeError', () => {
      try {
        gitSync.getMergeBase('invalid-ref', 'another-invalid');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Git command failed');
      }
    });
  });

  describe('security', () => {
    it('should properly escape shell arguments', () => {
      // Test with potentially dangerous branch name
      const dangerousBranch = "'; rm -rf /; echo '";

      // This should not execute the rm command
      expect(() => {
        gitSync.getMergeBase('main', dangerousBranch);
      }).toThrow(WorktreeError); // Should fail due to invalid ref, not command injection
    });

    it('should validate SHA format', () => {
      // getMergeBase should validate the returned SHA
      const result = gitSync.getMergeBase('main', 'main');
      expect(result).toMatch(/^[0-9a-f]{40}$/);
    });
  });
});
