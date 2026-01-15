/**
 * Tests for MacroAgentObservabilityService
 *
 * Tests the global agent monitoring service for macro-agent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// Mock websocket broadcast functions
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastToProject: vi.fn(),
  broadcastExecutionUpdate: vi.fn(),
}));

// Track all created WebSocket instances
const wsInstances: Array<
  EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
  }
> = [];

// Mock ws module
vi.mock("ws", async () => {
  const { EventEmitter: EE } = await import("events");

  const MockWS = vi.fn(() => {
    const instance = new EE() as EventEmitter & {
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      readyState: number;
    };
    instance.send = vi.fn();
    instance.close = vi.fn();
    instance.readyState = 1;
    wsInstances.push(instance);
    return instance;
  });
  (MockWS as any).OPEN = 1;

  return {
    default: MockWS,
    WebSocket: MockWS,
  };
});

// Import after mocking
import WebSocket from "ws";
import {
  MacroAgentObservabilityService,
  getMacroAgentObservabilityService,
  resetMacroAgentObservabilityService,
  type MacroAgentObservabilityConfig,
} from "../../../src/services/macro-agent-observability.js";
import {
  broadcastToProject,
  broadcastExecutionUpdate,
} from "../../../src/services/websocket.js";

// Helper to get latest WebSocket instance
function getWs() {
  return wsInstances[wsInstances.length - 1];
}

describe("MacroAgentObservabilityService", () => {
  const defaultConfig: MacroAgentObservabilityConfig = {
    apiBaseUrl: "http://localhost:3100",
    maxReconnectAttempts: 3,
    baseReconnectDelayMs: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetMacroAgentObservabilityService();
    wsInstances.length = 0;
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    vi.useRealTimers();
    resetMacroAgentObservabilityService();
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================
  describe("constructor", () => {
    it("should create service with provided config", () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      expect(service).toBeDefined();
      expect(service.isConnected()).toBe(false);
      expect(service.getConnectionState()).toBe("disconnected");
    });

    it("should use default values for optional config", () => {
      const service = new MacroAgentObservabilityService({
        apiBaseUrl: "http://localhost:3100",
      });

      expect(service).toBeDefined();
    });
  });

  // ===========================================================================
  // Connection Tests
  // ===========================================================================
  describe("connection", () => {
    it("should connect to WebSocket URL", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      const connectPromise = service.connect();
      const ws = getWs();
      ws.emit("open");

      await connectPromise;

      expect(WebSocket).toHaveBeenCalledWith("ws://localhost:3100/ws");
      expect(service.isConnected()).toBe(true);
      expect(service.getConnectionState()).toBe("connected");
    });

    it("should subscribe to agents and tasks channels on connect", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      const connectPromise = service.connect();
      const ws = getWs();
      ws.emit("open");
      await connectPromise;

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "subscribe", channel: "agents" })
      );
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "subscribe", channel: "tasks" })
      );
    });

    it("should not reconnect if already connected", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      const connectPromise1 = service.connect();
      getWs().emit("open");
      await connectPromise1;

      await service.connect();

      expect(WebSocket).toHaveBeenCalledTimes(1);
    });

    it("should reset reconnect attempts on successful connect", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;

      expect(service.isConnected()).toBe(true);
    });

    it("should handle connection error", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      const connectPromise = service.connect();
      getWs().emit("error", new Error("Connection refused"));

      await expect(connectPromise).rejects.toThrow();
      expect(service.isConnected()).toBe(false);
    });

    it("should close connection properly", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      const connectPromise = service.connect();
      const ws = getWs();
      ws.emit("open");
      await connectPromise;

      await service.close();

      expect(ws.close).toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });
  });

  // ===========================================================================
  // Reconnection Tests
  // ===========================================================================
  describe("reconnection", () => {
    it("should schedule reconnect on disconnect when was connected", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);

      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;

      vi.mocked(WebSocket).mockClear();
      getWs().emit("close", 1006, "Connection closed");

      expect(service.getConnectionState()).toBe("reconnecting");

      vi.advanceTimersByTime(100);

      expect(WebSocket).toHaveBeenCalled();
    });

    it("should use exponential backoff for reconnection", async () => {
      const service = new MacroAgentObservabilityService({
        ...defaultConfig,
        baseReconnectDelayMs: 100,
        maxReconnectAttempts: 3,
      });

      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;

      vi.mocked(WebSocket).mockClear();
      getWs().emit("close", 1006, "Connection closed");

      vi.advanceTimersByTime(99);
      expect(WebSocket).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(WebSocket).toHaveBeenCalledTimes(1);
    });

    it("should stop reconnecting after max attempts", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const service = new MacroAgentObservabilityService({
        ...defaultConfig,
        maxReconnectAttempts: 2,
        baseReconnectDelayMs: 10,
      });

      // Initial connection succeeds
      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;

      // Connection drops - scheduleReconnect called, reconnectAttempts becomes 1
      getWs().emit("close", 1006, "Connection closed");

      // Advance timer - reconnect attempt 1 starts
      vi.advanceTimersByTime(10); // 10 * 2^0 = 10ms

      // Reconnect 1 fails (no open, just error) - triggers catch block
      // catch block calls scheduleReconnect, reconnectAttempts becomes 2
      getWs().emit("error", new Error("Connection refused"));

      // Allow the catch block to execute and schedule next reconnect
      await vi.runAllTimersAsync();

      // Reconnect 2 fails - triggers catch block
      // catch block calls scheduleReconnect, check 2 >= 2? yes, log error
      getWs().emit("error", new Error("Connection refused"));

      // Allow the catch block to execute
      await vi.runAllTimersAsync();

      // After max attempts, should log error
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Max reconnect attempts")
      );

      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Agent Registry Tests
  // ===========================================================================
  describe("agent registry", () => {
    let service: MacroAgentObservabilityService;

    beforeEach(async () => {
      service = new MacroAgentObservabilityService(defaultConfig);
      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;
    });

    it("should start with empty registry", () => {
      expect(service.getAllAgents()).toEqual([]);
      expect(service.getAllSessions()).toEqual([]);
    });

    it("should add agent on spawned event", () => {
      const ws = getWs();
      const agentUpdate = {
        type: "agent_update",
        action: "spawned",
        agent: {
          id: "agent-1",
          session_id: "session-1",
          task: "Test task",
          state: "spawning",
          parent: null,
          children_count: 0,
          created_at: Date.now(),
        },
      };

      ws.emit("message", JSON.stringify(agentUpdate));

      const agents = service.getAllAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe("agent-1");
      expect(agents[0].session_id).toBe("session-1");
    });

    it("should update agent state on started event", () => {
      const ws = getWs();

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Test task",
            state: "spawning",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "started",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Test task",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      const agent = service.getAgent("agent-1");
      expect(agent?.state).toBe("running");
    });

    it("should update agent state to stopped", () => {
      const ws = getWs();

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Test task",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "stopped",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Test task",
            state: "stopped",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      const agent = service.getAgent("agent-1");
      expect(agent?.state).toBe("stopped");
    });

    it("should track known sessions", () => {
      const ws = getWs();

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Test task",
            state: "spawning",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-2",
            session_id: "session-2",
            task: "Another task",
            state: "spawning",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      const sessions = service.getAllSessions();
      expect(sessions).toContain("session-1");
      expect(sessions).toContain("session-2");
      expect(sessions).toHaveLength(2);
    });

    it("should filter agents by session", () => {
      const ws = getWs();

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task 1",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-2",
            session_id: "session-2",
            task: "Task 2",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      const session1Agents = service.getAgentsBySession("session-1");
      expect(session1Agents).toHaveLength(1);
      expect(session1Agents[0].id).toBe("agent-1");
    });

    it("should filter agents by state", () => {
      const ws = getWs();

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task 1",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-2",
            session_id: "session-1",
            task: "Task 2",
            state: "stopped",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      const runningAgents = service.getAgentsByState("running");
      expect(runningAgents).toHaveLength(1);
      expect(runningAgents[0].id).toBe("agent-1");
    });
  });

  // ===========================================================================
  // Connection Tracking Tests
  // ===========================================================================
  describe("connection tracking", () => {
    let service: MacroAgentObservabilityService;

    beforeEach(async () => {
      service = new MacroAgentObservabilityService(defaultConfig);
      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;
    });

    it("should register execution connection", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      const conn = service.getExecutionConnection("exec-1");
      expect(conn).toBeDefined();
      expect(conn?.executionId).toBe("exec-1");
      expect(conn?.projectId).toBe("project-1");
      expect(conn?.macroAgentSessionId).toBe("session-1");
      expect(conn?.connectedAt).toBeDefined();
      expect(conn?.disconnectedAt).toBeUndefined();
    });

    it("should track session when connection registered", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      const sessions = service.getAllSessions();
      expect(sessions).toContain("session-1");
    });

    it("should unregister execution connection", () => {
      service.registerConnection("exec-1", "project-1", "session-1");
      service.unregisterConnection("exec-1");

      const conn = service.getExecutionConnection("exec-1");
      expect(conn?.disconnectedAt).toBeDefined();
    });

    it("should report connection status correctly", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      expect(service.isExecutionConnected("exec-1")).toBe(true);
      expect(service.isExecutionConnected("exec-999")).toBe(false);

      service.unregisterConnection("exec-1");
      expect(service.isExecutionConnected("exec-1")).toBe(false);
    });

    it("should return agents for execution via session", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      const ws = getWs();
      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      const agents = service.getAgentsForExecution("exec-1");
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe("agent-1");
    });

    it("should return empty array for unknown execution", () => {
      const agents = service.getAgentsForExecution("unknown-exec");
      expect(agents).toEqual([]);
    });

    it("should get session for execution", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      expect(service.getSessionForExecution("exec-1")).toBe("session-1");
      expect(service.getSessionForExecution("unknown")).toBeUndefined();
    });

    it("should list all execution connections", () => {
      service.registerConnection("exec-1", "project-1", "session-1");
      service.registerConnection("exec-2", "project-2", "session-2");

      const all = service.getAllExecutionConnections();
      expect(all).toHaveLength(2);
    });

    it("should list only active connections", () => {
      service.registerConnection("exec-1", "project-1", "session-1");
      service.registerConnection("exec-2", "project-2", "session-2");
      service.unregisterConnection("exec-1");

      const active = service.getActiveExecutionConnections();
      expect(active).toHaveLength(1);
      expect(active[0].executionId).toBe("exec-2");
    });
  });

  // ===========================================================================
  // Event Broadcasting Tests
  // ===========================================================================
  describe("event broadcasting", () => {
    let service: MacroAgentObservabilityService;

    beforeEach(async () => {
      service = new MacroAgentObservabilityService(defaultConfig);
      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;
    });

    it("should broadcast agent update to connected executions", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      const ws = getWs();
      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        "project-1",
        "exec-1",
        "updated",
        expect.objectContaining({
          macro_agent_event: expect.objectContaining({
            event_type: "macro_agent_update",
          }),
        })
      );
    });

    it("should not broadcast to disconnected executions", () => {
      service.registerConnection("exec-1", "project-1", "session-1");
      service.unregisterConnection("exec-1");

      vi.mocked(broadcastExecutionUpdate).mockClear();

      const ws = getWs();
      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      expect(broadcastExecutionUpdate).not.toHaveBeenCalledWith(
        "project-1",
        "exec-1",
        expect.anything(),
        expect.anything()
      );
    });

    it("should broadcast to project for global updates", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      const ws = getWs();
      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      expect(broadcastToProject).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          type: "execution_updated",
          data: expect.objectContaining({
            macro_agent_event: expect.anything(),
          }),
        })
      );
    });

    it("should broadcast task updates globally", () => {
      service.registerConnection("exec-1", "project-1", "session-1");

      const ws = getWs();
      ws.emit(
        "message",
        JSON.stringify({
          type: "task_update",
          action: "created",
          task: {
            id: "task-1",
            description: "Test task",
            status: "pending",
            created_at: Date.now(),
          },
        })
      );

      expect(broadcastToProject).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          data: expect.objectContaining({
            macro_agent_event: expect.objectContaining({
              event_type: "macro_task_update",
            }),
          }),
        })
      );
    });

    it("should handle subscription confirmation", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const ws = getWs();
      ws.emit(
        "message",
        JSON.stringify({
          type: "subscribed",
          channel: "agents",
        })
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Subscription confirmed: agents")
      );

      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Statistics Tests
  // ===========================================================================
  describe("statistics", () => {
    let service: MacroAgentObservabilityService;

    beforeEach(async () => {
      service = new MacroAgentObservabilityService(defaultConfig);
      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;
    });

    it("should return correct stats", () => {
      const ws = getWs();

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task 1",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-2",
            session_id: "session-1",
            task: "Task 2",
            state: "stopped",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      service.registerConnection("exec-1", "project-1", "session-1");
      service.registerConnection("exec-2", "project-2", "session-2");
      service.unregisterConnection("exec-2");

      const stats = service.getStats();

      expect(stats.connectionState).toBe("connected");
      expect(stats.totalAgents).toBe(2);
      expect(stats.runningAgents).toBe(1);
      expect(stats.stoppedAgents).toBe(1);
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalExecutionConnections).toBe(2);
      expect(stats.activeExecutionConnections).toBe(1);
    });
  });

  // ===========================================================================
  // REST API Tests
  // ===========================================================================
  describe("REST API queries", () => {
    let service: MacroAgentObservabilityService;

    beforeEach(async () => {
      service = new MacroAgentObservabilityService(defaultConfig);
      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;
    });

    it("should fetch hierarchy from API", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tree: {}, depth: 1, total_agents: 1 }),
      } as Response);

      const result = await service.fetchHierarchy("session-1");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3100/api/hierarchy?session=session-1"
      );
      expect(result).toEqual({ tree: {}, depth: 1, total_agents: 1 });
    });

    it("should fetch tasks from API", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: [], total: 0 }),
      } as Response);

      const result = await service.fetchTasks({ status: "pending" });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3100/api/tasks?status=pending"
      );
      expect(result).toEqual({ tasks: [], total: 0 });
    });

    it("should fetch agents from API", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ agents: [], total: 0 }),
      } as Response);

      const result = await service.fetchAgents({ state: "running" });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3100/api/agents?state=running"
      );
      expect(result).toEqual({ agents: [], total: 0 });
    });

    it("should throw on API error", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        statusText: "Not Found",
      } as Response);

      await expect(service.fetchHierarchy()).rejects.toThrow(
        "Failed to fetch hierarchy: Not Found"
      );
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================
  describe("singleton", () => {
    it("should return same instance on multiple calls", () => {
      const instance1 = getMacroAgentObservabilityService(defaultConfig);
      const instance2 = getMacroAgentObservabilityService();

      expect(instance1).toBe(instance2);
    });

    it("should throw if no config on first call", () => {
      expect(() => getMacroAgentObservabilityService()).toThrow(
        "config required on first call"
      );
    });

    it("should reset singleton properly", () => {
      const instance1 = getMacroAgentObservabilityService(defaultConfig);
      resetMacroAgentObservabilityService();
      const instance2 = getMacroAgentObservabilityService(defaultConfig);

      expect(instance1).not.toBe(instance2);
    });
  });

  // ===========================================================================
  // Clear Data Tests
  // ===========================================================================
  describe("clear", () => {
    it("should clear all data", async () => {
      const service = new MacroAgentObservabilityService(defaultConfig);
      const connectPromise = service.connect();
      getWs().emit("open");
      await connectPromise;

      service.registerConnection("exec-1", "project-1", "session-1");
      const ws = getWs();
      ws.emit(
        "message",
        JSON.stringify({
          type: "agent_update",
          action: "spawned",
          agent: {
            id: "agent-1",
            session_id: "session-1",
            task: "Task",
            state: "running",
            parent: null,
            children_count: 0,
            created_at: Date.now(),
          },
        })
      );

      expect(service.getAllAgents()).toHaveLength(1);
      expect(service.getAllExecutionConnections()).toHaveLength(1);

      service.clear();

      expect(service.getAllAgents()).toHaveLength(0);
      expect(service.getAllExecutionConnections()).toHaveLength(0);
      expect(service.getAllSessions()).toHaveLength(0);
    });
  });
});
