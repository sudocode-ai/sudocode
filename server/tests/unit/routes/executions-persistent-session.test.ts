/**
 * Unit tests for persistent session execution endpoints
 *
 * Tests:
 * - POST /api/executions/:executionId/prompt
 * - POST /api/executions/:executionId/end-session
 * - GET /api/executions/:executionId/session-state
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";

// Mock ExecutionService with persistent session methods
const mockExecutionService = {
  sendPrompt: vi.fn(),
  endSession: vi.fn(),
  getSessionState: vi.fn(),
};

describe("Persistent Session Endpoints", () => {
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

  // ===========================================================================
  // POST /api/executions/:executionId/prompt
  // ===========================================================================
  describe("POST /api/executions/:executionId/prompt", () => {
    it("should return 400 if prompt is missing", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("prompt is required");
    });

    it("should return 400 if prompt is empty string", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: "" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("prompt is required");
    });

    it("should return 400 if prompt is whitespace only", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: "   " });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("prompt is required");
    });

    it("should return 400 if prompt is not a string", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: 123 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("prompt is required");
    });

    it("should return 404 if execution not found", async () => {
      mockExecutionService.sendPrompt.mockRejectedValue(
        new Error("No active executor found for execution exec-123")
      );

      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: "Continue with the task" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("No active executor");
    });

    it("should return 400 if execution does not support persistent sessions", async () => {
      mockExecutionService.sendPrompt.mockRejectedValue(
        new Error("Execution exec-123 does not support persistent sessions")
      );

      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: "Continue with the task" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("does not support");
    });

    it("should return 400 if session is not in pending/paused state", async () => {
      mockExecutionService.sendPrompt.mockRejectedValue(
        new Error("Cannot send prompt to session in state: running")
      );

      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: "Continue with the task" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Cannot send prompt");
    });

    it("should return 200 on successful prompt send", async () => {
      mockExecutionService.sendPrompt.mockResolvedValue(undefined);

      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: "Continue with the task" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Prompt sent to session");
      expect(mockExecutionService.sendPrompt).toHaveBeenCalledWith(
        "exec-123",
        "Continue with the task"
      );
    });

    it("should return 500 for unexpected errors", async () => {
      mockExecutionService.sendPrompt.mockRejectedValue(
        new Error("Unexpected internal error")
      );

      const response = await request(app)
        .post("/api/executions/exec-123/prompt")
        .send({ prompt: "Continue with the task" });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Unexpected internal error");
    });
  });

  // ===========================================================================
  // POST /api/executions/:executionId/end-session
  // ===========================================================================
  describe("POST /api/executions/:executionId/end-session", () => {
    it("should return 404 if execution not found", async () => {
      mockExecutionService.endSession.mockRejectedValue(
        new Error("No active executor found for execution exec-123")
      );

      const response = await request(app)
        .post("/api/executions/exec-123/end-session")
        .send();

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("No active executor");
    });

    it("should return 400 if execution does not support persistent sessions", async () => {
      mockExecutionService.endSession.mockRejectedValue(
        new Error("Execution exec-123 does not support persistent sessions")
      );

      const response = await request(app)
        .post("/api/executions/exec-123/end-session")
        .send();

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("does not support");
    });

    it("should return 200 on successful session end", async () => {
      mockExecutionService.endSession.mockResolvedValue(undefined);

      const response = await request(app)
        .post("/api/executions/exec-123/end-session")
        .send();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Session ended");
      expect(mockExecutionService.endSession).toHaveBeenCalledWith("exec-123");
    });

    it("should return 500 for unexpected errors", async () => {
      mockExecutionService.endSession.mockRejectedValue(
        new Error("Unexpected internal error")
      );

      const response = await request(app)
        .post("/api/executions/exec-123/end-session")
        .send();

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Unexpected internal error");
    });
  });

  // ===========================================================================
  // GET /api/executions/:executionId/session-state
  // ===========================================================================
  describe("GET /api/executions/:executionId/session-state", () => {
    it("should return 404 if execution not found", async () => {
      mockExecutionService.getSessionState.mockImplementation(() => {
        throw new Error("Execution exec-123 not found");
      });

      const response = await request(app).get(
        "/api/executions/exec-123/session-state"
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("not found");
    });

    it("should return discrete mode state for discrete executions", async () => {
      mockExecutionService.getSessionState.mockReturnValue({
        mode: "discrete",
        state: null,
        promptCount: 1,
      });

      const response = await request(app).get(
        "/api/executions/exec-123/session-state"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        mode: "discrete",
        state: null,
        promptCount: 1,
      });
    });

    it("should return persistent mode state when session is pending", async () => {
      mockExecutionService.getSessionState.mockReturnValue({
        mode: "persistent",
        state: "pending",
        promptCount: 3,
        idleTimeMs: 5000,
      });

      const response = await request(app).get(
        "/api/executions/exec-123/session-state"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        mode: "persistent",
        state: "pending",
        promptCount: 3,
        idleTimeMs: 5000,
      });
    });

    it("should return persistent mode state when session is running", async () => {
      mockExecutionService.getSessionState.mockReturnValue({
        mode: "persistent",
        state: "running",
        promptCount: 2,
      });

      const response = await request(app).get(
        "/api/executions/exec-123/session-state"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        mode: "persistent",
        state: "running",
        promptCount: 2,
      });
    });

    it("should return persistent mode state when session is paused", async () => {
      mockExecutionService.getSessionState.mockReturnValue({
        mode: "persistent",
        state: "paused",
        promptCount: 1,
        idleTimeMs: 12000,
      });

      const response = await request(app).get(
        "/api/executions/exec-123/session-state"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        mode: "persistent",
        state: "paused",
        promptCount: 1,
        idleTimeMs: 12000,
      });
    });

    it("should return persistent mode state when session is ended", async () => {
      mockExecutionService.getSessionState.mockReturnValue({
        mode: "persistent",
        state: "ended",
        promptCount: 5,
      });

      const response = await request(app).get(
        "/api/executions/exec-123/session-state"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        mode: "persistent",
        state: "ended",
        promptCount: 5,
      });
    });

    it("should return 500 for unexpected errors", async () => {
      mockExecutionService.getSessionState.mockImplementation(() => {
        throw new Error("Unexpected internal error");
      });

      const response = await request(app).get(
        "/api/executions/exec-123/session-state"
      );

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Unexpected internal error");
    });
  });
});
