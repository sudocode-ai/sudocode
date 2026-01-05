/**
 * Unit tests for Git Merge-File Wrapper
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mergeYamlContent,
  readGitStage,
  type MergeInput,
  type MergeResult,
} from "../../src/git-merge.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

describe("Git Merge-File Wrapper", () => {
  describe("mergeYamlContent", () => {
    it("should perform clean merge with no conflicts", () => {
      // Git merge-file only produces clean merge when changes don't overlap
      // Here, we modify completely different lines with separation
      const input: MergeInput = {
        base: "field1: base\n\nfield3: base",
        ours: "field1: ours\n\nfield3: base",
        theirs: "field1: base\n\nfield3: theirs",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("field1: ours");
      expect(result.content).toContain("field3: theirs");
    });

    it("should detect conflicts when both sides modify the same line", () => {
      const input: MergeInput = {
        base: "title: Original\nstatus: open",
        ours: "title: Our Change\nstatus: open",
        theirs: "title: Their Change\nstatus: open",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("<<<<<<");
      expect(result.content).toContain("======");
      expect(result.content).toContain(">>>>>>");
      expect(result.content).toContain("Our Change");
      expect(result.content).toContain("Their Change");
    });

    it("should handle merge with additions from both sides", () => {
      // When both sides add at the end, git treats it as a conflict
      // This is conservative but correct - both added different content at the same location
      const input: MergeInput = {
        base: "title: Original\nfield1: value",
        ours: "title: Original\nfield1: value\nours_field: added by us",
        theirs: "title: Original\nfield1: value\ntheirs_field: added by them",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("title: Original");
      // Both additions should be in the conflict markers
      expect(result.content).toContain("ours_field: added by us");
      expect(result.content).toContain("theirs_field: added by them");
      expect(result.content).toContain("<<<<<<");
    });

    it("should handle merge when only our side changed", () => {
      const input: MergeInput = {
        base: "title: Original\nstatus: open",
        ours: "title: Updated\nstatus: in_progress",
        theirs: "title: Original\nstatus: open",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("title: Updated");
      expect(result.content).toContain("status: in_progress");
    });

    it("should handle merge when only their side changed", () => {
      const input: MergeInput = {
        base: "title: Original\nstatus: open",
        ours: "title: Original\nstatus: open",
        theirs: "title: Modified\nstatus: closed",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("title: Modified");
      expect(result.content).toContain("status: closed");
    });

    it("should handle merge with no changes", () => {
      const input: MergeInput = {
        base: "title: Same\nstatus: open",
        ours: "title: Same\nstatus: open",
        theirs: "title: Same\nstatus: open",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("title: Same");
      expect(result.content).toContain("status: open");
    });

    it("should handle multi-line YAML content", () => {
      const input: MergeInput = {
        base: "title: Original\ndescription: |\n  Line 1\n  Line 2\nstatus: open",
        ours: "title: Updated\ndescription: |\n  Line 1\n  Line 2\nstatus: open",
        theirs: "title: Original\ndescription: |\n  Line 1\n  Line 2\nstatus: closed",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("title: Updated");
      expect(result.content).toContain("status: closed");
      expect(result.content).toContain("Line 1");
      expect(result.content).toContain("Line 2");
    });

    it("should handle empty base (both sides added)", () => {
      const input: MergeInput = {
        base: "",
        ours: "title: Our Addition\nstatus: open",
        theirs: "title: Their Addition\nstatus: closed",
      };

      const result: MergeResult = mergeYamlContent(input);

      // This will likely have conflicts since both added different content
      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("<<<<<<");
    });

    it("should handle deletion conflicts", () => {
      const input: MergeInput = {
        base: "title: Original\nstatus: open\npriority: 1",
        ours: "title: Original\npriority: 1",
        theirs: "title: Original\nstatus: modified",
      };

      const result: MergeResult = mergeYamlContent(input);

      // One side deleted, other modified - should have conflict
      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("<<<<<<");
    });

    it("should handle large YAML content", () => {
      const largeContent = Array.from({ length: 100 }, (_, i) => `field_${i}: value_${i}`).join("\n");

      const input: MergeInput = {
        base: largeContent,
        ours: largeContent + "\nfield_100: our_addition",
        theirs: largeContent + "\nfield_101: their_addition",
      };

      const result: MergeResult = mergeYamlContent(input);

      // Both adding at the end creates a conflict
      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("field_100: our_addition");
      expect(result.content).toContain("field_101: their_addition");
      expect(result.content).toContain("field_99: value_99");
    });

    it("should handle YAML with special characters", () => {
      const input: MergeInput = {
        base: "title: Original\nspecial: 'quotes \"and\" stuff'\nfield: base",
        ours: "title: Updated\nspecial: 'quotes \"and\" stuff'\nfield: base",
        theirs: "title: Original\nspecial: 'quotes \"and\" stuff'\nfield: base\nnew: test",
      };

      const result: MergeResult = mergeYamlContent(input);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("title: Updated");
      expect(result.content).toContain('quotes "and" stuff');
      expect(result.content).toContain("new: test");
    });
  });

  describe("Real-world Scenarios", () => {
    it("should handle typical issue JSONL merge scenario", () => {
      // Real-world: separate field changes with proper spacing
      const baseIssue = `id: i-test
uuid: 550e8400-e29b-41d4-a716-446655440000
title: Fix bug
status: open
priority: 1
created_at: "2024-01-01T00:00:00Z"
updated_at: "2024-01-01T00:00:00Z"`;

      const oursIssue = `id: i-test
uuid: 550e8400-e29b-41d4-a716-446655440000
title: Fix bug
status: in_progress
priority: 1
created_at: "2024-01-01T00:00:00Z"
updated_at: "2024-01-02T10:00:00Z"`;

      const theirsIssue = `id: i-test
uuid: 550e8400-e29b-41d4-a716-446655440000
title: Fix bug
status: open
priority: 0
created_at: "2024-01-01T00:00:00Z"
updated_at: "2024-01-02T11:00:00Z"`;

      const result = mergeYamlContent({
        base: baseIssue,
        ours: oursIssue,
        theirs: theirsIssue,
      });

      // Note: This will have conflicts because changes overlap (status and priority are adjacent)
      // In real JSONL merge, we'll handle conflicts at a higher level
      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("<<<<<<");
      // But both changes are in the output
      expect(result.content).toContain("in_progress");
      expect(result.content).toContain("priority: 0");
    });

    it("should handle spec with complex nested YAML", () => {
      const baseSpec = `title: API Spec
description: Original description

requirements:
  - Authentication
  - Rate limiting`;

      const oursSpec = `title: API Spec v2
description: Original description

requirements:
  - Authentication
  - Rate limiting`;

      const theirsSpec = `title: API Spec
description: Original description

requirements:
  - Authentication
  - Rate limiting
  - CORS support`;

      const result = mergeYamlContent({
        base: baseSpec,
        ours: oursSpec,
        theirs: theirsSpec,
      });

      // With blank line separation, git can merge cleanly
      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.content).toContain("title: API Spec v2");
      expect(result.content).toContain("CORS support");
    });
  });
});
