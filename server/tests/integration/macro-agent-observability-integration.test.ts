/**
 * Macro-Agent Observability Integration Tests
 *
 * Tests the integration of Phase 4 observability components:
 * - MacroAgentObservabilityService (core service)
 * - Event handling and registry population
 * - Execution connection lifecycle
 *
 * Note: REST API and WebSocket broadcasting are covered by unit tests in:
 * - tests/unit/routes/macro-agent.test.ts
 * - tests/unit/services/macro-agent-observability.test.ts
 *
 * @module tests/integration/macro-agent-observability-integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import * as http from "http";

// Mock broadcast functions (separate from WebSocket server mock)
const mockBroadcastToProject = vi.fn();
const mockBroadcastExecutionUpdate = vi.fn();

vi.mock("../../src/services/websocket.js", () => ({
  broadcastToProject: (...args: any[]) => mockBroadcastToProject(...args),
  broadcastExecutionUpdate: (...args: any[]) => mockBroadcastExecutionUpdate(...args),
  websocketManager: {
    clients: new Map(),
  },
}));

// Import after mocking
import {
  MacroAgentObservabilityService,
  resetMacroAgentObservabilityService,
} from "../../src/services/macro-agent-observability.js";

describe("Macro-Agent Observability Integration Tests", () => {
  let mockMacroAgentServer: WebSocketServer;
  let httpServer: http.Server;
  let serverUrl: string;
  let observabilityService: MacroAgentObservabilityService;
  let serverConnections: WebSocket[] = [];

  beforeEach(async () => {
    // Reset mocks
    mockBroadcastToProject.mockClear();
    mockBroadcastExecutionUpdate.mockClear();
    vi.clearAllMocks();

    // Create a mock macro-agent WebSocket server
    httpServer = http.createServer();
    mockMacroAgentServer = new WebSocketServer({ server: httpServer });
    serverConnections = [];

    mockMacroAgentServer.on("connection", (ws) => {
      serverConnections.push(ws);
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "subscribe") {
          ws.send(JSON.stringify({
            type: "subscribed",
            channel: message.channel,
          }));
        }
      });
    });

    // Start the mock server
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address() as { port: number };
        serverUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });

    // Reset singleton
    resetMacroAgentObservabilityService();

    // Create observability service
    observabilityService = new MacroAgentObservabilityService({
      apiBaseUrl: serverUrl,
    });
  });

  afterEach(async () => {
    // Close in order: observability first, then server
    if (observabilityService) {
      await observabilityService.close();
    }

    // Close server connections
    for (const ws of serverConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    serverConnections = [];

    // Close servers
    if (mockMacroAgentServer) {
      mockMacroAgentServer.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }

    resetMacroAgentObservabilityService();
  });

  // ===========================================================================
  // End-to-End Event Flow: Server → Service → Registry → Broadcasts
  // ===========================================================================
  describe("End-to-End Event Flow", () => {
    it("should complete full lifecycle: connect → receive event → update registry → broadcast", async () => {
      // Step 1: Connect to macro-agent server
      await observabilityService.connect();
      expect(observabilityService.isConnected()).toBe(true);
      expect(serverConnections.length).toBe(1);

      // Step 2: Register an execution connection
      observabilityService.registerConnection("exec-e2e", "proj-e2e", "sess-e2e");
      expect(observabilityService.isExecutionConnected("exec-e2e")).toBe(true);

      // Step 3: Server sends agent event
      serverConnections[0]?.send(JSON.stringify({
        type: "agent_update",
        action: "spawned",
        agent: {
          id: "agent-e2e",
          session_id: "sess-e2e",
          task: "E2E Test Task",
          state: "running",
          parent: null,
          children_count: 0,
          created_at: Date.now(),
        },
      }));

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 4: Verify registry was updated
      const agents = observabilityService.getAllAgents();
      expect(agents.length).toBe(1);
      expect(agents[0].id).toBe("agent-e2e");
      expect(agents[0].task).toBe("E2E Test Task");

      // Step 5: Verify broadcasts were called
      expect(mockBroadcastExecutionUpdate).toHaveBeenCalled();

      // Step 6: Verify execution can see its agents
      const execAgents = observabilityService.getAgentsForExecution("exec-e2e");
      expect(execAgents.length).toBe(1);
      expect(execAgents[0].id).toBe("agent-e2e");

      // Step 7: Unregister execution
      observabilityService.unregisterConnection("exec-e2e");
      expect(observabilityService.isExecutionConnected("exec-e2e")).toBe(false);

      // Step 8: Verify historical data still available
      const conn = observabilityService.getExecutionConnection("exec-e2e");
      expect(conn).toBeDefined();
      expect(conn?.disconnectedAt).toBeDefined();
    });

    it("should handle session resume: E1 disconnects, E2 connects to same session", async () => {
      await observabilityService.connect();

      // E1 connects to session
      observabilityService.registerConnection("exec-1", "proj-1", "shared-session");

      // Server sends agent
      serverConnections[0]?.send(JSON.stringify({
        type: "agent_update",
        action: "spawned",
        agent: {
          id: "agent-shared",
          session_id: "shared-session",
          task: "Shared Task",
          state: "running",
          parent: null,
          children_count: 0,
          created_at: Date.now(),
        },
      }));

      await new Promise((resolve) => setTimeout(resolve, 100));

      // E1 disconnects
      observabilityService.unregisterConnection("exec-1");

      // E2 connects (resume)
      observabilityService.registerConnection("exec-2", "proj-1", "shared-session");

      // E2 should see agents from the session
      const e2Agents = observabilityService.getAgentsForExecution("exec-2");
      expect(e2Agents.length).toBe(1);
      expect(e2Agents[0].id).toBe("agent-shared");

      // Both executions in history
      expect(observabilityService.getAllExecutionConnections().length).toBe(2);
      expect(observabilityService.getActiveExecutionConnections().length).toBe(1);
    });

    it("should track agent lifecycle: spawned → running → stopped", async () => {
      await observabilityService.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const agentId = "agent-lifecycle";
      const sessionId = "sess-lifecycle";

      // Spawn
      serverConnections[0]?.send(JSON.stringify({
        type: "agent_update",
        action: "spawned",
        agent: { id: agentId, session_id: sessionId, task: "Lifecycle", state: "spawning", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      let agent = observabilityService.getAgent(agentId);
      expect(agent?.state).toBe("spawning");

      // Start
      serverConnections[0]?.send(JSON.stringify({
        type: "agent_update",
        action: "started",
        agent: { id: agentId, session_id: sessionId, task: "Lifecycle", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      agent = observabilityService.getAgent(agentId);
      expect(agent?.state).toBe("running");

      // Stop
      serverConnections[0]?.send(JSON.stringify({
        type: "agent_update",
        action: "stopped",
        agent: { id: agentId, session_id: sessionId, task: "Lifecycle", state: "stopped", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      agent = observabilityService.getAgent(agentId);
      expect(agent?.state).toBe("stopped");

      // Stats should reflect stopped agent
      const stats = observabilityService.getStats();
      expect(stats.stoppedAgents).toBe(1);
      expect(stats.runningAgents).toBe(0);
    });
  });

  // ===========================================================================
  // Multi-Session Scenarios
  // ===========================================================================
  describe("Multi-Session Scenarios", () => {
    it("should track agents across multiple sessions independently", async () => {
      await observabilityService.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Spawn agents in 3 different sessions
      for (let s = 0; s < 3; s++) {
        for (let a = 0; a < 2; a++) {
          serverConnections[0]?.send(JSON.stringify({
            type: "agent_update",
            action: "spawned",
            agent: {
              id: `agent-s${s}-a${a}`,
              session_id: `session-${s}`,
              task: `Task ${s}-${a}`,
              state: "running",
              parent: null,
              children_count: 0,
              created_at: Date.now(),
            },
          }));
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Total agents
      expect(observabilityService.getAllAgents().length).toBe(6);

      // Sessions
      expect(observabilityService.getAllSessions().length).toBe(3);

      // Per-session agents
      for (let s = 0; s < 3; s++) {
        const sessionAgents = observabilityService.getAgentsBySession(`session-${s}`);
        expect(sessionAgents.length).toBe(2);
      }
    });

    it("should correctly filter agents by state across sessions", async () => {
      await observabilityService.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const ws = serverConnections[0];
      if (!ws) throw new Error("No WebSocket connection");

      // Session 1: 2 running, 1 stopped
      // a1-r1: running
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a1-r1", session_id: "s1", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // a1-r2: running
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a1-r2", session_id: "s1", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // a1-s1: started then stopped (must spawn first!)
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a1-s1", session_id: "s1", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      ws.send(JSON.stringify({
        type: "agent_update", action: "stopped",
        agent: { id: "a1-s1", session_id: "s1", task: "T", state: "stopped", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Session 2: 1 running, 2 stopped
      // a2-r1: running
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a2-r1", session_id: "s2", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // a2-s1: started then stopped
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a2-s1", session_id: "s2", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      ws.send(JSON.stringify({
        type: "agent_update", action: "stopped",
        agent: { id: "a2-s1", session_id: "s2", task: "T", state: "stopped", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // a2-s2: started then stopped
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a2-s2", session_id: "s2", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      ws.send(JSON.stringify({
        type: "agent_update", action: "stopped",
        agent: { id: "a2-s2", session_id: "s2", task: "T", state: "stopped", parent: null, children_count: 0, created_at: Date.now() },
      }));

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = observabilityService.getStats();
      expect(stats.totalAgents).toBe(6);
      expect(stats.runningAgents).toBe(3); // 2 from s1 + 1 from s2
      expect(stats.stoppedAgents).toBe(3); // 1 from s1 + 2 from s2
    });
  });

  // ===========================================================================
  // Service State Management
  // ===========================================================================
  describe("Service State Management", () => {
    it("should report correct state when not connected", () => {
      // Don't call connect()
      expect(observabilityService.isConnected()).toBe(false);
      expect(observabilityService.getConnectionState()).toBe("disconnected");
      expect(observabilityService.getAllAgents()).toHaveLength(0);
      expect(observabilityService.getAllSessions()).toHaveLength(0);
    });

    it("should report correct state when connected", async () => {
      await observabilityService.connect();

      expect(observabilityService.isConnected()).toBe(true);
      expect(observabilityService.getConnectionState()).toBe("connected");
    });

    it("should clear data and report disconnected after close", async () => {
      await observabilityService.connect();

      // Add some data
      observabilityService.registerConnection("e1", "p1", "s1");

      await observabilityService.close();

      expect(observabilityService.isConnected()).toBe(false);
      expect(observabilityService.getConnectionState()).toBe("disconnected");
    });

    it("should provide accurate stats", async () => {
      await observabilityService.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const ws = serverConnections[0];
      if (!ws) throw new Error("No WebSocket connection");

      // Register connections
      observabilityService.registerConnection("e1", "p1", "s1");
      observabilityService.registerConnection("e2", "p1", "s2");
      observabilityService.unregisterConnection("e1"); // Disconnect e1

      // Add agent a1: running
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a1", session_id: "s1", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Add agent a2: started then stopped (must start first!)
      ws.send(JSON.stringify({
        type: "agent_update", action: "started",
        agent: { id: "a2", session_id: "s2", task: "T", state: "running", parent: null, children_count: 0, created_at: Date.now() },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.send(JSON.stringify({
        type: "agent_update", action: "stopped",
        agent: { id: "a2", session_id: "s2", task: "T", state: "stopped", parent: null, children_count: 0, created_at: Date.now() },
      }));

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = observabilityService.getStats();

      expect(stats.connectionState).toBe("connected");
      expect(stats.totalAgents).toBe(2);
      expect(stats.runningAgents).toBe(1);
      expect(stats.stoppedAgents).toBe(1);
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalExecutionConnections).toBe(2);
      expect(stats.activeExecutionConnections).toBe(1);
    });
  });
});
