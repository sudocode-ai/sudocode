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
  LegacyShimExecutorWrapper,
  type LegacyShimExecutorWrapperConfig,
} from "./legacy-shim-executor-wrapper.js";
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
  lifecycleService: ExecutionLifecycleService;
  logsStore: ExecutionLogsStore;
  projectId: string;
  db: Database.Database;
  /** Voice narration configuration for this execution */
  narrationConfig?: Partial<NarrationConfig>;
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
export function createExecutorForAgent<TConfig extends BaseAgentConfig>(
  agentType: AgentType,
  agentConfig: TConfig,
  factoryConfig: ExecutorFactoryConfig
): ExecutorWrapper {
  console.log("[ExecutorFactory] Creating executor", {
    agentType,
    workDir: factoryConfig.workDir,
  });

  // Check if agent is ACP-native (registered in AgentFactory)
  if (AcpExecutorWrapper.isAcpSupported(agentType)) {
    console.log(`[ExecutorFactory] Using AcpExecutorWrapper for ${agentType}`);

    // Build env vars, mapping model to agent-specific env var
    const modelEnvVars: Record<string, string> = {};
    const model = (agentConfig as any).model;
    if (model) {
      // Map model to agent-specific environment variable
      if (agentType === "claude-code") {
        modelEnvVars.ANTHROPIC_MODEL = model;
      }
      // Add other agent type mappings here as needed:
      // else if (agentType === "codex") { modelEnvVars.OPENAI_MODEL = model; }
    }

    // Merge model env vars with any existing env config
    const existingEnv = (agentConfig as any).env;
    const mergedEnv =
      Object.keys(modelEnvVars).length > 0 || existingEnv
        ? { ...modelEnvVars, ...existingEnv }
        : undefined;

    // Check for dangerouslySkipPermissions in multiple locations for backwards compatibility:
    // 1. Top-level (from destructured config)
    // 2. Nested in agentConfig (from frontend's agentConfig object)
    const skipPermissions =
      (agentConfig as any).dangerouslySkipPermissions === true ||
      (agentConfig as any).agentConfig?.dangerouslySkipPermissions === true;

    // Map frontend permissionMode values to ACP mode and permission settings
    // Frontend sends: 'default' | 'acceptEdits' | 'dontAsk' | 'plan' | 'bypassPermissions'
    const frontendPermissionMode =
      (agentConfig as any).permissionMode ||
      (agentConfig as any).agentConfig?.permissionMode;

    // Determine session mode (ACP modes: "code", "ask", "plan", "architect")
    let sessionMode: string | undefined = (agentConfig as any).mode;
    if (!sessionMode && frontendPermissionMode === "plan") {
      sessionMode = "plan";
    }

    // Determine ACP permission mode
    // bypassPermissions = full auto-approve (YOLO mode)
    // Other modes use interactive with frontend handling permission requests
    const effectiveSkipPermissions =
      skipPermissions || frontendPermissionMode === "bypassPermissions";

    console.log("[ExecutorFactory] Permission mode config:", {
      topLevel: (agentConfig as any).dangerouslySkipPermissions,
      nested: (agentConfig as any).agentConfig?.dangerouslySkipPermissions,
      frontendPermissionMode,
      sessionMode,
      resolved: effectiveSkipPermissions ? "auto-approve" : "interactive",
    });

    const acpConfig: AcpExecutorWrapperConfig = {
      agentType,
      acpConfig: {
        agentType,
        // Extract MCP servers from agent config if present
        mcpServers: (agentConfig as any).mcpServers,
        // Default to interactive mode for UI permission approval
        // Only auto-approve when explicitly enabled via dangerouslySkipPermissions or bypassPermissions
        permissionMode: effectiveSkipPermissions ? "auto-approve" : "interactive",
        env: mergedEnv,
        // Session mode (e.g., "code", "plan", "ask")
        mode: sessionMode,
      },
      lifecycleService: factoryConfig.lifecycleService,
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
    `Unknown agent type: ${agentType}. Supported agents: ${[
      ...AcpExecutorWrapper.listAcpAgents(),
      ...LegacyShimExecutorWrapper.listLegacyAgents(),
    ].join(", ")}`
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
 * Check if an agent type uses ACP (Agent Client Protocol)
 *
 * ACP-native agents use the new unified AcpExecutorWrapper which provides:
 * - Direct SessionUpdate streaming
 * - Unified agent lifecycle management
 * - Support for session resume and forking
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
  return AcpExecutorWrapper.isAcpSupported(agentType);
}

/**
 * List all available ACP-native agents
 *
 * @returns Array of agent type names that support ACP
 */
export function listAcpAgents(): string[] {
  return AcpExecutorWrapper.listAcpAgents();
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
