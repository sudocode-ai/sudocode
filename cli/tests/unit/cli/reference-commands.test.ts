/**
 * Unit tests for reference CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import { handleAddReference } from "../../../src/cli/reference-commands.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Reference CLI Commands", () => {
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

    // Create config.json
    const config = {};
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

  describe("handleAddReference", () => {
    beforeEach(async () => {
      // Create test spec and issue
      const { createSpec } = await import("../../../src/operations/specs.js");
      const { createIssue } = await import("../../../src/operations/issues.js");
      const { writeMarkdownFile } = await import("../../../src/markdown.js");

      // Create spec
      createSpec(db, {
        id: "SPEC-001",
        title: "Test Spec",
        file_path: "specs/test-spec.md",
        content: `# Test Spec

## Requirements

This is a requirement line.
Another requirement here.

## Design

Design content goes here.`,
        priority: 2,
      });

      // Create markdown file for spec
      const specPath = path.join(tempDir, "specs", "test-spec.md");
      writeMarkdownFile(
        specPath,
        {
          id: "SPEC-001",
          title: "Test Spec",
          priority: 2,
        },
        `# Test Spec

## Requirements

This is a requirement line.
Another requirement here.

## Design

Design content goes here.`
      );

      // Create issue
      createIssue(db, {
        id: "ISSUE-001",
        title: "Test Issue",
        content: `# Test Issue

## Description

This is the issue description.

## Tasks

Task content here.`,
        priority: 2,
        status: "open",
      });

      // Create markdown file for issue
      const issuePath = path.join(tempDir, "issues", "ISSUE-001.md");
      writeMarkdownFile(
        issuePath,
        {
          id: "ISSUE-001",
          title: "Test Issue",
          status: "open",
          priority: 2,
        },
        `# Test Issue

## Description

This is the issue description.

## Tasks

Task content here.`
      );

      consoleLogSpy.mockClear();
    });

    it("should add reference to spec using line number (inline)", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "5",
        format: "inline",
        position: "after",
      });

      // Read the updated file
      const filePath = path.join(tempDir, "specs", "test-spec.md");
      const content = fs.readFileSync(filePath, "utf8");

      expect(content).toContain("This is a requirement line. [[ISSUE-001]]");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Added reference to"),
        expect.anything()
      );
    });

    it("should add reference to spec using text search", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        text: "Requirements",
        format: "inline",
        position: "after",
      });

      const filePath = path.join(tempDir, "specs", "test-spec.md");
      const content = fs.readFileSync(filePath, "utf8");

      expect(content).toContain("Requirements [[ISSUE-001]]");
    });

    it("should add reference with display text", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "5",
        display: "OAuth Implementation",
        format: "inline",
      });

      const filePath = path.join(tempDir, "specs", "test-spec.md");
      const content = fs.readFileSync(filePath, "utf8");

      expect(content).toContain("[[ISSUE-001|OAuth Implementation]]");
    });

    it("should add reference with relationship type", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "5",
        type: "implements",
        format: "inline",
      });

      const filePath = path.join(tempDir, "specs", "test-spec.md");
      const content = fs.readFileSync(filePath, "utf8");

      expect(content).toContain("[[ISSUE-001]]{ implements }");
    });

    it("should add reference with newline format", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "5",
        format: "newline",
        position: "after",
      });

      const filePath = path.join(tempDir, "specs", "test-spec.md");
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      // Find the line with "This is a requirement line."
      const reqLineIndex = lines.findIndex((l) =>
        l.includes("This is a requirement line.")
      );
      expect(lines[reqLineIndex + 1]).toBe("[[ISSUE-001]]");
    });

    it("should add reference to issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "ISSUE-001", "SPEC-001", {
        text: "Description",
        format: "inline",
        position: "after",
      });

      const filePath = path.join(tempDir, "issues", "ISSUE-001.md");
      const content = fs.readFileSync(filePath, "utf8");

      expect(content).toContain("Description [[SPEC-001]]");
    });

    it("should handle entity not found", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "NONEXISTENT-001", "ISSUE-001", {
        line: "5",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Entity not found")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle missing line and text options", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Either --line or --text must be specified")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle both line and text specified", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "5",
        text: "test",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Cannot specify both --line and --text")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle invalid line number", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "999",
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle text not found", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        text: "NonExistentText",
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should output JSON format", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "5",
      });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.entity_id).toBe("SPEC-001");
      expect(parsed.reference_id).toBe("ISSUE-001");
      expect(parsed.success).toBe(true);
    });

    it("should update database content", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleAddReference(ctx, "SPEC-001", "ISSUE-001", {
        line: "5",
        format: "inline",
      });

      // Check that database was updated
      const { getSpec } = await import("../../../src/operations/specs.js");
      const spec = getSpec(db, "SPEC-001");
      expect(spec?.content).toContain("[[ISSUE-001]]");
    });
  });
});
