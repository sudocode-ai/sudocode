/**
 * Execution system types
 */

import type {
  ExecutionStatus,
  AgentType,
  Execution,
  ExecutionChangesResult,
  FileChangeStat,
} from '@sudocode-ai/types'

// TODO: Remove this re-export and fully migrate to @sudocode-ai/types
/**
 * Re-export types from @sudocode-ai/types
 */
export type { ExecutionStatus, AgentType, Execution, ExecutionChangesResult, FileChangeStat }

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
  createBaseBranch?: boolean // If true, create baseBranch from current HEAD
  branchName?: string // Override auto-generated branch name
  cleanupMode?: CleanupMode // When to cleanup worktree
  reuseWorktreePath?: string // If set, reuse existing worktree at this path

  // Workflow settings
  checkpointInterval?: number // Steps between checkpoints
  continueOnStepFailure?: boolean // Continue after step failure

  // Output settings
  captureFileChanges?: boolean
  captureToolCalls?: boolean

  // Agent-specific configuration (e.g., Codex flags, Copilot settings)
  agentConfig?: Record<string, any>
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
  agentType?: string
}

export interface CreateFollowUpRequest {
  feedback: string
}

/**
 * Worktree Sync types
 */

export interface SyncConflict {
  filePath: string
  conflictType: 'content' | 'delete' | 'rename' | 'mode'
  description: string
  canAutoResolve: boolean
  resolutionStrategy?: string
}

export interface JSONLConflict {
  filePath: string
  entityType: 'issue' | 'spec'
  conflictCount: number
  canAutoResolve: boolean
}

export interface ConflictReport {
  hasConflicts: boolean
  codeConflicts: SyncConflict[]
  jsonlConflicts: JSONLConflict[]
  totalFiles: number
  summary: string
}

export interface DiffSummary {
  files: string[]
  additions: number
  deletions: number
}

export interface Commit {
  sha: string
  message: string
  author: string
  timestamp: string
}

/**
 * Stats about uncommitted changes in worktree
 */
export interface UncommittedFileStats {
  files: string[]
  additions: number
  deletions: number
}

/**
 * Info about potential local conflicts when including uncommitted files
 */
export interface PotentialLocalConflicts {
  /** Number of files that may have merge conflicts */
  count: number
  /** List of files that may have merge conflicts */
  files: string[]
}

export interface SyncPreviewResult {
  canSync: boolean
  conflicts: ConflictReport
  diff: DiffSummary
  commits: Commit[]
  mergeBase: string
  /** @deprecated Use uncommittedChanges instead */
  uncommittedJSONLChanges?: boolean
  /** Stats about uncommitted changes in worktree (not included in sync by default) */
  uncommittedChanges?: UncommittedFileStats
  /** Files that may have merge conflicts if "include uncommitted" is selected */
  potentialLocalConflicts?: PotentialLocalConflicts
  executionStatus: ExecutionStatus
  warnings: string[]
}

export interface SyncResult {
  success: boolean
  finalCommit?: string
  filesChanged: number
  /** Whether there are unresolved merge conflicts (user must resolve manually) */
  hasConflicts?: boolean
  /** List of files that have merge conflicts requiring manual resolution */
  filesWithConflicts?: string[]
  /** Number of uncommitted files copied from worktree (stage sync only) */
  uncommittedFilesIncluded?: number
  error?: string
  cleanupOffered?: boolean
}

export type SyncMode = 'squash' | 'preserve' | 'stage'

export interface PerformSyncRequest {
  mode: SyncMode
  commitMessage?: string
}
