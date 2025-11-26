import { Router, Request, Response } from "express";
import { agentRegistryService } from "../services/agent-registry.js";

export function createAgentsRouter(): Router {
  const router = Router();

  /**
   * GET /api/agents
   * Returns list of available agents with their metadata and implementation status
   */
  router.get("/", (_req: Request, res: Response) => {
    try {
      const agents = agentRegistryService.getAvailableAgents();

      res.status(200).json({
        agents: agents.map((agent) => ({
          type: agent.name,
          displayName: agent.displayName,
          supportedModes: agent.supportedModes,
          supportsStreaming: agent.supportsStreaming,
          supportsStructuredOutput: agent.supportsStructuredOutput,
          implemented: agent.implemented,
        })),
      });
    } catch (error) {
      console.error("Failed to get agents:", error);
      res.status(500).json({ error: "Failed to retrieve agents" });
    }
  });

  return router;
}
