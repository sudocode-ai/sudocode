/**
 * Unit tests for init CLI command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../src/db.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

describe("Init Command", () => {
  let tempDir: string;
  let cliPath: string;

  beforeEach(() => {
    // Create temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-init-test-"));

    // Get path to CLI executable
    cliPath = path.join(process.cwd(), "dist", "cli.js");
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("fresh initialization", () => {
    it("should create all required files and directories", () => {
      // Run init command in temp directory
      execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      const sudocodeDir = path.join(tempDir, ".sudocode");

      // Verify directory structure
      expect(fs.existsSync(sudocodeDir)).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, "specs"))).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, "issues"))).toBe(true);

      // Verify files
      expect(fs.existsSync(path.join(sudocodeDir, "cache.db"))).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, "specs.jsonl"))).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, "issues.jsonl"))).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, "config.json"))).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, ".gitignore"))).toBe(true);

      // Verify config content
      const config = JSON.parse(
        fs.readFileSync(path.join(sudocodeDir, "config.json"), "utf8")
      );
      expect(config.id_prefix.spec).toBe("SPEC");
      expect(config.id_prefix.issue).toBe("ISSUE");

      // Verify JSONL files are empty
      expect(fs.readFileSync(path.join(sudocodeDir, "specs.jsonl"), "utf8")).toBe("");
      expect(fs.readFileSync(path.join(sudocodeDir, "issues.jsonl"), "utf8")).toBe("");
    });

    it("should create config with custom prefixes", () => {
      execSync(`node "${cliPath}" init --spec-prefix TEST --issue-prefix BUG`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      const configPath = path.join(tempDir, ".sudocode", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

      expect(config.id_prefix.spec).toBe("TEST");
      expect(config.id_prefix.issue).toBe("BUG");
    });
  });

  describe("preserving existing files", () => {
    beforeEach(() => {
      // Create .sudocode directory for tests
      const sudocodeDir = path.join(tempDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
    });

    it("should preserve existing specs.jsonl", () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      const specsPath = path.join(sudocodeDir, "specs.jsonl");
      const existingContent = '{"id":"SPEC-001","title":"Existing Spec"}\n';

      // Create existing specs.jsonl
      fs.writeFileSync(specsPath, existingContent, "utf8");

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify content is preserved
      expect(fs.readFileSync(specsPath, "utf8")).toBe(existingContent);

      // Verify output mentions preservation
      expect(output).toContain("specs.jsonl");
    });

    it("should preserve existing issues.jsonl", () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      const issuesPath = path.join(sudocodeDir, "issues.jsonl");
      const existingContent = '{"id":"ISSUE-001","title":"Existing Issue"}\n';

      // Create existing issues.jsonl
      fs.writeFileSync(issuesPath, existingContent, "utf8");

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify content is preserved
      expect(fs.readFileSync(issuesPath, "utf8")).toBe(existingContent);

      // Verify output mentions preservation
      expect(output).toContain("issues.jsonl");
    });

    it("should preserve existing cache.db", async () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      const dbPath = path.join(sudocodeDir, "cache.db");

      // Create existing database with data
      const db = initDatabase({ path: dbPath });
      const { createSpec } = await import("../../../src/operations/specs.js");

      createSpec(db, {
        id: "SPEC-001",
        title: "Existing Spec",
        file_path: path.join(sudocodeDir, "specs", "existing.md"),
        content: "# Existing Spec",
        priority: 2,
      });

      db.close();

      // Get file stats before init
      const statsBefore = fs.statSync(dbPath);

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify database still contains the spec
      const dbAfter = initDatabase({ path: dbPath });
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(dbAfter, "SPEC-001");

      expect(spec).not.toBeNull();
      expect(spec?.title).toBe("Existing Spec");

      dbAfter.close();

      // Verify output mentions preservation
      expect(output).toContain("cache.db");
    });

    it("should preserve all existing files", () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      const specsPath = path.join(sudocodeDir, "specs.jsonl");
      const issuesPath = path.join(sudocodeDir, "issues.jsonl");
      const dbPath = path.join(sudocodeDir, "cache.db");

      // Create all existing files
      fs.writeFileSync(specsPath, '{"id":"SPEC-001"}\n', "utf8");
      fs.writeFileSync(issuesPath, '{"id":"ISSUE-001"}\n', "utf8");
      const db = initDatabase({ path: dbPath });
      db.close();

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify all files are preserved
      expect(fs.readFileSync(specsPath, "utf8")).toBe('{"id":"SPEC-001"}\n');
      expect(fs.readFileSync(issuesPath, "utf8")).toBe('{"id":"ISSUE-001"}\n');
      expect(fs.existsSync(dbPath)).toBe(true);

      // Verify output mentions all preserved files
      expect(output).toContain("Preserved existing");
      expect(output).toContain("cache.db");
      expect(output).toContain("specs.jsonl");
      expect(output).toContain("issues.jsonl");
    });
  });

  describe("mixed scenarios", () => {
    it("should create missing files while preserving existing ones", () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Create only specs.jsonl
      const specsPath = path.join(sudocodeDir, "specs.jsonl");
      const existingContent = '{"id":"SPEC-001"}\n';
      fs.writeFileSync(specsPath, existingContent, "utf8");

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify specs.jsonl is preserved
      expect(fs.readFileSync(specsPath, "utf8")).toBe(existingContent);

      // Verify other files are created
      expect(fs.existsSync(path.join(sudocodeDir, "issues.jsonl"))).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, "cache.db"))).toBe(true);
      expect(fs.existsSync(path.join(sudocodeDir, "config.json"))).toBe(true);

      // Verify issues.jsonl is empty (newly created)
      expect(fs.readFileSync(path.join(sudocodeDir, "issues.jsonl"), "utf8")).toBe("");

      // Verify output mentions only the preserved file
      expect(output).toContain("specs.jsonl");
      expect(output).not.toContain("issues.jsonl");
    });
  });
});
