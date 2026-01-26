/**
 * Tests for checkpoint types and utilities
 */

import { describe, it, expect } from 'vitest'
import {
  REVIEW_STATUS_STYLES,
  REVIEW_STATUS_LABELS,
  STREAM_COLORS,
  getStreamColor,
  type DiffStackReviewStatus,
  type DataplaneCheckpoint,
  type DiffStack,
  type CheckpointInStack,
  type CheckpointStats,
  type CheckpointNodeData,
} from '@/types/checkpoint'

describe('checkpoint types', () => {
  describe('REVIEW_STATUS_STYLES', () => {
    it('has styles for all review statuses', () => {
      const statuses: DiffStackReviewStatus[] = ['pending', 'approved', 'rejected', 'merged', 'abandoned']

      for (const status of statuses) {
        expect(REVIEW_STATUS_STYLES[status]).toBeDefined()
        expect(REVIEW_STATUS_STYLES[status].border).toBeDefined()
        expect(REVIEW_STATUS_STYLES[status].background).toBeDefined()
        expect(REVIEW_STATUS_STYLES[status].text).toBeDefined()
      }
    })

    it('has correct Tailwind classes for pending status', () => {
      expect(REVIEW_STATUS_STYLES.pending.border).toBe('border-muted')
      expect(REVIEW_STATUS_STYLES.pending.background).toBe('bg-muted/20')
      expect(REVIEW_STATUS_STYLES.pending.text).toBe('text-muted-foreground')
    })

    it('has correct Tailwind classes for approved status', () => {
      expect(REVIEW_STATUS_STYLES.approved.border).toBe('border-green-500')
      expect(REVIEW_STATUS_STYLES.approved.background).toBe('bg-green-500/10')
      expect(REVIEW_STATUS_STYLES.approved.text).toContain('green')
    })

    it('has correct Tailwind classes for rejected status', () => {
      expect(REVIEW_STATUS_STYLES.rejected.border).toBe('border-destructive')
      expect(REVIEW_STATUS_STYLES.rejected.background).toBe('bg-destructive/10')
      expect(REVIEW_STATUS_STYLES.rejected.text).toBe('text-destructive')
    })

    it('has correct Tailwind classes for merged status', () => {
      expect(REVIEW_STATUS_STYLES.merged.border).toBe('border-purple-500')
      expect(REVIEW_STATUS_STYLES.merged.background).toBe('bg-purple-500/10')
      expect(REVIEW_STATUS_STYLES.merged.text).toContain('purple')
    })

    it('has correct Tailwind classes for abandoned status', () => {
      expect(REVIEW_STATUS_STYLES.abandoned.text).toContain('line-through')
    })
  })

  describe('REVIEW_STATUS_LABELS', () => {
    it('has labels for all review statuses', () => {
      const statuses: DiffStackReviewStatus[] = ['pending', 'approved', 'rejected', 'merged', 'abandoned']

      for (const status of statuses) {
        expect(REVIEW_STATUS_LABELS[status]).toBeDefined()
        expect(typeof REVIEW_STATUS_LABELS[status]).toBe('string')
      }
    })

    it('has correct labels', () => {
      expect(REVIEW_STATUS_LABELS.pending).toBe('Pending')
      expect(REVIEW_STATUS_LABELS.approved).toBe('Approved')
      expect(REVIEW_STATUS_LABELS.rejected).toBe('Rejected')
      expect(REVIEW_STATUS_LABELS.merged).toBe('Merged')
      expect(REVIEW_STATUS_LABELS.abandoned).toBe('Abandoned')
    })
  })

  describe('STREAM_COLORS', () => {
    it('has multiple colors', () => {
      expect(STREAM_COLORS.length).toBeGreaterThan(0)
      expect(STREAM_COLORS.length).toBe(8)
    })

    it('contains valid hex colors', () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/
      for (const color of STREAM_COLORS) {
        expect(color).toMatch(hexRegex)
      }
    })
  })

  describe('getStreamColor', () => {
    it('returns consistent color for same stream ID', () => {
      const streamIds = ['stream-1', 'stream-2', 'stream-3']
      const color1 = getStreamColor('stream-1', streamIds)
      const color2 = getStreamColor('stream-1', streamIds)
      expect(color1).toBe(color2)
    })

    it('returns different colors for different stream IDs', () => {
      const streamIds = ['stream-1', 'stream-2', 'stream-3']
      const color1 = getStreamColor('stream-1', streamIds)
      const color2 = getStreamColor('stream-2', streamIds)
      expect(color1).not.toBe(color2)
    })

    it('wraps around colors when more streams than colors', () => {
      const manyStreamIds = Array.from({ length: 20 }, (_, i) => `stream-${i}`)
      const color0 = getStreamColor('stream-0', manyStreamIds)
      const color8 = getStreamColor('stream-8', manyStreamIds)
      // These should be the same since we have 8 colors and stream-8 wraps to index 0
      expect(color0).toBe(color8)
    })

    it('returns undefined for stream not in list', () => {
      const streamIds = ['stream-1', 'stream-2']
      const color = getStreamColor('unknown', streamIds)
      // -1 % 8 = -1, and array[-1] in JS is undefined
      // This documents the current behavior - caller should handle undefined
      expect(color).toBeUndefined()
    })
  })

  describe('Type structures', () => {
    it('DataplaneCheckpoint has required fields', () => {
      const checkpoint: DataplaneCheckpoint = {
        id: 'cp-123',
        streamId: 'stream-1',
        commitSha: 'abc123def456',
        parentCommit: 'parent123',
        originalCommit: null,
        changeId: 'change-1',
        message: 'Test commit message',
        createdAt: Date.now(),
        createdBy: 'user-1',
      }

      expect(checkpoint.id).toBeDefined()
      expect(checkpoint.streamId).toBeDefined()
      expect(checkpoint.commitSha).toBeDefined()
    })

    it('DiffStack has required fields', () => {
      const stack: DiffStack = {
        id: 'stack-123',
        name: 'Test Stack',
        description: 'A test stack',
        targetBranch: 'main',
        reviewStatus: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        queuePosition: null,
        createdAt: Date.now(),
        createdBy: 'user-1',
      }

      expect(stack.id).toBeDefined()
      expect(stack.targetBranch).toBeDefined()
      expect(stack.reviewStatus).toBeDefined()
    })

    it('CheckpointInStack has required fields', () => {
      const entry: CheckpointInStack = {
        checkpointId: 'cp-123',
        position: 0,
        checkpoint: {
          id: 'cp-123',
          streamId: 'stream-1',
          commitSha: 'abc123',
          parentCommit: null,
          originalCommit: null,
          changeId: null,
          message: 'Test',
          createdAt: Date.now(),
          createdBy: null,
        },
      }

      expect(entry.checkpointId).toBeDefined()
      expect(entry.position).toBeDefined()
    })

    it('CheckpointStats has required fields', () => {
      const stats: CheckpointStats = {
        filesChanged: 5,
        additions: 100,
        deletions: 50,
      }

      expect(stats.filesChanged).toBe(5)
      expect(stats.additions).toBe(100)
      expect(stats.deletions).toBe(50)
    })

    it('CheckpointNodeData has required fields', () => {
      const nodeData: CheckpointNodeData = {
        checkpoint: {
          id: 'cp-123',
          streamId: 'stream-1',
          commitSha: 'abc123',
          parentCommit: null,
          originalCommit: null,
          changeId: null,
          message: 'Test',
          createdAt: Date.now(),
          createdBy: null,
        },
        isSelected: false,
        inStack: false,
        merged: false,
      }

      expect(nodeData.checkpoint).toBeDefined()
      expect(nodeData.isSelected).toBe(false)
      expect(nodeData.inStack).toBe(false)
      expect(nodeData.merged).toBe(false)
    })
  })
})
