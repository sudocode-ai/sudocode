/**
 * Tests for Issues API routes
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import express from "express";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode/cli/dist/db.js";
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

  before(() => {
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

  after(() => {
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

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      assert.strictEqual(response.body.data.length, 0);
    });

    it("should support filtering by status", async () => {
      const response = await request(app)
        .get("/api/issues?status=open")
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
    });

    it("should support limit parameter", async () => {
      const response = await request(app)
        .get("/api/issues?limit=5")
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      assert.ok(response.body.data.length <= 5);
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

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.ok(response.body.data.id);
      assert.strictEqual(response.body.data.title, newIssue.title);
      assert.strictEqual(response.body.data.content, newIssue.content);
      assert.strictEqual(response.body.data.status, newIssue.status);
      assert.strictEqual(response.body.data.priority, newIssue.priority);

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

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("Title"));
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

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("500 characters"));
    });

    it("should create issue with default values", async () => {
      const minimalIssue = {
        title: "Minimal Issue",
      };

      const response = await request(app)
        .post("/api/issues")
        .send(minimalIssue)
        .expect(201);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.title, minimalIssue.title);
      assert.strictEqual(response.body.data.content, "");
      assert.strictEqual(response.body.data.status, "open");
      assert.strictEqual(response.body.data.priority, 2);
    });
  });

  describe("GET /api/issues/:id", () => {
    it("should get an issue by ID", async () => {
      const response = await request(app)
        .get(`/api/issues/${createdIssueId}`)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.strictEqual(response.body.data.id, createdIssueId);
      assert.strictEqual(response.body.data.title, "Test Issue");
    });

    it("should return 404 for non-existent issue", async () => {
      const response = await request(app)
        .get("/api/issues/ISSUE-99999")
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
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

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.id, createdIssueId);
      assert.strictEqual(response.body.data.status, updates.status);
      assert.strictEqual(response.body.data.priority, updates.priority);
      // Original title should remain
      assert.strictEqual(response.body.data.title, "Test Issue");
    });

    it("should return 404 for non-existent issue", async () => {
      const response = await request(app)
        .put("/api/issues/ISSUE-99999")
        .send({ status: "closed" })
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
    });

    it("should reject empty update", async () => {
      const response = await request(app)
        .put(`/api/issues/${createdIssueId}`)
        .send({})
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("At least one field"));
    });

    it("should reject title that is too long", async () => {
      const response = await request(app)
        .put(`/api/issues/${createdIssueId}`)
        .send({ title: "x".repeat(501) })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("500 characters"));
    });
  });

  describe("DELETE /api/issues/:id", () => {
    let issueToDelete: string;

    // Create an issue to delete in tests
    before(async () => {
      const response = await request(app)
        .post("/api/issues")
        .send({ title: "Issue to Delete" });
      issueToDelete = response.body.data.id;
    });

    it("should delete an issue", async () => {
      const response = await request(app)
        .delete(`/api/issues/${issueToDelete}`)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.strictEqual(response.body.data.id, issueToDelete);
      assert.strictEqual(response.body.data.deleted, true);
    });

    it("should return 404 when deleting non-existent issue", async () => {
      const response = await request(app)
        .delete("/api/issues/ISSUE-99999")
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
    });

    it("should not find deleted issue", async () => {
      const response = await request(app)
        .get(`/api/issues/${issueToDelete}`)
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe("Integration tests", () => {
    it("should list the created issues", async () => {
      const response = await request(app).get("/api/issues").expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      // At least the issues we created should be there
      assert.ok(response.body.data.length >= 2);

      // Find our created issue
      const foundIssue = response.body.data.find(
        (issue: any) => issue.id === createdIssueId
      );
      assert.ok(foundIssue);
      assert.strictEqual(foundIssue.status, "in_progress"); // Updated in PUT test
    });

    it("should filter issues by status", async () => {
      const response = await request(app)
        .get("/api/issues?status=in_progress")
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));

      // All returned issues should have in_progress status
      response.body.data.forEach((issue: any) => {
        assert.strictEqual(issue.status, "in_progress");
      });
    });

    it("should close an issue", async () => {
      const response = await request(app)
        .put(`/api/issues/${createdIssueId}`)
        .send({ status: "closed" })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.status, "closed");
      assert.ok(response.body.data.closed_at); // Should have closed_at timestamp
    });
  });
});
