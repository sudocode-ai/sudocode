/**
 * Integration tests for JSONL export functionality
 * Verifies that database updates trigger exports to JSONL files
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import express from "express";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode/cli/dist/db.js";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { cleanupExport } from "../../src/services/export.js";
import { parseMarkdownFile } from "@sudocode/cli/dist/markdown.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Helper to wait for debounced export (2 seconds + buffer)
const waitForExport = () => new Promise((resolve) => setTimeout(resolve, 2500));

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

describe("JSONL Export Integration", () => {
  let app: express.Application;
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let issuesJsonlPath: string;
  let specsJsonlPath: string;

  before(() => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-export-"));
    testDbPath = path.join(testDir, "cache.db");
    issuesJsonlPath = path.join(testDir, "issues.jsonl");
    specsJsonlPath = path.join(testDir, "specs.jsonl");

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

    // Create directories for markdown files
    const issuesDir = path.join(testDir, "issues");
    const specsDir = path.join(testDir, "specs");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(specsDir, { recursive: true });

    // Initialize test database
    db = initDatabase({ path: testDbPath });

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api/issues", createIssuesRouter(db));
    app.use("/api/specs", createSpecsRouter(db));
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

  describe("Issue Export", () => {
    it("should export issue to JSONL and Markdown after creation", async () => {
      // Create an issue via API
      const newIssue = {
        title: "Export Test Issue",
        status: "open",
        priority: 1,
      };

      const response = await request(app)
        .post("/api/issues")
        .send(newIssue)
        .expect(201);

      assert.strictEqual(response.body.success, true);
      const issueId = response.body.data.id;

      // Wait for debounced export to complete
      await waitForExport();

      // Verify JSONL file exists and contains the issue
      assert.ok(fs.existsSync(issuesJsonlPath), "issues.jsonl should exist");

      const issues = readJSONL(issuesJsonlPath);
      assert.ok(issues.length > 0, "issues.jsonl should not be empty");

      const exportedIssue = issues.find((i) => i.id === issueId);
      assert.ok(exportedIssue, "Created issue should be in JSONL file");
      assert.strictEqual(exportedIssue.title, newIssue.title);
      assert.strictEqual(exportedIssue.status, newIssue.status);
      assert.strictEqual(exportedIssue.priority, newIssue.priority);

      // Verify markdown file was created
      const issueMdPath = path.join(testDir, "issues", `${issueId}.md`);
      assert.ok(
        fs.existsSync(issueMdPath),
        "Issue markdown file should be created"
      );

      // Verify markdown file content
      const parsed = parseMarkdownFile(issueMdPath, db, testDir);
      assert.strictEqual(parsed.data.id, issueId);
      assert.strictEqual(parsed.data.title, newIssue.title);
      assert.strictEqual(parsed.data.status, newIssue.status);
      assert.strictEqual(parsed.data.priority, newIssue.priority);
    });

    it("should update JSONL and Markdown after issue update", async () => {
      // Create an issue first
      const createResponse = await request(app)
        .post("/api/issues")
        .send({
          title: "Issue to Update",
          status: "open",
          priority: 2,
        })
        .expect(201);

      const issueId = createResponse.body.data.id;
      await waitForExport();

      // Update the issue
      const updates = {
        status: "in_progress",
        priority: 3,
      };

      await request(app)
        .put(`/api/issues/${issueId}`)
        .send(updates)
        .expect(200);

      // Wait for export after update
      await waitForExport();

      // Verify JSONL file contains updated data
      const issues = readJSONL(issuesJsonlPath);
      const updatedIssue = issues.find((i) => i.id === issueId);

      assert.ok(updatedIssue, "Updated issue should be in JSONL file");
      assert.strictEqual(updatedIssue.status, updates.status);
      assert.strictEqual(updatedIssue.priority, updates.priority);
      assert.strictEqual(updatedIssue.title, "Issue to Update"); // Original title preserved

      // Verify markdown file was updated
      const issueMdPath = path.join(testDir, "issues", `${issueId}.md`);
      const parsed = parseMarkdownFile(issueMdPath, db, testDir);
      assert.strictEqual(parsed.data.status, updates.status);
      assert.strictEqual(parsed.data.priority, updates.priority);
      assert.strictEqual(parsed.data.title, "Issue to Update");
    });

    it("should remove issue from JSONL after deletion", async () => {
      // Create an issue to delete
      const createResponse = await request(app)
        .post("/api/issues")
        .send({ title: "Issue to Delete" })
        .expect(201);

      const issueId = createResponse.body.data.id;
      await waitForExport();

      // Verify it's in the JSONL file
      let issues = readJSONL(issuesJsonlPath);
      assert.ok(
        issues.find((i) => i.id === issueId),
        "Issue should be in JSONL before deletion"
      );

      // Delete the issue
      await request(app).delete(`/api/issues/${issueId}`).expect(200);

      // Wait for export after deletion
      await waitForExport();

      // Verify it's removed from JSONL file
      issues = readJSONL(issuesJsonlPath);
      assert.ok(
        !issues.find((i) => i.id === issueId),
        "Issue should be removed from JSONL after deletion"
      );
    });

    it("should handle multiple rapid updates with debouncing", async () => {
      // Create an issue
      const createResponse = await request(app)
        .post("/api/issues")
        .send({
          title: "Rapid Update Test",
          priority: 0,
        })
        .expect(201);

      const issueId = createResponse.body.data.id;

      // Make multiple rapid updates (should be batched)
      await request(app)
        .put(`/api/issues/${issueId}`)
        .send({ priority: 1 })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issueId}`)
        .send({ priority: 2 })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issueId}`)
        .send({ status: "in_progress" })
        .expect(200);

      // Wait for debounced export (should only export once)
      await waitForExport();

      // Verify final state is in JSONL
      const issues = readJSONL(issuesJsonlPath);
      const finalIssue = issues.find((i) => i.id === issueId);

      assert.ok(finalIssue, "Issue should be in JSONL");
      assert.strictEqual(finalIssue.priority, 2, "Should have final priority");
      assert.strictEqual(
        finalIssue.status,
        "in_progress",
        "Should have final status"
      );
    });

    it("should handle multiple different issues updated rapidly", async () => {
      // Create three different issues
      const issue1Response = await request(app)
        .post("/api/issues")
        .send({
          title: "Issue 1",
          priority: 0,
        })
        .expect(201);

      const issue2Response = await request(app)
        .post("/api/issues")
        .send({
          title: "Issue 2",
          priority: 0,
        })
        .expect(201);

      const issue3Response = await request(app)
        .post("/api/issues")
        .send({
          title: "Issue 3",
          priority: 0,
        })
        .expect(201);

      const issue1Id = issue1Response.body.data.id;
      const issue2Id = issue2Response.body.data.id;
      const issue3Id = issue3Response.body.data.id;

      // Wait for initial export
      await waitForExport();

      // Update all three issues in rapid succession
      await request(app)
        .put(`/api/issues/${issue1Id}`)
        .send({ priority: 1, status: "in_progress" })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issue2Id}`)
        .send({ priority: 2, status: "blocked" })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issue3Id}`)
        .send({ priority: 3, status: "closed" })
        .expect(200);

      // Wait for debounced export
      await waitForExport();

      // Verify all three issues are correctly updated in JSONL
      const issues = readJSONL(issuesJsonlPath);

      const updatedIssue1 = issues.find((i) => i.id === issue1Id);
      const updatedIssue2 = issues.find((i) => i.id === issue2Id);
      const updatedIssue3 = issues.find((i) => i.id === issue3Id);

      assert.ok(updatedIssue1, "Issue 1 should be in JSONL");
      assert.strictEqual(updatedIssue1.priority, 1, "Issue 1 should have priority 1");
      assert.strictEqual(updatedIssue1.status, "in_progress", "Issue 1 should be in_progress");

      assert.ok(updatedIssue2, "Issue 2 should be in JSONL");
      assert.strictEqual(updatedIssue2.priority, 2, "Issue 2 should have priority 2");
      assert.strictEqual(updatedIssue2.status, "blocked", "Issue 2 should be blocked");

      assert.ok(updatedIssue3, "Issue 3 should be in JSONL");
      assert.strictEqual(updatedIssue3.priority, 3, "Issue 3 should have priority 3");
      assert.strictEqual(updatedIssue3.status, "closed", "Issue 3 should be closed");
    });
  });

  describe("Spec Export", () => {
    it("should export spec to JSONL after creation", async () => {
      // Create a spec via API
      const newSpec = {
        title: "Export Test Spec",
        content: "Testing JSONL export for specs",
        priority: 1,
      };

      const response = await request(app)
        .post("/api/specs")
        .send(newSpec)
        .expect(201);

      assert.strictEqual(response.body.success, true);
      const specId = response.body.data.id;

      // Wait for debounced export to complete
      await waitForExport();

      // Verify JSONL file exists and contains the spec
      assert.ok(fs.existsSync(specsJsonlPath), "specs.jsonl should exist");

      const specs = readJSONL(specsJsonlPath);
      assert.ok(specs.length > 0, "specs.jsonl should not be empty");

      const exportedSpec = specs.find((s) => s.id === specId);
      assert.ok(exportedSpec, "Created spec should be in JSONL file");
      assert.strictEqual(exportedSpec.title, newSpec.title);
      assert.strictEqual(exportedSpec.content, newSpec.content);
      assert.strictEqual(exportedSpec.priority, newSpec.priority);
    });

    it("should update JSONL file after spec update", async () => {
      // Create a spec first
      const createResponse = await request(app)
        .post("/api/specs")
        .send({
          title: "Spec to Update",
          content: "Original content",
          priority: 2,
        })
        .expect(201);

      const specId = createResponse.body.data.id;
      await waitForExport();

      // Update the spec
      const updates = {
        content: "Updated content",
        priority: 3,
      };

      await request(app).put(`/api/specs/${specId}`).send(updates).expect(200);

      // Wait for export after update
      await waitForExport();

      // Verify JSONL file contains updated data
      const specs = readJSONL(specsJsonlPath);
      const updatedSpec = specs.find((s) => s.id === specId);

      assert.ok(updatedSpec, "Updated spec should be in JSONL file");
      assert.strictEqual(updatedSpec.content, updates.content);
      assert.strictEqual(updatedSpec.priority, updates.priority);
      assert.strictEqual(updatedSpec.title, "Spec to Update"); // Original title preserved
    });

    it("should remove spec from JSONL after deletion", async () => {
      // Create a spec to delete
      const createResponse = await request(app)
        .post("/api/specs")
        .send({ title: "Spec to Delete", content: "To be deleted" })
        .expect(201);

      const specId = createResponse.body.data.id;
      await waitForExport();

      // Verify it's in the JSONL file
      let specs = readJSONL(specsJsonlPath);
      assert.ok(
        specs.find((s) => s.id === specId),
        "Spec should be in JSONL before deletion"
      );

      // Delete the spec
      await request(app).delete(`/api/specs/${specId}`).expect(200);

      // Wait for export after deletion
      await waitForExport();

      // Verify it's removed from JSONL file
      specs = readJSONL(specsJsonlPath);
      assert.ok(
        !specs.find((s) => s.id === specId),
        "Spec should be removed from JSONL after deletion"
      );
    });
  });

  describe("Export Debouncing", () => {
    it("should batch multiple operations within debounce window", async () => {
      // Track initial file modification time
      const initialMtime = fs.existsSync(issuesJsonlPath)
        ? fs.statSync(issuesJsonlPath).mtimeMs
        : 0;

      // Create multiple issues rapidly
      const issueIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post("/api/issues")
          .send({ title: `Batch Test Issue ${i}` })
          .expect(201);
        issueIds.push(response.body.data.id);
      }

      // Wait for single debounced export
      await waitForExport();

      // Verify all issues are in the JSONL file
      const issues = readJSONL(issuesJsonlPath);
      for (const id of issueIds) {
        const found = issues.find((i) => i.id === id);
        assert.ok(found, `Issue ${id} should be in JSONL file`);
      }

      // File should have been modified (new mtime)
      const finalMtime = fs.statSync(issuesJsonlPath).mtimeMs;
      assert.ok(
        finalMtime > initialMtime,
        "JSONL file should have been updated"
      );
    });
  });
});
