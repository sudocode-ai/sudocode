/**
 * Execution-Workflow Integration Tests
 *
 * Tests for Phase 5d integration points between execution lifecycle
 * and workflow orchestration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerExecutionCallback,
  notifyExecutionEvent,
  clearAllCallbacks,
  getCallbackCount,
  type ExecutionEventCallback,
  type ExecutionEventType,
  type ExecutionEventData,
} from "../../../src/services/execution-event-callbacks.js";

describe("Execution-Workflow Integration", () => {
  beforeEach(() => {
    clearAllCallbacks();
  });

  afterEach(() => {
    clearAllCallbacks();
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Execution Event Callbacks
  // ===========================================================================

  describe("execution event callbacks", () => {
    it("should notify callbacks on execution completion", async () => {
      const callback = vi.fn();
      registerExecutionCallback(callback);

      const data: ExecutionEventData = {
        executionId: "exec-123",
        workflowId: "wf-456",
        issueId: "i-abc",
      };

      await notifyExecutionEvent("completed", data);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith("completed", data);
    });

    it("should notify callbacks on execution failure", async () => {
      const callback = vi.fn();
      registerExecutionCallback(callback);

      const data: ExecutionEventData = {
        executionId: "exec-123",
        workflowId: "wf-456",
        issueId: "i-abc",
        error: "Something went wrong",
      };

      await notifyExecutionEvent("failed", data);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith("failed", data);
    });

    it("should notify callbacks on execution cancellation", async () => {
      const callback = vi.fn();
      registerExecutionCallback(callback);

      const data: ExecutionEventData = {
        executionId: "exec-123",
      };

      await notifyExecutionEvent("cancelled", data);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith("cancelled", data);
    });

    it("should include workflow context in callback data", async () => {
      const callback = vi.fn();
      registerExecutionCallback(callback);

      const data: ExecutionEventData = {
        executionId: "exec-123",
        workflowId: "wf-456",
        issueId: "i-abc",
      };

      await notifyExecutionEvent("completed", data);

      const receivedData = callback.mock.calls[0][1] as ExecutionEventData;
      expect(receivedData.workflowId).toBe("wf-456");
      expect(receivedData.issueId).toBe("i-abc");
    });

    it("should handle callback errors gracefully", async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error("Callback failed"));
      const successCallback = vi.fn();

      registerExecutionCallback(errorCallback);
      registerExecutionCallback(successCallback);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await notifyExecutionEvent("completed", { executionId: "exec-123" });

      // Both callbacks should be called despite error in first
      expect(errorCallback).toHaveBeenCalledOnce();
      expect(successCallback).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should allow unregistering callbacks", async () => {
      const callback = vi.fn();
      const unregister = registerExecutionCallback(callback);

      expect(getCallbackCount()).toBe(1);

      unregister();

      expect(getCallbackCount()).toBe(0);

      await notifyExecutionEvent("completed", { executionId: "exec-123" });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should notify multiple callbacks", async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      registerExecutionCallback(callback1);
      registerExecutionCallback(callback2);
      registerExecutionCallback(callback3);

      expect(getCallbackCount()).toBe(3);

      await notifyExecutionEvent("completed", { executionId: "exec-123" });

      expect(callback1).toHaveBeenCalledOnce();
      expect(callback2).toHaveBeenCalledOnce();
      expect(callback3).toHaveBeenCalledOnce();
    });

    it("should handle empty callback list", async () => {
      // No callbacks registered
      expect(getCallbackCount()).toBe(0);

      // Should not throw
      await expect(
        notifyExecutionEvent("completed", { executionId: "exec-123" })
      ).resolves.toBeUndefined();
    });

    it("should execute callbacks sequentially", async () => {
      const order: number[] = [];

      registerExecutionCallback(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      });

      registerExecutionCallback(async () => {
        order.push(2);
      });

      registerExecutionCallback(async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(3);
      });

      await notifyExecutionEvent("completed", { executionId: "exec-123" });

      // Should execute in registration order, not completion order
      expect(order).toEqual([1, 2, 3]);
    });
  });

  // ===========================================================================
  // Callback Data Validation
  // ===========================================================================

  describe("callback data validation", () => {
    it("should handle data without workflow context", async () => {
      const callback = vi.fn();
      registerExecutionCallback(callback);

      const data: ExecutionEventData = {
        executionId: "exec-123",
        // No workflowId or issueId
      };

      await notifyExecutionEvent("completed", data);

      const receivedData = callback.mock.calls[0][1] as ExecutionEventData;
      expect(receivedData.workflowId).toBeUndefined();
      expect(receivedData.issueId).toBeUndefined();
    });

    it("should preserve error message in failure data", async () => {
      const callback = vi.fn();
      registerExecutionCallback(callback);

      const errorMessage = "Process exited with code 1";
      const data: ExecutionEventData = {
        executionId: "exec-123",
        error: errorMessage,
      };

      await notifyExecutionEvent("failed", data);

      const receivedData = callback.mock.calls[0][1] as ExecutionEventData;
      expect(receivedData.error).toBe(errorMessage);
    });
  });
});
