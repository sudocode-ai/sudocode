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
import type { AgentType } from "@sudocode-ai/types/agents";
import { ClaudeCodeAdapter } from "../execution/adapters/claude-adapter.js";
import { CodexAdapter } from "../execution/adapters/codex-adapter.js";
import { CursorAdapter } from "../execution/adapters/cursor-adapter.js";
import { copilotAdapter } from "../execution/adapters/copilot-adapter.js";

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
}

/**
 * Agent Registry Service
 *
 * Manages agent adapters and provides discovery/lookup functionality.
 * Lazy-initializes on first use.
 */
export class AgentRegistryService {
  private registry: AgentRegistry;
  private implementedAgents = new Set<string>([
    "claude-code",
    "codex",
    "cursor",
    "copilot",
  ]);
  private initialized = false;

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
    this.registry.register(copilotAdapter);

    this.initialized = true;
  }

  /**
   * Get all available agents with their metadata and implementation status
   *
   * @returns Array of agent information
   */
  getAvailableAgents(): AgentInfo[] {
    this.initialize();
    return this.registry.getAll().map((adapter: IAgentAdapter) => ({
      ...adapter.metadata,
      implemented: this.implementedAgents.has(adapter.metadata.name),
    }));
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
   * Check if an agent is registered in the registry
   *
   * @param agentType - The agent type to check
   * @returns True if the agent is registered
   */
  hasAgent(agentType: AgentType): boolean {
    this.initialize();
    return this.registry.has(agentType);
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
}

/**
 * Global agent registry service instance
 */
export const agentRegistryService = new AgentRegistryService();
