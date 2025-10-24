/**
 * Tests for Specs API routes
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import express from "express";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode/cli/dist/db.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import * as fs from "fs";
import * as path from "path";

describe("Specs API", () => {
  let app: express.Application;
  let db: Database.Database;
  let testDbPath: string;
  let createdSpecId: string;

  before(() => {
    // Create a temporary database for testing
    testDbPath = path.join(process.cwd(), ".sudocode-test-specs", "cache.db");
    const testDir = path.dirname(testDbPath);

    // Create test directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create .sudocode directory at project root for config (needed by POST endpoint)
    const sudocodeDir = path.join(process.cwd(), ".sudocode-test-specs");
    if (!fs.existsSync(sudocodeDir)) {
      fs.mkdirSync(sudocodeDir, { recursive: true });
    }

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

    // Initialize test database
    db = initDatabase({ path: testDbPath });

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api/specs", createSpecsRouter(db));
  });

  after(() => {
    // Clean up
    db.close();
    const sudocodeDir = path.join(process.cwd(), ".sudocode-test-specs");
    if (fs.existsSync(sudocodeDir)) {
      fs.rmSync(sudocodeDir, { recursive: true, force: true });
    }
  });

  describe("GET /api/specs", () => {
    it("should return an empty list initially", async () => {
      const response = await request(app)
        .get("/api/specs")
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      assert.strictEqual(response.body.data.length, 0);
    });

    it("should support filtering by priority", async () => {
      const response = await request(app)
        .get("/api/specs?priority=1")
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
    });

    it("should support limit parameter", async () => {
      const response = await request(app).get("/api/specs?limit=5").expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      assert.ok(response.body.data.length <= 5);
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
        .post("/api/specs")
        .send(newSpec)
        .expect(201)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.ok(response.body.data.id);
      assert.strictEqual(response.body.data.title, newSpec.title);
      assert.strictEqual(response.body.data.content, newSpec.content);
      assert.strictEqual(response.body.data.priority, newSpec.priority);

      // Save the ID for later tests
      createdSpecId = response.body.data.id;
    });

    it("should reject spec without title", async () => {
      const invalidSpec = {
        content: "No title provided",
      };

      const response = await request(app)
        .post("/api/specs")
        .send(invalidSpec)
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("Title"));
    });

    it("should reject spec with title too long", async () => {
      const invalidSpec = {
        title: "x".repeat(501), // 501 characters
        content: "Title is too long",
      };

      const response = await request(app)
        .post("/api/specs")
        .send(invalidSpec)
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("500 characters"));
    });

    it("should create spec with default values", async () => {
      const minimalSpec = {
        title: "Minimal Spec",
      };

      const response = await request(app)
        .post("/api/specs")
        .send(minimalSpec)
        .expect(201);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.title, minimalSpec.title);
      assert.strictEqual(response.body.data.content, "");
      assert.strictEqual(response.body.data.priority, 2);
    });
  });

  describe("GET /api/specs/:id", () => {
    it("should get a spec by ID", async () => {
      const response = await request(app)
        .get(`/api/specs/${createdSpecId}`)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.strictEqual(response.body.data.id, createdSpecId);
      assert.strictEqual(response.body.data.title, "Test Spec");
    });

    it("should return 404 for non-existent spec", async () => {
      const response = await request(app)
        .get("/api/specs/SPEC-99999")
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
    });
  });

  describe("PUT /api/specs/:id", () => {
    it("should update a spec", async () => {
      const updates = {
        content: "# Updated Content\n\nThis is updated.",
        priority: 3,
      };

      const response = await request(app)
        .put(`/api/specs/${createdSpecId}`)
        .send(updates)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.id, createdSpecId);
      assert.strictEqual(response.body.data.content, updates.content);
      assert.strictEqual(response.body.data.priority, updates.priority);
      // Original title should remain
      assert.strictEqual(response.body.data.title, "Test Spec");
    });

    it("should return 404 for non-existent spec", async () => {
      const response = await request(app)
        .put("/api/specs/SPEC-99999")
        .send({ content: "Updated" })
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
    });

    it("should reject empty update", async () => {
      const response = await request(app)
        .put(`/api/specs/${createdSpecId}`)
        .send({})
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("At least one field"));
    });

    it("should reject title that is too long", async () => {
      const response = await request(app)
        .put(`/api/specs/${createdSpecId}`)
        .send({ title: "x".repeat(501) })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("500 characters"));
    });
  });

  describe("DELETE /api/specs/:id", () => {
    let specToDelete: string;

    // Create a spec to delete in tests
    before(async () => {
      const response = await request(app)
        .post("/api/specs")
        .send({ title: "Spec to Delete" });
      specToDelete = response.body.data.id;
    });

    it("should delete a spec", async () => {
      const response = await request(app)
        .delete(`/api/specs/${specToDelete}`)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.strictEqual(response.body.data.id, specToDelete);
      assert.strictEqual(response.body.data.deleted, true);
    });

    it("should return 404 when deleting non-existent spec", async () => {
      const response = await request(app)
        .delete("/api/specs/SPEC-99999")
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
    });

    it("should not find deleted spec", async () => {
      const response = await request(app)
        .get(`/api/specs/${specToDelete}`)
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe("Integration tests", () => {
    it("should list the created specs", async () => {
      const response = await request(app).get("/api/specs").expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      // At least the specs we created should be there
      assert.ok(response.body.data.length >= 2);

      // Find our created spec
      const foundSpec = response.body.data.find(
        (spec: any) => spec.id === createdSpecId
      );
      assert.ok(foundSpec);
      assert.strictEqual(foundSpec.priority, 3); // Updated in PUT test
    });

    it("should filter specs by priority", async () => {
      const response = await request(app)
        .get("/api/specs?priority=3")
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));

      // All returned specs should have priority 3
      response.body.data.forEach((spec: any) => {
        assert.strictEqual(spec.priority, 3);
      });
    });
  });
});
