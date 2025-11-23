/**
 * Unit Tests for ClaudeExecutorWrapper
 *
 * Tests the wrapper that integrates ClaudeCodeExecutor with sudocode infrastructure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ClaudeExecutorWrapper } from "../../../../src/execution/executors/claude-executor-wrapper.js";
import type {
  ExecutionTask,
  NormalizedEntry,
} from "agent-execution-engine/agents";
import { EventEmitter } from "events";

// Mock dependencies
vi.mock("agent-execution-engine/agents/claude", () => {
  return {
    ClaudeCodeExecutor: vi.fn().mockImplementation(() => ({
      executeTask: vi.fn(),
      resumeTask: vi.fn(),
      createOutputChunks: vi.fn(),
      normalizeOutput: vi.fn(),
    })),
  };
});

vi.mock("../../../../src/services/executions.js", () => ({
  updateExecution: vi.fn(),
  getExecution: vi.fn(() => ({
    id: "exec-1",
    status: "running",
    issue_id: "issue-1",
  })),
}));

vi.mock("../../../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
}));

describe("ClaudeExecutorWrapper", () => {
  let wrapper: ClaudeExecutorWrapper;
  let mockLifecycleService: any;
  let mockLogsStore: any;
  let mockTransportManager: any;
  let mockDb: any;

  beforeEach(() => {
    mockLifecycleService = {
      markStarted: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
    };

    mockLogsStore = {
      appendNormalizedEntry: vi.fn(),
      initializeLogs: vi.fn(),
    };

    mockTransportManager = {
      connectAdapter: vi.fn(),
      disconnectAdapter: vi.fn(),
    };

    mockDb = {
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
      })),
    } as unknown as Database.Database;

    wrapper = new ClaudeExecutorWrapper({
      workDir: "/test/dir",
      lifecycleService: mockLifecycleService,
      logsStore: mockLogsStore,
      projectId: "test-project",
      db: mockDb,
      transportManager: mockTransportManager,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with required dependencies", () => {
      expect(wrapper).toBeDefined();
      expect(wrapper).toBeInstanceOf(ClaudeExecutorWrapper);
    });

    it("should work without transport manager", () => {
      const wrapperWithoutTransport = new ClaudeExecutorWrapper({
        workDir: "/test/dir",
        lifecycleService: mockLifecycleService,
        logsStore: mockLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      expect(wrapperWithoutTransport).toBeDefined();
    });
  });

  describe("executeWithLifecycle", () => {
    it("should execute task successfully", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      // Mock spawned process using EventEmitter
      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      // Mock peer for protocol handling
      const mockPeer = {
        onMessage: vi.fn(),
      };

      // Mock ManagedProcess wrapper
      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      // Get the executor instance from the wrapper
      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      // Mock empty async generators for output streams
      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      // Execute and immediately emit exit event
      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      // Emit exit event after a small delay
      setTimeout(() => {
        mockChildProcess.emit("exit", 0);
      }, 10);

      await executePromise;

      expect(executorInstance.executeTask).toHaveBeenCalledWith(task);
      expect(mockTransportManager.connectAdapter).toHaveBeenCalled();
      expect(mockTransportManager.disconnectAdapter).toHaveBeenCalled();
    });

    it("should process normalized entries and persist logs", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      // Mock normalized output with sample entries
      const sampleEntries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: "assistant_message" },
          content: "Hello world",
          timestamp: new Date(),
        },
        {
          index: 1,
          type: { kind: "assistant_message" },
          content: "Processing...",
          timestamp: new Date(),
        },
      ];

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {
          for (const entry of sampleEntries) {
            yield entry;
          }
        })()
      );

      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      setTimeout(() => {
        mockChildProcess.emit("exit", 0);
      }, 50);

      await executePromise;

      // Verify logs were persisted
      expect(mockLogsStore.appendNormalizedEntry).toHaveBeenCalledTimes(2);
      expect(mockLogsStore.appendNormalizedEntry).toHaveBeenCalledWith(
        "exec-1",
        expect.objectContaining({ index: 0 })
      );
      expect(mockLogsStore.appendNormalizedEntry).toHaveBeenCalledWith(
        "exec-1",
        expect.objectContaining({ index: 1 })
      );
    });

    it("should handle process errors", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      setTimeout(() => {
        mockChildProcess.emit("error", new Error("Process crashed"));
        // After error, process still exits with non-zero code
        mockChildProcess.emit("exit", 1);
      }, 10);

      // The wrapper throws based on exit code, not the error event
      await expect(executePromise).rejects.toThrow(
        "Process exited with code 1"
      );

      // Verify cleanup happened
      expect(mockTransportManager.disconnectAdapter).toHaveBeenCalled();
    });

    it("should handle non-zero exit codes", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      setTimeout(() => {
        mockChildProcess.emit("exit", 1);
      }, 10);

      await expect(executePromise).rejects.toThrow(
        "Process exited with code 1"
      );
    });

    it("should continue processing on log entry errors", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      const sampleEntries: NormalizedEntry[] = [
        {
          index: 0,
          type: { kind: "assistant_message" },
          content: "Entry 1",
          timestamp: new Date(),
        },
        {
          index: 1,
          type: { kind: "assistant_message" },
          content: "Entry 2",
          timestamp: new Date(),
        },
      ];

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {
          for (const entry of sampleEntries) {
            yield entry;
          }
        })()
      );

      // Make first call fail
      mockLogsStore.appendNormalizedEntry
        .mockImplementationOnce(() => {
          throw new Error("DB error");
        })
        .mockImplementation(() => {});

      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      setTimeout(() => {
        mockChildProcess.emit("exit", 0);
      }, 50);

      // Should not throw despite log error
      await executePromise;

      // Second entry should still be processed
      expect(mockLogsStore.appendNormalizedEntry).toHaveBeenCalledTimes(2);
    });
  });

  describe("resumeWithLifecycle", () => {
    it("should resume task with session ID", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.resumeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      const resumePromise = wrapper.resumeWithLifecycle(
        "exec-1",
        "session-123",
        task,
        "/test/dir"
      );

      setTimeout(() => {
        mockChildProcess.emit("exit", 0);
      }, 10);

      await resumePromise;

      expect(executorInstance.resumeTask).toHaveBeenCalledWith(
        task,
        "session-123"
      );
      expect(mockTransportManager.connectAdapter).toHaveBeenCalled();
      expect(mockTransportManager.disconnectAdapter).toHaveBeenCalled();
    });

    it("should handle resume errors", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.resumeTask.mockRejectedValue(new Error("Resume failed"));

      await expect(
        wrapper.resumeWithLifecycle("exec-1", "session-123", task, "/test/dir")
      ).rejects.toThrow("Resume failed");

      // Verify cleanup happened
      expect(mockTransportManager.disconnectAdapter).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("should cancel active execution", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {
          // Keep streaming to simulate long-running process
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        })()
      );

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      // Start execution but don't await
      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      // Wait a bit for execution to start
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Cancel execution
      await wrapper.cancel("exec-1");

      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGTERM");

      // Emit exit to complete the execution promise
      mockChildProcess.emit("exit", 143); // SIGTERM exit code

      await expect(executePromise).rejects.toThrow();
    });

    it("should handle cancel for non-existent execution", async () => {
      // Should not throw
      await expect(wrapper.cancel("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("resource cleanup", () => {
    it("should cleanup resources on successful completion", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      setTimeout(() => {
        mockChildProcess.emit("exit", 0);
      }, 10);

      await executePromise;

      // Verify cleanup
      expect(mockTransportManager.disconnectAdapter).toHaveBeenCalled();

      // Verify active execution was removed
      const activeExecutions = (wrapper as any).activeExecutions;
      expect(activeExecutions.has("exec-1")).toBe(false);
    });

    it("should cleanup resources on error", async () => {
      const task: ExecutionTask = {
        id: "task-1",
        type: "issue",
        prompt: "Test prompt",
        workDir: "/test/dir",
        config: {},
        priority: 0,
        dependencies: [],
        createdAt: new Date(),
      };

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.kill = vi.fn();

      const mockPeer = {
        onMessage: vi.fn(),
      };

      const mockManagedProcess = {
        process: mockChildProcess,
        peer: mockPeer,
      };

      const executorInstance = (wrapper as any).executor;

      executorInstance.executeTask.mockResolvedValue({
        process: mockManagedProcess,
      });

      executorInstance.createOutputChunks.mockReturnValue(
        (async function* () {})()
      );

      executorInstance.normalizeOutput.mockReturnValue(
        (async function* () {})()
      );

      const executePromise = wrapper.executeWithLifecycle(
        "exec-1",
        task,
        "/test/dir"
      );

      setTimeout(() => {
        mockChildProcess.emit("exit", 1);
      }, 10);

      await expect(executePromise).rejects.toThrow();

      // Verify cleanup happened
      expect(mockTransportManager.disconnectAdapter).toHaveBeenCalled();

      const activeExecutions = (wrapper as any).activeExecutions;
      expect(activeExecutions.has("exec-1")).toBe(false);
    });
  });
});
