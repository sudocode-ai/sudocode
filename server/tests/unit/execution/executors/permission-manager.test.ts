/**
 * Unit tests for PermissionManager
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PermissionManager } from "../../../../src/execution/executors/permission-manager.js";

describe("PermissionManager", () => {
  let manager: PermissionManager;

  beforeEach(() => {
    manager = new PermissionManager();
  });

  describe("addPending", () => {
    it("should add a pending permission request", () => {
      const permission = {
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: {
          toolCallId: "tool-789",
          title: "Bash",
          status: "pending",
          rawInput: { command: "ls -la" },
        },
        options: [
          { optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const },
          { optionId: "allow_always", name: "Allow Always", kind: "allow_always" as const },
          { optionId: "reject_once", name: "Reject Once", kind: "deny_once" as const },
        ],
      };

      // Start the promise but don't await it
      const promise = manager.addPending(permission);

      expect(manager.hasPending("req-123")).toBe(true);
      expect(manager.pendingCount).toBe(1);

      // Resolve it to clean up
      manager.respond("req-123", "allow_once");
    });

    it("should return promise that resolves with selected option", async () => {
      const permission = {
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: { toolCallId: "tool-789", title: "Bash", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
      };

      const promise = manager.addPending(permission);

      // Respond in next tick
      setTimeout(() => {
        manager.respond("req-123", "allow_once");
      }, 0);

      const result = await promise;
      expect(result).toBe("allow_once");
    });

    it("should return promise that rejects when cancelled", async () => {
      const permission = {
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: { toolCallId: "tool-789", title: "Bash", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
      };

      const promise = manager.addPending(permission);

      // Cancel in next tick
      setTimeout(() => {
        manager.cancel("req-123");
      }, 0);

      await expect(promise).rejects.toThrow("Permission request cancelled");
    });
  });

  describe("respond", () => {
    it("should resolve pending permission with option ID", async () => {
      const permission = {
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: { toolCallId: "tool-789", title: "Bash", status: "pending" },
        options: [
          { optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const },
          { optionId: "reject_always", name: "Reject Always", kind: "deny_always" as const },
        ],
      };

      const promise = manager.addPending(permission);
      const success = manager.respond("req-123", "reject_always");

      expect(success).toBe(true);
      expect(manager.hasPending("req-123")).toBe(false);

      const result = await promise;
      expect(result).toBe("reject_always");
    });

    it("should return false for non-existent request", () => {
      const success = manager.respond("non-existent", "allow_once");
      expect(success).toBe(false);
    });

    it("should remove request from pending after response", () => {
      const permission = {
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: { toolCallId: "tool-789", title: "Bash", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
      };

      manager.addPending(permission);
      expect(manager.pendingCount).toBe(1);

      manager.respond("req-123", "allow_once");
      expect(manager.pendingCount).toBe(0);
    });
  });

  describe("cancel", () => {
    it("should reject pending permission with error", async () => {
      const permission = {
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: { toolCallId: "tool-789", title: "Write", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
      };

      const promise = manager.addPending(permission);
      const success = manager.cancel("req-123");

      expect(success).toBe(true);
      expect(manager.hasPending("req-123")).toBe(false);

      await expect(promise).rejects.toThrow("Permission request cancelled");
    });

    it("should return false for non-existent request", () => {
      const success = manager.cancel("non-existent");
      expect(success).toBe(false);
    });
  });

  describe("getPending", () => {
    it("should return pending permission details", () => {
      const permission = {
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: {
          toolCallId: "tool-789",
          title: "Edit",
          status: "pending",
          rawInput: { file_path: "/tmp/test.txt" },
        },
        options: [
          { optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const },
          { optionId: "reject_once", name: "Reject Once", kind: "deny_once" as const },
        ],
      };

      manager.addPending(permission);

      const pending = manager.getPending("req-123");

      expect(pending).toBeDefined();
      expect(pending?.requestId).toBe("req-123");
      expect(pending?.sessionId).toBe("session-456");
      expect(pending?.toolCall.title).toBe("Edit");
      expect(pending?.options).toHaveLength(2);
      expect(pending?.createdAt).toBeInstanceOf(Date);

      // Clean up
      manager.respond("req-123", "allow_once");
    });

    it("should return undefined for non-existent request", () => {
      const pending = manager.getPending("non-existent");
      expect(pending).toBeUndefined();
    });
  });

  describe("getPendingIds", () => {
    it("should return all pending request IDs", () => {
      const permissions = [
        {
          requestId: "req-1",
          sessionId: "session-1",
          toolCall: { toolCallId: "tool-1", title: "Bash", status: "pending" },
          options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
        },
        {
          requestId: "req-2",
          sessionId: "session-1",
          toolCall: { toolCallId: "tool-2", title: "Write", status: "pending" },
          options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
        },
        {
          requestId: "req-3",
          sessionId: "session-2",
          toolCall: { toolCallId: "tool-3", title: "Edit", status: "pending" },
          options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
        },
      ];

      for (const p of permissions) {
        manager.addPending(p);
      }

      const ids = manager.getPendingIds();

      expect(ids).toHaveLength(3);
      expect(ids).toContain("req-1");
      expect(ids).toContain("req-2");
      expect(ids).toContain("req-3");

      // Clean up
      for (const p of permissions) {
        manager.respond(p.requestId, "allow_once");
      }
    });
  });

  describe("cancelAll", () => {
    it("should cancel all pending permissions", async () => {
      const permissions = [
        {
          requestId: "req-1",
          sessionId: "session-1",
          toolCall: { toolCallId: "tool-1", title: "Bash", status: "pending" },
          options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
        },
        {
          requestId: "req-2",
          sessionId: "session-1",
          toolCall: { toolCallId: "tool-2", title: "Write", status: "pending" },
          options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
        },
      ];

      const promises = permissions.map((p) => manager.addPending(p));

      expect(manager.pendingCount).toBe(2);

      const cancelledCount = manager.cancelAll();

      expect(cancelledCount).toBe(2);
      expect(manager.pendingCount).toBe(0);

      // All promises should reject
      for (const promise of promises) {
        await expect(promise).rejects.toThrow("All permissions cancelled");
      }
    });

    it("should return 0 when no pending permissions", () => {
      const count = manager.cancelAll();
      expect(count).toBe(0);
    });
  });

  describe("hasPending", () => {
    it("should return true for existing pending request", () => {
      manager.addPending({
        requestId: "req-123",
        sessionId: "session-456",
        toolCall: { toolCallId: "tool-789", title: "Bash", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
      });

      expect(manager.hasPending("req-123")).toBe(true);

      // Clean up
      manager.respond("req-123", "allow_once");
    });

    it("should return false for non-existent request", () => {
      expect(manager.hasPending("non-existent")).toBe(false);
    });
  });

  describe("pendingCount", () => {
    it("should track count of pending permissions", async () => {
      expect(manager.pendingCount).toBe(0);

      const promise1 = manager.addPending({
        requestId: "req-1",
        sessionId: "session-1",
        toolCall: { toolCallId: "tool-1", title: "Bash", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
      });
      expect(manager.pendingCount).toBe(1);

      const promise2 = manager.addPending({
        requestId: "req-2",
        sessionId: "session-1",
        toolCall: { toolCallId: "tool-2", title: "Write", status: "pending" },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" as const }],
      });
      expect(manager.pendingCount).toBe(2);

      manager.respond("req-1", "allow_once");
      expect(manager.pendingCount).toBe(1);

      manager.cancel("req-2");
      expect(manager.pendingCount).toBe(0);

      // Await promises to handle rejections
      await promise1;
      await expect(promise2).rejects.toThrow();
    });
  });
});
