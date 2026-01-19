/**
 * Tests for Overlay Order Utilities
 *
 * Tests topological sorting for checkpoint overlays based on stream DAG lineage.
 */

import { describe, it, expect } from 'vitest';
import {
  getOverlayOrder,
  buildAncestryMap,
  areStreamsRelated,
  type CheckpointWithStream,
  type OverlayStream,
} from '../../../src/utils/overlay-order.js';
import type { Checkpoint } from '@sudocode-ai/types';

// Helper to create test checkpoints
function createCheckpoint(
  id: string,
  streamId: string,
  parentStream: string | null,
  checkpointedAt: string,
  createdAt: number
): CheckpointWithStream {
  return {
    checkpoint: {
      id,
      issue_id: 'i-test',
      execution_id: 'e-test',
      stream_id: streamId,
      commit_sha: `sha-${id}`,
      parent_commit: null,
      changed_files: 0,
      additions: 0,
      deletions: 0,
      message: `Checkpoint ${id}`,
      checkpointed_at: checkpointedAt,
      checkpointed_by: 'test',
      review_status: 'pending' as const,
    } as Checkpoint,
    stream: {
      id: streamId,
      parentStream,
      createdAt,
    },
    execution: {
      id: 'e-test',
      worktree_path: '/test/worktree',
      branch_name: 'test-branch',
    },
  };
}

describe('Overlay Order Utilities', () => {
  describe('getOverlayOrder', () => {
    it('should return empty array for empty input', () => {
      const result = getOverlayOrder([]);
      expect(result).toEqual([]);
    });

    it('should order checkpoints from single stream by checkpointed_at', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-3', 'stream-a', null, '2024-01-03T00:00:00Z', 1000),
        createCheckpoint('cp-1', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
        createCheckpoint('cp-2', 'stream-a', null, '2024-01-02T00:00:00Z', 1000),
      ];

      const result = getOverlayOrder(checkpoints);

      expect(result.map((c) => c.checkpoint.id)).toEqual(['cp-1', 'cp-2', 'cp-3']);
    });

    it('should order parent stream before child stream (linear chain)', () => {
      // Stream A -> Stream B -> Stream C
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-c', 'stream-c', 'stream-b', '2024-01-01T00:00:00Z', 3000),
        createCheckpoint('cp-b', 'stream-b', 'stream-a', '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];

      const result = getOverlayOrder(checkpoints);

      // Parent should come before children
      const ids = result.map((c) => c.checkpoint.id);
      expect(ids.indexOf('cp-a')).toBeLessThan(ids.indexOf('cp-b'));
      expect(ids.indexOf('cp-b')).toBeLessThan(ids.indexOf('cp-c'));
    });

    it('should order parent before multiple children (branches)', () => {
      // Stream A -> Stream B, Stream A -> Stream C
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-c', 'stream-c', 'stream-a', '2024-01-01T00:00:00Z', 3000),
        createCheckpoint('cp-b', 'stream-b', 'stream-a', '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];

      const result = getOverlayOrder(checkpoints);

      const ids = result.map((c) => c.checkpoint.id);
      // Parent should come before both children
      expect(ids.indexOf('cp-a')).toBeLessThan(ids.indexOf('cp-b'));
      expect(ids.indexOf('cp-a')).toBeLessThan(ids.indexOf('cp-c'));
    });

    it('should handle diamond DAG (merge scenario)', () => {
      // Stream A -> Stream B, Stream A -> Stream C, Stream B -> Stream D, Stream C -> Stream D
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-d', 'stream-d', 'stream-b', '2024-01-01T00:00:00Z', 4000),
        createCheckpoint('cp-c', 'stream-c', 'stream-a', '2024-01-01T00:00:00Z', 3000),
        createCheckpoint('cp-b', 'stream-b', 'stream-a', '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];

      const result = getOverlayOrder(checkpoints);

      const ids = result.map((c) => c.checkpoint.id);
      // A should be first
      expect(ids[0]).toBe('cp-a');
      // D should be last (depends on B which depends on A)
      expect(ids.indexOf('cp-a')).toBeLessThan(ids.indexOf('cp-b'));
      expect(ids.indexOf('cp-b')).toBeLessThan(ids.indexOf('cp-d'));
    });

    it('should order multiple checkpoints within same stream correctly', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-b2', 'stream-b', 'stream-a', '2024-01-03T00:00:00Z', 2000),
        createCheckpoint('cp-a1', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
        createCheckpoint('cp-b1', 'stream-b', 'stream-a', '2024-01-02T00:00:00Z', 2000),
        createCheckpoint('cp-a2', 'stream-a', null, '2024-01-02T00:00:00Z', 1000),
      ];

      const result = getOverlayOrder(checkpoints);

      const ids = result.map((c) => c.checkpoint.id);
      // Stream A checkpoints should come before Stream B checkpoints
      // Within each stream, older checkpoints come first
      expect(ids.indexOf('cp-a1')).toBeLessThan(ids.indexOf('cp-a2'));
      expect(ids.indexOf('cp-a2')).toBeLessThan(ids.indexOf('cp-b1'));
      expect(ids.indexOf('cp-b1')).toBeLessThan(ids.indexOf('cp-b2'));
    });

    it('should handle independent streams (no parent relationship)', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-b', 'stream-b', null, '2024-01-02T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];

      const result = getOverlayOrder(checkpoints);

      // Independent streams should be ordered by creation time
      const ids = result.map((c) => c.checkpoint.id);
      expect(ids.indexOf('cp-a')).toBeLessThan(ids.indexOf('cp-b'));
    });
  });

  describe('buildAncestryMap', () => {
    it('should return empty map for empty input', () => {
      const result = buildAncestryMap([]);
      expect(result.size).toBe(0);
    });

    it('should build ancestry for linear chain', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-c', 'stream-c', 'stream-b', '2024-01-01T00:00:00Z', 3000),
        createCheckpoint('cp-b', 'stream-b', 'stream-a', '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];

      const ancestryMap = buildAncestryMap(checkpoints);

      // Stream A has no ancestors
      expect(ancestryMap.get('stream-a')?.size).toBe(0);

      // Stream B has A as ancestor
      expect(ancestryMap.get('stream-b')?.has('stream-a')).toBe(true);

      // Stream C has both A and B as ancestors
      expect(ancestryMap.get('stream-c')?.has('stream-a')).toBe(true);
      expect(ancestryMap.get('stream-c')?.has('stream-b')).toBe(true);
    });

    it('should handle streams with no parents', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];

      const ancestryMap = buildAncestryMap(checkpoints);

      expect(ancestryMap.get('stream-a')).toBeDefined();
      expect(ancestryMap.get('stream-a')?.size).toBe(0);
    });
  });

  describe('areStreamsRelated', () => {
    it('should return true for same stream', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];
      const ancestryMap = buildAncestryMap(checkpoints);

      expect(areStreamsRelated('stream-a', 'stream-a', ancestryMap)).toBe(true);
    });

    it('should return true for parent-child relationship', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-b', 'stream-b', 'stream-a', '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];
      const ancestryMap = buildAncestryMap(checkpoints);

      // B is child of A, so they're related
      expect(areStreamsRelated('stream-a', 'stream-b', ancestryMap)).toBe(true);
      expect(areStreamsRelated('stream-b', 'stream-a', ancestryMap)).toBe(true);
    });

    it('should return true for grandparent-grandchild relationship', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-c', 'stream-c', 'stream-b', '2024-01-01T00:00:00Z', 3000),
        createCheckpoint('cp-b', 'stream-b', 'stream-a', '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];
      const ancestryMap = buildAncestryMap(checkpoints);

      expect(areStreamsRelated('stream-a', 'stream-c', ancestryMap)).toBe(true);
    });

    it('should return false for sibling streams', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-c', 'stream-c', 'stream-a', '2024-01-01T00:00:00Z', 3000),
        createCheckpoint('cp-b', 'stream-b', 'stream-a', '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];
      const ancestryMap = buildAncestryMap(checkpoints);

      // B and C are siblings (both children of A), not related to each other
      expect(areStreamsRelated('stream-b', 'stream-c', ancestryMap)).toBe(false);
    });

    it('should return false for completely independent streams', () => {
      const checkpoints: CheckpointWithStream[] = [
        createCheckpoint('cp-b', 'stream-b', null, '2024-01-01T00:00:00Z', 2000),
        createCheckpoint('cp-a', 'stream-a', null, '2024-01-01T00:00:00Z', 1000),
      ];
      const ancestryMap = buildAncestryMap(checkpoints);

      expect(areStreamsRelated('stream-a', 'stream-b', ancestryMap)).toBe(false);
    });
  });
});
