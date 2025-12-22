/**
 * useExecutionEntityOperations Hook Tests
 *
 * Tests for the execution entity operations extraction hook
 */

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useExecutionEntityOperations } from '@/hooks/useExecutionEntityOperations'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'

describe('useExecutionEntityOperations', () => {
  describe('Basic functionality', () => {
    it('should return empty arrays when no tool calls provided', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toEqual([])
      expect(result.current.linked).toEqual([])
      expect(result.current.read).toEqual([])
      expect(result.current.listOperations).toEqual([])
    })

    it('should filter out non-MCP tool calls', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'SomeOtherTool',
        args: '{"foo": "bar"}',
        status: 'completed',
        startTime: Date.now(),
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toEqual([])
      expect(result.current.linked).toEqual([])
      expect(result.current.read).toEqual([])
      expect(result.current.listOperations).toEqual([])
    })
  })

  describe('Upsert operations', () => {
    it('should parse upsert_issue tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123", "title": "Test Issue"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toHaveLength(1)
      expect(result.current.updated[0]).toEqual({
        operationType: 'upsert',
        entityId: 'i-abc123',
        entityType: 'issue',
        timestamp: now,
        toolCallId: 'tc-1',
      })
    })

    it('should parse upsert_spec tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_spec',
        args: '{"spec_id": "s-xyz789", "title": "Test Spec"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toHaveLength(1)
      expect(result.current.updated[0]).toEqual({
        operationType: 'upsert',
        entityId: 's-xyz789',
        entityType: 'spec',
        timestamp: now,
        toolCallId: 'tc-1',
      })
    })

    it('should handle upsert without entity_id (creation)', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"title": "New Issue"}',
        status: 'completed',
        startTime: Date.now(),
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      // Should be skipped because no entity_id
      expect(result.current.updated).toEqual([])
    })
  })

  describe('Read operations', () => {
    it('should parse show_issue tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__show_issue',
        args: '{"issue_id": "i-abc123"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.read).toHaveLength(1)
      expect(result.current.read[0]).toEqual({
        operationType: 'read',
        entityId: 'i-abc123',
        entityType: 'issue',
        timestamp: now,
        toolCallId: 'tc-1',
      })
    })

    it('should parse show_spec tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__show_spec',
        args: '{"spec_id": "s-xyz789"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.read).toHaveLength(1)
      expect(result.current.read[0]).toEqual({
        operationType: 'read',
        entityId: 's-xyz789',
        entityType: 'spec',
        timestamp: now,
        toolCallId: 'tc-1',
      })
    })
  })

  describe('Link operations', () => {
    it('should parse link tool call with implements relationship', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__link',
        args: '{"from_id": "i-abc123", "to_id": "s-xyz789", "type": "implements"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.linked).toHaveLength(1)
      expect(result.current.linked[0]).toEqual({
        operationType: 'link',
        entityId: 'i-abc123',
        entityType: 'issue',
        timestamp: now,
        toolCallId: 'tc-1',
        linkTarget: {
          entityId: 's-xyz789',
          entityType: 'spec',
          relationshipType: 'implements',
        },
      })
    })

    it('should parse link tool call with blocks relationship', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__link',
        args: '{"from_id": "i-abc123", "to_id": "i-def456", "type": "blocks"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.linked).toHaveLength(1)
      expect(result.current.linked[0].linkTarget).toEqual({
        entityId: 'i-def456',
        entityType: 'issue',
        relationshipType: 'blocks',
      })
    })
  })

  describe('Feedback operations', () => {
    it('should parse add_feedback tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__add_feedback',
        args: '{"to_id": "s-xyz789", "issue_id": "i-abc123", "content": "Feedback content"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      // Feedback operations are currently not categorized (by design per the implementation)
      // They are parsed but not added to any category
      expect(result.current.updated).toEqual([])
      expect(result.current.linked).toEqual([])
      expect(result.current.read).toEqual([])
    })
  })

  describe('List operations', () => {
    it('should parse list_issues tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__list_issues',
        args: '{"status": "open"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.listOperations).toHaveLength(1)
      expect(result.current.listOperations[0]).toEqual({
        operationType: 'list',
        entityId: '',
        entityType: 'issue',
        timestamp: now,
        toolCallId: 'tc-1',
      })
    })

    it('should parse list_specs tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__list_specs',
        args: '{"search": "test"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.listOperations).toHaveLength(1)
      expect(result.current.listOperations[0]).toEqual({
        operationType: 'list',
        entityId: '',
        entityType: 'spec',
        timestamp: now,
        toolCallId: 'tc-1',
      })
    })
  })

  describe('Deduplication', () => {
    it('should deduplicate operations by entity ID, keeping latest timestamp', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()

      // Same entity updated twice
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123", "title": "First update"}',
        status: 'completed',
        startTime: now,
      })

      toolCalls.set('tc-2', {
        toolCallId: 'tc-2',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123", "title": "Second update"}',
        status: 'completed',
        startTime: now + 1000,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toHaveLength(1)
      expect(result.current.updated[0].toolCallId).toBe('tc-2')
      expect(result.current.updated[0].timestamp).toBe(now + 1000)
    })

    it('should keep separate operations for different entities', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()

      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123"}',
        status: 'completed',
        startTime: now,
      })

      toolCalls.set('tc-2', {
        toolCallId: 'tc-2',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-def456"}',
        status: 'completed',
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toHaveLength(2)
    })
  })

  describe('Error handling', () => {
    it('should handle malformed JSON gracefully', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: 'not valid json {',
        status: 'completed',
        startTime: Date.now(),
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      // Should skip malformed tool call
      expect(result.current.updated).toEqual([])
    })

    it('should handle missing required fields', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__show_issue',
        args: '{"title": "Missing issue_id"}',
        status: 'completed',
        startTime: Date.now(),
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      // Should skip tool call with missing entity_id
      expect(result.current.read).toEqual([])
    })

    it('should handle invalid entity ID format', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "invalid-id"}',
        status: 'completed',
        startTime: Date.now(),
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      // Should skip tool call with invalid entity_id format
      expect(result.current.updated).toEqual([])
    })
  })

  describe('In-progress tool calls', () => {
    it('should parse tool calls that are still executing', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123"}',
        status: 'executing', // Not completed yet
        startTime: now,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toHaveLength(1)
      expect(result.current.updated[0]).toEqual({
        operationType: 'upsert',
        entityId: 'i-abc123',
        entityType: 'issue',
        timestamp: now,
        toolCallId: 'tc-1',
      })
    })
  })

  describe('Mixed operations', () => {
    it('should categorize multiple different operations correctly', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      const now = Date.now()

      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123"}',
        status: 'completed',
        startTime: now,
      })

      toolCalls.set('tc-2', {
        toolCallId: 'tc-2',
        toolCallName: 'mcp__plugin_sudocode_sudocode__show_spec',
        args: '{"spec_id": "s-xyz789"}',
        status: 'completed',
        startTime: now + 100,
      })

      toolCalls.set('tc-3', {
        toolCallId: 'tc-3',
        toolCallName: 'mcp__plugin_sudocode_sudocode__link',
        args: '{"from_id": "i-abc123", "to_id": "s-xyz789", "type": "implements"}',
        status: 'completed',
        startTime: now + 200,
      })

      toolCalls.set('tc-4', {
        toolCallId: 'tc-4',
        toolCallName: 'mcp__plugin_sudocode_sudocode__list_issues',
        args: '{"status": "open"}',
        status: 'completed',
        startTime: now + 300,
      })

      const { result } = renderHook(() => useExecutionEntityOperations(toolCalls))

      expect(result.current.updated).toHaveLength(1)
      expect(result.current.read).toHaveLength(1)
      expect(result.current.linked).toHaveLength(1)
      expect(result.current.listOperations).toHaveLength(1)
    })
  })

  describe('Memoization', () => {
    it('should memoize results when tool calls do not change', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123"}',
        status: 'completed',
        startTime: Date.now(),
      })

      const { result, rerender } = renderHook(
        ({ toolCalls }) => useExecutionEntityOperations(toolCalls),
        { initialProps: { toolCalls } }
      )

      const firstResult = result.current

      // Rerender with same toolCalls
      rerender({ toolCalls })

      // Should return same reference (memoized)
      expect(result.current).toBe(firstResult)
    })

    it('should recompute when tool calls change', () => {
      const toolCalls1 = new Map<string, ToolCallTracking>()
      toolCalls1.set('tc-1', {
        toolCallId: 'tc-1',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_issue',
        args: '{"issue_id": "i-abc123"}',
        status: 'completed',
        startTime: Date.now(),
      })

      const { result, rerender } = renderHook(
        ({ toolCalls }) => useExecutionEntityOperations(toolCalls),
        { initialProps: { toolCalls: toolCalls1 } }
      )

      const firstResult = result.current

      // Update toolCalls
      const toolCalls2 = new Map<string, ToolCallTracking>()
      toolCalls2.set('tc-2', {
        toolCallId: 'tc-2',
        toolCallName: 'mcp__plugin_sudocode_sudocode__upsert_spec',
        args: '{"spec_id": "s-xyz789"}',
        status: 'completed',
        startTime: Date.now(),
      })

      rerender({ toolCalls: toolCalls2 })

      // Should return new reference (recomputed)
      expect(result.current).not.toBe(firstResult)
      expect(result.current.updated).toHaveLength(1)
      expect(result.current.updated[0].entityId).toBe('s-xyz789')
    })
  })
})
