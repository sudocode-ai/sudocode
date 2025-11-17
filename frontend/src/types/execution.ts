/**
 * Execution system types
 */

import type { ExecutionStatus, AgentType, Execution as BaseExecution, ExecutionMode as CLIExecutionMode } from '@sudocode-ai/types'

// TODO: Remove this re-export and fully migrate to @sudocode-ai/types
/**
 * Re-export types from @sudocode-ai/types
 */
export type { ExecutionStatus, AgentType }

/**
 * CLI Execution mode - how the process runs (structured/interactive/hybrid)
 * Re-exported from @sudocode-ai/types
 */
export type { ExecutionMode as CLIExecutionMode } from '@sudocode-ai/types'

/**
 * Worktree mode - where the agent runs (local vs worktree)
 * Renamed to avoid conflict with CLI execution mode
 */
export type WorktreeMode =
  | 'worktree' // Isolated git worktree
  | 'local' // Local working directory

/**
 * Legacy alias for backward compatibility
 * @deprecated Use WorktreeMode instead
 */
export type ExecutionMode = WorktreeMode

/**
 * Terminal configuration for interactive/hybrid modes
 */
export interface TerminalConfig {
  /** Terminal width in columns (default: 80) */
  cols: number
  /** Terminal height in rows (default: 24) */
  rows: number
}

/**
 * Extended Execution type with frontend-specific fields
 * Extends the base Execution from @sudocode-ai/types
 */
export interface Execution extends BaseExecution {
  /** CLI execution mode (structured/interactive/hybrid) */
  execution_mode?: CLIExecutionMode
  /** Whether terminal is enabled for this execution */
  terminal_enabled?: boolean
}

/**
 * Cleanup mode - when to cleanup worktree
 */
export type CleanupMode =
  | 'auto' // Cleanup on successful completion
  | 'manual' // User must manually cleanup
  | 'never' // Never auto-cleanup (for debugging)

/**
 * Execution configuration - user-configurable settings
 * NOTE: This is frontend-specific configuration that gets serialized to JSON
 * and stored in the execution.config field (from @sudocode-ai/types)
 */
export interface ExecutionConfig {
  // Agent settings
  model?: string // e.g., 'claude-sonnet-4'
  maxTokens?: number
  temperature?: number

  // Execution behavior
  timeout?: number // Overall timeout (ms)
  mode?: WorktreeMode // Worktree mode (local/worktree)
  execution_mode?: CLIExecutionMode // CLI execution mode (structured/interactive/hybrid)
  terminal_config?: TerminalConfig // Terminal configuration for interactive/hybrid

  // Worktree settings (if mode === 'worktree')
  baseBranch?: string // Branch to base worktree on
  branchName?: string // Override auto-generated branch name
  cleanupMode?: CleanupMode // When to cleanup worktree

  // Workflow settings
  checkpointInterval?: number // Steps between checkpoints
  continueOnStepFailure?: boolean // Continue after step failure

  // Output settings
  captureFileChanges?: boolean
  captureToolCalls?: boolean
}

/**
 * Prompt template variable
 */
export interface PromptVariable {
  name: string // e.g., 'issueId', 'title', 'description'
  description: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required: boolean
  defaultValue?: any
}

/**
 * Prompt template
 */
export interface PromptTemplate {
  id: string
  name: string
  description: string
  type: 'issue' | 'spec' | 'custom'
  template: string
  variables: PromptVariable[]
  isDefault?: boolean
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Execution preparation result - preview before starting
 */
export interface ExecutionPrepareResult {
  // Rendered preview
  renderedPrompt: string

  // Issue context
  issue: {
    id: string
    title: string
    description: string
  }

  // Related context
  relatedSpecs: Array<{ id: string; title: string }>
  relatedFeedback: Array<{ issueId: string; content: string }>

  // Default configuration
  defaultConfig: ExecutionConfig

  // Available options
  availableModels: string[]
  availableBranches: string[]
  availableTemplates?: PromptTemplate[]

  // Validation
  warnings?: string[]
  errors?: string[]
}

/**
 * API Request types
 */

export interface PrepareExecutionRequest {
  templateId?: string
  config?: Partial<ExecutionConfig>
}

export interface CreateExecutionRequest {
  config: ExecutionConfig
  prompt: string
}

export interface CreateFollowUpRequest {
  feedback: string
}

/**
 * Validation utilities
 */

/**
 * Validates terminal configuration
 * @param config Terminal configuration to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateTerminalConfig(config: TerminalConfig): string[] {
  const errors: string[] = []

  if (!Number.isInteger(config.cols) || config.cols < 20 || config.cols > 500) {
    errors.push('Columns must be an integer between 20 and 500')
  }

  if (!Number.isInteger(config.rows) || config.rows < 10 || config.rows > 100) {
    errors.push('Rows must be an integer between 10 and 100')
  }

  return errors
}

/**
 * Gets default terminal configuration
 * @returns Default terminal config (80x24)
 */
export function getDefaultTerminalConfig(): TerminalConfig {
  return { cols: 80, rows: 24 }
}

/**
 * Checks if execution mode requires terminal
 * @param mode CLI execution mode
 * @returns True if mode requires terminal (interactive or hybrid)
 */
export function requiresTerminal(mode?: CLIExecutionMode): boolean {
  return mode === 'interactive' || mode === 'hybrid'
}
