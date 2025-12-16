/**
 * Tests for spec-writer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  updateSpecContent,
  getSpecTitle,
  getSpecStatus,
} from "../../src/writer/spec-writer.js";

describe("Spec Writer", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `speckit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("updateSpecContent", () => {
    describe("title updates", () => {
      it("should update the title in an existing header", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Original Title

**Status**: Draft

Some content here.
`
        );

        const result = updateSpecContent(specFile, { title: "New Title" });

        expect(result.success).toBe(true);
        expect(result.changes.title).toEqual({
          from: "Original Title",
          to: "New Title",
        });

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("# New Title");
        expect(content).not.toContain("# Original Title");
      });

      it("should not change anything if title is the same", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Same Title

Content here.
`
        );

        const result = updateSpecContent(specFile, { title: "Same Title" });

        expect(result.success).toBe(true);
        expect(result.changes.title).toBeUndefined();
      });
    });

    describe("status updates", () => {
      it("should update an existing status line", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Feature Spec

**Status**: Draft

Content here.
`
        );

        const result = updateSpecContent(specFile, { status: "In Progress" });

        expect(result.success).toBe(true);
        expect(result.changes.status).toEqual({
          from: "Draft",
          to: "In Progress",
        });

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("**Status**: In Progress");
        expect(content).not.toContain("**Status**: Draft");
      });

      it("should handle status with various casings", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Feature Spec

**status**: draft

Content here.
`
        );

        const result = updateSpecContent(specFile, { status: "Complete" });

        expect(result.success).toBe(true);

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("**Status**: Complete");
      });

      it("should not change anything if status is the same", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Feature Spec

**Status**: Draft

Content here.
`
        );

        const result = updateSpecContent(specFile, { status: "Draft" });

        expect(result.success).toBe(true);
        expect(result.changes.status).toBeUndefined();
      });
    });

    describe("content updates", () => {
      it("should replace content after metadata", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Feature Spec

**Status**: Draft

Old content that should be replaced.

More old content.
`
        );

        const result = updateSpecContent(specFile, {
          content: "New content goes here.\n\nWith multiple paragraphs.",
        });

        expect(result.success).toBe(true);
        expect(result.changes.content).toBe(true);

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("# Feature Spec");
        expect(content).toContain("**Status**: Draft");
        expect(content).toContain("New content goes here.");
        expect(content).toContain("With multiple paragraphs.");
        expect(content).not.toContain("Old content");
      });
    });

    describe("combined updates", () => {
      it("should update title and status together", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Old Title

**Status**: Draft

Content here.
`
        );

        const result = updateSpecContent(specFile, {
          title: "New Title",
          status: "Complete",
        });

        expect(result.success).toBe(true);
        expect(result.changes.title).toEqual({
          from: "Old Title",
          to: "New Title",
        });
        expect(result.changes.status).toEqual({
          from: "Draft",
          to: "Complete",
        });

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("# New Title");
        expect(content).toContain("**Status**: Complete");
      });

      it("should update all fields together", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Old Title

**Status**: Draft

Old content.
`
        );

        const result = updateSpecContent(specFile, {
          title: "New Title",
          status: "In Progress",
          content: "Brand new content.",
        });

        expect(result.success).toBe(true);
        expect(result.changes.title?.to).toBe("New Title");
        expect(result.changes.status?.to).toBe("In Progress");
        expect(result.changes.content).toBe(true);

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("# New Title");
        expect(content).toContain("**Status**: In Progress");
        expect(content).toContain("Brand new content.");
        expect(content).not.toContain("Old content.");
      });
    });

    describe("edge cases", () => {
      it("should handle file with only title", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(specFile, `# Just a Title\n`);

        const result = updateSpecContent(specFile, { title: "New Title" });

        expect(result.success).toBe(true);

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("# New Title");
      });

      it("should handle empty content update", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Title

Content here.
`
        );

        const result = updateSpecContent(specFile, { content: "" });

        expect(result.success).toBe(true);

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("# Title");
      });

      it("should preserve other metadata fields", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Feature Spec

**Status**: Draft
**Priority**: High
**Author**: John Doe

Content here.
`
        );

        const result = updateSpecContent(specFile, { status: "Complete" });

        expect(result.success).toBe(true);

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("**Status**: Complete");
        expect(content).toContain("**Priority**: High");
        expect(content).toContain("**Author**: John Doe");
      });

      it("should return error for non-existent file", () => {
        const result = updateSpecContent(join(testDir, "nonexistent.md"), {
          title: "New Title",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("not found");
      });

      it("should return error for empty file path", () => {
        const result = updateSpecContent("", { title: "New Title" });

        expect(result.success).toBe(false);
        expect(result.error).toContain("required");
      });

      it("should return error when no updates provided", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(specFile, "# Title\n");

        const result = updateSpecContent(specFile, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain("At least one update");
      });

      it("should handle file with multiple hash headers", () => {
        const specFile = join(testDir, "spec.md");
        writeFileSync(
          specFile,
          `# Main Title

## Section 1

Content in section 1.

## Section 2

Content in section 2.
`
        );

        const result = updateSpecContent(specFile, { title: "Updated Title" });

        expect(result.success).toBe(true);

        const content = readFileSync(specFile, "utf-8");
        expect(content).toContain("# Updated Title");
        expect(content).toContain("## Section 1");
        expect(content).toContain("## Section 2");
      });
    });
  });

  describe("getSpecTitle", () => {
    it("should return the title from a spec file", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Feature Title

Content here.
`
      );

      expect(getSpecTitle(specFile)).toBe("Feature Title");
    });

    it("should return null for file without title", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "Just some content without a title.\n");

      expect(getSpecTitle(specFile)).toBeNull();
    });

    it("should return null for non-existent file", () => {
      expect(getSpecTitle(join(testDir, "nonexistent.md"))).toBeNull();
    });

    it("should trim whitespace from title", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "#   Title With Spaces   \n");

      expect(getSpecTitle(specFile)).toBe("Title With Spaces");
    });
  });

  describe("getSpecStatus", () => {
    it("should return the status from a spec file", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Feature

**Status**: In Progress

Content here.
`
      );

      expect(getSpecStatus(specFile)).toBe("In Progress");
    });

    it("should return null for file without status", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Feature

Content without status.
`
      );

      expect(getSpecStatus(specFile)).toBeNull();
    });

    it("should return null for non-existent file", () => {
      expect(getSpecStatus(join(testDir, "nonexistent.md"))).toBeNull();
    });

    it("should trim whitespace from status", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Feature

**Status**:   Draft

Content.
`
      );

      expect(getSpecStatus(specFile)).toBe("Draft");
    });
  });
});
