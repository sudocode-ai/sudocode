/**
 * Tests for Relationships API routes
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import express from "express";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode/cli/dist/db.js";
import { createRelationshipsRouter } from "../../src/routes/relationships.js";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { cleanupExport } from "../../src/services/export.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Relationships API", () => {
  let app: express.Application;
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testSpecId: string;

  before(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-relationships-"));
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
    app.use("/api/relationships", createRelationshipsRouter(db));

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
        .post("/api/relationships")
        .send(relationship)
        .expect(201)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.strictEqual(response.body.data.from_id, testIssueId);
      assert.strictEqual(response.body.data.to_id, testSpecId);
      assert.strictEqual(response.body.data.relationship_type, "implements");
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
        .post("/api/relationships")
        .send(relationship)
        .expect(201)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.strictEqual(response.body.data.from_id, testIssueId);
      assert.strictEqual(response.body.data.to_id, testSpecId);
      assert.strictEqual(response.body.data.relationship_type, "implements");
    });

    it("should reject relationship without from_id", async () => {
      const response = await request(app)
        .post("/api/relationships")
        .send({
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("from_id"));
    });

    it("should reject relationship with invalid from_type", async () => {
      const response = await request(app)
        .post("/api/relationships")
        .send({
          from_id: testIssueId,
          from_type: "invalid",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("from_type"));
    });

    it("should reject relationship without to_id", async () => {
      const response = await request(app)
        .post("/api/relationships")
        .send({
          from_id: testIssueId,
          from_type: "issue",
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("to_id"));
    });

    it("should reject relationship with invalid relationship_type", async () => {
      const response = await request(app)
        .post("/api/relationships")
        .send({
          from_id: testIssueId,
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "invalid-type",
        })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("Invalid relationship_type"));
    });

    it("should reject relationship with non-existent from_id", async () => {
      const response = await request(app)
        .post("/api/relationships")
        .send({
          from_id: "ISSUE-99999",
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
    });
  });

  describe("GET /api/relationships/:entity_type/:entity_id", () => {
    it("should get all relationships for an issue", async () => {
      const response = await request(app)
        .get(`/api/relationships/issue/${testIssueId}`)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.ok(Array.isArray(response.body.data.outgoing));
      assert.ok(Array.isArray(response.body.data.incoming));
      assert.strictEqual(response.body.data.outgoing.length, 1);
      assert.strictEqual(response.body.data.outgoing[0].to_id, testSpecId);
    });

    it("should get all relationships for a spec", async () => {
      const response = await request(app)
        .get(`/api/relationships/spec/${testSpecId}`)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
      assert.ok(Array.isArray(response.body.data.outgoing));
      assert.ok(Array.isArray(response.body.data.incoming));
      assert.strictEqual(response.body.data.incoming.length, 1);
      assert.strictEqual(response.body.data.incoming[0].from_id, testIssueId);
    });

    it("should return empty arrays for entity with no relationships", async () => {
      // Create another issue with no relationships
      const issueResponse = await request(app)
        .post("/api/issues")
        .send({ title: "Isolated Issue", status: "open" });

      const response = await request(app)
        .get(`/api/relationships/issue/${issueResponse.body.data.id}`)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.outgoing.length, 0);
      assert.strictEqual(response.body.data.incoming.length, 0);
    });

    it("should reject invalid entity_type", async () => {
      const response = await request(app)
        .get(`/api/relationships/invalid/${testIssueId}`)
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("Invalid entity_type"));
    });
  });

  describe("GET /api/relationships/:entity_type/:entity_id/outgoing", () => {
    it("should get outgoing relationships for an entity", async () => {
      const response = await request(app)
        .get(`/api/relationships/issue/${testIssueId}/outgoing`)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      assert.strictEqual(response.body.data.length, 1);
      assert.strictEqual(response.body.data[0].from_id, testIssueId);
      assert.strictEqual(response.body.data[0].to_id, testSpecId);
    });

    it("should filter by relationship_type", async () => {
      const response = await request(app)
        .get(`/api/relationships/issue/${testIssueId}/outgoing?relationship_type=implements`)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      response.body.data.forEach((rel: any) => {
        assert.strictEqual(rel.relationship_type, "implements");
      });
    });

    it("should return empty array when filtering for non-existent type", async () => {
      const response = await request(app)
        .get(`/api/relationships/issue/${testIssueId}/outgoing?relationship_type=blocks`)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 0);
    });
  });

  describe("GET /api/relationships/:entity_type/:entity_id/incoming", () => {
    it("should get incoming relationships for an entity", async () => {
      const response = await request(app)
        .get(`/api/relationships/spec/${testSpecId}/incoming`)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      assert.strictEqual(response.body.data.length, 1);
      assert.strictEqual(response.body.data[0].from_id, testIssueId);
      assert.strictEqual(response.body.data[0].to_id, testSpecId);
    });

    it("should filter by relationship_type", async () => {
      const response = await request(app)
        .get(`/api/relationships/spec/${testSpecId}/incoming?relationship_type=implements`)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      response.body.data.forEach((rel: any) => {
        assert.strictEqual(rel.relationship_type, "implements");
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
        .delete("/api/relationships")
        .send(relationship)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.deleted, true);
      assert.strictEqual(response.body.data.from_id, testIssueId);
      assert.strictEqual(response.body.data.to_id, testSpecId);
    });

    it("should trigger JSONL export after deleting relationship", async () => {
      // Create a new issue and spec for this test
      const issueResponse = await request(app)
        .post("/api/issues")
        .send({ title: "Delete Export Test Issue", description: "Test", status: "open" });
      const issueId = issueResponse.body.data.id;

      const specResponse = await request(app)
        .post("/api/specs")
        .send({ title: "Delete Export Test Spec", content: "# Test" });
      const specId = specResponse.body.data.id;

      // Create relationship
      await request(app)
        .post("/api/relationships")
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
        .delete("/api/relationships")
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
      const issuesJsonlPath = path.join(testDir, "issues.jsonl");
      assert.ok(fs.existsSync(issuesJsonlPath), "issues.jsonl should exist");

      const issuesContent = fs.readFileSync(issuesJsonlPath, "utf-8");
      const issueLines = issuesContent.trim().split("\n");
      const exportedIssue = issueLines
        .map((line) => JSON.parse(line))
        .find((issue) => issue.id === issueId);

      assert.ok(exportedIssue, "Issue should be in JSONL");
      assert.ok(
        Array.isArray(exportedIssue.relationships),
        "Issue should have relationships array"
      );
      assert.strictEqual(
        exportedIssue.relationships.length,
        0,
        "Issue should have no relationships after deletion"
      );
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
        .delete("/api/relationships")
        .send(relationship)
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("not found"));
    });

    it("should reject delete without from_id", async () => {
      const response = await request(app)
        .delete("/api/relationships")
        .send({
          from_type: "issue",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("from_id"));
    });

    it("should reject delete with invalid from_type", async () => {
      const response = await request(app)
        .delete("/api/relationships")
        .send({
          from_id: testIssueId,
          from_type: "invalid",
          to_id: testSpecId,
          to_type: "spec",
          relationship_type: "implements",
        })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.message.includes("from_type"));
    });
  });

  describe("Integration tests", () => {
    before(() => {
      // Config already exists in testDir from main before() hook
      // No additional setup needed
    });

    it("should support multiple relationship types", async () => {
      // Create another spec
      const spec2Response = await request(app)
        .post("/api/specs")
        .send({ title: "Related Spec", content: "# Related" });
      const spec2Id = spec2Response.body.data.id;

      // Create multiple relationships
      await request(app)
        .post("/api/relationships")
        .send({
          from_id: testIssueId,
          from_type: "issue",
          to_id: spec2Id,
          to_type: "spec",
          relationship_type: "references",
        })
        .expect(201);

      await request(app)
        .post("/api/relationships")
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
        .get(`/api/relationships/issue/${testIssueId}`)
        .expect(200);

      assert.strictEqual(response.body.data.outgoing.length, 1);

      // Get all relationships for spec2
      const spec2RelationshipsResponse = await request(app)
        .get(`/api/relationships/spec/${spec2Id}`)
        .expect(200);

      assert.strictEqual(spec2RelationshipsResponse.body.data.incoming.length, 2);
    });

    it("should handle bidirectional relationships correctly", async () => {
      // Create a new issue and spec
      const issueResponse = await request(app)
        .post("/api/issues")
        .send({ title: "Bidirectional Issue", status: "open" });
      const issueId = issueResponse.body.data.id;

      const specResponse = await request(app)
        .post("/api/specs")
        .send({ title: "Bidirectional Spec", content: "# Test" });
      const specId = specResponse.body.data.id;

      // Create relationship in one direction
      await request(app)
        .post("/api/relationships")
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
        .post("/api/relationships")
        .send({
          from_id: specId,
          from_type: "spec",
          to_id: issueId,
          to_type: "issue",
          relationship_type: "discovered-from",
        })
        .expect(201);

      // Verify both entities have both incoming and outgoing relationships
      const issueRels = await request(app).get(
        `/api/relationships/issue/${issueId}`
      );
      assert.strictEqual(issueRels.body.data.outgoing.length, 1);
      assert.strictEqual(issueRels.body.data.incoming.length, 1);

      const specRels = await request(app).get(
        `/api/relationships/spec/${specId}`
      );
      assert.strictEqual(specRels.body.data.outgoing.length, 1);
      assert.strictEqual(specRels.body.data.incoming.length, 1);
    });
  });
});
