import { Router, Request, Response } from "express";
import { agentRegistryService } from "../services/agent-registry.js";
import { AgentFactory } from "acp-factory";
import { CommandDiscoveryService } from "../services/command-discovery-service.js";
import { getMacroAgentServerManager } from "../services/macro-agent-server-manager.js";

// Cache for agent models (agentType -> models[])
const modelsCache: Map<string, { models: string[]; timestamp: number }> = new Map();
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export function createAgentsRouter(): Router {
  const router = Router();

  /**
   * GET /api/agents
   * Returns list of available agents with their metadata, implementation status,
   * and executable availability
   *
   * Query parameters:
   * - verify: If 'false', skips verification (default: true)
   * - skipCache: If 'true', bypasses cache and performs fresh verification (default: false)
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      // Default to verifying agents unless explicitly disabled
      const shouldVerify = req.query.verify !== 'false';
      const skipCache = req.query.skipCache === 'true';

      if (shouldVerify) {
        // Clear cache if skipCache is requested
        if (skipCache) {
          agentRegistryService.clearVerificationCache();
        }

        // Get agents with verification
        const agents = await agentRegistryService.getAvailableAgentsWithVerification();

        res.status(200).json({
          agents: agents.map((agent) => ({
            type: agent.name,
            displayName: agent.displayName,
            supportedModes: agent.supportedModes,
            supportsStreaming: agent.supportsStreaming,
            supportsStructuredOutput: agent.supportsStructuredOutput,
            implemented: agent.implemented,
            available: agent.available,
            executablePath: agent.executablePath,
            verificationError: agent.verificationError,
          })),
        });
      } else {
        // Get agents without verification (faster, but no availability info)
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
      }
    } catch (error) {
      console.error("Failed to get agents:", error);
      res.status(500).json({ error: "Failed to retrieve agents" });
    }
  });

  /**
   * GET /api/agents/:agentType/models
   * Returns available models for a specific agent type
   *
   * Query parameters:
   * - skipCache: If 'true', bypasses cache and fetches fresh (default: false)
   *
   * Response: { models: string[], cached: boolean }
   */
  router.get("/:agentType/models", async (req: Request, res: Response) => {
    const { agentType } = req.params;
    const skipCache = req.query.skipCache === "true";

    try {
      // Check if agent is ACP-supported
      const acpAgents = AgentFactory.listAgents();
      if (!acpAgents.includes(agentType)) {
        return res.status(400).json({
          error: `Agent '${agentType}' is not an ACP agent or not supported`,
          supportedAgents: acpAgents,
        });
      }

      // Check cache first
      if (!skipCache) {
        const cached = modelsCache.get(agentType);
        if (cached && Date.now() - cached.timestamp < MODELS_CACHE_TTL) {
          return res.status(200).json({
            models: cached.models,
            cached: true,
          });
        }
      }

      // Spawn agent and get models
      console.log(`[AgentsRouter] Fetching models for ${agentType}...`);
      let agent = null;
      let session = null;

      try {
        agent = await AgentFactory.spawn(agentType, {
          permissionMode: "auto-deny", // Don't allow any operations
        });

        // Create a temporary session to get available models
        // Use a temp directory that exists
        const tempCwd = process.cwd();
        session = await agent.createSession(tempCwd);

        const models = session.models || [];

        // Cache the results
        modelsCache.set(agentType, {
          models,
          timestamp: Date.now(),
        });

        console.log(`[AgentsRouter] Found ${models.length} models for ${agentType}:`, models);

        return res.status(200).json({
          models,
          cached: false,
        });
      } finally {
        // Clean up - close the agent
        if (agent) {
          try {
            await agent.close();
          } catch (closeError) {
            console.warn(`[AgentsRouter] Error closing agent:`, closeError);
          }
        }
      }
    } catch (error) {
      console.error(`[AgentsRouter] Failed to get models for ${agentType}:`, error);

      // Return fallback models for known agents
      if (agentType === "claude-code") {
        return res.status(200).json({
          models: ["sonnet", "opus", "haiku"],
          cached: false,
          fallback: true,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      return res.status(500).json({
        error: `Failed to retrieve models for ${agentType}`,
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/agents/:agentType/discover-commands
   * Discovers available slash commands for an agent type
   *
   * Creates a temporary session to capture available_commands_update
   * without creating an execution record. Used for lazy command discovery
   * when user types "/" in the prompt input.
   *
   * Response: { commands: AvailableCommand[] }
   */
  router.post("/:agentType/discover-commands", async (req: Request, res: Response) => {
    const { agentType } = req.params;

    try {
      // Check if agent is ACP-supported
      const acpAgents = AgentFactory.listAgents();
      if (!acpAgents.includes(agentType)) {
        return res.status(400).json({
          error: `Agent '${agentType}' is not an ACP agent or not supported`,
          supportedAgents: acpAgents,
        });
      }

      // Use project root if available, otherwise current working directory
      const workDir = req.project?.path || process.cwd();

      console.log(`[AgentsRouter] Discovering commands for ${agentType} in ${workDir}...`);

      const discoveryService = new CommandDiscoveryService();
      const commands = await discoveryService.discoverCommands(agentType, workDir);

      console.log(`[AgentsRouter] Discovered ${commands.length} commands for ${agentType}`);

      return res.status(200).json({ commands });
    } catch (error) {
      console.error(`[AgentsRouter] Failed to discover commands for ${agentType}:`, error);
      return res.status(500).json({
        error: `Failed to discover commands for ${agentType}`,
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/agents/macro-agent/status
   * Returns the status of the macro-agent server
   *
   * Response: {
   *   available: boolean,   // Executable found in PATH
   *   ready: boolean,       // Server running and accepting connections
   *   state: string,        // stopped | starting | running | stopping | unavailable
   *   acpUrl?: string,      // WebSocket ACP URL (if ready)
   *   apiUrl?: string,      // HTTP API URL (if ready)
   * }
   */
  router.get("/macro-agent/status", (_req: Request, res: Response) => {
    try {
      const manager = getMacroAgentServerManager();

      const status = {
        available: manager.isAvailable(),
        ready: manager.isReady(),
        state: manager.getState(),
        acpUrl: manager.isReady() ? manager.getAcpUrl() : undefined,
        apiUrl: manager.isReady() ? manager.getApiUrl() : undefined,
      };

      res.status(200).json(status);
    } catch (error) {
      console.error("[AgentsRouter] Failed to get macro-agent status:", error);
      res.status(500).json({
        error: "Failed to retrieve macro-agent status",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}
