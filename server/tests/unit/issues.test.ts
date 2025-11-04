/**
 * Tests for Issues API routes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode-ai/cli/dist/db.js";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { cleanupExport } from "../../src/services/export.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Issues API", () => {
  let app: express.Application;
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let createdIssueId: string;

  beforeAll(() => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-issues-"));
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

    // Initialize test database
    db = initDatabase({ path: testDbPath });

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api/issues", createIssuesRouter(db));
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

  describe("GET /api/issues", () => {
    it("should return an empty list initially", async () => {
      const response = await request(app)
        .get("/api/issues")
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length).toBe(0);
    });

    it("should support filtering by status", async () => {
      const response = await request(app)
        .get("/api/issues?status=open")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
    });

    it("should support limit parameter", async () => {
      const response = await request(app)
        .get("/api/issues?limit=5")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      expect(response.body.data.length <= 5).toBeTruthy();
    });
  });

  describe("POST /api/issues", () => {
    it("should create a new issue", async () => {
      const newIssue = {
        title: "Test Issue",
        content: "This is a test issue",
        status: "open",
        priority: 1,
      };

      const response = await request(app)
        .post("/api/issues")
        .send(newIssue)
        .expect(201)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBeTruthy();
      expect(response.body.data.title).toBe(newIssue.title);
      expect(response.body.data.content).toBe(newIssue.content);
      expect(response.body.data.status).toBe(newIssue.status);
      expect(response.body.data.priority).toBe(newIssue.priority);

      // Save the ID for later tests
      createdIssueId = response.body.data.id;
    });

    it("should reject issue without title", async () => {
      const invalidIssue = {
        content: "No title provided",
      };

      const response = await request(app)
        .post("/api/issues")
        .send(invalidIssue)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("Title")).toBeTruthy();
    });

    it("should reject issue with title too long", async () => {
      const invalidIssue = {
        title: "x".repeat(501), // 501 characters
        content: "Title is too long",
      };

      const response = await request(app)
        .post("/api/issues")
        .send(invalidIssue)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("500 characters")).toBeTruthy();
    });

    it("should create issue with default values", async () => {
      const minimalIssue = {
        title: "Minimal Issue",
      };

      const response = await request(app)
        .post("/api/issues")
        .send(minimalIssue)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe(minimalIssue.title);
      expect(response.body.data.content).toBe("");
      expect(response.body.data.status).toBe("open");
      expect(response.body.data.priority).toBe(2);
    });
  });

  describe("GET /api/issues/:id", () => {
    it("should get an issue by ID", async () => {
      const response = await request(app)
        .get(`/api/issues/${createdIssueId}`)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(createdIssueId);
      expect(response.body.data.title).toBe("Test Issue");
    });

    it("should return 404 for non-existent issue", async () => {
      const response = await request(app)
        .get("/api/issues/ISSUE-99999")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });
  });

  describe("PUT /api/issues/:id", () => {
    it("should update an issue", async () => {
      const updates = {
        status: "in_progress",
        priority: 3,
      };

      const response = await request(app)
        .put(`/api/issues/${createdIssueId}`)
        .send(updates)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdIssueId);
      expect(response.body.data.status).toBe(updates.status);
      expect(response.body.data.priority).toBe(updates.priority);
      // Original title should remain
      expect(response.body.data.title).toBe("Test Issue");
    });

    it("should return 404 for non-existent issue", async () => {
      const response = await request(app)
        .put("/api/issues/ISSUE-99999")
        .send({ status: "closed" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should reject empty update", async () => {
      const response = await request(app)
        .put(`/api/issues/${createdIssueId}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("At least one field")).toBeTruthy();
    });

    it("should reject title that is too long", async () => {
      const response = await request(app)
        .put(`/api/issues/${createdIssueId}`)
        .send({ title: "x".repeat(501) })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("500 characters")).toBeTruthy();
    });
  });

  describe("DELETE /api/issues/:id", () => {
    let issueToDelete: string;

    // Create an issue to delete in tests
    beforeAll(async () => {
      const response = await request(app)
        .post("/api/issues")
        .send({ title: "Issue to Delete" });
      issueToDelete = response.body.data.id;
    });

    it("should delete an issue", async () => {
      const response = await request(app)
        .delete(`/api/issues/${issueToDelete}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.id).toBe(issueToDelete);
      expect(response.body.data.deleted).toBe(true);
    });

    it("should return 404 when deleting non-existent issue", async () => {
      const response = await request(app)
        .delete("/api/issues/ISSUE-99999")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message.includes("not found")).toBeTruthy();
    });

    it("should not find deleted issue", async () => {
      const response = await request(app)
        .get(`/api/issues/${issueToDelete}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("Integration tests", () => {
    it("should list the created issues", async () => {
      const response = await request(app).get("/api/issues").expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();
      // At least the issues we created should be there
      expect(response.body.data.length >= 2).toBeTruthy();

      // Find our created issue
      const foundIssue = response.body.data.find(
        (issue: any) => issue.id === createdIssueId
      );
      expect(foundIssue).toBeTruthy();
      expect(foundIssue.status).toBe("in_progress"); // Updated in PUT test
    });

    it("should filter issues by status", async () => {
      const response = await request(app)
        .get("/api/issues?status=in_progress")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBeTruthy();

      // All returned issues should have in_progress status
      response.body.data.forEach((issue: any) => {
        expect(issue.status).toBe("in_progress");
      });
    });

    it("should close an issue", async () => {
      const response = await request(app)
        .put(`/api/issues/${createdIssueId}`)
        .send({ status: "closed" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("closed");
      expect(response.body.data.closed_at).toBeTruthy(); // Should have closed_at timestamp
    });
  });
});
