import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";
import type { ExecutionService } from "../../../src/services/execution-service.js";
import type { ExecutionLogsStore } from "../../../src/services/execution-logs-store.js";
import type { Execution } from "@sudocode-ai/types";

// Mock agent registry service
vi.mock("../../../src/services/agent-registry.js", () => {
  const implementedAgents = new Set(["claude-code"]);
  const registeredAgents = new Set([
    "claude-code",
    "codex",
    "copilot",
    "cursor",
  ]);

  return {
    agentRegistryService: {
      hasAgent: (agentType: string) => {
        return registeredAgents.has(agentType);
      },
      isAgentImplemented: (agentType: string) => {
        return implementedAgents.has(agentType);
      },
      getAvailableAgents: () => [
        { name: "claude-code", displayName: "Claude", implemented: true },
        { name: "codex", displayName: "Codex", implemented: false },
        { name: "copilot", displayName: "GitHub Copilot", implemented: false },
        { name: "cursor", displayName: "Cursor", implemented: false },
      ],
    },
  };
});

describe("Executions API Routes - Agent Type Validation", () => {
  let app: Express;
  let mockExecutionService: Partial<ExecutionService>;
  let mockLogsStore: Partial<ExecutionLogsStore>;
  let mockDbPrepare: ReturnType<typeof vi.fn>;
  let mockDbAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Setup mock execution service
    mockExecutionService = {
      createExecution: vi.fn().mockResolvedValue({
        id: "exec-123",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "running",
        mode: "worktree",
        prompt: "Test prompt",
        config: "{}",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Execution),
      getExecution: vi.fn(),
      listExecutions: vi.fn().mockReturnValue([]),
      listAll: vi.fn().mockReturnValue({
        executions: [],
        total: 0,
        hasMore: false,
      }),
      getExecutionChain: vi.fn().mockReturnValue([]),
      createFollowUp: vi.fn().mockResolvedValue({} as Execution),
    };

    mockLogsStore = {
      getNormalizedEntries: vi.fn().mockReturnValue([]),
      getLogMetadata: vi.fn().mockReturnValue(null),
    };

    // Setup Express app with executions router
    app = express();
    app.use(express.json());

    // Mock database with prepare method for chain queries
    mockDbAll = vi.fn().mockReturnValue([]);
    mockDbPrepare = vi.fn().mockReturnValue({
      all: mockDbAll,
    });
    const mockDb = {
      prepare: mockDbPrepare,
    };

    // Mock the project middleware by injecting project object
    app.use((req, _res, next) => {
      (req as any).project = {
        executionService: mockExecutionService,
        logsStore: mockLogsStore,
        db: mockDb,
      };
      next();
    });

    app.use("/api", createExecutionsRouter());
  });

  describe("POST /api/executions - Adhoc Executions (no issue)", () => {
    it("should create adhoc execution with prompt and agentType", async () => {
      const mockAdhocExecution = {
        id: "exec-adhoc-123",
        issue_id: null,
        agent_type: "claude-code",
        status: "running",
        mode: "local",
        prompt: "Run the tests",
        config: "{}",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Execution;

      mockExecutionService.createExecution = vi
        .fn()
        .mockResolvedValue(mockAdhocExecution);

      const response = await request(app).post("/api/executions").send({
        prompt: "Run the tests",
        agentType: "claude-code",
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockAdhocExecution);
      expect(mockExecutionService.createExecution).toHaveBeenCalledWith(
        null, // No issueId for adhoc executions
        {},
        "Run the tests",
        "claude-code"
      );
    });

    it("should create adhoc execution without agentType (defaults to claude-code)", async () => {
      const mockAdhocExecution = {
        id: "exec-adhoc-123",
        issue_id: null,
        agent_type: "claude-code",
        status: "running",
      } as Execution;

      mockExecutionService.createExecution = vi
        .fn()
        .mockResolvedValue(mockAdhocExecution);

      const response = await request(app).post("/api/executions").send({
        prompt: "Run the tests",
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.createExecution).toHaveBeenCalledWith(
        null,
        {},
        "Run the tests",
        undefined // No agentType provided, service will default to 'claude-code'
      );
    });

    it("should return 400 when prompt is missing", async () => {
      const response = await request(app).post("/api/executions").send({
        agentType: "claude-code",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Prompt is required for adhoc executions"
      );
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should return 400 when prompt is empty string", async () => {
      const response = await request(app).post("/api/executions").send({
        prompt: "",
        agentType: "claude-code",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Prompt is required for adhoc executions"
      );
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should return 400 when prompt is only whitespace", async () => {
      const response = await request(app).post("/api/executions").send({
        prompt: "   ",
        agentType: "claude-code",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Prompt is required for adhoc executions"
      );
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should return 501 when agentType is not implemented", async () => {
      const response = await request(app).post("/api/executions").send({
        prompt: "Run the tests",
        agentType: "codex",
      });

      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Agent 'codex' is not yet implemented");
      expect(response.body.code).toBe("AGENT_NOT_IMPLEMENTED");
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should return 400 when agentType is invalid/not found", async () => {
      const response = await request(app).post("/api/executions").send({
        prompt: "Run the tests",
        agentType: "unknown-agent",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe(
        "Agent 'unknown-agent' not found in registry"
      );
      expect(response.body.code).toBe("AGENT_NOT_FOUND");
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should pass config to execution service when provided", async () => {
      const mockAdhocExecution = {
        id: "exec-adhoc-123",
        issue_id: null,
        agent_type: "claude-code",
        status: "running",
        mode: "local",
      } as Execution;

      mockExecutionService.createExecution = vi
        .fn()
        .mockResolvedValue(mockAdhocExecution);

      const response = await request(app)
        .post("/api/executions")
        .send({
          prompt: "Run the tests",
          agentType: "claude-code",
          config: {
            mode: "local",
            baseBranch: "develop",
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.createExecution).toHaveBeenCalledWith(
        null,
        {
          mode: "local",
          baseBranch: "develop",
        },
        "Run the tests",
        "claude-code"
      );
    });

    it("should return 500 on service error", async () => {
      mockExecutionService.createExecution = vi
        .fn()
        .mockRejectedValue(new Error("Database connection failed"));

      const response = await request(app).post("/api/executions").send({
        prompt: "Run the tests",
        agentType: "claude-code",
      });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toBe("Database connection failed");
      expect(response.body.message).toBe("Failed to create adhoc execution");
    });
  });

  describe("POST /api/issues/:issueId/executions - agentType parameter", () => {
    it("should create execution with agentType='claude-code'", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "claude-code",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(mockExecutionService.createExecution).toHaveBeenCalledWith(
        "i-abc",
        {},
        "Test prompt",
        "claude-code"
      );
    });

    it("should create execution without agentType (defaults to claude-code)", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.createExecution).toHaveBeenCalledWith(
        "i-abc",
        {},
        "Test prompt",
        undefined // No agentType provided, service will default to 'claude-code'
      );
    });

    it("should return 501 when agentType is not implemented (stub agent)", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "codex",
        });

      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Agent 'codex' is not yet implemented");
      expect(response.body.code).toBe("AGENT_NOT_IMPLEMENTED");
      expect(response.body.details).toBeDefined();
      expect(response.body.details.agentType).toBe("codex");
      expect(response.body.details.message).toContain(
        "not yet fully implemented"
      );
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should return 501 for copilot (another stub agent)", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "copilot",
        });

      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe(
        "Agent 'copilot' is not yet implemented"
      );
      expect(response.body.code).toBe("AGENT_NOT_IMPLEMENTED");
      expect(response.body.details).toBeDefined();
      expect(response.body.details.agentType).toBe("copilot");
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should return 400 when agentType is invalid/not found", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "unknown-agent",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe(
        "Agent 'unknown-agent' not found in registry"
      );
      expect(response.body.code).toBe("AGENT_NOT_FOUND");
      expect(response.body.details).toBeDefined();
      expect(response.body.details.agentType).toBe("unknown-agent");
      expect(response.body.details.availableAgents).toBeDefined();
      expect(Array.isArray(response.body.details.availableAgents)).toBe(true);
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should return 400 when prompt is missing", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          agentType: "claude-code",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Prompt is required");
      expect(mockExecutionService.createExecution).not.toHaveBeenCalled();
    });

    it("should pass config to execution service when provided", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "claude-code",
          config: {
            mode: "worktree",
            baseBranch: "develop",
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.createExecution).toHaveBeenCalledWith(
        "i-abc",
        {
          mode: "worktree",
          baseBranch: "develop",
        },
        "Test prompt",
        "claude-code"
      );
    });

    it("should be backwards compatible - works without agentType", async () => {
      // This simulates existing API clients that don't know about agentType
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          config: { mode: "local" },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      // agentType is undefined, will default to 'claude-code' in service
      expect(mockExecutionService.createExecution).toHaveBeenCalledWith(
        "i-abc",
        { mode: "local" },
        "Test prompt",
        undefined
      );
    });
  });

  describe("GET /api/executions/:executionId", () => {
    it("should return execution by ID", async () => {
      const mockExecution = {
        id: "exec-123",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "completed",
      } as Execution;

      mockExecutionService.getExecution = vi
        .fn()
        .mockReturnValue(mockExecution);

      const response = await request(app).get("/api/executions/exec-123");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockExecution);
    });

    it("should return 404 when execution not found", async () => {
      mockExecutionService.getExecution = vi.fn().mockReturnValue(null);

      const response = await request(app).get("/api/executions/exec-999");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Execution not found");
    });
  });

  describe("Enhanced error responses", () => {
    it("should include helpful error details for AgentNotFoundError", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "invalid-agent",
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        data: null,
        error: "Agent 'invalid-agent' not found in registry",
        code: "AGENT_NOT_FOUND",
        details: {
          agentType: "invalid-agent",
          availableAgents: expect.any(Array),
        },
      });
    });

    it("should include helpful error details for AgentNotImplementedError", async () => {
      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "codex",
        });

      expect(response.status).toBe(501);
      expect(response.body).toMatchObject({
        success: false,
        data: null,
        error: "Agent 'codex' is not yet implemented",
        code: "AGENT_NOT_IMPLEMENTED",
        details: {
          agentType: "codex",
          message: expect.stringContaining("not yet fully implemented"),
        },
      });
    });

    it("should maintain backwards compatibility for non-agent errors", async () => {
      // Simulate a generic error from ExecutionService
      mockExecutionService.createExecution = vi
        .fn()
        .mockRejectedValue(new Error("Database connection failed"));

      const response = await request(app)
        .post("/api/issues/i-abc/executions")
        .send({
          prompt: "Test prompt",
          agentType: "claude-code",
        });

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        success: false,
        data: null,
        error_data: "Database connection failed",
        message: "Failed to create execution",
      });
    });
  });

  describe("GET /api/issues/:issueId/executions", () => {
    it("should list all executions for an issue", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          issue_id: "i-abc",
          agent_type: "claude-code",
          status: "completed",
        },
        {
          id: "exec-2",
          issue_id: "i-abc",
          agent_type: "claude-code",
          status: "running",
        },
      ] as Execution[];

      mockExecutionService.listExecutions = vi
        .fn()
        .mockReturnValue(mockExecutions);

      const response = await request(app).get("/api/issues/i-abc/executions");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockExecutions);
      expect(mockExecutionService.listExecutions).toHaveBeenCalledWith("i-abc");
    });
  });

  describe("GET /api/executions/:executionId/chain", () => {
    it("should return execution chain for a root execution", async () => {
      const mockRootExecution = {
        id: "exec-root",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "completed",
        parent_execution_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
      } as Execution;

      mockExecutionService.getExecution = vi
        .fn()
        .mockReturnValue(mockRootExecution);
      // Mock the database chain query to return just the root
      mockDbAll.mockReturnValue([mockRootExecution]);

      const response = await request(app).get(
        "/api/executions/exec-root/chain"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        rootId: "exec-root",
        executions: [mockRootExecution],
      });
    });

    it("should return execution chain for a follow-up execution", async () => {
      const mockRootExecution = {
        id: "exec-root",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "completed",
        parent_execution_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
      } as Execution;

      const mockFollowUpExecution = {
        id: "exec-followup",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "completed",
        parent_execution_id: "exec-root",
        created_at: "2025-01-01T00:01:00.000Z",
      } as Execution;

      // When getting the follow-up, return it
      // When getting the root (via parent_execution_id), return root
      mockExecutionService.getExecution = vi
        .fn()
        .mockImplementation((id: string) => {
          if (id === "exec-followup") return mockFollowUpExecution;
          if (id === "exec-root") return mockRootExecution;
          return null;
        });

      // Mock the database chain query to return the full chain
      mockDbAll.mockReturnValue([mockRootExecution, mockFollowUpExecution]);

      const response = await request(app).get(
        "/api/executions/exec-followup/chain"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.rootId).toBe("exec-root");
      expect(response.body.data.executions).toHaveLength(2);
      expect(response.body.data.executions[0].id).toBe("exec-root");
      expect(response.body.data.executions[1].id).toBe("exec-followup");
    });

    it("should return execution chain with multiple follow-ups", async () => {
      const mockChain = [
        {
          id: "exec-root",
          issue_id: "i-abc",
          parent_execution_id: null,
          created_at: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "exec-followup-1",
          issue_id: "i-abc",
          parent_execution_id: "exec-root",
          created_at: "2025-01-01T00:01:00.000Z",
        },
        {
          id: "exec-followup-2",
          issue_id: "i-abc",
          parent_execution_id: "exec-followup-1",
          created_at: "2025-01-01T00:02:00.000Z",
        },
      ] as Execution[];

      mockExecutionService.getExecution = vi.fn().mockReturnValue(mockChain[0]);
      // Mock the database chain query to return the full chain
      mockDbAll.mockReturnValue(mockChain);

      const response = await request(app).get(
        "/api/executions/exec-root/chain"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.rootId).toBe("exec-root");
      expect(response.body.data.executions).toHaveLength(3);
      expect(response.body.data.executions[0].id).toBe("exec-root");
      expect(response.body.data.executions[1].id).toBe("exec-followup-1");
      expect(response.body.data.executions[2].id).toBe("exec-followup-2");
    });

    it("should return 404 when execution not found", async () => {
      mockExecutionService.getExecution = vi.fn().mockReturnValue(null);

      const response = await request(app).get("/api/executions/exec-999/chain");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Execution not found");
    });
  });

  describe("POST /api/executions/:executionId/follow-up", () => {
    it("should create a follow-up execution", async () => {
      const mockPreviousExecution = {
        id: "exec-root",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "completed",
        session_id: "session-123",
        mode: "worktree",
        config: JSON.stringify({ baseBranch: "main" }),
      } as Execution;

      const mockFollowUpExecution = {
        id: "exec-followup",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "running",
        parent_execution_id: "exec-root",
        session_id: "session-123",
        mode: "worktree",
      } as Execution;

      mockExecutionService.getExecution = vi
        .fn()
        .mockReturnValue(mockPreviousExecution);
      mockExecutionService.createFollowUp = vi
        .fn()
        .mockResolvedValue(mockFollowUpExecution);

      const response = await request(app)
        .post("/api/executions/exec-root/follow-up")
        .send({
          feedback: "Please fix the test failures",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockFollowUpExecution);
      expect(mockExecutionService.createFollowUp).toHaveBeenCalledWith(
        "exec-root",
        "Please fix the test failures"
      );
    });

    it("should inherit agent type from previous execution", async () => {
      const mockPreviousExecution = {
        id: "exec-root",
        issue_id: "i-abc",
        agent_type: "claude-code",
        status: "completed",
        session_id: "session-123",
      } as Execution;

      const mockFollowUpExecution = {
        id: "exec-followup",
        issue_id: "i-abc",
        agent_type: "claude-code", // Inherited from parent
        status: "running",
        parent_execution_id: "exec-root",
      } as Execution;

      mockExecutionService.getExecution = vi
        .fn()
        .mockReturnValue(mockPreviousExecution);
      mockExecutionService.createFollowUp = vi
        .fn()
        .mockResolvedValue(mockFollowUpExecution);

      const response = await request(app)
        .post("/api/executions/exec-root/follow-up")
        .send({
          feedback: "Continue with this task",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.agent_type).toBe("claude-code");
      expect(mockExecutionService.createFollowUp).toHaveBeenCalledWith(
        "exec-root",
        "Continue with this task"
      );
    });

    it("should return 404 when previous execution not found", async () => {
      // The service throws an error which is caught and converted to 404
      mockExecutionService.createFollowUp = vi
        .fn()
        .mockRejectedValue(new Error("Execution exec-999 not found"));

      const response = await request(app)
        .post("/api/executions/exec-999/follow-up")
        .send({
          feedback: "Please continue",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Failed to create follow-up execution"
      );
      expect(response.body.error_data).toContain("not found");
    });

    it("should return 400 when feedback is missing", async () => {
      const mockPreviousExecution = {
        id: "exec-root",
        issue_id: "i-abc",
        status: "completed",
      } as Execution;

      mockExecutionService.getExecution = vi
        .fn()
        .mockReturnValue(mockPreviousExecution);

      const response = await request(app)
        .post("/api/executions/exec-root/follow-up")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Feedback is required");
      expect(mockExecutionService.createFollowUp).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/executions/:executionId/cancel", () => {
    beforeEach(() => {
      mockExecutionService.cancelExecution = vi
        .fn()
        .mockResolvedValue(undefined);
    });

    it("should cancel a running execution", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/cancel")
        .send();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Execution cancelled successfully");
      expect(response.body.data.executionId).toBe("exec-123");
      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith(
        "exec-123"
      );
    });

    it("should return 404 when execution not found", async () => {
      mockExecutionService.cancelExecution = vi
        .fn()
        .mockRejectedValue(new Error("Execution exec-999 not found"));

      const response = await request(app)
        .post("/api/executions/exec-999/cancel")
        .send();

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to cancel execution");
      expect(response.body.error_data).toContain("not found");
    });

    it("should return 500 on service error", async () => {
      mockExecutionService.cancelExecution = vi
        .fn()
        .mockRejectedValue(new Error("Service error"));

      const response = await request(app)
        .post("/api/executions/exec-123/cancel")
        .send();

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to cancel execution");
    });
  });

  describe("DELETE /api/executions/:executionId", () => {
    beforeEach(() => {
      mockExecutionService.cancelExecution = vi
        .fn()
        .mockResolvedValue(undefined);
      mockExecutionService.deleteExecution = vi
        .fn()
        .mockResolvedValue(undefined);
    });

    it("should delete an execution when no query param provided", async () => {
      const response = await request(app).delete("/api/executions/exec-123");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Execution deleted successfully");
      expect(response.body.data.executionId).toBe("exec-123");
      expect(mockExecutionService.deleteExecution).toHaveBeenCalledWith(
        "exec-123",
        false,
        false
      );
      expect(mockExecutionService.cancelExecution).not.toHaveBeenCalled();
    });

    it("should cancel execution when cancel=true query param provided", async () => {
      const response = await request(app).delete(
        "/api/executions/exec-123?cancel=true"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Execution cancelled successfully");
      expect(response.body.data.executionId).toBe("exec-123");
      expect(mockExecutionService.cancelExecution).toHaveBeenCalledWith(
        "exec-123"
      );
      expect(mockExecutionService.deleteExecution).not.toHaveBeenCalled();
    });

    it("should delete execution when cancel=false query param provided", async () => {
      const response = await request(app).delete(
        "/api/executions/exec-123?cancel=false"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Execution deleted successfully");
      expect(mockExecutionService.deleteExecution).toHaveBeenCalledWith(
        "exec-123",
        false,
        false
      );
      expect(mockExecutionService.cancelExecution).not.toHaveBeenCalled();
    });

    it("should return 404 when execution not found (delete)", async () => {
      mockExecutionService.deleteExecution = vi
        .fn()
        .mockRejectedValue(new Error("Execution exec-999 not found"));

      const response = await request(app).delete("/api/executions/exec-999");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to delete/cancel execution");
      expect(response.body.error_data).toContain("not found");
    });

    it("should return 404 when execution not found (cancel via query param)", async () => {
      mockExecutionService.cancelExecution = vi
        .fn()
        .mockRejectedValue(new Error("Execution exec-999 not found"));

      const response = await request(app).delete(
        "/api/executions/exec-999?cancel=true"
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to delete/cancel execution");
      expect(response.body.error_data).toContain("not found");
    });

    it("should delete execution with branch when deleteBranch=true query param provided", async () => {
      const response = await request(app).delete(
        "/api/executions/exec-123?deleteBranch=true"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Execution deleted successfully");
      expect(mockExecutionService.deleteExecution).toHaveBeenCalledWith(
        "exec-123",
        true,
        false
      );
      expect(mockExecutionService.cancelExecution).not.toHaveBeenCalled();
    });

    it("should return 500 on service error", async () => {
      mockExecutionService.deleteExecution = vi
        .fn()
        .mockRejectedValue(new Error("Service error"));

      const response = await request(app).delete("/api/executions/exec-123");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to delete/cancel execution");
    });
  });

  describe("GET /api/executions", () => {
    it("should list all executions with default parameters", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          issue_id: "i-abc",
          agent_type: "claude-code",
          status: "completed",
          created_at: "2025-01-01T00:02:00.000Z",
        },
        {
          id: "exec-2",
          issue_id: "i-def",
          agent_type: "claude-code",
          status: "running",
          created_at: "2025-01-01T00:01:00.000Z",
        },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 2,
        hasMore: false,
      });

      const response = await request(app).get("/api/executions");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.executions).toEqual(mockExecutions);
      expect(response.body.data.total).toBe(2);
      expect(response.body.data.hasMore).toBe(false);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: undefined,
        issueId: undefined,
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
      });
    });

    it("should filter by single status", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          issue_id: "i-abc",
          status: "running",
        },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 1,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?status=running"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.executions).toEqual(mockExecutions);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: "running",
        issueId: undefined,
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
      });
    });

    it("should filter by multiple statuses (comma-separated)", async () => {
      const mockExecutions = [
        { id: "exec-1", status: "running" },
        { id: "exec-2", status: "completed" },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 2,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?status=running,completed"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: ["running", "completed"],
        issueId: undefined,
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
      });
    });

    it("should filter by issueId", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          issue_id: "i-abc",
        },
        {
          id: "exec-2",
          issue_id: "i-abc",
        },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 2,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?issueId=i-abc"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: undefined,
        issueId: "i-abc",
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
      });
    });

    it("should support pagination with limit and offset", async () => {
      const mockExecutions = [
        { id: "exec-11", created_at: "2025-01-01T00:10:00.000Z" },
        { id: "exec-12", created_at: "2025-01-01T00:09:00.000Z" },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 25,
        hasMore: true,
      });

      const response = await request(app).get(
        "/api/executions?limit=10&offset=10"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.executions).toEqual(mockExecutions);
      expect(response.body.data.total).toBe(25);
      expect(response.body.data.hasMore).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: 10,
        offset: 10,
        status: undefined,
        issueId: undefined,
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
      });
    });

    it("should support sorting by created_at descending", async () => {
      const mockExecutions = [
        { id: "exec-2", created_at: "2025-01-01T00:02:00.000Z" },
        { id: "exec-1", created_at: "2025-01-01T00:01:00.000Z" },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 2,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?sortBy=created_at&order=desc"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: undefined,
        issueId: undefined,
        sortBy: "created_at",
        order: "desc",
        since: undefined,
        includeRunning: false,
      });
    });

    it("should support sorting by updated_at ascending", async () => {
      const mockExecutions = [
        { id: "exec-1", updated_at: "2025-01-01T00:01:00.000Z" },
        { id: "exec-2", updated_at: "2025-01-01T00:02:00.000Z" },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 2,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?sortBy=updated_at&order=asc"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: undefined,
        issueId: undefined,
        sortBy: "updated_at",
        order: "asc",
        since: undefined,
        includeRunning: false,
      });
    });

    it("should support combined filters", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          issue_id: "i-abc",
          status: "completed",
        },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 1,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?status=completed&issueId=i-abc&limit=20&offset=0&sortBy=created_at&order=desc"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        status: "completed",
        issueId: "i-abc",
        sortBy: "created_at",
        order: "desc",
        since: undefined,
        includeRunning: false,
      });
    });

    it("should return 400 for invalid limit parameter", async () => {
      const response = await request(app).get("/api/executions?limit=-1");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Invalid limit parameter");
      expect(mockExecutionService.listAll).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid offset parameter", async () => {
      const response = await request(app).get("/api/executions?offset=-5");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Invalid offset parameter");
      expect(mockExecutionService.listAll).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid sortBy parameter", async () => {
      const response = await request(app).get(
        "/api/executions?sortBy=invalid"
      );

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Invalid sortBy parameter. Must be 'created_at' or 'updated_at'"
      );
      expect(mockExecutionService.listAll).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid order parameter", async () => {
      const response = await request(app).get("/api/executions?order=invalid");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Invalid order parameter. Must be 'asc' or 'desc'"
      );
      expect(mockExecutionService.listAll).not.toHaveBeenCalled();
    });

    it("should return 500 on service error", async () => {
      mockExecutionService.listAll = vi
        .fn()
        .mockImplementation(() => {
          throw new Error("Database error");
        });

      const response = await request(app).get("/api/executions");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to list executions");
      expect(response.body.error_data).toBe("Database error");
    });

    it("should filter by single tag", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          issue_id: null,
          config: JSON.stringify({ tags: ["project-assistant"] }),
          status: "running",
        },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 1,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?tags=project-assistant"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.executions).toEqual(mockExecutions);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: undefined,
        issueId: undefined,
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
        tags: ["project-assistant"],
      });
    });

    it("should filter by multiple tags (comma-separated)", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          config: JSON.stringify({ tags: ["project-assistant"] }),
        },
        {
          id: "exec-2",
          config: JSON.stringify({ tags: ["automation"] }),
        },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 2,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?tags=project-assistant,automation"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        status: undefined,
        issueId: undefined,
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
        tags: ["project-assistant", "automation"],
      });
    });

    it("should combine tags with other filters", async () => {
      const mockExecutions = [
        {
          id: "exec-1",
          config: JSON.stringify({ tags: ["project-assistant"] }),
          status: "running",
        },
      ] as Execution[];

      mockExecutionService.listAll = vi.fn().mockReturnValue({
        executions: mockExecutions,
        total: 1,
        hasMore: false,
      });

      const response = await request(app).get(
        "/api/executions?tags=project-assistant&status=running&limit=10"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockExecutionService.listAll).toHaveBeenCalledWith({
        limit: 10,
        offset: undefined,
        status: "running",
        issueId: undefined,
        sortBy: undefined,
        order: undefined,
        since: undefined,
        includeRunning: false,
        tags: ["project-assistant"],
      });
    });
  });
});
