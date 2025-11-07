/**
 * Unit tests for cross-repo reference parser
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  parseCrossRepoReferences,
  updateCrossRepoReferences,
  getCrossRepoReferences,
  getReferencesByRemoteRepo,
  deleteReferencesByRemoteRepo,
  hasAnyReferences,
} from "../../../src/operations/crossRepoReferences.js";
import type Database from "better-sqlite3";

describe("Cross-Repo Reference Parser", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });

    // Create test issues and specs for UUID lookups
    db.prepare(`
      INSERT INTO issues (id, uuid, title, content, status, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("local-issue-001", "uuid-issue-001", "Test Issue 1", "", "open", 2, "2025-01-01", "2025-01-01");

    db.prepare(`
      INSERT INTO issues (id, uuid, title, content, status, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("local-issue-002", "uuid-issue-002", "Test Issue 2", "", "open", 2, "2025-01-01", "2025-01-01");

    db.prepare(`
      INSERT INTO specs (id, uuid, title, file_path, content, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("local-spec-001", "uuid-spec-001", "Test Spec 1", "specs/test.md", "", 2, "2025-01-01", "2025-01-01");

    // Create remote repos for foreign key constraints
    db.prepare(`
      INSERT INTO remote_repos (url, display_name, trust_level, rest_endpoint, added_at, added_by, auto_sync, sync_interval_minutes, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("github.com/org/repo", "Org Repo", "verified", "http://example.com/api", "2025-01-01", "test", 0, 60, "unknown");

    db.prepare(`
      INSERT INTO remote_repos (url, display_name, trust_level, rest_endpoint, added_at, added_by, auto_sync, sync_interval_minutes, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("github.com/other/repo", "Other Repo", "verified", "http://example.com/api", "2025-01-01", "test", 0, 60, "unknown");

    db.prepare(`
      INSERT INTO remote_repos (url, display_name, trust_level, rest_endpoint, added_at, added_by, auto_sync, sync_interval_minutes, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("github.com/third/repo", "Third Repo", "verified", "http://example.com/api", "2025-01-01", "test", 0, 60, "unknown");
  });

  describe("parseCrossRepoReferences", () => {
    it("should parse simple cross-repo reference", () => {
      const content = "This references [[org/repo#issue-042]]";
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].repo).toBe("github.com/org/repo");
      expect(refs[0].entityId).toBe("issue-042");
      expect(refs[0].entityType).toBe("issue");
    });

    it("should parse full URL reference", () => {
      const content = "See [[https://example.com/repo#spec-123]]";
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].repo).toBe("example.com/repo");
      expect(refs[0].entityId).toBe("spec-123");
      expect(refs[0].entityType).toBe("spec");
    });

    it("should parse reference with domain", () => {
      const content = "Check [[github.com/org/repo#issue-001]]";
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].repo).toBe("github.com/org/repo");
      expect(refs[0].entityId).toBe("issue-001");
      expect(refs[0].entityType).toBe("issue");
    });

    it("should parse reference with display text", () => {
      const content = "See [[org/repo#issue-042|Important Issue]]";
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].repo).toBe("github.com/org/repo");
      expect(refs[0].entityId).toBe("issue-042");
      expect(refs[0].displayText).toBe("Important Issue");
    });

    it("should parse multiple references", () => {
      const content = `
        Related to [[org/repo#issue-001]] and [[other/repo#spec-123]].
        Also see [[github.com/third/repo#issue-002]].
      `;
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(3);
      expect(refs[0].entityId).toBe("issue-001");
      expect(refs[1].entityId).toBe("spec-123");
      expect(refs[2].entityId).toBe("issue-002");
    });

    it("should handle alphanumeric issue IDs", () => {
      const content = "[[org/repo#issue-ABC123def]]";
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].entityId).toBe("issue-ABC123def");
    });

    it("should distinguish between issue and spec", () => {
      const content = "[[org/repo#issue-001]] and [[org/repo#spec-001]]";
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].entityType).toBe("issue");
      expect(refs[1].entityType).toBe("spec");
    });

    it("should handle empty content", () => {
      const content = "";
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(0);
    });

    it("should ignore invalid reference formats", () => {
      const content = `
        [[org/repo]] - missing ID
        [[#issue-001]] - missing repo
        [[org/repo#invalid-001]] - invalid entity type
        [org/repo#issue-001] - single brackets
      `;
      const refs = parseCrossRepoReferences(content);

      expect(refs).toHaveLength(0);
    });
  });

  describe("hasAnyReferences", () => {
    it("should return true when references exist", () => {
      const content = "This has [[org/repo#issue-042]]";
      expect(hasAnyReferences(content)).toBe(true);
    });

    it("should return false when no references", () => {
      const content = "This has no cross-repo references";
      expect(hasAnyReferences(content)).toBe(false);
    });

    it("should return false for invalid reference formats", () => {
      const content = "[[org/repo]] or [[#issue-001]]";
      expect(hasAnyReferences(content)).toBe(false);
    });
  });

  describe("updateCrossRepoReferences", () => {
    it("should store cross-repo references in database", () => {
      const content = "References [[org/repo#issue-042]]";
      const count = updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        content
      );

      expect(count).toBe(1);

      const refs = getCrossRepoReferences(db, "local-issue-001", "issue");
      expect(refs).toHaveLength(1);
      expect(refs[0].remote_repo_url).toBe("github.com/org/repo");
      expect(refs[0].remote_id).toBe("issue-042");
    });

    it("should update existing references", () => {
      // First insert
      updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        "References [[org/repo#issue-042]]"
      );

      // Update with different references
      const count = updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        "Now references [[other/repo#issue-999]]"
      );

      expect(count).toBe(1);

      const refs = getCrossRepoReferences(db, "local-issue-001", "issue");
      expect(refs).toHaveLength(1);
      expect(refs[0].remote_id).toBe("issue-999");
    });

    it("should delete all references when content has none", () => {
      // First insert
      updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        "References [[org/repo#issue-042]]"
      );

      // Update with no references
      const count = updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        "No references here"
      );

      expect(count).toBe(0);

      const refs = getCrossRepoReferences(db, "local-issue-001", "issue");
      expect(refs).toHaveLength(0);
    });

    it("should handle multiple references", () => {
      const content = `
        References:
        - [[org/repo#issue-001]]
        - [[other/repo#spec-123]]
        - [[third/repo#issue-002]]
      `;
      const count = updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        content
      );

      expect(count).toBe(3);

      const refs = getCrossRepoReferences(db, "local-issue-001", "issue");
      expect(refs).toHaveLength(3);
    });

    it("should preserve display text", () => {
      const content = "See [[org/repo#issue-042|Important Issue]]";
      updateCrossRepoReferences(db, "local-issue-001", "issue", content);

      const refs = getCrossRepoReferences(db, "local-issue-001", "issue");
      // Note: display_text is not stored in the schema, just parsed from content
      expect(refs[0].canonical_ref).toBe("github.com/org/repo#issue-042");
    });
  });

  describe("getReferencesByRemoteRepo", () => {
    beforeEach(() => {
      updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        "[[org/repo#issue-042]]"
      );
      updateCrossRepoReferences(
        db,
        "local-issue-002",
        "issue",
        "[[org/repo#issue-043]]"
      );
      updateCrossRepoReferences(
        db,
        "local-spec-001",
        "spec",
        "[[other/repo#spec-123]]"
      );
    });

    it("should get all references to a specific remote repo", () => {
      const refs = getReferencesByRemoteRepo(db, "github.com/org/repo");

      expect(refs).toHaveLength(2);
      expect(refs[0].local_uuid).toBe("uuid-issue-001");
      expect(refs[1].local_uuid).toBe("uuid-issue-002");
    });

    it("should return empty array for repo with no references", () => {
      const refs = getReferencesByRemoteRepo(db, "github.com/nonexistent/repo");

      expect(refs).toHaveLength(0);
    });
  });

  describe("deleteReferencesByRemoteRepo", () => {
    beforeEach(() => {
      updateCrossRepoReferences(
        db,
        "local-issue-001",
        "issue",
        "[[org/repo#issue-042]]"
      );
      updateCrossRepoReferences(
        db,
        "local-issue-002",
        "issue",
        "[[org/repo#issue-043]]"
      );
      updateCrossRepoReferences(
        db,
        "local-spec-001",
        "spec",
        "[[other/repo#spec-123]]"
      );
    });

    it("should delete all references to a specific remote repo", () => {
      const count = deleteReferencesByRemoteRepo(db, "github.com/org/repo");

      expect(count).toBe(2);

      const refs = getReferencesByRemoteRepo(db, "github.com/org/repo");
      expect(refs).toHaveLength(0);
    });

    it("should not affect references to other repos", () => {
      deleteReferencesByRemoteRepo(db, "github.com/org/repo");

      const refs = getReferencesByRemoteRepo(db, "github.com/other/repo");
      expect(refs).toHaveLength(1);
    });

    it("should return 0 for repo with no references", () => {
      const count = deleteReferencesByRemoteRepo(
        db,
        "github.com/nonexistent/repo"
      );

      expect(count).toBe(0);
    });
  });
});
