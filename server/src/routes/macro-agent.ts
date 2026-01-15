/**
 * Macro-Agent Observability Routes
 *
 * REST endpoints for querying macro-agent state - both global views
 * and execution-scoped views.
 *
 * @module routes/macro-agent
 */

import { Router, Request, Response } from "express";
import { getMacroAgentServerManager } from "../services/macro-agent-server-manager.js";
import type {
  MacroAgentObservabilityService,
  AgentRecord,
} from "../services/macro-agent-observability.js";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface MacroAgentStatusResponse {
  serverReady: boolean;
  observabilityConnected: boolean;
  agents: {
    total: number;
    running: number;
    stopped: number;
  };
  sessions: {
    total: number;
  };
  executions: {
    connected: number;
  };
}

interface MacroAgentAgentsResponse {
  agents: AgentRecord[];
  total: number;
}

interface MacroAgentSessionsResponse {
  sessions: Array<{
    id: string;
    agentCount: number;
    runningCount: number;
    connectedExecutions: string[];
  }>;
  total: number;
}

interface ExecutionMacroAgentsResponse {
  agents: AgentRecord[];
  sessionId: string | null;
  total: number;
}

interface ExecutionMacroSessionResponse {
  sessionId: string | null;
  connectedAt: number | null;
  agentCount: number;
  runningCount: number;
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Get the observability service, returning null if unavailable
 */
function getObservabilityService(): MacroAgentObservabilityService | null {
  try {
    const manager = getMacroAgentServerManager();
    return manager.getObservabilityService();
  } catch {
    return null;
  }
}

/**
 * Send 503 response when observability is unavailable
 */
function sendServiceUnavailable(res: Response): void {
  res.status(503).json({
    error: "Macro-agent observability service is not available",
    details: "The macro-agent server may not be running or is starting up",
  });
}

// ─────────────────────────────────────────────────────────────────
// Router Factory
// ─────────────────────────────────────────────────────────────────

/**
 * Create the macro-agent routes router
 */
export function createMacroAgentRouter(): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────
  // Global Endpoints
  // ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/macro-agent/status
   *
   * Returns overall status of the macro-agent observability system.
   * Unlike /api/agents/macro-agent/status which focuses on the server process,
   * this focuses on the observability data.
   */
  router.get("/status", (_req: Request, res: Response) => {
    try {
      const manager = getMacroAgentServerManager();
      const observability = manager.getObservabilityService();

      if (!observability) {
        const response: MacroAgentStatusResponse = {
          serverReady: manager.isReady(),
          observabilityConnected: false,
          agents: { total: 0, running: 0, stopped: 0 },
          sessions: { total: 0 },
          executions: { connected: 0 },
        };
        return res.status(200).json(response);
      }

      const stats = observability.getStats();
      const response: MacroAgentStatusResponse = {
        serverReady: manager.isReady(),
        observabilityConnected: stats.connectionState === "connected",
        agents: {
          total: stats.totalAgents,
          running: stats.runningAgents,
          stopped: stats.stoppedAgents,
        },
        sessions: {
          total: stats.totalSessions,
        },
        executions: {
          connected: stats.activeExecutionConnections,
        },
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error("[MacroAgentRoutes] Failed to get status:", error);
      return res.status(500).json({
        error: "Failed to retrieve macro-agent status",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/macro-agent/agents
   *
   * Returns all agents tracked by the observability service.
   * Optionally filter by session ID.
   *
   * Query params:
   * - session: Filter by session ID
   * - state: Filter by agent state (spawning, running, stopped)
   */
  router.get("/agents", (req: Request, res: Response) => {
    const observability = getObservabilityService();
    if (!observability) {
      return sendServiceUnavailable(res);
    }

    try {
      const { session, state } = req.query;
      let agents: AgentRecord[];

      if (session && typeof session === "string") {
        agents = observability.getAgentsBySession(session);
      } else if (state && typeof state === "string") {
        agents = observability.getAgentsByState(
          state as AgentRecord["state"]
        );
      } else {
        agents = observability.getAllAgents();
      }

      const response: MacroAgentAgentsResponse = {
        agents,
        total: agents.length,
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("[MacroAgentRoutes] Failed to get agents:", error);
      res.status(500).json({
        error: "Failed to retrieve agents",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/macro-agent/sessions
   *
   * Returns all known sessions with agent counts and connected executions.
   */
  router.get("/sessions", (_req: Request, res: Response) => {
    const observability = getObservabilityService();
    if (!observability) {
      return sendServiceUnavailable(res);
    }

    try {
      const sessionIds = observability.getAllSessions();
      const activeConnections = observability.getActiveExecutionConnections();

      const sessions = sessionIds.map((id) => {
        const agents = observability.getAgentsBySession(id);
        const runningAgents = agents.filter((a) => a.state === "running");
        const connectedExecutions = activeConnections
          .filter((c) => c.macroAgentSessionId === id)
          .map((c) => c.executionId);

        return {
          id,
          agentCount: agents.length,
          runningCount: runningAgents.length,
          connectedExecutions,
        };
      });

      const response: MacroAgentSessionsResponse = {
        sessions,
        total: sessions.length,
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("[MacroAgentRoutes] Failed to get sessions:", error);
      res.status(500).json({
        error: "Failed to retrieve sessions",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}

// ─────────────────────────────────────────────────────────────────
// Execution-Scoped Routes
// ─────────────────────────────────────────────────────────────────

/**
 * Create execution-scoped macro-agent routes.
 * These are mounted under /api/executions/:id/macro
 */
export function createExecutionMacroRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * GET /api/executions/:id/macro/agents
   *
   * Returns agents for the execution's connected macro-agent session.
   */
  router.get("/agents", (req: Request, res: Response) => {
    const observability = getObservabilityService();
    if (!observability) {
      return sendServiceUnavailable(res);
    }

    try {
      const { id: executionId } = req.params;
      const sessionId = observability.getSessionForExecution(executionId);
      const agents = sessionId
        ? observability.getAgentsBySession(sessionId)
        : [];

      const response: ExecutionMacroAgentsResponse = {
        agents,
        sessionId: sessionId ?? null,
        total: agents.length,
      };

      res.status(200).json(response);
    } catch (error) {
      console.error(
        "[MacroAgentRoutes] Failed to get execution agents:",
        error
      );
      res.status(500).json({
        error: "Failed to retrieve execution agents",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/executions/:id/macro/session
   *
   * Returns the macro-agent session info for an execution.
   */
  router.get("/session", (req: Request, res: Response) => {
    const observability = getObservabilityService();
    if (!observability) {
      return sendServiceUnavailable(res);
    }

    try {
      const { id: executionId } = req.params;
      const connection = observability.getExecutionConnection(executionId);

      if (!connection) {
        const response: ExecutionMacroSessionResponse = {
          sessionId: null,
          connectedAt: null,
          agentCount: 0,
          runningCount: 0,
        };
        return res.status(200).json(response);
      }

      const agents = observability.getAgentsBySession(
        connection.macroAgentSessionId
      );
      const runningAgents = agents.filter((a) => a.state === "running");

      const response: ExecutionMacroSessionResponse = {
        sessionId: connection.macroAgentSessionId,
        connectedAt: connection.connectedAt,
        agentCount: agents.length,
        runningCount: runningAgents.length,
      };

      res.status(200).json(response);
    } catch (error) {
      console.error(
        "[MacroAgentRoutes] Failed to get execution session:",
        error
      );
      res.status(500).json({
        error: "Failed to retrieve execution session",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}
