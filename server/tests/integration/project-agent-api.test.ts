/**
 * Integration tests for Project Agent API endpoints
 *
 * Tests all REST API endpoints for project agent management:
 * - Status endpoint
 * - Start/stop endpoints
 * - Action endpoints (list, approve, reject)
 * - Config endpoints
 * - Events endpoint
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import express, { Express } from "express";
import request from "supertest";
import { createProjectAgentRouter } from "../../src/routes/project-agent.js";
import { createEventBus, destroyEventBus } from "../../src/services/event-bus.js";
import {
  createProjectAgentExecution,
  createProjectAgentAction,
} from "../../src/services/project-agent-db.js";
import { destroyProjectAgentExecutor } from "../../src/services/project-agent-executor.js";
import type { ProjectAgentConfig } from "@sudocode-ai/types";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { initDatabase } from "../../src/services/db.js";

describe("Project Agent API Integration", () => {
  let app: Express;
  let db: Database.Database;
  let tmpDir: string;
  let eventBus: any;
  let mockExecutionService: any;

  beforeAll(() => {
    // Prevent console logs during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    // Create temporary directory for test database
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-agent-api-test-"));
    const dbPath = path.join(tmpDir, "test.db");

    // Initialize database
    db = initDatabase({ path: dbPath });

    // Initialize EventBus
    eventBus = await createEventBus({
      db,
      baseDir: tmpDir,
      debounceDelay: 100,
    });

    // Mock ExecutionService
    mockExecutionService = {
      createExecution: vi.fn().mockResolvedValue({
        id: "exec_test_123",
        status: "running",
      }),
      pauseExecution: vi.fn().mockResolvedValue(undefined),
      resumeExecution: vi.fn().mockResolvedValue(undefined),
    };

    // Create Express app with project agent router
    app = express();
    app.use(express.json());
    app.use("/api/project-agent", createProjectAgentRouter(db, tmpDir, mockExecutionService));
  });

  afterEach(async () => {
    // Cleanup
    try {
      await destroyProjectAgentExecutor();
    } catch {
      // Ignore if not initialized
    }

    if (eventBus) {
      await destroyEventBus();
    }
    if (db) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("GET /api/project-agent/status", () => {
    it("should return stopped status when no agent is running", async () => {
      const response = await request(app).get("/api/project-agent/status");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("stopped");
      expect(response.body.data.execution_id).toBeNull();
    });

    it("should return running status when agent is running", async () => {
      // Start agent first
      await request(app)
        .post("/api/project-agent/start")
        .send({
          config: {
            mode: "monitoring",
            autoApprove: { enabled: false, allowedActions: [] },
            monitoring: { watchExecutions: true, checkInterval: 60000 },
          },
        });

      const response = await request(app).get("/api/project-agent/status");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("running");
      expect(response.body.data.execution_id).toBeDefined();
      expect(response.body.data.mode).toBe("monitoring");
      expect(response.body.data.uptime_seconds).toBeGreaterThanOrEqual(0);
    });

    it("should include activity metrics when running", async () => {
      await request(app)
        .post("/api/project-agent/start")
        .send({
          config: {
            mode: "monitoring",
            autoApprove: { enabled: false, allowedActions: [] },
          },
        });

      const response = await request(app).get("/api/project-agent/status");

      expect(response.body.data.activity).toBeDefined();
      expect(response.body.data.activity.events_processed).toBeDefined();
      expect(response.body.data.activity.actions_proposed).toBeDefined();
      expect(response.body.data.activity.actions_approved).toBeDefined();
    });
  });

  describe("POST /api/project-agent/start", () => {
    it("should start project agent successfully", async () => {
      const response = await request(app)
        .post("/api/project-agent/start")
        .send({
          config: {
            mode: "monitoring",
            autoApprove: { enabled: false, allowedActions: [] },
            monitoring: { watchExecutions: true, checkInterval: 60000 },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.execution_id).toBeDefined();
      expect(response.body.data.status).toBe("running");
      expect(response.body.data.mode).toBe("monitoring");
    });

    it("should reject start when agent is already running", async () => {
      // Start first agent
      await request(app)
        .post("/api/project-agent/start")
        .send({
          config: { mode: "monitoring" },
        });

      // Try to start second agent
      const response = await request(app)
        .post("/api/project-agent/start")
        .send({
          config: { mode: "monitoring" },
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("already running");
    });

    it("should use default config values when not provided", async () => {
      const response = await request(app)
        .post("/api/project-agent/start")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.mode).toBe("monitoring");
    });
  });

  describe("POST /api/project-agent/stop", () => {
    it("should stop running project agent", async () => {
      // Start agent first
      await request(app)
        .post("/api/project-agent/start")
        .send({ config: { mode: "monitoring" } });

      // Stop agent
      const response = await request(app).post("/api/project-agent/stop");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("stopped");
    });

    it("should reject stop when no agent is running", async () => {
      const response = await request(app).post("/api/project-agent/stop");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("not currently running");
    });
  });

  describe("GET /api/project-agent/config", () => {
    it("should return current config when agent is running", async () => {
      await request(app)
        .post("/api/project-agent/start")
        .send({
          config: {
            mode: "monitoring",
            autoApprove: { enabled: true, allowedActions: ["create_relationship"] },
            monitoring: { watchExecutions: true, checkInterval: 60000 },
          },
        });

      const response = await request(app).get("/api/project-agent/config");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.mode).toBe("monitoring");
      expect(response.body.data.autoApprove.enabled).toBe(true);
      expect(response.body.data.autoApprove.allowedActions).toContain("create_relationship");
    });

    it("should return 404 when no agent is running", async () => {
      const response = await request(app).get("/api/project-agent/config");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/project-agent/actions", () => {
    it("should list all actions", async () => {
      // Create test execution
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      // Create test actions
      createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "modify_spec",
        status: "proposed",
        payload: { spec_id: "spec_1" },
        justification: "Test action 1",
      });

      createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "create_relationship",
        status: "completed",
        payload: { from_id: "issue_1", to_id: "spec_1" },
        justification: "Test action 2",
      });

      const response = await request(app).get("/api/project-agent/actions");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.actions).toHaveLength(2);
      expect(response.body.data.total).toBe(2);
    });

    it("should filter actions by status", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "modify_spec",
        status: "proposed",
        payload: {},
        justification: "Proposed action",
      });

      createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "create_relationship",
        status: "completed",
        payload: {},
        justification: "Completed action",
      });

      const response = await request(app)
        .get("/api/project-agent/actions")
        .query({ status: "proposed" });

      expect(response.status).toBe(200);
      expect(response.body.data.actions).toHaveLength(1);
      expect(response.body.data.actions[0].status).toBe("proposed");
    });

    it("should limit number of returned actions", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      // Create 5 actions
      for (let i = 0; i < 5; i++) {
        createProjectAgentAction(db, {
          projectAgentExecutionId: execution.id,
          actionType: "modify_spec",
          status: "proposed",
          payload: {},
          justification: `Action ${i}`,
        });
      }

      const response = await request(app)
        .get("/api/project-agent/actions")
        .query({ limit: 3 });

      expect(response.status).toBe(200);
      expect(response.body.data.actions).toHaveLength(3);
    });
  });

  describe("GET /api/project-agent/actions/:id", () => {
    it("should get action by ID", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      const action = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "modify_spec",
        status: "proposed",
        payload: { spec_id: "spec_123" },
        justification: "Test action",
      });

      const response = await request(app).get(`/api/project-agent/actions/${action.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(action.id);
      expect(response.body.data.action_type).toBe("modify_spec");
      expect(response.body.data.status).toBe("proposed");
    });

    it("should return 404 for nonexistent action", async () => {
      const response = await request(app).get("/api/project-agent/actions/nonexistent");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/project-agent/actions/:id/approve", () => {
    it("should approve a proposed action", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      const action = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "create_relationship",
        status: "proposed",
        payload: { from_id: "issue_1", to_id: "spec_1", type: "implements" },
        justification: "Test approval",
      });

      const response = await request(app).post(`/api/project-agent/actions/${action.id}/approve`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toMatch(/approved|executing|completed/);
    });

    it("should return 404 for nonexistent action", async () => {
      const response = await request(app).post("/api/project-agent/actions/nonexistent/approve");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/project-agent/actions/:id/reject", () => {
    it("should reject a proposed action", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      const action = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "modify_spec",
        status: "proposed",
        payload: { spec_id: "spec_123" },
        justification: "Test rejection",
      });

      const response = await request(app)
        .post(`/api/project-agent/actions/${action.id}/reject`)
        .send({ reason: "Not needed" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("rejected");
    });

    it("should use default reason when not provided", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      const action = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: "modify_spec",
        status: "proposed",
        payload: {},
        justification: "Test",
      });

      const response = await request(app)
        .post(`/api/project-agent/actions/${action.id}/reject`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("rejected");
    });

    it("should return 404 for nonexistent action", async () => {
      const response = await request(app)
        .post("/api/project-agent/actions/nonexistent/reject")
        .send({ reason: "Test" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/project-agent/events", () => {
    it("should list project agent events", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      // Create some event records
      db.prepare(
        `INSERT INTO project_agent_events
         (project_agent_execution_id, event_type, entity_type, entity_id)
         VALUES (?, ?, ?, ?)`
      ).run(execution.id, "issue:status_changed", "issue", "issue_123");

      db.prepare(
        `INSERT INTO project_agent_events
         (project_agent_execution_id, event_type, entity_type, entity_id)
         VALUES (?, ?, ?, ?)`
      ).run(execution.id, "spec:created", "spec", "spec_456");

      const response = await request(app).get("/api/project-agent/events");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.events.length).toBeGreaterThanOrEqual(2);
    });

    it("should limit number of returned events", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };
      const execution = createProjectAgentExecution(db, {
        mode: "monitoring",
        config,
        worktreePath: null,
      });

      // Create 5 events
      for (let i = 0; i < 5; i++) {
        db.prepare(
          `INSERT INTO project_agent_events
           (project_agent_execution_id, event_type, entity_type, entity_id)
           VALUES (?, ?, ?, ?)`
        ).run(execution.id, "issue:created", "issue", `issue_${i}`);
      }

      const response = await request(app)
        .get("/api/project-agent/events")
        .query({ limit: 3 });

      expect(response.status).toBe(200);
      expect(response.body.data.events).toHaveLength(3);
    });
  });
});
