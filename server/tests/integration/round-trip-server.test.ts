/**
 * Server-Side Round-Trip Integration Tests
 *
 * These tests verify data consistency through the full server flow:
 * - API calls (create/update specs and issues)
 * - Export to JSONL (triggered by API)
 * - Watcher detection of JSONL changes
 * - Import from JSONL (simulating watcher behavior)
 * - Relationship preservation across all operations
 *
 * This tests the actual server code paths that execute when users
 * interact with the frontend UI.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type Database from "better-sqlite3";

// Server components
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { createRelationshipsRouter } from "../../src/routes/relationships.js";
import { cleanupExport, triggerExport } from "../../src/services/export.js";
import { ProjectManager } from "../../src/services/project-manager.js";
import { ProjectRegistry } from "../../src/services/project-registry.js";
import { requireProject } from "../../src/middleware/project-context.js";

// CLI components for verification
import { importFromJSONL } from "@sudocode-ai/cli/dist/import.js";
import { exportToJSONL } from "@sudocode-ai/cli/dist/export.js";
import { syncMarkdownToJSONL } from "@sudocode-ai/cli/dist/sync.js";
import { writeMarkdownFile } from "@sudocode-ai/cli/dist/markdown.js";
import {
  getOutgoingRelationships,
  getIncomingRelationships,
  addRelationship,
} from "@sudocode-ai/cli/dist/operations/relationships.js";
import { getSpec, listSpecs } from "@sudocode-ai/cli/dist/operations/specs.js";
import { getIssue, listIssues } from "@sudocode-ai/cli/dist/operations/issues.js";
import { getTags } from "@sudocode-ai/cli/dist/operations/tags.js";

// Helper to wait for debounced export (2 seconds + buffer)
const waitForExport = () => new Promise((resolve) => setTimeout(resolve, 2500));

// Short wait for immediate operations
const shortWait = () => new Promise((resolve) => setTimeout(resolve, 100));

// Helper to read and parse JSONL file
function readJSONL(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

describe("Server Round-Trip Integration Tests", () => {
  let app: express.Application;
  let testDir: string;
  let testProjectPath: string;
  let sudocodeDir: string;
  let issuesJsonlPath: string;
  let specsJsonlPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let db: Database.Database;

  beforeAll(async () => {
    // Create a unique temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-roundtrip-server-"));

    // Create test project directory structure
    testProjectPath = path.join(testDir, "test-project");
    sudocodeDir = path.join(testProjectPath, ".sudocode");
    fs.mkdirSync(sudocodeDir, { recursive: true });

    issuesJsonlPath = path.join(sudocodeDir, "issues.jsonl");
    specsJsonlPath = path.join(sudocodeDir, "specs.jsonl");

    // Create config.json for ID generation
    const configPath = path.join(sudocodeDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "TEST-S",
        issue: "TEST-I",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create directories for markdown files
    fs.mkdirSync(path.join(sudocodeDir, "issues"), { recursive: true });
    fs.mkdirSync(path.join(sudocodeDir, "specs"), { recursive: true });

    // Create database file placeholder
    fs.writeFileSync(path.join(sudocodeDir, "cache.db"), "");

    // Set up project manager (without file watcher for controlled testing)
    const registryPath = path.join(testDir, "projects.json");
    projectRegistry = new ProjectRegistry(registryPath);
    await projectRegistry.load();

    projectManager = new ProjectManager(projectRegistry, { watchEnabled: false });

    // Open the test project
    const result = await projectManager.openProject(testProjectPath);
    if (result.ok) {
      projectId = result.value.id;
      db = result.value.db;
    } else {
      throw new Error("Failed to open test project");
    }

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api/issues", requireProject(projectManager), createIssuesRouter());
    app.use("/api/specs", requireProject(projectManager), createSpecsRouter());
    app.use("/api/relationships", requireProject(projectManager), createRelationshipsRouter());
  });

  afterAll(async () => {
    // Cleanup
    cleanupExport();
    await projectManager?.shutdown();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("API → Export → JSONL Consistency", () => {
    it("should create spec via API and export to JSONL correctly", async () => {
      // Step 1: Create spec via API
      const createResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "API Created Spec",
          content: "Content created through API",
          priority: 1,
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.success).toBe(true);
      const specId = createResponse.body.data.id;

      // Step 2: Wait for debounced export
      await waitForExport();

      // Step 3: Verify JSONL content
      const specsJsonl = readJSONL(specsJsonlPath);
      const jsonlSpec = specsJsonl.find((s) => s.id === specId);

      expect(jsonlSpec).toBeTruthy();
      expect(jsonlSpec.title).toBe("API Created Spec");
      expect(jsonlSpec.content).toBe("Content created through API");
      expect(jsonlSpec.priority).toBe(1);

      // Step 4: Verify DB matches JSONL
      const dbSpec = getSpec(db, specId);
      expect(dbSpec).toBeTruthy();
      expect(dbSpec!.title).toBe(jsonlSpec.title);
      expect(dbSpec!.content).toBe(jsonlSpec.content);
    });

    it("should create issue via API and export to JSONL correctly", async () => {
      // Create issue via API
      const createResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "API Created Issue",
          content: "Issue content from API",
          status: "open",
          priority: 2,
        });

      expect(createResponse.status).toBe(201);
      const issueId = createResponse.body.data.id;

      // Wait for export
      await waitForExport();

      // Verify JSONL
      const issuesJsonl = readJSONL(issuesJsonlPath);
      const jsonlIssue = issuesJsonl.find((i) => i.id === issueId);

      expect(jsonlIssue).toBeTruthy();
      expect(jsonlIssue.title).toBe("API Created Issue");
      expect(jsonlIssue.status).toBe("open");

      // Verify DB
      const dbIssue = getIssue(db, issueId);
      expect(dbIssue).toBeTruthy();
      expect(dbIssue!.title).toBe(jsonlIssue.title);
    });

    it("should update spec via API and export updates to JSONL", async () => {
      // Create spec
      const createResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Spec To Update",
          content: "Original content",
          priority: 2,
        });

      const specId = createResponse.body.data.id;
      await waitForExport();

      // Update spec via API
      const updateResponse = await request(app)
        .put(`/api/specs/${specId}`)
        .set("X-Project-ID", projectId)
        .send({
          title: "Updated Spec Title",
          content: "Updated content via API",
          priority: 0,
        });

      expect(updateResponse.status).toBe(200);
      await waitForExport();

      // Verify JSONL reflects update
      const specsJsonl = readJSONL(specsJsonlPath);
      const jsonlSpec = specsJsonl.find((s) => s.id === specId);

      expect(jsonlSpec.title).toBe("Updated Spec Title");
      expect(jsonlSpec.content).toBe("Updated content via API");
      expect(jsonlSpec.priority).toBe(0);
    });
  });

  describe("Relationship Preservation Through Server Flow", () => {
    it("should preserve implements relationship when spec is updated via API", async () => {
      // Step 1: Create spec via API
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Spec With Relationship",
          content: "Spec content",
          priority: 2,
        });

      const specId = specResponse.body.data.id;

      // Step 2: Create issue via API
      const issueResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Issue Implementing Spec",
          content: "Issue content",
          status: "open",
          priority: 2,
        });

      const issueId = issueResponse.body.data.id;

      // Step 3: Create relationship via API
      const relResponse = await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        });

      expect(relResponse.status).toBe(201);

      // Step 4: Wait for export
      await waitForExport();

      // Verify relationship in JSONL
      let issuesJsonl = readJSONL(issuesJsonlPath);
      let jsonlIssue = issuesJsonl.find((i) => i.id === issueId);
      expect(jsonlIssue.relationships).toHaveLength(1);
      expect(jsonlIssue.relationships[0].type).toBe("implements");
      expect(jsonlIssue.relationships[0].to).toBe(specId);

      // Step 5: Update spec via API (simulating user editing spec content)
      const updateResponse = await request(app)
        .put(`/api/specs/${specId}`)
        .set("X-Project-ID", projectId)
        .send({
          title: "Updated Spec Title",
          content: "This spec content was updated - relationship should be preserved",
        });

      expect(updateResponse.status).toBe(200);

      // Step 6: Wait for export
      await waitForExport();

      // Step 7: Simulate watcher import (this is what the watcher does when it detects JSONL changes)
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId], // Force update the spec (as watcher would do)
      });

      // Step 8: Verify relationship is STILL preserved in DB
      const issueOutgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(issueOutgoing).toHaveLength(1);
      expect(issueOutgoing[0].relationship_type).toBe("implements");
      expect(issueOutgoing[0].to_id).toBe(specId);

      // Step 9: Verify spec was actually updated
      const dbSpec = getSpec(db, specId);
      expect(dbSpec!.title).toBe("Updated Spec Title");

      // Step 10: Export again and verify JSONL still has relationship
      await exportToJSONL(db, { outputDir: sudocodeDir });
      issuesJsonl = readJSONL(issuesJsonlPath);
      jsonlIssue = issuesJsonl.find((i) => i.id === issueId);
      expect(jsonlIssue.relationships).toHaveLength(1);
    });

    it("should preserve multiple relationships when issue is updated via API", async () => {
      // Create two specs
      const spec1Response = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({ title: "Multi Spec 1", content: "Spec 1", priority: 2 });

      const spec2Response = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({ title: "Multi Spec 2", content: "Spec 2", priority: 2 });

      const spec1Id = spec1Response.body.data.id;
      const spec2Id = spec2Response.body.data.id;

      // Create issue
      const issueResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Issue With Multiple Relationships",
          content: "Implements two specs",
          status: "open",
          priority: 2,
        });

      const issueId = issueResponse.body.data.id;

      // Create relationships
      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: spec1Id,
          to_type: "spec",
          relationship_type: "implements",
        });

      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: spec2Id,
          to_type: "spec",
          relationship_type: "implements",
        });

      await waitForExport();

      // Update issue via API
      await request(app)
        .put(`/api/issues/${issueId}`)
        .set("X-Project-ID", projectId)
        .send({
          title: "Updated Issue Title",
          status: "in_progress",
        });

      await waitForExport();

      // Simulate watcher import for issue
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [issueId],
      });

      // Verify both relationships preserved
      const issueOutgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(issueOutgoing).toHaveLength(2);

      const implementsRels = issueOutgoing.filter((r) => r.relationship_type === "implements");
      const targetIds = implementsRels.map((r) => r.to_id).sort();
      expect(targetIds).toContain(spec1Id);
      expect(targetIds).toContain(spec2Id);

      // Verify issue was updated
      const dbIssue = getIssue(db, issueId);
      expect(dbIssue!.title).toBe("Updated Issue Title");
      expect(dbIssue!.status).toBe("in_progress");
    });

    it("should preserve bidirectional issue relationships (blocks/depends-on)", async () => {
      // Create blocker issue
      const blockerResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Blocker Issue",
          content: "This blocks another issue",
          status: "open",
          priority: 1,
        });

      // Create blocked issue
      const blockedResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Blocked Issue",
          content: "This is blocked",
          status: "open",
          priority: 2,
        });

      const blockerId = blockerResponse.body.data.id;
      const blockedId = blockedResponse.body.data.id;

      // Create "blocks" relationship
      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: blockerId,
          from_type: "issue",
          to_id: blockedId,
          to_type: "issue",
          relationship_type: "blocks",
        });

      await waitForExport();

      // Update the blocked issue
      await request(app)
        .put(`/api/issues/${blockedId}`)
        .set("X-Project-ID", projectId)
        .send({
          content: "Updated blocked issue content",
        });

      await waitForExport();

      // Simulate watcher import
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [blockedId],
      });

      // Verify relationship preserved
      const blockerOutgoing = getOutgoingRelationships(db, blockerId, "issue");
      expect(blockerOutgoing).toHaveLength(1);
      expect(blockerOutgoing[0].relationship_type).toBe("blocks");
      expect(blockerOutgoing[0].to_id).toBe(blockedId);
    });
  });

  describe("Full Watcher Simulation Cycle", () => {
    it("should handle spec update → export → watcher import → export cycle", async () => {
      // Create spec with relationship
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Full Cycle Spec",
          content: "Original content",
          priority: 2,
        });

      const specId = specResponse.body.data.id;

      const issueResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Full Cycle Issue",
          content: "Issue content",
          status: "open",
          priority: 2,
        });

      const issueId = issueResponse.body.data.id;

      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        });

      await waitForExport();

      // Verify initial state in JSONL
      let issuesJsonl = readJSONL(issuesJsonlPath);
      let jsonlIssue = issuesJsonl.find((i) => i.id === issueId);
      expect(jsonlIssue.relationships).toHaveLength(1);

      // Cycle 1: Update spec via API
      await request(app)
        .put(`/api/specs/${specId}`)
        .set("X-Project-ID", projectId)
        .send({
          title: "Cycle 1 Update",
          content: "First update",
        });

      await waitForExport();

      // Simulate watcher import for spec
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId],
      });

      // Export again (as watcher might trigger another export)
      await exportToJSONL(db, { outputDir: sudocodeDir });

      // Verify relationship still exists
      issuesJsonl = readJSONL(issuesJsonlPath);
      jsonlIssue = issuesJsonl.find((i) => i.id === issueId);
      expect(jsonlIssue.relationships).toHaveLength(1);

      // Cycle 2: Update spec again
      await request(app)
        .put(`/api/specs/${specId}`)
        .set("X-Project-ID", projectId)
        .send({
          title: "Cycle 2 Update",
          content: "Second update",
        });

      await waitForExport();

      // Simulate watcher import
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId],
      });

      // Final verification
      const finalOutgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(finalOutgoing).toHaveLength(1);
      expect(finalOutgoing[0].relationship_type).toBe("implements");

      const finalSpec = getSpec(db, specId);
      expect(finalSpec!.title).toBe("Cycle 2 Update");
    });

    it("should handle concurrent spec and issue updates without losing relationships", async () => {
      // Create entities with relationship
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Concurrent Spec",
          content: "Spec content",
          priority: 2,
        });

      const issueResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Concurrent Issue",
          content: "Issue content",
          status: "open",
          priority: 2,
        });

      const specId = specResponse.body.data.id;
      const issueId = issueResponse.body.data.id;

      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        });

      await waitForExport();

      // Update both spec and issue (simulating concurrent edits)
      await Promise.all([
        request(app)
          .put(`/api/specs/${specId}`)
          .set("X-Project-ID", projectId)
          .send({ title: "Updated Concurrent Spec" }),
        request(app)
          .put(`/api/issues/${issueId}`)
          .set("X-Project-ID", projectId)
          .send({ title: "Updated Concurrent Issue" }),
      ]);

      await waitForExport();

      // Simulate watcher import for both (as might happen with concurrent changes)
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId, issueId],
      });

      // Verify relationship preserved
      const outgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].to_id).toBe(specId);

      // Verify both updates applied
      const spec = getSpec(db, specId);
      expect(spec!.title).toBe("Updated Concurrent Spec");

      const issue = getIssue(db, issueId);
      expect(issue!.title).toBe("Updated Concurrent Issue");
    });
  });

  describe("Edge Cases", () => {
    it("should handle spec without relationships correctly", async () => {
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Standalone Spec",
          content: "No relationships",
          priority: 2,
        });

      const specId = specResponse.body.data.id;
      await waitForExport();

      // Update spec
      await request(app)
        .put(`/api/specs/${specId}`)
        .set("X-Project-ID", projectId)
        .send({
          title: "Updated Standalone Spec",
        });

      await waitForExport();

      // Simulate watcher import
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId],
      });

      // Verify spec updated correctly
      const spec = getSpec(db, specId);
      expect(spec!.title).toBe("Updated Standalone Spec");

      // Verify no spurious relationships created
      const outgoing = getOutgoingRelationships(db, specId, "spec");
      expect(outgoing).toHaveLength(0);
    });

    it("should preserve archived status through round trip", async () => {
      // Create spec
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Spec To Archive",
          content: "Will be archived",
          priority: 2,
        });

      const specId = specResponse.body.data.id;
      await waitForExport();

      // Archive spec
      await request(app)
        .put(`/api/specs/${specId}`)
        .set("X-Project-ID", projectId)
        .send({
          archived: true,
        });

      await waitForExport();

      // Verify JSONL has archived flag
      const specsJsonl = readJSONL(specsJsonlPath);
      const jsonlSpec = specsJsonl.find((s) => s.id === specId);
      expect(!!jsonlSpec.archived).toBe(true);

      // Simulate watcher import
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId],
      });

      // Verify archived status preserved
      const spec = getSpec(db, specId);
      expect(!!spec!.archived).toBe(true);
    });
  });

  describe("Markdown → Server → JSONL Flow", () => {
    it("should sync new markdown spec to DB and export to JSONL", async () => {
      const specId = "s-md-new-1";
      const mdPath = path.join(sudocodeDir, "specs", `${specId}.md`);

      // Step 1: Create markdown file directly (simulating user editing markdown)
      writeMarkdownFile(
        mdPath,
        {
          id: specId,
          title: "Markdown Created Spec",
          priority: 1,
          tags: ["markdown", "test"],
        },
        "# Markdown Created Spec\n\nThis spec was created by editing markdown directly."
      );

      // Step 2: Sync markdown to DB (simulating watcher detecting the file)
      const syncResult = await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.action).toBe("created");

      // Step 3: Verify spec is in DB
      const dbSpec = getSpec(db, specId);
      expect(dbSpec).toBeTruthy();
      expect(dbSpec!.title).toBe("Markdown Created Spec");
      expect(dbSpec!.priority).toBe(1);

      // Step 4: Verify JSONL was updated
      const specsJsonl = readJSONL(specsJsonlPath);
      const jsonlSpec = specsJsonl.find((s) => s.id === specId);
      expect(jsonlSpec).toBeTruthy();
      expect(jsonlSpec.title).toBe("Markdown Created Spec");
      expect(jsonlSpec.tags).toContain("markdown");
      expect(jsonlSpec.tags).toContain("test");
    });

    it("should sync markdown spec updates to DB and export to JSONL", async () => {
      // Step 1: Create spec via API first
      const createResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Original Spec Title",
          content: "Original content",
          priority: 2,
        });

      const specId = createResponse.body.data.id;
      await waitForExport();

      // Get the file path from the created spec (already absolute)
      const dbSpecBefore = getSpec(db, specId);
      const mdPath = dbSpecBefore!.file_path;

      // Step 2: Update markdown file directly (simulating user editing markdown)
      writeMarkdownFile(
        mdPath,
        {
          id: specId,
          title: "Updated Via Markdown",
          priority: 0,
          tags: ["updated"],
        },
        "# Updated Via Markdown\n\nThis content was updated by editing the markdown file directly."
      );

      // Step 3: Sync markdown to DB (simulating watcher detecting the change)
      const syncResult = await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.action).toBe("updated");

      // Step 4: Verify DB was updated
      const dbSpec = getSpec(db, specId);
      expect(dbSpec!.title).toBe("Updated Via Markdown");
      expect(dbSpec!.priority).toBe(0);

      // Step 5: Verify JSONL was updated
      const specsJsonl = readJSONL(specsJsonlPath);
      const jsonlSpec = specsJsonl.find((s) => s.id === specId);
      expect(jsonlSpec.title).toBe("Updated Via Markdown");
      expect(jsonlSpec.priority).toBe(0);
    });

    it("should sync new markdown issue to DB and export to JSONL", async () => {
      const issueId = "i-md-new-1";
      const mdPath = path.join(sudocodeDir, "issues", `${issueId}.md`);

      // Create markdown issue file
      writeMarkdownFile(
        mdPath,
        {
          id: issueId,
          title: "Markdown Created Issue",
          status: "open",
          priority: 2,
          tags: ["bug", "markdown"],
        },
        "# Markdown Created Issue\n\nThis issue was created via markdown."
      );

      // Sync markdown to DB
      const syncResult = await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.action).toBe("created");

      // Verify issue in DB
      const dbIssue = getIssue(db, issueId);
      expect(dbIssue).toBeTruthy();
      expect(dbIssue!.title).toBe("Markdown Created Issue");
      expect(dbIssue!.status).toBe("open");

      // Verify JSONL updated
      const issuesJsonl = readJSONL(issuesJsonlPath);
      const jsonlIssue = issuesJsonl.find((i) => i.id === issueId);
      expect(jsonlIssue).toBeTruthy();
      expect(jsonlIssue.title).toBe("Markdown Created Issue");
      expect(jsonlIssue.status).toBe("open");
    });

    it("should preserve relationships when spec is updated via markdown", async () => {
      // Step 1: Create spec and issue via API
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Spec for MD Relationship Test",
          content: "Original content",
          priority: 2,
        });

      const issueResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Issue for MD Relationship Test",
          content: "Issue content",
          status: "open",
          priority: 2,
        });

      const specId = specResponse.body.data.id;
      const issueId = issueResponse.body.data.id;

      // Step 2: Create relationship via API
      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        });

      await waitForExport();

      // Verify relationship exists
      let issueOutgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(issueOutgoing).toHaveLength(1);
      expect(issueOutgoing[0].relationship_type).toBe("implements");

      // Step 3: Update spec via markdown (file_path is already absolute)
      const dbSpecBefore = getSpec(db, specId);
      const mdPath = dbSpecBefore!.file_path;

      writeMarkdownFile(
        mdPath,
        {
          id: specId,
          title: "Updated Spec Via Markdown",
          priority: 1,
        },
        "# Updated Spec Via Markdown\n\nThis update should NOT affect the implements relationship."
      );

      // Step 4: Sync markdown to DB
      const syncResult = await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      expect(syncResult.success).toBe(true);

      // Step 5: Simulate watcher import cycle (as would happen in real server)
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId],
      });

      // Step 6: Verify relationship is STILL preserved
      issueOutgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(issueOutgoing).toHaveLength(1);
      expect(issueOutgoing[0].relationship_type).toBe("implements");
      expect(issueOutgoing[0].to_id).toBe(specId);

      // Verify spec was updated
      const dbSpec = getSpec(db, specId);
      expect(dbSpec!.title).toBe("Updated Spec Via Markdown");
    });

    it("should preserve relationships when issue is updated via markdown", async () => {
      // Create spec and issue
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Target Spec for Issue MD Update",
          content: "Spec content",
          priority: 2,
        });

      const issueResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Issue to Update Via MD",
          content: "Original issue content",
          status: "open",
          priority: 2,
        });

      const specId = specResponse.body.data.id;
      const issueId = issueResponse.body.data.id;

      // Create relationship
      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        });

      await waitForExport();

      // Update issue via markdown
      const mdPath = path.join(sudocodeDir, "issues", `${issueId}.md`);

      writeMarkdownFile(
        mdPath,
        {
          id: issueId,
          title: "Updated Issue Via Markdown",
          status: "in_progress",
          priority: 1,
        },
        "# Updated Issue Via Markdown\n\nThis update should preserve the implements relationship."
      );

      // Sync markdown to DB
      await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      // Simulate watcher import cycle
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [issueId],
      });

      // Verify relationship preserved
      const issueOutgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(issueOutgoing).toHaveLength(1);
      expect(issueOutgoing[0].relationship_type).toBe("implements");

      // Verify issue was updated
      const dbIssue = getIssue(db, issueId);
      expect(dbIssue!.title).toBe("Updated Issue Via Markdown");
      expect(dbIssue!.status).toBe("in_progress");
    });

    it("should handle markdown with cross-references that create relationships", async () => {
      // Create a spec first
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Referenced Spec",
          content: "This spec will be referenced",
          priority: 2,
        });

      const specId = specResponse.body.data.id;
      await waitForExport();

      // Create issue via markdown with a reference to the spec
      const issueId = "i-crossref-1";
      const mdPath = path.join(sudocodeDir, "issues", `${issueId}.md`);

      // Note: Cross-references in content like [[s-xxx]] should create references relationship
      writeMarkdownFile(
        mdPath,
        {
          id: issueId,
          title: "Issue With Cross Reference",
          status: "open",
          priority: 2,
        },
        `# Issue With Cross Reference\n\nThis issue references [[${specId}]] in its content.`
      );

      // Sync markdown to DB
      const syncResult = await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      expect(syncResult.success).toBe(true);

      // Verify issue was created
      const dbIssue = getIssue(db, issueId);
      expect(dbIssue).toBeTruthy();
      expect(dbIssue!.title).toBe("Issue With Cross Reference");

      // Check if relationships were created from cross-references
      const issueOutgoing = getOutgoingRelationships(db, issueId, "issue");
      // Cross-references should create a "references" relationship
      const referencesRel = issueOutgoing.find(
        (r) => r.to_id === specId && r.relationship_type === "references"
      );
      expect(referencesRel).toBeTruthy();
    });

    it("should sync markdown changes back to JSONL correctly after multiple edits", async () => {
      const specId = "s-multi-edit";
      const mdPath = path.join(sudocodeDir, "specs", `${specId}.md`);

      // Edit 1: Create spec
      writeMarkdownFile(
        mdPath,
        { id: specId, title: "Edit 1", priority: 2 },
        "Content version 1"
      );

      await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      let specsJsonl = readJSONL(specsJsonlPath);
      let jsonlSpec = specsJsonl.find((s) => s.id === specId);
      expect(jsonlSpec.title).toBe("Edit 1");

      // Edit 2: Update spec
      writeMarkdownFile(
        mdPath,
        { id: specId, title: "Edit 2", priority: 1 },
        "Content version 2"
      );

      await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      specsJsonl = readJSONL(specsJsonlPath);
      jsonlSpec = specsJsonl.find((s) => s.id === specId);
      expect(jsonlSpec.title).toBe("Edit 2");
      expect(jsonlSpec.priority).toBe(1);

      // Edit 3: Another update
      writeMarkdownFile(
        mdPath,
        { id: specId, title: "Edit 3 - Final", priority: 0, tags: ["final"] },
        "Content version 3 - final"
      );

      await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      specsJsonl = readJSONL(specsJsonlPath);
      jsonlSpec = specsJsonl.find((s) => s.id === specId);
      expect(jsonlSpec.title).toBe("Edit 3 - Final");
      expect(jsonlSpec.priority).toBe(0);
      expect(jsonlSpec.tags).toContain("final");

      // Verify DB is consistent
      const dbSpec = getSpec(db, specId);
      expect(dbSpec!.title).toBe("Edit 3 - Final");
    });

    it("should handle concurrent markdown and API updates correctly", async () => {
      // Create spec via API
      const specResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Concurrent Test Spec",
          content: "Original content",
          priority: 2,
        });

      const specId = specResponse.body.data.id;
      await waitForExport();

      // Create issue with relationship
      const issueResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Concurrent Test Issue",
          content: "Issue content",
          status: "open",
          priority: 2,
        });

      const issueId = issueResponse.body.data.id;

      await request(app)
        .post("/api/relationships")
        .set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        });

      await waitForExport();

      // Update spec via markdown (file_path is already absolute)
      const dbSpecBefore = getSpec(db, specId);
      const mdPath = dbSpecBefore!.file_path;

      writeMarkdownFile(
        mdPath,
        { id: specId, title: "Updated via Markdown", priority: 1 },
        "Content updated via markdown"
      );

      // Sync markdown change
      await syncMarkdownToJSONL(db, mdPath, {
        outputDir: sudocodeDir,
        autoExport: true,
      });

      // Simultaneously update issue via API
      await request(app)
        .put(`/api/issues/${issueId}`)
        .set("X-Project-ID", projectId)
        .send({
          title: "Updated via API",
          status: "in_progress",
        });

      await waitForExport();

      // Simulate watcher import for both
      await importFromJSONL(db, {
        inputDir: sudocodeDir,
        forceUpdateIds: [specId, issueId],
      });

      // Verify both updates applied
      const finalSpec = getSpec(db, specId);
      expect(finalSpec!.title).toBe("Updated via Markdown");

      const finalIssue = getIssue(db, issueId);
      expect(finalIssue!.title).toBe("Updated via API");

      // Verify relationship preserved
      const outgoing = getOutgoingRelationships(db, issueId, "issue");
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].to_id).toBe(specId);
    });
  });
});
