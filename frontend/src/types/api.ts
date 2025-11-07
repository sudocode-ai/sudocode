import type {
  Issue,
  Spec,
  Relationship,
  IssueFeedback,
  IssueStatus,
  EntityType,
  RelationshipType,
  FeedbackType,
  FeedbackAnchor,
  IssueGroup,
  IssueGroupMember,
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
  spec_id: string
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
 * Issue Group API types
 */
export interface CreateIssueGroupRequest {
  name: string
  description?: string
  baseBranch: string
  workingBranch: string
  color?: string
}

export interface UpdateIssueGroupRequest {
  name?: string
  description?: string
  baseBranch?: string
  workingBranch?: string
  color?: string
}

export interface IssueGroupWithStats extends IssueGroup {
  issues: Issue[]
  stats: {
    totalIssues: number
    openIssues: number
    inProgressIssues: number
    completedIssues: number
    blockedIssues: number
    needsReviewIssues: number
  }
}

export interface AddIssueToGroupRequest {
  issueId: string
  position?: number
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
  data: Issue | Spec | Relationship | IssueFeedback
  timestamp: string
}

export interface WebSocketSubscribeMessage {
  type: 'subscribe'
  entity_type: 'issue' | 'spec' | 'all'
  entity_id?: string
}

/**
 * Re-export types from @sudocode-ai/types
 */
export type {
  Issue,
  Spec,
  Relationship,
  IssueFeedback,
  IssueStatus,
  EntityType,
  RelationshipType,
  FeedbackType,
  FeedbackAnchor,
  IssueGroup,
  IssueGroupMember,
}
