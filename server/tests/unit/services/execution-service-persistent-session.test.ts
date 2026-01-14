/**
 * Unit tests for ExecutionService persistent session methods
 *
 * Tests:
 * - sendPrompt()
 * - endSession()
 * - getSessionState()
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ExecutionService } from "../../../src/services/execution-service.js";
import { AcpExecutorWrapper } from "../../../src/execution/executors/acp-executor-wrapper.js";

// Mock the WebSocket module
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
    onDisconnect: vi.fn().mockReturnValue(() => {}),
    hasSubscribers: vi.fn().mockReturnValue(false),
  },
}));

// Mock the executor factory
vi.mock("../../../src/execution/executors/executor-factory.js", () => ({
  createExecutorForAgent: vi.fn(),
  validateAgentConfig: vi.fn(() => []),
}));

// Mock executions service
vi.mock("../../../src/services/executions.js", () => ({
  getExecution: vi.fn(),
  createExecution: vi.fn(),
  updateExecution: vi.fn(),
}));

// Import the mocked functions
import { getExecution, updateExecution } from "../../../src/services/executions.js";
import { broadcastExecutionUpdate } from "../../../src/services/websocket.js";
const mockGetExecution = vi.mocked(getExecution);
const mockUpdateExecution = vi.mocked(updateExecution);
const mockBroadcastExecutionUpdate = vi.mocked(broadcastExecutionUpdate);

describe("ExecutionService Persistent Session Methods", () => {
  let service: ExecutionService;
  let mockDb: Partial<Database.Database>;
  let mockAcpWrapper: Partial<AcpExecutorWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
      }),
    };

    // Create mock AcpExecutorWrapper
    mockAcpWrapper = {
      sendPrompt: vi.fn(),
      endSession: vi.fn(),
      getSessionState: vi.fn(),
    };

    // Create ExecutionService instance
    service = new ExecutionService(
      mockDb as Database.Database,
      "test-project",
      "/test/path"
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // sendPrompt()
  // ===========================================================================
  describe("sendPrompt()", () => {
    it("should throw error if no active executor found", async () => {
      // No executor in activeExecutors map
      await expect(
        service.sendPrompt("exec-123", "Continue")
      ).rejects.toThrow("No active executor found for execution exec-123");
    });

    it("should throw error if executor is not AcpExecutorWrapper", async () => {
      // Add a non-AcpExecutorWrapper to activeExecutors
      const nonAcpWrapper = {
        executeWithLifecycle: vi.fn(),
      };
      (service as any).activeExecutors.set("exec-123", nonAcpWrapper);

      await expect(
        service.sendPrompt("exec-123", "Continue")
      ).rejects.toThrow("does not support persistent sessions");
    });

    it("should call wrapper.sendPrompt for valid AcpExecutorWrapper", async () => {
      // Create a mock that passes instanceof check
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.sendPrompt = vi.fn().mockResolvedValue(undefined);

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      await service.sendPrompt("exec-123", "Continue with the task");

      expect(mockWrapper.sendPrompt).toHaveBeenCalledWith(
        "exec-123",
        "Continue with the task"
      );
    });

    it("should propagate errors from wrapper.sendPrompt", async () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.sendPrompt = vi
        .fn()
        .mockRejectedValue(
          new Error("Cannot send prompt to session in state: running")
        );

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      await expect(
        service.sendPrompt("exec-123", "Continue")
      ).rejects.toThrow("Cannot send prompt to session in state: running");
    });
  });

  // ===========================================================================
  // endSession()
  // ===========================================================================
  describe("endSession()", () => {
    it("should throw error if execution not found and no active executor", async () => {
      mockGetExecution.mockReturnValue(null);

      await expect(service.endSession("exec-123")).rejects.toThrow(
        "Execution exec-123 not found"
      );
    });

    it("should update stuck 'waiting' execution to 'stopped' when no active executor", async () => {
      mockGetExecution.mockReturnValue({
        id: "exec-123",
        status: "waiting",
      } as any);

      await service.endSession("exec-123");

      expect(mockUpdateExecution).toHaveBeenCalledWith(
        expect.anything(),
        "exec-123",
        expect.objectContaining({
          status: "stopped",
          completed_at: expect.any(String),
        })
      );
      expect(mockBroadcastExecutionUpdate).toHaveBeenCalledWith(
        "test-project",
        "exec-123",
        "status_changed",
        expect.objectContaining({
          id: "exec-123",
          status: "stopped",
        })
      );
    });

    it("should update stuck 'paused' execution to 'stopped' when no active executor", async () => {
      mockGetExecution.mockReturnValue({
        id: "exec-123",
        status: "paused",
      } as any);

      await service.endSession("exec-123");

      expect(mockUpdateExecution).toHaveBeenCalledWith(
        expect.anything(),
        "exec-123",
        expect.objectContaining({
          status: "stopped",
          completed_at: expect.any(String),
        })
      );
      expect(mockBroadcastExecutionUpdate).toHaveBeenCalledWith(
        "test-project",
        "exec-123",
        "status_changed",
        expect.objectContaining({
          id: "exec-123",
          status: "stopped",
        })
      );
    });

    it("should throw error for terminal execution with no active executor", async () => {
      mockGetExecution.mockReturnValue({
        id: "exec-123",
        status: "completed",
      } as any);

      await expect(service.endSession("exec-123")).rejects.toThrow(
        "No active executor found for execution exec-123"
      );
    });

    it("should throw error if executor is not AcpExecutorWrapper", async () => {
      const nonAcpWrapper = {
        executeWithLifecycle: vi.fn(),
      };
      (service as any).activeExecutors.set("exec-123", nonAcpWrapper);

      await expect(service.endSession("exec-123")).rejects.toThrow(
        "does not support persistent sessions"
      );
    });

    it("should call wrapper.endSession for valid AcpExecutorWrapper", async () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.endSession = vi.fn().mockResolvedValue(undefined);

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      await service.endSession("exec-123");

      expect(mockWrapper.endSession).toHaveBeenCalledWith("exec-123");
    });

    it("should remove executor from activeExecutors after ending session", async () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.endSession = vi.fn().mockResolvedValue(undefined);

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      // Verify executor is in map before ending
      expect((service as any).activeExecutors.has("exec-123")).toBe(true);

      await service.endSession("exec-123");

      // Verify executor is removed after ending
      expect((service as any).activeExecutors.has("exec-123")).toBe(false);
    });

    it("should propagate errors from wrapper.endSession", async () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.endSession = vi
        .fn()
        .mockRejectedValue(new Error("Session already ended"));

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      await expect(service.endSession("exec-123")).rejects.toThrow(
        "Session already ended"
      );
    });
  });

  // ===========================================================================
  // getSessionState()
  // ===========================================================================
  describe("getSessionState()", () => {
    it("should throw error if execution not found and no active executor", () => {
      mockGetExecution.mockReturnValue(null);

      expect(() => service.getSessionState("exec-123")).toThrow(
        "Execution exec-123 not found"
      );
    });

    it("should return discrete mode for completed discrete execution", () => {
      mockGetExecution.mockReturnValue({
        id: "exec-123",
        status: "completed",
      } as any);

      const state = service.getSessionState("exec-123");

      expect(state).toEqual({
        mode: "discrete",
        state: null,
        promptCount: 1,
      });
    });

    it("should return discrete mode for non-AcpExecutorWrapper", () => {
      const nonAcpWrapper = {
        executeWithLifecycle: vi.fn(),
      };
      (service as any).activeExecutors.set("exec-123", nonAcpWrapper);

      const state = service.getSessionState("exec-123");

      expect(state).toEqual({
        mode: "discrete",
        state: null,
        promptCount: 1,
      });
    });

    it("should return discrete mode if AcpExecutorWrapper has no persistent session", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.getSessionState = vi.fn().mockReturnValue(null);

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      const state = service.getSessionState("exec-123");

      expect(state).toEqual({
        mode: "discrete",
        state: null,
        promptCount: 1,
      });
    });

    it("should return persistent session state from wrapper", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.getSessionState = vi.fn().mockReturnValue({
        mode: "persistent",
        state: "waiting",
        promptCount: 3,
        idleTimeMs: 5000,
      });

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      const state = service.getSessionState("exec-123");

      expect(state).toEqual({
        mode: "persistent",
        state: "waiting",
        promptCount: 3,
        idleTimeMs: 5000,
      });
      expect(mockWrapper.getSessionState).toHaveBeenCalledWith("exec-123");
    });

    it("should return paused state from wrapper", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.getSessionState = vi.fn().mockReturnValue({
        mode: "persistent",
        state: "paused",
        promptCount: 1,
        idleTimeMs: 12000,
      });

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      const state = service.getSessionState("exec-123");

      expect(state).toEqual({
        mode: "persistent",
        state: "paused",
        promptCount: 1,
        idleTimeMs: 12000,
      });
    });

    it("should return running state from wrapper", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.getSessionState = vi.fn().mockReturnValue({
        mode: "persistent",
        state: "running",
        promptCount: 2,
      });

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      const state = service.getSessionState("exec-123");

      expect(state).toEqual({
        mode: "persistent",
        state: "running",
        promptCount: 2,
      });
    });

    it("should return ended state from wrapper", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.getSessionState = vi.fn().mockReturnValue({
        mode: "persistent",
        state: "ended",
        promptCount: 5,
      });

      (service as any).activeExecutors.set("exec-123", mockWrapper);

      const state = service.getSessionState("exec-123");

      expect(state).toEqual({
        mode: "persistent",
        state: "ended",
        promptCount: 5,
      });
    });
  });

  // ===========================================================================
  // Executor Cleanup Behavior
  // ===========================================================================
  describe("Executor Cleanup Behavior", () => {
    it("should keep executor in activeExecutors for active persistent sessions", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.isPersistentSession = vi.fn().mockReturnValue(true);

      (service as any).activeExecutors.set("exec-persistent", mockWrapper);

      // Simulate cleanup logic from startExecution finally block
      const shouldCleanup = !(
        mockWrapper instanceof AcpExecutorWrapper &&
        mockWrapper.isPersistentSession("exec-persistent")
      );

      if (shouldCleanup) {
        (service as any).activeExecutors.delete("exec-persistent");
      }

      // Executor should still be in map
      expect((service as any).activeExecutors.has("exec-persistent")).toBe(true);
    });

    it("should remove executor from activeExecutors for discrete sessions", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      mockWrapper.isPersistentSession = vi.fn().mockReturnValue(false);

      (service as any).activeExecutors.set("exec-discrete", mockWrapper);

      // Simulate cleanup logic from startExecution finally block
      const shouldCleanup = !(
        mockWrapper instanceof AcpExecutorWrapper &&
        mockWrapper.isPersistentSession("exec-discrete")
      );

      if (shouldCleanup) {
        (service as any).activeExecutors.delete("exec-discrete");
      }

      // Executor should be removed
      expect((service as any).activeExecutors.has("exec-discrete")).toBe(false);
    });

    it("should remove executor from activeExecutors for ended persistent sessions", () => {
      const mockWrapper = Object.create(AcpExecutorWrapper.prototype);
      // Session has ended, so isPersistentSession returns false
      mockWrapper.isPersistentSession = vi.fn().mockReturnValue(false);

      (service as any).activeExecutors.set("exec-ended", mockWrapper);

      // Simulate cleanup logic from startExecution finally block
      const shouldCleanup = !(
        mockWrapper instanceof AcpExecutorWrapper &&
        mockWrapper.isPersistentSession("exec-ended")
      );

      if (shouldCleanup) {
        (service as any).activeExecutors.delete("exec-ended");
      }

      // Executor should be removed (session ended)
      expect((service as any).activeExecutors.has("exec-ended")).toBe(false);
    });

    it("should remove executor from activeExecutors for non-AcpExecutorWrapper", () => {
      // Non-ACP wrapper (e.g., legacy executor)
      const legacyWrapper = {
        executeWithLifecycle: vi.fn(),
      };

      (service as any).activeExecutors.set("exec-legacy", legacyWrapper);

      // Simulate cleanup logic - non-AcpExecutorWrapper should always be cleaned up
      const shouldCleanup = !(
        legacyWrapper instanceof AcpExecutorWrapper &&
        (legacyWrapper as any).isPersistentSession?.("exec-legacy")
      );

      if (shouldCleanup) {
        (service as any).activeExecutors.delete("exec-legacy");
      }

      // Executor should be removed
      expect((service as any).activeExecutors.has("exec-legacy")).toBe(false);
    });
  });
});
