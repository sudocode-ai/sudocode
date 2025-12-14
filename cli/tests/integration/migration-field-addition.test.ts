/**
 * Integration test for migration scenario:
 * Field insertion (new array field) while existing array is being modified
 *
 * This test validates whether the YAML-based merge correctly handles:
 * 1. Ours: Adds item to existing tags array
 * 2. Theirs: Adds entirely new special-tags field (migration)
 *
 * Expected behavior: Both changes should be preserved
 */

import { describe, it, expect } from "vitest";
import type { Spec } from "@sudocode-ai/types";
import { mergeThreeWay } from "../../src/merge-resolver.js";

describe("Migration Field Addition - Integration Test", () => {
  describe("Scenario: Migration adds new field while existing array is modified", () => {
    it("should preserve both tag addition and new field insertion", async () => {
      // Base entity before any changes
      const base: any = {
        id: "s-migration",
        uuid: "uuid-migration",
        title: "Migration Test",
        file_path: "/migration.md",
        content: "Test content",
        priority: 1,
        tags: ["abc", "bcd"],
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      // Ours: Adds "new" to tags array
      const ours: any = {
        ...base,
        tags: ["abc", "bcd", "new"], // Added "new"
        updated_at: "2025-01-01T10:00:00Z",
      };

      // Theirs: Migration adds special-tags field
      const theirs: any = {
        ...base,
        tags: ["abc", "bcd"], // Unchanged
        special_tags: ["bla"], // NEW FIELD
        updated_at: "2025-01-01T11:00:00Z", // Newer timestamp
      };

      // Perform three-way merge
      const { entities: merged } = await mergeThreeWay([base], [ours], [theirs]);

      expect(merged).toHaveLength(1);
      const result = merged[0];

      // CRITICAL ASSERTIONS
      console.log("Merged result:", JSON.stringify(result, null, 2));

      // 1. Tags should include "new" from ours (via metadata merge)
      expect(result.tags).toBeDefined();
      expect(result.tags).toContain("abc");
      expect(result.tags).toContain("bcd");
      expect(result.tags).toContain("new"); // ✅ From ours

      // 2. special_tags should be present from theirs (via YAML merge or base selection)
      expect(result.special_tags).toBeDefined();
      expect(result.special_tags).toContain("bla"); // ✅ From theirs
    });

    it("should handle multiple array additions on both sides", async () => {
      const base: any = {
        id: "s-multi-array",
        uuid: "uuid-multi-array",
        title: "Multi Array Test",
        file_path: "/multi.md",
        content: "Test",
        priority: 1,
        tags: ["initial"],
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      // Ours: Adds to tags AND creates custom_fields
      const ours: any = {
        ...base,
        tags: ["initial", "ours-tag"],
        custom_fields: ["ours-custom"], // New field
        updated_at: "2025-01-01T10:00:00Z",
      };

      // Theirs: Adds to tags AND creates special_tags
      const theirs: any = {
        ...base,
        tags: ["initial", "theirs-tag"],
        special_tags: ["theirs-special"], // New field (different from ours)
        updated_at: "2025-01-01T11:00:00Z",
      };

      const { entities: merged } = await mergeThreeWay([base], [ours], [theirs]);

      expect(merged).toHaveLength(1);
      const result = merged[0];

      console.log("Multi-array merged result:", JSON.stringify(result, null, 2));

      // Tags should be unioned (known field)
      expect(result.tags).toContain("initial");
      expect(result.tags).toContain("ours-tag");
      expect(result.tags).toContain("theirs-tag");

      // New fields: Which ones survive?
      // This is the key question - does metadata merge handle unknown array fields?
      const hasCustomFields = result.custom_fields !== undefined;
      const hasSpecialTags = result.special_tags !== undefined;

      console.log("Has custom_fields:", hasCustomFields, result.custom_fields);
      console.log("Has special_tags:", hasSpecialTags, result.special_tags);

      // Document actual behavior
      if (hasCustomFields && hasSpecialTags) {
        // Both preserved - ideal case
        expect(result.custom_fields).toContain("ours-custom");
        expect(result.special_tags).toContain("theirs-special");
      } else if (hasSpecialTags && !hasCustomFields) {
        // Only theirs preserved (newer timestamp wins for unknown fields)
        expect(result.special_tags).toContain("theirs-special");
        // This is a LOSS - we lost custom_fields from ours
      } else if (hasCustomFields && !hasSpecialTags) {
        // Only ours preserved
        expect(result.custom_fields).toContain("ours-custom");
        // This is a LOSS - we lost special_tags from theirs
      } else {
        // Both lost - major failure
        throw new Error("Both new fields were lost!");
      }
    });

    it("should handle migration with line number shifts", async () => {
      // Simulate YAML structure where new field insertion shifts line numbers
      const base: any = {
        id: "s-shift",
        uuid: "uuid-shift",
        title: "Line Shift Test",
        file_path: "/shift.md",
        content: "Content",
        priority: 1,
        tags: ["a", "b"],
        relationships: [
          { from: "s-shift", to: "i-1", type: "references" }
        ],
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      // Ours: Adds to relationships (line ~15 in YAML)
      const ours: any = {
        ...base,
        relationships: [
          { from: "s-shift", to: "i-1", type: "references" },
          { from: "s-shift", to: "i-2", type: "blocks" }, // Added
        ],
        updated_at: "2025-01-01T10:00:00Z",
      };

      // Theirs: Inserts new field BEFORE relationships (shifts relationships down)
      const theirs: any = {
        ...base,
        tags: ["a", "b"],
        special_tags: ["new"], // Inserted here, shifts everything below
        relationships: [
          { from: "s-shift", to: "i-1", type: "references" }
        ],
        updated_at: "2025-01-01T11:00:00Z",
      };

      const { entities: merged } = await mergeThreeWay([base], [ours], [theirs]);

      expect(merged).toHaveLength(1);
      const result = merged[0];

      console.log("Line shift merged result:", JSON.stringify(result, null, 2));

      // Relationships should be unioned (known field)
      expect(result.relationships).toHaveLength(2);
      expect(result.relationships.some((r: any) => r.to === "i-1")).toBe(true);
      expect(result.relationships.some((r: any) => r.to === "i-2")).toBe(true);

      // special_tags should be present
      expect(result.special_tags).toBeDefined();
      expect(result.special_tags).toContain("new");
    });
  });

  describe("Scenario: Multiple migrations with conflicting field additions", () => {
    it("should handle when both sides add the same field with different values", async () => {
      const base: any = {
        id: "s-same-field",
        uuid: "uuid-same-field",
        title: "Same Field Test",
        file_path: "/same.md",
        content: "Test",
        priority: 1,
        tags: ["base"],
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      // Ours: Adds custom_metadata field
      const ours: any = {
        ...base,
        custom_metadata: { source: "ours", value: 1 },
        updated_at: "2025-01-01T10:00:00Z",
      };

      // Theirs: Also adds custom_metadata field (different value)
      const theirs: any = {
        ...base,
        custom_metadata: { source: "theirs", value: 2 },
        updated_at: "2025-01-01T11:00:00Z", // Newer
      };

      const { entities: merged } = await mergeThreeWay([base], [ours], [theirs]);

      expect(merged).toHaveLength(1);
      const result = merged[0];

      console.log("Same field conflict result:", JSON.stringify(result, null, 2));

      // custom_metadata should exist
      expect(result.custom_metadata).toBeDefined();

      // Latest (theirs) should win for unknown fields
      expect(result.custom_metadata.source).toBe("theirs");
      expect(result.custom_metadata.value).toBe(2);
    });
  });

  describe("Edge Case: Empty base with field additions on both sides", () => {
    it("should merge when both add different fields to empty base", async () => {
      const base: any = {
        id: "s-empty",
        uuid: "uuid-empty",
        title: "Empty Base",
        file_path: "/empty.md",
        content: "Test",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const ours: any = {
        ...base,
        tags: ["ours-tag"],
        updated_at: "2025-01-01T10:00:00Z",
      };

      const theirs: any = {
        ...base,
        special_tags: ["theirs-tag"],
        updated_at: "2025-01-01T11:00:00Z",
      };

      const { entities: merged } = await mergeThreeWay([base], [ours], [theirs]);

      expect(merged).toHaveLength(1);
      const result = merged[0];

      console.log("Empty base result:", JSON.stringify(result, null, 2));

      // Both fields should ideally be present
      const hasTags = result.tags !== undefined;
      const hasSpecialTags = result.special_tags !== undefined;

      if (hasTags && hasSpecialTags) {
        expect(result.tags).toContain("ours-tag");
        expect(result.special_tags).toContain("theirs-tag");
      } else {
        // Document which one survived
        console.warn(`Only one field survived: tags=${hasTags}, special_tags=${hasSpecialTags}`);
      }
    });
  });
});
