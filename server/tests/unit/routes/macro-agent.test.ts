/**
 * Tests for Macro-Agent Observability Routes
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Express } from "express";
import request from "supertest";

// Mock the dependencies
const mockObservabilityService = {
  getStats: vi.fn(),
  getAllAgents: vi.fn(),
  getAgentsBySession: vi.fn(),
  getAgentsByState: vi.fn(),
  getAllSessions: vi.fn(),
  getActiveExecutionConnections: vi.fn(),
  getSessionForExecution: vi.fn(),
  getExecutionConnection: vi.fn(),
  isConnected: vi.fn(),
};

const mockServerManager = {
  isReady: vi.fn(),
  getObservabilityService: vi.fn(),
};

vi.mock("../../../src/services/macro-agent-server-manager.js", () => ({
  getMacroAgentServerManager: () => mockServerManager,
}));

// Import after mocking
import {
  createMacroAgentRouter,
  createExecutionMacroRouter,
} from "../../../src/routes/macro-agent.js";

describe("Macro-Agent Routes", () => {
  let app: Express;

  const mockAgentRecord = (overrides = {}) => ({
    id: "agent-1",
    session_id: "session-1",
    task: "Test task",
    state: "running" as const,
    parent: null,
    lineage: [],
    children_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  });

  const mockExecutionConnection = (overrides = {}) => ({
    executionId: "exec-1",
    projectId: "proj-1",
    macroAgentSessionId: "session-1",
    connectedAt: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup - observability available
    mockServerManager.isReady.mockReturnValue(true);
    mockServerManager.getObservabilityService.mockReturnValue(
      mockObservabilityService
    );

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use("/api/macro-agent", createMacroAgentRouter());
    app.use("/api/executions/:id/macro", createExecutionMacroRouter());
  });

  // ===========================================================================
  // GET /api/macro-agent/status Tests
  // ===========================================================================
  describe("GET /api/macro-agent/status", () => {
    it("should return status when observability is connected", async () => {
      mockObservabilityService.getStats.mockReturnValue({
        connectionState: "connected",
        totalAgents: 5,
        runningAgents: 3,
        stoppedAgents: 2,
        totalSessions: 2,
        totalExecutionConnections: 3,
        activeExecutionConnections: 2,
      });

      const response = await request(app).get("/api/macro-agent/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        serverReady: true,
        observabilityConnected: true,
        agents: { total: 5, running: 3, stopped: 2 },
        sessions: { total: 2 },
        executions: { connected: 2 },
      });
    });

    it("should return status with zeros when observability not available", async () => {
      mockServerManager.getObservabilityService.mockReturnValue(null);

      const response = await request(app).get("/api/macro-agent/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        serverReady: true,
        observabilityConnected: false,
        agents: { total: 0, running: 0, stopped: 0 },
        sessions: { total: 0 },
        executions: { connected: 0 },
      });
    });

    it("should report serverReady as false when server not ready", async () => {
      mockServerManager.isReady.mockReturnValue(false);
      mockServerManager.getObservabilityService.mockReturnValue(null);

      const response = await request(app).get("/api/macro-agent/status");

      expect(response.status).toBe(200);
      expect(response.body.serverReady).toBe(false);
    });
  });

  // ===========================================================================
  // GET /api/macro-agent/agents Tests
  // ===========================================================================
  describe("GET /api/macro-agent/agents", () => {
    it("should return all agents", async () => {
      const agents = [
        mockAgentRecord({ id: "agent-1" }),
        mockAgentRecord({ id: "agent-2", state: "stopped" }),
      ];
      mockObservabilityService.getAllAgents.mockReturnValue(agents);

      const response = await request(app).get("/api/macro-agent/agents");

      expect(response.status).toBe(200);
      expect(response.body.agents).toHaveLength(2);
      expect(response.body.total).toBe(2);
    });

    it("should filter agents by session", async () => {
      const agents = [mockAgentRecord({ id: "agent-1", session_id: "sess-1" })];
      mockObservabilityService.getAgentsBySession.mockReturnValue(agents);

      const response = await request(app)
        .get("/api/macro-agent/agents")
        .query({ session: "sess-1" });

      expect(response.status).toBe(200);
      expect(mockObservabilityService.getAgentsBySession).toHaveBeenCalledWith(
        "sess-1"
      );
      expect(response.body.agents).toHaveLength(1);
    });

    it("should filter agents by state", async () => {
      const agents = [mockAgentRecord({ id: "agent-1", state: "running" })];
      mockObservabilityService.getAgentsByState.mockReturnValue(agents);

      const response = await request(app)
        .get("/api/macro-agent/agents")
        .query({ state: "running" });

      expect(response.status).toBe(200);
      expect(mockObservabilityService.getAgentsByState).toHaveBeenCalledWith(
        "running"
      );
      expect(response.body.agents).toHaveLength(1);
    });

    it("should return 503 when observability unavailable", async () => {
      mockServerManager.getObservabilityService.mockReturnValue(null);

      const response = await request(app).get("/api/macro-agent/agents");

      expect(response.status).toBe(503);
      expect(response.body.error).toContain("not available");
    });
  });

  // ===========================================================================
  // GET /api/macro-agent/sessions Tests
  // ===========================================================================
  describe("GET /api/macro-agent/sessions", () => {
    it("should return all sessions with agent counts", async () => {
      mockObservabilityService.getAllSessions.mockReturnValue([
        "session-1",
        "session-2",
      ]);
      mockObservabilityService.getActiveExecutionConnections.mockReturnValue([
        mockExecutionConnection({ macroAgentSessionId: "session-1" }),
      ]);
      mockObservabilityService.getAgentsBySession.mockImplementation((id) => {
        if (id === "session-1") {
          return [
            mockAgentRecord({ state: "running" }),
            mockAgentRecord({ state: "stopped" }),
          ];
        }
        return [mockAgentRecord({ state: "running" })];
      });

      const response = await request(app).get("/api/macro-agent/sessions");

      expect(response.status).toBe(200);
      expect(response.body.sessions).toHaveLength(2);
      expect(response.body.total).toBe(2);

      const session1 = response.body.sessions.find(
        (s: any) => s.id === "session-1"
      );
      expect(session1.agentCount).toBe(2);
      expect(session1.runningCount).toBe(1);
      expect(session1.connectedExecutions).toContain("exec-1");
    });

    it("should return 503 when observability unavailable", async () => {
      mockServerManager.getObservabilityService.mockReturnValue(null);

      const response = await request(app).get("/api/macro-agent/sessions");

      expect(response.status).toBe(503);
    });
  });

  // ===========================================================================
  // GET /api/executions/:id/macro/agents Tests
  // ===========================================================================
  describe("GET /api/executions/:id/macro/agents", () => {
    it("should return agents for execution's session", async () => {
      mockObservabilityService.getSessionForExecution.mockReturnValue(
        "session-1"
      );
      const agents = [mockAgentRecord({ session_id: "session-1" })];
      mockObservabilityService.getAgentsBySession.mockReturnValue(agents);

      const response = await request(app).get(
        "/api/executions/exec-1/macro/agents"
      );

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe("session-1");
      expect(response.body.agents).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it("should return empty agents when execution has no session", async () => {
      mockObservabilityService.getSessionForExecution.mockReturnValue(
        undefined
      );

      const response = await request(app).get(
        "/api/executions/exec-1/macro/agents"
      );

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeNull();
      expect(response.body.agents).toHaveLength(0);
      expect(response.body.total).toBe(0);
    });

    it("should return 503 when observability unavailable", async () => {
      mockServerManager.getObservabilityService.mockReturnValue(null);

      const response = await request(app).get(
        "/api/executions/exec-1/macro/agents"
      );

      expect(response.status).toBe(503);
    });
  });

  // ===========================================================================
  // GET /api/executions/:id/macro/session Tests
  // ===========================================================================
  describe("GET /api/executions/:id/macro/session", () => {
    it("should return session info for connected execution", async () => {
      const connection = mockExecutionConnection({
        macroAgentSessionId: "session-1",
        connectedAt: 1700000000000,
      });
      mockObservabilityService.getExecutionConnection.mockReturnValue(
        connection
      );
      mockObservabilityService.getAgentsBySession.mockReturnValue([
        mockAgentRecord({ state: "running" }),
        mockAgentRecord({ state: "stopped" }),
      ]);

      const response = await request(app).get(
        "/api/executions/exec-1/macro/session"
      );

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe("session-1");
      expect(response.body.connectedAt).toBe(1700000000000);
      expect(response.body.agentCount).toBe(2);
      expect(response.body.runningCount).toBe(1);
    });

    it("should return null session for unconnected execution", async () => {
      mockObservabilityService.getExecutionConnection.mockReturnValue(
        undefined
      );

      const response = await request(app).get(
        "/api/executions/exec-1/macro/session"
      );

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeNull();
      expect(response.body.connectedAt).toBeNull();
      expect(response.body.agentCount).toBe(0);
      expect(response.body.runningCount).toBe(0);
    });

    it("should return 503 when observability unavailable", async () => {
      mockServerManager.getObservabilityService.mockReturnValue(null);

      const response = await request(app).get(
        "/api/executions/exec-1/macro/session"
      );

      expect(response.status).toBe(503);
    });
  });
});
