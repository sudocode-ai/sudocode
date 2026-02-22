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
import { generateUniqueFilename } from "../../../src/filename-generator.js";

describe("Relationship CLI Commands", () => {
  let db: Database.Database;
  let tempDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let createdSpecIds: string[] = [];
  let createdIssueIds: string[] = [];

  beforeEach(async () => {
    db = initDatabase({ path: ":memory:" });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));
    createdSpecIds = [];
    createdIssueIds = [];

    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "s",
        issue: "i",
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

  // Helper to extract spec ID from console output
  const extractSpecId = (spy: any): string => {
    const output = spy.mock.calls.flat().join(" ");
    const match = output.match(/\bs-[0-9a-z]{4,8}\b/);
    if (!match) {
      throw new Error(`Could not find spec ID in output: ${output}`);
    }
    return match[0];
  };

  // Helper to extract issue ID from console output
  const extractIssueId = (spy: any): string => {
    const output = spy.mock.calls.flat().join(" ");
    const match = output.match(/\bi-[0-9a-z]{4,8}\b/);
    if (!match) {
      throw new Error(`Could not find issue ID in output: ${output}`);
    }
    return match[0];
  };

  describe("handleLink", () => {
    beforeEach(async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Create test specs
      await handleSpecCreate(ctx, "Test Spec 1", {
        priority: "2",
        filePath: "specs/test-spec-1.md",
      });
      const specId1 = extractSpecId(consoleLogSpy);
      createdSpecIds.push(specId1);

      consoleLogSpy.mockClear();
      await handleSpecCreate(ctx, "Test Spec 2", {
        priority: "2",
        filePath: "specs/test-spec-2.md",
      });
      const specId2 = extractSpecId(consoleLogSpy);
      createdSpecIds.push(specId2);

      // Create test issues
      consoleLogSpy.mockClear();
      await handleIssueCreate(ctx, "Test Issue 1", { priority: "2" });
      const issueId1 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId1);

      consoleLogSpy.mockClear();
      await handleIssueCreate(ctx, "Test Issue 2", { priority: "2" });
      const issueId2 = extractIssueId(consoleLogSpy);
      createdIssueIds.push(issueId2);

      consoleLogSpy.mockClear();
      processExitSpy.mockClear();
    });

    it("should create relationship between two specs", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];
      const spec2Id = createdSpecIds[1];

      await handleLink(ctx, spec1Id, spec2Id, { type: "references" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(spec1Id),
        expect.anything(),
        expect.anything(),
        expect.stringContaining(spec2Id)
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, spec1Id, "spec");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: spec1Id,
        to_id: spec2Id,
        relationship_type: "references",
      });
    });

    it("should create relationship between two issues", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issue1Id = createdIssueIds[0];
      const issue2Id = createdIssueIds[1];

      await handleLink(ctx, issue1Id, issue2Id, { type: "blocks" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, issue1Id, "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: issue1Id,
        to_id: issue2Id,
        relationship_type: "blocks",
      });
    });

    it("should create relationship from issue to spec", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issue1Id = createdIssueIds[0];
      const spec1Id = createdSpecIds[0];

      await handleLink(ctx, issue1Id, spec1Id, { type: "implements" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, issue1Id, "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: issue1Id,
        to_id: spec1Id,
        relationship_type: "implements",
      });
    });

    it("should create relationship from spec to issue", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];
      const issue1Id = createdIssueIds[0];

      await handleLink(ctx, spec1Id, issue1Id, { type: "depends-on" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("✓ Created relationship")
      );

      // Verify relationship in database
      const relationships = getOutgoingRelationships(db, spec1Id, "spec");
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        from_id: spec1Id,
        to_id: issue1Id,
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
      const additionalIssueIds: string[] = [];
      for (let i = 3; i <= 8; i++) {
        await handleIssueCreate(ctx, `Test Issue ${i}`, { priority: "2" });
        const issueId = extractIssueId(consoleLogSpy);
        additionalIssueIds.push(issueId);
        consoleLogSpy.mockClear();
      }

      const issue1Id = createdIssueIds[0];

      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        await handleLink(ctx, issue1Id, additionalIssueIds[i], { type });
      }

      // Verify all relationships were created
      const relationships = getOutgoingRelationships(db, issue1Id, "issue");
      expect(relationships).toHaveLength(types.length);

      for (const type of types) {
        expect(relationships.some((r) => r.relationship_type === type)).toBe(
          true
        );
      }
    });

    it("should handle non-existent from entity", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];

      await handleLink(ctx, "non-existent", spec1Id, { type: "references" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Entity not found: non-existent")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle non-existent to entity", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];

      await handleLink(ctx, spec1Id, "non-existent", { type: "references" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Entity not found: non-existent")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should reject invalid relationship type", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];
      const spec2Id = createdSpecIds[1];

      await handleLink(ctx, spec1Id, spec2Id, { type: "invalid-type" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Invalid relationship type: invalid-type")
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Valid types:")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);

      // Verify no relationship was created
      const relationships = getOutgoingRelationships(db, spec1Id, "spec");
      expect(relationships).toHaveLength(0);
    });

    it("should reject empty relationship type", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];
      const spec2Id = createdSpecIds[1];

      await handleLink(ctx, spec1Id, spec2Id, { type: "" });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("✗ Invalid relationship type:")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);

      // Verify no relationship was created
      const relationships = getOutgoingRelationships(db, spec1Id, "spec");
      expect(relationships).toHaveLength(0);
    });

    it("should output JSON when jsonOutput is true", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const spec1Id = createdSpecIds[0];
      const spec2Id = createdSpecIds[1];

      await handleLink(ctx, spec1Id, spec2Id, { type: "references" });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        from: spec1Id,
        to: spec2Id,
        type: "references",
        success: true,
      });
    });

    it("should sync relationship to markdown for spec entities", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];
      const spec2Id = createdSpecIds[1];

      await handleLink(ctx, spec1Id, spec2Id, { type: "references" });

      // Verify markdown file was created/updated with relationship
      const specPath = path.join(tempDir, "specs", "test-spec-1.md");
      expect(fs.existsSync(specPath)).toBe(true);

      const content = fs.readFileSync(specPath, "utf-8");
      // Should contain frontmatter with relationships
      expect(content).toContain("---");
      expect(content).toContain("relationships:");
      expect(content).toContain("relationship_type: references");
      expect(content).toContain(`to_id: ${spec2Id}`);
    });

    it("should sync relationship to markdown for issue entities", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const issue1Id = createdIssueIds[0];
      const issue2Id = createdIssueIds[1];

      await handleLink(ctx, issue1Id, issue2Id, { type: "blocks" });

      // Verify markdown file was created/updated with relationship
      const issuePath = path.join(tempDir, "issues", generateUniqueFilename("Test Issue 1", issue1Id));
      expect(fs.existsSync(issuePath)).toBe(true);

      const content = fs.readFileSync(issuePath, "utf-8");
      // Should contain frontmatter with relationships
      expect(content).toContain("---");
      expect(content).toContain("relationships:");
      expect(content).toContain("relationship_type: blocks");
      expect(content).toContain(`to_id: ${issue2Id}`);
    });

    it("should create multiple relationships from same entity", async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const spec1Id = createdSpecIds[0];
      const spec2Id = createdSpecIds[1];
      const issue1Id = createdIssueIds[0];
      const issue2Id = createdIssueIds[1];

      await handleLink(ctx, spec1Id, spec2Id, { type: "references" });
      await handleLink(ctx, spec1Id, issue1Id, { type: "depends-on" });
      await handleLink(ctx, spec1Id, issue2Id, { type: "related" });

      // Verify all relationships exist
      const relationships = getOutgoingRelationships(db, spec1Id, "spec");
      expect(relationships).toHaveLength(3);
    });
  });
});
