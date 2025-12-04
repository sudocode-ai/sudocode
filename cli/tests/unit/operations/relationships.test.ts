/**
 * Unit tests for Relationship operations
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  addRelationship,
  removeRelationship,
  getOutgoingRelationships,
  getIncomingRelationships,
  getDependencies,
  getDependents,
  relationshipExists,
  removeAllRelationships,
  removeOutgoingRelationships,
} from "../../../src/operations/relationships.js";
import {
  createIssue,
  getIssue,
  updateIssue,
  deleteIssue,
} from "../../../src/operations/issues.js";
import {
  createSpec,
  deleteSpec,
} from "../../../src/operations/specs.js";
import type Database from "better-sqlite3";

describe("Relationship Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });

    // Create some test issues
    createIssue(db, {
      id: "issue-001",
      title: "Issue 1",
    });
    createIssue(db, {
      id: "issue-002",
      title: "Issue 2",
    });
    createIssue(db, {
      id: "issue-003",
      title: "Issue 3",
    });
  });

  describe("addRelationship", () => {
    it("should create a relationship", () => {
      const rel = addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      expect(rel.from_id).toBe("issue-001");
      expect(rel.to_id).toBe("issue-002");
      expect(rel.relationship_type).toBe("blocks");
    });

    it("should return existing relationship when adding duplicate", () => {
      const rel1 = addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      const rel2 = addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      expect(rel2.from_id).toBe("issue-001");
      expect(rel2.to_id).toBe("issue-002");
      expect(rel2.relationship_type).toBe("blocks");
      expect(rel2.id).toBe(rel1.id);
    });

    it("should throw error when from_id does not exist", () => {
      expect(() => {
        addRelationship(db, {
          from_id: "issue-999",
          from_type: "issue",
          to_id: "issue-001",
          to_type: "issue",
          relationship_type: "blocks",
        });
      }).toThrow("Issue not found: issue-999");
    });

    it("should throw error when to_id does not exist", () => {
      expect(() => {
        addRelationship(db, {
          from_id: "issue-001",
          from_type: "issue",
          to_id: "issue-999",
          to_type: "issue",
          relationship_type: "blocks",
        });
      }).toThrow("Issue not found: issue-999");
    });

    it("should throw error for invalid relationship type", () => {
      expect(() => {
        addRelationship(db, {
          from_id: "issue-001",
          from_type: "issue",
          to_id: "issue-002",
          to_type: "issue",
          relationship_type: "invalid-type" as any,
        });
      }).toThrow("Invalid relationship type: invalid-type");
    });

    it("should throw error for empty relationship type", () => {
      expect(() => {
        addRelationship(db, {
          from_id: "issue-001",
          from_type: "issue",
          to_id: "issue-002",
          to_type: "issue",
          relationship_type: "" as any,
        });
      }).toThrow("Invalid relationship type");
    });

    it("should validate relationship type before checking entity existence", () => {
      // This test ensures we fail fast on invalid type rather than
      // making unnecessary database queries
      expect(() => {
        addRelationship(db, {
          from_id: "issue-999",
          from_type: "issue",
          to_id: "issue-998",
          to_type: "issue",
          relationship_type: "invalid-type" as any,
        });
      }).toThrow("Invalid relationship type: invalid-type");
    });
  });

  describe("removeRelationship", () => {
    it("should remove an existing relationship", () => {
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      const removed = removeRelationship(
        db,
        "issue-001",
        "issue",
        "issue-002",
        "issue",
        "blocks"
      );

      expect(removed).toBe(true);
      expect(
        relationshipExists(
          db,
          "issue-001",
          "issue",
          "issue-002",
          "issue",
          "blocks"
        )
      ).toBe(false);
    });

    it("should return false for non-existent relationship", () => {
      const removed = removeRelationship(
        db,
        "issue-001",
        "issue",
        "issue-002",
        "issue",
        "blocks"
      );
      expect(removed).toBe(false);
    });
  });

  describe("getOutgoingRelationships", () => {
    beforeEach(() => {
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "related",
      });
    });

    it("should get all outgoing relationships", () => {
      const rels = getOutgoingRelationships(db, "issue-001", "issue");
      expect(rels).toHaveLength(2);
    });

    it("should filter by relationship type", () => {
      const rels = getOutgoingRelationships(db, "issue-001", "issue", "blocks");
      expect(rels).toHaveLength(1);
      expect(rels[0].to_id).toBe("issue-002");
    });
  });

  describe("getIncomingRelationships", () => {
    beforeEach(() => {
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "blocks",
      });
      addRelationship(db, {
        from_id: "issue-002",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "blocks",
      });
    });

    it("should get all incoming relationships", () => {
      const rels = getIncomingRelationships(db, "issue-003", "issue");
      expect(rels).toHaveLength(2);
    });

    it("should filter by relationship type", () => {
      const rels = getIncomingRelationships(db, "issue-003", "issue", "blocks");
      expect(rels).toHaveLength(2);
    });
  });

  describe("getDependencies and getDependents", () => {
    beforeEach(() => {
      // issue-001 blocks issue-002 (new semantic: from_id blocks to_id)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });
    });

    it("should get dependencies", () => {
      // issue-001 has outgoing blocks relationship to issue-002
      const deps = getDependencies(db, "issue-001", "issue");
      expect(deps).toHaveLength(1);
      expect(deps[0].to_id).toBe("issue-002");
    });

    it("should get dependents", () => {
      // issue-002 has incoming blocks relationship from issue-001
      const deps = getDependents(db, "issue-002", "issue");
      expect(deps).toHaveLength(1);
      expect(deps[0].from_id).toBe("issue-001");
    });
  });

  describe("removeAllRelationships", () => {
    beforeEach(() => {
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });
      addRelationship(db, {
        from_id: "issue-003",
        from_type: "issue",
        to_id: "issue-001",
        to_type: "issue",
        relationship_type: "related",
      });
    });

    it("should remove all relationships for an entity", () => {
      const count = removeAllRelationships(db, "issue-001", "issue");
      expect(count).toBe(2);

      const outgoing = getOutgoingRelationships(db, "issue-001", "issue");
      const incoming = getIncomingRelationships(db, "issue-001", "issue");
      expect(outgoing).toHaveLength(0);
      expect(incoming).toHaveLength(0);
    });
  });

  describe("Automatic Blocked Status Management", () => {
    it("should automatically set status to blocked when blocks relationship is added", () => {
      // Verify initial state
      const before = getIssue(db, "issue-002");
      expect(before?.status).toBe("open");

      // Add blocking relationship (issue-001 blocks issue-002 - new semantic)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Verify issue-002 status automatically changed to blocked
      const after = getIssue(db, "issue-002");
      expect(after?.status).toBe("blocked");
    });

    it("should not set status to blocked if blocker is already closed", () => {
      // Close issue-001 (the blocker) first
      updateIssue(db, "issue-001", { status: "closed" });

      // Add blocking relationship (issue-001 blocks issue-002)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // issue-002 status should remain open (blocker is closed)
      const after = getIssue(db, "issue-002");
      expect(after?.status).toBe("open");
    });

    it("should automatically unblock when last blocks relationship is removed", () => {
      // Add blocking relationship (issue-001 blocks issue-002)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });
      // issue-002 will be automatically set to blocked

      // Verify issue-002 is blocked
      const before = getIssue(db, "issue-002");
      expect(before?.status).toBe("blocked");

      // Remove blocking relationship
      removeRelationship(
        db,
        "issue-001",
        "issue",
        "issue-002",
        "issue",
        "blocks"
      );

      // issue-002 status should automatically change to open
      const after = getIssue(db, "issue-002");
      expect(after?.status).toBe("open");
    });

    it("should keep status as blocked when removing one of multiple blockers", () => {
      // Add two blocking relationships (both issue-001 and issue-002 block issue-003)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "blocks",
      });
      addRelationship(db, {
        from_id: "issue-002",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "blocks",
      });
      // issue-003 will be automatically set to blocked

      // Remove one blocker
      removeRelationship(
        db,
        "issue-001",
        "issue",
        "issue-003",
        "issue",
        "blocks"
      );

      // issue-003 status should remain blocked (issue-002 is still blocking)
      const after = getIssue(db, "issue-003");
      expect(after?.status).toBe("blocked");
    });

    it("should not change status when adding non-blocks relationship", () => {
      // Add non-blocking relationship
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "related",
      });

      // Status should remain open
      const after = getIssue(db, "issue-001");
      expect(after?.status).toBe("open");
    });
  });

  describe("Automatic Blocked Status Management for depends-on", () => {
    it("should automatically set status to blocked when depends-on relationship is added", () => {
      // Verify initial state
      const before = getIssue(db, "issue-001");
      expect(before?.status).toBe("open");

      // Add depends-on relationship (issue-001 depends-on issue-002)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "depends-on",
      });

      // Verify issue-001 status automatically changed to blocked
      const after = getIssue(db, "issue-001");
      expect(after?.status).toBe("blocked");
    });

    it("should not set status to blocked if dependency is already closed", () => {
      // Close issue-002 (the dependency) first
      updateIssue(db, "issue-002", { status: "closed" });

      // Add depends-on relationship (issue-001 depends-on issue-002)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "depends-on",
      });

      // issue-001 status should remain open (dependency is closed)
      const after = getIssue(db, "issue-001");
      expect(after?.status).toBe("open");
    });

    it("should automatically unblock when last depends-on relationship is removed", () => {
      // Add depends-on relationship (issue-001 depends-on issue-002)
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "depends-on",
      });
      // issue-001 will be automatically set to blocked

      // Verify issue-001 is blocked
      const before = getIssue(db, "issue-001");
      expect(before?.status).toBe("blocked");

      // Remove depends-on relationship
      removeRelationship(
        db,
        "issue-001",
        "issue",
        "issue-002",
        "issue",
        "depends-on"
      );

      // issue-001 status should automatically change to open
      const after = getIssue(db, "issue-001");
      expect(after?.status).toBe("open");
    });

    it("should work with mixed blocks and depends-on relationships", () => {
      // issue-001 is blocked by issue-002 (via blocks)
      addRelationship(db, {
        from_id: "issue-002",
        from_type: "issue",
        to_id: "issue-001",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // issue-001 also depends-on issue-003
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "depends-on",
      });

      // issue-001 should be blocked
      expect(getIssue(db, "issue-001")?.status).toBe("blocked");

      // Remove blocks relationship
      removeRelationship(
        db,
        "issue-002",
        "issue",
        "issue-001",
        "issue",
        "blocks"
      );

      // issue-001 should still be blocked (depends-on issue-003 remains)
      expect(getIssue(db, "issue-001")?.status).toBe("blocked");

      // Remove depends-on relationship
      removeRelationship(
        db,
        "issue-001",
        "issue",
        "issue-003",
        "issue",
        "depends-on"
      );

      // Now issue-001 should be open
      expect(getIssue(db, "issue-001")?.status).toBe("open");
    });
  });

  describe("removeOutgoingRelationships", () => {
    beforeEach(() => {
      // Create outgoing relationships FROM issue-001
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-003",
        to_type: "issue",
        relationship_type: "related",
      });

      // Create incoming relationship TO issue-001
      addRelationship(db, {
        from_id: "issue-003",
        from_type: "issue",
        to_id: "issue-001",
        to_type: "issue",
        relationship_type: "related",
      });
    });

    it("should remove only outgoing relationships", () => {
      // Verify initial state
      const outgoingBefore = getOutgoingRelationships(db, "issue-001", "issue");
      const incomingBefore = getIncomingRelationships(db, "issue-001", "issue");
      expect(outgoingBefore).toHaveLength(2);
      expect(incomingBefore).toHaveLength(1);

      // Remove only outgoing relationships
      const count = removeOutgoingRelationships(db, "issue-001", "issue");
      expect(count).toBe(2);

      // Verify outgoing are removed
      const outgoingAfter = getOutgoingRelationships(db, "issue-001", "issue");
      expect(outgoingAfter).toHaveLength(0);

      // Verify incoming is preserved
      const incomingAfter = getIncomingRelationships(db, "issue-001", "issue");
      expect(incomingAfter).toHaveLength(1);
      expect(incomingAfter[0].from_id).toBe("issue-003");
    });

    it("should preserve incoming 'implements' relationships when spec is updated", () => {
      // Create a spec
      createSpec(db, {
        id: "spec-001",
        title: "Test Spec",
        file_path: "test.md",
        content: "Test content",
      });

      // Create an issue that implements the spec
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "spec-001",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Verify incoming relationship to spec exists
      const incomingBefore = getIncomingRelationships(db, "spec-001", "spec");
      expect(incomingBefore).toHaveLength(1);
      expect(incomingBefore[0].relationship_type).toBe("implements");

      // Simulate spec update by removing only outgoing relationships
      const count = removeOutgoingRelationships(db, "spec-001", "spec");
      expect(count).toBe(0); // Spec has no outgoing relationships

      // Verify incoming 'implements' relationship is still there
      const incomingAfter = getIncomingRelationships(db, "spec-001", "spec");
      expect(incomingAfter).toHaveLength(1);
      expect(incomingAfter[0].from_id).toBe("issue-001");
      expect(incomingAfter[0].relationship_type).toBe("implements");
    });

    it("should return 0 when entity has no outgoing relationships", () => {
      // issue-002 has no outgoing relationships
      const count = removeOutgoingRelationships(db, "issue-002", "issue");
      expect(count).toBe(0);
    });
  });

  describe("Cascade Delete on Entity Deletion", () => {
    beforeEach(() => {
      // Create a spec
      createSpec(db, {
        id: "spec-001",
        title: "Test Spec",
        file_path: "test.md",
        content: "Test content",
      });

      // Create relationships between issues and spec
      // issue-001 implements spec-001
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "spec-001",
        to_type: "spec",
        relationship_type: "implements",
      });

      // spec-001 references issue-002
      addRelationship(db, {
        from_id: "spec-001",
        from_type: "spec",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "references",
      });

      // issue-001 blocks issue-002
      addRelationship(db, {
        from_id: "issue-001",
        from_type: "issue",
        to_id: "issue-002",
        to_type: "issue",
        relationship_type: "blocks",
      });
    });

    it("should cascade delete all relationships when spec is deleted", () => {
      // Verify relationships exist
      const specOutgoing = getOutgoingRelationships(db, "spec-001", "spec");
      const specIncoming = getIncomingRelationships(db, "spec-001", "spec");
      expect(specOutgoing).toHaveLength(1);
      expect(specIncoming).toHaveLength(1);

      // Delete spec
      deleteSpec(db, "spec-001");

      // Verify all relationships involving spec are deleted
      const specOutgoingAfter = getOutgoingRelationships(db, "spec-001", "spec");
      const specIncomingAfter = getIncomingRelationships(db, "spec-001", "spec");
      expect(specOutgoingAfter).toHaveLength(0);
      expect(specIncomingAfter).toHaveLength(0);

      // Verify issue-001's outgoing relationship to spec is gone
      const issue1Outgoing = getOutgoingRelationships(db, "issue-001", "issue");
      const implementsRel = issue1Outgoing.find(
        (r) => r.to_id === "spec-001" && r.relationship_type === "implements"
      );
      expect(implementsRel).toBeUndefined();

      // But issue-001's other relationships should remain
      const blocksRel = issue1Outgoing.find(
        (r) => r.to_id === "issue-002" && r.relationship_type === "blocks"
      );
      expect(blocksRel).toBeDefined();
    });

    it("should cascade delete all relationships when issue is deleted", () => {
      // Verify relationships exist
      const issue1Outgoing = getOutgoingRelationships(db, "issue-001", "issue");
      expect(issue1Outgoing).toHaveLength(2); // implements spec + blocks issue-002

      // Delete issue-001
      deleteIssue(db, "issue-001");

      // Verify all relationships involving issue-001 are deleted
      const issue1OutgoingAfter = getOutgoingRelationships(db, "issue-001", "issue");
      const issue1IncomingAfter = getIncomingRelationships(db, "issue-001", "issue");
      expect(issue1OutgoingAfter).toHaveLength(0);
      expect(issue1IncomingAfter).toHaveLength(0);

      // Verify spec's incoming relationship from issue-001 is gone
      const specIncoming = getIncomingRelationships(db, "spec-001", "spec");
      expect(specIncoming).toHaveLength(0);

      // Verify issue-002's incoming relationship from issue-001 is gone
      const issue2Incoming = getIncomingRelationships(db, "issue-002", "issue");
      const blocksRel = issue2Incoming.find(
        (r) => r.from_id === "issue-001" && r.relationship_type === "blocks"
      );
      expect(blocksRel).toBeUndefined();

      // But spec-001's other relationships should remain
      const specOutgoing = getOutgoingRelationships(db, "spec-001", "spec");
      expect(specOutgoing).toHaveLength(1);
      expect(specOutgoing[0].to_id).toBe("issue-002");
    });
  });
});
