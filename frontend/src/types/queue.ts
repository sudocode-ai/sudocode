/**
 * Queue types for merge queue management
 */

/**
 * Queue entry status
 */
export type QueueStatus =
  | 'pending'
  | 'ready'
  | 'merging'
  | 'merged'
  | 'failed'
  | 'cancelled'

/**
 * Enriched queue entry with issue and stack information
 */
export interface EnrichedQueueEntry {
  // Base fields from merge queue
  id: string
  executionId: string
  streamId: string
  targetBranch: string
  position: number
  priority: number
  status: QueueStatus
  addedAt: number
  error?: string
  mergeCommit?: string

  // Enriched fields
  issueId: string
  issueTitle: string
  stackId?: string
  stackName?: string
  stackDepth: number
  dependencies: string[] // Issue IDs this depends on
  canPromote: boolean // True if approved and dependencies merged
}

/**
 * Queue statistics
 */
export interface QueueStats {
  total: number
  byStatus: Record<QueueStatus, number>
  byStack: Record<string, number>
}

/**
 * Response from GET /api/queue
 */
export interface QueueListResponse {
  entries: EnrichedQueueEntry[]
  stats: QueueStats
}

/**
 * Options for fetching queue
 */
export interface GetQueueOptions {
  targetBranch?: string
  status?: QueueStatus[]
  includeMerged?: boolean
}

/**
 * Response from POST /api/queue/reorder
 */
export interface ReorderResponse {
  new_order: string[]
  warning?: string
}

/**
 * Error response for dependency violation
 */
export interface ReorderBlockedError {
  blocked_by: string[] // Issue IDs that must come first
}

/**
 * Request body for POST /api/queue/reorder
 */
export interface ReorderRequest {
  execution_id: string
  new_position: number
  target_branch?: string
}
