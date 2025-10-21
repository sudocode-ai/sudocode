/**
 * Unit tests for ID generator
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateSpecId,
  generateIssueId,
  getMeta,
  updateMeta,
} from "./id-generator.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ID Generator", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("generateSpecId", () => {
    it("should generate sequential spec IDs", () => {
      const id1 = generateSpecId(tempDir);
      const id2 = generateSpecId(tempDir);
      const id3 = generateSpecId(tempDir);

      expect(id1).toBe("SPEC-001");
      expect(id2).toBe("SPEC-002");
      expect(id3).toBe("SPEC-003");
    });

    it("should use custom prefix from meta.json", () => {
      // Create meta.json with custom prefix
      const meta = {
        version: "1.0.0",
        next_spec_id: 1,
        next_issue_id: 1,
        id_prefix: {
          spec: "custom",
          issue: "issue",
        },
        last_sync: new Date().toISOString(),
        collision_log: [],
      };
      fs.writeFileSync(
        path.join(tempDir, "meta.json"),
        JSON.stringify(meta, null, 2)
      );

      const id = generateSpecId(tempDir);
      expect(id).toBe("custom-001");
    });

    it("should persist counter across multiple calls", () => {
      generateSpecId(tempDir);
      generateSpecId(tempDir);

      const meta = getMeta(tempDir);
      expect(meta.next_spec_id).toBe(3);
    });
  });

  describe("generateIssueId", () => {
    it("should generate sequential issue IDs", () => {
      const id1 = generateIssueId(tempDir);
      const id2 = generateIssueId(tempDir);
      const id3 = generateIssueId(tempDir);

      expect(id1).toBe("ISSUE-001");
      expect(id2).toBe("ISSUE-002");
      expect(id3).toBe("ISSUE-003");
    });

    it("should use custom prefix from meta.json", () => {
      const meta = {
        version: "1.0.0",
        next_spec_id: 1,
        next_issue_id: 1,
        id_prefix: {
          spec: "spec",
          issue: "bug",
        },
        last_sync: new Date().toISOString(),
        collision_log: [],
      };
      fs.writeFileSync(
        path.join(tempDir, "meta.json"),
        JSON.stringify(meta, null, 2)
      );

      const id = generateIssueId(tempDir);
      expect(id).toBe("bug-001");
    });

    it("should maintain separate counters for specs and issues", () => {
      generateSpecId(tempDir);
      generateSpecId(tempDir);
      const issueId = generateIssueId(tempDir);

      expect(issueId).toBe("ISSUE-001");

      const meta = getMeta(tempDir);
      expect(meta.next_spec_id).toBe(3);
      expect(meta.next_issue_id).toBe(2);
    });
  });

  describe("getMeta", () => {
    it("should create default meta.json if not exists", () => {
      const meta = getMeta(tempDir);

      expect(meta.version).toBe("1.0.0");
      expect(meta.next_spec_id).toBe(1);
      expect(meta.next_issue_id).toBe(1);
      expect(meta.id_prefix.spec).toBe("SPEC");
      expect(meta.id_prefix.issue).toBe("ISSUE");
      expect(meta.collision_log).toEqual([]);
    });

    it("should read existing meta.json", () => {
      const existingMeta = {
        version: "1.0.0",
        next_spec_id: 42,
        next_issue_id: 99,
        id_prefix: {
          spec: "test",
          issue: "test",
        },
        last_sync: "2024-01-01T00:00:00.000Z",
        collision_log: [],
      };
      fs.writeFileSync(
        path.join(tempDir, "meta.json"),
        JSON.stringify(existingMeta, null, 2)
      );

      const meta = getMeta(tempDir);
      expect(meta.next_spec_id).toBe(42);
      expect(meta.next_issue_id).toBe(99);
    });
  });

  describe("updateMeta", () => {
    it("should update metadata fields", () => {
      getMeta(tempDir); // Create initial meta.json

      updateMeta(tempDir, {
        id_prefix: {
          spec: "updated",
          issue: "updated",
        },
      });

      const meta = getMeta(tempDir);
      expect(meta.id_prefix.spec).toBe("updated");
      expect(meta.id_prefix.issue).toBe("updated");
    });

    it("should preserve unmodified fields", () => {
      getMeta(tempDir); // Create initial meta.json

      updateMeta(tempDir, {
        next_spec_id: 100,
      });

      const meta = getMeta(tempDir);
      expect(meta.next_spec_id).toBe(100);
      expect(meta.next_issue_id).toBe(1); // Unchanged
    });
  });
});
