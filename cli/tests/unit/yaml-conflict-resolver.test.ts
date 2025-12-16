/**
 * Unit tests for YAML Conflict Resolver
 */

import { describe, it, expect } from "vitest";
import {
  parseConflicts,
  resolveConflict,
  resolveConflicts,
  type ConflictSection,
} from "../../src/yaml-conflict-resolver.js";

describe("YAML Conflict Resolver", () => {
  describe("parseConflicts", () => {
    it("should parse a simple conflict", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Our Title
=======
title: Their Title
>>>>>>> theirs
status: open`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ours).toBe("title: Our Title");
      expect(conflicts[0].theirs).toBe("title: Their Title");
      expect(conflicts[0].startLine).toBe(1);
      expect(conflicts[0].endLine).toBe(5);
    });

    it("should parse multiple conflicts", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Our Title
=======
title: Their Title
>>>>>>> theirs
status: open
<<<<<<< HEAD
priority: 1
=======
priority: 2
>>>>>>> theirs
assignee: null`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(2);
      expect(conflicts[0].ours).toBe("title: Our Title");
      expect(conflicts[1].ours).toBe("priority: 1");
    });

    it("should parse multi-line conflicts", () => {
      const content = `id: test-123
<<<<<<< HEAD
description: |
  Line 1
  Line 2
updated_at: 2025-01-02T10:00:00Z
=======
description: |
  Line 3
  Line 4
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ours).toContain("Line 1");
      expect(conflicts[0].ours).toContain("Line 2");
      expect(conflicts[0].theirs).toContain("Line 3");
      expect(conflicts[0].theirs).toContain("Line 4");
    });

    it("should return empty array when no conflicts", () => {
      const content = `id: test-123
title: Clean Title
status: open
priority: 1`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(0);
    });

    it("should handle conflicts at start of file", () => {
      const content = `<<<<<<< HEAD
id: our-id
=======
id: their-id
>>>>>>> theirs
title: Test`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ours).toBe("id: our-id");
    });

    it("should handle conflicts at end of file", () => {
      const content = `id: test-123
<<<<<<< HEAD
status: open
=======
status: closed
>>>>>>> theirs`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ours).toBe("status: open");
      expect(conflicts[0].theirs).toBe("status: closed");
    });

    it("should handle empty ours section", () => {
      const content = `id: test-123
<<<<<<< HEAD
=======
new_field: value
>>>>>>> theirs
status: open`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ours).toBe("");
      expect(conflicts[0].theirs).toBe("new_field: value");
    });

    it("should handle empty theirs section", () => {
      const content = `id: test-123
<<<<<<< HEAD
new_field: value
=======
>>>>>>> theirs
status: open`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ours).toBe("new_field: value");
      expect(conflicts[0].theirs).toBe("");
    });

    it("should handle conflict markers with branch names", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Our Title
=======
title: Their Title
>>>>>>> feature/new-feature
status: open`;

      const conflicts = parseConflicts(content);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].ours).toBe("title: Our Title");
      expect(conflicts[0].theirs).toBe("title: Their Title");
    });
  });

  describe("resolveConflict", () => {
    it("should choose ours when ours has newer timestamp", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: 2025-01-02T10:00:00Z",
        theirs: "title: Their Title\nupdated_at: 2025-01-01T10:00:00Z",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should choose theirs when theirs has newer timestamp", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: 2025-01-01T10:00:00Z",
        theirs: "title: Their Title\nupdated_at: 2025-01-02T10:00:00Z",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.theirs);
    });

    it("should choose ours when timestamps are identical", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: 2025-01-01T10:00:00Z",
        theirs: "title: Their Title\nupdated_at: 2025-01-01T10:00:00Z",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should choose ours when neither has timestamp", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title",
        theirs: "title: Their Title",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should choose theirs when only theirs has timestamp", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title",
        theirs: "title: Their Title\nupdated_at: 2025-01-01T10:00:00Z",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.theirs);
    });

    it("should choose ours when only ours has timestamp", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: 2025-01-01T10:00:00Z",
        theirs: "title: Their Title",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should handle quoted timestamps", () => {
      const conflict: ConflictSection = {
        ours: 'title: Our Title\nupdated_at: "2025-01-02T10:00:00Z"',
        theirs: 'title: Their Title\nupdated_at: "2025-01-01T10:00:00Z"',
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should handle single-quoted timestamps", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: '2025-01-02T10:00:00Z'",
        theirs: "title: Their Title\nupdated_at: '2025-01-01T10:00:00Z'",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should handle space-separated timestamp format", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: 2025-01-02 10:00:00",
        theirs: "title: Their Title\nupdated_at: 2025-01-01 10:00:00",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should handle timestamps with milliseconds", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: 2025-01-01T10:00:00.500Z",
        theirs: "title: Their Title\nupdated_at: 2025-01-01T10:00:00.100Z",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
    });

    it("should treat invalid timestamp as oldest", () => {
      const conflict: ConflictSection = {
        ours: "title: Our Title\nupdated_at: invalid-date",
        theirs: "title: Their Title\nupdated_at: 2025-01-01T10:00:00Z",
        startLine: 0,
        endLine: 5,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.theirs);
    });

    it("should handle multi-line content with timestamp", () => {
      const conflict: ConflictSection = {
        ours: "description: |\n  Line 1\n  Line 2\nupdated_at: 2025-01-02T10:00:00Z",
        theirs: "description: |\n  Line 3\n  Line 4\nupdated_at: 2025-01-01T10:00:00Z",
        startLine: 0,
        endLine: 8,
      };

      const resolved = resolveConflict(conflict);

      expect(resolved).toBe(conflict.ours);
      expect(resolved).toContain("Line 1");
    });
  });

  describe("resolveConflicts", () => {
    it("should resolve single conflict", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Our Title
updated_at: 2025-01-02T10:00:00Z
=======
title: Their Title
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictsResolved).toBe(1);
      expect(result.content).toContain("Our Title");
      expect(result.content).not.toContain("<<<<<<<");
      expect(result.content).not.toContain(">>>>>>>");
    });

    it("should resolve multiple conflicts", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Our Title
updated_at: 2025-01-02T10:00:00Z
=======
title: Their Title
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open
<<<<<<< HEAD
priority: 1
updated_at: 2025-01-01T10:00:00Z
=======
priority: 2
updated_at: 2025-01-02T10:00:00Z
>>>>>>> theirs
assignee: null`;

      const result = resolveConflicts(content);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictsResolved).toBe(2);
      expect(result.content).toContain("Our Title"); // Ours wins (newer)
      expect(result.content).toContain("priority: 2"); // Theirs wins (newer)
      expect(result.content).not.toContain("<<<<<<<");
    });

    it("should preserve non-conflict content", () => {
      const content = `id: test-123
uuid: 550e8400-e29b-41d4-a716-446655440000
<<<<<<< HEAD
title: Our Title
updated_at: 2025-01-02T10:00:00Z
=======
title: Their Title
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open
priority: 1`;

      const result = resolveConflicts(content);

      expect(result.content).toContain("id: test-123");
      expect(result.content).toContain("uuid: 550e8400-e29b-41d4-a716-446655440000");
      expect(result.content).toContain("status: open");
      expect(result.content).toContain("priority: 1");
    });

    it("should return unchanged content when no conflicts", () => {
      const content = `id: test-123
title: Clean Title
status: open
priority: 1`;

      const result = resolveConflicts(content);

      expect(result.hasConflicts).toBe(false);
      expect(result.conflictsResolved).toBe(0);
      expect(result.content).toBe(content);
    });

    it("should handle complex multi-line conflicts", () => {
      const content = `id: test-123
<<<<<<< HEAD
description: |
  ## Overview
  Our changes here
  Multiple lines
tags:
  - backend
  - api
updated_at: 2025-01-02T10:00:00Z
=======
description: |
  ## Overview
  Their changes here
  Different content
tags:
  - frontend
  - ui
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictsResolved).toBe(1);
      expect(result.content).toContain("Our changes here");
      expect(result.content).not.toContain("Their changes here");
      expect(result.content).toContain("backend");
      expect(result.content).toContain("api");
    });

    it("should maintain YAML structure after resolution", () => {
      const content = `id: test-123
title: Test Issue
<<<<<<< HEAD
status: in_progress
updated_at: 2025-01-02T10:00:00Z
=======
status: open
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
priority: 1
assignee: null`;

      const result = resolveConflicts(content);

      // Check that YAML structure is maintained
      expect(result.content).toMatch(/id: test-123/);
      expect(result.content).toMatch(/title: Test Issue/);
      expect(result.content).toMatch(/status: in_progress/);
      expect(result.content).toMatch(/priority: 1/);
      expect(result.content).toMatch(/assignee: null/);
    });

    it("should handle conflicts with empty sections", () => {
      const content = `id: test-123
<<<<<<< HEAD
new_field: our_value
updated_at: 2025-01-02T10:00:00Z
=======
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictsResolved).toBe(1);
      expect(result.content).toContain("new_field: our_value");
    });

    it("should handle consecutive conflicts", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Our Title
updated_at: 2025-01-02T10:00:00Z
=======
title: Their Title
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
<<<<<<< HEAD
description: Our Description
updated_at: 2025-01-01T10:00:00Z
=======
description: Their Description
updated_at: 2025-01-02T10:00:00Z
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.conflictsResolved).toBe(2);
      expect(result.content).toContain("Our Title"); // Ours newer
      expect(result.content).toContain("Their Description"); // Theirs newer
    });
  });

  describe("Edge Cases", () => {
    it("should handle conflict with no updated_at in either version", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Our Title
priority: 1
=======
title: Their Title
priority: 2
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictsResolved).toBe(1);
      // Should default to ours when no timestamps
      expect(result.content).toContain("Our Title");
      expect(result.content).toContain("priority: 1");
    });

    it("should handle timestamp at different positions in section", () => {
      const content = `id: test-123
<<<<<<< HEAD
updated_at: 2025-01-02T10:00:00Z
title: Our Title
status: in_progress
=======
title: Their Title
status: open
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
priority: 1`;

      const result = resolveConflicts(content);

      expect(result.content).toContain("Our Title");
    });

    it("should handle very long conflict sections", () => {
      const longContent = Array(100)
        .fill("  - item")
        .join("\n");

      const content = `id: test-123
<<<<<<< HEAD
tags:
${longContent}
updated_at: 2025-01-02T10:00:00Z
=======
tags:
  - different
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("item"); // Ours wins (longer, newer)
      expect(result.content).not.toContain("different");
    });

    it("should handle conflicts with special YAML characters", () => {
      const content = `id: test-123
<<<<<<< HEAD
message: "Error: failed"
updated_at: 2025-01-02T10:00:00Z
=======
message: 'Success: completed'
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.content).toContain("Error: failed");
    });

    it("should handle conflicts with unicode characters", () => {
      const content = `id: test-123
<<<<<<< HEAD
title: Test with émoji 🎉
updated_at: 2025-01-02T10:00:00Z
=======
title: Test with different émoji 🚀
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.content).toContain("🎉");
      expect(result.content).not.toContain("🚀");
    });

    it("should handle nested YAML conflicts", () => {
      const content = `id: test-123
<<<<<<< HEAD
metadata:
  author: Alice
  tags:
    - test
    - demo
updated_at: 2025-01-02T10:00:00Z
=======
metadata:
  author: Bob
  tags:
    - prod
    - release
updated_at: 2025-01-01T10:00:00Z
>>>>>>> theirs
status: open`;

      const result = resolveConflicts(content);

      expect(result.content).toContain("Alice");
      expect(result.content).toContain("test");
      expect(result.content).not.toContain("Bob");
    });

    it("should handle conflict markers with extra whitespace", () => {
      const content = `id: test-123
<<<<<<<   HEAD
title: Our Title
updated_at: 2025-01-02T10:00:00Z
=======
title: Their Title
updated_at: 2025-01-01T10:00:00Z
>>>>>>>   theirs
status: open`;

      const result = resolveConflicts(content);

      // Parser should still recognize markers despite extra whitespace
      expect(result.hasConflicts).toBe(true);
      expect(result.content).toContain("Our Title");
    });
  });
});
