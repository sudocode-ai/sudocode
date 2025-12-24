/**
 * Refresh API Integration Tests
 *
 * Tests the refresh endpoints for specs and issues:
 * - POST /api/specs/:id/refresh_from_external
 * - POST /api/issues/:id/refresh_from_external
 * - POST /api/import/refresh (bulk)
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type Database from "better-sqlite3";

// Server components
import { createIssuesRouter } from "../../src/routes/issues.js";
import { createSpecsRouter } from "../../src/routes/specs.js";
import { createImportRouter } from "../../src/routes/import.js";
import { cleanupExport, triggerExport } from "../../src/services/export.js";
import { ProjectManager } from "../../src/services/project-manager.js";
import { ProjectRegistry } from "../../src/services/project-registry.js";
import { requireProject } from "../../src/middleware/project-context.js";
import { computeContentHash } from "../../src/services/external-refresh-service.js";

// CLI components
import { writeJSONLSync, readJSONLSync } from "@sudocode-ai/cli/dist/jsonl.js";

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

// Helper to write JSONL file
function writeJSONL(filePath: string, items: any[]): void {
  const content = items.map((item) => JSON.stringify(item)).join("\n") + "\n";
  fs.writeFileSync(filePath, content);
}

// Helper to wait for operations
const shortWait = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("Refresh API Integration Tests", () => {
  let app: express.Application;
  let testDir: string;
  let testProjectPath: string;
  let sudocodeDir: string;
  let issuesJsonlPath: string;
  let specsJsonlPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let db: Database.Database;

  beforeAll(async () => {
    // Create a unique temporary directory
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-refresh-api-")
    );

    // Create test project directory structure
    testProjectPath = path.join(testDir, "test-project");
    sudocodeDir = path.join(testProjectPath, ".sudocode");
    fs.mkdirSync(sudocodeDir, { recursive: true });

    issuesJsonlPath = path.join(sudocodeDir, "issues.jsonl");
    specsJsonlPath = path.join(sudocodeDir, "specs.jsonl");

    // Create config.json
    const configPath = path.join(sudocodeDir, "config.json");
    const config = {
      version: "1.0.0",
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create directories for markdown files
    fs.mkdirSync(path.join(sudocodeDir, "issues"), { recursive: true });
    fs.mkdirSync(path.join(sudocodeDir, "specs"), { recursive: true });

    // Initialize empty JSONL files
    fs.writeFileSync(issuesJsonlPath, "");
    fs.writeFileSync(specsJsonlPath, "");

    // Create database file placeholder
    fs.writeFileSync(path.join(sudocodeDir, "cache.db"), "");

    // Set up project manager (without file watcher for controlled testing)
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
      db = result.value.db;
    } else {
      throw new Error("Failed to open test project");
    }

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use(
      "/api/issues",
      requireProject(projectManager),
      createIssuesRouter()
    );
    app.use("/api/specs", requireProject(projectManager), createSpecsRouter());
    app.use(
      "/api/import",
      requireProject(projectManager),
      createImportRouter()
    );
  });

  afterAll(async () => {
    // Cleanup
    cleanupExport();
    await projectManager?.shutdown();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("POST /api/specs/:id/refresh_from_external", () => {
    it("should return 404 for non-existent spec", async () => {
      const response = await request(app)
        .post("/api/specs/s-nonexistent/refresh_from_external")
        .set("X-Project-ID", projectId)
        .send();

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("should return error for spec without external links", async () => {
      // First create a spec via API
      const createResponse = await request(app)
        .post("/api/specs")
        .set("X-Project-ID", projectId)
        .send({
          title: "Test Spec Without Links",
          content: "Test content",
          priority: 2,
        });

      expect(createResponse.status).toBe(201);
      const specId = createResponse.body.data.id;

      // Manually write the spec to JSONL without external_links to simulate
      // an entity that exists but has no external links
      const specs = readJSONL(specsJsonlPath);
      specs.push({
        id: specId,
        uuid: createResponse.body.data.uuid,
        title: "Test Spec Without Links",
        content: "Test content",
        priority: 2,
        file_path: `specs/${specId}.md`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // No external_links
      });
      writeJSONL(specsJsonlPath, specs);

      // Try to refresh - should fail since no external link
      const refreshResponse = await request(app)
        .post(`/api/specs/${specId}/refresh_from_external`)
        .set("X-Project-ID", projectId)
        .send();

      expect(refreshResponse.status).toBe(400);
      expect(refreshResponse.body.success).toBe(false);
      expect(refreshResponse.body.message).toContain("no external links");
    });
  });

  describe("POST /api/issues/:id/refresh_from_external", () => {
    it("should return 404 for non-existent issue", async () => {
      const response = await request(app)
        .post("/api/issues/i-nonexistent/refresh_from_external")
        .set("X-Project-ID", projectId)
        .send();

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("should return error for issue without external links", async () => {
      // First create an issue via API
      const createResponse = await request(app)
        .post("/api/issues")
        .set("X-Project-ID", projectId)
        .send({
          title: "Test Issue Without Links",
          content: "Test content",
          priority: 2,
        });

      expect(createResponse.status).toBe(201);
      const issueId = createResponse.body.data.id;

      // Manually write the issue to JSONL without external_links to simulate
      // an entity that exists but has no external links
      const issues = readJSONL(issuesJsonlPath);
      issues.push({
        id: issueId,
        uuid: createResponse.body.data.uuid,
        title: "Test Issue Without Links",
        content: "Test content",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // No external_links
      });
      writeJSONL(issuesJsonlPath, issues);

      // Try to refresh - should fail since no external link
      const refreshResponse = await request(app)
        .post(`/api/issues/${issueId}/refresh_from_external`)
        .set("X-Project-ID", projectId)
        .send();

      expect(refreshResponse.status).toBe(400);
      expect(refreshResponse.body.success).toBe(false);
      expect(refreshResponse.body.message).toContain("no external links");
    });
  });

  describe("POST /api/import/refresh (bulk)", () => {
    it("should return success for empty entity list", async () => {
      const response = await request(app)
        .post("/api/import/refresh")
        .set("X-Project-ID", projectId)
        .send({
          entityIds: [],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.refreshed).toBe(0);
      expect(response.body.data.skipped).toBe(0);
      expect(response.body.data.failed).toBe(0);
      expect(response.body.data.stale).toBe(0);
    });

    it("should validate entityIds is an array", async () => {
      const response = await request(app)
        .post("/api/import/refresh")
        .set("X-Project-ID", projectId)
        .send({
          entityIds: "not-an-array",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("must be an array");
    });

    it("should validate entityIds contains only strings", async () => {
      const response = await request(app)
        .post("/api/import/refresh")
        .set("X-Project-ID", projectId)
        .send({
          entityIds: [123, "valid-id"],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("only strings");
    });

    it("should validate provider is a string", async () => {
      const response = await request(app)
        .post("/api/import/refresh")
        .set("X-Project-ID", projectId)
        .send({
          provider: 123,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("must be a string");
    });

    it("should accept valid request with no entities to refresh", async () => {
      const response = await request(app)
        .post("/api/import/refresh")
        .set("X-Project-ID", projectId)
        .send({
          provider: "github",
          force: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("refreshed");
      expect(response.body.data).toHaveProperty("skipped");
      expect(response.body.data).toHaveProperty("failed");
      expect(response.body.data).toHaveProperty("stale");
      expect(response.body.data).toHaveProperty("results");
    });
  });

  describe("Change Detection via Content Hash", () => {
    it("should compute consistent content hash", () => {
      const hash1 = computeContentHash("Title", "Content");
      const hash2 = computeContentHash("Title", "Content");
      expect(hash1).toBe(hash2);
    });

    it("should detect different content with different hash", () => {
      const hash1 = computeContentHash("Title", "Content 1");
      const hash2 = computeContentHash("Title", "Content 2");
      expect(hash1).not.toBe(hash2);
    });
  });
});
