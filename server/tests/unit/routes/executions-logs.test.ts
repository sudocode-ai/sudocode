/**
 * Execution Logs Routes Tests
 *
 * Tests for the GET /executions/:executionId/logs endpoint
 *
 * @module routes/tests/executions-logs
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";
import { ProjectManager } from "../../../src/services/project-manager.js";
import { ProjectRegistry } from "../../../src/services/project-registry.js";
import { requireProject } from "../../../src/middleware/project-context.js";
import {
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  EXECUTION_LOGS_INDEXES,
} from "@sudocode-ai/types/schema";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Execution Logs Routes", () => {
  let app: Express;
  let testDir: string;
  let testProjectPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;

  beforeEach(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-exec-logs-"));

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
      const project = projectManager.getProject(projectId)!;

      // Set up schema for executions
      project.db.exec("PRAGMA foreign_keys = OFF");
      project.db.exec(EXECUTIONS_TABLE);
      project.db.exec(EXECUTION_LOGS_TABLE);
      project.db.exec(EXECUTION_LOGS_INDEXES);

      // Create test execution
      project.db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "exec-test-1",
        "claude-code",
        "main",
        "test-branch",
        "completed",
        new Date().toISOString(),
        new Date().toISOString()
      );
    } else {
      throw new Error("Failed to open test project");
    }

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api", requireProject(projectManager), createExecutionsRouter());
  });

  afterEach(async () => {
    await projectManager.shutdown();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("GET /api/executions/:executionId/logs", () => {
    it("should return 404 for non-existent execution", async () => {
      const response = await request(app)
        .get("/api/executions/non-existent/logs")
        .set("X-Project-ID", projectId)
        .expect(404)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("should return empty logs for execution without logs", async () => {
      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.executionId).toBe("exec-test-1");
      expect(response.body.data.logs).toEqual([]);
      expect(response.body.data.metadata.lineCount).toBe(0);
      expect(response.body.data.metadata.byteSize).toBe(0);
    });

    it("should return logs when they exist", async () => {
      // Add some test logs
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");
      project.logsStore.appendRawLog(
        "exec-test-1",
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}'
      );
      project.logsStore.appendRawLog(
        "exec-test-1",
        '{"type":"result","usage":{"input_tokens":10}}'
      );

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.executionId).toBe("exec-test-1");
      expect(response.body.data.logs).toHaveLength(2);
      expect(response.body.data.logs[0]).toContain("assistant");
      expect(response.body.data.logs[1]).toContain("result");
      expect(response.body.data.metadata.lineCount).toBe(2);
      expect(response.body.data.metadata.byteSize).toBeGreaterThan(0);
    });

    it("should return proper metadata structure", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");
      project.logsStore.appendRawLog("exec-test-1", '{"type":"test"}');

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.data.metadata).toHaveProperty("lineCount");
      expect(response.body.data.metadata).toHaveProperty("byteSize");
      expect(response.body.data.metadata).toHaveProperty("createdAt");
      expect(response.body.data.metadata).toHaveProperty("updatedAt");
    });

    it("should handle large number of logs", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      // Add 100 log lines
      const lines = Array.from({ length: 100 }, (_, i) =>
        JSON.stringify({ type: "test", index: i })
      );
      project.logsStore.appendRawLogs("exec-test-1", lines);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.data.logs).toHaveLength(100);
      expect(response.body.data.metadata.lineCount).toBe(100);
    });

    it("should return valid JSON for all logs", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");
      project.logsStore.appendRawLogs("exec-test-1", [
        '{"type":"assistant","message":{}}',
        '{"type":"tool_result","result":{}}',
        '{"type":"result","usage":{"input_tokens":100}}',
      ]);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      // Verify each log line is valid JSON
      response.body.data.logs.forEach((log: string) => {
        expect(() => JSON.parse(log)).not.toThrow();
      });
    });

    it("should handle UTF-8 characters in logs", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");
      project.logsStore.appendRawLog(
        "exec-test-1",
        '{"text":"Hello 世界 🌍"}'
      );

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.data.logs[0]).toContain("世界");
      expect(response.body.data.logs[0]).toContain("🌍");
    });

    it("should handle execution with metadata but no logs initialized", async () => {
      // Execution exists but no logs entry created yet
      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.logs).toEqual([]);
      // Should fallback to execution timestamps
      expect(response.body.data.metadata.createdAt).toBeDefined();
      expect(response.body.data.metadata.updatedAt).toBeDefined();
    });

    it("should return correct byte size for multi-byte characters", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");
      const logLine = '{"text":"Hello 世界"}';
      project.logsStore.appendRawLog("exec-test-1", logLine);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      // byte_size should account for UTF-8 encoding
      const expectedSize = Buffer.byteLength(logLine) + 1; // +1 for newline
      expect(response.body.data.metadata.byteSize).toBe(expectedSize);
    });

    it("should handle multiple executions independently", async () => {
      // Create second execution
      const project = projectManager.getProject(projectId)!;
      project.db.prepare(`
        INSERT INTO executions (id, agent_type, target_branch, branch_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "exec-test-2",
        "claude-code",
        "main",
        "test-branch-2",
        "running",
        new Date().toISOString(),
        new Date().toISOString()
      );

      project.logsStore.initializeLogs("exec-test-1");
      project.logsStore.appendRawLog("exec-test-1", '{"execution":1}');

      project.logsStore.initializeLogs("exec-test-2");
      project.logsStore.appendRawLog("exec-test-2", '{"execution":2}');

      const response1 = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      const response2 = await request(app)
        .get("/api/executions/exec-test-2/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response1.body.data.logs[0]).toContain('"execution":1');
      expect(response2.body.data.logs[0]).toContain('"execution":2');
    });

    it("should return 500 for database errors", async () => {
      // Close database to simulate error
      const project = projectManager.getProject(projectId)!;
      project.db.close();

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(500)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Failed");
    });

    it("should handle special characters in execution ID", async () => {
      // Test with execution ID that might cause issues
      const response = await request(app)
        .get("/api/executions/exec-with-dashes-123/logs")
        .set("X-Project-ID", projectId)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it("should preserve log order", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");
      const orderedLogs = [
        '{"order":1}',
        '{"order":2}',
        '{"order":3}',
        '{"order":4}',
        '{"order":5}',
      ];
      project.logsStore.appendRawLogs("exec-test-1", orderedLogs);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      // Verify order is preserved
      response.body.data.logs.forEach((log: string, index: number) => {
        const parsed = JSON.parse(log);
        expect(parsed.order).toBe(index + 1);
      });
    });
  });
});
