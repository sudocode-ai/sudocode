/**
 * Queue View Service - enriches queue entries with issue and stack information
 *
 * Provides a view layer over the raw DataplaneAdapter queue data,
 * adding issue titles, stack membership, dependencies, and promotion eligibility.
 */

import type Database from "better-sqlite3";
import type { DataplaneAdapter } from "./dataplane-adapter.js";
import { listStacks } from "./stack-service.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type QueueStatus =
  | "pending"
  | "ready"
  | "merging"
  | "merged"
  | "failed"
  | "cancelled";

export interface EnrichedQueueEntry {
  // From base QueueEntry
  id: string;
  executionId: string;
  streamId: string;
  targetBranch: string;
  position: number;
  priority: number;
  status: QueueStatus;
  addedAt: number;
  error?: string;
  mergeCommit?: string;

  // Enriched fields
  issueId: string;
  issueTitle: string;
  stackId?: string;
  stackName?: string;
  stackDepth: number;
  dependencies: string[]; // Issue IDs this depends on
  canPromote: boolean; // True if approved and dependencies merged
}

export interface QueueStats {
  total: number;
  byStatus: Record<QueueStatus, number>;
  byStack: Record<string, number>;
}

export interface GetQueueOptions {
  targetBranch?: string;
  includeStatuses?: QueueStatus[];
  excludeStatuses?: QueueStatus[];
}

export interface ReorderValidation {
  valid: boolean;
  blockedBy?: string[]; // Issue IDs that must come first
  warning?: string;
}

export interface QueueListResponse {
  entries: EnrichedQueueEntry[];
  stats: QueueStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionRow {
  id: string;
  issue_id: string;
}

interface IssueRow {
  id: string;
  title: string;
}

interface RelationshipRow {
  from_id: string;
  to_id: string;
  relationship_type: string;
}

interface CheckpointRow {
  issue_id: string;
  review_status: string;
}

/**
 * Get issue IDs for executions in the queue
 */
function getExecutionIssueMap(
  db: Database.Database,
  executionIds: string[]
): Map<string, string> {
  if (executionIds.length === 0) return new Map();

  const placeholders = executionIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, issue_id FROM executions WHERE id IN (${placeholders})`
    )
    .all(...executionIds) as ExecutionRow[];

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, row.issue_id);
  }
  return map;
}

/**
 * Get issue titles for given issue IDs
 */
function getIssueTitles(
  db: Database.Database,
  issueIds: string[]
): Map<string, string> {
  if (issueIds.length === 0) return new Map();

  const uniqueIds = [...new Set(issueIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, title FROM issues WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as IssueRow[];

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, row.title);
  }
  return map;
}

/**
 * Get dependencies for issues (issues that must be completed first)
 */
function getIssueDependencies(
  db: Database.Database,
  issueIds: string[]
): Map<string, string[]> {
  if (issueIds.length === 0) return new Map();

  const uniqueIds = [...new Set(issueIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");

  // Get blocks and depends-on relationships
  const rows = db
    .prepare(
      `SELECT from_id, to_id, relationship_type
       FROM relationships
       WHERE from_type = 'issue' AND to_type = 'issue'
       AND relationship_type IN ('blocks', 'depends-on')
       AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`
    )
    .all(...uniqueIds, ...uniqueIds) as RelationshipRow[];

  const map = new Map<string, string[]>();
  for (const id of uniqueIds) {
    map.set(id, []);
  }

  for (const row of rows) {
    // For 'blocks': from_id blocks to_id → to_id depends on from_id
    // For 'depends-on': from_id depends on to_id
    if (row.relationship_type === "blocks") {
      const deps = map.get(row.to_id);
      if (deps && !deps.includes(row.from_id)) {
        deps.push(row.from_id);
      }
    } else if (row.relationship_type === "depends-on") {
      const deps = map.get(row.from_id);
      if (deps && !deps.includes(row.to_id)) {
        deps.push(row.to_id);
      }
    }
  }

  return map;
}

/**
 * Get checkpoint approval status for issues
 */
function getCheckpointStatuses(
  db: Database.Database,
  issueIds: string[]
): Map<string, string> {
  if (issueIds.length === 0) return new Map();

  const uniqueIds = [...new Set(issueIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");

  // Get most recent checkpoint for each issue
  const rows = db
    .prepare(
      `SELECT issue_id, review_status
       FROM checkpoints
       WHERE issue_id IN (${placeholders})
       ORDER BY checkpointed_at DESC`
    )
    .all(...uniqueIds) as CheckpointRow[];

  const map = new Map<string, string>();
  for (const row of rows) {
    // Only store first (most recent) checkpoint status per issue
    if (!map.has(row.issue_id)) {
      map.set(row.issue_id, row.review_status);
    }
  }

  return map;
}

/**
 * Get merged/promoted issue IDs
 */
function getMergedIssueIds(
  db: Database.Database,
  issueIds: string[]
): Set<string> {
  if (issueIds.length === 0) return new Set();

  const uniqueIds = [...new Set(issueIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");

  const rows = db
    .prepare(
      `SELECT issue_id
       FROM checkpoints
       WHERE issue_id IN (${placeholders})
       AND review_status = 'merged'`
    )
    .all(...uniqueIds) as Array<{ issue_id: string }>;

  return new Set(rows.map((r) => r.issue_id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get enriched queue entries with issue and stack information
 */
export async function getEnrichedQueue(
  db: Database.Database,
  adapter: DataplaneAdapter,
  options?: GetQueueOptions
): Promise<EnrichedQueueEntry[]> {
  const targetBranch = options?.targetBranch || "main";

  // 1. Get raw queue from adapter
  const rawQueue = await adapter.getQueue(targetBranch);

  if (rawQueue.length === 0) {
    return [];
  }

  // 2. Apply status filters
  let filteredQueue = rawQueue;
  if (options?.includeStatuses && options.includeStatuses.length > 0) {
    filteredQueue = filteredQueue.filter((e) =>
      options.includeStatuses!.includes(e.status as QueueStatus)
    );
  }
  if (options?.excludeStatuses && options.excludeStatuses.length > 0) {
    filteredQueue = filteredQueue.filter(
      (e) => !options.excludeStatuses!.includes(e.status as QueueStatus)
    );
  }

  if (filteredQueue.length === 0) {
    return [];
  }

  // 3. Get execution → issue mapping
  const executionIds = filteredQueue.map((e) => e.executionId);
  const executionIssueMap = getExecutionIssueMap(db, executionIds);

  // 4. Get issue titles
  const issueIds = [...executionIssueMap.values()];
  const issueTitles = getIssueTitles(db, issueIds);

  // 5. Get dependencies
  const dependencies = getIssueDependencies(db, issueIds);

  // 6. Get checkpoint statuses
  const checkpointStatuses = getCheckpointStatuses(db, issueIds);

  // 7. Get merged issues (for canPromote calculation)
  const allDependencyIds = [...dependencies.values()].flat();
  const mergedIssues = getMergedIssueIds(db, [
    ...issueIds,
    ...allDependencyIds,
  ]);

  // 8. Get stacks for stack membership
  const stacks = listStacks(db);
  const issueStackMap = new Map<
    string,
    { stackId: string; stackName?: string; depth: number }
  >();

  for (const stackInfo of stacks) {
    for (const entry of stackInfo.entries) {
      issueStackMap.set(entry.issue_id, {
        stackId: stackInfo.stack.id,
        stackName: stackInfo.stack.name,
        depth: entry.depth,
      });
    }
  }

  // 9. Build enriched entries
  const enrichedEntries: EnrichedQueueEntry[] = [];

  for (let i = 0; i < filteredQueue.length; i++) {
    const entry = filteredQueue[i];
    const issueId = executionIssueMap.get(entry.executionId) || "";
    const issueTitle = issueTitles.get(issueId) || "Unknown Issue";
    const issueDeps = dependencies.get(issueId) || [];
    const checkpointStatus = checkpointStatuses.get(issueId);
    const stackInfo = issueStackMap.get(issueId);

    // Determine if can promote:
    // - Must have approved checkpoint
    // - All dependencies must be merged
    const isApproved =
      checkpointStatus === "approved" || checkpointStatus === "merged";
    const allDepsmerged = issueDeps.every((depId) => mergedIssues.has(depId));
    const canPromote = isApproved && allDepsmerged;

    enrichedEntries.push({
      // Base fields
      id: entry.id,
      executionId: entry.executionId,
      streamId: entry.streamId,
      targetBranch: entry.targetBranch,
      position: i + 1, // 1-indexed position in filtered results
      priority: entry.priority,
      status: entry.status as QueueStatus,
      addedAt: entry.addedAt,
      error: entry.error,
      mergeCommit: entry.mergeCommit,

      // Enriched fields
      issueId,
      issueTitle,
      stackId: stackInfo?.stackId,
      stackName: stackInfo?.stackName,
      stackDepth: stackInfo?.depth ?? 0,
      dependencies: issueDeps,
      canPromote,
    });
  }

  return enrichedEntries;
}

/**
 * Validate a reorder operation for dependency violations
 *
 * Checks if moving an entry to a new position would violate dependencies
 * (i.e., would place it before items it depends on)
 */
export async function validateReorder(
  db: Database.Database,
  adapter: DataplaneAdapter,
  executionId: string,
  newPosition: number,
  targetBranch: string = "main"
): Promise<ReorderValidation> {
  // Get enriched queue to have dependency info
  const queue = await getEnrichedQueue(db, adapter, { targetBranch });

  // Find the entry being moved
  const entryIndex = queue.findIndex((e) => e.executionId === executionId);
  if (entryIndex === -1) {
    return {
      valid: false,
      warning: `Queue entry not found for execution: ${executionId}`,
    };
  }

  const entry = queue[entryIndex];
  const currentPosition = entryIndex + 1; // 1-indexed

  // If not moving, it's valid
  if (newPosition === currentPosition) {
    return { valid: true };
  }

  // Check if moving forward (to earlier position)
  if (newPosition < currentPosition) {
    // Check if any dependencies would end up after this entry
    const blockedBy: string[] = [];

    for (const depIssueId of entry.dependencies) {
      // Find queue entry for this dependency
      const depEntry = queue.find((e) => e.issueId === depIssueId);
      if (depEntry) {
        const depPosition = queue.indexOf(depEntry) + 1;
        // If dependency is currently after new position, it would be violated
        if (depPosition >= newPosition) {
          blockedBy.push(depIssueId);
        }
      }
    }

    if (blockedBy.length > 0) {
      return {
        valid: false,
        blockedBy,
        warning: `Cannot move ahead of dependencies: ${blockedBy.join(", ")}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get queue statistics
 */
export async function getQueueStats(
  db: Database.Database,
  adapter: DataplaneAdapter,
  targetBranch: string = "main"
): Promise<QueueStats> {
  // Get all entries (no status filter)
  const queue = await getEnrichedQueue(db, adapter, { targetBranch });

  const byStatus: Record<QueueStatus, number> = {
    pending: 0,
    ready: 0,
    merging: 0,
    merged: 0,
    failed: 0,
    cancelled: 0,
  };

  const byStack: Record<string, number> = {};

  for (const entry of queue) {
    // Count by status
    byStatus[entry.status]++;

    // Count by stack
    const stackKey = entry.stackId || "standalone";
    byStack[stackKey] = (byStack[stackKey] || 0) + 1;
  }

  return {
    total: queue.length,
    byStatus,
    byStack,
  };
}

/**
 * Get enriched queue with stats in single call
 */
export async function getQueueWithStats(
  db: Database.Database,
  adapter: DataplaneAdapter,
  options?: GetQueueOptions
): Promise<QueueListResponse> {
  const targetBranch = options?.targetBranch || "main";

  // Get all entries for stats calculation
  const allEntries = await getEnrichedQueue(db, adapter, { targetBranch });

  // Calculate stats from all entries
  const byStatus: Record<QueueStatus, number> = {
    pending: 0,
    ready: 0,
    merging: 0,
    merged: 0,
    failed: 0,
    cancelled: 0,
  };

  const byStack: Record<string, number> = {};

  for (const entry of allEntries) {
    byStatus[entry.status]++;
    const stackKey = entry.stackId || "standalone";
    byStack[stackKey] = (byStack[stackKey] || 0) + 1;
  }

  const stats: QueueStats = {
    total: allEntries.length,
    byStatus,
    byStack,
  };

  // Apply filters for returned entries
  let filteredEntries = allEntries;
  if (options?.includeStatuses && options.includeStatuses.length > 0) {
    filteredEntries = filteredEntries.filter((e) =>
      options.includeStatuses!.includes(e.status)
    );
  }
  if (options?.excludeStatuses && options.excludeStatuses.length > 0) {
    filteredEntries = filteredEntries.filter(
      (e) => !options.excludeStatuses!.includes(e.status)
    );
  }

  // Recalculate positions after filtering
  filteredEntries = filteredEntries.map((entry, index) => ({
    ...entry,
    position: index + 1,
  }));

  return {
    entries: filteredEntries,
    stats,
  };
}
