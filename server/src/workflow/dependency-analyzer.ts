/**
 * Dependency Graph Analyzer for Workflow System
 *
 * Analyzes issue dependencies using blocks/depends-on relationships
 * to determine execution order and detect cycles.
 */

import type Database from "better-sqlite3";
import type { DependencyGraph } from "@sudocode-ai/types";
import { getOutgoingRelationships } from "@sudocode-ai/cli/dist/operations/relationships.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Internal graph representation for analysis
 */
interface InternalGraph {
  /** All issue IDs in the graph */
  issueIds: string[];
  /** Edges as [from, to] tuples (from blocks to) */
  edges: Array<[string, string]>;
  /** Adjacency list: issueId -> issues it blocks */
  adjacencyList: Map<string, string[]>;
  /** In-degree: issueId -> number of issues blocking it */
  inDegree: Map<string, number>;
}

/**
 * Result of topological sort
 */
interface TopologicalSortResult {
  /** Issue IDs in valid execution order */
  sorted: string[];
  /** Detected cycles, or null if none */
  cycles: string[][] | null;
  /** True if graph has no cycles */
  valid: boolean;
}

// =============================================================================
// Graph Building
// =============================================================================

/**
 * Build a dependency graph from issue relationships.
 *
 * Examines `blocks` and `depends-on` relationships between issues
 * to create an adjacency list representation.
 *
 * @param db - Database connection
 * @param issueIds - Issue IDs to include in the graph
 * @returns Internal graph representation
 */
export function buildDependencyGraph(
  db: Database.Database,
  issueIds: string[]
): InternalGraph {
  // Deduplicate and create a set for fast lookup
  const issueIdSet = new Set(issueIds);
  const uniqueIssueIds = Array.from(issueIdSet);

  // Initialize data structures
  const edges: Array<[string, string]> = [];
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize all nodes with empty adjacency and zero in-degree
  for (const id of uniqueIssueIds) {
    adjacencyList.set(id, []);
    inDegree.set(id, 0);
  }

  // Process each issue to find its relationships
  for (const issueId of uniqueIssueIds) {
    // Get outgoing "blocks" relationships: this issue blocks others
    // Edge direction: blocker -> blocked
    const blocksRels = getOutgoingRelationships(db, issueId, "issue", "blocks");
    for (const rel of blocksRels) {
      // Only include edges where both ends are in our issue set
      if (issueIdSet.has(rel.to_id)) {
        edges.push([issueId, rel.to_id]);
        adjacencyList.get(issueId)!.push(rel.to_id);
        inDegree.set(rel.to_id, (inDegree.get(rel.to_id) ?? 0) + 1);
      }
    }

    // Get incoming "depends-on" relationships: this issue depends on others
    // If A depends-on B, then B blocks A, so edge is B -> A
    const dependsOnRels = getOutgoingRelationships(
      db,
      issueId,
      "issue",
      "depends-on"
    );
    for (const rel of dependsOnRels) {
      // rel.to_id is what this issue depends on (the blocker)
      // Edge direction: blocker (rel.to_id) -> blocked (issueId)
      if (issueIdSet.has(rel.to_id)) {
        // Avoid duplicate edges
        const existingEdges = adjacencyList.get(rel.to_id) ?? [];
        if (!existingEdges.includes(issueId)) {
          edges.push([rel.to_id, issueId]);
          adjacencyList.get(rel.to_id)!.push(issueId);
          inDegree.set(issueId, (inDegree.get(issueId) ?? 0) + 1);
        }
      }
    }
  }

  return {
    issueIds: uniqueIssueIds,
    edges,
    adjacencyList,
    inDegree,
  };
}

// =============================================================================
// Topological Sort (Kahn's Algorithm)
// =============================================================================

/**
 * Perform topological sort using Kahn's algorithm.
 *
 * Returns issues in a valid execution order where all dependencies
 * come before dependents. Detects cycles if present.
 *
 * @param adjacencyList - Map of issueId -> issues it blocks
 * @param inDegree - Map of issueId -> number of blockers
 * @returns Sorted order and cycle information
 */
export function topologicalSort(
  adjacencyList: Map<string, string[]>,
  inDegree: Map<string, number>
): TopologicalSortResult {
  const sorted: string[] = [];

  // Create a working copy of in-degrees (we'll modify this)
  const workingInDegree = new Map(inDegree);

  // Initialize queue with all nodes having in-degree 0 (no blockers)
  const queue: string[] = [];
  for (const [id, degree] of workingInDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  // Process nodes in topological order
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    // For each issue that this one blocks, decrement their in-degree
    const neighbors = adjacencyList.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (workingInDegree.get(neighbor) ?? 0) - 1;
      workingInDegree.set(neighbor, newDegree);

      // If neighbor now has no blockers, it's ready to process
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Check if we processed all nodes
  const totalNodes = adjacencyList.size;
  if (sorted.length === totalNodes) {
    return { sorted, cycles: null, valid: true };
  }

  // Cycles exist - find them
  const cycles = findCycles(adjacencyList, workingInDegree);
  return { sorted, cycles, valid: false };
}

// =============================================================================
// Cycle Detection
// =============================================================================

/**
 * Find all cycles in the graph using DFS.
 *
 * Called when topological sort fails to process all nodes,
 * indicating cycles exist.
 *
 * @param adjacencyList - Map of issueId -> issues it blocks
 * @param remainingInDegree - In-degrees after partial topo sort
 * @returns Array of cycles, each cycle is an array of issue IDs
 */
function findCycles(
  adjacencyList: Map<string, string[]>,
  remainingInDegree: Map<string, number>
): string[][] {
  const cycles: string[][] = [];

  // Nodes still in cycles have remaining in-degree > 0
  const nodesInCycles = new Set<string>();
  for (const [id, degree] of remainingInDegree) {
    if (degree > 0) {
      nodesInCycles.add(id);
    }
  }

  if (nodesInCycles.size === 0) {
    return cycles;
  }

  // Use DFS to find individual cycles
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (recursionStack.has(node)) {
      // Found a cycle - extract it from the path
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        cycle.push(node); // Complete the cycle
        cycles.push(cycle);
      }
      return;
    }

    if (visited.has(node) || !nodesInCycles.has(node)) {
      return;
    }

    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = adjacencyList.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (nodesInCycles.has(neighbor)) {
        dfs(neighbor);
      }
    }

    path.pop();
    recursionStack.delete(node);
  }

  // Start DFS from each unvisited node in cycles
  for (const node of nodesInCycles) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

// =============================================================================
// Parallel Groups
// =============================================================================

/**
 * Group issues by topological level for parallel execution.
 *
 * Issues at the same level have no dependencies between them
 * and can be executed concurrently.
 *
 * @param sortedIds - Issue IDs in topological order
 * @param adjacencyList - Map of issueId -> issues it blocks
 * @param inDegree - Original in-degrees
 * @returns Array of groups, each group can run in parallel
 */
export function findParallelGroups(
  sortedIds: string[],
  adjacencyList: Map<string, string[]>,
  inDegree: Map<string, number>
): string[][] {
  if (sortedIds.length === 0) {
    return [];
  }

  const groups: string[][] = [];

  // Track the level (distance from root) for each node
  const level = new Map<string, number>();

  // Nodes with in-degree 0 are at level 0
  for (const id of sortedIds) {
    if ((inDegree.get(id) ?? 0) === 0) {
      level.set(id, 0);
    }
  }

  // Process in topological order to compute levels
  for (const id of sortedIds) {
    const currentLevel = level.get(id) ?? 0;

    // Update levels of nodes this one blocks
    const neighbors = adjacencyList.get(id) ?? [];
    for (const neighbor of neighbors) {
      const neighborLevel = level.get(neighbor) ?? 0;
      // Neighbor's level is at least current + 1
      level.set(neighbor, Math.max(neighborLevel, currentLevel + 1));
    }
  }

  // Group nodes by level
  const maxLevel = Math.max(...Array.from(level.values()), 0);
  for (let l = 0; l <= maxLevel; l++) {
    const group: string[] = [];
    for (const id of sortedIds) {
      if (level.get(id) === l) {
        group.push(id);
      }
    }
    if (group.length > 0) {
      groups.push(group);
    }
  }

  return groups;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Analyze dependencies between issues and return a complete dependency graph.
 *
 * This is the main entry point for workflow dependency analysis.
 *
 * @param db - Database connection
 * @param issueIds - Issue IDs to analyze
 * @returns Complete dependency graph with topological order and parallel groups
 */
export function analyzeDependencies(
  db: Database.Database,
  issueIds: string[]
): DependencyGraph {
  // Build the graph
  const graph = buildDependencyGraph(db, issueIds);

  // Perform topological sort
  const sortResult = topologicalSort(graph.adjacencyList, graph.inDegree);

  // Compute parallel groups (only if no cycles)
  const parallelGroups = sortResult.valid
    ? findParallelGroups(
        sortResult.sorted,
        graph.adjacencyList,
        graph.inDegree
      )
    : [];

  return {
    issueIds: graph.issueIds,
    edges: graph.edges,
    topologicalOrder: sortResult.sorted,
    cycles: sortResult.cycles,
    parallelGroups,
  };
}
