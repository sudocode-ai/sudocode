/**
 * Tests for AcpExecutorWrapper
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AcpExecutorWrapper,
  convertMcpServers,
  type SudocodeMcpServersConfig,
} from "../../../../src/execution/executors/acp-executor-wrapper.js";

// Mock external dependencies
vi.mock("acp-factory", () => {
  const mockSession = {
    id: "test-session-123",
    cwd: "/test/workdir",
    modes: ["code"],
    models: ["claude-sonnet"],
    prompt: vi.fn(),
    cancel: vi.fn(),
  };

  const mockAgent = {
    capabilities: { loadSession: true },
    createSession: vi.fn().mockResolvedValue(mockSession),
    loadSession: vi.fn().mockResolvedValue(mockSession),
    close: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
  };

  return {
    AgentFactory: {
      spawn: vi.fn().mockResolvedValue(mockAgent),
      listAgents: vi.fn().mockReturnValue(["claude-code", "codex", "gemini", "opencode"]),
      getConfig: vi.fn(),
    },
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
  broadcastSessionEvent: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
    onDisconnect: vi.fn().mockReturnValue(() => {}),
    hasSubscribers: vi.fn().mockReturnValue(false),
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

describe("AcpExecutorWrapper", () => {
  let wrapper: AcpExecutorWrapper;
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

    wrapper = new AcpExecutorWrapper({
      agentType: "claude-code",
      acpConfig: {
        agentType: "claude-code",
        permissionMode: "auto-approve",
      },
      lifecycleService: mockLifecycleService,
      logsStore: mockLogsStore,
      projectId: "test-project",
      db: mockDb,
    });
  });

  describe("static methods", () => {
    it("should check if agent type is ACP supported", () => {
      expect(AcpExecutorWrapper.isAcpSupported("claude-code")).toBe(true);
      expect(AcpExecutorWrapper.isAcpSupported("codex")).toBe(true);
      expect(AcpExecutorWrapper.isAcpSupported("unknown-agent")).toBe(false);
    });

    it("should list all ACP supported agents", () => {
      const agents = AcpExecutorWrapper.listAcpAgents();
      expect(agents).toContain("claude-code");
      expect(agents).toContain("codex");
      expect(agents).toContain("gemini");
      expect(agents).toContain("opencode");
    });
  });

  describe("executeWithLifecycle", () => {
    it("should spawn agent and create session", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      // Mock the prompt to return an async iterator with updates
      const mockUpdates = [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " world" } },
      ];

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir"
      );

      expect(AgentFactory.spawn).toHaveBeenCalledWith("claude-code", {
        env: undefined,
        permissionMode: "auto-approve",
        // File handlers only - no terminal handlers so Claude Code uses native Bash
        onFileRead: expect.any(Function),
        onFileWrite: expect.any(Function),
      });

      expect(mockAgent.createSession).toHaveBeenCalledWith("/test/workdir", {
        mcpServers: [],
        mode: undefined,
      });
    });

    it("should coalesce and store session updates", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      // Mock prompt to yield multiple chunks that should coalesce
      const mockUpdates = [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Part 1 " } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Part 2" } },
      ];

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir"
      );

      // The coalesced message should be stored after flush
      expect(mockLogsStore.appendRawLog).toHaveBeenCalled();

      // Check that the stored log contains coalesced content
      const storedLog = mockLogsStore.appendRawLog.mock.calls[0][1];
      const parsed = JSON.parse(storedLog);
      expect(parsed.sessionUpdate).toBe("agent_message_complete");
      expect(parsed.content.text).toBe("Part 1 Part 2");
    });

    it("should broadcast session updates via WebSocket", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { websocketManager } = await import("../../../../src/services/websocket.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      const mockUpdates = [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
      ];

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      });

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
            update: expect.any(Object),
            executionId: "exec-123",
          }),
        })
      );
    });

    it("should NOT broadcast session_update to issue subscribers (prevents duplicates)", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { websocketManager } = await import("../../../../src/services/websocket.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Test" } };
        }),
        cancel: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir"
      );

      // Verify session_update was NOT broadcast to issue subscribers
      // (broadcasting to both causes duplicate messages when frontend subscribes to both channels)
      const issueSessionUpdateCalls = (websocketManager.broadcast as any).mock.calls.filter(
        (call: any[]) => call[1] === "issue" && call[3]?.type === "session_update"
      );
      expect(issueSessionUpdateCalls).toHaveLength(0);
    });

    it("should update execution status on completion", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import("../../../../src/services/executions.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          // Empty prompt - no updates
        }),
        cancel: vi.fn(),
      });

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
  });

  describe("cancel", () => {
    it("should cancel active session and close agent", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");
      const mockSession = {
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          // Simulate a long-running prompt
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      (mockAgent.createSession as any).mockResolvedValueOnce(mockSession);

      // Start execution in background
      const execPromise = wrapper
        .executeWithLifecycle("exec-123", { id: "task-1", prompt: "Test" }, "/test/workdir")
        .catch(() => {}); // Ignore cancellation error

      // Give it time to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Cancel
      await wrapper.cancel("exec-123");

      expect(mockSession.cancel).toHaveBeenCalled();
      expect(mockAgent.close).toHaveBeenCalled();
    });
  });

  describe("resumeWithLifecycle", () => {
    it("should load existing session and resume", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      const mockUpdates = [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Resumed" } },
      ];

      const mockSession = {
        id: "existing-session-123",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
      };

      (mockAgent.loadSession as any).mockResolvedValueOnce(mockSession);

      await wrapper.resumeWithLifecycle(
        "exec-123",
        "existing-session-123",
        { id: "task-1", prompt: "Continue work" },
        "/test/workdir"
      );

      expect(mockAgent.loadSession).toHaveBeenCalledWith(
        "existing-session-123",
        "/test/workdir"
      );

      // Check that the resumed message was stored
      expect(mockLogsStore.appendRawLog).toHaveBeenCalled();
    });
  });
});

describe("Persistent Sessions", () => {
  let wrapper: AcpExecutorWrapper;
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

    wrapper = new AcpExecutorWrapper({
      agentType: "claude-code",
      acpConfig: {
        agentType: "claude-code",
        permissionMode: "auto-approve",
      },
      lifecycleService: mockLifecycleService,
      logsStore: mockLogsStore,
      projectId: "test-project",
      db: mockDb,
    });
  });

  describe("executeWithLifecycle with persistent mode", () => {
    it("should transition to waiting state after prompt completes in persistent mode", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import("../../../../src/services/executions.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      const mockUpdates = [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
      ];

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          for (const update of mockUpdates) {
            yield update;
          }
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test prompt" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Should update to "waiting" status instead of "completed"
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "waiting" })
      );

      // Should NOT update to "completed" (discrete mode behavior)
      const completedCalls = (updateExecution as any).mock.calls.filter(
        (call: any[]) => call[2]?.status === "completed"
      );
      expect(completedCalls).toHaveLength(0);
    });

    it("should track persistent session state", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Should have persistent session state
      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      const state = wrapper.getSessionState("exec-123");
      expect(state).not.toBeNull();
      expect(state?.mode).toBe("persistent");
      expect(state?.state).toBe("waiting");
      expect(state?.promptCount).toBe(1);
    });

    it("should broadcast session_waiting event in persistent mode", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { websocketManager } = await import("../../../../src/services/websocket.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Should broadcast session_waiting event via broadcastSessionEvent
      const { broadcastSessionEvent } = await import(
        "../../../../src/services/websocket.js"
      );
      expect(broadcastSessionEvent).toHaveBeenCalledWith(
        "test-project",
        "exec-123",
        "session_waiting",
        { promptCount: 1 }
      );
    });

    it("should NOT cleanup agent/session in persistent mode", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Agent should NOT be closed
      expect(mockAgent.close).not.toHaveBeenCalled();
    });
  });

  describe("sendPrompt", () => {
    it("should send additional prompt to waiting session", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      let promptCallCount = 0;
      const mockSession = {
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          promptCallCount++;
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Response ${promptCallCount}` } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      };

      (mockAgent.createSession as any).mockResolvedValueOnce(mockSession);

      // Start persistent session
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "First prompt" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      expect(promptCallCount).toBe(1);

      // Send second prompt
      await wrapper.sendPrompt("exec-123", "Second prompt");

      expect(promptCallCount).toBe(2);
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);

      // Should still be in waiting state
      const state = wrapper.getSessionState("exec-123");
      expect(state?.state).toBe("waiting");
      expect(state?.promptCount).toBe(2);
    });

    it("should throw error if no persistent session exists", async () => {
      await expect(
        wrapper.sendPrompt("non-existent", "Test")
      ).rejects.toThrow("No persistent session found");
    });

    it("should throw error if session is not in waiting state", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      // Create a mock session that will never resolve (simulating running state)
      let resolvePrompt: () => void;
      const promptPromise = new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      });

      const mockSession = {
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          await promptPromise;
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      };

      (mockAgent.createSession as any).mockResolvedValueOnce(mockSession);

      // Start execution but don't await - session should be in "running" state
      const execPromise = wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Give it time to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try to send prompt while running - should fail
      await expect(
        wrapper.sendPrompt("exec-123", "Another prompt")
      ).rejects.toThrow("Cannot send prompt to session in state: running");

      // Clean up
      resolvePrompt!();
      await execPromise;
    });
  });

  describe("endSession", () => {
    it("should explicitly end a persistent session", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import("../../../../src/services/executions.js");
      const { websocketManager } = await import("../../../../src/services/websocket.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      // Start persistent session
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      // End the session
      await wrapper.endSession("exec-123");

      // Should update to completed
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "completed" })
      );

      // Should close agent
      expect(mockAgent.close).toHaveBeenCalled();

      // Should no longer be a persistent session
      expect(wrapper.isPersistentSession("exec-123")).toBe(false);

      // Should broadcast session_ended event via broadcastSessionEvent
      const { broadcastSessionEvent } = await import(
        "../../../../src/services/websocket.js"
      );
      expect(broadcastSessionEvent).toHaveBeenCalledWith(
        "test-project",
        "exec-123",
        "session_ended",
        { reason: "explicit" }
      );
    });

    it("should do nothing if session does not exist", async () => {
      // Should not throw
      await expect(wrapper.endSession("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("getSessionState and isPersistentSession", () => {
    it("should return null for non-persistent sessions", () => {
      expect(wrapper.getSessionState("non-existent")).toBeNull();
      expect(wrapper.isPersistentSession("non-existent")).toBe(false);
    });

    it("should track idle time", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = wrapper.getSessionState("exec-123");
      expect(state?.idleTimeMs).toBeGreaterThanOrEqual(50);
    });
  });

  describe("idle timeout", () => {
    it("should end session after idle timeout", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import("../../../../src/services/executions.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      // Start with short idle timeout
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { idleTimeoutMs: 100 },
        }
      );

      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Session should be ended
      expect(wrapper.isPersistentSession("exec-123")).toBe(false);

      // Should have been completed
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "completed" })
      );
    });

    it("should clear idle timeout when sending new prompt", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      let promptCount = 0;
      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          promptCount++;
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Response ${promptCount}` } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      // Start with idle timeout
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { idleTimeoutMs: 100 },
        }
      );

      // Wait partway through timeout
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send another prompt (should reset timeout)
      await wrapper.sendPrompt("exec-123", "Second prompt");

      // Wait more than original timeout but less than new timeout
      await new Promise((resolve) => setTimeout(resolve, 75));

      // Session should still be alive (timeout was reset)
      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      // Wait for new timeout to expire
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now session should be ended
      expect(wrapper.isPersistentSession("exec-123")).toBe(false);
    });
  });

  describe("pauseOnCompletion", () => {
    it("should transition to paused state when pauseOnCompletion is true", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import("../../../../src/services/executions.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { pauseOnCompletion: true },
        }
      );

      // Should be in paused state
      const state = wrapper.getSessionState("exec-123");
      expect(state?.state).toBe("paused");
      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      // Should have updated execution status to paused
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "paused" })
      );
    });

    it("should not start idle timeout when paused", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      // Start with both pauseOnCompletion AND idleTimeout
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { pauseOnCompletion: true, idleTimeoutMs: 50 },
        }
      );

      // Should be paused
      expect(wrapper.getSessionState("exec-123")?.state).toBe("paused");

      // Wait longer than idle timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Session should still be alive (idle timeout doesn't apply to paused)
      expect(wrapper.isPersistentSession("exec-123")).toBe(true);
      expect(wrapper.getSessionState("exec-123")?.state).toBe("paused");
    });

    it("should allow resuming from paused state via sendPrompt", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import("../../../../src/services/executions.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      let promptCount = 0;
      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          promptCount++;
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Response ${promptCount}` } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      // Start in pause-on-completion mode
      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "First" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { pauseOnCompletion: true },
        }
      );

      expect(wrapper.getSessionState("exec-123")?.state).toBe("paused");

      // Reset mock to track new calls
      (updateExecution as any).mockClear();

      // Send a new prompt to resume
      await wrapper.sendPrompt("exec-123", "Resume me!");

      // Should have transitioned to running, then back to paused
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "running" })
      );

      // Should end up paused again
      expect(wrapper.getSessionState("exec-123")?.state).toBe("paused");
      expect(wrapper.getSessionState("exec-123")?.promptCount).toBe(2);
    });
  });

  describe("endOnDisconnect", () => {
    it("should register disconnect callback when endOnDisconnect is true", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { websocketManager } = await import("../../../../src/services/websocket.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      const onDisconnectSpy = vi.spyOn(websocketManager, "onDisconnect");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { endOnDisconnect: true },
        }
      );

      expect(onDisconnectSpy).toHaveBeenCalled();
      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      onDisconnectSpy.mockRestore();
    });

    it("should not register disconnect callback when endOnDisconnect is false", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { websocketManager } = await import("../../../../src/services/websocket.js");
      const mockAgent = await AgentFactory.spawn("claude-code");

      const onDisconnectSpy = vi.spyOn(websocketManager, "onDisconnect");

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { endOnDisconnect: false },
        }
      );

      // Should not register callback when disabled
      expect(onDisconnectSpy).not.toHaveBeenCalled();

      onDisconnectSpy.mockRestore();
    });

    it("should clean up disconnect callback when session ends", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      const unregisterFn = vi.fn();
      const { websocketManager } = await import("../../../../src/services/websocket.js");
      vi.spyOn(websocketManager, "onDisconnect").mockReturnValue(unregisterFn);

      (mockAgent.createSession as any).mockResolvedValueOnce({
        id: "session-abc",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      });

      await wrapper.executeWithLifecycle(
        "exec-123",
        { id: "task-1", prompt: "Test" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { endOnDisconnect: true },
        }
      );

      // End the session explicitly
      await wrapper.endSession("exec-123");

      // Unregister should have been called
      expect(unregisterFn).toHaveBeenCalled();
    });
  });

  describe("resumeWithLifecycle with persistent mode", () => {
    it("should transition to waiting state after resume completes in persistent mode", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import(
        "../../../../src/services/executions.js"
      );
      const mockAgent = await AgentFactory.spawn("claude-code");

      const mockSession = {
        id: "existing-session-123",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Resumed" },
          };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      };

      (mockAgent.loadSession as any).mockResolvedValueOnce(mockSession);

      await wrapper.resumeWithLifecycle(
        "exec-123",
        "existing-session-123",
        { id: "task-1", prompt: "Continue work" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Should update to "waiting" status instead of "completed"
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "waiting" })
      );

      // Should NOT update to "completed" (discrete mode behavior)
      const completedCalls = (updateExecution as any).mock.calls.filter(
        (call: any[]) => call[2]?.status === "completed"
      );
      expect(completedCalls).toHaveLength(0);
    });

    it("should track persistent session state for resumed sessions", async () => {
      const { AgentFactory } = await import("acp-factory");
      const mockAgent = await AgentFactory.spawn("claude-code");

      const mockSession = {
        id: "existing-session-123",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Resumed" },
          };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      };

      (mockAgent.loadSession as any).mockResolvedValueOnce(mockSession);

      await wrapper.resumeWithLifecycle(
        "exec-123",
        "existing-session-123",
        { id: "task-1", prompt: "Continue work" },
        "/test/workdir",
        { sessionMode: "persistent" }
      );

      // Should have persistent session state
      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      const state = wrapper.getSessionState("exec-123");
      expect(state).not.toBeNull();
      expect(state?.mode).toBe("persistent");
      expect(state?.state).toBe("waiting");
      expect(state?.promptCount).toBe(1);
    });

    it("should complete execution for resumed sessions without persistent mode", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import(
        "../../../../src/services/executions.js"
      );
      const mockAgent = await AgentFactory.spawn("claude-code");

      const mockSession = {
        id: "existing-session-123",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      };

      (mockAgent.loadSession as any).mockResolvedValueOnce(mockSession);

      await wrapper.resumeWithLifecycle(
        "exec-123",
        "existing-session-123",
        { id: "task-1", prompt: "Continue work" },
        "/test/workdir"
        // No sessionMode option - defaults to discrete
      );

      // Should update to "completed" status (discrete mode)
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "completed" })
      );

      // Should NOT be a persistent session
      expect(wrapper.isPersistentSession("exec-123")).toBe(false);
    });

    it("should respect pauseOnCompletion for resumed sessions", async () => {
      const { AgentFactory } = await import("acp-factory");
      const { updateExecution } = await import(
        "../../../../src/services/executions.js"
      );
      const mockAgent = await AgentFactory.spawn("claude-code");

      const mockSession = {
        id: "existing-session-123",
        cwd: "/test/workdir",
        modes: ["code"],
        models: ["claude-sonnet"],
        prompt: vi.fn().mockImplementation(async function* () {
          yield {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          };
        }),
        cancel: vi.fn(),
        setMode: vi.fn(),
      };

      (mockAgent.loadSession as any).mockResolvedValueOnce(mockSession);

      await wrapper.resumeWithLifecycle(
        "exec-123",
        "existing-session-123",
        { id: "task-1", prompt: "Continue work" },
        "/test/workdir",
        {
          sessionMode: "persistent",
          sessionEndMode: { pauseOnCompletion: true },
        }
      );

      // Should be in paused state
      const state = wrapper.getSessionState("exec-123");
      expect(state?.state).toBe("paused");
      expect(wrapper.isPersistentSession("exec-123")).toBe(true);

      // Should have updated execution status to paused
      expect(updateExecution).toHaveBeenCalledWith(
        mockDb,
        "exec-123",
        expect.objectContaining({ status: "paused" })
      );
    });
  });
});

describe("convertMcpServers", () => {
  it("should return empty array for undefined input", () => {
    expect(convertMcpServers(undefined)).toEqual([]);
  });

  it("should pass through array format unchanged", () => {
    const mcpServers = [
      { name: "test-server", command: "test-cmd", args: [], env: [] },
    ];
    expect(convertMcpServers(mcpServers)).toBe(mcpServers);
  });

  it("should convert Record format to array format", () => {
    const sudocodeConfig: SudocodeMcpServersConfig = {
      "sudocode-mcp": {
        command: "sudocode-mcp",
        args: ["--scope", "all"],
      },
      "other-server": {
        command: "other-cmd",
      },
    };

    const result = convertMcpServers(sudocodeConfig);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      name: "sudocode-mcp",
      command: "sudocode-mcp",
      args: ["--scope", "all"],
      env: [],
    });
    expect(result).toContainEqual({
      name: "other-server",
      command: "other-cmd",
      args: [],
      env: [],
    });
  });

  it("should convert env Record to env Array", () => {
    const sudocodeConfig: SudocodeMcpServersConfig = {
      "test-server": {
        command: "test-cmd",
        env: {
          API_KEY: "secret123",
          DEBUG: "true",
        },
      },
    };

    const result = convertMcpServers(sudocodeConfig);

    expect(result).toHaveLength(1);
    expect(result[0].env).toContainEqual({ name: "API_KEY", value: "secret123" });
    expect(result[0].env).toContainEqual({ name: "DEBUG", value: "true" });
  });

  it("should handle empty config object", () => {
    const result = convertMcpServers({});
    expect(result).toEqual([]);
  });
});
