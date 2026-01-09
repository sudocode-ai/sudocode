/**
 * Unit tests for execution interrupt endpoint
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";

// Mock ExecutionService with interrupt methods
const mockExecutionService = {
  interruptExecution: vi.fn(),
  interruptWithPrompt: vi.fn(),
};

describe("Execution Interrupt Endpoint", () => {
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

  describe("POST /api/executions/:executionId/interrupt", () => {
    it("should return 404 if execution not found", async () => {
      mockExecutionService.interruptExecution.mockImplementation(() => {
        throw new Error("Execution exec-123 not found");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not found");
    });

    it("should return 404 if execution not active", async () => {
      mockExecutionService.interruptExecution.mockImplementation(() => {
        throw new Error("Execution exec-123 not found or not active");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not active");
    });

    it("should return 400 if execution is not an ACP execution", async () => {
      mockExecutionService.interruptExecution.mockImplementation(() => {
        throw new Error(
          "Execution exec-123 is not an ACP execution and does not support interruption"
        );
      });

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not an ACP execution");
    });

    it("should return 200 on successful simple interrupt", async () => {
      mockExecutionService.interruptExecution.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        executionId: "exec-123",
        interrupted: true,
      });
      expect(response.body.message).toBe("Execution interrupted");

      expect(mockExecutionService.interruptExecution).toHaveBeenCalledWith(
        "exec-123"
      );
    });

    it("should return 404 if interrupt returns false", async () => {
      mockExecutionService.interruptExecution.mockResolvedValue(false);

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Failed to interrupt");
    });

    it("should call interruptWithPrompt when prompt is provided", async () => {
      mockExecutionService.interruptWithPrompt.mockResolvedValue(undefined);

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({ prompt: "New context to focus on" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        executionId: "exec-123",
        interrupted: true,
        redirected: true,
      });
      expect(response.body.message).toBe("Execution interrupted and redirected");

      expect(mockExecutionService.interruptWithPrompt).toHaveBeenCalledWith(
        "exec-123",
        "New context to focus on"
      );
      expect(mockExecutionService.interruptExecution).not.toHaveBeenCalled();
    });

    it("should not call interruptWithPrompt for empty prompt", async () => {
      mockExecutionService.interruptExecution.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({ prompt: "" });

      expect(response.status).toBe(200);
      expect(mockExecutionService.interruptExecution).toHaveBeenCalled();
      expect(mockExecutionService.interruptWithPrompt).not.toHaveBeenCalled();
    });

    it("should not call interruptWithPrompt for whitespace-only prompt", async () => {
      mockExecutionService.interruptExecution.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({ prompt: "   " });

      expect(response.status).toBe(200);
      expect(mockExecutionService.interruptExecution).toHaveBeenCalled();
      expect(mockExecutionService.interruptWithPrompt).not.toHaveBeenCalled();
    });

    it("should return 500 for unexpected errors", async () => {
      mockExecutionService.interruptExecution.mockImplementation(() => {
        throw new Error("Unexpected internal error");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("Unexpected internal error");
    });

    it("should handle interruptWithPrompt errors", async () => {
      mockExecutionService.interruptWithPrompt.mockImplementation(() => {
        throw new Error("Failed to process new prompt");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/interrupt")
        .send({ prompt: "New context" });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("Failed to process new prompt");
    });
  });
});
