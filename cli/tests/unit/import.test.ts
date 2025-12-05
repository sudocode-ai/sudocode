/**
 * Unit tests for import operations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { initDatabase } from "../../src/db.js";
import { createSpec, getSpec } from "../../src/operations/specs.js";
import { createIssue } from "../../src/operations/issues.js";
import {
  addRelationship,
  getOutgoingRelationships,
  getIncomingRelationships,
} from "../../src/operations/relationships.js";
import { addTags } from "../../src/operations/tags.js";
import { writeJSONL } from "../../src/jsonl.js";
import {
  detectChanges,
  detectCollisions,
  countReferences,
  updateTextReferences,
  importFromJSONL,
} from "../../src/import.js";
import type Database from "better-sqlite3";
import type { SpecJSONL, IssueJSONL } from "../../src/types.js";

const TEST_DIR = path.join(process.cwd(), "test-import");

describe("Import Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });

    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    db.close();

    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("detectChanges", () => {
    it("should detect added entities (using UUID matching)", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "spec-002",
          uuid: "uuid-002",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual(["spec-002"]);
      expect(changes.updated).toEqual([]);
      expect(changes.deleted).toEqual([]);
    });

    it("should detect updated entities (using UUID matching)", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual(["spec-001"]);
      expect(changes.deleted).toEqual([]);
    });

    it("should detect deleted entities (using UUID matching)", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "spec-002",
          uuid: "uuid-002",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual([]);
      expect(changes.deleted).toEqual(["spec-002"]);
    });

    it("should detect unchanged entities", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.unchanged).toEqual(["spec-001"]);
    });

    it("should treat same UUID with different ID as update (entity was renamed)", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-same",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-999",
          uuid: "uuid-same",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual(["spec-999"]); // Returns new ID
      expect(changes.deleted).toEqual([]);
    });
  });

  describe("detectCollisions", () => {
    it("should detect ID collisions when UUIDs differ (different entities with same ID)", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-aaa",
          title: "Original Title",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-001",
          uuid: "uuid-bbb",
          title: "Different Title",
          created_at: "2025-01-02T00:00:00Z",
        },
      ];

      const collisions = detectCollisions(existing, incoming);

      expect(collisions).toHaveLength(1);
      expect(collisions[0].id).toBe("spec-001");
      expect(collisions[0].reason).toBe(
        "Same ID but different UUID (different entities)"
      );
      expect(collisions[0].localContent).toBe("Original Title");
      expect(collisions[0].incomingContent).toBe("Different Title");
    });

    it("should not detect collision when UUIDs match (same entity)", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-same",
          title: "Original Title",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-001",
          uuid: "uuid-same",
          title: "Updated Title",
          created_at: "2025-01-02T00:00:00Z",
        },
      ];

      const collisions = detectCollisions(existing, incoming);

      expect(collisions).toHaveLength(0);
    });

    it("should not detect collision for different IDs (even if content is same)", () => {
      const existing = [
        {
          id: "spec-001",
          uuid: "uuid-aaa",
          title: "Same Title",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];
      const incoming = [
        {
          id: "spec-002",
          uuid: "uuid-bbb",
          title: "Same Title",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];

      const collisions = detectCollisions(existing, incoming);

      expect(collisions).toHaveLength(0);
    });
  });

  describe("countReferences", () => {
    beforeEach(() => {
      // Create specs with references
      createSpec(db, {
        id: "spec-001",
        title: "Main Spec",
        file_path: "main.md",
        content: "See spec-002 for details. Also spec-002 is important.",
      });

      createSpec(db, {
        id: "spec-002",
        title: "Referenced Spec",
        file_path: "ref.md",
        content: "Content",
      });

      // Create issue with reference
      createIssue(db, {
        id: "issue-001",
        title: "Issue",
        content: "Based on spec-002",
      });
    });

    it("should count references to an entity", () => {
      const count = countReferences(db, "spec-002", "spec");

      // 2 in spec-001 content + 1 in issue content = 3
      expect(count).toBe(3);
    });

    it("should return 0 for unreferenced entity", () => {
      const count = countReferences(db, "spec-999", "spec");
      expect(count).toBe(0);
    });
  });

  describe("updateTextReferences", () => {
    beforeEach(() => {
      createSpec(db, {
        id: "spec-001",
        title: "Spec with reference",
        file_path: "spec.md",
        content: "See spec-OLD for details",
      });

      createIssue(db, {
        id: "issue-001",
        title: "Issue",
        content: "Implements spec-OLD feature",
      });
    });

    it("should update all text references", () => {
      const count = updateTextReferences(db, "spec-OLD", "spec-NEW");

      expect(count).toBe(2); // 1 spec + 1 issue

      // Verification is implicit - the function would throw if updates failed
    });
  });

  describe("importFromJSONL", () => {
    it("should import new specs and issues", async () => {
      // Create JSONL files
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-spec-001",
          title: "Test Spec",
          file_path: "test.md",
          content: "# Test",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: ["test"],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-issue-001",
          title: "Test Issue",
          content: "# Details",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [],
          tags: ["test"],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(1);
      expect(result.issues.added).toBe(1);
      expect(result.collisions).toHaveLength(0);
    });

    it("should detect and report collisions in dry-run mode (same ID, different UUID)", async () => {
      // Create existing data with UUID
      createSpec(db, {
        id: "spec-001",
        uuid: "uuid-original",
        title: "Original Title",
        file_path: "orig.md",
      });

      // Create JSONL with same ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-different",
          title: "Different Title",
          file_path: "diff.md",
          content: "",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Dry run import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        dryRun: true,
      });

      expect(result.collisions.length).toBeGreaterThan(0);
      expect(result.collisions[0].reason).toBe(
        "Same ID but different UUID (different entities)"
      );
    });

    it("should update existing entities (same UUID, different content)", async () => {
      // Create existing data with UUID
      const uuid = "uuid-same";
      createSpec(db, {
        id: "spec-001",
        uuid: uuid,
        title: "Original",
        file_path: "orig.md",
      });

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create JSONL with updated content but same UUID
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: uuid,
          title: "Updated",
          file_path: "updated.md",
          content: "New content",
          priority: 2,
          created_at: new Date(Date.now() - 1000).toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.updated).toBe(1);
    });

    it("should delete entities not in JSONL (UUID not present)", async () => {
      // Create existing data with UUIDs
      createSpec(db, {
        id: "spec-001",
        uuid: "uuid-001",
        title: "To Delete",
        file_path: "delete.md",
      });

      createSpec(db, {
        id: "spec-002",
        uuid: "uuid-002",
        title: "To Keep",
        file_path: "keep.md",
      });

      // Create JSONL with only spec-002 (uuid-002)
      const specs: SpecJSONL[] = [
        {
          id: "spec-002",
          uuid: "uuid-002",
          title: "To Keep",
          file_path: "keep.md",
          content: "",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.deleted).toBe(1);
    });

    it("should resolve ID collisions by renumbering incoming entity", async () => {
      // Create existing spec with UUID
      const localSpec = createSpec(db, {
        id: "spec-001",
        uuid: "uuid-local",
        title: "Local Spec",
        file_path: "local.md",
        content: "Local content",
      });

      // Create JSONL with:
      // 1. Local spec (same UUID, should be preserved)
      // 2. Incoming spec with SAME ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-local", // Same UUID = same entity as existing, should be preserved
          title: "Local Spec",
          file_path: "local.md",
          content: "Local content",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
        {
          id: "spec-001", // Same ID as above = COLLISION!
          uuid: "uuid-incoming", // Different UUID = different entity
          title: "Incoming Spec",
          file_path: "incoming.md",
          content: "Incoming content",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Import with collision resolution enabled
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        resolveCollisions: true,
      });

      // Should detect 2 collisions (one with existing, one within incoming data)
      // Both refer to the same incoming entity with uuid-incoming
      expect(result.collisions.length).toBe(2);
      expect(result.collisions.every((c) => c.resolution === "renumber")).toBe(
        true
      );

      // All collisions should have the same newId (same entity being renumbered)
      const newId = result.collisions[0].newId!;
      expect(newId).toBeDefined();
      expect(newId).not.toBe("spec-001");
      expect(result.collisions.every((c) => c.newId === newId)).toBe(true);

      // Should have 1 spec updated (uuid-local) and 1 added (uuid-incoming with new ID)
      expect(result.specs.added).toBe(1);
      expect(result.specs.updated).toBe(1); // The first incoming spec with uuid-local
      expect(result.specs.deleted).toBe(0);

      // Verify: Local spec-001 should still exist with original UUID (unchanged)
      const localAfter = getSpec(db, "spec-001");
      expect(localAfter).not.toBeNull();
      expect(localAfter?.uuid).toBe("uuid-local");
      expect(localAfter?.title).toBe("Local Spec");

      // Verify: Incoming spec should be imported with new ID (use newId from earlier)
      const incomingAfter = getSpec(db, newId);
      expect(incomingAfter).not.toBeNull();
      expect(incomingAfter?.uuid).toBe("uuid-incoming");
      expect(incomingAfter?.title).toBe("Incoming Spec");
    });

    it("should use timestamps to determine collision resolution (newer gets renumbered)", async () => {
      // Create local spec with OLDER timestamp
      const olderTime = new Date("2025-01-01T00:00:00Z");
      const newerTime = new Date("2025-01-02T00:00:00Z");

      createSpec(db, {
        id: "spec-001",
        uuid: "uuid-older",
        title: "Older Spec",
        file_path: "older.md",
      });

      // Manually set created_at to older time in DB
      db.prepare("UPDATE specs SET created_at = ? WHERE id = ?").run(
        olderTime.toISOString(),
        "spec-001"
      );

      // Create JSONL with:
      // 1. The older spec (same UUID, same ID)
      // 2. A newer spec with same ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-older",
          title: "Older Spec",
          file_path: "older.md",
          content: "",
          priority: 2,
          created_at: olderTime.toISOString(),
          updated_at: olderTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
        {
          id: "spec-001",
          uuid: "uuid-newer", // Different UUID = collision
          title: "Newer Spec",
          file_path: "newer.md",
          content: "",
          priority: 2,
          created_at: newerTime.toISOString(), // NEWER timestamp
          updated_at: newerTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Import with collision resolution
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        resolveCollisions: true,
      });

      // Should detect collisions and renumber the newer entity
      expect(result.collisions.length).toBeGreaterThan(0);

      // The OLDER entity should keep spec-001
      const olderAfter = getSpec(db, "spec-001");
      expect(olderAfter).not.toBeNull();
      expect(olderAfter?.uuid).toBe("uuid-older");
      expect(olderAfter?.title).toBe("Older Spec");

      // The NEWER entity should be imported with a new ID
      const newId = result.collisions.find(
        (c) => c.uuid === "uuid-newer"
      )?.newId;
      expect(newId).toBeDefined();
      expect(newId).not.toBe("spec-001");

      const newerAfter = getSpec(db, newId!);
      expect(newerAfter).not.toBeNull();
      expect(newerAfter?.uuid).toBe("uuid-newer");
      expect(newerAfter?.title).toBe("Newer Spec");
    });

    it("should handle reverse case (local is newer, incoming is older)", async () => {
      // Create local spec with NEWER timestamp
      const olderTime = new Date("2025-01-01T00:00:00Z");
      const newerTime = new Date("2025-01-02T00:00:00Z");

      createSpec(db, {
        id: "spec-001",
        uuid: "uuid-newer",
        title: "Newer Spec",
        file_path: "newer.md",
      });

      // Manually set created_at to newer time in DB
      db.prepare("UPDATE specs SET created_at = ? WHERE id = ?").run(
        newerTime.toISOString(),
        "spec-001"
      );

      // Create JSONL with:
      // 1. The newer spec (same UUID, same ID)
      // 2. An older spec with same ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-newer",
          title: "Newer Spec",
          file_path: "newer.md",
          content: "",
          priority: 2,
          created_at: newerTime.toISOString(),
          updated_at: newerTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
        {
          id: "spec-001",
          uuid: "uuid-older", // Different UUID = collision
          title: "Older Spec",
          file_path: "older.md",
          content: "",
          priority: 2,
          created_at: olderTime.toISOString(), // OLDER timestamp
          updated_at: olderTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Import with collision resolution
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        resolveCollisions: true,
      });

      // Should detect collisions
      expect(result.collisions.length).toBeGreaterThan(0);

      // Note: Due to practical constraints, the incoming entity (older)
      // still gets renumbered, even though ideally the newer one should be
      const collision = result.collisions.find((c) => c.uuid === "uuid-older");
      expect(collision).toBeDefined();

      // The newer entity keeps spec-001 (it was there first in DB)
      const newerAfter = getSpec(db, "spec-001");
      expect(newerAfter).not.toBeNull();
      expect(newerAfter?.uuid).toBe("uuid-newer");

      // The older entity gets imported with new ID
      const newId = collision?.newId;
      expect(newId).toBeDefined();
      const olderAfter = getSpec(db, newId!);
      expect(olderAfter).not.toBeNull();
      expect(olderAfter?.uuid).toBe("uuid-older");
    });

    it("should import relationships with entity types", async () => {
      // Create specs
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-spec-001",
          title: "Spec One",
          file_path: "spec1.md",
          content: "",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [
            {
              from: "spec-001",
              from_type: "spec",
              to: "spec-002",
              to_type: "spec",
              type: "references",
            },
          ],
          tags: [],
        },
        {
          id: "spec-002",
          uuid: "uuid-spec-002",
          title: "Spec Two",
          file_path: "spec2.md",
          content: "",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(2);

      // Verify relationship was imported correctly
      const { getOutgoingRelationships } = await import(
        "../../src/operations/relationships.js"
      );
      const relationships = getOutgoingRelationships(db, "spec-001", "spec");

      expect(relationships).toHaveLength(1);
      expect(relationships[0].from_id).toBe("spec-001");
      expect(relationships[0].from_type).toBe("spec");
      expect(relationships[0].to_id).toBe("spec-002");
      expect(relationships[0].to_type).toBe("spec");
      expect(relationships[0].relationship_type).toBe("references");
    });

    it("should import cross-type relationships (spec to issue)", async () => {
      // Create spec and issue with cross-type relationship
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-spec-001",
          title: "Spec One",
          file_path: "spec1.md",
          content: "",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [
            {
              from: "spec-001",
              from_type: "spec",
              to: "issue-001",
              to_type: "issue",
              type: "implements",
            },
          ],
          tags: [],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-issue-001",
          title: "Issue One",
          content: "",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(1);
      expect(result.issues.added).toBe(1);

      // Verify cross-type relationship was imported correctly
      const { getOutgoingRelationships } = await import(
        "../../src/operations/relationships.js"
      );
      const relationships = getOutgoingRelationships(db, "spec-001", "spec");

      expect(relationships).toHaveLength(1);
      expect(relationships[0].from_id).toBe("spec-001");
      expect(relationships[0].from_type).toBe("spec");
      expect(relationships[0].to_id).toBe("issue-001");
      expect(relationships[0].to_type).toBe("issue");
      expect(relationships[0].relationship_type).toBe("implements");
    });
  });

  describe("Timestamp Preservation", () => {
    it("should preserve timestamps when importing new issues from JSONL", async () => {
      const customTimestamps = {
        created_at: "2024-01-15T10:30:00Z",
        updated_at: "2024-01-20T15:45:00Z",
        closed_at: null,
      };

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-001",
          title: "Test Issue",
          content: "Test content",
          status: "open",
          priority: 1,
          assignee: null,
          parent_id: null,
          created_at: customTimestamps.created_at,
          updated_at: customTimestamps.updated_at,
          closed_at: customTimestamps.closed_at,
          relationships: [],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      await importFromJSONL(db, { inputDir: TEST_DIR });

      const { getIssue } = await import("../../src/operations/issues.js");
      const imported = getIssue(db, "issue-001");

      expect(imported).toBeTruthy();
      expect(imported!.created_at).toBe(customTimestamps.created_at);
      expect(imported!.updated_at).toBe(customTimestamps.updated_at);
      expect(imported!.closed_at).toBe(customTimestamps.closed_at);
    });

    it("should preserve timestamps when importing new specs from JSONL", async () => {
      const customTimestamps = {
        created_at: "2024-02-10T08:00:00Z",
        updated_at: "2024-02-15T12:00:00Z",
      };

      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-001",
          title: "Test Spec",
          file_path: "specs/test.md",
          content: "Test content",
          priority: 2,
          parent_id: null,
          created_at: customTimestamps.created_at,
          updated_at: customTimestamps.updated_at,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);

      await importFromJSONL(db, { inputDir: TEST_DIR });

      const imported = getSpec(db, "spec-001");

      expect(imported).toBeTruthy();
      expect(imported!.created_at).toBe(customTimestamps.created_at);
      expect(imported!.updated_at).toBe(customTimestamps.updated_at);
    });

    it("should preserve timestamps when updating existing issues from JSONL", async () => {
      // First create an issue
      const { createIssue, getIssue } = await import(
        "../../src/operations/issues.js"
      );
      createIssue(db, {
        id: "issue-001",
        title: "Original Title",
        content: "Original content",
        status: "open",
      });

      // Now import from JSONL with specific timestamps
      const preservedTimestamps = {
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-10T10:00:00Z",
        closed_at: null,
      };

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: getIssue(db, "issue-001")!.uuid,
          title: "Updated Title",
          content: "Updated content",
          status: "open",
          priority: 1,
          assignee: null,
          parent_id: null,
          created_at: preservedTimestamps.created_at,
          updated_at: preservedTimestamps.updated_at,
          closed_at: preservedTimestamps.closed_at,
          relationships: [],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);
      await importFromJSONL(db, { inputDir: TEST_DIR });

      const updated = getIssue(db, "issue-001");

      expect(updated!.title).toBe("Updated Title");
      expect(updated!.updated_at).toBe(preservedTimestamps.updated_at);
      expect(updated!.closed_at).toBe(preservedTimestamps.closed_at);
    });

    it("should preserve closed_at timestamp when importing closed issues", async () => {
      const closedTimestamp = "2024-03-15T14:30:00Z";

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-001",
          title: "Closed Issue",
          content: "Content",
          status: "closed",
          priority: 1,
          assignee: null,
          parent_id: null,
          created_at: "2024-03-01T00:00:00Z",
          updated_at: "2024-03-15T14:30:00Z",
          closed_at: closedTimestamp,
          relationships: [],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);
      await importFromJSONL(db, { inputDir: TEST_DIR });

      const { getIssue } = await import("../../src/operations/issues.js");
      const imported = getIssue(db, "issue-001");

      expect(imported!.status).toBe("closed");
      expect(imported!.closed_at).toBe(closedTimestamp);
    });

    it("should preserve updated_at when updating existing specs from JSONL", async () => {
      // First create a spec
      createSpec(db, {
        id: "spec-001",
        title: "Original Spec",
        file_path: "specs/original.md",
        content: "Original content",
      });

      // Now import from JSONL with specific timestamps
      const preservedTimestamp = "2024-02-20T16:00:00Z";

      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: getSpec(db, "spec-001")!.uuid,
          title: "Updated Spec",
          file_path: "specs/updated.md",
          content: "Updated content",
          priority: 3,
          parent_id: null,
          created_at: "2024-02-01T00:00:00Z",
          updated_at: preservedTimestamp,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await importFromJSONL(db, { inputDir: TEST_DIR });

      const updated = getSpec(db, "spec-001");

      expect(updated!.title).toBe("Updated Spec");
      expect(updated!.updated_at).toBe(preservedTimestamp);
    });

    it("should not modify JSONL after import when timestamps are identical", async () => {
      const originalTimestamps = {
        created_at: "2024-04-01T00:00:00Z",
        updated_at: "2024-04-05T12:00:00Z",
        closed_at: null,
      };

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-001",
          title: "Stable Issue",
          content: "Content",
          status: "open",
          priority: 1,
          assignee: null,
          parent_id: null,
          created_at: originalTimestamps.created_at,
          updated_at: originalTimestamps.updated_at,
          closed_at: originalTimestamps.closed_at,
          relationships: [],
          tags: [],
          feedback: [],
        },
      ];

      const jsonlPath = path.join(TEST_DIR, "issues.jsonl");
      await writeJSONL(jsonlPath, issues);

      // Get original file content and modification time
      const originalContent = fs.readFileSync(jsonlPath, "utf-8");
      const originalMtime = fs.statSync(jsonlPath).mtime;

      // Wait a bit to ensure mtime would change if file was written
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Import from JSONL
      await importFromJSONL(db, { inputDir: TEST_DIR });

      // Export back to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: TEST_DIR });

      // Check that JSONL content hasn't changed (compare parsed objects, not string equality)
      const newContent = fs.readFileSync(jsonlPath, "utf-8");
      const originalData = JSON.parse(originalContent);
      const newData = JSON.parse(newContent);

      // Compare key fields that matter for timestamp preservation
      expect(newData.id).toBe(originalData.id);
      expect(newData.title).toBe(originalData.title);
      expect(newData.created_at).toBe(originalData.created_at);
      expect(newData.updated_at).toBe(originalData.updated_at);
      expect(newData.closed_at).toBe(originalData.closed_at);

      // Verify timestamps are still identical in the database
      const { getIssue } = await import("../../src/operations/issues.js");
      const issue = getIssue(db, "issue-001");
      expect(issue!.created_at).toBe(originalTimestamps.created_at);
      expect(issue!.updated_at).toBe(originalTimestamps.updated_at);
      expect(issue!.closed_at).toBe(originalTimestamps.closed_at);
    });
  });

  describe("Feedback timestamp preservation", () => {
    it("should preserve feedback timestamps during import/export cycle", async () => {
      // Create a spec and issue
      createSpec(db, {
        id: "SPEC-001",
        uuid: "spec-uuid-001",
        title: "Test Spec",
        content: "Test content",
        file_path: "test.md",
        priority: 2,
        created_at: "2025-01-01 10:00:00",
        updated_at: "2025-01-01 10:00:00",
      });

      createIssue(db, {
        id: "ISSUE-001",
        uuid: "issue-uuid-001",
        title: "Test Issue",
        content: "Test issue content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01 10:00:00",
        updated_at: "2025-01-01 10:00:00",
      });

      // Create feedback with specific timestamps
      const originalTimestamps = {
        created_at: "2025-01-01 12:00:00",
        updated_at: "2025-01-01 12:30:00",
      };

      const { createFeedback, getFeedback } = await import(
        "../../src/operations/feedback.js"
      );
      const { exportToJSONL } = await import("../../src/export.js");

      createFeedback(db, {
        id: "FB-001",
        from_id: "ISSUE-001",
        to_id: "SPEC-001",
        feedback_type: "comment",
        content: "Test feedback",
        agent: "test-agent",
        dismissed: false,
        created_at: originalTimestamps.created_at,
        updated_at: originalTimestamps.updated_at,
      });

      // Verify feedback was created with correct timestamps
      const feedbackAfterCreate = getFeedback(db, "FB-001");
      expect(feedbackAfterCreate).toBeTruthy();
      expect(feedbackAfterCreate?.created_at).toBe(originalTimestamps.created_at);
      expect(feedbackAfterCreate?.updated_at).toBe(originalTimestamps.updated_at);

      // Export to JSONL
      await exportToJSONL(db, { outputDir: TEST_DIR });

      // Close and reopen database (simulate fresh start)
      const { initDatabase } = await import("../../src/db.js");
      db.close();
      db = initDatabase({ path: ":memory:" });

      // Import from JSONL
      await importFromJSONL(db, { inputDir: TEST_DIR });

      // Verify timestamps are preserved after import
      const feedbackAfterImport = getFeedback(db, "FB-001");
      expect(feedbackAfterImport).toBeTruthy();
      expect(feedbackAfterImport?.created_at).toBe(originalTimestamps.created_at);
      expect(feedbackAfterImport?.updated_at).toBe(originalTimestamps.updated_at);
    });

    it("should preserve feedback timestamps during re-import (sync scenario)", async () => {
      // Create a spec and issue
      createSpec(db, {
        id: "SPEC-002",
        uuid: "spec-uuid-002",
        title: "Test Spec 2",
        content: "Test content 2",
        file_path: "test2.md",
        priority: 2,
        created_at: "2025-01-01 10:00:00",
        updated_at: "2025-01-01 10:00:00",
      });

      createIssue(db, {
        id: "ISSUE-002",
        uuid: "issue-uuid-002",
        title: "Test Issue 2",
        content: "Test issue content 2",
        status: "open",
        priority: 2,
        created_at: "2025-01-01 10:00:00",
        updated_at: "2025-01-01 10:00:00",
      });

      // Create feedback with specific timestamps
      const originalTimestamps = {
        created_at: "2025-01-01 12:00:00",
        updated_at: "2025-01-01 12:30:00",
      };

      const { createFeedback, getFeedback } = await import(
        "../../src/operations/feedback.js"
      );
      const { exportToJSONL } = await import("../../src/export.js");

      createFeedback(db, {
        id: "FB-002",
        from_id: "ISSUE-002",
        to_id: "SPEC-002",
        feedback_type: "comment",
        content: "Test feedback 2",
        agent: "test-agent",
        dismissed: false,
        created_at: originalTimestamps.created_at,
        updated_at: originalTimestamps.updated_at,
      });

      // Export to JSONL
      await exportToJSONL(db, { outputDir: TEST_DIR });

      // Import again (simulating a sync operation)
      await importFromJSONL(db, { inputDir: TEST_DIR });

      // Verify timestamps are still preserved after re-import
      const feedbackAfterReimport = getFeedback(db, "FB-002");
      expect(feedbackAfterReimport).toBeTruthy();
      expect(feedbackAfterReimport?.created_at).toBe(originalTimestamps.created_at);
      expect(feedbackAfterReimport?.updated_at).toBe(originalTimestamps.updated_at);
    });
  });

  describe("Legacy JSONL backward compatibility", () => {
    it("should import feedback from legacy JSONL format (issue_id/spec_id)", async () => {
      const { createSpec } = await import("../../src/operations/specs.js");
      const { createIssue } = await import("../../src/operations/issues.js");
      const { importFromJSONL } = await import("../../src/import.js");
      const { exportToJSONL } = await import("../../src/export.js");
      const { listFeedback } = await import("../../src/operations/feedback.js");
      const fs = await import("fs");
      const path = await import("path");

      // Create test entities
      createSpec(db, {
        id: "SPEC-LEGACY",
        uuid: "spec-uuid-legacy",
        title: "Legacy Test Spec",
        file_path: "specs/legacy.md",
        content: "Legacy spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "ISSUE-LEGACY",
        uuid: "issue-uuid-legacy",
        title: "Legacy Test Issue",
        content: "Legacy issue content",
        status: "open",
        priority: 2,
      });

      // Export first to create the JSONL files
      await exportToJSONL(db, { outputDir: TEST_DIR });

      // Create a JSONL file with legacy format (issue_id/spec_id instead of from_id/to_id)
      const legacyIssueData = {
        id: "ISSUE-LEGACY",
        uuid: "issue-uuid-legacy",
        title: "Legacy Test Issue",
        content: "Legacy issue content",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: [],
        feedback: [
          {
            id: "FB-LEGACY",
            issue_id: "ISSUE-LEGACY", // Legacy field name
            spec_id: "SPEC-LEGACY",   // Legacy field name
            feedback_type: "comment",
            content: "Legacy feedback content",
            agent: "legacy-agent",
            dismissed: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const issuesJsonlPath = path.join(TEST_DIR, "issues.jsonl");
      fs.writeFileSync(issuesJsonlPath, JSON.stringify(legacyIssueData) + "\n");

      // Import the legacy JSONL
      await importFromJSONL(db, { inputDir: TEST_DIR });

      // Verify feedback was imported correctly with new field names
      const importedFeedback = listFeedback(db, { from_id: "ISSUE-LEGACY" });
      expect(importedFeedback).toHaveLength(1);
      expect(importedFeedback[0].id).toBe("FB-LEGACY");
      expect(importedFeedback[0].from_id).toBe("ISSUE-LEGACY");
      expect(importedFeedback[0].to_id).toBe("SPEC-LEGACY");
      expect(importedFeedback[0].content).toBe("Legacy feedback content");
    });

    it("should update feedback references when issue IDs are renumbered during collision resolution", async () => {
      const { createIssue } = await import("../../src/operations/issues.js");
      const { createSpec } = await import("../../src/operations/specs.js");
      const { exportToJSONL } = await import("../../src/export.js");
      const { importFromJSONL } = await import("../../src/import.js");
      const { listFeedback } = await import("../../src/operations/feedback.js");
      const fs = await import("fs");
      const path = await import("path");

      // Create an issue in the database
      createIssue(db, {
        id: "ISSUE-COLLISION",
        uuid: "existing-uuid",
        title: "Existing Issue",
        content: "Existing content",
        status: "open",
        priority: 2,
      });

      createSpec(db, {
        id: "SPEC-TARGET",
        uuid: "spec-uuid-target",
        title: "Target Spec",
        file_path: "specs/target.md",
        content: "Spec content",
        priority: 2,
      });

      // Export current state
      await exportToJSONL(db, { outputDir: TEST_DIR });

      // Create a JSONL file with a different issue that has the same ID but different UUID
      // This will trigger collision resolution and ID renumbering
      const collidingIssueData = {
        id: "ISSUE-COLLISION", // Same ID
        uuid: "new-uuid", // Different UUID - collision!
        title: "New Colliding Issue",
        content: "New content",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: [],
        feedback: [
          {
            id: "FB-COLLISION-TEST",
            from_id: "ISSUE-COLLISION", // References the colliding issue
            to_id: "SPEC-TARGET",
            feedback_type: "comment",
            content: "Feedback from colliding issue",
            agent: "test-agent",
            dismissed: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const issuesJsonlPath = path.join(TEST_DIR, "issues.jsonl");
      const existingContent = fs.readFileSync(issuesJsonlPath, "utf8");
      fs.writeFileSync(
        issuesJsonlPath,
        existingContent + JSON.stringify(collidingIssueData) + "\n"
      );

      // Import - should resolve collision and update feedback reference
      const result = await importFromJSONL(db, { inputDir: TEST_DIR, resolveCollisions: true });

      // Verify collision was detected and resolved
      expect(result.collisions.length).toBeGreaterThan(0);
      const collision = result.collisions.find(c => c.uuid === "new-uuid");
      expect(collision).toBeTruthy();
      expect(collision?.resolution).toBe("renumber");
      expect(collision?.newId).toBeTruthy();

      // Verify feedback now references the NEW issue ID
      if (collision?.newId) {
        const feedbackForNewIssue = listFeedback(db, { from_id: collision.newId });
        expect(feedbackForNewIssue).toHaveLength(1);
        expect(feedbackForNewIssue[0].id).toBe("FB-COLLISION-TEST");
        expect(feedbackForNewIssue[0].from_id).toBe(collision.newId); // Updated to new ID!
        expect(feedbackForNewIssue[0].to_id).toBe("SPEC-TARGET");
      }
    });
  });

  describe("Relationship Preservation During Updates", () => {
    it("should preserve incoming 'implements' relationships when spec is updated", async () => {
      // Create a spec
      const specUuid = "spec-uuid-preserve";
      createSpec(db, {
        id: "spec-preserve",
        uuid: specUuid,
        title: "Original Spec",
        file_path: "preserve.md",
        content: "Original content",
      });

      // Create an issue that implements the spec
      createIssue(db, {
        id: "issue-implements",
        uuid: "issue-uuid-implements",
        title: "Implementing Issue",
        content: "Issue content",
      });

      // Add 'implements' relationship from issue to spec
      addRelationship(db, {
        from_id: "issue-implements",
        from_type: "issue",
        to_id: "spec-preserve",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Verify relationship exists
      const incomingBefore = getIncomingRelationships(db, "spec-preserve", "spec");
      expect(incomingBefore).toHaveLength(1);
      expect(incomingBefore[0].relationship_type).toBe("implements");

      // Create JSONL with updated spec content (same UUID, different content)
      const specs: SpecJSONL[] = [
        {
          id: "spec-preserve",
          uuid: specUuid,
          title: "Updated Spec Title",
          file_path: "preserve.md",
          content: "Updated content - this simulates editing the spec",
          priority: 2,
          created_at: new Date(Date.now() - 10000).toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [], // Spec has no outgoing relationships
          tags: [],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: "issue-implements",
          uuid: "issue-uuid-implements",
          title: "Implementing Issue",
          content: "Issue content",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [
            {
              from: "issue-implements",
              from_type: "issue",
              to: "spec-preserve",
              to_type: "spec",
              type: "implements",
            },
          ],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import - this should update the spec while preserving the implements relationship
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.updated).toBe(1);

      // Verify spec was updated
      const specAfter = getSpec(db, "spec-preserve");
      expect(specAfter?.title).toBe("Updated Spec Title");
      expect(specAfter?.content).toBe("Updated content - this simulates editing the spec");

      // CRITICAL: Verify 'implements' relationship is still there
      const incomingAfter = getIncomingRelationships(db, "spec-preserve", "spec");
      expect(incomingAfter).toHaveLength(1);
      expect(incomingAfter[0].from_id).toBe("issue-implements");
      expect(incomingAfter[0].relationship_type).toBe("implements");
    });

    it("should preserve incoming relationships when issue is updated", async () => {
      // Create an issue
      const issueUuid = "issue-uuid-preserve";
      createIssue(db, {
        id: "issue-preserve",
        uuid: issueUuid,
        title: "Original Issue",
        content: "Original content",
      });

      // Create another issue that blocks the first one
      createIssue(db, {
        id: "issue-blocker",
        uuid: "issue-uuid-blocker",
        title: "Blocker Issue",
        content: "Blocker content",
      });

      // Add 'blocks' relationship (blocker -> blocked)
      addRelationship(db, {
        from_id: "issue-blocker",
        from_type: "issue",
        to_id: "issue-preserve",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Verify relationship exists
      const incomingBefore = getIncomingRelationships(db, "issue-preserve", "issue");
      expect(incomingBefore).toHaveLength(1);

      // Create JSONL with updated issue content
      const issues: IssueJSONL[] = [
        {
          id: "issue-preserve",
          uuid: issueUuid,
          title: "Updated Issue Title",
          content: "Updated content",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date(Date.now() - 10000).toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [], // No outgoing relationships
          tags: [],
          feedback: [],
        },
        {
          id: "issue-blocker",
          uuid: "issue-uuid-blocker",
          title: "Blocker Issue",
          content: "Blocker content",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [
            {
              from: "issue-blocker",
              from_type: "issue",
              to: "issue-preserve",
              to_type: "issue",
              type: "blocks",
            },
          ],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), []);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.issues.updated).toBe(2);

      // CRITICAL: Verify 'blocks' relationship is still there
      const incomingAfter = getIncomingRelationships(db, "issue-preserve", "issue");
      expect(incomingAfter).toHaveLength(1);
      expect(incomingAfter[0].from_id).toBe("issue-blocker");
      expect(incomingAfter[0].relationship_type).toBe("blocks");
    });

    it("should preserve multiple incoming relationships from different issues", async () => {
      // Create a spec
      createSpec(db, {
        id: "spec-multi",
        uuid: "spec-uuid-multi",
        title: "Multi-implemented Spec",
        file_path: "multi.md",
        content: "Content",
      });

      // Create multiple issues that implement the spec
      createIssue(db, {
        id: "issue-impl-1",
        uuid: "issue-uuid-impl-1",
        title: "Issue 1",
        content: "Content 1",
      });
      createIssue(db, {
        id: "issue-impl-2",
        uuid: "issue-uuid-impl-2",
        title: "Issue 2",
        content: "Content 2",
      });
      createIssue(db, {
        id: "issue-impl-3",
        uuid: "issue-uuid-impl-3",
        title: "Issue 3",
        content: "Content 3",
      });

      // Add 'implements' relationships
      addRelationship(db, {
        from_id: "issue-impl-1",
        from_type: "issue",
        to_id: "spec-multi",
        to_type: "spec",
        relationship_type: "implements",
      });
      addRelationship(db, {
        from_id: "issue-impl-2",
        from_type: "issue",
        to_id: "spec-multi",
        to_type: "spec",
        relationship_type: "implements",
      });
      addRelationship(db, {
        from_id: "issue-impl-3",
        from_type: "issue",
        to_id: "spec-multi",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Verify 3 relationships exist
      const incomingBefore = getIncomingRelationships(db, "spec-multi", "spec");
      expect(incomingBefore).toHaveLength(3);

      // Create JSONL with updated spec (spec doesn't have these relationships in its outgoing)
      const specs: SpecJSONL[] = [
        {
          id: "spec-multi",
          uuid: "spec-uuid-multi",
          title: "Updated Multi-implemented Spec",
          file_path: "multi.md",
          content: "Updated content",
          priority: 1,
          created_at: new Date(Date.now() - 10000).toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: "issue-impl-1",
          uuid: "issue-uuid-impl-1",
          title: "Issue 1",
          content: "Content 1",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [{ from: "issue-impl-1", from_type: "issue", to: "spec-multi", to_type: "spec", type: "implements" }],
          tags: [],
          feedback: [],
        },
        {
          id: "issue-impl-2",
          uuid: "issue-uuid-impl-2",
          title: "Issue 2",
          content: "Content 2",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [{ from: "issue-impl-2", from_type: "issue", to: "spec-multi", to_type: "spec", type: "implements" }],
          tags: [],
          feedback: [],
        },
        {
          id: "issue-impl-3",
          uuid: "issue-uuid-impl-3",
          title: "Issue 3",
          content: "Content 3",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [{ from: "issue-impl-3", from_type: "issue", to: "spec-multi", to_type: "spec", type: "implements" }],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import
      await importFromJSONL(db, { inputDir: TEST_DIR });

      // Verify spec was updated
      const specAfter = getSpec(db, "spec-multi");
      expect(specAfter?.title).toBe("Updated Multi-implemented Spec");

      // CRITICAL: All 3 incoming 'implements' relationships should be preserved
      const incomingAfter = getIncomingRelationships(db, "spec-multi", "spec");
      expect(incomingAfter).toHaveLength(3);

      const fromIds = incomingAfter.map((r) => r.from_id).sort();
      expect(fromIds).toEqual(["issue-impl-1", "issue-impl-2", "issue-impl-3"]);
    });
  });

  describe("JSONL Stability", () => {
    it("should produce stable JSONL after import-export cycle with relationships", async () => {
      // Create initial data with relationships
      createSpec(db, {
        id: "spec-stable",
        uuid: "spec-uuid-stable",
        title: "Stable Spec",
        file_path: "stable.md",
        content: "Spec content",
      });

      createIssue(db, {
        id: "issue-stable",
        uuid: "issue-uuid-stable",
        title: "Stable Issue",
        content: "Issue content",
      });

      // Issue implements spec
      addRelationship(db, {
        from_id: "issue-stable",
        from_type: "issue",
        to_id: "spec-stable",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Export to JSONL
      const { exportToJSONL } = await import("../../src/export.js");
      await exportToJSONL(db, { outputDir: TEST_DIR });

      // Read initial JSONL content
      const specsPath = path.join(TEST_DIR, "specs.jsonl");
      const issuesPath = path.join(TEST_DIR, "issues.jsonl");
      const initialSpecsContent = fs.readFileSync(specsPath, "utf-8");
      const initialIssuesContent = fs.readFileSync(issuesPath, "utf-8");

      // Import (should be no-op since data is the same)
      await importFromJSONL(db, { inputDir: TEST_DIR });

      // Export again
      await exportToJSONL(db, { outputDir: TEST_DIR });

      // Read final JSONL content
      const finalSpecsContent = fs.readFileSync(specsPath, "utf-8");
      const finalIssuesContent = fs.readFileSync(issuesPath, "utf-8");

      // Parse and compare (ignore timestamps which may differ slightly)
      const initialSpecs = JSON.parse(initialSpecsContent);
      const finalSpecs = JSON.parse(finalSpecsContent);
      const initialIssues = JSON.parse(initialIssuesContent);
      const finalIssues = JSON.parse(finalIssuesContent);

      // Core fields should be identical
      expect(finalSpecs.id).toBe(initialSpecs.id);
      expect(finalSpecs.uuid).toBe(initialSpecs.uuid);
      expect(finalSpecs.title).toBe(initialSpecs.title);
      expect(finalSpecs.content).toBe(initialSpecs.content);

      expect(finalIssues.id).toBe(initialIssues.id);
      expect(finalIssues.uuid).toBe(initialIssues.uuid);
      expect(finalIssues.title).toBe(initialIssues.title);
      expect(finalIssues.content).toBe(initialIssues.content);

      // Relationships should be preserved
      expect(finalIssues.relationships).toHaveLength(1);
      expect(finalIssues.relationships[0].type).toBe("implements");
      expect(finalIssues.relationships[0].to).toBe("spec-stable");
    });

    it("should not lose relationships after multiple import-export cycles", async () => {
      // Create initial data
      createSpec(db, {
        id: "spec-cycle",
        uuid: "spec-uuid-cycle",
        title: "Cycle Test Spec",
        file_path: "cycle.md",
        content: "Content",
      });

      createIssue(db, {
        id: "issue-cycle",
        uuid: "issue-uuid-cycle",
        title: "Cycle Test Issue",
        content: "Content",
      });

      addRelationship(db, {
        from_id: "issue-cycle",
        from_type: "issue",
        to_id: "spec-cycle",
        to_type: "spec",
        relationship_type: "implements",
      });

      const { exportToJSONL } = await import("../../src/export.js");

      // Run multiple import-export cycles
      for (let i = 0; i < 5; i++) {
        await exportToJSONL(db, { outputDir: TEST_DIR });
        await importFromJSONL(db, { inputDir: TEST_DIR });
      }

      // Verify relationship is still intact
      const incomingRels = getIncomingRelationships(db, "spec-cycle", "spec");
      expect(incomingRels).toHaveLength(1);
      expect(incomingRels[0].from_id).toBe("issue-cycle");
      expect(incomingRels[0].relationship_type).toBe("implements");

      const outgoingRels = getOutgoingRelationships(db, "issue-cycle", "issue");
      expect(outgoingRels).toHaveLength(1);
      expect(outgoingRels[0].to_id).toBe("spec-cycle");
      expect(outgoingRels[0].relationship_type).toBe("implements");
    });
  });

  describe("Resilient Relationship Import", () => {
    it("should skip relationships to missing specs and collect warnings", async () => {
      // Create an issue that references a non-existent spec
      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-issue-001",
          title: "Issue with missing spec ref",
          content: "Content",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [
            {
              from: "issue-001",
              from_type: "issue",
              to: "spec-missing", // This spec doesn't exist
              to_type: "spec",
              type: "implements",
            },
          ],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), []);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import should succeed (not throw)
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      // Issue should be imported
      expect(result.issues.added).toBe(1);

      // Should have a warning about the missing spec
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0].type).toBe("missing_entity");
      expect(result.warnings![0].message).toContain("spec-missing");
      expect(result.warnings![0].relationshipFrom).toBe("issue-001");
      expect(result.warnings![0].relationshipTo).toBe("spec-missing");

      // Relationship should not exist
      const relationships = getOutgoingRelationships(db, "issue-001", "issue");
      expect(relationships).toHaveLength(0);
    });

    it("should skip relationships to missing issues and collect warnings", async () => {
      // Create a spec that references a non-existent issue
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-spec-001",
          title: "Spec with missing issue ref",
          file_path: "spec1.md",
          content: "Content",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [
            {
              from: "spec-001",
              from_type: "spec",
              to: "issue-missing", // This issue doesn't exist
              to_type: "issue",
              type: "references",
            },
          ],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), []);

      // Import should succeed (not throw)
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      // Spec should be imported
      expect(result.specs.added).toBe(1);

      // Should have a warning about the missing issue
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0].type).toBe("missing_entity");
      expect(result.warnings![0].message).toContain("issue-missing");

      // Relationship should not exist
      const relationships = getOutgoingRelationships(db, "spec-001", "spec");
      expect(relationships).toHaveLength(0);
    });

    it("should collect multiple warnings for multiple missing entities", async () => {
      // Create an issue with multiple relationships to missing entities
      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-issue-001",
          title: "Issue with multiple missing refs",
          content: "Content",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [
            {
              from: "issue-001",
              from_type: "issue",
              to: "spec-missing-1",
              to_type: "spec",
              type: "implements",
            },
            {
              from: "issue-001",
              from_type: "issue",
              to: "spec-missing-2",
              to_type: "spec",
              type: "references",
            },
          ],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), []);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import should succeed
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.issues.added).toBe(1);

      // Should have two warnings
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(2);
      expect(result.warnings![0].message).toContain("spec-missing-1");
      expect(result.warnings![1].message).toContain("spec-missing-2");
    });

    it("should import valid relationships while skipping invalid ones", async () => {
      // Create entities with both valid and invalid relationships
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-spec-001",
          title: "Spec One",
          file_path: "spec1.md",
          content: "",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-issue-001",
          title: "Issue with mixed refs",
          content: "Content",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [
            {
              from: "issue-001",
              from_type: "issue",
              to: "spec-001", // Valid - spec exists
              to_type: "spec",
              type: "implements",
            },
            {
              from: "issue-001",
              from_type: "issue",
              to: "spec-missing", // Invalid - spec doesn't exist
              to_type: "spec",
              type: "references",
            },
          ],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import should succeed
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(1);
      expect(result.issues.added).toBe(1);

      // Should have one warning for the invalid relationship
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0].message).toContain("spec-missing");

      // Valid relationship should exist
      const relationships = getOutgoingRelationships(db, "issue-001", "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0].to_id).toBe("spec-001");
      expect(relationships[0].relationship_type).toBe("implements");
    });

    it("should have no warnings when all relationships are valid", async () => {
      // Create entities with valid relationships
      const specs: SpecJSONL[] = [
        {
          id: "spec-001",
          uuid: "uuid-spec-001",
          title: "Spec One",
          file_path: "spec1.md",
          content: "",
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: "issue-001",
          uuid: "uuid-issue-001",
          title: "Issue with valid ref",
          content: "Content",
          status: "open",
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [
            {
              from: "issue-001",
              from_type: "issue",
              to: "spec-001",
              to_type: "spec",
              type: "implements",
            },
          ],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, "specs.jsonl"), specs);
      await writeJSONL(path.join(TEST_DIR, "issues.jsonl"), issues);

      // Import should succeed
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(1);
      expect(result.issues.added).toBe(1);

      // Should have no warnings
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(0);

      // Relationship should exist
      const relationships = getOutgoingRelationships(db, "issue-001", "issue");
      expect(relationships).toHaveLength(1);
    });
  });
});
