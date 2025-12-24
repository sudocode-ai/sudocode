/**
 * Tests for Feedback API routes
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

describe("Feedback API", () => {
  let app: express.Application;
  let testDir: string;
  let testProjectPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let testIssueId: string;
  let testSpecId: string;
  let testFeedbackId: string;

  beforeAll(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-feedback-"));

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
      .post("/api/issues").set("X-Project-ID", projectId)
      .set("X-Project-ID", projectId)
      .send({ title: "Test Issue", description: "Test", status: "open" });
    testIssueId = issueResponse.body.data.id;

    const specResponse = await request(app)
      .post("/api/specs").set("X-Project-ID", projectId)
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

  describe("GET /api/feedback", () => {
    it("should return an empty list initially", async () => {
      const response = await request(app)
        .get("/api/feedback").set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length).toBe(0);
    });

    it("should support filtering by spec_id", async () => {
      const response = await request(app)
        .get(`/api/feedback?spec_id=${testSpecId}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
    });

    it("should support filtering by issue_id", async () => {
      const response = await request(app)
        .get(`/api/feedback?issue_id=${testIssueId}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
    });

    it("should support limit parameter", async () => {
      const response = await request(app)
        .get("/api/feedback?limit=5").set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length <= 5).toBeTruthy();
    });
  });

  describe("POST /api/feedback", () => {
    it("should create a new feedback", async () => {
      const feedback = {
        from_id: testIssueId,
        to_id: testSpecId,
        feedback_type: "comment",
        content: "This is a great spec!",
        agent: "test-user",
        anchor: {
          line_number: 10,
          anchor_status: "valid",
        },
      };

      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send(feedback)
        .expect(201)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBeTruthy();
      expect(response.body.data.from_id).toBe(testIssueId);
      expect(response.body.data.to_id).toBe(testSpecId);
      expect(response.body.data.feedback_type).toBe("comment");
      expect(response.body.data.content).toBe(feedback.content);

      // Save ID for later tests
      testFeedbackId = response.body.data.id;
    });

    it("should create anonymous feedback without issue_id", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          to_id: testSpecId,
          feedback_type: "comment",
          content: "Anonymous feedback",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.from_id).toBeNull();
    });

    it("should reject feedback without spec_id", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          feedback_type: "comment",
          content: "Test",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("spec_id")).toBeTruthy();
    });

    it("should reject feedback without feedback_type", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          content: "Test",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("feedback_type")).toBeTruthy();
    });

    it("should reject feedback with invalid feedback_type", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "invalid-type",
          content: "Test",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(
        response.body.message.includes("Invalid feedback_type")
      ).toBeTruthy();
    });

    it("should reject feedback without content", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "comment",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("content")).toBeTruthy();
    });

    it("should create feedback without agent (defaults to 'user')", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "comment",
          content: "Test without agent",
          anchor: { anchor_status: "valid" },
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.agent).toBe("user");
    });

    it("should create feedback without anchor", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "comment",
          content: "Test without anchor",
          agent: "test",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.anchor).toBe(null);
    });

    it("should reject feedback with invalid anchor_status", async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "comment",
          content: "Test",
          agent: "test",
          anchor: { anchor_status: "invalid" },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(
        response.body.message.includes("Invalid anchor.anchor_status")
      ).toBeTruthy();
    });
  });

  describe("GET /api/feedback/:id", () => {
    it("should get a feedback by ID", async () => {
      const response = await request(app)
        .get(`/api/feedback/${testFeedbackId}`).set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(testFeedbackId);
      expect(response.body.data.content).toBe("This is a great spec!");
    });

    it("should return 404 for non-existent feedback", async () => {
      const response = await request(app)
        .get("/api/feedback/00000000-0000-0000-0000-000000099999").set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });
  });

  describe("PUT /api/feedback/:id", () => {
    it("should update feedback content", async () => {
      const updates = {
        content: "Updated content!",
      };

      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`).set("X-Project-ID", projectId)
        .send(updates)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testFeedbackId);
      expect(response.body.data.content).toBe(updates.content);
    });

    it("should update feedback dismissed status", async () => {
      const updates = {
        dismissed: true,
      };

      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`).set("X-Project-ID", projectId)
        .send(updates)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.dismissed).toBe(true);
    });

    it("should update feedback anchor", async () => {
      const updates = {
        anchor: {
          line_number: 20,
          anchor_status: "relocated",
        },
      };

      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`).set("X-Project-ID", projectId)
        .send(updates)
        .expect(200);

      expect(response.body.success).toBe(true);
      const anchor = JSON.parse(response.body.data.anchor);
      expect(anchor.line_number).toBe(20);
      expect(anchor.anchor_status).toBe("relocated");
    });

    it("should return 404 for non-existent feedback", async () => {
      const response = await request(app)
        .put("/api/feedback/00000000-0000-0000-0000-000000099999").set("X-Project-ID", projectId)
        .send({ content: "Updated" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should reject empty update", async () => {
      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`).set("X-Project-ID", projectId)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("At least one field")).toBeTruthy();
    });

    it("should reject invalid anchor_status", async () => {
      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`).set("X-Project-ID", projectId)
        .send({
          anchor: { anchor_status: "invalid" },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(
        response.body.message.includes("Invalid anchor.anchor_status")
      ).toBeTruthy();
    });
  });

  describe("DELETE /api/feedback/:id", () => {
    let feedbackToDelete: string;

    // Create a feedback to delete in tests
    beforeAll(async () => {
      const response = await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "suggestion",
          content: "Feedback to delete",
          agent: "test",
          anchor: { anchor_status: "valid" },
        });
      feedbackToDelete = response.body.data.id;
    });

    it("should delete a feedback", async () => {
      const response = await request(app)
        .delete(`/api/feedback/${feedbackToDelete}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(feedbackToDelete);
      expect(response.body.data.deleted).toBe(true);
    });

    it("should return 404 when deleting non-existent feedback", async () => {
      const response = await request(app)
        .delete("/api/feedback/00000000-0000-0000-0000-000000099999").set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should not find deleted feedback", async () => {
      const response = await request(app)
        .get(`/api/feedback/${feedbackToDelete}`).set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("Integration tests", () => {
    it("should list the created feedback", async () => {
      const response = await request(app).get("/api/feedback").set("X-Project-ID", projectId).expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      // At least the feedback we created should be there
      expect(response.body.data.length >= 1).toBeTruthy();

      // Find our created feedback
      const foundFeedback = response.body.data.find(
        (fb: any) => fb.id === testFeedbackId
      );
      expect(foundFeedback).toBeTruthy();
      expect(foundFeedback.dismissed).toBe(true); // Updated in PUT test
    });

    it("should filter feedback by spec_id", async () => {
      const response = await request(app)
        .get(`/api/feedback?spec_id=${testSpecId}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();

      // All returned feedback should belong to testSpecId
      response.body.data.forEach((fb: any) => {
        expect(fb.to_id).toBe(testSpecId);
      });
    });

    it("should filter feedback by issue_id", async () => {
      const response = await request(app)
        .get(`/api/feedback?issue_id=${testIssueId}`).set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();

      // All returned feedback should belong to testIssueId
      response.body.data.forEach((fb: any) => {
        expect(fb.from_id).toBe(testIssueId);
      });
    });

    it("should filter feedback by dismissed status", async () => {
      const response = await request(app)
        .get("/api/feedback?dismissed=true").set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();

      // All returned feedback should be dismissed
      response.body.data.forEach((fb: any) => {
        expect(fb.dismissed).toBe(true);
      });
    });

    it("should support multiple feedback types", async () => {
      // Create different types of feedback
      await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "suggestion",
          content: "Suggestion feedback",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(201);

      await request(app)
        .post("/api/feedback").set("X-Project-ID", projectId)
        .send({
          from_id: testIssueId,
          to_id: testSpecId,
          feedback_type: "request",
          content: "Request feedback",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(201);

      // Get all feedback and verify we have different types
      const response = await request(app).get("/api/feedback").set("X-Project-ID", projectId).expect(200);

      const types = new Set(
        response.body.data.map((fb: any) => fb.feedback_type)
      );
      expect(types.has("comment")).toBeTruthy();
      expect(types.has("suggestion")).toBeTruthy();
      expect(types.has("request")).toBeTruthy();
    });
  });
});
