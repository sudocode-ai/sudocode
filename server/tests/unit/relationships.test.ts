/**
 * Tests for Relationships API routes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { createRelationshipsRouter } from "../../src/routes/relationships.js";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { cleanupExport } from "../../src/services/export.js";
import { ProjectManager } from "../../src/services/project-manager.js";
import { ProjectRegistry } from "../../src/services/project-registry.js";
import { requireProject } from "../../src/middleware/project-context.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Relationships API", () => {
  let app: express.Application;
  let testDir: string;
  let testProjectPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let testIssueId: string;
  let testSpecId: string;

  beforeAll(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-test-relationships-")
    );

    // Create test project directory structure
    testProjectPath = path.join(testDir, "test-project");
    const sudocodeDir = path.join(testProjectPath, ".sudocode");
    fs.mkdirSync(sudocodeDir, { recursive: true });

    // Create config.json for ID generation
    const configPath = path.join(sudocodeDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create directories for markdown files
    const issuesDir = path.join(sudocodeDir, "issues");
    const specsDir = path.join(sudocodeDir, "specs");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(specsDir, { recursive: true });

    // Create database file
    const dbPath = path.join(sudocodeDir, "cache.db");
    fs.writeFileSync(dbPath, "");

    // Set up project manager
    const registryPath = path.join(testDir, "projects.json");
    projectRegistry = new ProjectRegistry(registryPath);
    await projectRegistry.load();

    projectManager = new ProjectManager(projectRegistry, { watchEnabled: false });

    // Open the test project
    const result = await projectManager.openProject(testProjectPath);
    if (result.ok) {
      projectId = result.value.id;
    } else {
      throw new Error("Failed to open test project");
    }

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api/issues", requireProject(projectManager), createIssuesRouter());
    app.use("/api/specs", requireProject(projectManager), createSpecsRouter());
    app.use("/api/relationships", requireProject(projectManager), createRelationshipsRouter());

    // Create test issue and spec
    const issueResponse = await request(app)
      .post("/api/issues")
      .set("X-Project-ID", projectId)
      .send({ title: "Test Issue", description: "Test", status: "open" });
    testIssueId = issueResponse.body.data.id;

    const specResponse = await request(app)
      .post("/api/specs")
      .set("X-Project-ID", projectId)
      .send({ title: "Test Spec", content: "# Test" });
    testSpecId = specResponse.body.data.id;
  });

  afterAll(async () => {
    // Clean up export debouncer first
    cleanupExport();
    // Shutdown project manager
    await projectManager.shutdown();
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("POST /api/relationships", () => {
    it("should create a new relationship", async () => {
      const relationship = {
        from_id: testIssueId,
        from_type: "issue",
        to_id: testSpecId,
        to_type: "spec",
        relationship_type: "implements",
      };

      const response = await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send(relationship)
        .expect(201)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.from_id).toBe(testIssueId);
      expect(response.body.data.to_id).toBe(testSpecId);
      expect(response.body.data.relationship_type).toBe("implements");
    });

    it("should return existing relationship when adding duplicate (idempotent)", async () => {
      const relationship = {
        from_id: testIssueId,
        from_type: "issue",
        to_id: testSpecId,
        to_type: "spec",
        relationship_type: "implements",
      };

      const response = await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send(relationship)
        .expect(201)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.from_id).toBe(testIssueId);
      expect(response.body.data.to_id).toBe(testSpecId);
      expect(response.body.data.relationship_type).toBe("implements");
    });

    it("should reject relationship without from_id", async () => {
      const response = await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("from_id")).toBeTruthy();
    });

    it("should reject relationship with invalid from_type", async () => {
      const response = await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          from_type: "invalid",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("from_type")).toBeTruthy();
    });

    it("should reject relationship without to_id", async () => {
      const response = await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          from_type: "issue",
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("to_id")).toBeTruthy();
    });

    it("should reject relationship with invalid relationship_type", async () => {
      const response = await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "invalid-type",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(
        response.body.message.includes("Invalid relationship_type")
      ).toBeTruthy();
    });

    it("should reject relationship with non-existent from_id", async () => {
      const response = await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: "ISSUE-99999",
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });
  });

  describe("GET /api/relationships/:entity_type/:entity_id", () => {
    it("should get all relationships for an issue", async () => {
      const response = await request(app)
        .get(`/api/relationships/issue/${testIssueId}`).set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(Array.isArray(response.body.data.outgoing)).toBeTruthy();
      expect(Array.isArray(response.body.data.incoming)).toBeTruthy();
      expect(response.body.data.outgoing.length).toBe(1);
      expect(response.body.data.outgoing[0].to_id).toBe(testSpecId);
    });

    it("should get all relationships for a spec", async () => {
      const response = await request(app)
        .get(`/api/relationships/spec/${testSpecId}`).set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(Array.isArray(response.body.data.outgoing)).toBeTruthy();
      expect(Array.isArray(response.body.data.incoming)).toBeTruthy();
      expect(response.body.data.incoming.length).toBe(1);
      expect(response.body.data.incoming[0].from_id).toBe(testIssueId);
    });

    it("should return empty arrays for entity with no relationships", async () => {
      // Create another issue with no relationships
      const issueResponse = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
        .send({ title: "Isolated Issue", status: "open" });

      const response = await request(app)
        .get(`/api/relationships/issue/${issueResponse.body.data.id}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.outgoing.length).toBe(0);
      expect(response.body.data.incoming.length).toBe(0);
    });

    it("should reject invalid entity_type", async () => {
      const response = await request(app)
        .get(`/api/relationships/invalid/${testIssueId}`).set("X-Project-ID", projectId)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(
        response.body.message.includes("Invalid entity_type")
      ).toBeTruthy();
    });
  });

  describe("GET /api/relationships/:entity_type/:entity_id/outgoing", () => {
    it("should get outgoing relationships for an entity", async () => {
      const response = await request(app)
        .get(`/api/relationships/issue/${testIssueId}/outgoing`).set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].from_id).toBe(testIssueId);
      expect(response.body.data[0].to_id).toBe(testSpecId);
    });

    it("should filter by relationship_type", async () => {
      const response = await request(app)
        .get(
          `/api/relationships/issue/${testIssueId}/outgoing?relationship_type=implements`
        )
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      response.body.data.forEach((rel: any) => {
        expect(rel.relationship_type).toBe("implements");
      });
    });

    it("should return empty array when filtering for non-existent type", async () => {
      const response = await request(app)
        .get(
          `/api/relationships/issue/${testIssueId}/outgoing?relationship_type=blocks`
        )
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(0);
    });
  });

  describe("GET /api/relationships/:entity_type/:entity_id/incoming", () => {
    it("should get incoming relationships for an entity", async () => {
      const response = await request(app)
        .get(`/api/relationships/spec/${testSpecId}/incoming`).set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].from_id).toBe(testIssueId);
      expect(response.body.data[0].to_id).toBe(testSpecId);
    });

    it("should filter by relationship_type", async () => {
      const response = await request(app)
        .get(
          `/api/relationships/spec/${testSpecId}/incoming?relationship_type=implements`
        )
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      response.body.data.forEach((rel: any) => {
        expect(rel.relationship_type).toBe("implements");
      });
    });
  });

  describe("DELETE /api/relationships", () => {
    it("should delete a relationship", async () => {
      const relationship = {
        from_id: testIssueId,
        from_type: "issue",
        to_id: testSpecId,
        to_type: "spec",
        relationship_type: "implements",
      };

      const response = await request(app)
        .delete("/api/relationships").set("X-Project-ID", projectId)
        .send(relationship)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
      expect(response.body.data.from_id).toBe(testIssueId);
      expect(response.body.data.to_id).toBe(testSpecId);
    });

    it("should trigger JSONL export after deleting relationship", async () => {
      // Create a new issue and spec for this test
      const issueResponse = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
        .send({
          title: "Delete Export Test Issue",
          description: "Test",
          status: "open",
        });
      const issueId = issueResponse.body.data.id;

      const specResponse = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send({ title: "Delete Export Test Spec", content: "# Test" });
      const specId = specResponse.body.data.id;

      // Create relationship
      await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(201);

      // Wait for initial export
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Delete the relationship
      await request(app)
        .delete("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(200);

      // Wait for debounced export after deletion
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Check that JSONL files exist and relationship is removed
      const sudocodeDir = path.join(testProjectPath, ".sudocode");
      const issuesJsonlPath = path.join(sudocodeDir, "issues.jsonl");
      expect(fs.existsSync(issuesJsonlPath)).toBeTruthy();

      const issuesContent = fs.readFileSync(issuesJsonlPath, "utf-8");
      const issueLines = issuesContent.trim().split("\n");
      const exportedIssue = issueLines
        .map((line) => JSON.parse(line))
        .find((issue) => issue.id === issueId);

      expect(exportedIssue).toBeTruthy();
      expect(Array.isArray(exportedIssue.relationships)).toBeTruthy();
      expect(exportedIssue.relationships.length).toBe(0);
    });

    it("should return 404 when deleting non-existent relationship", async () => {
      const relationship = {
        from_id: testIssueId,
        from_type: "issue",
        to_id: testSpecId,
        to_type: "spec",
        relationship_type: "implements",
      };

      const response = await request(app)
        .delete("/api/relationships").set("X-Project-ID", projectId)
        .send(relationship)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should reject delete without from_id", async () => {
      const response = await request(app)
        .delete("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("from_id")).toBeTruthy();
    });

    it("should reject delete with invalid from_type", async () => {
      const response = await request(app)
        .delete("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          from_type: "invalid",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("from_type")).toBeTruthy();
    });
  });

  describe("Integration tests", () => {
    beforeAll(() => {
      // Config already exists in testDir from main beforeAll() hook
      // No additional setup needed
    });

    it("should support multiple relationship types", async () => {
      // Create another spec
      const spec2Response = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send({ title: "Related Spec", content: "# Related" });
      const spec2Id = spec2Response.body.data.id;

      // Create multiple relationships
      await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          from_type: "issue",
          to_id: spec2Id,
          to_type: "spec",
          relationship_type: "references",
        })
        .expect(201);

      await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: testSpecId,
          from_type: "spec",
          to_id: spec2Id,
          to_type: "spec",
          relationship_type: "related",
        })
        .expect(201);

      // Get all relationships for the issue
      const response = await request(app)
        .get(`/api/relationships/issue/${testIssueId}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.data.outgoing.length).toBe(1);

      // Get all relationships for spec2
      const spec2RelationshipsResponse = await request(app)
        .get(`/api/relationships/spec/${spec2Id}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(spec2RelationshipsResponse.body.data.incoming.length).toBe(2);
    });

    it("should handle bidirectional relationships correctly", async () => {
      // Create a new issue and spec
      const issueResponse = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
        .send({ title: "Bidirectional Issue", status: "open" });
      const issueId = issueResponse.body.data.id;

      const specResponse = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send({ title: "Bidirectional Spec", content: "# Test" });
      const specId = specResponse.body.data.id;

      // Create relationship in one direction
      await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: issueId,
          from_type: "issue",
          to_id: specId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(201);

      // Create relationship in reverse direction (different type)
      await request(app)
        .post("/api/relationships").set("X-Project-ID", projectId)
        .send({
          from_id: specId,
          from_type: "spec",
          to_id: issueId,
          to_type: "issue",
          relationship_type: "discovered-from",
        })
        .expect(201);

      // Verify both entities have both incoming and outgoing relationships
      const issueRels = await request(app)
        .get(`/api/relationships/issue/${issueId}`)
        .set("X-Project-ID", projectId);
      expect(issueRels.body.data.outgoing.length).toBe(1);
      expect(issueRels.body.data.incoming.length).toBe(1);

      const specRels = await request(app)
        .get(`/api/relationships/spec/${specId}`)
        .set("X-Project-ID", projectId);
      expect(specRels.body.data.outgoing.length).toBe(1);
      expect(specRels.body.data.incoming.length).toBe(1);
    });
  });
});
