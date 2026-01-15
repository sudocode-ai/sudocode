/**
 * Tests for Stacks API routes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { createStacksRouter } from "../../../src/routes/stacks.js";
import { createIssuesRouter } from "../../../src/routes/issues.js";
import { cleanupExport } from "../../../src/services/export.js";
import { ProjectManager } from "../../../src/services/project-manager.js";
import { ProjectRegistry } from "../../../src/services/project-registry.js";
import { requireProject } from "../../../src/middleware/project-context.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Stacks API", () => {
  let app: express.Application;
  let testDir: string;
  let testProjectPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let testIssueId1: string;
  let testIssueId2: string;
  let testIssueId3: string;

  beforeAll(async () => {
    // Create a unique temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-stacks-test-"));

    // Create test project directory structure
    testProjectPath = path.join(testDir, "test-project");
    const sudocodeDir = path.join(testProjectPath, ".sudocode");
    fs.mkdirSync(sudocodeDir, { recursive: true });

    // Create config.json
    const configPath = path.join(sudocodeDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create directories
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

    projectManager = new ProjectManager(projectRegistry, {
      watchEnabled: false,
    });

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
    app.use(
      "/api/stacks",
      requireProject(projectManager),
      createStacksRouter()
    );
    app.use(
      "/api/issues",
      requireProject(projectManager),
      createIssuesRouter()
    );

    // Create test issues
    const issue1Response = await request(app)
      .post("/api/issues")
      .set("X-Project-ID", projectId)
      .send({ title: "Issue 1", content: "Content 1", status: "open" });
    testIssueId1 = issue1Response.body.data.id;

    const issue2Response = await request(app)
      .post("/api/issues")
      .set("X-Project-ID", projectId)
      .send({ title: "Issue 2", content: "Content 2", status: "open" });
    testIssueId2 = issue2Response.body.data.id;

    const issue3Response = await request(app)
      .post("/api/issues")
      .set("X-Project-ID", projectId)
      .send({ title: "Issue 3", content: "Content 3", status: "open" });
    testIssueId3 = issue3Response.body.data.id;
  });

  afterAll(async () => {
    cleanupExport();
    await projectManager.shutdown();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("POST /api/stacks", () => {
    it("should create a new stack", async () => {
      const response = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          name: "Test Stack",
          issue_ids: [testIssueId1, testIssueId2],
          root_issue_id: testIssueId2,
        })
        .expect(201)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toMatch(/^stk-/);
      expect(response.body.data.name).toBe("Test Stack");
      expect(response.body.data.issue_order).toEqual([
        testIssueId1,
        testIssueId2,
      ]);
      expect(response.body.data.root_issue_id).toBe(testIssueId2);
      expect(response.body.data.is_auto).toBe(false);
    });

    it("should create stack without name", async () => {
      const response = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          issue_ids: [testIssueId1],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBeUndefined();
    });

    it("should reject stack without issue_ids", async () => {
      const response = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          name: "Invalid Stack",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("issue_ids");
    });

    it("should reject stack with empty issue_ids", async () => {
      const response = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          name: "Empty Stack",
          issue_ids: [],
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/stacks", () => {
    let createdStackId: string;

    beforeAll(async () => {
      // Create a stack for testing
      const response = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          name: "List Test Stack",
          issue_ids: [testIssueId3],
        });
      createdStackId = response.body.data.id;
    });

    it("should list all stacks", async () => {
      const response = await request(app)
        .get("/api/stacks")
        .set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(Array.isArray(response.body.data.stacks)).toBe(true);
      expect(response.body.data.manual_count).toBeGreaterThanOrEqual(1);
      expect(typeof response.body.data.auto_count).toBe("number");
    });

    it("should filter by include_auto", async () => {
      const response = await request(app)
        .get("/api/stacks?include_auto=false")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      // All returned stacks should be manual
      for (const stackInfo of response.body.data.stacks) {
        expect(stackInfo.stack.is_auto).toBe(false);
      }
    });

    it("should filter by include_manual", async () => {
      const response = await request(app)
        .get("/api/stacks?include_manual=false")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      // All returned stacks should be auto
      for (const stackInfo of response.body.data.stacks) {
        expect(stackInfo.stack.is_auto).toBe(true);
      }
    });
  });

  describe("GET /api/stacks/:id", () => {
    let stackId: string;

    beforeAll(async () => {
      const response = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          name: "Get Test Stack",
          issue_ids: [testIssueId1, testIssueId2],
        });
      stackId = response.body.data.id;
    });

    it("should get a stack by ID", async () => {
      const response = await request(app)
        .get(`/api/stacks/${stackId}`)
        .set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.stack.id).toBe(stackId);
      expect(response.body.data.stack.name).toBe("Get Test Stack");
      expect(response.body.data.entries).toHaveLength(2);
      expect(response.body.data.health).toBeTruthy();
    });

    it("should return 404 for non-existent stack", async () => {
      const response = await request(app)
        .get("/api/stacks/stk-nonexistent")
        .set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });
  });

  describe("PUT /api/stacks/:id", () => {
    let stackId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          name: "Update Test Stack",
          issue_ids: [testIssueId1, testIssueId2],
        });
      stackId = response.body.data.id;
    });

    it("should update stack name", async () => {
      const response = await request(app)
        .put(`/api/stacks/${stackId}`)
        .set("X-Project-ID", projectId)
        .send({
          name: "Updated Stack Name",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Updated Stack Name");
    });

    it("should update issue order", async () => {
      const response = await request(app)
        .put(`/api/stacks/${stackId}`)
        .set("X-Project-ID", projectId)
        .send({
          issue_order: [testIssueId2, testIssueId1],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.issue_order).toEqual([
        testIssueId2,
        testIssueId1,
      ]);
    });

    it("should add issues to stack", async () => {
      const response = await request(app)
        .put(`/api/stacks/${stackId}`)
        .set("X-Project-ID", projectId)
        .send({
          add_issues: [testIssueId3],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.issue_order).toContain(testIssueId3);
    });

    it("should remove issues from stack", async () => {
      const response = await request(app)
        .put(`/api/stacks/${stackId}`)
        .set("X-Project-ID", projectId)
        .send({
          remove_issues: [testIssueId2],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.issue_order).not.toContain(testIssueId2);
    });

    it("should return 404 for non-existent stack", async () => {
      const response = await request(app)
        .put("/api/stacks/stk-nonexistent")
        .set("X-Project-ID", projectId)
        .send({ name: "Test" })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("DELETE /api/stacks/:id", () => {
    it("should delete a stack", async () => {
      // Create a stack to delete
      const createResponse = await request(app)
        .post("/api/stacks")
        .set("X-Project-ID", projectId)
        .send({
          name: "Stack to Delete",
          issue_ids: [testIssueId1],
        });
      const stackId = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/api/stacks/${stackId}`)
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify it's deleted
      const getResponse = await request(app)
        .get(`/api/stacks/${stackId}`)
        .set("X-Project-ID", projectId)
        .expect(404);

      expect(getResponse.body.success).toBe(false);
    });

    it("should return 404 for non-existent stack", async () => {
      const response = await request(app)
        .delete("/api/stacks/stk-nonexistent")
        .set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
