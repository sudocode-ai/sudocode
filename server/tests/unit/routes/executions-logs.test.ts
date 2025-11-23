/**
 * Execution Logs Routes Tests
 *
 * Tests for the GET /executions/:executionId/logs endpoint
 * Validates NormalizedEntry storage and on-demand conversion to AG-UI events
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
import type { NormalizedEntry } from "agent-execution-engine/agents";
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

    it("should return empty events for execution without logs", async () => {
      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.executionId).toBe("exec-test-1");
      expect(response.body.data.events).toEqual([]);
      expect(response.body.data.metadata.lineCount).toBe(0);
      expect(response.body.data.metadata.byteSize).toBe(0);
    });

    it("should convert NormalizedEntry to AG-UI events", async () => {
      // Add normalized entries
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      const entry1: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Hello world",
        timestamp: new Date(),
      };

      const entry2: NormalizedEntry = {
        index: 1,
        type: { kind: "thinking", reasoning: "Planning the approach" },
        content: "",
        timestamp: new Date(),
      };

      project.logsStore.appendNormalizedEntry("exec-test-1", entry1);
      project.logsStore.appendNormalizedEntry("exec-test-1", entry2);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.executionId).toBe("exec-test-1");
      expect(response.body.data.events).toBeDefined();
      expect(Array.isArray(response.body.data.events)).toBe(true);

      // Assistant message should create 3 AG-UI events (START, CONTENT, END)
      const textEvents = response.body.data.events.filter((e: any) =>
        e.type === "TEXT_MESSAGE_START" ||
        e.type === "TEXT_MESSAGE_CONTENT" ||
        e.type === "TEXT_MESSAGE_END"
      );
      expect(textEvents.length).toBeGreaterThan(0);

      // Find the content event
      const contentEvent = response.body.data.events.find((e: any) =>
        e.type === "TEXT_MESSAGE_CONTENT" && e.delta === "Hello world"
      );
      expect(contentEvent).toBeDefined();
    });

    it("should convert tool_use entries to AG-UI tool events", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      const toolEntry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "ls -la" },
            status: "success",
            result: {
              success: true,
              data: "file1.txt\nfile2.txt",
            },
          },
        },
        content: "",
        timestamp: new Date(),
      };

      project.logsStore.appendNormalizedEntry("exec-test-1", toolEntry);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.events).toBeDefined();

      // Should have tool-related events
      const toolStartEvent = response.body.data.events.find((e: any) =>
        e.type === "TOOL_CALL_START" && e.toolCallName === "Bash"
      );
      expect(toolStartEvent).toBeDefined();

      const toolEndEvent = response.body.data.events.find((e: any) =>
        e.type === "TOOL_CALL_END"
      );
      expect(toolEndEvent).toBeDefined();

      const toolResultEvent = response.body.data.events.find((e: any) =>
        e.type === "TOOL_CALL_RESULT"
      );
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.content).toBeDefined();
    });

    it("should return proper metadata structure", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Test",
        timestamp: new Date(),
      };
      project.logsStore.appendNormalizedEntry("exec-test-1", entry);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.data.metadata).toHaveProperty("lineCount");
      expect(response.body.data.metadata).toHaveProperty("byteSize");
      expect(response.body.data.metadata).toHaveProperty("createdAt");
      expect(response.body.data.metadata).toHaveProperty("updatedAt");
    });

    it("should handle large number of entries", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      // Add 50 normalized entries
      for (let i = 0; i < 50; i++) {
        const entry: NormalizedEntry = {
          index: i,
          type: { kind: "assistant_message" },
          content: `Message ${i}`,
          timestamp: new Date(),
        };
        project.logsStore.appendNormalizedEntry("exec-test-1", entry);
      }

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.data.events).toBeDefined();
      // Each entry creates 3 AG-UI events (START, CONTENT, END)
      expect(response.body.data.events.length).toBeGreaterThan(50);
    });

    it("should preserve AG-UI event structure", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Test message",
        timestamp: new Date(),
      };
      project.logsStore.appendNormalizedEntry("exec-test-1", entry);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      // Verify AG-UI event structure
      response.body.data.events.forEach((event: any) => {
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("timestamp");
        expect(typeof event.timestamp).toBe("number");
      });
    });

    it("should handle UTF-8 characters in content", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Hello 世界 🌍",
        timestamp: new Date(),
      };
      project.logsStore.appendNormalizedEntry("exec-test-1", entry);

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      const contentEvent = response.body.data.events.find((e: any) =>
        e.type === "TEXT_MESSAGE_CONTENT"
      );
      expect(contentEvent.delta).toContain("世界");
      expect(contentEvent.delta).toContain("🌍");
    });

    it("should handle execution with metadata but no logs initialized", async () => {
      // Execution exists but no logs entry created yet
      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.events).toEqual([]);
      // Should fallback to execution timestamps
      expect(response.body.data.metadata.createdAt).toBeDefined();
      expect(response.body.data.metadata.updatedAt).toBeDefined();
    });

    it("should handle multiple entry types in single execution", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      // Add different entry types
      const entries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: "assistant_message" },
          content: "Starting task",
          timestamp: new Date(),
        },
        {
          index: 1,
          type: { kind: "thinking", reasoning: "Planning approach" },
          content: "",
          timestamp: new Date(),
        },
        {
          index: 2,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Read",
              action: { kind: "read_file", path: "test.ts" },
              status: "success",
              result: { success: true, data: "file content" },
            },
          },
          content: "",
          timestamp: new Date(),
        },
      ];

      entries.forEach((entry) =>
        project.logsStore.appendNormalizedEntry("exec-test-1", entry)
      );

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      expect(response.body.data.events.length).toBeGreaterThan(0);

      // Should have text messages
      const hasTextMessage = response.body.data.events.some((e: any) =>
        e.type === "TEXT_MESSAGE_CONTENT"
      );
      expect(hasTextMessage).toBe(true);

      // Should have tool calls
      const hasToolCall = response.body.data.events.some((e: any) =>
        e.type === "TOOL_CALL_START"
      );
      expect(hasToolCall).toBe(true);
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
      const entry1: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Execution 1",
        timestamp: new Date(),
      };
      project.logsStore.appendNormalizedEntry("exec-test-1", entry1);

      project.logsStore.initializeLogs("exec-test-2");
      const entry2: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Execution 2",
        timestamp: new Date(),
      };
      project.logsStore.appendNormalizedEntry("exec-test-2", entry2);

      const response1 = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      const response2 = await request(app)
        .get("/api/executions/exec-test-2/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      const content1 = response1.body.data.events.find((e: any) =>
        e.type === "TEXT_MESSAGE_CONTENT"
      );
      const content2 = response2.body.data.events.find((e: any) =>
        e.type === "TEXT_MESSAGE_CONTENT"
      );

      expect(content1.delta).toContain("Execution 1");
      expect(content2.delta).toContain("Execution 2");
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

    it("should preserve entry order in AG-UI events", async () => {
      const project = projectManager.getProject(projectId)!;
      project.logsStore.initializeLogs("exec-test-1");

      // Add entries in order
      for (let i = 0; i < 5; i++) {
        const entry: NormalizedEntry = {
          index: i,
          type: { kind: "assistant_message" },
          content: `Message ${i + 1}`,
          timestamp: new Date(),
        };
        project.logsStore.appendNormalizedEntry("exec-test-1", entry);
      }

      const response = await request(app)
        .get("/api/executions/exec-test-1/logs")
        .set("X-Project-ID", projectId)
        .expect(200);

      // Extract content events in order
      const contentEvents = response.body.data.events.filter((e: any) =>
        e.type === "TEXT_MESSAGE_CONTENT"
      );

      // Verify order is preserved
      contentEvents.forEach((event: any, index: number) => {
        expect(event.delta).toBe(`Message ${index + 1}`);
      });
    });
  });
});
