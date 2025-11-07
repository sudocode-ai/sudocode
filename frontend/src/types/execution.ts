/**
 * Execution system types
 */

import type { ExecutionStatus, AgentType, Execution } from '@sudocode-ai/types'

// TODO: Remove this re-export and fully migrate to @sudocode-ai/types
/**
 * Re-export types from @sudocode-ai/types
 */
export type { ExecutionStatus, AgentType, Execution }

/**
 * Execution mode - where the agent runs
 */
export type ExecutionMode =
  | 'worktree' // Isolated git worktree
  | 'local' // Local working directory

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
  mode?: ExecutionMode // Execution mode

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

export interface ResumeSessionRequest {
  prompt: string
}
