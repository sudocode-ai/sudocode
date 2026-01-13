/**
 * Unit tests for execution permission endpoints
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";

// Mock ExecutionService with permission methods
const mockExecutionService = {
  respondToPermission: vi.fn(),
  hasPendingPermissions: vi.fn(),
  getPendingPermissionIds: vi.fn(),
};

describe("Execution Permission Endpoints", () => {
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

  describe("POST /api/executions/:executionId/permission/:requestId", () => {
    it("should return 400 if optionId is missing", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/permission/req-456")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("optionId is required");
    });

    it("should return 400 if optionId is not a string", async () => {
      const response = await request(app)
        .post("/api/executions/exec-123/permission/req-456")
        .send({ optionId: 123 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("optionId is required");
    });

    it("should return 404 if permission request not found", async () => {
      mockExecutionService.respondToPermission.mockReturnValue(false);

      const response = await request(app)
        .post("/api/executions/exec-123/permission/req-456")
        .send({ optionId: "allow_once" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("should return 404 if execution not found", async () => {
      mockExecutionService.respondToPermission.mockImplementation(() => {
        throw new Error("Execution exec-123 not found or not active");
      });

      const response = await request(app)
        .post("/api/executions/exec-123/permission/req-456")
        .send({ optionId: "allow_once" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error_data).toContain("not found");
    });

    it("should return 200 on successful permission response", async () => {
      mockExecutionService.respondToPermission.mockReturnValue(true);

      const response = await request(app)
        .post("/api/executions/exec-123/permission/req-456")
        .send({ optionId: "allow_once" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        executionId: "exec-123",
        requestId: "req-456",
        optionId: "allow_once",
      });

      expect(mockExecutionService.respondToPermission).toHaveBeenCalledWith(
        "exec-123",
        "req-456",
        "allow_once"
      );
    });

    it("should handle different option IDs", async () => {
      mockExecutionService.respondToPermission.mockReturnValue(true);

      for (const optionId of [
        "allow_once",
        "allow_always",
        "deny_once",
        "deny_always",
      ]) {
        const response = await request(app)
          .post("/api/executions/exec-123/permission/req-456")
          .send({ optionId });

        expect(response.status).toBe(200);
        expect(response.body.data.optionId).toBe(optionId);
      }
    });
  });

  describe("GET /api/executions/:executionId/permissions", () => {
    it("should return pending permission info", async () => {
      mockExecutionService.hasPendingPermissions.mockReturnValue(true);
      mockExecutionService.getPendingPermissionIds.mockReturnValue([
        "req-1",
        "req-2",
      ]);

      const response = await request(app).get(
        "/api/executions/exec-123/permissions"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        executionId: "exec-123",
        hasPending: true,
        pendingRequestIds: ["req-1", "req-2"],
      });
    });

    it("should return empty array when no pending permissions", async () => {
      mockExecutionService.hasPendingPermissions.mockReturnValue(false);
      mockExecutionService.getPendingPermissionIds.mockReturnValue([]);

      const response = await request(app).get(
        "/api/executions/exec-123/permissions"
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        executionId: "exec-123",
        hasPending: false,
        pendingRequestIds: [],
      });
    });

    it("should handle errors gracefully", async () => {
      mockExecutionService.getPendingPermissionIds.mockImplementation(() => {
        throw new Error("Database error");
      });

      const response = await request(app).get(
        "/api/executions/exec-123/permissions"
      );

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });
});
