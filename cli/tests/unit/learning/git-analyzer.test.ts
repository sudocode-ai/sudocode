/**
 * Tests for git analyzer
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getCommits,
  analyzeDiff,
  getChangedFiles,
  getCurrentCommit,
  isGitRepo,
  getDiffContent,
  extractPatterns,
} from "../../../src/learning/git-analyzer.js";

const execAsync = promisify(exec);

describe("Git Analyzer", () => {
  let testDir: string;
  let initialCommit: string;

  beforeAll(async () => {
    // Create a temporary git repository for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-analyzer-test-"));

    // Initialize git repo
    await execAsync("git init", { cwd: testDir });
    await execAsync("git config user.email 'test@example.com'", { cwd: testDir });
    await execAsync("git config user.name 'Test User'", { cwd: testDir });
    await execAsync("git config commit.gpgsign false", { cwd: testDir });

    // Create initial file
    fs.writeFileSync(path.join(testDir, "README.md"), "# Test Repo\n");
    await execAsync("git add .", { cwd: testDir });
    await execAsync("git commit -m 'Initial commit'", { cwd: testDir });

    const { stdout } = await execAsync("git rev-parse HEAD", { cwd: testDir });
    initialCommit = stdout.trim();

    // Make some changes
    fs.writeFileSync(
      path.join(testDir, "file1.ts"),
      "console.log('test');\n".repeat(10)
    );
    await execAsync("git add .", { cwd: testDir });
    await execAsync("git commit -m 'Add file1.ts'", { cwd: testDir });

    fs.writeFileSync(
      path.join(testDir, "file2.test.ts"),
      "describe('test', () => {});\n".repeat(5)
    );
    await execAsync("git add .", { cwd: testDir });
    await execAsync("git commit -m 'Add tests'", { cwd: testDir });
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("isGitRepo", () => {
    it("should return true for git repository", async () => {
      const result = await isGitRepo({ cwd: testDir });
      expect(result).toBe(true);
    });

    it("should return false for non-git directory", async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));
      const result = await isGitRepo({ cwd: nonGitDir });
      expect(result).toBe(false);
      fs.rmSync(nonGitDir, { recursive: true });
    });
  });

  describe("getCurrentCommit", () => {
    it("should return current commit SHA", async () => {
      const commit = await getCurrentCommit({ cwd: testDir });
      expect(commit).toBeTruthy();
      expect(commit).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe("getCommits", () => {
    it("should return all commits", async () => {
      const commits = await getCommits(undefined, { cwd: testDir });
      expect(commits.length).toBeGreaterThanOrEqual(3);
      expect(commits[0]).toHaveProperty("sha");
      expect(commits[0]).toHaveProperty("author");
      expect(commits[0]).toHaveProperty("date");
      expect(commits[0]).toHaveProperty("message");
    });

    it("should return commits in range", async () => {
      const currentCommit = await getCurrentCommit({ cwd: testDir });
      const commits = await getCommits(
        { start: initialCommit, end: currentCommit || undefined },
        { cwd: testDir }
      );
      expect(commits.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("analyzeDiff", () => {
    it("should analyze diff statistics", async () => {
      const analysis = await analyzeDiff(
        { start: initialCommit },
        { cwd: testDir }
      );

      expect(analysis.commits.length).toBeGreaterThanOrEqual(2);
      expect(analysis.files_changed).toContain("file1.ts");
      expect(analysis.files_changed).toContain("file2.test.ts");
      expect(analysis.additions).toBeGreaterThan(0);
      expect(analysis.file_changes.size).toBeGreaterThan(0);
    });
  });

  describe("getChangedFiles", () => {
    it("should return list of changed files", async () => {
      const files = await getChangedFiles(
        { start: initialCommit },
        { cwd: testDir }
      );

      expect(files).toContain("file1.ts");
      expect(files).toContain("file2.test.ts");
    });
  });

  describe("getDiffContent", () => {
    it("should return diff content", async () => {
      const diff = await getDiffContent(
        { start: initialCommit },
        { cwd: testDir }
      );

      expect(diff).toContain("file1.ts");
      expect(diff).toContain("file2.test.ts");
      expect(diff).toContain("+"); // Should have additions
    });

    it("should filter by file pattern", async () => {
      const diff = await getDiffContent(
        { start: initialCommit },
        { cwd: testDir, filePattern: "*.test.ts" }
      );

      expect(diff).toContain("file2.test.ts");
    });
  });

  describe("extractPatterns", () => {
    it("should extract patterns from git analysis", async () => {
      const analysis = await analyzeDiff(
        { start: initialCommit },
        { cwd: testDir }
      );

      const patterns = extractPatterns(analysis);

      expect(patterns.primary_areas).toBeDefined();
      expect(patterns.significant_changes).toBeDefined();
      expect(patterns.test_coverage_impact).toBeDefined();

      // Should detect test files
      expect(patterns.test_coverage_impact.some(t =>
        t.includes("file2.test.ts")
      )).toBe(true);
    });
  });
});
