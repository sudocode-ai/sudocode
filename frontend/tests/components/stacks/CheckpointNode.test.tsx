/**
 * Tests for CheckpointNode component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { CheckpointNode } from '@/components/stacks/CheckpointNode'
import type { CheckpointNodeData, DataplaneCheckpoint } from '@/types/checkpoint'

// Mock @xyflow/react Handle component
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    Handle: ({ type, position }: { type: string; position: string }) => (
      <div data-testid={`handle-${type}-${position}`} />
    ),
  }
})

// Helper to create test checkpoint
const createCheckpoint = (overrides: Partial<DataplaneCheckpoint> = {}): DataplaneCheckpoint => ({
  id: 'cp-123',
  streamId: 'stream-1',
  commitSha: 'abc1234567890',
  parentCommit: null,
  originalCommit: null,
  changeId: 'change-1',
  message: 'Test commit message',
  createdAt: Date.now(),
  createdBy: 'user-1',
  ...overrides,
})

// Helper to create node data
const createNodeData = (overrides: Partial<CheckpointNodeData> = {}): CheckpointNodeData => ({
  checkpoint: createCheckpoint(),
  isSelected: false,
  inStack: false,
  merged: false,
  ...overrides,
})

// Helper to render CheckpointNode with required props
const renderNode = (data: CheckpointNodeData, selected = false) => {
  return render(
    <ReactFlowProvider>
      <CheckpointNode
        id="test-node"
        data={data as unknown as Record<string, unknown>}
        selected={selected}
        type="checkpoint"
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={0}
        draggable={true}
        selectable={true}
        dragging={false}
        deletable={false}
      />
    </ReactFlowProvider>
  )
}

describe('CheckpointNode', () => {
  describe('Rendering', () => {
    it('renders checkpoint SHA', () => {
      const data = createNodeData()
      renderNode(data)

      // Short SHA (first 7 chars)
      expect(screen.getByText('abc1234')).toBeInTheDocument()
    })

    it('renders commit message', () => {
      const data = createNodeData()
      renderNode(data)

      expect(screen.getByText('Test commit message')).toBeInTheDocument()
    })

    it('truncates long commit messages', () => {
      const longMessage = 'A'.repeat(50)
      const data = createNodeData({
        checkpoint: createCheckpoint({ message: longMessage }),
      })
      renderNode(data)

      // Message should be truncated to 40 chars + ...
      expect(screen.getByText(`${'A'.repeat(40)}...`)).toBeInTheDocument()
    })

    it('shows "No message" for empty message', () => {
      const data = createNodeData({
        checkpoint: createCheckpoint({ message: null }),
      })
      renderNode(data)

      expect(screen.getByText('No message')).toBeInTheDocument()
    })

    it('renders handles for connections', () => {
      const data = createNodeData()
      renderNode(data)

      expect(screen.getByTestId('handle-target-top')).toBeInTheDocument()
      expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument()
    })
  })

  describe('Status Badges', () => {
    it('shows "Unstacked" badge when not in stack', () => {
      const data = createNodeData({ inStack: false, merged: false })
      renderNode(data)

      expect(screen.getByText('Unstacked')).toBeInTheDocument()
    })

    it('shows "In Stack" badge when in stack', () => {
      const data = createNodeData({ inStack: true, merged: false })
      renderNode(data)

      expect(screen.getByText('In Stack')).toBeInTheDocument()
    })

    it('shows "Merged" badge when merged', () => {
      const data = createNodeData({ inStack: true, merged: true })
      renderNode(data)

      expect(screen.getByText('Merged')).toBeInTheDocument()
    })

    it('prioritizes merged badge over in stack badge', () => {
      const data = createNodeData({ inStack: true, merged: true })
      renderNode(data)

      expect(screen.getByText('Merged')).toBeInTheDocument()
      expect(screen.queryByText('In Stack')).not.toBeInTheDocument()
    })
  })

  describe('Selection State', () => {
    it('applies selection styles when selected', () => {
      const data = createNodeData({ isSelected: true })
      const { container } = renderNode(data, true)

      // Check for selection ring class
      const nodeContent = container.querySelector('.ring-2')
      expect(nodeContent).toBeInTheDocument()
    })

    it('does not apply selection styles when not selected', () => {
      const data = createNodeData({ isSelected: false })
      const { container } = renderNode(data, false)

      // Should not have selection ring
      const nodeContent = container.querySelector('.ring-2')
      expect(nodeContent).not.toBeInTheDocument()
    })
  })

  describe('Merged State', () => {
    it('applies opacity when merged', () => {
      const data = createNodeData({ merged: true })
      const { container } = renderNode(data)

      // Check for opacity class
      const nodeContent = container.querySelector('.opacity-60')
      expect(nodeContent).toBeInTheDocument()
    })

    it('applies strikethrough to message when merged', () => {
      const data = createNodeData({ merged: true })
      const { container } = renderNode(data)

      // Check for line-through class
      const messageElement = container.querySelector('.line-through')
      expect(messageElement).toBeInTheDocument()
    })
  })

  describe('Click Handling', () => {
    it('calls onSelect when clicked', () => {
      const onSelect = vi.fn()
      const data = createNodeData({ onSelect })
      const { container } = renderNode(data)

      const clickableArea = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(clickableArea!)

      expect(onSelect).toHaveBeenCalledWith('cp-123', false)
    })

    it('passes multiSelect flag when Cmd/Ctrl is held', () => {
      const onSelect = vi.fn()
      const data = createNodeData({ onSelect })
      const { container } = renderNode(data)

      const clickableArea = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(clickableArea!, { metaKey: true })

      expect(onSelect).toHaveBeenCalledWith('cp-123', true)
    })

    it('passes multiSelect flag when Ctrl is held', () => {
      const onSelect = vi.fn()
      const data = createNodeData({ onSelect })
      const { container } = renderNode(data)

      const clickableArea = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(clickableArea!, { ctrlKey: true })

      expect(onSelect).toHaveBeenCalledWith('cp-123', true)
    })

    it('does not crash when onSelect is not provided', () => {
      const data = createNodeData({ onSelect: undefined })
      const { container } = renderNode(data)

      const clickableArea = container.querySelector('[class*="cursor-pointer"]')
      expect(() => fireEvent.click(clickableArea!)).not.toThrow()
    })
  })

  describe('Stats Display', () => {
    it('renders stats when provided', () => {
      const data = createNodeData({
        stats: {
          filesChanged: 5,
          additions: 100,
          deletions: 50,
        },
      })
      renderNode(data)

      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('50')).toBeInTheDocument()
    })

    it('shows zero values when stats are zero', () => {
      const data = createNodeData({
        stats: {
          filesChanged: 0,
          additions: 0,
          deletions: 0,
        },
      })
      renderNode(data)

      // Should show zeros
      const zeros = screen.getAllByText('0')
      expect(zeros.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Stream Display', () => {
    it('renders stream name when stream is provided', () => {
      const data = createNodeData({
        stream: {
          id: 'stream-1',
          name: 'feature-branch',
          agentId: 'agent-1',
          baseCommit: 'base123',
          parentStream: null,
          branchPointCommit: null,
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      })
      renderNode(data)

      expect(screen.getByText('feature-branch')).toBeInTheDocument()
    })

    it('does not render stream section when stream is not provided', () => {
      const data = createNodeData({ stream: undefined })
      renderNode(data)

      expect(screen.queryByText('feature-branch')).not.toBeInTheDocument()
    })
  })

  describe('Time Display', () => {
    it('renders relative time', () => {
      // Create a checkpoint from 5 minutes ago
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      const data = createNodeData({
        checkpoint: createCheckpoint({ createdAt: fiveMinutesAgo }),
      })
      renderNode(data)

      expect(screen.getByText('5m ago')).toBeInTheDocument()
    })

    it('shows "just now" for very recent checkpoints', () => {
      const data = createNodeData({
        checkpoint: createCheckpoint({ createdAt: Date.now() }),
      })
      renderNode(data)

      expect(screen.getByText('just now')).toBeInTheDocument()
    })
  })
})
