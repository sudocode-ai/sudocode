/**
 * Tests for Feedback API routes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode-ai/cli/dist/db.js";
import { createFeedbackRouter } from "../../src/routes/feedback.js";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { cleanupExport } from "../../src/services/export.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Feedback API", () => {
  let app: express.Application;
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testSpecId: string;
  let testFeedbackId: string;

  beforeAll(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-feedback-"));
    testDbPath = path.join(testDir, "cache.db");

    // Set SUDOCODE_DIR environment variable
    process.env.SUDOCODE_DIR = testDir;

    // Create config.json for ID generation
    const configPath = path.join(testDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create specs directory for spec files
    const specsDir = path.join(testDir, "specs");
    fs.mkdirSync(specsDir, { recursive: true });

    // Initialize test database
    db = initDatabase({ path: testDbPath });

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api/issues", createIssuesRouter(db));
    app.use("/api/specs", createSpecsRouter(db));
    app.use("/api/feedback", createFeedbackRouter(db));

    // Create test issue and spec
    const issueResponse = await request(app)
      .post("/api/issues")
      .send({ title: "Test Issue", description: "Test", status: "open" });
    testIssueId = issueResponse.body.data.id;

    const specResponse = await request(app)
      .post("/api/specs")
      .send({ title: "Test Spec", content: "# Test" });
    testSpecId = specResponse.body.data.id;
  });

  afterAll(() => {
    // Clean up export debouncer first
    cleanupExport();
    // Clean up database
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  describe("GET /api/feedback", () => {
    it("should return an empty list initially", async () => {
      const response = await request(app)
        .get("/api/feedback")
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length).toBe(0);
    });

    it("should support filtering by spec_id", async () => {
      const response = await request(app)
        .get(`/api/feedback?spec_id=${testSpecId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
    });

    it("should support filtering by issue_id", async () => {
      const response = await request(app)
        .get(`/api/feedback?issue_id=${testIssueId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
    });

    it("should support limit parameter", async () => {
      const response = await request(app)
        .get("/api/feedback?limit=5")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length <= 5).toBeTruthy();
    });
  });

  describe("POST /api/feedback", () => {
    it("should create a new feedback", async () => {
      const feedback = {
        issue_id: testIssueId,
        spec_id: testSpecId,
        feedback_type: "comment",
        content: "This is a great spec!",
        agent: "test-user",
        anchor: {
          line_number: 10,
          anchor_status: "valid",
        },
      };

      const response = await request(app)
        .post("/api/feedback")
        .send(feedback)
        .expect(201)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBeTruthy();
      expect(response.body.data.issue_id).toBe(testIssueId);
      expect(response.body.data.spec_id).toBe(testSpecId);
      expect(response.body.data.feedback_type).toBe("comment");
      expect(response.body.data.content).toBe(feedback.content);

      // Save ID for later tests
      testFeedbackId = response.body.data.id;
    });

    it("should reject feedback without issue_id", async () => {
      const response = await request(app)
        .post("/api/feedback")
        .send({
          spec_id: testSpecId,
          feedback_type: "comment",
          content: "Test",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("issue_id")).toBeTruthy();
    });

    it("should reject feedback without spec_id", async () => {
      const response = await request(app)
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
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
        .get(`/api/feedback/${testFeedbackId}`)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(testFeedbackId);
      expect(response.body.data.content).toBe("This is a great spec!");
    });

    it("should return 404 for non-existent feedback", async () => {
      const response = await request(app)
        .get("/api/feedback/FB-99999")
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
        .put(`/api/feedback/${testFeedbackId}`)
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
        .put(`/api/feedback/${testFeedbackId}`)
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
        .put(`/api/feedback/${testFeedbackId}`)
        .send(updates)
        .expect(200);

      expect(response.body.success).toBe(true);
      const anchor = JSON.parse(response.body.data.anchor);
      expect(anchor.line_number).toBe(20);
      expect(anchor.anchor_status).toBe("relocated");
    });

    it("should return 404 for non-existent feedback", async () => {
      const response = await request(app)
        .put("/api/feedback/FB-99999")
        .send({ content: "Updated" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should reject empty update", async () => {
      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("At least one field")).toBeTruthy();
    });

    it("should reject invalid anchor_status", async () => {
      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`)
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
          feedback_type: "suggestion",
          content: "Feedback to delete",
          agent: "test",
          anchor: { anchor_status: "valid" },
        });
      feedbackToDelete = response.body.data.id;
    });

    it("should delete a feedback", async () => {
      const response = await request(app)
        .delete(`/api/feedback/${feedbackToDelete}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(feedbackToDelete);
      expect(response.body.data.deleted).toBe(true);
    });

    it("should return 404 when deleting non-existent feedback", async () => {
      const response = await request(app)
        .delete("/api/feedback/FB-99999")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should not find deleted feedback", async () => {
      const response = await request(app)
        .get(`/api/feedback/${feedbackToDelete}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("Integration tests", () => {
    it("should list the created feedback", async () => {
      const response = await request(app).get("/api/feedback").expect(200);

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
        .get(`/api/feedback?spec_id=${testSpecId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();

      // All returned feedback should belong to testSpecId
      response.body.data.forEach((fb: any) => {
        expect(fb.spec_id).toBe(testSpecId);
      });
    });

    it("should filter feedback by issue_id", async () => {
      const response = await request(app)
        .get(`/api/feedback?issue_id=${testIssueId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();

      // All returned feedback should belong to testIssueId
      response.body.data.forEach((fb: any) => {
        expect(fb.issue_id).toBe(testIssueId);
      });
    });

    it("should filter feedback by dismissed status", async () => {
      const response = await request(app)
        .get("/api/feedback?dismissed=true")
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
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
          feedback_type: "suggestion",
          content: "Suggestion feedback",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(201);

      await request(app)
        .post("/api/feedback")
        .send({
          issue_id: testIssueId,
          spec_id: testSpecId,
          feedback_type: "request",
          content: "Request feedback",
          agent: "test",
          anchor: { anchor_status: "valid" },
        })
        .expect(201);

      // Get all feedback and verify we have different types
      const response = await request(app).get("/api/feedback").expect(200);

      const types = new Set(
        response.body.data.map((fb: any) => fb.feedback_type)
      );
      expect(types.has("comment")).toBeTruthy();
      expect(types.has("suggestion")).toBeTruthy();
      expect(types.has("request")).toBeTruthy();
    });
  });
});
