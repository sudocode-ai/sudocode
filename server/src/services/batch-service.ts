/**
 * Batch Service - manages PR batches for grouped review and merge
 *
 * Batches group queue entries for coordinated PR creation.
 * They enforce dependency ordering and track PR status.
 */

import type Database from "better-sqlite3";
import type {
  PRBatch,
  EnrichedBatch,
  CreateBatchRequest,
  MergeStrategy,
  BatchPRStatus,
  EnrichedQueueEntry,
} from "@sudocode-ai/types";
import { v4 as uuidv4 } from "uuid";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateBatchOptions extends CreateBatchRequest {
  created_by?: string;
}

export interface UpdateBatchOptions {
  title?: string;
  description?: string;
}

export interface ListBatchOptions {
  targetBranch?: string;
  prStatus?: BatchPRStatus;
  includeEntries?: boolean;
}

export interface BatchValidationResult {
  valid: boolean;
  errors: string[];
  dependencyOrder: string[];
  hasDependencyViolations: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ID Generation
// ─────────────────────────────────────────────────────────────────────────────

function generateBatchId(): string {
  // Generate a short hash-based ID like "bat-xxxx"
  const uuid = uuidv4();
  const hash = uuid.replace(/-/g, "").substring(0, 8);
  return `bat-${hash}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Order Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build dependency graph for queue entries
 * Uses checkpoint dependencies from the checkpoints table
 */
function buildEntryDependencyGraph(
  db: Database.Database,
  entryIds: string[]
): Map<string, { blockedBy: Set<string>; blocks: Set<string> }> {
  const graph = new Map<
    string,
    { blockedBy: Set<string>; blocks: Set<string> }
  >();

  // Initialize graph nodes for all entry IDs
  for (const entryId of entryIds) {
    graph.set(entryId, { blockedBy: new Set(), blocks: new Set() });
  }

  // Get checkpoint data for these entries to find their issue IDs
  const placeholders = entryIds.map(() => "?").join(",");
  const checkpoints = db
    .prepare(
      `SELECT c.execution_id, c.issue_id
       FROM checkpoints c
       WHERE c.execution_id IN (${placeholders})`
    )
    .all(...entryIds) as Array<{ execution_id: string; issue_id: string }>;

  // Map execution_id to issue_id
  const entryToIssue = new Map<string, string>();
  for (const cp of checkpoints) {
    entryToIssue.set(cp.execution_id, cp.issue_id);
  }

  // Get issue dependencies from relationships table
  const issueIds = [...new Set(entryToIssue.values())];
  if (issueIds.length === 0) {
    return graph;
  }

  const issuePlaceholders = issueIds.map(() => "?").join(",");
  const relationships = db
    .prepare(
      `SELECT from_id, to_id, relationship_type
       FROM relationships
       WHERE from_type = 'issue' AND to_type = 'issue'
       AND relationship_type IN ('blocks', 'depends-on')
       AND (from_id IN (${issuePlaceholders}) OR to_id IN (${issuePlaceholders}))`
    )
    .all(...issueIds, ...issueIds) as Array<{
    from_id: string;
    to_id: string;
    relationship_type: string;
  }>;

  // Build reverse mapping from issue to entries
  const issueToEntries = new Map<string, string[]>();
  for (const [entryId, issueId] of entryToIssue) {
    const entries = issueToEntries.get(issueId) || [];
    entries.push(entryId);
    issueToEntries.set(issueId, entries);
  }

  // Apply relationships to entry graph
  for (const rel of relationships) {
    const fromEntries = issueToEntries.get(rel.from_id) || [];
    const toEntries = issueToEntries.get(rel.to_id) || [];

    if (rel.relationship_type === "blocks") {
      // from_id blocks to_id: to entries are blocked by from entries
      for (const toEntry of toEntries) {
        for (const fromEntry of fromEntries) {
          const toNode = graph.get(toEntry);
          const fromNode = graph.get(fromEntry);
          if (toNode && fromNode) {
            toNode.blockedBy.add(fromEntry);
            fromNode.blocks.add(toEntry);
          }
        }
      }
    } else if (rel.relationship_type === "depends-on") {
      // from_id depends on to_id: from entries are blocked by to entries
      for (const fromEntry of fromEntries) {
        for (const toEntry of toEntries) {
          const fromNode = graph.get(fromEntry);
          const toNode = graph.get(toEntry);
          if (fromNode && toNode) {
            fromNode.blockedBy.add(toEntry);
            toNode.blocks.add(fromEntry);
          }
        }
      }
    }
  }

  return graph;
}

/**
 * Topologically sort entries (blockers first)
 * Uses Kahn's algorithm
 */
function topologicalSortEntries(
  entryIds: string[],
  graph: Map<string, { blockedBy: Set<string>; blocks: Set<string> }>
): { order: string[]; hasCycle: boolean } {
  const inDegree = new Map<string, number>();
  const entrySet = new Set(entryIds);

  // Initialize in-degrees
  for (const id of entryIds) {
    const node = graph.get(id);
    if (node) {
      let degree = 0;
      for (const blocker of node.blockedBy) {
        if (entrySet.has(blocker)) {
          degree++;
        }
      }
      inDegree.set(id, degree);
    } else {
      inDegree.set(id, 0);
    }
  }

  // Kahn's algorithm
  const result: string[] = [];
  const queue: string[] = [];

  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const node = graph.get(current);
    if (node) {
      for (const blocked of node.blocks) {
        if (entrySet.has(blocked)) {
          const newDegree = (inDegree.get(blocked) || 0) - 1;
          inDegree.set(blocked, newDegree);
          if (newDegree === 0) {
            queue.push(blocked);
          }
        }
      }
    }
  }

  // Check for cycle
  const hasCycle = result.length !== entryIds.length;
  if (hasCycle) {
    // Return original order if cycle detected
    return { order: entryIds, hasCycle: true };
  }

  return { order: result, hasCycle: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Row Conversion
// ─────────────────────────────────────────────────────────────────────────────

interface BatchRow {
  id: string;
  title: string;
  description: string | null;
  entry_ids: string;
  target_branch: string;
  pr_number: number | null;
  pr_url: string | null;
  pr_status: string;
  merge_strategy: string;
  is_draft_pr: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

function rowToBatch(row: BatchRow): PRBatch {
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    entry_ids: JSON.parse(row.entry_ids),
    target_branch: row.target_branch,
    pr_number: row.pr_number || undefined,
    pr_url: row.pr_url || undefined,
    pr_status: row.pr_status as BatchPRStatus,
    merge_strategy: row.merge_strategy as MergeStrategy,
    is_draft_pr: row.is_draft_pr === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new batch
 */
export function createBatch(
  db: Database.Database,
  options: CreateBatchOptions
): PRBatch {
  const id = generateBatchId();
  const now = new Date().toISOString();

  const batch: PRBatch = {
    id,
    title: options.title,
    description: options.description,
    entry_ids: options.entry_ids,
    target_branch: options.target_branch || "main",
    pr_status: "draft",
    merge_strategy: options.merge_strategy || "squash",
    is_draft_pr: options.is_draft_pr !== false, // Default to true
    created_at: now,
    updated_at: now,
    created_by: options.created_by,
  };

  db.prepare(
    `INSERT INTO batches (
      id, title, description, entry_ids, target_branch,
      pr_number, pr_url, pr_status, merge_strategy, is_draft_pr,
      created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    batch.id,
    batch.title,
    batch.description || null,
    JSON.stringify(batch.entry_ids),
    batch.target_branch,
    batch.pr_number || null,
    batch.pr_url || null,
    batch.pr_status,
    batch.merge_strategy,
    batch.is_draft_pr ? 1 : 0,
    batch.created_at,
    batch.updated_at,
    batch.created_by || null
  );

  return batch;
}

/**
 * Get a batch by ID
 */
export function getBatch(db: Database.Database, id: string): PRBatch | null {
  const row = db.prepare(`SELECT * FROM batches WHERE id = ?`).get(id) as
    | BatchRow
    | undefined;

  if (!row) {
    return null;
  }

  return rowToBatch(row);
}

/**
 * List batches with optional filtering
 */
export function listBatches(
  db: Database.Database,
  options?: ListBatchOptions
): { batches: PRBatch[]; total: number } {
  let query = `SELECT * FROM batches WHERE 1=1`;
  const params: any[] = [];

  if (options?.targetBranch) {
    query += ` AND target_branch = ?`;
    params.push(options.targetBranch);
  }

  if (options?.prStatus) {
    query += ` AND pr_status = ?`;
    params.push(options.prStatus);
  }

  query += ` ORDER BY created_at DESC`;

  const rows = db.prepare(query).all(...params) as BatchRow[];
  const batches = rows.map(rowToBatch);

  return {
    batches,
    total: batches.length,
  };
}

/**
 * Update a batch (limited fields - immutable after PR creation)
 */
export function updateBatch(
  db: Database.Database,
  id: string,
  updates: UpdateBatchOptions
): PRBatch | null {
  const existing = getBatch(db, id);
  if (!existing) {
    return null;
  }

  // Don't allow updates if PR has been created
  if (existing.pr_number) {
    throw new Error("Cannot update batch after PR has been created");
  }

  const now = new Date().toISOString();
  const title = updates.title !== undefined ? updates.title : existing.title;
  const description =
    updates.description !== undefined
      ? updates.description
      : existing.description;

  db.prepare(
    `UPDATE batches SET title = ?, description = ?, updated_at = ? WHERE id = ?`
  ).run(title, description || null, now, id);

  return getBatch(db, id);
}

/**
 * Update batch PR info (called after PR creation)
 */
export function updateBatchPR(
  db: Database.Database,
  id: string,
  prInfo: { pr_number: number; pr_url: string; pr_status?: BatchPRStatus }
): PRBatch | null {
  const existing = getBatch(db, id);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const prStatus = prInfo.pr_status || (existing.is_draft_pr ? "draft" : "open");

  db.prepare(
    `UPDATE batches SET pr_number = ?, pr_url = ?, pr_status = ?, updated_at = ? WHERE id = ?`
  ).run(prInfo.pr_number, prInfo.pr_url, prStatus, now, id);

  return getBatch(db, id);
}

/**
 * Update batch PR status
 */
export function updateBatchStatus(
  db: Database.Database,
  id: string,
  status: BatchPRStatus
): PRBatch | null {
  const existing = getBatch(db, id);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();

  db.prepare(`UPDATE batches SET pr_status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    now,
    id
  );

  return getBatch(db, id);
}

/**
 * Delete a batch
 */
export function deleteBatch(db: Database.Database, id: string): boolean {
  const existing = getBatch(db, id);
  if (!existing) {
    return false;
  }

  // Don't allow deletion if PR has been merged
  if (existing.pr_status === "merged") {
    throw new Error("Cannot delete batch with merged PR");
  }

  const result = db.prepare(`DELETE FROM batches WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Validate batch entries
 * Checks that entries exist and computes dependency order
 */
export function validateBatchEntries(
  db: Database.Database,
  entryIds: string[]
): BatchValidationResult {
  const errors: string[] = [];

  if (entryIds.length === 0) {
    return {
      valid: false,
      errors: ["Batch must contain at least one entry"],
      dependencyOrder: [],
      hasDependencyViolations: false,
    };
  }

  // Check that all entries exist in checkpoints table (queue entries are checkpoints)
  const placeholders = entryIds.map(() => "?").join(",");
  const existingEntries = db
    .prepare(
      `SELECT execution_id FROM checkpoints WHERE execution_id IN (${placeholders})`
    )
    .all(...entryIds) as Array<{ execution_id: string }>;

  const existingSet = new Set(existingEntries.map((e) => e.execution_id));
  const missingEntries = entryIds.filter((id) => !existingSet.has(id));

  if (missingEntries.length > 0) {
    errors.push(`Queue entries not found: ${missingEntries.join(", ")}`);
  }

  // Check for already merged entries
  const mergedEntries = db
    .prepare(
      `SELECT execution_id FROM checkpoints
       WHERE execution_id IN (${placeholders})
       AND review_status = 'merged'`
    )
    .all(...entryIds) as Array<{ execution_id: string }>;

  if (mergedEntries.length > 0) {
    const mergedIds = mergedEntries.map((e) => e.execution_id);
    errors.push(`Entries already merged: ${mergedIds.join(", ")}`);
  }

  // Compute dependency order
  const graph = buildEntryDependencyGraph(db, entryIds);
  const { order, hasCycle } = topologicalSortEntries(entryIds, graph);

  if (hasCycle) {
    errors.push("Circular dependency detected among entries");
  }

  return {
    valid: errors.length === 0,
    errors,
    dependencyOrder: order,
    hasDependencyViolations: hasCycle,
  };
}

/**
 * Get enriched batch with resolved entries and computed stats
 */
export function getEnrichedBatch(
  db: Database.Database,
  id: string
): EnrichedBatch | null {
  const batch = getBatch(db, id);
  if (!batch) {
    return null;
  }

  // Get queue entry data for the batch entries
  const entryIds = batch.entry_ids;
  if (entryIds.length === 0) {
    return {
      ...batch,
      entries: [],
      total_files: 0,
      total_additions: 0,
      total_deletions: 0,
      dependency_order: [],
      has_dependency_violations: false,
    };
  }

  const placeholders = entryIds.map(() => "?").join(",");

  // Get checkpoint and execution data
  const rows = db
    .prepare(
      `SELECT
        c.id as checkpoint_id,
        c.execution_id,
        c.issue_id,
        c.stream_id,
        c.review_status,
        c.target_branch,
        c.checkpointed_at,
        c.queue_position,
        e.before_commit,
        e.after_commit,
        i.title as issue_title
       FROM checkpoints c
       LEFT JOIN executions e ON c.execution_id = e.id
       LEFT JOIN issues i ON c.issue_id = i.id
       WHERE c.execution_id IN (${placeholders})`
    )
    .all(...entryIds) as Array<{
    checkpoint_id: string;
    execution_id: string;
    issue_id: string;
    stream_id: string;
    review_status: string;
    target_branch: string;
    checkpointed_at: string;
    queue_position: number | null;
    before_commit: string | null;
    after_commit: string | null;
    issue_title: string | null;
  }>;

  // Build enriched entries
  const entriesMap = new Map<string, EnrichedQueueEntry>();

  for (const row of rows) {
    // Map checkpoint data to EnrichedQueueEntry format
    // Note: EnrichedQueueEntry is designed for the queue system with dataplane integration
    const entry: EnrichedQueueEntry = {
      id: row.checkpoint_id,
      executionId: row.execution_id,
      streamId: row.stream_id,
      targetBranch: row.target_branch,
      position: row.queue_position || 0,
      priority: 0, // Default priority
      status: row.review_status === "merged" ? "merged" : "pending",
      addedAt: new Date(row.checkpointed_at).getTime(),
      issueId: row.issue_id,
      issueTitle: row.issue_title || "Unknown Issue",
      stackDepth: 0,
      dependencies: [], // Would need to resolve from relationships
      canPromote: row.review_status === "approved",
    };

    entriesMap.set(row.execution_id, entry);
  }

  // Compute dependency order
  const graph = buildEntryDependencyGraph(db, entryIds);
  const { order, hasCycle } = topologicalSortEntries(entryIds, graph);

  // Build ordered entries array
  const entries: EnrichedQueueEntry[] = [];
  for (const entryId of order) {
    const entry = entriesMap.get(entryId);
    if (entry) {
      entries.push(entry);
    }
  }

  return {
    ...batch,
    entries,
    total_files: 0, // TODO: Integrate with execution changes service for actual stats
    total_additions: 0,
    total_deletions: 0,
    dependency_order: order,
    has_dependency_violations: hasCycle,
  };
}

/**
 * Get batches containing a specific entry
 */
export function getBatchesForEntry(
  db: Database.Database,
  entryId: string
): PRBatch[] {
  // Since entry_ids is stored as JSON, we need to search within the JSON array
  // SQLite JSON functions would be ideal, but for compatibility we'll scan all batches
  const rows = db.prepare(`SELECT * FROM batches`).all() as BatchRow[];

  const batches: PRBatch[] = [];
  for (const row of rows) {
    try {
      const entryIds = JSON.parse(row.entry_ids) as string[];
      if (entryIds.includes(entryId)) {
        batches.push(rowToBatch(row));
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  return batches;
}

/**
 * Filter out entries that are already merged
 */
export function filterMergedEntries(
  db: Database.Database,
  entryIds: string[]
): string[] {
  if (entryIds.length === 0) {
    return [];
  }

  const placeholders = entryIds.map(() => "?").join(",");
  const mergedEntries = db
    .prepare(
      `SELECT execution_id FROM checkpoints
       WHERE execution_id IN (${placeholders})
       AND review_status = 'merged'`
    )
    .all(...entryIds) as Array<{ execution_id: string }>;

  const mergedSet = new Set(mergedEntries.map((e) => e.execution_id));
  return entryIds.filter((id) => !mergedSet.has(id));
}
