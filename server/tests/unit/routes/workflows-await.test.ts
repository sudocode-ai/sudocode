/**
 * Unit tests for workflow await-events endpoint
 *
 * Tests the POST /api/workflows/:id/await-events endpoint:
 * - Validation of event types
 * - Workflow status validation
 * - Registration of await conditions
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import { createWorkflowsRouter } from "../../../src/routes/workflows.js";
import type { Workflow } from "@sudocode-ai/types";

// Mock the websocket module
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastWorkflowUpdate: vi.fn(),
  broadcastWorkflowStepUpdate: vi.fn(),
}));

describe("Workflow Await Events API", () => {
  let app: Express;
  let mockEngine: any;
  let mockWakeupService: any;
  let mockDb: any;

  const mockWorkflow: Workflow = {
    id: "wf-123",
    title: "Test Workflow",
    source: { type: "goal", goal: "Test goal" },
    status: "running",
    steps: [],
    baseBranch: "main",
    currentStepIndex: 0,
    config: {
      engineType: "orchestrator",
      parallelism: "sequential",
      onFailure: "pause",
      autoCommitAfterStep: true,
      defaultAgentType: "claude-code",
      autonomyLevel: "human_in_the_loop",
    },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock wakeup service
    mockWakeupService = {
      registerAwait: vi.fn().mockReturnValue({
        id: "await-123",
        timeoutAt: "2024-01-01T00:05:00Z",
      }),
    };

    // Setup mock workflow engine with getWakeupService
    mockEngine = {
      getWorkflow: vi.fn().mockResolvedValue(mockWorkflow),
      getWakeupService: vi.fn().mockReturnValue(mockWakeupService),
    };

    // Setup mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
        get: vi.fn().mockReturnValue({
          config: JSON.stringify({ engineType: "orchestrator" }),
        }),
      }),
    };

    // Setup Express app
    app = express();
    app.use(express.json());

    // Mock project middleware
    app.use((req, _res, next) => {
      (req as any).project = {
        id: "project-123",
        workflowEngine: mockEngine,
        sequentialWorkflowEngine: mockEngine,
        orchestratorWorkflowEngine: mockEngine,
        db: mockDb,
        getWorkflowEngine: () => mockEngine,
      };
      next();
    });

    app.use("/api/workflows", createWorkflowsRouter());
  });

  describe("POST /api/workflows/:id/await-events", () => {
    it("should register await condition and return await ID", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed", "step_failed"],
          timeout_seconds: 300,
          message: "Waiting for issue completion",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("waiting");
      expect(response.body.data.await_id).toBe("await-123");
      expect(response.body.data.will_wake_on).toEqual([
        "step_completed",
        "step_failed",
      ]);
      expect(response.body.data.timeout_at).toBe("2024-01-01T00:05:00Z");
    });

    it("should call wakeupService.registerAwait with correct params", async () => {
      await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed"],
          execution_ids: ["exec-1", "exec-2"],
          timeout_seconds: 60,
          message: "Waiting",
        });

      expect(mockWakeupService.registerAwait).toHaveBeenCalledWith({
        workflowId: "wf-123",
        eventTypes: ["step_completed"],
        executionIds: ["exec-1", "exec-2"],
        timeoutSeconds: 60,
        message: "Waiting",
      });
    });

    it("should return 400 when event_types is missing", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("event_types is required");
    });

    it("should return 400 when event_types is empty", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("event_types is required");
    });

    it("should return 400 for invalid event type", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed", "invalid_event"],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Invalid event type");
      expect(response.body.message).toContain("invalid_event");
    });

    it("should return 404 for non-existent workflow", async () => {
      mockEngine.getWorkflow.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/workflows/wf-unknown/await-events")
        .send({
          event_types: ["step_completed"],
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("should return 400 when workflow is not running", async () => {
      mockEngine.getWorkflow.mockResolvedValue({
        ...mockWorkflow,
        status: "paused",
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed"],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("paused");
      expect(response.body.message).toContain("expected running");
    });

    it("should return 400 when workflow is completed", async () => {
      mockEngine.getWorkflow.mockResolvedValue({
        ...mockWorkflow,
        status: "completed",
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed"],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("completed");
    });

    it("should return 400 when engine does not support await", async () => {
      // Remove getWakeupService from engine
      delete mockEngine.getWakeupService;

      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed"],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("only supported for orchestrator");
    });

    it("should accept all valid event types", async () => {
      const validEventTypes = [
        "step_completed",
        "step_failed",
        "user_response",
        "escalation_resolved",
        "timeout",
      ];

      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: validEventTypes,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.will_wake_on).toEqual(validEventTypes);
    });

    it("should work without optional parameters", async () => {
      mockWakeupService.registerAwait.mockReturnValue({
        id: "await-456",
        timeoutAt: undefined,
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed"],
        });

      expect(response.status).toBe(200);
      expect(response.body.data.await_id).toBe("await-456");
      expect(response.body.data.timeout_at).toBeUndefined();

      expect(mockWakeupService.registerAwait).toHaveBeenCalledWith({
        workflowId: "wf-123",
        eventTypes: ["step_completed"],
        executionIds: undefined,
        timeoutSeconds: undefined,
        message: undefined,
      });
    });

    it("should return 503 when engine not available", async () => {
      // Setup app with no engine
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).project = {
          id: "project-123",
          workflowEngine: undefined,
          db: mockDb,
          getWorkflowEngine: () => null,
        };
        next();
      });
      app.use("/api/workflows", createWorkflowsRouter());

      const response = await request(app)
        .post("/api/workflows/wf-123/await-events")
        .send({
          event_types: ["step_completed"],
        });

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
    });
  });
});
