/**
 * Stack Service - manages stacks for stacked diffs workflow
 *
 * Stacks group related issues for coordinated merging.
 * They can be auto-generated from issue dependencies or manually created.
 */

import type Database from "better-sqlite3";
import type {
  Stack,
  StackEntry,
  StackInfo,
  StackHealth,
  CheckpointReviewStatus,
} from "@sudocode-ai/types";
import { v4 as uuidv4 } from "uuid";
// Relationships are queried directly from DB for efficiency

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateStackInput {
  name?: string;
  issueIds: string[];
  rootIssueId?: string;
}

export interface UpdateStackInput {
  name?: string;
  issueOrder?: string[];
  rootIssueId?: string | null;
}

interface CheckpointRow {
  issue_id: string;
  review_status: CheckpointReviewStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// ID Generation
// ─────────────────────────────────────────────────────────────────────────────

function generateStackId(): string {
  // Generate a short hash-based ID like "stk-xxxx"
  const uuid = uuidv4();
  const hash = uuid.replace(/-/g, "").substring(0, 8);
  return `stk-${hash}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Stack Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build dependency graph for all open/in_progress issues with blocks/depends-on relationships
 */
function buildDependencyGraph(
  db: Database.Database
): Map<string, { blockedBy: Set<string>; blocks: Set<string> }> {
  const graph = new Map<
    string,
    { blockedBy: Set<string>; blocks: Set<string> }
  >();

  // Get all active issues
  const issues = db
    .prepare(
      `SELECT id FROM issues WHERE status IN ('open', 'in_progress') AND archived = 0`
    )
    .all() as Array<{ id: string }>;

  // Initialize graph nodes
  for (const issue of issues) {
    graph.set(issue.id, { blockedBy: new Set(), blocks: new Set() });
  }

  // Get all blocks/depends-on relationships between issues
  const relationships = db
    .prepare(
      `SELECT from_id, to_id, relationship_type
       FROM relationships
       WHERE from_type = 'issue' AND to_type = 'issue'
       AND relationship_type IN ('blocks', 'depends-on')`
    )
    .all() as Array<{
    from_id: string;
    to_id: string;
    relationship_type: string;
  }>;

  for (const rel of relationships) {
    // For 'blocks': from_id blocks to_id (to_id is blocked by from_id)
    // For 'depends-on': from_id depends on to_id (from_id is blocked by to_id)
    if (rel.relationship_type === "blocks") {
      const toNode = graph.get(rel.to_id);
      const fromNode = graph.get(rel.from_id);
      if (toNode && fromNode) {
        toNode.blockedBy.add(rel.from_id);
        fromNode.blocks.add(rel.to_id);
      }
    } else if (rel.relationship_type === "depends-on") {
      const fromNode = graph.get(rel.from_id);
      const toNode = graph.get(rel.to_id);
      if (fromNode && toNode) {
        fromNode.blockedBy.add(rel.to_id);
        toNode.blocks.add(rel.from_id);
      }
    }
  }

  return graph;
}

/**
 * Find connected components in the dependency graph
 * Each component represents a potential stack
 */
function findConnectedComponents(
  graph: Map<string, { blockedBy: Set<string>; blocks: Set<string> }>
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  function dfs(nodeId: string, component: string[]): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    component.push(nodeId);

    const node = graph.get(nodeId);
    if (!node) return;

    // Visit all connected nodes (both blockedBy and blocks)
    for (const id of node.blockedBy) {
      dfs(id, component);
    }
    for (const id of node.blocks) {
      dfs(id, component);
    }
  }

  for (const nodeId of graph.keys()) {
    if (!visited.has(nodeId)) {
      const component: string[] = [];
      dfs(nodeId, component);
      // Only include components with more than one issue (actual dependencies)
      if (component.length > 1) {
        components.push(component);
      }
    }
  }

  return components;
}

/**
 * Topologically sort issues within a component (leaf first, depth=0)
 * Returns issues ordered so that blockers come before blocked issues
 */
function topologicalSort(
  issueIds: string[],
  graph: Map<string, { blockedBy: Set<string>; blocks: Set<string> }>
): string[] {
  const inDegree = new Map<string, number>();
  const issueSet = new Set(issueIds);

  // Initialize in-degrees (count of blockers within this component)
  for (const id of issueIds) {
    const node = graph.get(id);
    if (node) {
      let degree = 0;
      for (const blocker of node.blockedBy) {
        if (issueSet.has(blocker)) {
          degree++;
        }
      }
      inDegree.set(id, degree);
    } else {
      inDegree.set(id, 0);
    }
  }

  // Kahn's algorithm - start with leaves (no blockers)
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
      // For each issue that this one blocks
      for (const blocked of node.blocks) {
        if (issueSet.has(blocked)) {
          const newDegree = (inDegree.get(blocked) || 0) - 1;
          inDegree.set(blocked, newDegree);
          if (newDegree === 0) {
            queue.push(blocked);
          }
        }
      }
    }
  }

  // If we couldn't sort all (cycle), return in original order
  if (result.length !== issueIds.length) {
    return issueIds;
  }

  return result;
}

/**
 * Get issues that are already in manual stacks
 */
function getIssuesInManualStacks(db: Database.Database): Set<string> {
  const stacks = db
    .prepare(`SELECT issue_order FROM stacks WHERE is_auto = 0`)
    .all() as Array<{ issue_order: string }>;

  const issueIds = new Set<string>();
  for (const stack of stacks) {
    try {
      const order = JSON.parse(stack.issue_order) as string[];
      for (const id of order) {
        issueIds.add(id);
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  return issueIds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack Health Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get checkpoint info for issues
 */
function getCheckpointInfo(
  db: Database.Database,
  issueIds: string[]
): Map<string, { status: CheckpointReviewStatus; isMerged: boolean }> {
  if (issueIds.length === 0) {
    return new Map();
  }

  const placeholders = issueIds.map(() => "?").join(",");
  const checkpoints = db
    .prepare(
      `SELECT issue_id, review_status
       FROM checkpoints
       WHERE issue_id IN (${placeholders})
       ORDER BY checkpointed_at DESC`
    )
    .all(...issueIds) as CheckpointRow[];

  // Keep only the latest checkpoint per issue
  const result = new Map<
    string,
    { status: CheckpointReviewStatus; isMerged: boolean }
  >();
  for (const cp of checkpoints) {
    if (!result.has(cp.issue_id)) {
      result.set(cp.issue_id, {
        status: cp.review_status,
        isMerged: cp.review_status === "merged",
      });
    }
  }

  return result;
}

/**
 * Compute health status for a stack
 */
function computeStackHealth(
  entries: StackEntry[],
  graph: Map<string, { blockedBy: Set<string>; blocks: Set<string> }>
): StackHealth {
  if (entries.length === 0) {
    return "ready";
  }

  const issueSet = new Set(entries.map((e) => e.issue_id));

  // Check each entry
  let hasConflicts = false;
  let hasPending = false;
  let hasBlocked = false;

  for (const entry of entries) {
    // Check if blocked by unmerged issues in the stack
    const node = graph.get(entry.issue_id);
    if (node) {
      for (const blockerId of node.blockedBy) {
        if (issueSet.has(blockerId)) {
          // Find the blocker entry
          const blockerEntry = entries.find((e) => e.issue_id === blockerId);
          if (blockerEntry && !blockerEntry.is_promoted) {
            hasBlocked = true;
            break;
          }
        }
      }
    }

    // Check checkpoint status
    if (!entry.has_checkpoint) {
      hasPending = true;
    } else if (entry.checkpoint_status === "pending") {
      hasPending = true;
    } else if (entry.checkpoint_status === "rejected") {
      // Rejected counts as pending (needs revision)
      hasPending = true;
    }
  }

  // Priority: conflicts > blocked > pending > ready
  if (hasConflicts) {
    return "conflicts";
  }
  if (hasBlocked) {
    return "blocked";
  }
  if (hasPending) {
    return "pending";
  }

  return "ready";
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute auto-generated stacks from issue dependencies
 */
export function computeAutoStacks(db: Database.Database): StackInfo[] {
  const graph = buildDependencyGraph(db);
  const components = findConnectedComponents(graph);
  const inManualStacks = getIssuesInManualStacks(db);

  const stacks: StackInfo[] = [];

  for (const component of components) {
    // Filter out issues already in manual stacks
    const filteredComponent = component.filter((id) => !inManualStacks.has(id));
    if (filteredComponent.length < 2) {
      continue;
    }

    // Sort topologically (leaf first)
    const sortedIds = topologicalSort(filteredComponent, graph);

    // Get checkpoint info
    const checkpointInfo = getCheckpointInfo(db, sortedIds);

    // Build entries
    const entries: StackEntry[] = sortedIds.map((issueId, index) => {
      const cpInfo = checkpointInfo.get(issueId);
      return {
        issue_id: issueId,
        depth: index,
        has_checkpoint: !!cpInfo,
        checkpoint_status: cpInfo?.status,
        is_promoted: cpInfo?.isMerged || false,
      };
    });

    // Compute health
    const health = computeStackHealth(entries, graph);

    // Create virtual stack (not persisted)
    const stack: Stack = {
      id: `auto-${sortedIds[0]}`, // Use first issue ID as part of ID
      name: undefined,
      root_issue_id: sortedIds[sortedIds.length - 1], // Last issue is root
      issue_order: sortedIds,
      is_auto: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    stacks.push({ stack, entries, health });
  }

  return stacks;
}

/**
 * Get stack that contains a specific issue
 */
export function getStackForIssue(
  db: Database.Database,
  issueId: string
): StackInfo | null {
  // First check manual stacks
  const manualStacks = db
    .prepare(`SELECT * FROM stacks WHERE is_auto = 0`)
    .all() as Array<{
    id: string;
    name: string | null;
    root_issue_id: string | null;
    issue_order: string;
    is_auto: number;
    created_at: string;
    updated_at: string;
  }>;

  for (const row of manualStacks) {
    try {
      const issueOrder = JSON.parse(row.issue_order) as string[];
      if (issueOrder.includes(issueId)) {
        return getStack(db, row.id);
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // Check auto stacks
  const autoStacks = computeAutoStacks(db);
  for (const stackInfo of autoStacks) {
    if (stackInfo.stack.issue_order.includes(issueId)) {
      return stackInfo;
    }
  }

  return null;
}

/**
 * Create a new manual stack
 */
export function createStack(
  db: Database.Database,
  input: CreateStackInput
): Stack {
  const id = generateStackId();
  const now = new Date().toISOString();

  const stack: Stack = {
    id,
    name: input.name,
    root_issue_id: input.rootIssueId,
    issue_order: input.issueIds,
    is_auto: false,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO stacks (id, name, root_issue_id, issue_order, is_auto, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    stack.id,
    stack.name || null,
    stack.root_issue_id || null,
    JSON.stringify(stack.issue_order),
    stack.is_auto ? 1 : 0,
    stack.created_at,
    stack.updated_at
  );

  return stack;
}

/**
 * Update an existing stack
 */
export function updateStack(
  db: Database.Database,
  stackId: string,
  updates: UpdateStackInput
): Stack | null {
  const existing = db
    .prepare(`SELECT * FROM stacks WHERE id = ?`)
    .get(stackId) as {
    id: string;
    name: string | null;
    root_issue_id: string | null;
    issue_order: string;
    is_auto: number;
    created_at: string;
    updated_at: string;
  } | null;

  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const name =
    updates.name !== undefined ? updates.name : existing.name;
  const rootIssueId =
    updates.rootIssueId !== undefined
      ? updates.rootIssueId
      : existing.root_issue_id;
  const issueOrder =
    updates.issueOrder !== undefined
      ? updates.issueOrder
      : JSON.parse(existing.issue_order);

  db.prepare(
    `UPDATE stacks SET name = ?, root_issue_id = ?, issue_order = ?, updated_at = ? WHERE id = ?`
  ).run(
    name || null,
    rootIssueId || null,
    JSON.stringify(issueOrder),
    now,
    stackId
  );

  return {
    id: stackId,
    name: name || undefined,
    root_issue_id: rootIssueId || undefined,
    issue_order: issueOrder,
    is_auto: existing.is_auto === 1,
    created_at: existing.created_at,
    updated_at: now,
  };
}

/**
 * Delete a stack
 */
export function deleteStack(db: Database.Database, stackId: string): boolean {
  const result = db.prepare(`DELETE FROM stacks WHERE id = ?`).run(stackId);
  return result.changes > 0;
}

/**
 * Add an issue to a stack at a specific position
 */
export function addToStack(
  db: Database.Database,
  stackId: string,
  issueId: string,
  position?: number
): Stack | null {
  const existing = db
    .prepare(`SELECT issue_order FROM stacks WHERE id = ?`)
    .get(stackId) as { issue_order: string } | null;

  if (!existing) {
    return null;
  }

  const issueOrder = JSON.parse(existing.issue_order) as string[];

  // Don't add if already in stack
  if (issueOrder.includes(issueId)) {
    return updateStack(db, stackId, {}); // Just return current state
  }

  // Insert at position or end
  if (position !== undefined && position >= 0 && position <= issueOrder.length) {
    issueOrder.splice(position, 0, issueId);
  } else {
    issueOrder.push(issueId);
  }

  return updateStack(db, stackId, { issueOrder });
}

/**
 * Remove an issue from a stack
 */
export function removeFromStack(
  db: Database.Database,
  stackId: string,
  issueId: string
): Stack | null {
  const existing = db
    .prepare(`SELECT issue_order FROM stacks WHERE id = ?`)
    .get(stackId) as { issue_order: string } | null;

  if (!existing) {
    return null;
  }

  const issueOrder = JSON.parse(existing.issue_order) as string[];
  const newOrder = issueOrder.filter((id) => id !== issueId);

  return updateStack(db, stackId, { issueOrder: newOrder });
}

/**
 * Reorder issues within a stack
 */
export function reorderStack(
  db: Database.Database,
  stackId: string,
  issueOrder: string[]
): Stack | null {
  return updateStack(db, stackId, { issueOrder });
}

/**
 * List all stacks (both manual and auto)
 */
export function listStacks(db: Database.Database): StackInfo[] {
  const graph = buildDependencyGraph(db);

  // Get manual stacks
  const manualRows = db.prepare(`SELECT * FROM stacks WHERE is_auto = 0`).all() as Array<{
    id: string;
    name: string | null;
    root_issue_id: string | null;
    issue_order: string;
    is_auto: number;
    created_at: string;
    updated_at: string;
  }>;

  const manualStacks: StackInfo[] = [];
  for (const row of manualRows) {
    try {
      const issueOrder = JSON.parse(row.issue_order) as string[];
      const checkpointInfo = getCheckpointInfo(db, issueOrder);

      const entries: StackEntry[] = issueOrder.map((issueId, index) => {
        const cpInfo = checkpointInfo.get(issueId);
        return {
          issue_id: issueId,
          depth: index,
          has_checkpoint: !!cpInfo,
          checkpoint_status: cpInfo?.status,
          is_promoted: cpInfo?.isMerged || false,
        };
      });

      const health = computeStackHealth(entries, graph);

      manualStacks.push({
        stack: {
          id: row.id,
          name: row.name || undefined,
          root_issue_id: row.root_issue_id || undefined,
          issue_order: issueOrder,
          is_auto: false,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
        entries,
        health,
      });
    } catch {
      // Ignore invalid JSON
    }
  }

  // Get auto stacks
  const autoStacks = computeAutoStacks(db);

  return [...manualStacks, ...autoStacks];
}

/**
 * Get a specific stack by ID
 */
export function getStack(
  db: Database.Database,
  stackId: string
): StackInfo | null {
  // Check if it's an auto-stack ID
  if (stackId.startsWith("auto-")) {
    const autoStacks = computeAutoStacks(db);
    return autoStacks.find((s) => s.stack.id === stackId) || null;
  }

  // Look up manual stack
  const row = db.prepare(`SELECT * FROM stacks WHERE id = ?`).get(stackId) as {
    id: string;
    name: string | null;
    root_issue_id: string | null;
    issue_order: string;
    is_auto: number;
    created_at: string;
    updated_at: string;
  } | null;

  if (!row) {
    return null;
  }

  const graph = buildDependencyGraph(db);

  try {
    const issueOrder = JSON.parse(row.issue_order) as string[];
    const checkpointInfo = getCheckpointInfo(db, issueOrder);

    const entries: StackEntry[] = issueOrder.map((issueId, index) => {
      const cpInfo = checkpointInfo.get(issueId);
      return {
        issue_id: issueId,
        depth: index,
        has_checkpoint: !!cpInfo,
        checkpoint_status: cpInfo?.status,
        is_promoted: cpInfo?.isMerged || false,
      };
    });

    const health = computeStackHealth(entries, graph);

    return {
      stack: {
        id: row.id,
        name: row.name || undefined,
        root_issue_id: row.root_issue_id || undefined,
        issue_order: issueOrder,
        is_auto: row.is_auto === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      entries,
      health,
    };
  } catch {
    return null;
  }
}
