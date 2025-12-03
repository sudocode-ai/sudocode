/**
 * Unit tests for Workflow Escalation API Endpoints
 *
 * Tests:
 * - GET /api/workflows/:id/escalation - Get pending escalation
 * - POST /api/workflows/:id/escalation/respond - Respond to escalation
 *
 * Escalations are stored as workflow events, not as workflow fields.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import Database from "better-sqlite3";
import {
  WORKFLOWS_TABLE,
  WORKFLOW_EVENTS_TABLE,
} from "@sudocode-ai/types/schema";
import { createWorkflowsRouter } from "../../../src/routes/workflows.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("Workflow Escalation API", () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(":memory:");

    // Set up schema
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(WORKFLOWS_TABLE);
    db.exec(WORKFLOW_EVENTS_TABLE);

    // Create Express app with mock project middleware
    app = express();
    app.use(express.json());

    // Mock project middleware
    app.use((req, _res, next) => {
      (req as any).project = {
        id: "test-project",
        db,
        workflowEngine: null, // No engine for unit tests
      };
      next();
    });

    // Mount router
    app.use("/api/workflows", createWorkflowsRouter());
  });

  afterEach(() => {
    db.close();
  });

  // ===========================================================================
  // Test Data Helpers
  // ===========================================================================

  function insertTestWorkflow(overrides: Record<string, unknown> = {}) {
    const defaults = {
      id: "wf-test1",
      title: "Test Workflow",
      source: JSON.stringify({ type: "issues", issueIds: ["i-1"] }),
      status: "running",
      steps: JSON.stringify([]),
      base_branch: "main",
      current_step_index: 0,
      config: JSON.stringify({
        parallelism: "sequential",
        onFailure: "pause",
        defaultAgentType: "claude-code",
        autonomyLevel: "human_in_loop",
      }),
    };

    const data = { ...defaults, ...overrides };
    db.prepare(`
      INSERT INTO workflows (
        id, title, source, status, steps, base_branch,
        current_step_index, config
      ) VALUES (
        @id, @title, @source, @status, @steps, @base_branch,
        @current_step_index, @config
      )
    `).run(data);
  }

  function insertEscalationRequestedEvent(
    workflowId: string,
    escalationId: string,
    message: string
  ) {
    db.prepare(`
      INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
      VALUES (?, ?, 'escalation_requested', ?, ?)
    `).run(
      `event-${escalationId}`,
      workflowId,
      JSON.stringify({
        escalation_id: escalationId,
        message,
      }),
      new Date().toISOString()
    );
  }

  function insertEscalationResolvedEvent(
    workflowId: string,
    escalationId: string
  ) {
    db.prepare(`
      INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
      VALUES (?, ?, 'escalation_resolved', ?, ?)
    `).run(
      `resolved-${escalationId}`,
      workflowId,
      JSON.stringify({
        escalation_id: escalationId,
        action: "approve",
      }),
      new Date().toISOString()
    );
  }

  function getEscalationEvents(workflowId: string) {
    return db
      .prepare(
        `SELECT type, payload FROM workflow_events
         WHERE workflow_id = ? AND type = 'escalation_resolved'
         ORDER BY created_at ASC`
      )
      .all(workflowId) as Array<{ type: string; payload: string }>;
  }

  // ===========================================================================
  // GET /api/workflows/:id/escalation Tests
  // ===========================================================================

  describe("GET /api/workflows/:id/escalation", () => {
    it("should return hasPendingEscalation: false when no pending escalation", async () => {
      insertTestWorkflow();

      const response = await request(app).get(
        "/api/workflows/wf-test1/escalation"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.hasPendingEscalation).toBe(false);
      expect(response.body.data.escalation).toBeUndefined();
    });

    it("should return escalation data when pending escalation exists", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent(
        "wf-test1",
        "esc-123",
        "Should we proceed with this approach?"
      );

      const response = await request(app).get(
        "/api/workflows/wf-test1/escalation"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.hasPendingEscalation).toBe(true);
      expect(response.body.data.escalation).toBeDefined();
      expect(response.body.data.escalation.requestId).toBe("esc-123");
      expect(response.body.data.escalation.message).toBe(
        "Should we proceed with this approach?"
      );
    });

    it("should return escalation with options", async () => {
      insertTestWorkflow();

      // Insert escalation with options
      db.prepare(
        `
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, 'escalation_requested', ?, ?)
      `
      ).run(
        "event-esc-options",
        "wf-test1",
        JSON.stringify({
          escalation_id: "esc-options",
          message: "Which option?",
          options: ["Option A", "Option B", "Option C"],
        }),
        new Date().toISOString()
      );

      const response = await request(app).get(
        "/api/workflows/wf-test1/escalation"
      );

      expect(response.status).toBe(200);
      expect(response.body.data.escalation.options).toEqual([
        "Option A",
        "Option B",
        "Option C",
      ]);
    });

    it("should return escalation with context", async () => {
      insertTestWorkflow();

      // Insert escalation with context
      db.prepare(
        `
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, 'escalation_requested', ?, ?)
      `
      ).run(
        "event-esc-context",
        "wf-test1",
        JSON.stringify({
          escalation_id: "esc-context",
          message: "Encountered an issue",
          context: { errorType: "timeout", stepId: "step-123" },
        }),
        new Date().toISOString()
      );

      const response = await request(app).get(
        "/api/workflows/wf-test1/escalation"
      );

      expect(response.status).toBe(200);
      expect(response.body.data.escalation.context).toEqual({
        errorType: "timeout",
        stepId: "step-123",
      });
    });

    it("should return hasPendingEscalation: false when escalation is already resolved", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "Already resolved");
      insertEscalationResolvedEvent("wf-test1", "esc-123");

      const response = await request(app).get(
        "/api/workflows/wf-test1/escalation"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.hasPendingEscalation).toBe(false);
    });

    it("should return 404 for non-existent workflow", async () => {
      const response = await request(app).get(
        "/api/workflows/wf-nonexistent/escalation"
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("should return the most recent pending escalation", async () => {
      insertTestWorkflow();

      // Insert older escalation (resolved)
      insertEscalationRequestedEvent("wf-test1", "esc-old", "Old question");
      insertEscalationResolvedEvent("wf-test1", "esc-old");

      // Insert newer escalation (pending) - add small delay for timestamp ordering
      await new Promise((resolve) => setTimeout(resolve, 10));
      insertEscalationRequestedEvent("wf-test1", "esc-new", "New question");

      const response = await request(app).get(
        "/api/workflows/wf-test1/escalation"
      );

      expect(response.status).toBe(200);
      expect(response.body.data.hasPendingEscalation).toBe(true);
      expect(response.body.data.escalation.requestId).toBe("esc-new");
      expect(response.body.data.escalation.message).toBe("New question");
    });
  });

  // ===========================================================================
  // POST /api/workflows/:id/escalation/respond Tests
  // ===========================================================================

  describe("POST /api/workflows/:id/escalation/respond", () => {
    it("should resolve a pending escalation with approve action", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "Should we proceed?");

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({ action: "approve" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.escalation.action).toBe("approve");
      expect(response.body.data.escalation.id).toBe("esc-123");
      expect(response.body.message).toContain("approve");

      // Verify escalation_resolved event was recorded
      const events = getEscalationEvents("wf-test1");
      expect(events).toHaveLength(1);

      const payload = JSON.parse(events[0].payload);
      expect(payload.escalation_id).toBe("esc-123");
      expect(payload.action).toBe("approve");
    });

    it("should resolve with reject action", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "Should we delete all files?");

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({ action: "reject", message: "Too risky" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const events = getEscalationEvents("wf-test1");
      const payload = JSON.parse(events[0].payload);
      expect(payload.action).toBe("reject");
      expect(payload.message).toBe("Too risky");
    });

    it("should resolve with custom action and message", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "Which approach?");

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({
          action: "custom",
          message: "Use Option A but also add logging",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const events = getEscalationEvents("wf-test1");
      const payload = JSON.parse(events[0].payload);
      expect(payload.action).toBe("custom");
      expect(payload.message).toBe("Use Option A but also add logging");
    });

    it("should record escalation_resolved event with correct data", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-456", "Continue?");

      await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({ action: "approve" });

      const events = getEscalationEvents("wf-test1");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("escalation_resolved");

      const payload = JSON.parse(events[0].payload);
      expect(payload.escalation_id).toBe("esc-456");
      expect(payload.action).toBe("approve");
      expect(payload.responded_at).toBeDefined();
    });

    it("should return 404 for non-existent workflow", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-nonexistent/escalation/respond")
        .send({ action: "approve" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("should return 400 when no pending escalation", async () => {
      insertTestWorkflow();
      // No escalation event inserted

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({ action: "approve" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("No pending escalation");
    });

    it("should return 400 when escalation already resolved", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "Already done");
      insertEscalationResolvedEvent("wf-test1", "esc-123");

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({ action: "approve" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("No pending escalation");
    });

    it("should return 400 for missing action", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "Waiting");

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("action is required");
    });

    it("should return 400 for invalid action", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "Waiting");

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({ action: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("approve, reject, custom");
    });

    it("should return workflow data in response", async () => {
      insertTestWorkflow();
      insertEscalationRequestedEvent("wf-test1", "esc-123", "What now?");

      const response = await request(app)
        .post("/api/workflows/wf-test1/escalation/respond")
        .send({ action: "approve" });

      expect(response.status).toBe(200);
      expect(response.body.data.workflow).toBeDefined();
      expect(response.body.data.workflow.id).toBe("wf-test1");
      expect(response.body.data.workflow.title).toBe("Test Workflow");
    });
  });
});
