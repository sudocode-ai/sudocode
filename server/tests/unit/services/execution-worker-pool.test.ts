/**
 * ExecutionWorkerPool Tests
 *
 * Tests for the worker pool that manages isolated execution processes.
 *
 * @module services/tests/execution-worker-pool
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { ExecutionWorkerPool } from "../../../src/services/execution-worker-pool.js";
import type { Execution } from "@sudocode-ai/types";
import { fork } from "child_process";

// Mock child_process.fork
vi.mock("child_process", () => ({
  fork: vi.fn(),
}));

// TODO: Unskip when execution worker pools are re-enabled.
describe.skip("ExecutionWorkerPool", () => {
  let pool: ExecutionWorkerPool;
  let mockChildProcess: any;

  const mockExecution: Execution = {
    id: "exec-123",
    issue_id: "i-abc",
    agent_type: "claude-code",
    mode: "worktree",
    status: "pending",
    prompt: "Test prompt",
    config: JSON.stringify({ model: "claude-sonnet-4" }),
    target_branch: "main",
    branch_name: "issue-i-abc",
    worktree_path: "/tmp/worktree-123",
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock child process
    mockChildProcess = {
      pid: 12345,
      send: vi.fn(),
      kill: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
      },
    };

    // Mock fork to return our mock child process
    vi.mocked(fork).mockReturnValue(mockChildProcess as any);

    pool = new ExecutionWorkerPool("project-123");
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  describe("constructor", () => {
    it("should create pool with default config", () => {
      expect(pool.getActiveWorkerCount()).toBe(0);
    });

    it("should accept custom config", () => {
      const customPool = new ExecutionWorkerPool("project-456", {
        maxConcurrentWorkers: 5,
        maxMemoryMB: 1024,
        verbose: true,
      });
      expect(customPool.getActiveWorkerCount()).toBe(0);
    });
  });

  describe("startExecution", () => {
    it("should spawn worker process with correct environment", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      expect(fork).toHaveBeenCalledWith(
        expect.stringContaining("execution-worker"),
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            EXECUTION_ID: "exec-123",
            PROJECT_ID: "project-123",
            REPO_PATH: "/repo/path",
            DB_PATH: "/db/path",
            MAX_MEMORY_MB: "512",
            WORKER_ID: expect.stringContaining("worker-"),
          }),
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          detached: false,
        })
      );
    });

    it("should return worker ID", async () => {
      const workerId = await pool.startExecution(
        mockExecution,
        "/repo/path",
        "/db/path"
      );

      expect(workerId).toMatch(/^worker-exec-123/);
      expect(pool.getActiveWorkerCount()).toBe(1);
    });

    it("should set up IPC message handlers", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      expect(mockChildProcess.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );
      expect(mockChildProcess.on).toHaveBeenCalledWith(
        "exit",
        expect.any(Function)
      );
      expect(mockChildProcess.on).toHaveBeenCalledWith(
        "error",
        expect.any(Function)
      );
    });

    it("should enforce concurrency limit", async () => {
      const customPool = new ExecutionWorkerPool("project-123", {
        maxConcurrentWorkers: 2,
      });

      // Start 2 workers (should succeed)
      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");
      await customPool.startExecution(
        { ...mockExecution, id: "exec-456" },
        "/repo/path",
        "/db/path"
      );

      // Third worker should fail
      await expect(
        customPool.startExecution(
          { ...mockExecution, id: "exec-789" },
          "/repo/path",
          "/db/path"
        )
      ).rejects.toThrow("Maximum concurrent workers");

      await customPool.shutdown();
    });

    it("should set NODE_OPTIONS for memory limit", async () => {
      const customPool = new ExecutionWorkerPool("project-123", {
        maxMemoryMB: 1024,
      });

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      expect(fork).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            NODE_OPTIONS: "--max-old-space-size=1024",
          }),
        })
      );

      await customPool.shutdown();
    });
  });

  describe("worker event handling", () => {
    it("should handle ready message from worker", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      const messageHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )[1];

      messageHandler({
        type: "ready",
        executionId: "exec-123",
        workerId: "worker-123",
      });

      // Worker should still be active
      expect(pool.getActiveWorkerCount()).toBe(1);
    });

    it("should call onLog handler for log events", async () => {
      const onLog = vi.fn();
      const customPool = new ExecutionWorkerPool("project-123", {}, { onLog });

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const messageHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )[1];

      const logEvent = {
        type: "log",
        data: "Test log message",
        timestamp: new Date().toISOString(),
      };

      messageHandler({
        type: "log",
        executionId: "exec-123",
        data: logEvent,
      });

      expect(onLog).toHaveBeenCalledWith("exec-123", logEvent);

      await customPool.shutdown();
    });

    it("should call onStatusChange handler for status events", async () => {
      const onStatusChange = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onStatusChange }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const messageHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )[1];

      messageHandler({
        type: "status",
        executionId: "exec-123",
        status: "running",
      });

      expect(onStatusChange).toHaveBeenCalledWith("exec-123", "running");

      await customPool.shutdown();
    });

    it("should call onComplete handler for complete events", async () => {
      const onComplete = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onComplete }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const messageHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )[1];

      const result = {
        status: "completed" as const,
        exitCode: 0,
        completedAt: new Date().toISOString(),
      };

      messageHandler({
        type: "complete",
        executionId: "exec-123",
        result,
      });

      expect(onComplete).toHaveBeenCalledWith("exec-123", result);

      await customPool.shutdown();
    });

    it("should call onError handler for error events", async () => {
      const onError = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onError }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const messageHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )[1];

      messageHandler({
        type: "error",
        executionId: "exec-123",
        error: "Test error",
        fatal: true,
      });

      expect(onError).toHaveBeenCalledWith("exec-123", "Test error", true);

      await customPool.shutdown();
    });

    it("should ignore invalid IPC messages", async () => {
      const onError = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onError }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const messageHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )[1];

      // Send invalid message
      messageHandler({
        invalid: "message",
      });

      // Should not crash, onError should not be called
      expect(onError).not.toHaveBeenCalled();

      await customPool.shutdown();
    });
  });

  describe("worker exit handling", () => {
    it("should remove worker on normal exit (code 0)", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      const exitHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];

      exitHandler(0, null);

      expect(pool.getActiveWorkerCount()).toBe(0);
    });

    it("should call onError on expected failure (code 1)", async () => {
      const onError = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onError }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const exitHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];

      exitHandler(1, null);

      expect(onError).toHaveBeenCalledWith(
        "exec-123",
        "Execution failed",
        false
      );
      expect(customPool.getActiveWorkerCount()).toBe(0);

      await customPool.shutdown();
    });

    it("should call onCrash and onError on OOM kill (code 137)", async () => {
      const onCrash = vi.fn();
      const onError = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onCrash, onError }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const exitHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];

      exitHandler(137, null);

      expect(onCrash).toHaveBeenCalledWith("exec-123", 137, null);
      expect(onError).toHaveBeenCalledWith(
        "exec-123",
        "Worker killed due to out-of-memory (OOM)",
        true
      );
      expect(customPool.getActiveWorkerCount()).toBe(0);

      await customPool.shutdown();
    });

    it("should call onCrash and onError on SIGKILL", async () => {
      const onCrash = vi.fn();
      const onError = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onCrash, onError }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const exitHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];

      exitHandler(null, "SIGKILL");

      expect(onCrash).toHaveBeenCalledWith("exec-123", null, "SIGKILL");
      expect(onError).toHaveBeenCalledWith(
        "exec-123",
        "Worker killed with signal SIGKILL",
        true
      );

      await customPool.shutdown();
    });

    it("should call onCrash on unexpected exit code", async () => {
      const onCrash = vi.fn();
      const onError = vi.fn();
      const customPool = new ExecutionWorkerPool(
        "project-123",
        {},
        { onCrash, onError }
      );

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      const exitHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];

      exitHandler(42, null);

      expect(onCrash).toHaveBeenCalledWith("exec-123", 42, null);
      expect(onError).toHaveBeenCalledWith(
        "exec-123",
        "Worker exited unexpectedly with code 42",
        true
      );

      await customPool.shutdown();
    });
  });

  describe("cancelExecution", () => {
    it("should send cancel message to worker", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      await pool.cancelExecution("exec-123");

      expect(mockChildProcess.send).toHaveBeenCalledWith({
        type: "cancel",
        executionId: "exec-123",
      });
    });

    it("should send SIGTERM first", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      // Don't await - just start cancellation
      const cancelPromise = pool.cancelExecution("exec-123");

      // Verify SIGTERM was sent
      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGTERM");

      // Simulate immediate exit
      const exitHandler = mockChildProcess.once.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];
      exitHandler();

      await cancelPromise;
    });

    it("should force kill with SIGKILL after timeout", async () => {
      vi.useFakeTimers();

      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      const cancelPromise = pool.cancelExecution("exec-123");

      // Advance timers past the 5 second timeout
      vi.advanceTimersByTime(5000);

      await cancelPromise;

      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");

      vi.useRealTimers();
    });

    it("should throw error if worker not found", async () => {
      await expect(pool.cancelExecution("nonexistent")).rejects.toThrow(
        "Worker for execution nonexistent not found"
      );
    });
  });

  describe("getActiveWorkerCount", () => {
    it("should return 0 initially", () => {
      expect(pool.getActiveWorkerCount()).toBe(0);
    });

    it("should return correct count after starting workers", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");
      expect(pool.getActiveWorkerCount()).toBe(1);

      await pool.startExecution(
        { ...mockExecution, id: "exec-456" },
        "/repo/path",
        "/db/path"
      );
      expect(pool.getActiveWorkerCount()).toBe(2);
    });

    it("should decrease count when worker exits", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");
      expect(pool.getActiveWorkerCount()).toBe(1);

      const exitHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];
      exitHandler(0, null);

      expect(pool.getActiveWorkerCount()).toBe(0);
    });
  });

  describe("hasWorker", () => {
    it("should return false for non-existent worker", () => {
      expect(pool.hasWorker("exec-123")).toBe(false);
    });

    it("should return true for active worker", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");
      expect(pool.hasWorker("exec-123")).toBe(true);
    });

    it("should return false after worker exits", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");
      expect(pool.hasWorker("exec-123")).toBe(true);

      const exitHandler = mockChildProcess.on.mock.calls.find(
        (call: any) => call[0] === "exit"
      )[1];
      exitHandler(0, null);

      expect(pool.hasWorker("exec-123")).toBe(false);
    });
  });

  describe("getWorker", () => {
    it("should return undefined for non-existent worker", () => {
      expect(pool.getWorker("exec-123")).toBeUndefined();
    });

    it("should return worker info for active worker", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      const worker = pool.getWorker("exec-123");
      expect(worker).toBeTruthy();
      expect(worker?.executionId).toBe("exec-123");
      expect(worker?.status).toBe("starting");
      expect(worker?.workerId).toMatch(/^worker-exec-123/);
    });
  });

  describe("shutdown", () => {
    it("should cancel all active workers", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");
      await pool.startExecution(
        { ...mockExecution, id: "exec-456" },
        "/repo/path",
        "/db/path"
      );

      expect(pool.getActiveWorkerCount()).toBe(2);

      await pool.shutdown();

      // Both workers should be killed
      expect(mockChildProcess.kill).toHaveBeenCalled();
      expect(pool.getActiveWorkerCount()).toBe(0);
    });

    it("should be idempotent", async () => {
      await pool.startExecution(mockExecution, "/repo/path", "/db/path");

      await pool.shutdown();
      await pool.shutdown(); // Second shutdown should not throw

      expect(pool.getActiveWorkerCount()).toBe(0);
    });
  });

  describe("verbose mode", () => {
    it("should forward stdout/stderr when verbose is true", async () => {
      const customPool = new ExecutionWorkerPool("project-123", {
        verbose: true,
      });

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      // Verify stdout/stderr handlers were set up
      expect(mockChildProcess.stdout.on).toHaveBeenCalledWith(
        "data",
        expect.any(Function)
      );
      expect(mockChildProcess.stderr.on).toHaveBeenCalledWith(
        "data",
        expect.any(Function)
      );

      await customPool.shutdown();
    });

    it("should not forward stdout/stderr when verbose is false", async () => {
      const customPool = new ExecutionWorkerPool("project-123", {
        verbose: false,
      });

      await customPool.startExecution(mockExecution, "/repo/path", "/db/path");

      // Verify no stdout/stderr handlers
      expect(mockChildProcess.stdout.on).not.toHaveBeenCalled();
      expect(mockChildProcess.stderr.on).not.toHaveBeenCalled();

      await customPool.shutdown();
    });
  });
});
