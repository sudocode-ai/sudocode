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
