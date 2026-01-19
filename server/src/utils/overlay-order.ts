/**
 * Overlay Order Utilities
 *
 * Provides topological sorting for checkpoint overlays based on stream DAG lineage.
 * Used to determine the correct order to apply checkpoint snapshots so that
 * children override parents.
 *
 * @module utils/overlay-order
 */

import type { Checkpoint } from '@sudocode-ai/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream information needed for overlay ordering
 */
export interface OverlayStream {
  id: string;
  parentStream: string | null;
  createdAt: number;
}

/**
 * Checkpoint with associated stream and execution information
 */
export interface CheckpointWithStream {
  checkpoint: Checkpoint;
  stream: OverlayStream;
  execution: {
    id: string;
    worktree_path: string | null;
    branch_name: string | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Topological Sort Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the correct order to apply checkpoint overlays.
 *
 * Uses topological sort based on stream lineage (parent → child relationships).
 * Within the same stream, checkpoints are ordered by checkpoint time (oldest first).
 *
 * Algorithm:
 * 1. Build a graph of stream dependencies (child → parent edges)
 * 2. Perform topological sort using Kahn's algorithm
 * 3. Order checkpoints within each stream by checkpointed_at
 * 4. Return flattened list with parents before children
 *
 * @param checkpoints - Array of checkpoints with stream info
 * @returns Ordered checkpoints where parents come before children
 */
export function getOverlayOrder(
  checkpoints: CheckpointWithStream[]
): CheckpointWithStream[] {
  if (checkpoints.length === 0) {
    return [];
  }

  // Group checkpoints by stream
  const checkpointsByStream = new Map<string, CheckpointWithStream[]>();
  const streamMap = new Map<string, OverlayStream>();

  for (const cp of checkpoints) {
    const streamId = cp.stream.id;
    if (!checkpointsByStream.has(streamId)) {
      checkpointsByStream.set(streamId, []);
    }
    checkpointsByStream.get(streamId)!.push(cp);
    streamMap.set(streamId, cp.stream);
  }

  // Sort checkpoints within each stream by checkpointed_at (oldest first)
  for (const [, cps] of checkpointsByStream) {
    cps.sort((a, b) => {
      const timeA = new Date(a.checkpoint.checkpointed_at).getTime();
      const timeB = new Date(b.checkpoint.checkpointed_at).getTime();
      return timeA - timeB;
    });
  }

  // Get all unique stream IDs
  const streamIds = Array.from(checkpointsByStream.keys());

  // Build adjacency list for topological sort
  // Edge: parent → child (parent must come before child)
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const streamId of streamIds) {
    graph.set(streamId, []);
    inDegree.set(streamId, 0);
  }

  // Build edges based on parent relationships
  for (const streamId of streamIds) {
    const stream = streamMap.get(streamId)!;
    if (stream.parentStream && streamIds.includes(stream.parentStream)) {
      // Parent → child edge
      graph.get(stream.parentStream)!.push(streamId);
      inDegree.set(streamId, (inDegree.get(streamId) || 0) + 1);
    }
  }

  // Kahn's algorithm for topological sort
  const sortedStreamIds: string[] = [];
  const queue: string[] = [];

  // Start with streams that have no dependencies (root streams)
  for (const [streamId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(streamId);
    }
  }

  // Sort queue by stream creation time for deterministic ordering
  queue.sort((a, b) => {
    const streamA = streamMap.get(a)!;
    const streamB = streamMap.get(b)!;
    return streamA.createdAt - streamB.createdAt;
  });

  while (queue.length > 0) {
    // Pop from front (FIFO for level-order)
    const current = queue.shift()!;
    sortedStreamIds.push(current);

    // Process children
    const children = graph.get(current) || [];
    // Sort children by creation time for deterministic ordering
    children.sort((a, b) => {
      const streamA = streamMap.get(a)!;
      const streamB = streamMap.get(b)!;
      return streamA.createdAt - streamB.createdAt;
    });

    for (const child of children) {
      const newDegree = (inDegree.get(child) || 1) - 1;
      inDegree.set(child, newDegree);
      if (newDegree === 0) {
        queue.push(child);
      }
    }
  }

  // If we haven't processed all streams, there's a cycle (shouldn't happen in valid DAG)
  if (sortedStreamIds.length !== streamIds.length) {
    console.warn(
      '[getOverlayOrder] Cycle detected in stream DAG, falling back to creation time order'
    );
    // Fall back to simple creation time ordering
    sortedStreamIds.length = 0;
    sortedStreamIds.push(
      ...streamIds.sort((a, b) => {
        const streamA = streamMap.get(a)!;
        const streamB = streamMap.get(b)!;
        return streamA.createdAt - streamB.createdAt;
      })
    );
  }

  // Flatten: output checkpoints in topological stream order
  const result: CheckpointWithStream[] = [];
  for (const streamId of sortedStreamIds) {
    const cps = checkpointsByStream.get(streamId) || [];
    result.push(...cps);
  }

  return result;
}

/**
 * Build a map of stream ancestry for conflict detection.
 *
 * @param checkpoints - Checkpoints with stream info
 * @returns Map of streamId → Set of ancestor streamIds
 */
export function buildAncestryMap(
  checkpoints: CheckpointWithStream[]
): Map<string, Set<string>> {
  const streamMap = new Map<string, OverlayStream>();
  for (const cp of checkpoints) {
    streamMap.set(cp.stream.id, cp.stream);
  }

  const ancestryMap = new Map<string, Set<string>>();

  function getAncestors(streamId: string): Set<string> {
    if (ancestryMap.has(streamId)) {
      return ancestryMap.get(streamId)!;
    }

    const ancestors = new Set<string>();
    const stream = streamMap.get(streamId);

    if (stream?.parentStream) {
      ancestors.add(stream.parentStream);
      // Add parent's ancestors
      const parentAncestors = getAncestors(stream.parentStream);
      for (const ancestor of parentAncestors) {
        ancestors.add(ancestor);
      }
    }

    ancestryMap.set(streamId, ancestors);
    return ancestors;
  }

  // Compute ancestry for all streams
  for (const streamId of streamMap.keys()) {
    getAncestors(streamId);
  }

  return ancestryMap;
}

/**
 * Check if two streams are related (one is ancestor of the other).
 *
 * @param streamA - First stream ID
 * @param streamB - Second stream ID
 * @param ancestryMap - Precomputed ancestry map
 * @returns True if streams are related
 */
export function areStreamsRelated(
  streamA: string,
  streamB: string,
  ancestryMap: Map<string, Set<string>>
): boolean {
  const ancestorsA = ancestryMap.get(streamA) || new Set();
  const ancestorsB = ancestryMap.get(streamB) || new Set();

  return (
    streamA === streamB ||
    ancestorsA.has(streamB) ||
    ancestorsB.has(streamA)
  );
}
