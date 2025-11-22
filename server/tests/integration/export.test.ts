/**
 * Integration tests for JSONL export functionality
 * Verifies that database updates trigger exports to JSONL files
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { cleanupExport } from "../../src/services/export.js";
import { parseMarkdownFile } from "@sudocode-ai/cli/dist/markdown.js";
import { ProjectManager } from "../../src/services/project-manager.js";
import { ProjectRegistry } from "../../src/services/project-registry.js";
import { requireProject } from "../../src/middleware/project-context.js";
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
  let testDir: string;
  let testProjectPath: string;
  let issuesJsonlPath: string;
  let specsJsonlPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;

  beforeAll(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-export-"));

    // Create test project directory structure
    testProjectPath = path.join(testDir, "test-project");
    const sudocodeDir = path.join(testProjectPath, ".sudocode");
    fs.mkdirSync(sudocodeDir, { recursive: true });

    issuesJsonlPath = path.join(sudocodeDir, "issues.jsonl");
    specsJsonlPath = path.join(sudocodeDir, "specs.jsonl");

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
  });

  afterAll(async () => {
    // Clean up export debouncer first
    cleanupExport();
    // Shutdown project manager
    await projectManager.shutdown();
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
        .post("/api/issues").set("X-Project-ID", projectId)
        .set("X-Project-ID", projectId)
        .send(newIssue)
        .expect(201);

      expect(response.body.success).toBe(true);
      const issueId = response.body.data.id;

      // Wait for debounced export to complete
      await waitForExport();

      // Verify JSONL file exists and contains the issue
      expect(fs.existsSync(issuesJsonlPath)).toBeTruthy();

      const issues = readJSONL(issuesJsonlPath);
      expect(
        issues.length > 0,
        "issues.jsonl should not be empty"
      ).toBeTruthy();

      const exportedIssue = issues.find((i) => i.id === issueId);
      expect(
        exportedIssue,
        "Created issue should be in JSONL file"
      ).toBeTruthy();
      expect(exportedIssue.title).toBe(newIssue.title);
      expect(exportedIssue.status).toBe(newIssue.status);
      expect(exportedIssue.priority).toBe(newIssue.priority);

      // Verify markdown file was created
      const issueMdPath = path.join(testProjectPath, ".sudocode", "issues", `${issueId}.md`);
      expect(fs.existsSync(issueMdPath)).toBeTruthy();

      // Verify markdown file content
      const project = projectManager.getProject(projectId)!;
      const parsed = parseMarkdownFile(issueMdPath, project.db, testProjectPath);
      expect(parsed.data.id).toBe(issueId);
      expect(parsed.data.title).toBe(newIssue.title);
      expect(parsed.data.status).toBe(newIssue.status);
      expect(parsed.data.priority).toBe(newIssue.priority);
    });

    it("should update JSONL and Markdown after issue update", async () => {
      // Create an issue first
      const createResponse = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
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
        .put(`/api/issues/${issueId}`).set("X-Project-ID", projectId)
        .send(updates)
        .expect(200);

      // Wait for export after update
      await waitForExport();

      // Verify JSONL file contains updated data
      const issues = readJSONL(issuesJsonlPath);
      const updatedIssue = issues.find((i) => i.id === issueId);

      expect(
        updatedIssue,
        "Updated issue should be in JSONL file"
      ).toBeTruthy();
      expect(updatedIssue.status).toBe(updates.status);
      expect(updatedIssue.priority).toBe(updates.priority);
      expect(updatedIssue.title).toBe("Issue to Update"); // Original title preserved

      // Verify markdown file was updated
      const issueMdPath = path.join(testProjectPath, ".sudocode", "issues", `${issueId}.md`);
      const project = projectManager.getProject(projectId)!;
      const parsed = parseMarkdownFile(issueMdPath, project.db, testProjectPath);
      expect(parsed.data.status).toBe(updates.status);
      expect(parsed.data.priority).toBe(updates.priority);
      expect(parsed.data.title).toBe("Issue to Update");
    });

    it("should remove issue from JSONL after deletion", async () => {
      // Create an issue to delete
      const createResponse = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
        .send({ title: "Issue to Delete" })
        .expect(201);

      const issueId = createResponse.body.data.id;
      await waitForExport();

      // Verify it's in the JSONL file
      let issues = readJSONL(issuesJsonlPath);
      expect(issues.find((i) => i.id === issueId)).toBeTruthy();

      // Delete the issue
      await request(app).delete(`/api/issues/${issueId}`).set("X-Project-ID", projectId).expect(200);

      // Wait for export after deletion
      await waitForExport();

      // Verify it's removed from JSONL file
      issues = readJSONL(issuesJsonlPath);
      expect(!issues.find((i) => i.id === issueId)).toBeTruthy();
    });

    it("should handle multiple rapid updates with debouncing", async () => {
      // Create an issue
      const createResponse = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
        .send({
          title: "Rapid Update Test",
          priority: 0,
        })
        .expect(201);

      const issueId = createResponse.body.data.id;

      // Make multiple rapid updates (should be batched)
      await request(app)
        .put(`/api/issues/${issueId}`).set("X-Project-ID", projectId)
        .send({ priority: 1 })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issueId}`).set("X-Project-ID", projectId)
        .send({ priority: 2 })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issueId}`).set("X-Project-ID", projectId)
        .send({ status: "in_progress" })
        .expect(200);

      // Wait for debounced export (should only export once)
      await waitForExport();

      // Verify final state is in JSONL
      const issues = readJSONL(issuesJsonlPath);
      const finalIssue = issues.find((i) => i.id === issueId);

      expect(finalIssue, "Issue should be in JSONL").toBeTruthy();
      expect(finalIssue.priority, "Should have final priority").toBe(2);
      expect(finalIssue.status, "Should have final status").toBe("in_progress");
    });

    it("should handle multiple different issues updated rapidly", async () => {
      // Create three different issues
      const issue1Response = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
        .send({
          title: "Issue 1",
          priority: 0,
        })
        .expect(201);

      const issue2Response = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
        .send({
          title: "Issue 2",
          priority: 0,
        })
        .expect(201);

      const issue3Response = await request(app)
        .post("/api/issues").set("X-Project-ID", projectId)
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
        .put(`/api/issues/${issue1Id}`).set("X-Project-ID", projectId)
        .send({ priority: 1, status: "in_progress" })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issue2Id}`).set("X-Project-ID", projectId)
        .send({ priority: 2, status: "blocked" })
        .expect(200);

      await request(app)
        .put(`/api/issues/${issue3Id}`).set("X-Project-ID", projectId)
        .send({ priority: 3, status: "closed" })
        .expect(200);

      // Wait for debounced export
      await waitForExport();

      // Verify all three issues are correctly updated in JSONL
      const issues = readJSONL(issuesJsonlPath);

      const updatedIssue1 = issues.find((i) => i.id === issue1Id);
      const updatedIssue2 = issues.find((i) => i.id === issue2Id);
      const updatedIssue3 = issues.find((i) => i.id === issue3Id);

      expect(updatedIssue1, "Issue 1 should be in JSONL").toBeTruthy();
      expect(updatedIssue1.priority, "Issue 1 should have priority 1").toBe(1);
      expect(updatedIssue1.status, "Issue 1 should be in_progress").toBe(
        "in_progress"
      );

      expect(updatedIssue2, "Issue 2 should be in JSONL").toBeTruthy();
      expect(updatedIssue2.priority, "Issue 2 should have priority 2").toBe(2);
      expect(updatedIssue2.status, "Issue 2 should be blocked").toBe("blocked");

      expect(updatedIssue3, "Issue 3 should be in JSONL").toBeTruthy();
      expect(updatedIssue3.priority, "Issue 3 should have priority 3").toBe(3);
      expect(updatedIssue3.status, "Issue 3 should be closed").toBe("closed");
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
        .post("/api/specs").set("X-Project-ID", projectId)
        .send(newSpec)
        .expect(201);

      expect(response.body.success).toBe(true);
      const specId = response.body.data.id;

      // Wait for debounced export to complete
      await waitForExport();

      // Verify JSONL file exists and contains the spec
      expect(fs.existsSync(specsJsonlPath)).toBeTruthy();

      const specs = readJSONL(specsJsonlPath);
      expect(specs.length > 0, "specs.jsonl should not be empty").toBeTruthy();

      const exportedSpec = specs.find((s) => s.id === specId);
      expect(exportedSpec, "Created spec should be in JSONL file").toBeTruthy();
      expect(exportedSpec.title).toBe(newSpec.title);
      expect(exportedSpec.content).toBe(newSpec.content);
      expect(exportedSpec.priority).toBe(newSpec.priority);
    });

    it("should update JSONL file after spec update", async () => {
      // Create a spec first
      const createResponse = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
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

      await request(app).put(`/api/specs/${specId}`).set("X-Project-ID", projectId).send(updates).expect(200);

      // Wait for export after update
      await waitForExport();

      // Verify JSONL file contains updated data
      const specs = readJSONL(specsJsonlPath);
      const updatedSpec = specs.find((s) => s.id === specId);

      expect(updatedSpec, "Updated spec should be in JSONL file").toBeTruthy();
      expect(updatedSpec.content).toBe(updates.content);
      expect(updatedSpec.priority).toBe(updates.priority);
      expect(updatedSpec.title).toBe("Spec to Update"); // Original title preserved
    });

    it("should remove spec from JSONL after deletion", async () => {
      // Create a spec to delete
      const createResponse = await request(app)
        .post("/api/specs").set("X-Project-ID", projectId)
        .send({ title: "Spec to Delete", content: "To be deleted" })
        .expect(201);

      const specId = createResponse.body.data.id;
      await waitForExport();

      // Verify it's in the JSONL file
      let specs = readJSONL(specsJsonlPath);
      expect(specs.find((s) => s.id === specId)).toBeTruthy();

      // Delete the spec
      await request(app).delete(`/api/specs/${specId}`).set("X-Project-ID", projectId).expect(200);

      // Wait for export after deletion
      await waitForExport();

      // Verify it's removed from JSONL file
      specs = readJSONL(specsJsonlPath);
      expect(!specs.find((s) => s.id === specId)).toBeTruthy();
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
          .post("/api/issues").set("X-Project-ID", projectId)
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
        expect(found, `Issue ${id} should be in JSONL file`).toBeTruthy();
      }

      // File should have been modified (new mtime)
      const finalMtime = fs.statSync(issuesJsonlPath).mtimeMs;
      expect(
        finalMtime > initialMtime,
        "JSONL file should have been updated"
      ).toBeTruthy();
    });
  });
});
