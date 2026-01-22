import type {
  Issue,
  Spec,
  Relationship,
  IssueFeedback,
  Execution,
  IssueStatus,
  EntityType,
  RelationshipType,
  FeedbackType,
  FeedbackAnchor,
} from '@sudocode-ai/types'

/**
 * API Response wrapper
 */
export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error_data?: any
  message?: string
}

/**
 * Repository info types
 */
export interface RepositoryInfo {
  name: string
  branch: string
  path: string
  /** Full owner/repo identifier from git remote (e.g., "anthropic/sudocode") */
  ownerRepo?: string
  /** Git hosting provider (e.g., "github", "gitlab", "bitbucket") */
  gitProvider?: string
}

export interface BranchInfo {
  current: string
  branches: string[]
}

/**
 * File search types
 */
export interface FileSearchResult {
  path: string
  name: string
  isFile: boolean
  matchType?: 'exact' | 'prefix' | 'contains'
}

/**
 * Context search types
 */
export type ContextSearchResultType = 'file' | 'spec' | 'issue'

export interface ContextSearchResult {
  type: ContextSearchResultType

  // For files
  filePath?: string
  fileName?: string

  // For specs/issues
  entityId?: string
  title?: string

  // Display/insertion
  displayText: string
  secondaryText?: string
  insertText: string
  matchScore?: number
}

/**
 * Issue API types
 */
export interface CreateIssueRequest {
  title: string
  description?: string
  content?: string
  status?: IssueStatus
  priority?: number
  parent_id?: string
  tags?: string[]
}

export interface UpdateIssueRequest {
  title?: string
  description?: string
  content?: string
  status?: IssueStatus
  priority?: number
  assignee?: string
  parent_id?: string
  archived?: boolean
}

/**
 * Spec API types
 */
export interface CreateSpecRequest {
  title: string
  content?: string
  priority?: number
  parent_id?: string
  tags?: string[]
}

export interface UpdateSpecRequest {
  title?: string
  content?: string
  priority?: number
  parent_id?: string
  archived?: boolean
}

/**
 * Relationship API types
 */
export interface CreateRelationshipRequest {
  from_id: string
  from_type: EntityType
  to_id: string
  to_type: EntityType
  relationship_type: RelationshipType
}

export interface DeleteRelationshipRequest {
  from_id: string
  from_type: EntityType
  to_id: string
  to_type: EntityType
  relationship_type: RelationshipType
}

/**
 * Feedback API types
 */
export interface CreateFeedbackRequest {
  issue_id?: string  // Optional for anonymous feedback
  to_id: string
  feedback_type: FeedbackType
  content: string
  anchor?: FeedbackAnchor
}

export interface UpdateFeedbackRequest {
  content?: string
  feedback_type?: FeedbackType
  anchor?: FeedbackAnchor
  dismissed?: boolean
}

/**
 * WebSocket message types
 */
export interface WebSocketMessage {
  type:
    | 'issue_created'
    | 'issue_updated'
    | 'issue_deleted'
    | 'spec_created'
    | 'spec_updated'
    | 'spec_deleted'
    | 'relationship_created'
    | 'relationship_deleted'
    | 'feedback_created'
    | 'feedback_updated'
    | 'feedback_deleted'
    | 'execution_created'
    | 'execution_updated'
    | 'execution_status_changed'
    | 'execution_deleted'
    | 'session_update'
    // Persistent session events
    | 'session_pending'
    | 'session_paused'
    | 'session_ended'
    | 'project_opened'
    | 'project_closed'
    | 'workflow_created'
    | 'workflow_updated'
    | 'workflow_deleted'
    | 'workflow_started'
    | 'workflow_paused'
    | 'workflow_resumed'
    | 'workflow_completed'
    | 'workflow_failed'
    | 'workflow_cancelled'
    | 'workflow_step_started'
    | 'workflow_step_completed'
    | 'workflow_step_failed'
    | 'workflow_step_skipped'
    | 'workflow_escalation_requested'
    | 'workflow_escalation_resolved'
    | 'voice_narration'
    | 'tts_audio'
    | 'tts_end'
    | 'tts_error'
    | 'error'
  projectId?: string // Project ID for project-scoped messages
  data?: Issue | Spec | Relationship | IssueFeedback | Execution | any
  message?: string // Error message
  timestamp?: string
  subscription?: string // Subscription key for debugging
  // TTS streaming fields (when type is tts_audio, tts_end, tts_error)
  request_id?: string
  chunk?: string // Base64 PCM audio (for tts_audio)
  index?: number // Chunk index (for tts_audio)
  is_final?: boolean // Final chunk flag (for tts_audio)
  total_chunks?: number // Total chunks sent (for tts_end)
  duration_ms?: number // Synthesis duration (for tts_end)
  error?: string // Error message (for tts_error)
  recoverable?: boolean // Can retry (for tts_error)
  fallback?: boolean // Should fallback to browser TTS (for tts_error)
}

export interface WebSocketSubscribeMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping'
  project_id?: string // Required for project-scoped subscriptions
  entity_type?: 'issue' | 'spec' | 'execution' | 'workflow' | 'all'
  entity_id?: string
}

/**
 * Agent API types
 */
export interface AgentInfo {
  type: string // AgentType from @sudocode-ai/types
  displayName: string
  supportedModes: string[]
  supportsStreaming: boolean
  supportsStructuredOutput: boolean
  implemented: boolean
  /** Whether the agent executable is available on the system */
  available?: boolean
  /** Path to the agent executable if found */
  executablePath?: string
  /** Error message if verification failed */
  verificationError?: string
}

export interface GetAgentsResponse {
  agents: AgentInfo[]
}

/**
 * Re-export types from @sudocode-ai/types
 */
export type {
  Issue,
  Spec,
  Relationship,
  IssueFeedback,
  Execution,
  IssueStatus,
  EntityType,
  RelationshipType,
  FeedbackType,
  FeedbackAnchor,
}
