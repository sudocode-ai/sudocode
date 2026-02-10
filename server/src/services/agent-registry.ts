/**
 * Agent Registry Service
 *
 * Centralized service for managing agent adapters and providing agent discovery.
 * Wraps the agent-execution-engine's AgentRegistry with sudocode-specific logic.
 */

import { AgentRegistry } from "agent-execution-engine/agents";
import type {
  IAgentAdapter,
  AgentMetadata,
} from "agent-execution-engine/agents";
import { AgentFactory } from "acp-factory";
import type { AgentType } from "@sudocode-ai/types/agents";
import { ClaudeCodeAdapter } from "../execution/adapters/claude-adapter.js";
import { CodexAdapter } from "../execution/adapters/codex-adapter.js";
import { CursorAdapter } from "../execution/adapters/cursor-adapter.js";
import {
  verifyExecutable,
  type VerificationResult,
} from "../utils/executable-check.js";

/**
 * Error thrown when an agent is not found in the registry
 */
export class AgentNotFoundError extends Error {
  constructor(agentType: string) {
    super(`Agent '${agentType}' not found in registry`);
    this.name = "AgentNotFoundError";
  }
}

/**
 * Error thrown when attempting to use an unimplemented agent
 */
export class AgentNotImplementedError extends Error {
  constructor(agentType: string) {
    super(`Agent '${agentType}' is not yet implemented`);
    this.name = "AgentNotImplementedError";
  }
}

/**
 * Agent metadata with implementation status
 */
export interface AgentInfo extends AgentMetadata {
  /** Whether the agent is fully implemented (vs. stub) */
  implemented: boolean;
  /** Whether the agent executable is available on the system */
  available?: boolean;
  /** Path to the agent executable if found */
  executablePath?: string;
  /** Error message if verification failed */
  verificationError?: string;
}

/**
 * Agent Registry Service
 *
 * Manages agent adapters and provides discovery/lookup functionality.
 * Lazy-initializes on first use.
 */
/**
 * Cached verification result with timestamp
 */
interface CachedVerification {
  result: VerificationResult;
  timestamp: number;
}

export class AgentRegistryService {
  private registry: AgentRegistry;
  private implementedAgents = new Set<string>([
    "claude-code",
    "codex",
    "gemini",
    "opencode",
    "cursor",
    "copilot",
  ]);
  private initialized = false;

  /**
   * Map of agent types to their default executable names
   */
  private agentExecutables: Record<string, string> = {
    "claude-code": "claude",
    codex: "codex",
    gemini: "gemini",
    opencode: "opencode",
    cursor: "cursor-agent",
    copilot: "copilot",
  };

  /**
   * Cache for verification results
   * Key: agent type, Value: cached verification result with timestamp
   */
  private verificationCache = new Map<string, CachedVerification>();

  /**
   * Cache TTL in milliseconds (default: 24 hours)
   * Set to a very long duration since agent installations rarely change
   */
  private cacheTTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.registry = new AgentRegistry();
  }

  /**
   * Initialize the registry by registering all agent adapters
   * Called automatically on first use (lazy initialization)
   */
  private initialize(): void {
    if (this.initialized) {
      return;
    }

    // Register fully implemented adapters
    this.registry.register(new ClaudeCodeAdapter());
    this.registry.register(new CodexAdapter());
    this.registry.register(new CursorAdapter());

    this.initialized = true;
  }

  /**
   * Get all available agents with their metadata and implementation status
   *
   * Includes both:
   * 1. Agents with adapters in agent-execution-engine (claude-code, codex, cursor)
   * 2. ACP-native agents from acp-factory (gemini, opencode, copilot)
   *
   * @returns Array of agent information
   */
  getAvailableAgents(): AgentInfo[] {
    this.initialize();

    // Get agents from the registry (have adapters)
    const registryAgents = this.registry
      .getAll()
      .map((adapter: IAgentAdapter) => ({
        ...adapter.metadata,
        implemented: this.implementedAgents.has(adapter.metadata.name),
      }));

    // Get set of already-included agent names
    const registryAgentNames = new Set(registryAgents.map((a) => a.name));

    // Get ACP-native agents from acp-factory that aren't already in registry.
    // Include implemented agents as well (e.g., copilot) even if not registered yet.
    const acpAgentNames = new Set<string>([
      ...AgentFactory.listAgents(),
      ...this.implementedAgents,
    ]);
    const additionalAcpAgents: AgentInfo[] = [...acpAgentNames]
      .filter((name) => !registryAgentNames.has(name))
      .map((name) => ({
        name,
        displayName: this.formatAgentDisplayName(name),
        supportedModes: ["structured", "interactive"],
        supportsStreaming: true,
        supportsStructuredOutput: true,
        implemented: this.implementedAgents.has(name),
      }));

    return [...registryAgents, ...additionalAcpAgents];
  }

  /**
   * Format agent name for display
   * @param name - Raw agent name (e.g., "gemini", "opencode")
   * @returns Formatted display name (e.g., "Gemini", "Opencode")
   */
  private formatAgentDisplayName(name: string): string {
    // Handle special cases
    const displayNames: Record<string, string> = {
      gemini: "Gemini CLI",
      opencode: "Opencode",
      copilot: "Copilot",
    };
    return displayNames[name] || name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Get an agent adapter by type
   *
   * @param agentType - The agent type to retrieve
   * @returns The agent adapter
   * @throws {AgentNotFoundError} If agent is not registered
   */
  getAdapter(agentType: AgentType): IAgentAdapter {
    this.initialize();
    const adapter = this.registry.get(agentType);
    if (!adapter) {
      throw new AgentNotFoundError(agentType);
    }
    return adapter;
  }

  /**
   * Check if an agent is fully implemented
   *
   * @param agentType - The agent type to check
   * @returns True if the agent is implemented, false if it's a stub
   */
  isAgentImplemented(agentType: AgentType): boolean {
    this.initialize();
    return this.implementedAgents.has(agentType);
  }

  /**
   * Check if an agent is registered in the registry or acp-factory
   *
   * @param agentType - The agent type to check
   * @returns True if the agent is registered or ACP-supported
   */
  hasAgent(agentType: AgentType): boolean {
    this.initialize();
    return (
      this.registry.has(agentType) ||
      this.implementedAgents.has(agentType) ||
      AgentFactory.listAgents().includes(agentType)
    );
  }

  /**
   * Mark an agent as implemented
   * Used when upgrading a stub adapter to a full implementation
   *
   * @param agentType - The agent type to mark as implemented
   */
  markAsImplemented(agentType: AgentType): void {
    this.initialize();
    if (!this.hasAgent(agentType)) {
      throw new AgentNotFoundError(agentType);
    }
    this.implementedAgents.add(agentType);
  }

  /**
   * Check if cached verification is still valid
   *
   * @param agentType - The agent type to check
   * @returns Cached result if valid, undefined otherwise
   */
  private getCachedVerification(
    agentType: string
  ): VerificationResult | undefined {
    const cached = this.verificationCache.get(agentType);
    if (!cached) {
      return undefined;
    }

    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTTL) {
      // Cache expired, remove it
      this.verificationCache.delete(agentType);
      return undefined;
    }

    return cached.result;
  }

  /**
   * Cache a verification result
   *
   * @param agentType - The agent type
   * @param result - The verification result to cache
   */
  private cacheVerification(
    agentType: string,
    result: VerificationResult
  ): void {
    this.verificationCache.set(agentType, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear verification cache for a specific agent or all agents
   *
   * @param agentType - Optional agent type to clear. If not provided, clears all cache.
   */
  clearVerificationCache(agentType?: AgentType): void {
    if (agentType) {
      this.verificationCache.delete(agentType);
    } else {
      this.verificationCache.clear();
    }
  }

  /**
   * Verify if a specific agent's executable is available on the system
   * Results are cached for performance
   *
   * @param agentType - The agent type to verify
   * @param skipCache - If true, bypass cache and perform fresh verification
   * @returns Promise<VerificationResult>
   */
  async verifyAgent(
    agentType: AgentType,
    skipCache = false
  ): Promise<VerificationResult> {
    this.initialize();

    // Check cache first unless skipCache is true
    if (!skipCache) {
      const cached = this.getCachedVerification(agentType);
      if (cached) {
        return cached;
      }
    }

    // Check if agent is registered
    if (!this.hasAgent(agentType)) {
      const result = {
        available: false,
        error: `Agent '${agentType}' not found in registry`,
      };
      this.cacheVerification(agentType, result);
      return result;
    }

    // Check if agent is implemented
    if (!this.isAgentImplemented(agentType)) {
      const result = {
        available: false,
        error: `Agent '${agentType}' is not yet implemented`,
      };
      this.cacheVerification(agentType, result);
      return result;
    }

    // Get the default executable name for this agent
    const executableName = this.agentExecutables[agentType];
    if (!executableName) {
      const result = {
        available: false,
        error: `No executable mapping found for agent '${agentType}'`,
      };
      this.cacheVerification(agentType, result);
      return result;
    }

    // Verify the executable exists
    const result = await verifyExecutable(executableName);
    this.cacheVerification(agentType, result);
    return result;
  }

  /**
   * Verify all implemented agents and return their availability status
   *
   * @returns Promise<Map<string, VerificationResult>>
   */
  async verifyAllAgents(): Promise<Map<string, VerificationResult>> {
    this.initialize();
    const results = new Map<string, VerificationResult>();

    // Get all implemented agents
    const agents = this.getAvailableAgents().filter(
      (agent) => agent.implemented
    );

    // Verify each agent in parallel
    await Promise.all(
      agents.map(async (agent) => {
        const result = await this.verifyAgent(agent.name as AgentType);
        results.set(agent.name, result);
      })
    );

    return results;
  }

  /**
   * Get all available agents with their verification status included
   *
   * @returns Promise<AgentInfo[]> - Array of agent information with availability status
   */
  async getAvailableAgentsWithVerification(): Promise<AgentInfo[]> {
    this.initialize();
    const agents = this.getAvailableAgents();
    const verificationResults = await this.verifyAllAgents();

    return agents.map((agent) => {
      const verification = verificationResults.get(agent.name);
      return {
        ...agent,
        available: verification?.available,
        executablePath: verification?.path,
        verificationError: verification?.error,
      };
    });
  }
}

/**
 * Global agent registry service instance
 */
export const agentRegistryService = new AgentRegistryService();
