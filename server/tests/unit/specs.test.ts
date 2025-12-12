/**
 * Tests for Specs API routes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { createFeedbackRouter } from "../../src/routes/feedback.js";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { cleanupExport } from "../../src/services/export.js";
import { ProjectManager } from "../../src/services/project-manager.js";
import { ProjectRegistry } from "../../src/services/project-registry.js";
import { requireProject } from "../../src/middleware/project-context.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Specs API", () => {
  let app: express.Application;
  let testDir: string;
  let testProjectPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let testIssueId: string;
  let testSpecId: string;
  let testSpecId2: string;
  let createdSpecId: string;

  beforeAll(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-specs-"));

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
    app.use("/api/feedback", requireProject(projectManager), createFeedbackRouter());

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

  describe("GET /api/specs", () => {
    it("should return list of specs", async () => {
      const response = await request(app)
        .get("/api/specs").set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length >= 1).toBeTruthy();
    });

    it("should support filtering by priority", async () => {
      const response = await request(app)
        .get("/api/specs?priority=1").set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
    });

    it("should support limit parameter", async () => {
      const response = await request(app)
        .get("/api/specs?limit=5")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length <= 5).toBeTruthy();
    });
  });

  describe("POST /api/specs", () => {
    it("should create a new spec", async () => {
      const newSpec = {
        title: "Test Spec",
        content: "# Test Content\n\nThis is a test spec.",
        priority: 1,
      };

      const response = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send(newSpec)
        .expect(201)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBeTruthy();
      expect(response.body.data.title).toBe(newSpec.title);
      expect(response.body.data.content).toBe(newSpec.content);
      expect(response.body.data.priority).toBe(newSpec.priority);

      // Save the ID for later tests
      createdSpecId = response.body.data.id;
    });

    it("should reject spec without title", async () => {
      const invalidSpec = {
        content: "No title provided",
      };

      const response = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send(invalidSpec)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("Title")).toBeTruthy();
    });

    it("should reject spec with title too long", async () => {
      const invalidSpec = {
        title: "x".repeat(501), // 501 characters
        content: "Title is too long",
      };

      const response = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send(invalidSpec)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("500 characters")).toBeTruthy();
    });

    it("should create spec with default values", async () => {
      const minimalSpec = {
        title: "Minimal Spec",
      };

      const response = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send(minimalSpec)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe(minimalSpec.title);
      expect(response.body.data.content).toBe("");
      expect(response.body.data.priority).toBe(2);
    });

    it("should create spec with relative file_path", async () => {
      const newSpec = {
        title: "Spec for File Path Test",
        content: "Testing file path generation",
      };

      const response = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send(newSpec)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.file_path).toBeTruthy();

      const filePath = response.body.data.file_path;
      const specId = response.body.data.id;

      // Verify file_path is relative, not absolute
      expect(path.isAbsolute(filePath)).toBe(false);

      // Verify file_path matches the pattern specs/{id}.md
      expect(filePath).toBe(`specs/${specId}.md`);

      // Verify file_path starts with specs/
      expect(filePath.startsWith("specs/")).toBe(true);
    });
  });

  describe("GET /api/specs/:id", () => {
    it("should get a spec by ID", async () => {
      const response = await request(app)
        .get(`/api/specs/${createdSpecId}`).set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(createdSpecId);
      expect(response.body.data.title).toBe("Test Spec");
    });

    it("should return 404 for non-existent spec", async () => {
      const response = await request(app)
        .get("/api/specs/SPEC-99999").set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });
  });

  describe("PUT /api/specs/:id", () => {
    it("should update a spec", async () => {
      const updates = {
        content: "# Updated Content\n\nThis is updated.",
        priority: 3,
      };

      const response = await request(app)
        .put(`/api/specs/${createdSpecId}`).set("X-Project-ID", projectId)
        .send(updates)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdSpecId);
      expect(response.body.data.content).toBe(updates.content);
      expect(response.body.data.priority).toBe(updates.priority);
      // Original title should remain
      expect(response.body.data.title).toBe("Test Spec");
    });

    it("should return 404 for non-existent spec", async () => {
      const response = await request(app)
        .put("/api/specs/SPEC-99999").set("X-Project-ID", projectId)
        .send({ content: "Updated" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should reject empty update", async () => {
      const response = await request(app)
        .put(`/api/specs/${createdSpecId}`).set("X-Project-ID", projectId)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("At least one field")).toBeTruthy();
    });

    it("should reject title that is too long", async () => {
      const response = await request(app)
        .put(`/api/specs/${createdSpecId}`).set("X-Project-ID", projectId)
        .send({ title: "x".repeat(501) })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("500 characters")).toBeTruthy();
    });
  });

  describe("DELETE /api/specs/:id", () => {
    let specToDelete: string;

    // Create a spec to delete in tests
    beforeAll(async () => {
      const response = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send({ title: "Spec to Delete" });
      specToDelete = response.body.data.id;
    });

    it("should delete a spec", async () => {
      const response = await request(app)
        .delete(`/api/specs/${specToDelete}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(specToDelete);
      expect(response.body.data.deleted).toBe(true);
    });

    it("should return 404 when deleting non-existent spec", async () => {
      const response = await request(app)
        .delete("/api/specs/SPEC-99999").set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should not find deleted spec", async () => {
      const response = await request(app)
        .get(`/api/specs/${specToDelete}`).set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("Integration tests", () => {
    it("should list the created specs", async () => {
      const response = await request(app)
        .get("/api/specs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      // At least the specs we created should be there
      expect(response.body.data.length >= 2).toBeTruthy();

      // Find our created spec
      const foundSpec = response.body.data.find(
        (spec: any) => spec.id === createdSpecId
      );
      expect(foundSpec).toBeTruthy();
      expect(foundSpec.priority).toBe(3); // Updated in PUT test
    });

    it("should filter specs by priority", async () => {
      const response = await request(app)
        .get("/api/specs?priority=3").set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();

      // All returned specs should have priority 3
      response.body.data.forEach((spec: any) => {
        expect(spec.priority).toBe(3);
      });
    });
  });
});
