/**
 * Executor Factory
 *
 * Factory functions for creating the appropriate executor wrapper based on agent type.
 * All agents now use the unified AgentExecutorWrapper.
 *
 * @module execution/executors/executor-factory
 */

import type { AgentType, BaseAgentConfig } from '@sudocode-ai/types/agents';
import type Database from 'better-sqlite3';
import type { ExecutionLifecycleService } from '../../services/execution-lifecycle.js';
import type { ExecutionLogsStore } from '../../services/execution-logs-store.js';
import type { TransportManager } from '../transport/transport-manager.js';
import { agentRegistryService, AgentNotImplementedError } from '../../services/agent-registry.js';
import { AgentExecutorWrapper, type AgentExecutorWrapperConfig } from './agent-executor-wrapper.js';

/**
 * Error thrown when agent configuration validation fails
 */
export class AgentConfigValidationError extends Error {
  constructor(
    public agentType: string,
    public validationErrors: string[]
  ) {
    super(
      `Agent '${agentType}' configuration validation failed: ${validationErrors.join(', ')}`
    );
    this.name = 'AgentConfigValidationError';
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
  transportManager?: TransportManager;
}

/**
 * Union type of all possible executor wrapper types
 */
export type ExecutorWrapper = AgentExecutorWrapper<any>;

/**
 * Create an executor wrapper for the specified agent type
 *
 * Routes to specialized wrappers for certain agents (like Claude Code)
 * or creates a generic AgentExecutorWrapper for others.
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
 *     transportManager,
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
  console.log('[ExecutorFactory] Creating executor', {
    agentType,
    workDir: factoryConfig.workDir,
  });

  // Get adapter from registry (will throw if not found)
  const adapter = agentRegistryService.getAdapter(agentType);

  // Validate configuration
  if (adapter.validateConfig) {
    const validationErrors = adapter.validateConfig(agentConfig);
    if (validationErrors.length > 0) {
      throw new AgentConfigValidationError(agentType, validationErrors);
    }
  }

  // All agents use the unified AgentExecutorWrapper
  console.log(`[ExecutorFactory] Using AgentExecutorWrapper for ${agentType}`);

  // Check if agent is implemented
  if (!agentRegistryService.isAgentImplemented(agentType)) {
    // This will throw AgentNotImplementedError when buildProcessConfig is called
    // But we want to throw it earlier for better error messages
    throw new AgentNotImplementedError(agentType);
  }

  const wrapperConfig: AgentExecutorWrapperConfig<any> = {
    adapter,
    agentConfig,
    agentType,
    lifecycleService: factoryConfig.lifecycleService,
    logsStore: factoryConfig.logsStore,
    projectId: factoryConfig.projectId,
    db: factoryConfig.db,
    transportManager: factoryConfig.transportManager,
  };

  return new AgentExecutorWrapper(wrapperConfig);
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
