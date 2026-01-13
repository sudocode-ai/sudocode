/**
 * PR Batch types for Phase 5
 *
 * Types for grouping queue entries into batches that become single GitHub PRs.
 */

import type { EnrichedQueueEntry } from "./queue";

/**
 * PR status for a batch
 */
export type BatchPRStatus = "draft" | "open" | "approved" | "merged" | "closed";

/**
 * Merge strategy for combining commits
 */
export type MergeStrategy = "squash" | "preserve";

/**
 * Represents a batch of queue entries to be merged as a single PR
 */
export interface PRBatch {
  /** Unique batch identifier */
  id: string;
  /** Human-readable title for the batch/PR */
  title: string;
  /** Optional description for the PR body */
  description?: string;
  /** JSON array of queue entry IDs included in this batch */
  entry_ids: string[];
  /** Target branch for the PR */
  target_branch: string;
  /** GitHub PR number (set after PR creation) */
  pr_number?: number;
  /** GitHub PR URL (set after PR creation) */
  pr_url?: string;
  /** Current status of the PR */
  pr_status: BatchPRStatus;
  /** Strategy for merging commits */
  merge_strategy: MergeStrategy;
  /** Whether to create as draft PR */
  is_draft_pr: boolean;
  /** When batch was created (ISO 8601) */
  created_at: string;
  /** When batch was last updated (ISO 8601) */
  updated_at: string;
  /** Who created the batch */
  created_by?: string;
}

/**
 * Enriched batch with resolved queue entries and computed stats
 */
export interface EnrichedBatch extends PRBatch {
  /** Resolved queue entries */
  entries: EnrichedQueueEntry[];
  /** Total number of files changed */
  total_files: number;
  /** Total lines added */
  total_additions: number;
  /** Total lines deleted */
  total_deletions: number;
  /** Computed dependency order for merging */
  dependency_order: string[];
  /** Whether there are dependency violations */
  has_dependency_violations: boolean;
}

/**
 * Request to create a new batch
 */
export interface CreateBatchRequest {
  /** Title for the batch/PR */
  title: string;
  /** Optional description */
  description?: string;
  /** Queue entry IDs to include */
  entry_ids: string[];
  /** Target branch (default: main) */
  target_branch?: string;
  /** Merge strategy (default: squash) */
  merge_strategy?: MergeStrategy;
  /** Whether to create as draft (default: true) */
  is_draft_pr?: boolean;
}

/**
 * Request to update a batch
 */
export interface UpdateBatchRequest {
  /** Updated title */
  title?: string;
  /** Updated description */
  description?: string;
}

/**
 * Preview of what a batch will contain
 */
export interface BatchPreview {
  /** Computed dependency order */
  dependency_order: string[];
  /** Files that will be changed */
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  /** Total lines added */
  total_additions: number;
  /** Total lines deleted */
  total_deletions: number;
  /** Preview of PR body */
  pr_body_preview: string;
}

/**
 * Response from listing batches
 */
export interface BatchListResponse {
  batches: PRBatch[];
  total: number;
}

/**
 * Options for listing batches
 */
export interface ListBatchesOptions {
  /** Filter by target branch */
  targetBranch?: string;
  /** Filter by PR status */
  prStatus?: BatchPRStatus;
  /** Include resolved entries */
  includeEntries?: boolean;
}

/**
 * Result of batch promotion
 */
export interface BatchPromoteResult {
  success: boolean;
  /** Results for each entry */
  results: Array<{
    entry_id: string;
    success: boolean;
    error?: string;
  }>;
  /** Total entries promoted */
  promoted_count: number;
  /** Total entries failed */
  failed_count: number;
}
