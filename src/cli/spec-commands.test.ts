/**
 * Unit tests for spec CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../db.js";
import {
  handleSpecCreate,
  handleSpecList,
  handleSpecShow,
  handleSpecDelete,
} from "./spec-commands.js";
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudograph-test-"));

    // Create necessary subdirectories
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "issues"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "custom"), { recursive: true });

    // Create empty JSONL files
    fs.writeFileSync(path.join(tempDir, "specs", "specs.jsonl"), "", "utf8");
    fs.writeFileSync(path.join(tempDir, "issues", "issues.jsonl"), "", "utf8");

    // Create meta.json
    const meta = {
      version: "1.0.0",
      next_spec_id: 1,
      next_issue_id: 1,
      id_prefix: {
        spec: "spec",
        issue: "issue",
      },
      last_sync: new Date().toISOString(),
      collision_log: [],
    };
    fs.writeFileSync(
      path.join(tempDir, "meta.json"),
      JSON.stringify(meta, null, 2)
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
      const { generateSpecId } = await import("../id-generator.js");
      const { createSpec } = await import("../operations/specs.js");
      const { getSpec } = await import("../operations/specs.js");

      const specId = generateSpecId(tempDir);
      const spec = createSpec(db, {
        id: specId,
        title: "Test Spec",
        file_path: path.join(tempDir, "specs", "test.md"),
        content: "",
        priority: 2,
        created_by: "test-user",
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
      const { createSpec } = await import("../operations/specs.js");
      const { generateSpecId } = await import("../id-generator.js");

      createSpec(db, {
        id: generateSpecId(tempDir),
        title: "Spec 1",
        file_path: path.join(tempDir, "specs", "spec1.md"),
        content: "",
        priority: 1,
        created_by: "test",
      });

      createSpec(db, {
        id: generateSpecId(tempDir),
        title: "Spec 2",
        file_path: path.join(tempDir, "specs", "spec2.md"),
        content: "",
        priority: 2,
        created_by: "test",
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
      const { createSpec } = await import("../operations/specs.js");
      const { setTags } = await import("../operations/tags.js");

      createSpec(db, {
        id: "spec-001",
        title: "Show Test Spec",
        file_path: path.join(tempDir, "specs", "show.md"),
        content: "Test description",
        priority: 2,
        created_by: "test",
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

  describe("handleSpecDelete", () => {
    beforeEach(async () => {
      // Create test specs directly in database with markdown files
      const { createSpec } = await import("../operations/specs.js");
      const { writeMarkdownFile } = await import("../markdown.js");

      // Create spec for delete test 1
      createSpec(db, {
        id: "spec-delete-1",
        title: "Delete Test 1",
        file_path: "specs/delete_test_1.md",
        content: "Test content",
        priority: 2,
        created_by: "test",
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
        created_by: "test",
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
      const { getSpec } = await import("../operations/specs.js");
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
      const { getSpec } = await import("../operations/specs.js");
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
      const { getSpec } = await import("../operations/specs.js");
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
