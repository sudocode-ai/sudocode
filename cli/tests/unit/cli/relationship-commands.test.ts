/**
 * Unit tests for relationship CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../src/db.js";
import { handleLink } from "../../../src/cli/relationship-commands.js";
import { handleSpecCreate } from "../../../src/cli/spec-commands.js";
import { handleIssueCreate } from "../../../src/cli/issue-commands.js";
import { getOutgoingRelationships } from "../../../src/operations/relationships.js";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Relationship CLI Commands", () => {
  let db: Database.Database;
  let tempDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(async () => {
    db = initDatabase({ path: ":memory:" });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));

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

    // Create specs and issues subdirectories
    fs.mkdirSync(path.join(tempDir, "specs"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "issues"), { recursive: true });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("handleLink", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create test specs
      await handleSpecCreate(ctx, "Test Spec 1", {
        priority: "2",
        filePath: "specs/test-spec-1.md",
      });
      await handleSpecCreate(ctx, "Test Spec 2", {
        priority: "2",
        filePath: "specs/test-spec-2.md",
      });

      // Create test issues
      await handleIssueCreate(ctx, "Test Issue 1", { priority: "2" });
      await handleIssueCreate(ctx, "Test Issue 2", { priority: "2" });

      consoleLogSpy.mockClear();
      processExitSpy.mockClear();
    });

    it("should create relationship between two specs", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "spec-001", "spec-002", { type: "references" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("spec-001"),
        expect.anything(),
        expect.anything(),
        expect.stringContaining("spec-002")
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, "spec-001", "spec");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: "spec-001",
        to_id: "spec-002",
        relationship_type: "references",
      });
    });

    it("should create relationship between two issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "issue-001", "issue-002", { type: "blocks" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, "issue-001", "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: "issue-001",
        to_id: "issue-002",
        relationship_type: "blocks",
      });
    });

    it("should create relationship from issue to spec", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "issue-001", "spec-001", { type: "implements" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, "issue-001", "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: "issue-001",
        to_id: "spec-001",
        relationship_type: "implements",
      });
    });

    it("should create relationship from spec to issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "spec-001", "issue-001", { type: "depends-on" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, "spec-001", "spec");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: "spec-001",
        to_id: "issue-001",
        relationship_type: "depends-on",
      });
    });

    it("should support all relationship types", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const types = [
        "blocks",
        "implements",
        "references",
        "depends-on",
        "discovered-from",
        "related",
      ];

      // Create additional entities for testing
      for (let i = 3; i <= 8; i++) {
        await handleIssueCreate(ctx, `Test Issue ${i}`, { priority: "2" });
      }

      consoleLogSpy.mockClear();

      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        await handleLink(ctx, "issue-001", `issue-00${i + 3}`, { type });
      }

      // Verify all relationships were created
      const relationships = getOutgoingRelationships(db, "issue-001", "issue");
      expect(relationships).toHaveLength(types.length);

      for (const type of types) {
        expect(relationships.some((r) => r.relationship_type === type)).toBe(
          true
        );
      }
    });

    it("should handle non-existent from entity", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "non-existent", "spec-001", { type: "references" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Entity not found: non-existent")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle non-existent to entity", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "spec-001", "non-existent", { type: "references" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Entity not found: non-existent")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleLink(ctx, "spec-001", "spec-002", { type: "references" });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        from: "spec-001",
        to: "spec-002",
        type: "references",
        success: true,
      });
    });

    it("should sync relationship to markdown for spec entities", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "spec-001", "spec-002", { type: "references" });

      // Verify markdown file was created/updated with relationship
      const specPath = path.join(tempDir, "specs", "test-spec-1.md");
      expect(fs.existsSync(specPath)).toBe(true);

      const content = fs.readFileSync(specPath, "utf-8");
      // Should contain frontmatter with relationships
      expect(content).toContain("---");
      expect(content).toContain("relationships:");
      expect(content).toContain("relationship_type: references");
      expect(content).toContain("to_id: spec-002");
    });

    it("should sync relationship to markdown for issue entities", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "issue-001", "issue-002", { type: "blocks" });

      // Verify markdown file was created/updated with relationship
      const issuePath = path.join(tempDir, "issues", "issue-001.md");
      expect(fs.existsSync(issuePath)).toBe(true);

      const content = fs.readFileSync(issuePath, "utf-8");
      // Should contain frontmatter with relationships
      expect(content).toContain("---");
      expect(content).toContain("relationships:");
      expect(content).toContain("relationship_type: blocks");
      expect(content).toContain("to_id: issue-002");
    });

    it("should create multiple relationships from same entity", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleLink(ctx, "spec-001", "spec-002", { type: "references" });
      await handleLink(ctx, "spec-001", "issue-001", { type: "depends-on" });
      await handleLink(ctx, "spec-001", "issue-002", { type: "related" });

      // Verify all relationships exist
      const relationships = getOutgoingRelationships(db, "spec-001", "spec");
      expect(relationships).toHaveLength(3);
    });
  });
});
