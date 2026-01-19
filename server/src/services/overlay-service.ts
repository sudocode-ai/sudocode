/**
 * Overlay Service
 *
 * Computes projected state of issues and specs by applying checkpoint snapshots
 * in topological order based on stream DAG lineage.
 *
 * @module services/overlay-service
 */

import type {
  Issue,
  Spec,
  ProjectedIssue,
  ProjectedSpec,
  Attribution,
  IssueJSONL,
  SpecJSONL,
} from '@sudocode-ai/types';
import type { CheckpointWithStreamData } from './dataplane-adapter.js';
import { getOverlayOrder, type CheckpointWithStream } from '../utils/overlay-order.js';
import { parseSnapshot, type ChangeType } from '../utils/jsonl-diff.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of overlay computation
 */
export interface OverlayResult {
  /** Issues with projected changes applied */
  issues: ProjectedIssue[];
  /** Specs with projected changes applied */
  specs: ProjectedSpec[];
  /** Number of issues that were modified/created from overlays */
  projectedIssueCount: number;
  /** Number of specs that were modified/created from overlays */
  projectedSpecCount: number;
}

/**
 * Snapshot entry from checkpoint's issue_snapshot or spec_snapshot JSON
 */
interface SnapshotEntry {
  id: string;
  changeType: ChangeType;
  entity: IssueJSONL | SpecJSONL;
  changedFields?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert CheckpointWithStreamData to CheckpointWithStream format
 */
function toCheckpointWithStream(data: CheckpointWithStreamData): CheckpointWithStream {
  return {
    checkpoint: {
      id: data.checkpoint.id,
      issue_id: data.checkpoint.issue_id,
      execution_id: data.checkpoint.execution_id,
      stream_id: data.checkpoint.stream_id,
      commit_sha: data.checkpoint.commit_sha,
      parent_commit: data.checkpoint.parent_commit ?? undefined,
      changed_files: data.checkpoint.changed_files,
      additions: data.checkpoint.additions,
      deletions: data.checkpoint.deletions,
      message: data.checkpoint.message,
      checkpointed_at: data.checkpoint.checkpointed_at,
      checkpointed_by: data.checkpoint.checkpointed_by ?? undefined,
      review_status: data.checkpoint.review_status as 'pending' | 'approved' | 'rejected' | 'merged',
      reviewed_at: data.checkpoint.reviewed_at ?? undefined,
      reviewed_by: data.checkpoint.reviewed_by ?? undefined,
      review_notes: data.checkpoint.review_notes ?? undefined,
      target_branch: data.checkpoint.target_branch ?? undefined,
      queue_position: data.checkpoint.queue_position ?? undefined,
      issue_snapshot: data.checkpoint.issue_snapshot ?? undefined,
      spec_snapshot: data.checkpoint.spec_snapshot ?? undefined,
    },
    stream: data.stream,
    execution: data.execution,
  };
}

/**
 * Create attribution from checkpoint data
 */
function createAttribution(checkpoint: CheckpointWithStream): Attribution {
  return {
    streamId: checkpoint.stream.id,
    executionId: checkpoint.execution.id,
    checkpointId: checkpoint.checkpoint.id,
    worktreePath: checkpoint.execution.worktree_path,
    branchName: checkpoint.execution.branch_name,
  };
}

/**
 * Convert IssueJSONL to Issue (strip JSONL-specific fields)
 */
function issueJSONLToIssue(jsonl: IssueJSONL): Issue {
  return {
    id: jsonl.id,
    title: jsonl.title,
    status: jsonl.status,
    uuid: jsonl.uuid,
    content: jsonl.content,
    priority: jsonl.priority,
    assignee: jsonl.assignee,
    archived: jsonl.archived,
    archived_at: jsonl.archived_at,
    created_at: jsonl.created_at,
    updated_at: jsonl.updated_at,
    closed_at: jsonl.closed_at,
    parent_id: jsonl.parent_id,
    parent_uuid: jsonl.parent_uuid,
    external_links: jsonl.external_links,
  };
}

/**
 * Convert SpecJSONL to Spec (strip JSONL-specific fields)
 */
function specJSONLToSpec(jsonl: SpecJSONL): Spec {
  return {
    id: jsonl.id,
    title: jsonl.title,
    uuid: jsonl.uuid,
    file_path: jsonl.file_path,
    content: jsonl.content,
    priority: jsonl.priority,
    archived: jsonl.archived,
    archived_at: jsonl.archived_at,
    created_at: jsonl.created_at,
    updated_at: jsonl.updated_at,
    parent_id: jsonl.parent_id,
    parent_uuid: jsonl.parent_uuid,
    external_links: jsonl.external_links,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Overlay Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute projected state by applying checkpoint snapshots to base issues/specs.
 *
 * The algorithm:
 * 1. Convert checkpoints to the format expected by getOverlayOrder
 * 2. Get topological order (parents before children)
 * 3. Start with base issues/specs as a map
 * 4. For each checkpoint in order, apply snapshot changes
 * 5. Return final projected state with attribution
 *
 * @param baseIssues - Issues from main database
 * @param baseSpecs - Specs from main database
 * @param checkpoints - Checkpoints with snapshots from getCheckpointsWithSnapshots
 * @returns Projected issues and specs with attribution
 */
export function computeOverlay(
  baseIssues: Issue[],
  baseSpecs: Spec[],
  checkpoints: CheckpointWithStreamData[]
): OverlayResult {
  // Convert to format expected by overlay-order
  const checkpointsWithStream = checkpoints.map(toCheckpointWithStream);

  // Get topological order
  const orderedCheckpoints = getOverlayOrder(checkpointsWithStream);

  // Build maps for efficient lookup and modification
  const issueMap = new Map<string, ProjectedIssue>();
  const specMap = new Map<string, ProjectedSpec>();

  // Initialize with base issues (no attribution = not projected)
  for (const issue of baseIssues) {
    issueMap.set(issue.id, { ...issue });
  }

  // Initialize with base specs (no attribution = not projected)
  for (const spec of baseSpecs) {
    specMap.set(spec.id, { ...spec });
  }

  // Apply each checkpoint's snapshot in order
  for (const checkpoint of orderedCheckpoints) {
    const attribution = createAttribution(checkpoint);

    // Apply issue snapshot
    if (checkpoint.checkpoint.issue_snapshot) {
      try {
        const issueChanges = parseSnapshot(checkpoint.checkpoint.issue_snapshot) as SnapshotEntry[];
        applyIssueChanges(issueMap, issueChanges, attribution);
      } catch (error) {
        console.warn(
          `[computeOverlay] Failed to parse issue_snapshot for checkpoint ${checkpoint.checkpoint.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Apply spec snapshot
    if (checkpoint.checkpoint.spec_snapshot) {
      try {
        const specChanges = parseSnapshot(checkpoint.checkpoint.spec_snapshot) as SnapshotEntry[];
        applySpecChanges(specMap, specChanges, attribution);
      } catch (error) {
        console.warn(
          `[computeOverlay] Failed to parse spec_snapshot for checkpoint ${checkpoint.checkpoint.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  // Convert maps to arrays
  const issues = Array.from(issueMap.values());
  const specs = Array.from(specMap.values());

  // Count projected items
  const projectedIssueCount = issues.filter(i => i._isProjected).length;
  const projectedSpecCount = specs.filter(s => s._isProjected).length;

  return {
    issues,
    specs,
    projectedIssueCount,
    projectedSpecCount,
  };
}

/**
 * Apply issue changes from a snapshot to the issue map
 */
function applyIssueChanges(
  issueMap: Map<string, ProjectedIssue>,
  changes: SnapshotEntry[],
  attribution: Attribution
): void {
  for (const change of changes) {
    const { id, changeType, entity } = change;
    const issueEntity = entity as IssueJSONL;

    switch (changeType) {
      case 'created': {
        // Add new issue with attribution
        const newIssue: ProjectedIssue = {
          ...issueJSONLToIssue(issueEntity),
          _attribution: attribution,
          _isProjected: true,
          _changeType: 'created',
        };
        issueMap.set(id, newIssue);
        break;
      }

      case 'modified': {
        // Get existing or create from snapshot
        const existing = issueMap.get(id);
        if (existing) {
          // Merge changes, overwriting with snapshot values
          const modified: ProjectedIssue = {
            ...existing,
            ...issueJSONLToIssue(issueEntity),
            _attribution: attribution,
            _isProjected: true,
            _changeType: 'modified',
          };
          issueMap.set(id, modified);
        } else {
          // Issue doesn't exist in base, treat as created
          const newIssue: ProjectedIssue = {
            ...issueJSONLToIssue(issueEntity),
            _attribution: attribution,
            _isProjected: true,
            _changeType: 'created',
          };
          issueMap.set(id, newIssue);
        }
        break;
      }

      case 'deleted': {
        // Mark as deleted/archived with attribution
        const existing = issueMap.get(id);
        if (existing) {
          const deleted: ProjectedIssue = {
            ...existing,
            archived: true,
            _attribution: attribution,
            _isProjected: true,
            _changeType: 'deleted',
          };
          issueMap.set(id, deleted);
        }
        // If doesn't exist, nothing to delete
        break;
      }
    }
  }
}

/**
 * Apply spec changes from a snapshot to the spec map
 */
function applySpecChanges(
  specMap: Map<string, ProjectedSpec>,
  changes: SnapshotEntry[],
  attribution: Attribution
): void {
  for (const change of changes) {
    const { id, changeType, entity } = change;
    const specEntity = entity as SpecJSONL;

    switch (changeType) {
      case 'created': {
        // Add new spec with attribution
        const newSpec: ProjectedSpec = {
          ...specJSONLToSpec(specEntity),
          _attribution: attribution,
          _isProjected: true,
          _changeType: 'created',
        };
        specMap.set(id, newSpec);
        break;
      }

      case 'modified': {
        // Get existing or create from snapshot
        const existing = specMap.get(id);
        if (existing) {
          // Merge changes, overwriting with snapshot values
          const modified: ProjectedSpec = {
            ...existing,
            ...specJSONLToSpec(specEntity),
            _attribution: attribution,
            _isProjected: true,
            _changeType: 'modified',
          };
          specMap.set(id, modified);
        } else {
          // Spec doesn't exist in base, treat as created
          const newSpec: ProjectedSpec = {
            ...specJSONLToSpec(specEntity),
            _attribution: attribution,
            _isProjected: true,
            _changeType: 'created',
          };
          specMap.set(id, newSpec);
        }
        break;
      }

      case 'deleted': {
        // Mark as deleted/archived with attribution
        const existing = specMap.get(id);
        if (existing) {
          const deleted: ProjectedSpec = {
            ...existing,
            archived: true,
            _attribution: attribution,
            _isProjected: true,
            _changeType: 'deleted',
          };
          specMap.set(id, deleted);
        }
        // If doesn't exist, nothing to delete
        break;
      }
    }
  }
}
