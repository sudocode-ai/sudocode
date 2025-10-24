/**
 * Unit tests for ID generator
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateSpecId,
  generateIssueId,
  getConfig,
  updateConfig,
} from "../../src/id-generator.js";
import { initDatabase } from "../../src/db.js";
import { createSpec } from "../../src/operations/specs.js";
import { createIssue } from "../../src/operations/issues.js";
import { VERSION } from "../../src/version.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ID Generator", () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));

    // Initialize database
    const dbPath = path.join(tempDir, "test.db");
    db = initDatabase({ path: dbPath });
  });

  afterEach(() => {
    // Close database
    if (db) {
      db.close();
    }

    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("generateSpecId", () => {
    it("should generate sequential spec IDs based on database", () => {
      const id1 = generateSpecId(db, tempDir);
      createSpec(db, {
        id: id1,
        title: "Test 1",
        file_path: "test1.md",
        content: "",
      });

      const id2 = generateSpecId(db, tempDir);
      createSpec(db, {
        id: id2,
        title: "Test 2",
        file_path: "test2.md",
        content: "",
      });

      const id3 = generateSpecId(db, tempDir);

      expect(id1).toBe("SPEC-001");
      expect(id2).toBe("SPEC-002");
      expect(id3).toBe("SPEC-003");
    });

    it("should use custom prefix from config.json", () => {
      // Create config.json with custom prefix
      const config = {
        version: "1.0.0",
        id_prefix: {
          spec: "custom",
          issue: "issue",
        },
      };
      fs.writeFileSync(
        path.join(tempDir, "config.json"),
        JSON.stringify(config, null, 2)
      );

      const id = generateSpecId(db, tempDir);
      expect(id).toBe("custom-001");
    });

    it("should increment from latest ID in database", () => {
      // Create a spec with a specific ID
      createSpec(db, {
        id: "SPEC-042",
        title: "Test",
        file_path: "test.md",
        content: "",
      });

      const nextId = generateSpecId(db, tempDir);
      expect(nextId).toBe("SPEC-043");
    });

    it("should fallback to count + 1 if ID extraction fails", () => {
      // Create specs with non-standard IDs
      createSpec(db, {
        id: "custom-foo",
        title: "Test 1",
        file_path: "test1.md",
        content: "",
      });
      createSpec(db, {
        id: "custom-bar",
        title: "Test 2",
        file_path: "test2.md",
        content: "",
      });

      const nextId = generateSpecId(db, tempDir);
      expect(nextId).toBe("SPEC-003"); // count is 2, so next is 3
    });
  });

  describe("generateIssueId", () => {
    it("should generate sequential issue IDs based on database", () => {
      const id1 = generateIssueId(db, tempDir);
      createIssue(db, {
        id: id1,
        title: "Test 1",
        description: "",
        content: "",
        status: "open",
      });

      const id2 = generateIssueId(db, tempDir);
      createIssue(db, {
        id: id2,
        title: "Test 2",
        description: "",
        content: "",
        status: "open",
      });

      const id3 = generateIssueId(db, tempDir);

      expect(id1).toBe("ISSUE-001");
      expect(id2).toBe("ISSUE-002");
      expect(id3).toBe("ISSUE-003");
    });

    it("should use custom prefix from config.json", () => {
      const config = {
        version: "1.0.0",
        id_prefix: {
          spec: "spec",
          issue: "bug",
        },
      };
      fs.writeFileSync(
        path.join(tempDir, "config.json"),
        JSON.stringify(config, null, 2)
      );

      const id = generateIssueId(db, tempDir);
      expect(id).toBe("bug-001");
    });

    it("should maintain separate counters for specs and issues", () => {
      const specId1 = generateSpecId(db, tempDir);
      createSpec(db, {
        id: specId1,
        title: "Spec 1",
        file_path: "spec1.md",
        content: "",
      });

      const specId2 = generateSpecId(db, tempDir);
      createSpec(db, {
        id: specId2,
        title: "Spec 2",
        file_path: "spec2.md",
        content: "",
      });

      const issueId = generateIssueId(db, tempDir);
      createIssue(db, {
        id: issueId,
        title: "Issue 1",
        description: "",
        content: "",
        status: "open",
      });

      expect(issueId).toBe("ISSUE-001");

      // Verify counters by generating next IDs
      const nextSpecId = generateSpecId(db, tempDir);
      const nextIssueId = generateIssueId(db, tempDir);
      expect(nextSpecId).toBe("SPEC-003");
      expect(nextIssueId).toBe("ISSUE-002");
    });
  });

  describe("getConfig", () => {
    it("should create default config.json if not exists", () => {
      const config = getConfig(tempDir);

      expect(config.version).toBe(VERSION);
      expect(config.id_prefix.spec).toBe("SPEC");
      expect(config.id_prefix.issue).toBe("ISSUE");
    });

    it("should read existing config.json", () => {
      const existingConfig = {
        version: "1.0.0",
        id_prefix: {
          spec: "test",
          issue: "test",
        },
      };
      fs.writeFileSync(
        path.join(tempDir, "config.json"),
        JSON.stringify(existingConfig, null, 2)
      );

      const config = getConfig(tempDir);
      expect(config.id_prefix.spec).toBe("test");
      expect(config.id_prefix.issue).toBe("test");
    });
  });

  describe("updateConfig", () => {
    it("should update config fields", () => {
      getConfig(tempDir); // Create initial config.json

      updateConfig(tempDir, {
        id_prefix: {
          spec: "updated",
          issue: "updated",
        },
      });

      const config = getConfig(tempDir);
      expect(config.id_prefix.spec).toBe("updated");
      expect(config.id_prefix.issue).toBe("updated");
    });

    it("should preserve unmodified fields", () => {
      getConfig(tempDir); // Create initial config.json

      updateConfig(tempDir, {
        version: "2.0.0",
      });

      const config = getConfig(tempDir);
      expect(config.version).toBe("2.0.0");
      expect(config.id_prefix.spec).toBe("SPEC"); // Unchanged
    });
  });
});
