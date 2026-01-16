/**
 * Executor Factory
 *
 * Factory functions for creating the appropriate executor wrapper based on agent type.
 * All executors now produce SessionUpdate events for unified frontend consumption:
 *
 * - AcpExecutorWrapper: For ACP-native agents (claude-code) - native SessionUpdate
 * - LegacyShimExecutorWrapper: For legacy agents (copilot, cursor) - converts NormalizedEntry → SessionUpdate
 *
 * @module execution/executors/executor-factory
 */

import type { AgentType, BaseAgentConfig } from "@sudocode-ai/types/agents";
import type Database from "better-sqlite3";
import type { ExecutionLifecycleService } from "../../services/execution-lifecycle.js";
import type { ExecutionLogsStore } from "../../services/execution-logs-store.js";
import { agentRegistryService } from "../../services/agent-registry.js";
import {
  AcpExecutorWrapper,
  type AcpExecutorWrapperConfig,
} from "./acp-executor-wrapper.js";
import {
  StdioSessionProvider,
  WebSocketSessionProvider,
  type SessionProviderConfig,
} from "./session-providers/index.js";
import { getMacroAgentServerManager } from "../../services/macro-agent-server-manager.js";
import {
  LegacyShimExecutorWrapper,
  type LegacyShimExecutorWrapperConfig,
} from "./legacy-shim-executor-wrapper.js";
import {
  processAgentConfig,
  type RawAgentConfig,
} from "./agent-config-handlers.js";
import type { NarrationConfig } from "../../services/narration-service.js";

/**
 * Error thrown when agent configuration validation fails
 */
export class AgentConfigValidationError extends Error {
  constructor(
    public agentType: string,
    public validationErrors: string[]
  ) {
    super(
      `Agent '${agentType}' configuration validation failed: ${validationErrors.join(", ")}`
    );
    this.name = "AgentConfigValidationError";
  }
}

/**
 * Common configuration for all executor wrappers
 */
export interface ExecutorFactoryConfig {
  workDir: string;
  logsStore: ExecutionLogsStore;
  projectId: string;
  db: Database.Database;
  /** Voice narration configuration for this execution */
  narrationConfig?: Partial<NarrationConfig>;
  /**
   * Whether this execution is resuming a previous session.
   * For agents that support session persistence (like Gemini CLI),
   * this will pass the appropriate CLI flags to resume the session.
   */
  isResume?: boolean;
  /**
   * Lifecycle service for legacy agents (copilot, cursor).
   * Required for legacy agents, not needed for ACP agents which use session providers.
   */
  lifecycleService?: ExecutionLifecycleService;
  /**
   * Execution ID for this execution.
   * Used for macro-agent observability connection tracking.
   */
  executionId?: string;
}

/**
 * Union type of all possible executor wrapper types
 *
 * - AcpExecutorWrapper: For ACP-native agents (claude-code, etc.)
 * - LegacyShimExecutorWrapper: For legacy agents (copilot, cursor) via shim
 */
export type ExecutorWrapper = AcpExecutorWrapper | LegacyShimExecutorWrapper;

/**
 * Create an executor wrapper for the specified agent type
 *
 * Routes to AcpExecutorWrapper for ACP-native agents (like Claude Code)
 * or LegacyShimExecutorWrapper for legacy agents (copilot, cursor).
 *
 * @param agentType - The type of agent to create an executor for
 * @param agentConfig - Agent-specific configuration
 * @param factoryConfig - Common configuration for all executors
 * @returns Appropriate executor wrapper instance
 * @throws {AgentNotFoundError} If agent type is not registered
 * @throws {AgentNotImplementedError} If agent is a stub
 * @throws {AgentConfigValidationError} If agent configuration is invalid
 *
 * @example
 * ```typescript
 * const executor = createExecutorForAgent(
 *   'claude-code',
 *   { workDir: '/tmp', print: true, outputFormat: 'stream-json' },
 *   {
 *     workDir: '/tmp',
 *     lifecycleService,
 *     logsStore,
 *     projectId: 'my-project',
 *     db,
 *   }
 * );
 *
 * await executor.executeWithLifecycle(executionId, task, workDir);
 * ```
 */
export async function createExecutorForAgent<TConfig extends BaseAgentConfig>(
  agentType: AgentType,
  agentConfig: TConfig,
  factoryConfig: ExecutorFactoryConfig
): Promise<ExecutorWrapper> {
  console.log("[ExecutorFactory] Creating executor", {
    agentType,
    workDir: factoryConfig.workDir,
  });

  // Special handling for macro-agent (WebSocket ACP)
  if (agentType === "macro-agent") {
    console.log(`[ExecutorFactory] Using WebSocketSessionProvider for macro-agent`);

    // Check if macro-agent server is available, start on-demand if needed
    const macroAgentManager = getMacroAgentServerManager();
    if (!macroAgentManager.isReady()) {
      const state = macroAgentManager.getState();
      if (state === "unavailable") {
        throw new Error(
          "Macro-agent server is not available. Install the multiagent-acp package to enable macro-agent support."
        );
      }

      // Try to start the server on-demand if it's stopped
      if (state === "stopped") {
        console.log(
          "[ExecutorFactory] Macro-agent server not running, attempting on-demand start..."
        );
        try {
          await macroAgentManager.start();
          if (!macroAgentManager.isReady()) {
            throw new Error("Server started but not ready");
          }
          console.log("[ExecutorFactory] Macro-agent server started successfully");
        } catch (startError) {
          const errorMessage =
            startError instanceof Error ? startError.message : String(startError);
          throw new Error(
            `Failed to start macro-agent server on-demand: ${errorMessage}`
          );
        }
      } else {
        // Starting or stopping - wait or fail
        throw new Error(
          `Macro-agent server is not ready (state: ${state}). Please wait for the server to start.`
        );
      }
    }

    // Process agent configuration
    const processedConfig = processAgentConfig(
      agentType,
      agentConfig as RawAgentConfig,
      {
        isResume: factoryConfig.isResume,
        workDir: factoryConfig.workDir,
      }
    );

    // Create WebSocket session provider
    const wsUrl = macroAgentManager.getAcpUrl();
    if (!wsUrl) {
      throw new Error("Macro-agent server URL is not available");
    }
    const sessionProvider = new WebSocketSessionProvider({
      wsUrl,
      env: processedConfig.env,
      permissionMode: processedConfig.acpPermissionMode,
    });

    // Get observability service for connection tracking
    const observabilityService = macroAgentManager.getObservabilityService() ?? undefined;

    const acpConfig: AcpExecutorWrapperConfig = {
      agentType,
      acpConfig: {
        agentType,
        mcpServers: processedConfig.mcpServers,
        permissionMode: processedConfig.acpPermissionMode,
        agentPermissionMode: processedConfig.agentPermissionMode,
        env: processedConfig.env,
        mode: processedConfig.sessionMode,
      },
      sessionProvider,
      logsStore: factoryConfig.logsStore,
      projectId: factoryConfig.projectId,
      db: factoryConfig.db,
      observabilityService,
    };

    return new AcpExecutorWrapper(acpConfig);
  }

  // Check if agent is ACP-native (registered in AgentFactory)
  if (AcpExecutorWrapper.isAcpSupported(agentType)) {
    console.log(`[ExecutorFactory] Using AcpExecutorWrapper for ${agentType}`);

    // Process agent configuration using the appropriate handler
    // This handles agent-specific logic like:
    // - Environment variable mappings (e.g., ANTHROPIC_MODEL for Claude)
    // - Permission mode processing
    // - Dynamic CLI registration (e.g., Gemini --approval-mode)
    const processedConfig = processAgentConfig(
      agentType,
      agentConfig as RawAgentConfig,
      {
        isResume: factoryConfig.isResume,
        workDir: factoryConfig.workDir,
      }
    );

    // Create session provider for stdio-based ACP agents
    const sessionProviderConfig: SessionProviderConfig = {
      env: processedConfig.env,
      permissionMode: processedConfig.acpPermissionMode,
      // Note: fileHandlers are optional - agent subprocess handles file ops within workDir
    };
    const sessionProvider = new StdioSessionProvider(agentType, sessionProviderConfig);

    const acpConfig: AcpExecutorWrapperConfig = {
      agentType,
      acpConfig: {
        agentType,
        mcpServers: processedConfig.mcpServers,
        permissionMode: processedConfig.acpPermissionMode,
        agentPermissionMode: processedConfig.agentPermissionMode,
        env: processedConfig.env,
        mode: processedConfig.sessionMode,
      },
      sessionProvider,
      logsStore: factoryConfig.logsStore,
      projectId: factoryConfig.projectId,
      db: factoryConfig.db,
    };

    return new AcpExecutorWrapper(acpConfig);
  }

  // Check if this is a legacy agent (copilot, cursor)
  if (LegacyShimExecutorWrapper.isLegacyAgent(agentType)) {
    console.log(
      `[ExecutorFactory] Using LegacyShimExecutorWrapper for ${agentType}`
    );

    // Legacy agents require lifecycleService
    if (!factoryConfig.lifecycleService) {
      throw new Error(
        `Legacy agent '${agentType}' requires lifecycleService in ExecutorFactoryConfig`
      );
    }

    const shimConfig: LegacyShimExecutorWrapperConfig = {
      agentType: agentType as "copilot" | "cursor",
      agentConfig: {
        workDir: factoryConfig.workDir,
        model: (agentConfig as any).model,
        env: (agentConfig as any).env,
      },
      lifecycleService: factoryConfig.lifecycleService,
      logsStore: factoryConfig.logsStore,
      projectId: factoryConfig.projectId,
      db: factoryConfig.db,
    };

    return new LegacyShimExecutorWrapper(shimConfig);
  }

  // Unknown agent type - throw error
  throw new Error(
    `Unknown agent type: ${agentType}. Supported agents: ${listAllAgents().join(", ")}`
  );
}

/**
 * Validate agent configuration without creating an executor
 *
 * Useful for pre-flight validation before execution creation.
 *
 * @param agentType - The type of agent to validate config for
 * @param agentConfig - Agent-specific configuration to validate
 * @returns Array of validation errors (empty if valid)
 * @throws {AgentNotFoundError} If agent type is not registered
 *
 * @example
 * ```typescript
 * const errors = validateAgentConfig('claude-code', {
 *   workDir: '/tmp',
 *   print: true,
 *   outputFormat: 'stream-json',
 * });
 *
 * if (errors.length > 0) {
 *   console.error('Invalid config:', errors);
 * }
 * ```
 */
export function validateAgentConfig<TConfig extends BaseAgentConfig>(
  agentType: AgentType,
  agentConfig: TConfig
): string[] {
  const adapter = agentRegistryService.getAdapter(agentType);

  if (!adapter.validateConfig) {
    return []; // No validation implemented for this agent
  }

  return adapter.validateConfig(agentConfig);
}

/**
 * Check if an agent type is macro-agent (WebSocket ACP)
 *
 * @param agentType - The type of agent to check
 * @returns true if the agent is macro-agent
 */
export function isMacroAgent(agentType: string): boolean {
  return agentType === "macro-agent";
}

/**
 * Check if an agent type uses ACP (Agent Client Protocol)
 *
 * ACP-native agents use the new unified AcpExecutorWrapper which provides:
 * - Direct SessionUpdate streaming
 * - Unified agent lifecycle management
 * - Support for session resume and forking
 *
 * This includes both stdio ACP agents (claude-code, codex, etc.) and
 * WebSocket ACP agents (macro-agent).
 *
 * @param agentType - The type of agent to check
 * @returns true if the agent uses ACP, false for legacy agents
 *
 * @example
 * ```typescript
 * if (isAcpAgent('claude-code')) {
 *   // Agent uses ACP protocol
 * }
 * ```
 */
export function isAcpAgent(agentType: string): boolean {
  return AcpExecutorWrapper.isAcpSupported(agentType) || isMacroAgent(agentType);
}

/**
 * List all available ACP-native agents
 *
 * Includes both stdio ACP agents and WebSocket ACP agents.
 *
 * @returns Array of agent type names that support ACP
 */
export function listAcpAgents(): string[] {
  return [...AcpExecutorWrapper.listAcpAgents(), "macro-agent"];
}

/**
 * Check if an agent type is a legacy agent (using LegacyShimExecutorWrapper)
 *
 * Legacy agents use agent-execution-engine adapters internally but emit
 * SessionUpdate events via the shim for unified frontend consumption.
 *
 * @param agentType - The type of agent to check
 * @returns true if the agent is a legacy type (copilot, cursor)
 *
 * @example
 * ```typescript
 * if (isLegacyAgent('copilot')) {
 *   // Agent uses LegacyShimExecutorWrapper
 * }
 * ```
 */
export function isLegacyAgent(agentType: string): boolean {
  return LegacyShimExecutorWrapper.isLegacyAgent(agentType);
}

/**
 * List all legacy agents
 *
 * @returns Array of legacy agent type names
 */
export function listLegacyAgents(): string[] {
  return LegacyShimExecutorWrapper.listLegacyAgents();
}

/**
 * List all supported agents (ACP + legacy)
 *
 * @returns Array of all supported agent type names
 */
export function listAllAgents(): string[] {
  return [...listAcpAgents(), ...listLegacyAgents()];
}
