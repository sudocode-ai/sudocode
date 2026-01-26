/**
 * Checkpoint types for DAG visualization
 * Used by CheckpointDAG component and diff stack workflows
 */

// =============================================================================
// Core Checkpoint Types (from dataplane)
// =============================================================================

/**
 * Checkpoint from dataplane - individual commit snapshot
 */
export interface DataplaneCheckpoint {
  id: string
  streamId: string
  commitSha: string
  parentCommit: string | null
  originalCommit: string | null
  changeId: string | null
  message: string | null
  createdAt: number
  createdBy: string | null
}

/**
 * Checkpoint with app data from Sudocode
 */
export interface CheckpointWithAppData extends DataplaneCheckpoint {
  issueId?: string
  executionId?: string
  issueSnapshot?: string
  specSnapshot?: string
}

/**
 * Stream info for checkpoint context
 */
export interface Stream {
  id: string
  name: string
  agentId: string
  baseCommit: string
  parentStream: string | null
  branchPointCommit: string | null
  status: 'active' | 'paused' | 'merged' | 'abandoned' | 'conflicted'
  createdAt: number
  updatedAt: number
}

// =============================================================================
// Diff Stack Types
// =============================================================================

export type DiffStackReviewStatus = 'pending' | 'approved' | 'rejected' | 'merged' | 'abandoned'

/**
 * Diff Stack - reviewable/mergeable unit
 */
export interface DiffStack {
  id: string
  name: string | null
  description: string | null
  targetBranch: string
  reviewStatus: DiffStackReviewStatus
  reviewedBy: string | null
  reviewedAt: number | null
  reviewNotes: string | null
  queuePosition: number | null
  createdAt: number
  createdBy: string | null
}

/**
 * Checkpoint within a diff stack with position
 */
export interface CheckpointInStack {
  checkpointId: string
  position: number
  checkpoint?: DataplaneCheckpoint
}

/**
 * Diff Stack with checkpoints included
 */
export interface DiffStackWithCheckpoints extends DiffStack {
  checkpoints: CheckpointInStack[]
}

// =============================================================================
// DAG Visualization Types
// =============================================================================

/**
 * Checkpoint statistics for node display
 */
export interface CheckpointStats {
  filesChanged: number
  additions: number
  deletions: number
}

/**
 * Data passed to CheckpointNode React Flow component
 */
export interface CheckpointNodeData {
  checkpoint: DataplaneCheckpoint
  stream?: Stream
  stats?: CheckpointStats
  // Visual state
  isSelected: boolean
  inStack: boolean
  stackId?: string
  merged: boolean
  // Callbacks
  onSelect?: (checkpointId: string, multiSelect: boolean) => void
}

/**
 * API response for checkpoints query
 */
export interface CheckpointsResponse {
  checkpoints: CheckpointWithAppData[]
  streams: Stream[]
}

/**
 * API request for creating a diff stack
 */
export interface CreateDiffStackRequest {
  name?: string
  description?: string
  targetBranch?: string
  checkpointIds: string[]
}

/**
 * API request for updating review status
 */
export interface ReviewDiffStackRequest {
  status: 'approved' | 'rejected' | 'abandoned' | 'pending'
  reviewedBy?: string
  notes?: string
}

/**
 * Merge result from executing a diff stack merge
 */
export interface MergeResult {
  mergedCheckpoints: string[]
  skippedCheckpoints: string[]
  targetBranch: string
  mergeCommit: string | null
  conflicts?: string[]
  dryRun: boolean
}

// =============================================================================
// Status Display Helpers
// =============================================================================

/**
 * Color mapping for diff stack review status
 */
export const REVIEW_STATUS_STYLES: Record<
  DiffStackReviewStatus,
  {
    border: string
    background: string
    text: string
  }
> = {
  pending: {
    border: 'border-muted',
    background: 'bg-muted/20',
    text: 'text-muted-foreground',
  },
  approved: {
    border: 'border-green-500',
    background: 'bg-green-500/10',
    text: 'text-green-700 dark:text-green-300',
  },
  rejected: {
    border: 'border-destructive',
    background: 'bg-destructive/10',
    text: 'text-destructive',
  },
  merged: {
    border: 'border-purple-500',
    background: 'bg-purple-500/10',
    text: 'text-purple-700 dark:text-purple-300',
  },
  abandoned: {
    border: 'border-muted',
    background: 'bg-muted/10',
    text: 'text-muted-foreground line-through',
  },
}

/**
 * Human-readable labels for review status
 */
export const REVIEW_STATUS_LABELS: Record<DiffStackReviewStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  merged: 'Merged',
  abandoned: 'Abandoned',
}

/**
 * Stream status colors for node styling
 */
export const STREAM_COLORS: string[] = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
]

/**
 * Get consistent color for a stream ID
 */
export function getStreamColor(streamId: string, streamIds: string[]): string {
  const index = streamIds.indexOf(streamId)
  return STREAM_COLORS[index % STREAM_COLORS.length]
}
