/**
 * Unit tests for readGitStage function
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readGitStage } from "../../src/git-merge.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

describe("readGitStage", () => {
  let tmpDir: string;
  let gitRepo: string;

  beforeEach(() => {
    // Create a temporary directory for git repo
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-stage-test-"));
    gitRepo = tmpDir;

    // Initialize git repo using execFileSync (safe from shell injection)
    execFileSync("git", ["init"], { cwd: gitRepo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: gitRepo });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: gitRepo,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should read base stage (stage 1) during conflict", () => {
    // Create a file and commit it
    const testFile = "test.txt";
    fs.writeFileSync(path.join(gitRepo, testFile), "base content\n");
    execFileSync("git", ["add", testFile], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "base"], { cwd: gitRepo });

    // Create a branch and make a change
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: gitRepo });
    fs.writeFileSync(path.join(gitRepo, testFile), "theirs content\n");
    execFileSync("git", ["add", testFile], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "theirs"], { cwd: gitRepo });

    // Go back to main and make conflicting change
    execFileSync("git", ["checkout", "main"], { cwd: gitRepo });
    fs.writeFileSync(path.join(gitRepo, testFile), "ours content\n");
    execFileSync("git", ["add", testFile], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "ours"], { cwd: gitRepo });

    // Try to merge (will conflict)
    try {
      execFileSync("git", ["merge", "feature"], { cwd: gitRepo });
    } catch (e) {
      // Expected to conflict
    }

    // Now read from git stages
    const originalCwd = process.cwd();
    process.chdir(gitRepo);

    try {
      const base = readGitStage(testFile, 1);
      const ours = readGitStage(testFile, 2);
      const theirs = readGitStage(testFile, 3);

      expect(base).toBe("base content\n");
      expect(ours).toBe("ours content\n");
      expect(theirs).toBe("theirs content\n");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should return null for non-existent stage", () => {
    // Create a file and commit it
    const testFile = "test.txt";
    fs.writeFileSync(path.join(gitRepo, testFile), "content\n");
    execFileSync("git", ["add", testFile], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: gitRepo });

    const originalCwd = process.cwd();
    process.chdir(gitRepo);

    try {
      // No conflict, so stages 1/2/3 don't exist
      const base = readGitStage(testFile, 1);
      expect(base).toBe(null);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should return null for non-existent file", () => {
    const originalCwd = process.cwd();
    process.chdir(gitRepo);

    try {
      const result = readGitStage("nonexistent.txt", 1);
      expect(result).toBe(null);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should handle JSONL content from stages", () => {
    // Create JSONL file
    const testFile = "test.jsonl";
    const baseContent = '{"id":"A","uuid":"uuid-1","title":"Base"}\n';
    const oursContent = '{"id":"A","uuid":"uuid-1","title":"Ours"}\n';
    const theirsContent = '{"id":"A","uuid":"uuid-1","title":"Theirs"}\n';

    fs.writeFileSync(path.join(gitRepo, testFile), baseContent);
    execFileSync("git", ["add", testFile], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "base"], { cwd: gitRepo });

    execFileSync("git", ["checkout", "-b", "feature"], { cwd: gitRepo });
    fs.writeFileSync(path.join(gitRepo, testFile), theirsContent);
    execFileSync("git", ["add", testFile], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "theirs"], { cwd: gitRepo });

    execFileSync("git", ["checkout", "main"], { cwd: gitRepo });
    fs.writeFileSync(path.join(gitRepo, testFile), oursContent);
    execFileSync("git", ["add", testFile], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "ours"], { cwd: gitRepo });

    try {
      execFileSync("git", ["merge", "feature"], { cwd: gitRepo });
    } catch (e) {
      // Expected conflict
    }

    const originalCwd = process.cwd();
    process.chdir(gitRepo);

    try {
      const base = readGitStage(testFile, 1);
      const ours = readGitStage(testFile, 2);
      const theirs = readGitStage(testFile, 3);

      expect(base).toBe(baseContent);
      expect(ours).toBe(oursContent);
      expect(theirs).toBe(theirsContent);

      // Verify can parse as JSON
      const baseEntity = JSON.parse(base!.trim());
      const oursEntity = JSON.parse(ours!.trim());
      const theirsEntity = JSON.parse(theirs!.trim());

      expect(baseEntity.title).toBe("Base");
      expect(oursEntity.title).toBe("Ours");
      expect(theirsEntity.title).toBe("Theirs");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
