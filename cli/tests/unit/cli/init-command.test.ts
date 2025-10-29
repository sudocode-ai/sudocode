/**
 * Unit tests for init CLI command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../src/db.js";
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

  describe("importing from existing JSONL files", () => {
    it("should import specs from existing specs.jsonl on init", async () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Create specs.jsonl with valid JSONL data
      const specsPath = path.join(sudocodeDir, "specs.jsonl");
      const specData = {
        id: "SPEC-001",
        uuid: "test-uuid-001",
        title: "Test Spec",
        file_path: "specs/test-spec.md",
        content: "# Test Spec Content",
        priority: 2,
        parent_id: null,
        archived: false,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["test"],
        relationships: [],
      };
      fs.writeFileSync(specsPath, JSON.stringify(specData) + "\n", "utf8");

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify import happened
      expect(output).toContain("Importing from existing JSONL files");
      expect(output).toContain("Specs: 1 added");

      // Verify data is in database
      const dbPath = path.join(sudocodeDir, "cache.db");
      const db = initDatabase({ path: dbPath });
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "SPEC-001");

      expect(spec).not.toBeNull();
      expect(spec?.title).toBe("Test Spec");
      expect(spec?.content).toBe("# Test Spec Content");

      db.close();
    });

    it("should import issues from existing issues.jsonl on init", async () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Create issues.jsonl with valid JSONL data
      const issuesPath = path.join(sudocodeDir, "issues.jsonl");
      const issueData = {
        id: "ISSUE-001",
        uuid: "test-issue-uuid-001",
        title: "Test Issue",
        content: "Test issue content",
        status: "open",
        priority: 2,
        assignee: null,
        parent_id: null,
        archived: false,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
        tags: ["bug"],
        relationships: [],
        feedback: [],
      };
      fs.writeFileSync(issuesPath, JSON.stringify(issueData) + "\n", "utf8");

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify import happened
      expect(output).toContain("Importing from existing JSONL files");
      expect(output).toContain("Issues: 1 added");

      // Verify data is in database
      const dbPath = path.join(sudocodeDir, "cache.db");
      const db = initDatabase({ path: dbPath });
      const { getIssue } = await import("../../../src/operations/issues.js");
      const issue = getIssue(db, "ISSUE-001");

      expect(issue).not.toBeNull();
      expect(issue?.title).toBe("Test Issue");
      expect(issue?.status).toBe("open");

      db.close();
    });

    it("should import both specs and issues from JSONL files", async () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Create specs.jsonl
      const specsPath = path.join(sudocodeDir, "specs.jsonl");
      const specData = {
        id: "SPEC-002",
        uuid: "test-uuid-002",
        title: "Another Spec",
        file_path: "specs/another-spec.md",
        content: "# Another Spec",
        priority: 1,
        parent_id: null,
        archived: false,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        relationships: [],
      };
      fs.writeFileSync(specsPath, JSON.stringify(specData) + "\n", "utf8");

      // Create issues.jsonl
      const issuesPath = path.join(sudocodeDir, "issues.jsonl");
      const issueData = {
        id: "ISSUE-002",
        uuid: "test-issue-uuid-002",
        title: "Another Issue",
        content: "Another issue content",
        status: "in_progress",
        priority: 1,
        assignee: "test-user",
        parent_id: null,
        archived: false,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
        tags: [],
        relationships: [],
        feedback: [],
      };
      fs.writeFileSync(issuesPath, JSON.stringify(issueData) + "\n", "utf8");

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify import happened for both
      expect(output).toContain("Importing from existing JSONL files");
      expect(output).toContain("Specs: 1 added");
      expect(output).toContain("Issues: 1 added");

      // Verify data is in database
      const dbPath = path.join(sudocodeDir, "cache.db");
      const db = initDatabase({ path: dbPath });
      const { getSpec } = await import("../../../src/operations/specs.js");
      const { getIssue } = await import("../../../src/operations/issues.js");

      const spec = getSpec(db, "SPEC-002");
      expect(spec).not.toBeNull();
      expect(spec?.title).toBe("Another Spec");

      const issue = getIssue(db, "ISSUE-002");
      expect(issue).not.toBeNull();
      expect(issue?.title).toBe("Another Issue");
      expect(issue?.status).toBe("in_progress");

      db.close();
    });

    it("should not import when JSONL files are empty", () => {
      const sudocodeDir = path.join(tempDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Create empty JSONL files
      const specsPath = path.join(sudocodeDir, "specs.jsonl");
      const issuesPath = path.join(sudocodeDir, "issues.jsonl");
      fs.writeFileSync(specsPath, "", "utf8");
      fs.writeFileSync(issuesPath, "", "utf8");

      // Run init
      const output = execSync(`node "${cliPath}" init`, {
        cwd: tempDir,
        encoding: "utf8",
      });

      // Verify no import message
      expect(output).not.toContain("Importing from existing JSONL files");
    });
  });
});
