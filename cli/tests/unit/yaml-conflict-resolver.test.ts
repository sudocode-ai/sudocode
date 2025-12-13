/**
 * Unit tests for YAML conflict resolver with latest-wins strategy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Issue, Spec } from "@sudocode-ai/types";
import {
  resolveYamlConflicts,
  hasConflicts,
} from "../../src/yaml-conflict-resolver.js";

describe("YAML Conflict Resolver", () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe("hasConflicts", () => {
    it("should detect YAML with conflict markers", () => {
      const yamlWithConflicts = `id: s-123
title: Test
<<<<<<< ours
description: Our version
=======
description: Their version
>>>>>>> theirs`;

      expect(hasConflicts(yamlWithConflicts)).toBe(true);
    });

    it("should return false for clean YAML", () => {
      const cleanYaml = `id: s-123
title: Test
description: Clean content`;

      expect(hasConflicts(cleanYaml)).toBe(false);
    });

    it("should return false for partial conflict markers", () => {
      expect(hasConflicts("<<<<<<< only start marker")).toBe(false);
      expect(hasConflicts(">>>>>>> only end marker")).toBe(false);
    });
  });

  describe("resolveYamlConflicts", () => {
    describe("no conflicts", () => {
      it("should return unchanged YAML when no conflicts exist", () => {
        const cleanYaml = `id: s-123
title: Test Spec
content: Clean content with no conflicts`;

        const oursEntity: Spec = {
          id: "s-123",
          uuid: "uuid-1",
          title: "Test",
          file_path: "/test.md",
          content: "ours",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T12:00:00Z",
        };

        const theirsEntity: Spec = {
          id: "s-123",
          uuid: "uuid-1",
          title: "Test",
          file_path: "/test.md",
          content: "theirs",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T11:00:00Z",
        };

        const result = resolveYamlConflicts(cleanYaml, oursEntity, theirsEntity);
        expect(result).toBe(cleanYaml);
      });
    });

    describe("ours wins (newer timestamp)", () => {
      it("should use ours when ours has newer timestamp", () => {
        const conflictedYaml = `id: s-123
title: Test
<<<<<<< ours
description: Our version
=======
description: Their version
>>>>>>> theirs
priority: 1`;

        const oursEntity: Spec = {
          id: "s-123",
          uuid: "uuid-1",
          title: "Test",
          file_path: "/test.md",
          content: "ours",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T12:00:00Z", // Newer
        };

        const theirsEntity: Spec = {
          id: "s-123",
          uuid: "uuid-1",
          title: "Test",
          file_path: "/test.md",
          content: "theirs",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T11:00:00Z", // Older
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        expect(result).toContain("description: Our version");
        expect(result).not.toContain("description: Their version");
        expect(result).not.toContain("<<<<<<<");
        expect(result).not.toContain(">>>>>>>");
        expect(result).not.toContain("=======");
      });

      it("should use ours when timestamps are equal", () => {
        const conflictedYaml = `<<<<<<< ours
content: Ours
=======
content: Theirs
>>>>>>> theirs`;

        const oursEntity: Issue = {
          id: "i-123",
          uuid: "uuid-1",
          title: "Test",
          status: "open",
          content: "ours",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T10:00:00Z", // Same
        };

        const theirsEntity: Issue = {
          id: "i-123",
          uuid: "uuid-1",
          title: "Test",
          status: "open",
          content: "theirs",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T10:00:00Z", // Same
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        expect(result).toContain("content: Ours");
        expect(result).not.toContain("content: Theirs");
      });
    });

    describe("theirs wins (newer timestamp)", () => {
      it("should use theirs when theirs has newer timestamp", () => {
        const conflictedYaml = `id: i-456
<<<<<<< ours
status: open
=======
status: in_progress
>>>>>>> theirs
priority: 2`;

        const oursEntity: Issue = {
          id: "i-456",
          uuid: "uuid-2",
          title: "Test Issue",
          status: "open",
          content: "test",
          priority: 2,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T11:00:00Z", // Older
        };

        const theirsEntity: Issue = {
          id: "i-456",
          uuid: "uuid-2",
          title: "Test Issue",
          status: "in_progress",
          content: "test",
          priority: 2,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T13:00:00Z", // Newer
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        expect(result).toContain("status: in_progress");
        expect(result).not.toContain("status: open");
        expect(result).not.toContain("<<<<<<<");
      });
    });

    describe("multiple conflicts", () => {
      it("should resolve all conflicts in YAML", () => {
        const conflictedYaml = `id: s-789
<<<<<<< ours
title: Our Title
=======
title: Their Title
>>>>>>> theirs
content: |
  Some content
<<<<<<< ours
  Our additional line
=======
  Their additional line
>>>>>>> theirs
  More content
<<<<<<< ours
priority: 1
=======
priority: 2
>>>>>>> theirs`;

        const oursEntity: Spec = {
          id: "s-789",
          uuid: "uuid-3",
          title: "Our Title",
          file_path: "/test.md",
          content: "ours",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T14:00:00Z", // Newer
        };

        const theirsEntity: Spec = {
          id: "s-789",
          uuid: "uuid-3",
          title: "Their Title",
          file_path: "/test.md",
          content: "theirs",
          priority: 2,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T12:00:00Z", // Older
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        // All conflicts should be resolved with ours (newer)
        expect(result).toContain("title: Our Title");
        expect(result).toContain("Our additional line");
        expect(result).toContain("priority: 1");

        // Should not contain their versions
        expect(result).not.toContain("Their Title");
        expect(result).not.toContain("Their additional line");
        expect(result).not.toContain("priority: 2");

        // No conflict markers should remain
        expect(result).not.toContain("<<<<<<<");
        expect(result).not.toContain(">>>>>>>");
        expect(result).not.toContain("=======");
      });
    });

    describe("timestamp edge cases", () => {
      it("should handle ISO 8601 format with T separator", () => {
        const conflictedYaml = `<<<<<<< ours
value: ours
=======
value: theirs
>>>>>>> theirs`;

        const oursEntity: Issue = {
          id: "i-t1",
          uuid: "uuid-t1",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T12:00:00Z", // ISO 8601 with T
        };

        const theirsEntity: Issue = {
          id: "i-t1",
          uuid: "uuid-t1",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T11:00:00Z",
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);
        expect(result).toContain("value: ours");
      });

      it("should handle ISO 8601 format with space separator", () => {
        const conflictedYaml = `<<<<<<< ours
value: ours
=======
value: theirs
>>>>>>> theirs`;

        const oursEntity: Issue = {
          id: "i-t2",
          uuid: "uuid-t2",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01 10:00:00",
          updated_at: "2025-01-01 11:00:00", // Older (space separator)
        };

        const theirsEntity: Issue = {
          id: "i-t2",
          uuid: "uuid-t2",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01 10:00:00",
          updated_at: "2025-01-01 12:00:00", // Newer (space separator)
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);
        expect(result).toContain("value: theirs");
      });

      it("should treat missing timestamp as oldest", () => {
        const conflictedYaml = `<<<<<<< ours
value: ours
=======
value: theirs
>>>>>>> theirs`;

        const oursEntity: Issue = {
          id: "i-missing",
          uuid: "uuid-m1",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: undefined as any, // Missing
        };

        const theirsEntity: Issue = {
          id: "i-missing",
          uuid: "uuid-m1",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T11:00:00Z", // Present
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);
        expect(result).toContain("value: theirs"); // Theirs wins (ours is missing)
      });

      it("should treat invalid timestamp as oldest and log warning", () => {
        const conflictedYaml = `<<<<<<< ours
value: ours
=======
value: theirs
>>>>>>> theirs`;

        const oursEntity: Issue = {
          id: "i-invalid",
          uuid: "uuid-i1",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "not-a-valid-date", // Invalid
        };

        const theirsEntity: Issue = {
          id: "i-invalid",
          uuid: "uuid-i1",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T11:00:00Z", // Valid
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        expect(result).toContain("value: theirs"); // Theirs wins (ours is invalid)
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid timestamp")
        );
      });

      it("should default to ours when both timestamps are missing", () => {
        const conflictedYaml = `<<<<<<< ours
value: ours
=======
value: theirs
>>>>>>> theirs`;

        const oursEntity: Issue = {
          id: "i-both-missing",
          uuid: "uuid-bm",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: undefined as any, // Missing
        };

        const theirsEntity: Issue = {
          id: "i-both-missing",
          uuid: "uuid-bm",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: undefined as any, // Missing
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        expect(result).toContain("value: ours"); // Default to ours
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Both entities have missing/invalid timestamps")
        );
      });
    });

    describe("multi-line content conflicts", () => {
      it("should resolve conflicts in multi-line literal strings", () => {
        const conflictedYaml = `id: s-ml
title: Multi-line test
<<<<<<< ours
content: |
  ## Overview
  Our version of overview

  ## Details
  Some details
=======
content: |
  ## Overview
  Their version of overview

  ## Details
  Some details
>>>>>>> theirs
priority: 1`;

        const oursEntity: Spec = {
          id: "s-ml",
          uuid: "uuid-ml",
          title: "Multi-line test",
          file_path: "/test.md",
          content: "ours",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T15:00:00Z", // Newer
        };

        const theirsEntity: Spec = {
          id: "s-ml",
          uuid: "uuid-ml",
          title: "Multi-line test",
          file_path: "/test.md",
          content: "theirs",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T14:00:00Z", // Older
        };

        const result = resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        expect(result).toContain("Our version of overview");
        expect(result).not.toContain("Their version of overview");
        expect(result).not.toContain("<<<<<<<");
      });
    });

    describe("logging", () => {
      it("should log resolution decision with timestamps", () => {
        const conflictedYaml = `<<<<<<< ours
value: ours
=======
value: theirs
>>>>>>> theirs`;

        const oursEntity: Issue = {
          id: "i-log",
          uuid: "uuid-log",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T12:00:00Z",
        };

        const theirsEntity: Issue = {
          id: "i-log",
          uuid: "uuid-log",
          title: "Test",
          status: "open",
          content: "test",
          priority: 1,
          created_at: "2025-01-01T10:00:00Z",
          updated_at: "2025-01-01T11:00:00Z",
        };

        resolveYamlConflicts(conflictedYaml, oursEntity, theirsEntity);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("Resolving 1 conflict(s) - ours wins")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("2025-01-01T12:00:00")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("2025-01-01T11:00:00")
        );
      });
    });
  });
});
