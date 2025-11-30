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
  issue_id: string
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
    | 'project_opened'
    | 'project_closed'
    | 'error'
  projectId?: string // Project ID for project-scoped messages
  data?: Issue | Spec | Relationship | IssueFeedback | Execution | any
  message?: string // Error message
  timestamp?: string
  subscription?: string // Subscription key for debugging
}

export interface WebSocketSubscribeMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping'
  project_id?: string // Required for project-scoped subscriptions
  entity_type?: 'issue' | 'spec' | 'execution' | 'all'
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
