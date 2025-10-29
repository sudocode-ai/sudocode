/**
 * Unit tests for spec CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  handleSpecCreate,
  handleSpecList,
  handleSpecShow,
  handleSpecUpdate,
  handleSpecDelete,
} from "../../../src/cli/spec-commands.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Spec CLI Commands", () => {
  let db: Database.Database;
  let tempDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ":memory:" });

    // Create temporary directory for files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));

    // Create necessary subdirectories
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "issues"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "custom"), { recursive: true });

    // Create empty JSONL files
    fs.writeFileSync(path.join(tempDir, "specs", "specs.jsonl"), "", "utf8");
    fs.writeFileSync(path.join(tempDir, "issues", "issues.jsonl"), "", "utf8");

    // Create config.json
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "spec",
        issue: "issue",
      },
    };
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify(config, null, 2)
    );

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    // Restore spies
    consoleLogSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();
    processExitSpy?.mockRestore();

    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("handleSpecCreate", () => {
    it("should create a spec in database", async () => {
      // Test that the spec is created in the database
      // We'll test the handler indirectly through database operations
      const { generateSpecId } = await import("../../../src/id-generator.js");
      const { createSpec } = await import("../../../src/operations/specs.js");
      const { getSpec } = await import("../../../src/operations/specs.js");

      const specId = generateSpecId(db, tempDir);
      const spec = createSpec(db, {
        id: specId,
        title: "Test Spec",
        file_path: path.join(tempDir, "specs", "test.md"),
        content: "",
        priority: 2,
      });

      expect(spec).toBeDefined();
      expect(spec.id).toBe(specId);
      expect(spec.title).toBe("Test Spec");

      const retrieved = getSpec(db, specId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe("Test Spec");
    });
  });

  describe("handleSpecList", () => {
    beforeEach(async () => {
      // Create test specs directly in database
      const { createSpec } = await import("../../../src/operations/specs.js");
      const { generateSpecId } = await import("../../../src/id-generator.js");

      createSpec(db, {
        id: generateSpecId(db, tempDir),
        title: "Spec 1",
        file_path: path.join(tempDir, "specs", "spec1.md"),
        content: "",
        priority: 1,
      });

      createSpec(db, {
        id: generateSpecId(db, tempDir),
        title: "Spec 2",
        file_path: path.join(tempDir, "specs", "spec2.md"),
        content: "",
        priority: 2,
      });

      consoleLogSpy.mockClear();
    });

    it("should list all specs", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = { limit: "50" };

      await handleSpecList(ctx, options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Found 2 spec(s)")
      );
    });

    it("should filter specs by priority", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        priority: "1",
        limit: "50",
      };

      await handleSpecList(ctx, options);

      const calls = consoleLogSpy.mock.calls.flat().join(" ");
      expect(calls).toContain("Spec 1");
      expect(calls).not.toContain("Spec 2");
    });

    it("should output JSON format", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const options = { limit: "50" };

      await handleSpecList(ctx, options);

      const output = consoleLogSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("should handle empty results", async () => {
      // Create a fresh database with no specs
      const emptyDb = initDatabase({ path: ":memory:" });
      const ctx = { db: emptyDb, outputDir: tempDir, jsonOutput: false };
      const options = { limit: "50" };

      await handleSpecList(ctx, options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("No specs found")
      );
    });
  });

  describe("handleSpecShow", () => {
    beforeEach(async () => {
      // Create a test spec directly in database
      const { createSpec } = await import("../../../src/operations/specs.js");
      const { setTags } = await import("../../../src/operations/tags.js");

      createSpec(db, {
        id: "spec-001",
        title: "Show Test Spec",
        file_path: path.join(tempDir, "specs", "show.md"),
        content: "Test description",
        priority: 2,
      });

      setTags(db, "spec-001", "spec", ["tag1", "tag2"]);

      consoleLogSpy.mockClear();
    });

    it("should show spec details", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSpecShow(ctx, "spec-001");

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("spec-001");
      expect(output).toContain("Show Test Spec");
    });

    it("should output JSON format", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleSpecShow(ctx, "spec-001");

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("spec-001");
      expect(parsed.title).toBe("Show Test Spec");
    });

    it("should handle non-existent spec", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSpecShow(ctx, "non-existent");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Spec not found")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("handleSpecUpdate", () => {
    beforeEach(async () => {
      // Create test spec directly in database with markdown file
      const { createSpec } = await import("../../../src/operations/specs.js");
      const { setTags } = await import("../../../src/operations/tags.js");
      const { writeMarkdownFile } = await import("../../../src/markdown.js");

      createSpec(db, {
        id: "spec-update-1",
        title: "Update Test Spec",
        file_path: "specs/update_test.md",
        content: "Original description",
        priority: 2,
      });

      // Create markdown file
      const markdownPath = path.join(tempDir, "specs", "update_test.md");
      writeMarkdownFile(
        markdownPath,
        {
          id: "spec-update-1",
          title: "Update Test Spec",
          priority: 2,
        },
        "Original design notes"
      );

      setTags(db, "spec-update-1", "spec", ["tag1", "tag2"]);

      consoleLogSpy.mockClear();
    });

    it("should update spec title", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        title: "Updated Title",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "spec-update-1");
      expect(spec?.title).toBe("Updated Title");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Updated spec"),
        expect.anything()
      );
    });

    it("should update spec priority", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        priority: "0",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "spec-update-1");
      expect(spec?.priority).toBe(0);
    });

    it("should update spec description", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        description: "Updated description",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "spec-update-1");
      expect(spec?.content).toBe("Updated description");
      const markdownPath = path.join(tempDir, "specs", "update_test.md");
      const content = fs.readFileSync(markdownPath, "utf8");
      expect(content).toContain("Updated description");
    });

    it("should update spec tags", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        tags: "newtag1,newtag2,newtag3",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      const { getTags } = await import("../../../src/operations/tags.js");
      const tags = getTags(db, "spec-update-1", "spec");
      expect(tags).toEqual(["newtag1", "newtag2", "newtag3"]);
    });

    it("should update spec parent", async () => {
      const { createSpec } = await import("../../../src/operations/specs.js");

      // Create parent spec
      createSpec(db, {
        id: "spec-parent",
        title: "Parent Spec",
        file_path: "specs/parent.md",
        content: "",
        priority: 1,
      });

      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        parent: "spec-parent",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "spec-update-1");
      expect(spec?.parent_id).toBe("spec-parent");
    });

    it("should update multiple fields at once", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        title: "Multi Update Test",
        priority: "1",
        description: "Multi update description",
        tags: "multi,update,tags",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      const { getSpec } = await import("../../../src/operations/specs.js");
      const { getTags } = await import("../../../src/operations/tags.js");

      const spec = getSpec(db, "spec-update-1");
      expect(spec?.title).toBe("Multi Update Test");
      expect(spec?.priority).toBe(1);
      expect(spec?.content).toBe("Multi update description");

      const tags = getTags(db, "spec-update-1", "spec");
      expect(tags.sort()).toEqual(["multi", "tags", "update"]);
    });

    it("should handle non-existent spec", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        title: "New Title",
      };

      await handleSpecUpdate(ctx, "non-existent", options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Spec not found")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should output JSON format", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const options = {
        title: "JSON Update Test",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("spec-update-1");
      expect(parsed.title).toBe("JSON Update Test");
    });

    it("should preserve existing markdown content when updating frontmatter only", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        title: "Only Title Update",
      };

      await handleSpecUpdate(ctx, "spec-update-1", options);

      // Read the markdown file to verify original design notes preserved
      const markdownPath = path.join(tempDir, "specs", "update_test.md");
      const content = fs.readFileSync(markdownPath, "utf8");
      expect(content).toContain("Original design notes");
    });
  });

  describe("handleSpecDelete", () => {
    beforeEach(async () => {
      // Create test specs directly in database with markdown files
      const { createSpec } = await import("../../../src/operations/specs.js");
      const { writeMarkdownFile } = await import("../../../src/markdown.js");

      // Create spec for delete test 1
      createSpec(db, {
        id: "spec-delete-1",
        title: "Delete Test 1",
        file_path: "specs/delete_test_1.md",
        content: "Test content",
        priority: 2,
      });

      // Create markdown file for delete test 1
      const deleteTest1Path = path.join(tempDir, "specs", "delete_test_1.md");
      writeMarkdownFile(
        deleteTest1Path,
        {
          id: "spec-delete-1",
          title: "Delete Test 1",
          priority: 2,
        },
        "Test content"
      );

      // Create spec for delete test 2
      createSpec(db, {
        id: "spec-delete-2",
        title: "Delete Test 2",
        file_path: "specs/delete_test_2.md",
        content: "Test content",
        priority: 2,
      });

      // Create markdown file for delete test 2
      const deleteTest2Path = path.join(tempDir, "specs", "delete_test_2.md");
      writeMarkdownFile(
        deleteTest2Path,
        {
          id: "spec-delete-2",
          title: "Delete Test 2",
          priority: 2,
        },
        "Test content"
      );

      consoleLogSpy.mockClear();
    });

    it("should delete spec and remove markdown file", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const markdownPath = path.join(tempDir, "specs", "delete_test_1.md");

      // Verify markdown file exists before deletion
      expect(fs.existsSync(markdownPath)).toBe(true);

      await handleSpecDelete(ctx, ["spec-delete-1"], {});

      // Verify spec is removed from database
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "spec-delete-1");
      expect(spec).toBeNull();

      // Verify markdown file was removed
      expect(fs.existsSync(markdownPath)).toBe(false);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Deleted spec"),
        expect.anything()
      );
    });

    it("should handle multiple spec deletions", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const deleteTest1Path = path.join(tempDir, "specs", "delete_test_1.md");
      const deleteTest2Path = path.join(tempDir, "specs", "delete_test_2.md");

      // Verify both markdown files exist
      expect(fs.existsSync(deleteTest1Path)).toBe(true);
      expect(fs.existsSync(deleteTest2Path)).toBe(true);

      await handleSpecDelete(ctx, ["spec-delete-1", "spec-delete-2"], {});

      // Verify both markdown files were removed
      expect(fs.existsSync(deleteTest1Path)).toBe(false);
      expect(fs.existsSync(deleteTest2Path)).toBe(false);

      // Verify both specs were deleted from database
      const { getSpec } = await import("../../../src/operations/specs.js");
      expect(getSpec(db, "spec-delete-1")).toBeNull();
      expect(getSpec(db, "spec-delete-2")).toBeNull();
    });

    it("should handle non-existent spec", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleSpecDelete(ctx, ["non-existent"], {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Spec not found"),
        expect.anything()
      );
    });

    it("should handle missing markdown file gracefully", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const markdownPath = path.join(tempDir, "specs", "delete_test_1.md");

      // Remove the markdown file before deletion
      fs.unlinkSync(markdownPath);
      expect(fs.existsSync(markdownPath)).toBe(false);

      // Should not throw error even if markdown file is missing
      await handleSpecDelete(ctx, ["spec-delete-1"], {});

      // Verify spec is removed from database
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "spec-delete-1");
      expect(spec).toBeNull();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Deleted spec"),
        expect.anything()
      );
    });

    it("should output JSON format for deletions", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleSpecDelete(ctx, ["spec-delete-1"], {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeInstanceOf(Array);
      expect(parsed[0].id).toBe("spec-delete-1");
      expect(parsed[0].success).toBe(true);
    });
  });
});
