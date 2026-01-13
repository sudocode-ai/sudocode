/**
 * Unit tests for execution fork endpoint
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";

// Mock ExecutionService with forkExecution method
const mockExecutionService = {
  forkExecution: vi.fn(),
};

describe("Execution Fork Endpoint", () => {
  let app: express.Application;

  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();

    // Create express app with mocked project middleware
    app = express();
    app.use(express.json());

    // Inject mock project into request
    app.use((req, _res, next) => {
      (req as any).project = {
        executionService: mockExecutionService,
        db: {},
        path: "/test/path",
      };
      next();
    });

    // Mount the router
    app.use("/api", createExecutionsRouter());
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("POST /api/executions/:executionId/fork", () => {
    it("should return 404 if execution not found", async () => {
      mockExecutionService.forkExecution.mockImplementation(() => {
        throw new Error("Execution exec-123 not found");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/fork")
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not found");
    });

    it("should return 404 if execution not active", async () => {
      mockExecutionService.forkExecution.mockImplementation(() => {
        throw new Error("Execution exec-123 not found or not active");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/fork")
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not active");
    });

    it("should return 400 if execution is not an ACP execution", async () => {
      mockExecutionService.forkExecution.mockImplementation(() => {
        throw new Error(
          "Execution exec-123 is not an ACP execution and does not support forking"
        );
      });

      const response = await request(app)
        .post("/api/executions/exec-123/fork")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not an ACP execution");
    });

    it("should return 201 on successful fork", async () => {
      const forkedExecution = {
        id: "new-exec-456",
        issue_id: "issue-123",
        agent_type: "claude-code",
        status: "pending",
        prompt: "[Forked from exec-123] Original prompt",
        parent_execution_id: "exec-123",
        created_at: new Date().toISOString(),
      };

      mockExecutionService.forkExecution.mockResolvedValue(forkedExecution);

      const response = await request(app)
        .post("/api/executions/exec-123/fork")
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(forkedExecution);
      expect(response.body.message).toBe("Execution forked successfully");

      expect(mockExecutionService.forkExecution).toHaveBeenCalledWith(
        "exec-123"
      );
    });

    it("should return 500 for unexpected errors", async () => {
      mockExecutionService.forkExecution.mockImplementation(() => {
        throw new Error("Unexpected internal error");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/fork")
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("Unexpected internal error");
    });

    it("should return 500 if fork session fails", async () => {
      mockExecutionService.forkExecution.mockImplementation(() => {
        throw new Error("Failed to fork session for execution exec-123");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/fork")
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("Failed to fork session");
    });
  });
});
