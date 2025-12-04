import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import { createWorkflowsRouter } from "../../../src/routes/workflows.js";
import type { Workflow, WorkflowStep } from "@sudocode-ai/types";
import type { IWorkflowEngine } from "../../../src/workflow/workflow-engine.js";
import {
  WorkflowNotFoundError,
  WorkflowStepNotFoundError,
  WorkflowStateError,
  WorkflowCycleError,
} from "../../../src/workflow/workflow-engine.js";

// Mock the websocket module
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastWorkflowUpdate: vi.fn(),
  broadcastWorkflowStepUpdate: vi.fn(),
}));

describe("Workflow Routes", () => {
  let app: Express;
  let mockEngine: Partial<IWorkflowEngine>;
  let mockDb: any;

  const mockWorkflow: Workflow = {
    id: "wf-123",
    title: "Test Workflow",
    source: { type: "issues", issueIds: ["i-1", "i-2"] },
    status: "pending",
    steps: [
      {
        id: "step-1",
        issueId: "i-1",
        index: 0,
        dependencies: [],
        status: "pending",
      },
      {
        id: "step-2",
        issueId: "i-2",
        index: 1,
        dependencies: ["step-1"],
        status: "pending",
      },
    ],
    baseBranch: "main",
    currentStepIndex: 0,
    config: {
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

    // Setup mock workflow engine
    mockEngine = {
      createWorkflow: vi.fn().mockResolvedValue(mockWorkflow),
      startWorkflow: vi.fn().mockResolvedValue(undefined),
      pauseWorkflow: vi.fn().mockResolvedValue(undefined),
      resumeWorkflow: vi.fn().mockResolvedValue(undefined),
      cancelWorkflow: vi.fn().mockResolvedValue(undefined),
      retryStep: vi.fn().mockResolvedValue(undefined),
      skipStep: vi.fn().mockResolvedValue(undefined),
      getWorkflow: vi.fn().mockResolvedValue(mockWorkflow),
      getReadySteps: vi.fn().mockResolvedValue([]),
      onWorkflowEvent: vi.fn().mockReturnValue(() => {}),
      // Emit methods for MCP endpoints
      emitStepStarted: vi.fn(),
      emitStepCompleted: vi.fn(),
      emitStepFailed: vi.fn(),
      emitWorkflowCompleted: vi.fn(),
      emitWorkflowFailed: vi.fn(),
      emitEscalationRequested: vi.fn(),
    };

    // Setup mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
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
        db: mockDb,
      };
      next();
    });

    app.use("/api/workflows", createWorkflowsRouter());
  });

  describe("GET /api/workflows", () => {
    it("should list workflows with default pagination", async () => {
      const workflowRow = {
        id: "wf-123",
        title: "Test Workflow",
        source: JSON.stringify({ type: "issues", issueIds: ["i-1"] }),
        status: "pending",
        steps: JSON.stringify([]),
        worktree_path: null,
        branch_name: null,
        base_branch: "main",
        current_step_index: 0,
        config: JSON.stringify(mockWorkflow.config),
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([workflowRow]),
      });

      const response = await request(app).get("/api/workflows");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it("should filter by status", async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      await request(app).get("/api/workflows?status=running");

      expect(mockDb.prepare).toHaveBeenCalled();
      const prepareCall = mockDb.prepare.mock.calls[0][0];
      expect(prepareCall).toContain("status IN");
    });

    it("should return 503 when engine not available", async () => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).project = {
          id: "project-123",
          workflowEngine: undefined,
          db: mockDb,
        };
        next();
      });
      app.use("/api/workflows", createWorkflowsRouter());

      const response = await request(app).get("/api/workflows");

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/workflows", () => {
    it("should create workflow from issues source", async () => {
      const response = await request(app)
        .post("/api/workflows")
        .send({
          source: { type: "issues", issueIds: ["i-1", "i-2"] },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe("wf-123");
      expect(mockEngine.createWorkflow).toHaveBeenCalledWith(
        { type: "issues", issueIds: ["i-1", "i-2"] },
        undefined
      );
    });

    it("should create workflow from spec source", async () => {
      const response = await request(app)
        .post("/api/workflows")
        .send({
          source: { type: "spec", specId: "s-abc" },
        });

      expect(response.status).toBe(201);
      expect(mockEngine.createWorkflow).toHaveBeenCalledWith(
        { type: "spec", specId: "s-abc" },
        undefined
      );
    });

    it("should return 400 for missing source", async () => {
      const response = await request(app)
        .post("/api/workflows")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("source is required");
    });

    it("should return 400 for invalid source type", async () => {
      const response = await request(app)
        .post("/api/workflows")
        .send({
          source: { type: "invalid" },
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Invalid source type");
    });

    it("should return 400 for cycle detection", async () => {
      (mockEngine.createWorkflow as any).mockRejectedValue(
        new WorkflowCycleError([["i-1", "i-2", "i-1"]])
      );

      const response = await request(app)
        .post("/api/workflows")
        .send({
          source: { type: "issues", issueIds: ["i-1", "i-2"] },
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.cycles).toBeDefined();
    });
  });

  describe("GET /api/workflows/:id", () => {
    it("should return workflow by id", async () => {
      const response = await request(app).get("/api/workflows/wf-123");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe("wf-123");
    });

    it("should return 404 for non-existent workflow", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue(null);

      const response = await request(app).get("/api/workflows/wf-unknown");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe("DELETE /api/workflows/:id", () => {
    it("should delete workflow", async () => {
      const response = await request(app).delete("/api/workflows/wf-123");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
    });

    it("should return 404 for non-existent workflow", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue(null);

      const response = await request(app).delete("/api/workflows/wf-unknown");

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/workflows/:id/start", () => {
    it("should start pending workflow", async () => {
      const response = await request(app).post("/api/workflows/wf-123/start");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEngine.startWorkflow).toHaveBeenCalledWith("wf-123");
    });

    it("should return 400 for non-pending workflow", async () => {
      (mockEngine.startWorkflow as any).mockRejectedValue(
        new WorkflowStateError("wf-123", "running", "start")
      );

      const response = await request(app).post("/api/workflows/wf-123/start");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 404 for non-existent workflow", async () => {
      (mockEngine.startWorkflow as any).mockRejectedValue(
        new WorkflowNotFoundError("wf-unknown")
      );

      const response = await request(app).post("/api/workflows/wf-unknown/start");

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/workflows/:id/pause", () => {
    it("should pause running workflow", async () => {
      const response = await request(app).post("/api/workflows/wf-123/pause");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEngine.pauseWorkflow).toHaveBeenCalledWith("wf-123");
    });

    it("should return 400 for non-running workflow", async () => {
      (mockEngine.pauseWorkflow as any).mockRejectedValue(
        new WorkflowStateError("wf-123", "pending", "pause")
      );

      const response = await request(app).post("/api/workflows/wf-123/pause");

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/workflows/:id/resume", () => {
    it("should resume paused workflow", async () => {
      const response = await request(app).post("/api/workflows/wf-123/resume");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEngine.resumeWorkflow).toHaveBeenCalledWith("wf-123");
    });

    it("should return 400 for non-paused workflow", async () => {
      (mockEngine.resumeWorkflow as any).mockRejectedValue(
        new WorkflowStateError("wf-123", "running", "resume")
      );

      const response = await request(app).post("/api/workflows/wf-123/resume");

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/workflows/:id/cancel", () => {
    it("should cancel workflow", async () => {
      const response = await request(app).post("/api/workflows/wf-123/cancel");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEngine.cancelWorkflow).toHaveBeenCalledWith("wf-123");
    });

    it("should return 400 for terminal state workflow", async () => {
      (mockEngine.cancelWorkflow as any).mockRejectedValue(
        new WorkflowStateError("wf-123", "completed", "cancel")
      );

      const response = await request(app).post("/api/workflows/wf-123/cancel");

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/workflows/:id/steps/:stepId/retry", () => {
    it("should retry failed step", async () => {
      const response = await request(app).post(
        "/api/workflows/wf-123/steps/step-1/retry"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEngine.retryStep).toHaveBeenCalledWith("wf-123", "step-1");
    });

    it("should return 404 for non-existent step", async () => {
      (mockEngine.retryStep as any).mockRejectedValue(
        new WorkflowStepNotFoundError("wf-123", "step-unknown")
      );

      const response = await request(app).post(
        "/api/workflows/wf-123/steps/step-unknown/retry"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/workflows/:id/steps/:stepId/skip", () => {
    it("should skip step with reason", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/steps/step-1/skip")
        .send({ reason: "Not needed" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEngine.skipStep).toHaveBeenCalledWith(
        "wf-123",
        "step-1",
        "Not needed"
      );
    });

    it("should skip step without reason", async () => {
      const response = await request(app).post(
        "/api/workflows/wf-123/steps/step-1/skip"
      );

      expect(response.status).toBe(200);
      expect(mockEngine.skipStep).toHaveBeenCalledWith(
        "wf-123",
        "step-1",
        undefined
      );
    });
  });

  describe("GET /api/workflows/:id/events", () => {
    it("should return workflow events", async () => {
      const eventRow = {
        id: "evt-1",
        workflow_id: "wf-123",
        type: "workflow_started",
        step_id: null,
        execution_id: null,
        payload: JSON.stringify({}),
        created_at: "2024-01-01T00:00:00Z",
        processed_at: null,
      };

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([eventRow]),
      });

      const response = await request(app).get("/api/workflows/wf-123/events");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe("workflow_started");
    });

    it("should return 404 for non-existent workflow", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue(null);

      const response = await request(app).get("/api/workflows/wf-unknown/events");

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // MCP Server Endpoints
  // ===========================================================================

  describe("GET /api/workflows/:id/status (MCP)", () => {
    it("should return extended workflow status", async () => {
      const mockIssues = [
        { id: "i-1", title: "Issue One" },
        { id: "i-2", title: "Issue Two" },
      ];

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ id: "exec-1", status: "running", started_at: "2024-01-01T00:00:00Z" }),
        all: vi.fn().mockReturnValue(mockIssues),
      });

      const response = await request(app).get("/api/workflows/wf-123/status");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.workflow.id).toBe("wf-123");
      expect(response.body.data.steps).toBeDefined();
      expect(response.body.data.readySteps).toBeDefined();
    });

    it("should return 404 for non-existent workflow", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue(null);

      const response = await request(app).get("/api/workflows/wf-unknown/status");

      expect(response.status).toBe(404);
    });

    it("should return 503 when engine not available", async () => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).project = {
          id: "project-123",
          workflowEngine: undefined,
          db: mockDb,
        };
        next();
      });
      app.use("/api/workflows", createWorkflowsRouter());

      const response = await request(app).get("/api/workflows/wf-123/status");

      expect(response.status).toBe(503);
    });
  });

  describe("POST /api/workflows/:id/execute (MCP)", () => {
    let mockExecutionService: any;

    beforeEach(() => {
      mockExecutionService = {
        createExecution: vi.fn().mockResolvedValue({
          id: "exec-new",
          status: "pending",
          worktree_path: "/test/worktree",
          branch_name: "sudocode/exec-new",
        }),
      };

      // Add executionService to app
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).project = {
          id: "project-123",
          workflowEngine: mockEngine,
          executionService: mockExecutionService,
          db: mockDb,
        };
        next();
      });
      app.use("/api/workflows", createWorkflowsRouter());
    });

    it("should return 400 when issue_id is missing", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/execute")
        .send({ worktree_mode: "create_root" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("issue_id is required");
    });

    it("should return 400 when worktree_mode is missing", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/execute")
        .send({ issue_id: "i-1" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("worktree_mode is required");
    });

    it("should return 404 for non-existent workflow", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue(null);

      const response = await request(app)
        .post("/api/workflows/wf-unknown/execute")
        .send({ issue_id: "i-1", worktree_mode: "create_root" });

      expect(response.status).toBe(404);
    });

    it("should return 400 when workflow is not running", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue({
        ...mockWorkflow,
        status: "paused",
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/execute")
        .send({ issue_id: "i-1", worktree_mode: "create_root" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("workflow is paused");
    });

    it("should return 400 when issue is not part of workflow", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue({
        ...mockWorkflow,
        status: "running",
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/execute")
        .send({ issue_id: "i-unknown", worktree_mode: "create_root" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("not part of workflow");
    });

    it("should return 400 when use_root without worktree_id", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue({
        ...mockWorkflow,
        status: "running",
      });

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ id: "i-1", title: "Issue 1", content: "Content" }),
        run: vi.fn(),
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/execute")
        .send({ issue_id: "i-1", worktree_mode: "use_root" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("worktree_id is required");
    });

    it("should return 503 when engine not available", async () => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).project = {
          id: "project-123",
          workflowEngine: undefined,
          db: mockDb,
        };
        next();
      });
      app.use("/api/workflows", createWorkflowsRouter());

      const response = await request(app)
        .post("/api/workflows/wf-123/execute")
        .send({ issue_id: "i-1", worktree_mode: "create_root" });

      expect(response.status).toBe(503);
    });
  });

  describe("POST /api/workflows/:id/complete (MCP)", () => {
    it("should complete workflow with summary", async () => {
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/complete")
        .send({ summary: "All done!" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.workflow_status).toBe("completed");
      expect(response.body.data.completed_at).toBeDefined();
    });

    it("should mark workflow as failed when specified", async () => {
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/complete")
        .send({ summary: "Failed due to error", status: "failed" });

      expect(response.status).toBe(200);
      expect(response.body.data.workflow_status).toBe("failed");
    });

    it("should return 400 when summary is missing", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/complete")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("summary is required");
    });

    it("should return 404 for non-existent workflow", async () => {
      (mockEngine.getWorkflow as any).mockResolvedValue(null);

      const response = await request(app)
        .post("/api/workflows/wf-unknown/complete")
        .send({ summary: "Done" });

      expect(response.status).toBe(404);
    });

    it("should return 503 when engine not available", async () => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).project = {
          id: "project-123",
          workflowEngine: undefined,
          db: mockDb,
        };
        next();
      });
      app.use("/api/workflows", createWorkflowsRouter());

      const response = await request(app)
        .post("/api/workflows/wf-123/complete")
        .send({ summary: "Done" });

      expect(response.status).toBe(503);
    });
  });

  describe("POST /api/workflows/:id/escalate (MCP)", () => {
    it("should create escalation and return pending status", async () => {
      // Mock prepare to return different mocks for different calls
      const getMock = vi.fn()
        // First call: get workflow row
        .mockReturnValueOnce({
          id: "wf-123",
          config: JSON.stringify({ autonomyLevel: "human_in_the_loop" }),
        })
        // Second call: check pending escalation - return undefined
        .mockReturnValueOnce(undefined);

      mockDb.prepare.mockReturnValue({
        get: getMock,
        run: vi.fn(),
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/escalate")
        .send({ message: "Need user input" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("pending");
      expect(response.body.data.escalation_id).toBeDefined();
    });

    it("should include options in escalation", async () => {
      const getMock = vi.fn()
        .mockReturnValueOnce({
          id: "wf-123",
          config: JSON.stringify({ autonomyLevel: "human_in_the_loop" }),
        })
        .mockReturnValueOnce(undefined);

      mockDb.prepare.mockReturnValue({
        get: getMock,
        run: vi.fn(),
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/escalate")
        .send({ message: "Choose one", options: ["Yes", "No"] });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe("pending");
    });

    it("should auto-approve in full_auto mode", async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: "wf-123",
          config: JSON.stringify({ autonomyLevel: "full_auto" }),
        }),
      });

      const response = await request(app)
        .post("/api/workflows/wf-123/escalate")
        .send({ message: "Proceed?" });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe("auto_approved");
    });

    it("should return 400 when message is missing", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/escalate")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("message is required");
    });

    it("should return 404 for non-existent workflow", async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const response = await request(app)
        .post("/api/workflows/wf-unknown/escalate")
        .send({ message: "Help" });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/workflows/:id/notify (MCP)", () => {
    beforeEach(() => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ id: "wf-123" }),
        run: vi.fn(),
      });
    });

    it("should send notification and return success", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/notify")
        .send({ message: "Progress update" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.delivered).toBe(true);
    });

    it("should accept level parameter", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/notify")
        .send({ message: "Warning!", level: "warning" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should return 400 when message is missing", async () => {
      const response = await request(app)
        .post("/api/workflows/wf-123/notify")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("message is required");
    });

    it("should return 404 for non-existent workflow", async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const response = await request(app)
        .post("/api/workflows/wf-unknown/notify")
        .send({ message: "Update" });

      expect(response.status).toBe(404);
    });
  });
});
