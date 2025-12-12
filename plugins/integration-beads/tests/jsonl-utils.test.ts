/**
 * Tests for JSONL utilities
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readBeadsJSONL,
  writeBeadsJSONL,
  createIssueViaJSONL,
  updateIssueViaJSONL,
  deleteIssueViaJSONL,
  getIssueById,
  generateBeadsId,
} from "../src/jsonl-utils.js";

describe("JSONL Utils", () => {
  let tempDir: string;
  let beadsDir: string;
  let issuesPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-jsonl-test-"));
    beadsDir = join(tempDir, ".beads");
    mkdirSync(beadsDir);
    issuesPath = join(beadsDir, "issues.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("generateBeadsId", () => {
    it("should generate ID with default prefix", () => {
      const id = generateBeadsId();
      expect(id).toMatch(/^beads-[a-f0-9]{8}$/);
    });

    it("should generate ID with custom prefix", () => {
      const id = generateBeadsId("bd");
      expect(id).toMatch(/^bd-[a-f0-9]{8}$/);
    });

    it("should generate unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateBeadsId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("readBeadsJSONL", () => {
    it("should return empty array for non-existent file", () => {
      const result = readBeadsJSONL(issuesPath);
      expect(result).toEqual([]);
    });

    it("should read valid JSONL file", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n' +
          '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
      );

      const result = readBeadsJSONL(issuesPath);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("bd-1");
      expect(result[1].id).toBe("bd-2");
    });

    it("should skip empty lines", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n\n\n' +
          '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
      );

      const result = readBeadsJSONL(issuesPath);
      expect(result).toHaveLength(2);
    });

    it("should throw on invalid JSON by default", () => {
      writeFileSync(issuesPath, "not valid json\n");
      expect(() => readBeadsJSONL(issuesPath)).toThrow();
    });

    it("should skip invalid JSON when skipErrors is true", () => {
      writeFileSync(
        issuesPath,
        'not valid json\n{"id":"bd-1","title":"Valid","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      const result = readBeadsJSONL(issuesPath, { skipErrors: true });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("bd-1");
    });
  });

  describe("writeBeadsJSONL", () => {
    it("should write issues to file", () => {
      const issues = [
        { id: "bd-1", title: "Issue 1", created_at: "2024-01-01", updated_at: "2024-01-01" },
        { id: "bd-2", title: "Issue 2", created_at: "2024-01-02", updated_at: "2024-01-02" },
      ];

      writeBeadsJSONL(issuesPath, issues);

      expect(existsSync(issuesPath)).toBe(true);
      const content = readFileSync(issuesPath, "utf-8");
      expect(content).toContain("bd-1");
      expect(content).toContain("bd-2");
    });

    it("should sort issues by created_at", () => {
      const issues = [
        { id: "bd-2", title: "Issue 2", created_at: "2024-01-02", updated_at: "2024-01-02" },
        { id: "bd-1", title: "Issue 1", created_at: "2024-01-01", updated_at: "2024-01-01" },
      ];

      writeBeadsJSONL(issuesPath, issues);

      const result = readBeadsJSONL(issuesPath);
      expect(result[0].id).toBe("bd-1");
      expect(result[1].id).toBe("bd-2");
    });

    it("should not write if content unchanged", () => {
      const issues = [
        { id: "bd-1", title: "Issue 1", created_at: "2024-01-01", updated_at: "2024-01-01" },
      ];

      writeBeadsJSONL(issuesPath, issues);
      const firstMtime = readFileSync(issuesPath).toString();

      // Write same content again
      writeBeadsJSONL(issuesPath, issues);
      const secondMtime = readFileSync(issuesPath).toString();

      // Content should be identical (no unnecessary write)
      expect(firstMtime).toBe(secondMtime);
    });
  });

  describe("createIssueViaJSONL", () => {
    it("should create new issue with generated ID", () => {
      const issue = createIssueViaJSONL(beadsDir, {
        title: "New Issue",
        content: "Description",
      });

      expect(issue.id).toMatch(/^beads-[a-f0-9]{8}$/);
      expect(issue.title).toBe("New Issue");
      expect(issue.content).toBe("Description");
      expect(issue.status).toBe("open");
      expect(issue.priority).toBe(2);
      expect(issue.created_at).toBeDefined();
      expect(issue.updated_at).toBeDefined();
    });

    it("should use custom prefix", () => {
      const issue = createIssueViaJSONL(beadsDir, { title: "Test" }, "bd");
      expect(issue.id).toMatch(/^bd-[a-f0-9]{8}$/);
    });

    it("should append to existing issues", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-existing","title":"Existing","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      createIssueViaJSONL(beadsDir, { title: "New" });

      const issues = readBeadsJSONL(issuesPath);
      expect(issues).toHaveLength(2);
    });

    it("should preserve custom fields", () => {
      const issue = createIssueViaJSONL(beadsDir, {
        title: "Test",
        customField: "custom value",
      } as any);

      expect((issue as any).customField).toBe("custom value");
    });
  });

  describe("updateIssueViaJSONL", () => {
    beforeEach(() => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Original","content":"Original content","status":"open","priority":2,"created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );
    });

    it("should update existing issue", () => {
      const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
        title: "Updated Title",
      });

      expect(updated.title).toBe("Updated Title");
      expect(updated.content).toBe("Original content"); // Preserved
      expect(updated.id).toBe("bd-1"); // Preserved
    });

    it("should update timestamp", () => {
      const original = getIssueById(beadsDir, "bd-1");
      const originalUpdatedAt = original?.updated_at;

      // Small delay to ensure different timestamp
      const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
        title: "Updated",
      });

      expect(updated.updated_at).not.toBe(originalUpdatedAt);
    });

    it("should throw for non-existent issue", () => {
      expect(() =>
        updateIssueViaJSONL(beadsDir, "bd-999", { title: "Test" })
      ).toThrow("not found");
    });

    it("should preserve beads-specific fields", () => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Original","beadsCustom":"value","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );

      const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
        title: "Updated",
      });

      expect((updated as any).beadsCustom).toBe("value");
    });

    describe("status updates", () => {
      it("should update status from open to closed", () => {
        const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
          status: "closed",
        });

        expect(updated.status).toBe("closed");
        // Verify in file
        const fromFile = getIssueById(beadsDir, "bd-1");
        expect(fromFile?.status).toBe("closed");
      });

      it("should update status from open to in_progress", () => {
        const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
          status: "in_progress",
        });

        expect(updated.status).toBe("in_progress");
      });

      it("should update status from open to blocked", () => {
        const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
          status: "blocked",
        });

        expect(updated.status).toBe("blocked");
      });

      it("should update status along with other fields", () => {
        const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
          title: "Updated with status",
          status: "needs_review",
          priority: 0,
        });

        expect(updated.title).toBe("Updated with status");
        expect(updated.status).toBe("needs_review");
        expect(updated.priority).toBe(0);
        // Original content preserved
        expect(updated.content).toBe("Original content");
      });

      it("should preserve original status when not updating status", () => {
        const updated = updateIssueViaJSONL(beadsDir, "bd-1", {
          title: "New title only",
        });

        expect(updated.title).toBe("New title only");
        expect(updated.status).toBe("open"); // Original status preserved
      });
    });
  });

  describe("deleteIssueViaJSONL", () => {
    beforeEach(() => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n' +
          '{"id":"bd-2","title":"Issue 2","created_at":"2024-01-02","updated_at":"2024-01-02"}\n'
      );
    });

    it("should delete existing issue", () => {
      const result = deleteIssueViaJSONL(beadsDir, "bd-1");

      expect(result).toBe(true);
      const issues = readBeadsJSONL(issuesPath);
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("bd-2");
    });

    it("should return false for non-existent issue", () => {
      const result = deleteIssueViaJSONL(beadsDir, "bd-999");
      expect(result).toBe(false);
    });
  });

  describe("getIssueById", () => {
    beforeEach(() => {
      writeFileSync(
        issuesPath,
        '{"id":"bd-1","title":"Issue 1","created_at":"2024-01-01","updated_at":"2024-01-01"}\n'
      );
    });

    it("should return issue by ID", () => {
      const issue = getIssueById(beadsDir, "bd-1");
      expect(issue).not.toBeNull();
      expect(issue?.id).toBe("bd-1");
      expect(issue?.title).toBe("Issue 1");
    });

    it("should return null for non-existent issue", () => {
      const issue = getIssueById(beadsDir, "bd-999");
      expect(issue).toBeNull();
    });
  });
});
