/**
 * Unit tests for execution mode switching endpoint
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";

// Mock ExecutionService with setMode method
const mockExecutionService = {
  setMode: vi.fn(),
};

describe("Execution Mode Endpoint", () => {
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

  describe("POST /api/executions/:executionId/mode", () => {
    it("should return 400 if mode is missing", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/mode")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("mode is required");
    });

    it("should return 400 if mode is not a string", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/mode")
        .send({ mode: 123 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("mode is required");
    });

    it("should return 404 if execution not found", async () => {
      mockExecutionService.setMode.mockImplementation(() => {
        throw new Error("Execution exec-123 not found or not active");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/mode")
        .send({ mode: "architect" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not found");
    });

    it("should return 404 if setMode returns false", async () => {
      mockExecutionService.setMode.mockReturnValue(false);

      const response = await request(app)
        .post("/api/executions/exec-123/mode")
        .send({ mode: "architect" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Failed to set mode");
    });

    it("should return 200 on successful mode switch", async () => {
      mockExecutionService.setMode.mockReturnValue(true);

      const response = await request(app)
        .post("/api/executions/exec-123/mode")
        .send({ mode: "architect" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        executionId: "exec-123",
        mode: "architect",
      });

      expect(mockExecutionService.setMode).toHaveBeenCalledWith(
        "exec-123",
        "architect"
      );
    });

    it("should handle different mode values", async () => {
      mockExecutionService.setMode.mockReturnValue(true);

      for (const mode of ["code", "plan", "architect", "debug"]) {
        const response = await request(app)
          .post("/api/executions/exec-123/mode")
          .send({ mode });

        expect(response.status).toBe(200);
        expect(response.body.data.mode).toBe(mode);
      }
    });

    it("should return 500 for unexpected errors", async () => {
      mockExecutionService.setMode.mockImplementation(() => {
        throw new Error("Unexpected internal error");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/mode")
        .send({ mode: "architect" });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("Unexpected internal error");
    });
  });
});
