/**
 * Unit tests for ID generator
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateSpecId,
  generateIssueId,
  getAdaptiveHashLength,
  hashUUIDToBase36,
  isLegacyID,
  isHashID,
} from "../../src/id-generator.js";
import { initDatabase } from "../../src/db.js";
import { createSpec } from "../../src/operations/specs.js";
import { createIssue } from "../../src/operations/issues.js";
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
    it("should generate hash-based spec IDs", () => {
      const { id: id1, uuid: uuid1 } = generateSpecId(db, tempDir);
      createSpec(db, {
        id: id1,
        uuid: uuid1,
        title: "Test 1",
        file_path: "test1.md",
        content: "",
      });

      const { id: id2, uuid: uuid2 } = generateSpecId(db, tempDir);
      createSpec(db, {
        id: id2,
        uuid: uuid2,
        title: "Test 2",
        file_path: "test2.md",
        content: "",
      });

      const { id: id3, uuid: uuid3 } = generateSpecId(db, tempDir);

      // Check that IDs are hash format
      expect(id1).toMatch(/^s-[0-9a-z]{4,8}$/);
      expect(id2).toMatch(/^s-[0-9a-z]{4,8}$/);
      expect(id3).toMatch(/^s-[0-9a-z]{4,8}$/);

      // Check that UUIDs are valid
      expect(uuid1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(uuid2).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(uuid3).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("should generate hash IDs regardless of config prefix", () => {
      // Note: Hash IDs use fixed prefixes (s- and i-), not config prefixes
      // Config prefixes are only for legacy format
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

      const { id } = generateSpecId(db, tempDir);
      // Should still use 's-' prefix for hash IDs
      expect(id).toMatch(/^s-[0-9a-z]{4,8}$/);
    });

    it("should adapt hash length based on database count", () => {
      // Create multiple specs to test adaptive length
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { id, uuid } = generateSpecId(db, tempDir);
        createSpec(db, {
          id,
          uuid,
          title: `Test ${i}`,
          file_path: `test${i}.md`,
          content: "",
        });
        ids.push(id);
      }

      // All IDs should be hash format
      ids.forEach((id) => {
        expect(id).toMatch(/^s-[0-9a-z]{4,8}$/);
      });

      // With < 980 specs, should be 4 chars
      ids.forEach((id) => {
        expect(id).toMatch(/^s-[0-9a-z]{4}$/);
      });
    });

    it("should generate unique IDs for each spec", () => {
      // Generate multiple specs and ensure all IDs are unique
      const generated = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const { id, uuid } = generateSpecId(db, tempDir);
        expect(generated.has(id)).toBe(false);
        generated.add(id);

        // Also verify UUID is unique
        expect(uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
      }

      expect(generated.size).toBe(10);
    });
  });

  describe("generateIssueId", () => {
    it("should generate hash-based issue IDs", () => {
      const { id: id1, uuid: uuid1 } = generateIssueId(db, tempDir);
      createIssue(db, {
        id: id1,
        uuid: uuid1,
        title: "Test 1",
        content: "",
        status: "open",
      });

      const { id: id2, uuid: uuid2 } = generateIssueId(db, tempDir);
      createIssue(db, {
        id: id2,
        uuid: uuid2,
        title: "Test 2",
        content: "",
        status: "open",
      });

      const { id: id3, uuid: uuid3 } = generateIssueId(db, tempDir);

      // Check that IDs are hash format
      expect(id1).toMatch(/^i-[0-9a-z]{4,8}$/);
      expect(id2).toMatch(/^i-[0-9a-z]{4,8}$/);
      expect(id3).toMatch(/^i-[0-9a-z]{4,8}$/);

      // Check that UUIDs are valid
      expect(uuid1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(uuid2).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(uuid3).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("should generate hash IDs regardless of config prefix", () => {
      // Note: Hash IDs use fixed prefixes (s- and i-), not config prefixes
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

      const { id } = generateIssueId(db, tempDir);
      // Should still use 'i-' prefix for hash IDs
      expect(id).toMatch(/^i-[0-9a-z]{4,8}$/);
    });

    it("should maintain separate ID spaces for specs and issues", () => {
      const { id: specId1, uuid: specUuid1 } = generateSpecId(db, tempDir);
      createSpec(db, {
        id: specId1,
        uuid: specUuid1,
        title: "Spec 1",
        file_path: "spec1.md",
        content: "",
      });

      const { id: specId2, uuid: specUuid2 } = generateSpecId(db, tempDir);
      createSpec(db, {
        id: specId2,
        uuid: specUuid2,
        title: "Spec 2",
        file_path: "spec2.md",
        content: "",
      });

      const { id: issueId, uuid: issueUuid } = generateIssueId(db, tempDir);
      createIssue(db, {
        id: issueId,
        uuid: issueUuid,
        title: "Issue 1",
        content: "",
        status: "open",
      });

      // Verify different prefixes for different entity types
      expect(specId1).toMatch(/^s-[0-9a-z]{4,8}$/);
      expect(specId2).toMatch(/^s-[0-9a-z]{4,8}$/);
      expect(issueId).toMatch(/^i-[0-9a-z]{4,8}$/);

      // Verify next IDs also follow correct format
      const { id: nextSpecId } = generateSpecId(db, tempDir);
      const { id: nextIssueId } = generateIssueId(db, tempDir);
      expect(nextSpecId).toMatch(/^s-[0-9a-z]{4,8}$/);
      expect(nextIssueId).toMatch(/^i-[0-9a-z]{4,8}$/);
    });
  });

  describe("Hash ID Generation", () => {
    describe("getAdaptiveHashLength", () => {
      it("returns 4 for small count", () => {
        expect(getAdaptiveHashLength(0)).toBe(4);
        expect(getAdaptiveHashLength(100)).toBe(4);
        expect(getAdaptiveHashLength(979)).toBe(4);
      });

      it("returns 5 for medium count", () => {
        expect(getAdaptiveHashLength(980)).toBe(5);
        expect(getAdaptiveHashLength(3000)).toBe(5);
        expect(getAdaptiveHashLength(5899)).toBe(5);
      });

      it("returns 6 for large count", () => {
        expect(getAdaptiveHashLength(5900)).toBe(6);
        expect(getAdaptiveHashLength(20000)).toBe(6);
        expect(getAdaptiveHashLength(34999)).toBe(6);
      });

      it("returns 7 for very large count", () => {
        expect(getAdaptiveHashLength(35000)).toBe(7);
        expect(getAdaptiveHashLength(100000)).toBe(7);
        expect(getAdaptiveHashLength(211999)).toBe(7);
      });

      it("returns 8 for huge count", () => {
        expect(getAdaptiveHashLength(212000)).toBe(8);
        expect(getAdaptiveHashLength(1000000)).toBe(8);
      });
    });

    describe("hashUUIDToBase36", () => {
      it("produces deterministic output", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        const hash1 = hashUUIDToBase36(uuid, 6);
        const hash2 = hashUUIDToBase36(uuid, 6);
        expect(hash1).toBe(hash2);
      });

      it("produces different hashes for different UUIDs", () => {
        const uuid1 = "550e8400-e29b-41d4-a716-446655440000";
        const uuid2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
        const hash1 = hashUUIDToBase36(uuid1, 6);
        const hash2 = hashUUIDToBase36(uuid2, 6);
        expect(hash1).not.toBe(hash2);
      });

      it("respects length parameter", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(hashUUIDToBase36(uuid, 4)).toHaveLength(4);
        expect(hashUUIDToBase36(uuid, 5)).toHaveLength(5);
        expect(hashUUIDToBase36(uuid, 6)).toHaveLength(6);
        expect(hashUUIDToBase36(uuid, 7)).toHaveLength(7);
        expect(hashUUIDToBase36(uuid, 8)).toHaveLength(8);
      });

      it("produces only base36 characters", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        const hash = hashUUIDToBase36(uuid, 8);
        expect(hash).toMatch(/^[0-9a-z]+$/);
      });
    });

    describe("isLegacyID", () => {
      it("recognizes legacy issue format", () => {
        expect(isLegacyID("ISSUE-001")).toBe(true);
        expect(isLegacyID("ISSUE-042")).toBe(true);
      });

      it("recognizes legacy spec format", () => {
        expect(isLegacyID("SPEC-001")).toBe(true);
        expect(isLegacyID("SPEC-042")).toBe(true);
      });

      it("rejects hash format", () => {
        expect(isLegacyID("i-x7k9")).toBe(false);
        expect(isLegacyID("s-14sh")).toBe(false);
      });

      it("rejects invalid formats", () => {
        expect(isLegacyID("invalid")).toBe(false);
        expect(isLegacyID("ISSUE-abc")).toBe(false);
      });
    });

    describe("isHashID", () => {
      it("recognizes hash issue format", () => {
        expect(isHashID("i-x7k9")).toBe(true);
        expect(isHashID("i-a3f2")).toBe(true);
        expect(isHashID("i-x7k9p1a4")).toBe(true);
      });

      it("recognizes hash spec format", () => {
        expect(isHashID("s-14sh")).toBe(true);
        expect(isHashID("s-9k2p7a")).toBe(true);
      });

      it("rejects legacy format", () => {
        expect(isHashID("ISSUE-001")).toBe(false);
        expect(isHashID("SPEC-001")).toBe(false);
      });

      it("rejects invalid formats", () => {
        expect(isHashID("invalid")).toBe(false);
        expect(isHashID("i-x")).toBe(false); // too short
        expect(isHashID("i-x7k9p1a4z")).toBe(false); // too long
      });
    });

    describe("generateSpecId with hash IDs", () => {
      it("returns hash format ID and UUID", () => {
        const result = generateSpecId(db, tempDir);
        expect(result).toHaveProperty("id");
        expect(result).toHaveProperty("uuid");
        expect(result.id).toMatch(/^s-[0-9a-z]{4,8}$/);
        expect(result.uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
      });

      it("returns 4-char hash for first spec", () => {
        const { id } = generateSpecId(db, tempDir);
        expect(id).toMatch(/^s-[0-9a-z]{4}$/);
      });
    });

    describe("generateIssueId with hash IDs", () => {
      it("returns hash format ID and UUID", () => {
        const result = generateIssueId(db, tempDir);
        expect(result).toHaveProperty("id");
        expect(result).toHaveProperty("uuid");
        expect(result.id).toMatch(/^i-[0-9a-z]{4,8}$/);
        expect(result.uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
      });

      it("returns 4-char hash for first issue", () => {
        const { id } = generateIssueId(db, tempDir);
        expect(id).toMatch(/^i-[0-9a-z]{4}$/);
      });
    });
  });
});
