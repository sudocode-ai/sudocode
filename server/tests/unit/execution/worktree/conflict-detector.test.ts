/**
 * Unit tests for ConflictDetector
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { ConflictDetector } from '../../../../src/execution/worktree/conflict-detector.js';

describe('ConflictDetector', () => {
  let testRepoPath: string;
  let detector: ConflictDetector;

  beforeEach(() => {
    // Create a temporary directory for test repo
    testRepoPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'conflict-detector-test-')
    );
    detector = new ConflictDetector(testRepoPath);

    // Initialize git repo
    execSync('git init -b main', { cwd: testRepoPath });
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

  describe('detectConflicts', () => {
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

      // Detect conflicts
      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.hasConflicts).toBe(false);
      expect(report.codeConflicts).toHaveLength(0);
      expect(report.jsonlConflicts).toHaveLength(0);
      expect(report.totalFiles).toBe(0);
      expect(report.summary).toBe('No conflicts detected');
    });

    it('should detect JSONL conflicts only', () => {
      // Create .sudocode directory in main and commit it
      const sudocodeDir = path.join(testRepoPath, '.sudocode');
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir, '.gitkeep'), '');
      execSync('git add .sudocode/.gitkeep', { cwd: testRepoPath });
      execSync('git commit -m "Add .sudocode directory"', {
        cwd: testRepoPath,
      });

      // Create two branches with conflicting issues.jsonl
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Add issues.jsonl in feature-1
      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(sudocodeDir, 'issues.jsonl'),
        '{"id":"i-001","title":"Issue 1"}\n'
      );
      execSync('git add .sudocode/issues.jsonl', { cwd: testRepoPath });
      execSync('git commit -m "Add issue 1"', { cwd: testRepoPath });

      // Modify issues.jsonl differently in feature-2
      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(sudocodeDir, 'issues.jsonl'),
        '{"id":"i-002","title":"Issue 2"}\n'
      );
      execSync('git add .sudocode/issues.jsonl', { cwd: testRepoPath });
      execSync('git commit -m "Add issue 2"', { cwd: testRepoPath });

      // Detect conflicts
      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts).toHaveLength(1);
      expect(report.jsonlConflicts[0].entityType).toBe('issue');
      expect(report.jsonlConflicts[0].canAutoResolve).toBe(true);
      expect(report.codeConflicts).toHaveLength(0);
      expect(report.summary).toContain('JSONL conflict');
      expect(report.summary).toContain('auto-resolvable');
    });

    it('should detect code conflicts only', () => {
      // Create two branches with conflicting code
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Modify README differently in each branch
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

      // Detect conflicts
      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.hasConflicts).toBe(true);
      expect(report.codeConflicts).toHaveLength(1);
      expect(report.codeConflicts[0].conflictType).toBe('content');
      expect(report.codeConflicts[0].canAutoResolve).toBe(false);
      expect(report.codeConflicts[0].description).toBeTruthy();
      expect(report.codeConflicts[0].resolutionStrategy).toBeTruthy();
      expect(report.jsonlConflicts).toHaveLength(0);
      expect(report.summary).toContain('code conflict');
      expect(report.summary).toContain('manual resolution');
    });

    it('should detect mixed JSONL and code conflicts', () => {
      // Create .sudocode directory in main
      const sudocodeDir = path.join(testRepoPath, '.sudocode');
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir, '.gitkeep'), '');
      execSync('git add .sudocode/.gitkeep', { cwd: testRepoPath });
      execSync('git commit -m "Add .sudocode directory"', {
        cwd: testRepoPath,
      });

      // Create two branches with both types of conflicts
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Modify both README and issues.jsonl in feature-1
      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Feature 1\n');
      fs.writeFileSync(
        path.join(sudocodeDir, 'issues.jsonl'),
        '{"id":"i-001","title":"Issue 1"}\n'
      );
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Update in feature-1"', { cwd: testRepoPath });

      // Modify both differently in feature-2
      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Feature 2\n');
      fs.writeFileSync(
        path.join(sudocodeDir, 'issues.jsonl'),
        '{"id":"i-002","title":"Issue 2"}\n'
      );
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Update in feature-2"', { cwd: testRepoPath });

      // Detect conflicts
      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts.length).toBeGreaterThan(0);
      expect(report.codeConflicts.length).toBeGreaterThan(0);
      expect(report.totalFiles).toBe(
        report.jsonlConflicts.length + report.codeConflicts.length
      );
      expect(report.summary).toContain('JSONL');
      expect(report.summary).toContain('code');
    });

    it('should classify specs.jsonl as spec entity type', () => {
      // Create .sudocode directory in main
      const sudocodeDir = path.join(testRepoPath, '.sudocode');
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir, '.gitkeep'), '');
      execSync('git add .sudocode/.gitkeep', { cwd: testRepoPath });
      execSync('git commit -m "Add .sudocode directory"', {
        cwd: testRepoPath,
      });

      // Create two branches with conflicting specs.jsonl
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Add specs.jsonl in feature-1
      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(sudocodeDir, 'specs.jsonl'),
        '{"id":"s-001","title":"Spec 1"}\n'
      );
      execSync('git add .sudocode/specs.jsonl', { cwd: testRepoPath });
      execSync('git commit -m "Add spec 1"', { cwd: testRepoPath });

      // Modify specs.jsonl differently in feature-2
      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(sudocodeDir, 'specs.jsonl'),
        '{"id":"s-002","title":"Spec 2"}\n'
      );
      execSync('git add .sudocode/specs.jsonl', { cwd: testRepoPath });
      execSync('git commit -m "Add spec 2"', { cwd: testRepoPath });

      // Detect conflicts
      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.hasConflicts).toBe(true);
      expect(report.jsonlConflicts).toHaveLength(1);
      expect(report.jsonlConflicts[0].entityType).toBe('spec');
      expect(report.jsonlConflicts[0].canAutoResolve).toBe(true);
    });

    it('should handle multiple conflicting files', () => {
      // Create base files first
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'base 1\n');
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'base 2\n');
      execSync('git add file1.txt file2.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add base files"', { cwd: testRepoPath });

      // Create two branches with multiple conflicts
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      // Modify multiple files in feature-1
      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Feature 1\n');
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'content 1\n');
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'content 1\n');
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Update multiple files in feature-1"', {
        cwd: testRepoPath,
      });

      // Modify same files differently in feature-2
      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Feature 2\n');
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'content 2\n');
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'content 2\n');
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Update multiple files in feature-2"', {
        cwd: testRepoPath,
      });

      // Detect conflicts
      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.hasConflicts).toBe(true);
      expect(report.codeConflicts.length).toBeGreaterThanOrEqual(1);
      expect(report.totalFiles).toBe(report.codeConflicts.length);
    });

    it('should generate correct summary for plural conflicts', () => {
      // Create base files first
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'base1\n');
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'base2\n');
      execSync('git add file1.txt file2.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add base files"', { cwd: testRepoPath });

      // Create multiple conflicts
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'v1\n');
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'v1\n');
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Update files v1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'file1.txt'), 'v2\n');
      fs.writeFileSync(path.join(testRepoPath, 'file2.txt'), 'v2\n');
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Update files v2"', { cwd: testRepoPath });

      const report = detector.detectConflicts('feature-1', 'feature-2');

      // Should have conflicts - check summary makes sense
      expect(report.hasConflicts).toBe(true);
      expect(report.summary).toBeTruthy();
    });

    it('should generate correct summary for singular conflict', () => {
      // Create single conflict
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# V1\n');
      execSync('git add README.md', { cwd: testRepoPath });
      execSync('git commit -m "Update v1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# V2\n');
      execSync('git add README.md', { cwd: testRepoPath });
      execSync('git commit -m "Update v2"', { cwd: testRepoPath });

      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.summary).toContain('conflict'); // should be singular
      expect(report.summary).not.toMatch(/\d+ code conflicts/); // no 's' for single
    });
  });

  describe('conflict classification', () => {
    it('should identify content conflicts', () => {
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'code.ts'), 'const x = 1;\n');
      execSync('git add code.ts', { cwd: testRepoPath });
      execSync('git commit -m "Set x to 1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'code.ts'), 'const x = 2;\n');
      execSync('git add code.ts', { cwd: testRepoPath });
      execSync('git commit -m "Set x to 2"', { cwd: testRepoPath });

      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.codeConflicts[0].conflictType).toBe('content');
      expect(report.codeConflicts[0].description).toContain('modified');
    });

    it('should provide resolution strategies for code conflicts', () => {
      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'app.ts'), 'app v1\n');
      execSync('git add app.ts', { cwd: testRepoPath });
      execSync('git commit -m "App v1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'app.ts'), 'app v2\n');
      execSync('git add app.ts', { cwd: testRepoPath });
      execSync('git commit -m "App v2"', { cwd: testRepoPath });

      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.codeConflicts[0].resolutionStrategy).toBeDefined();
      expect(report.codeConflicts[0].resolutionStrategy).toBeTruthy();
    });
  });

  describe('edge cases', () => {
    it('should handle conflicts in nested directories', () => {
      // Create nested directory structure in main
      const nestedDir = path.join(testRepoPath, 'src', 'components');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(nestedDir, '.gitkeep'), '');
      execSync('git add src/', { cwd: testRepoPath });
      execSync('git commit -m "Add src directory"', { cwd: testRepoPath });

      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(nestedDir, 'Button.tsx'),
        'export const Button = () => <button>V1</button>;'
      );
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Button v1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(nestedDir, 'Button.tsx'),
        'export const Button = () => <button>V2</button>;'
      );
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Button v2"', { cwd: testRepoPath });

      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.hasConflicts).toBe(true);
      expect(report.codeConflicts.length).toBeGreaterThan(0);
      expect(report.codeConflicts[0].filePath).toContain('src/components');
    });

    it('should handle .sudocode directory at different paths', () => {
      // Test that .sudocode can be in subdirectories - create in main first
      const sudocodeDir = path.join(testRepoPath, 'project', '.sudocode');
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir, '.gitkeep'), '');
      execSync('git add project/', { cwd: testRepoPath });
      execSync('git commit -m "Add project/.sudocode"', { cwd: testRepoPath });

      execSync('git branch feature-1', { cwd: testRepoPath });
      execSync('git branch feature-2', { cwd: testRepoPath });

      execSync('git checkout feature-1', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(sudocodeDir, 'issues.jsonl'),
        '{"id":"i-001"}\n'
      );
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Issue 1"', { cwd: testRepoPath });

      execSync('git checkout feature-2', { cwd: testRepoPath });
      fs.writeFileSync(
        path.join(sudocodeDir, 'issues.jsonl'),
        '{"id":"i-002"}\n'
      );
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Issue 2"', { cwd: testRepoPath });

      const report = detector.detectConflicts('feature-1', 'feature-2');

      expect(report.jsonlConflicts.length).toBeGreaterThan(0);
      expect(report.jsonlConflicts[0].canAutoResolve).toBe(true);
    });
  });
});
