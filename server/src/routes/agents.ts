import { Router, Request, Response } from "express";
import { agentRegistryService } from "../services/agent-registry.js";
import { AgentFactory } from "acp-factory";
import { CommandDiscoveryService } from "../services/command-discovery-service.js";

// Cache for agent capabilities discovered by spawning (agentType -> capabilities)
interface AgentCapabilitiesCache {
  models: string[];
  loadSession: boolean;
  timestamp: number;
}
const capabilitiesCache: Map<string, AgentCapabilitiesCache> = new Map();
const CAPABILITIES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Known loadSession capabilities for agents (from ACP e2e tests).
 * Used as fallback when capability hasn't been dynamically discovered yet.
 * These values are based on actual agent behavior observed in testing.
 */
const KNOWN_LOAD_SESSION_CAPABILITIES: Record<string, boolean> = {
  "claude-code": true,  // Confirmed: supports session persistence
  "gemini": false,      // Confirmed: does not support loadSession
  // Other agents: unknown until dynamically discovered
};

/**
 * Get cached loadSession capability for an agent type.
 * Returns cached value if available, falls back to known capabilities,
 * or undefined if truly unknown.
 */
export function getCachedLoadSession(agentType: string): boolean | undefined {
  // Check dynamic cache first (most accurate, from actual agent spawn)
  const cached = capabilitiesCache.get(agentType);
  if (cached && Date.now() - cached.timestamp < CAPABILITIES_CACHE_TTL) {
    return cached.loadSession;
  }

  // Fall back to known capabilities
  if (agentType in KNOWN_LOAD_SESSION_CAPABILITIES) {
    return KNOWN_LOAD_SESSION_CAPABILITIES[agentType];
  }

  return undefined;
}

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
            supportsResume: agent.supportsResume,
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
            supportsResume: agent.supportsResume,
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
        const cached = capabilitiesCache.get(agentType);
        if (cached && Date.now() - cached.timestamp < CAPABILITIES_CACHE_TTL) {
          return res.status(200).json({
            models: cached.models,
            loadSession: cached.loadSession,
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
        const loadSession = agent.capabilities?.loadSession ?? false;

        // Cache the results including loadSession capability
        capabilitiesCache.set(agentType, {
          models,
          loadSession,
          timestamp: Date.now(),
        });

        console.log(`[AgentsRouter] Found ${models.length} models for ${agentType}, loadSession: ${loadSession}`);

        return res.status(200).json({
          models,
          loadSession,
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

  return router;
}
