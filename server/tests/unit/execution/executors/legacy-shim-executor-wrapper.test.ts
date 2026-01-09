/**
 * Tests for LegacyShimExecutorWrapper
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LegacyShimExecutorWrapper,
  type LegacyAgentType,
} from "../../../../src/execution/executors/legacy-shim-executor-wrapper.js";

// Mock agent-execution-engine
vi.mock("agent-execution-engine/agents", () => {
  const createMockExecutor = () => ({
    executeTask: vi.fn().mockResolvedValue({
      process: {
        process: {
          pid: 12345,
          kill: vi.fn(),
          on: vi.fn((event: string, handler: Function) => {
            if (event === "exit") {
              // Simulate process exit after brief delay
              setTimeout(() => handler(0), 10);
            }
          }),
        },
        streams: {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from('{"type":"text","content":"test"}');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {
              // Empty stderr
            },
          },
        },
      },
    }),
    normalizeOutput: vi.fn().mockImplementation(async function* () {
      yield {
        index: 0,
        timestamp: new Date(),
        type: { kind: "assistant_message" },
        content: "Hello from legacy agent",
      };
      yield {
        index: 1,
        timestamp: new Date(),
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "ls -la" },
            status: "success",
            result: { success: true, data: "file1.txt\nfile2.txt" },
          },
        },
        content: "Running command",
      };
    }),
    getCapabilities: vi.fn().mockReturnValue({
      supportsSessionResume: false,
      requiresSetup: true,
      supportsApprovals: false,
      supportsMcp: false,
      protocol: "jsonl",
    }),
  });

  return {
    CopilotExecutor: vi.fn().mockImplementation(() => createMockExecutor()),
    CursorExecutor: vi.fn().mockImplementation(() => createMockExecutor()),
  };
});

vi.mock("../../../../src/services/executions.js", () => ({
  updateExecution: vi.fn(),
  getExecution: vi.fn().mockReturnValue({
    id: "test-exec-123",
    issue_id: "test-issue-456",
    worktree_path: "/test/worktree",
    workflow_execution_id: null,
  }),
}));

vi.mock("../../../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
  },
}));

vi.mock("../../../../src/services/execution-changes-service.js", () => ({
  ExecutionChangesService: vi.fn().mockImplementation(() => ({
    getChanges: vi.fn().mockResolvedValue({
      available: true,
      captured: { files: [{ path: "test.ts" }] },
    }),
  })),
}));

vi.mock("../../../../src/services/execution-event-callbacks.js", () => ({
  notifyExecutionEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn().mockReturnValue("abc123\n"),
}));

describe("LegacyShimExecutorWrapper", () => {
  let wrapper: LegacyShimExecutorWrapper;
  let mockDb: any;
  let mockLogsStore: any;
  let mockLifecycleService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
      }),
    };

    mockLogsStore = {
      appendRawLog: vi.fn(),
      appendNormalizedEntry: vi.fn(),
    };

    mockLifecycleService = {
      setStatus: vi.fn(),
    };

    wrapper = new LegacyShimExecutorWrapper({
      agentType: "copilot",
      agentConfig: {
        workDir: "/test/workdir",
        model: "gpt-4o",
      },
      lifecycleService: mockLifecycleService,
      logsStore: mockLogsStore,
      projectId: "test-project",
      db: mockDb,
    });
  });

  describe("static methods", () => {
    it("should check if agent type is a legacy agent", () => {
      expect(LegacyShimExecutorWrapper.isLegacyAgent("copilot")).toBe(true);
      expect(LegacyShimExecutorWrapper.isLegacyAgent("cursor")).toBe(true);
      expect(LegacyShimExecutorWrapper.isLegacyAgent("claude-code")).toBe(
        false
      );
      expect(LegacyShimExecutorWrapper.isLegacyAgent("codex")).toBe(false);
    });

    it("should list all legacy agents", () => {
      const agents = LegacyShimExecutorWrapper.listLegacyAgents();
      expect(agents).toContain("copilot");
      expect(agents).toContain("cursor");
      expect(agents).toHaveLength(2);
    });
  });

  describe("executeWithLifecycle", () => {
    it("should spawn agent and process output", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir"
      );

      expect(CopilotExecutor).toHaveBeenCalledWith({
        workDir: "/test/workdir",
        model: "gpt-4o",
      });
    });

    it("should convert NormalizedEntry to CoalescedSessionUpdate", async () => {
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir"
      );

      // Check that appendRawLog was called with CoalescedSessionUpdate format
      expect(mockLogsStore.appendRawLog).toHaveBeenCalled();

      // First call should be agent_message_complete
      const firstCall = mockLogsStore.appendRawLog.mock.calls[0];
      expect(firstCall[0]).toBe("exec-123");
      const firstParsed = JSON.parse(firstCall[1]);
      expect(firstParsed.sessionUpdate).toBe("agent_message_complete");
      expect(firstParsed.content.text).toBe("Hello from legacy agent");

      // Second call should be tool_call_complete
      const secondCall = mockLogsStore.appendRawLog.mock.calls[1];
      const secondParsed = JSON.parse(secondCall[1]);
      expect(secondParsed.sessionUpdate).toBe("tool_call_complete");
      expect(secondParsed.title).toBe("Run: ls -la");
      expect(secondParsed.status).toBe("completed");
    });

    it("should broadcast session updates via WebSocket", async () => {
      const { websocketManager } = await import(
        "../../../../src/services/websocket.js"
      );

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir"
      );

      // Check that websocket broadcast was called for session updates
      expect(websocketManager.broadcast).toHaveBeenCalledWith(
        "test-project",
        "execution",
        "exec-123",
        expect.objectContaining({
          type: "session_update",
          data: expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: expect.any(String),
            }),
            executionId: "exec-123",
          }),
        })
      );
    });

    it("should update execution status on completion", async () => {
      const { updateExecution } = await import(
        "../../../../src/services/executions.js"
      );

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      // Should update to running
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "running" })
      );

      // Should update to completed
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({
          status: "completed",
          exit_code: 0,
        })
      );
    });

    it("should NOT broadcast session_update to issue subscribers (prevents duplicates)", async () => {
      const { websocketManager } = await import(
        "../../../../src/services/websocket.js"
      );

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir"
      );

      // Verify session_update was broadcast to execution subscribers
      expect(websocketManager.broadcast).toHaveBeenCalledWith(
        "test-project",
        "execution",
        "exec-123",
        expect.objectContaining({
          type: "session_update",
        })
      );

      // Verify session_update was NOT broadcast to issue subscribers
      // (broadcasting to both causes duplicate messages when frontend subscribes to both channels)
      const issueSessionUpdateCalls = (websocketManager.broadcast as any).mock.calls.filter(
        (call: any[]) => call[1] === "issue" && call[3]?.type === "session_update"
      );
      expect(issueSessionUpdateCalls).toHaveLength(0);
    });
  });

  describe("NormalizedEntry to CoalescedSessionUpdate mapping", () => {
    it("should map assistant_message to agent_message_complete", async () => {
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      const firstCall = mockLogsStore.appendRawLog.mock.calls[0];
      const parsed = JSON.parse(firstCall[1]);

      expect(parsed.sessionUpdate).toBe("agent_message_complete");
      expect(parsed.content.type).toBe("text");
      expect(parsed.content.text).toBe("Hello from legacy agent");
      expect(parsed.timestamp).toBeDefined();
    });

    it("should map tool_use to tool_call_complete", async () => {
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      const secondCall = mockLogsStore.appendRawLog.mock.calls[1];
      const parsed = JSON.parse(secondCall[1]);

      expect(parsed.sessionUpdate).toBe("tool_call_complete");
      expect(parsed.toolCallId).toBe("Bash-1");
      expect(parsed.title).toBe("Run: ls -la");
      expect(parsed.status).toBe("completed");
      expect(parsed.rawInput).toEqual({ command: "ls -la" });
    });
  });

  describe("error entry mapping", () => {
    it("should map error to tool_call_complete with failed status", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");

      const mockExecutorWithError = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: {
                [Symbol.asyncIterator]: async function* () {},
              },
              stderr: {
                [Symbol.asyncIterator]: async function* () {},
              },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          yield {
            index: 0,
            timestamp: new Date(),
            type: {
              kind: "error",
              error: {
                message: "Something went wrong",
                code: "ERR_TOOL_FAILED",
                stack: "Error: Something went wrong\n  at test.ts:1:1",
              },
            },
            content: "Error occurred",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({
          supportsSessionResume: false,
        }),
      };

      (CopilotExecutor as any).mockImplementation(() => mockExecutorWithError);

      // Create fresh mock logs store
      const errorLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const errorWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: {
          workDir: "/test/workdir",
          model: "gpt-4o",
        },
        lifecycleService: mockLifecycleService,
        logsStore: errorLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await errorWrapper.executeWithLifecycle(
        "exec-error-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      const firstCall = errorLogsStore.appendRawLog.mock.calls[0];
      const parsed = JSON.parse(firstCall[1]);

      expect(parsed.sessionUpdate).toBe("tool_call_complete");
      expect(parsed.status).toBe("failed");
      expect(parsed.title).toBe("Error: ERR_TOOL_FAILED");
      expect(parsed.result.error).toBe("Something went wrong");
    });
  });

  describe("thinking entry mapping", () => {
    it("should map thinking to agent_thought_complete", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");
      const mockExecutorWithThinking = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: {
                [Symbol.asyncIterator]: async function* () {},
              },
              stderr: {
                [Symbol.asyncIterator]: async function* () {},
              },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          yield {
            index: 0,
            timestamp: new Date(),
            type: {
              kind: "thinking",
              reasoning: "I need to analyze this carefully...",
            },
            content: "Thinking...",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({
          supportsSessionResume: false,
        }),
      };

      (CopilotExecutor as any).mockImplementation(
        () => mockExecutorWithThinking
      );

      // Create fresh mock logs store
      const thinkingLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const thinkingWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: {
          workDir: "/test/workdir",
        },
        lifecycleService: mockLifecycleService,
        logsStore: thinkingLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await thinkingWrapper.executeWithLifecycle(
        "exec-thinking-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      const firstCall = thinkingLogsStore.appendRawLog.mock.calls[0];
      const parsed = JSON.parse(firstCall[1]);

      expect(parsed.sessionUpdate).toBe("agent_thought_complete");
      expect(parsed.content.text).toBe("I need to analyze this carefully...");
    });
  });

  describe("system_message entry mapping", () => {
    it("should map system_message to agent_message_complete with [System] prefix", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");
      const mockExecutorWithSystem = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: {
                [Symbol.asyncIterator]: async function* () {},
              },
              stderr: {
                [Symbol.asyncIterator]: async function* () {},
              },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          yield {
            index: 0,
            timestamp: new Date(),
            type: { kind: "system_message" },
            content: "Session started",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({
          supportsSessionResume: false,
        }),
      };

      (CopilotExecutor as any).mockImplementation(() => mockExecutorWithSystem);

      // Create fresh mock logs store
      const systemLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const systemWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: {
          workDir: "/test/workdir",
        },
        lifecycleService: mockLifecycleService,
        logsStore: systemLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await systemWrapper.executeWithLifecycle(
        "exec-system-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      const firstCall = systemLogsStore.appendRawLog.mock.calls[0];
      const parsed = JSON.parse(firstCall[1]);

      expect(parsed.sessionUpdate).toBe("agent_message_complete");
      expect(parsed.content.text).toBe("[System] Session started");
    });
  });

  describe("cancel", () => {
    it("should cancel active execution and update status", async () => {
      const { updateExecution } = await import(
        "../../../../src/services/executions.js"
      );

      // Start execution in background
      const execPromise = wrapper
        .executeWithLifecycle(
          "exec-123",
          { id: "task-1", prompt: "Test" },
          "/test/workdir"
        )
        .catch(() => {}); // Ignore cancellation error

      // Give it time to start
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Cancel
      await wrapper.cancel("exec-123");

      // Should update status to stopped
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({
          status: "stopped",
        })
      );
    });
  });

  describe("resumeWithLifecycle", () => {
    it("should log warning and execute fresh for non-resumable agents", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await wrapper.resumeWithLifecycle(
        "exec-123",
        "session-abc",
        { id: "task-1", prompt: "Continue work" },
        "/test/workdir"
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("does not support session resume")
      );

      // Should still execute
      expect(mockLogsStore.appendRawLog).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("cursor agent", () => {
    it("should create cursor executor when agent type is cursor", async () => {
      const { CursorExecutor } = await import("agent-execution-engine/agents");

      // Clear mock call history first
      (CursorExecutor as any).mockClear();

      // Create fresh mock logs store
      const cursorLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const cursorWrapper = new LegacyShimExecutorWrapper({
        agentType: "cursor",
        agentConfig: {
          workDir: "/test/workdir",
          model: "claude-sonnet-4",
        },
        lifecycleService: mockLifecycleService,
        logsStore: cursorLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      // The executor is created in the constructor
      // Note: CursorConfig uses 'workspace' instead of 'workDir'
      expect(CursorExecutor).toHaveBeenCalledWith({
        workspace: "/test/workdir",
        model: "claude-sonnet-4",
        force: true, // Auto-approve for non-interactive execution
      });
    });
  });

  describe("tool status mapping", () => {
    it("should skip non-terminal statuses and only emit completed tools", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");
      const mockExecutorWithCreated = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: {
                [Symbol.asyncIterator]: async function* () {},
              },
              stderr: {
                [Symbol.asyncIterator]: async function* () {},
              },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          // Non-terminal status should be skipped
          yield {
            index: 0,
            timestamp: new Date(),
            type: {
              kind: "tool_use",
              tool: {
                toolName: "Read",
                action: { kind: "file_read", path: "/test/file.ts" },
                status: "created",
              },
            },
            content: "Reading file",
          };
          // Terminal status should be emitted
          yield {
            index: 1,
            timestamp: new Date(),
            type: {
              kind: "tool_use",
              tool: {
                toolName: "Read",
                action: { kind: "file_read", path: "/test/file.ts" },
                status: "success",
                result: { data: "file contents" },
              },
            },
            content: "File read complete",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({
          supportsSessionResume: false,
        }),
      };

      (CopilotExecutor as any).mockImplementation(
        () => mockExecutorWithCreated
      );

      // Create fresh mock logs store
      const createdLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const createdWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: {
          workDir: "/test/workdir",
        },
        lifecycleService: mockLifecycleService,
        logsStore: createdLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await createdWrapper.executeWithLifecycle(
        "exec-created-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      // Only terminal status (success) should be emitted
      expect(createdLogsStore.appendRawLog).toHaveBeenCalledTimes(1);
      const firstCall = createdLogsStore.appendRawLog.mock.calls[0];
      const parsed = JSON.parse(firstCall[1]);

      expect(parsed.status).toBe("completed");
    });

    it("should map failed status to failed", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");
      const mockExecutorWithFailed = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: {
                [Symbol.asyncIterator]: async function* () {},
              },
              stderr: {
                [Symbol.asyncIterator]: async function* () {},
              },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          yield {
            index: 0,
            timestamp: new Date(),
            type: {
              kind: "tool_use",
              tool: {
                toolName: "Bash",
                action: { kind: "command_run", command: "invalid-cmd" },
                status: "failed",
                result: { success: false, error: "Command not found" },
              },
            },
            content: "Command failed",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({
          supportsSessionResume: false,
        }),
      };

      (CopilotExecutor as any).mockImplementation(() => mockExecutorWithFailed);

      // Create fresh mock logs store
      const failedLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const failedWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: {
          workDir: "/test/workdir",
        },
        lifecycleService: mockLifecycleService,
        logsStore: failedLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await failedWrapper.executeWithLifecycle(
        "exec-failed-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      const firstCall = failedLogsStore.appendRawLog.mock.calls[0];
      const parsed = JSON.parse(firstCall[1]);

      expect(parsed.status).toBe("failed");
    });
  });

  describe("message deduplication", () => {
    it("should skip exact duplicate messages", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");
      const mockExecutorWithDuplicates = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: { [Symbol.asyncIterator]: async function* () {} },
              stderr: { [Symbol.asyncIterator]: async function* () {} },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          // Simulate PlainTextLogProcessor emitting duplicate messages
          yield {
            index: 0,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Hello world",
          };
          // Exact duplicate - should be skipped
          yield {
            index: 0,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Hello world",
          };
          // Different message - should be emitted
          yield {
            index: 1,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Goodbye world",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({ supportsSessionResume: false }),
      };

      (CopilotExecutor as any).mockImplementation(() => mockExecutorWithDuplicates);

      const dedupeLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const dedupeWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: { workDir: "/test/workdir" },
        lifecycleService: mockLifecycleService,
        logsStore: dedupeLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await dedupeWrapper.executeWithLifecycle(
        "exec-dedupe-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      // Should only have 2 calls (duplicate was skipped)
      expect(dedupeLogsStore.appendRawLog).toHaveBeenCalledTimes(2);

      const firstCall = JSON.parse(dedupeLogsStore.appendRawLog.mock.calls[0][1]);
      const secondCall = JSON.parse(dedupeLogsStore.appendRawLog.mock.calls[1][1]);

      expect(firstCall.content.text).toBe("Hello world");
      expect(secondCall.content.text).toBe("Goodbye world");
    });

    it("should skip streaming 'replace' patches with cumulative content", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");

      // Long content to trigger emission (needs to exceed 50-char threshold for short messages)
      const longAddition =
        "This is a much longer line that should definitely exceed the fifty character threshold for emission";

      const mockExecutorWithStreaming = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: { [Symbol.asyncIterator]: async function* () {} },
              stderr: { [Symbol.asyncIterator]: async function* () {} },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          // Simulate PlainTextLogProcessor 'replace' patches
          // First line
          yield {
            index: 0,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Line 1",
          };
          // Small addition (< 50 chars for short messages) - should be skipped
          yield {
            index: 0,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Line 1\nLine 2 short",
          };
          // Larger addition (> 50 chars) - should be emitted
          yield {
            index: 0,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: `Line 1\nLine 2 short\n${longAddition}`,
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({ supportsSessionResume: false }),
      };

      (CopilotExecutor as any).mockImplementation(() => mockExecutorWithStreaming);

      const streamLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const streamWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: { workDir: "/test/workdir" },
        lifecycleService: mockLifecycleService,
        logsStore: streamLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await streamWrapper.executeWithLifecycle(
        "exec-stream-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      // Should have 2 calls (small addition was skipped)
      expect(streamLogsStore.appendRawLog).toHaveBeenCalledTimes(2);

      const firstCall = JSON.parse(streamLogsStore.appendRawLog.mock.calls[0][1]);
      const secondCall = JSON.parse(streamLogsStore.appendRawLog.mock.calls[1][1]);

      expect(firstCall.content.text).toBe("Line 1");
      expect(secondCall.content.text).toBe(`Line 1\nLine 2 short\n${longAddition}`);
    });

    it("should only emit tool_use entries with terminal status (success/failed)", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");
      const mockExecutorWithToolDupes = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: { [Symbol.asyncIterator]: async function* () {} },
              stderr: { [Symbol.asyncIterator]: async function* () {} },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          // Tool call started - non-terminal, should be skipped
          yield {
            index: 0,
            timestamp: new Date(),
            type: {
              kind: "tool_use",
              tool: {
                toolName: "Read",
                action: { kind: "file_read", path: "/test.ts" },
                status: "running",
                result: null,
              },
            },
            content: "Reading file",
          };
          // Same tool call with same status - also skipped (non-terminal)
          yield {
            index: 0,
            timestamp: new Date(),
            type: {
              kind: "tool_use",
              tool: {
                toolName: "Read",
                action: { kind: "file_read", path: "/test.ts" },
                status: "running",
                result: null,
              },
            },
            content: "Reading file",
          };
          // Tool call completed with result - terminal, should be emitted
          yield {
            index: 0,
            timestamp: new Date(),
            type: {
              kind: "tool_use",
              tool: {
                toolName: "Read",
                action: { kind: "file_read", path: "/test.ts" },
                status: "success",
                result: { success: true, data: "file contents" },
              },
            },
            content: "Reading file",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({ supportsSessionResume: false }),
      };

      (CopilotExecutor as any).mockImplementation(() => mockExecutorWithToolDupes);

      const toolDedupeLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const toolDedupeWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: { workDir: "/test/workdir" },
        lifecycleService: mockLifecycleService,
        logsStore: toolDedupeLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await toolDedupeWrapper.executeWithLifecycle(
        "exec-tool-dedupe-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      // Should have 1 call (only terminal status emitted, non-terminal skipped)
      expect(toolDedupeLogsStore.appendRawLog).toHaveBeenCalledTimes(1);

      const firstCall = JSON.parse(toolDedupeLogsStore.appendRawLog.mock.calls[0][1]);
      expect(firstCall.status).toBe("completed"); // success maps to completed
    });

    it("should not deduplicate different message indices", async () => {
      const { CopilotExecutor } = await import("agent-execution-engine/agents");
      const mockExecutorWithDiffIndices = {
        executeTask: vi.fn().mockResolvedValue({
          process: {
            process: {
              pid: 12345,
              kill: vi.fn(),
              on: vi.fn((event: string, handler: Function) => {
                if (event === "exit") {
                  setTimeout(() => handler(0), 10);
                }
              }),
            },
            streams: {
              stdout: { [Symbol.asyncIterator]: async function* () {} },
              stderr: { [Symbol.asyncIterator]: async function* () {} },
            },
          },
        }),
        normalizeOutput: vi.fn().mockImplementation(async function* () {
          // Same content but different indices - should all be emitted
          yield {
            index: 0,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Same content",
          };
          yield {
            index: 1,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Same content",
          };
          yield {
            index: 2,
            timestamp: new Date(),
            type: { kind: "assistant_message" },
            content: "Same content",
          };
        }),
        getCapabilities: vi.fn().mockReturnValue({ supportsSessionResume: false }),
      };

      (CopilotExecutor as any).mockImplementation(() => mockExecutorWithDiffIndices);

      const diffIndexLogsStore = {
        appendRawLog: vi.fn(),
        appendNormalizedEntry: vi.fn(),
      };

      const diffIndexWrapper = new LegacyShimExecutorWrapper({
        agentType: "copilot",
        agentConfig: { workDir: "/test/workdir" },
        lifecycleService: mockLifecycleService,
        logsStore: diffIndexLogsStore,
        projectId: "test-project",
        db: mockDb,
      });

      await diffIndexWrapper.executeWithLifecycle(
        "exec-diff-index-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir"
      );

      // All 3 should be emitted (different indices)
      expect(diffIndexLogsStore.appendRawLog).toHaveBeenCalledTimes(3);
    });
  });
});
