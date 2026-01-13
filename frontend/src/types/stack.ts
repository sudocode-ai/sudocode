/**
 * Stack types for stacked diffs workflow
 */

import type { CheckpointReviewStatus } from './execution'

/**
 * Health status of a stack
 */
export type StackHealth = 'ready' | 'blocked' | 'conflicts' | 'pending'

/**
 * Represents a stack of related issues for coordinated merging
 */
export interface Stack {
  id: string
  name?: string
  root_issue_id?: string
  issue_order: string[]
  is_auto: boolean
  created_at: string
  updated_at: string
}

/**
 * Represents a single entry in a stack with enriched status info
 */
export interface StackEntry {
  issue_id: string
  depth: number
  has_checkpoint: boolean
  checkpoint_status?: CheckpointReviewStatus
  is_promoted: boolean
}

/**
 * Full stack information including computed entries and health
 */
export interface StackInfo {
  stack: Stack
  entries: StackEntry[]
  health: StackHealth
}

/**
 * Response from GET /api/stacks
 */
export interface StacksListResponse {
  stacks: StackInfo[]
  auto_count: number
  manual_count: number
}

/**
 * Request for POST /api/stacks
 */
export interface CreateStackRequest {
  name?: string
  issue_ids: string[]
  root_issue_id?: string
}

/**
 * Request for PUT /api/stacks/:id
 */
export interface UpdateStackRequest {
  name?: string
  issue_order?: string[]
  root_issue_id?: string | null
  add_issues?: string[]
  remove_issues?: string[]
}
