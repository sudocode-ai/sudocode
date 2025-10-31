/**
 * ToolCallViewer Component Tests
 *
 * Tests for the tool call viewer component
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolCallViewer } from '@/components/executions/ToolCallViewer'
import type { ToolCallTracking } from '@/hooks/useAgUiStream'

describe('ToolCallViewer', () => {
  describe('Empty State', () => {
    it('should return null when no tool calls', () => {
      const toolCalls = new Map<string, ToolCallTracking>()

      const { container } = render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Tool Call Display', () => {
    it('should display completed tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '{"file": "test.ts"}',
        status: 'completed',
        result: 'File contents here',
        startTime: 1000,
        endTime: 2000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.getByText('completed')).toBeInTheDocument()
      expect(screen.getByText('1.00s')).toBeInTheDocument()
    })

    it('should display executing tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Write',
        args: '{"file": "output.ts"}',
        status: 'executing',
        startTime: Date.now(),
      })

      const { container } = render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.getByText('Write')).toBeInTheDocument()
      expect(screen.getByText('executing')).toBeInTheDocument()
      // Check for spinner by looking for animate-spin class
      const spinners = container.querySelectorAll('.animate-spin')
      expect(spinners.length).toBeGreaterThan(0)
    })

    it('should display error tool call', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Edit',
        args: '{"file": "test.ts"}',
        status: 'error',
        error: 'File not found',
        startTime: 1000,
        endTime: 2000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('error')).toBeInTheDocument()
      expect(screen.getByText('File not found')).toBeInTheDocument()
    })

    it('should display multiple tool calls', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'completed',
        startTime: 1000,
        endTime: 2000,
      })
      toolCalls.set('tool-2', {
        toolCallId: 'tool-2',
        toolCallName: 'Write',
        args: '',
        status: 'executing',
        startTime: 2000,
      })
      toolCalls.set('tool-3', {
        toolCallId: 'tool-3',
        toolCallName: 'Edit',
        args: '',
        status: 'error',
        error: 'Test error',
        startTime: 3000,
        endTime: 4000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.getByText('Write')).toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })
  })

  describe('Arguments Display', () => {
    it('should display arguments in collapsible details', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '{"file": "test.ts", "encoding": "utf8"}',
        status: 'completed',
        startTime: 1000,
        endTime: 2000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.getByText('Arguments')).toBeInTheDocument()
      expect(screen.getByText('{"file": "test.ts", "encoding": "utf8"}')).toBeInTheDocument()
    })

    it('should not display arguments section when args is empty', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'completed',
        startTime: 1000,
        endTime: 2000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.queryByText('Arguments')).not.toBeInTheDocument()
    })
  })

  describe('Result Display', () => {
    it('should display result in collapsible details', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'completed',
        result: 'export function test() { return true }',
        startTime: 1000,
        endTime: 2000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.getByText('Result')).toBeInTheDocument()
      expect(screen.getByText('export function test() { return true }')).toBeInTheDocument()
    })

    it('should not display result section when result is empty', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'executing',
        startTime: 1000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.queryByText('Result')).not.toBeInTheDocument()
    })
  })

  describe('Error Display', () => {
    it('should display error message', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Write',
        args: '',
        status: 'error',
        error: 'Permission denied: cannot write to file',
        startTime: 1000,
        endTime: 2000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.getByText('Error:')).toBeInTheDocument()
      expect(screen.getByText('Permission denied: cannot write to file')).toBeInTheDocument()
    })

    it('should not display error section when no error', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'completed',
        startTime: 1000,
        endTime: 2000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      expect(screen.queryByText('Error:')).not.toBeInTheDocument()
    })
  })

  describe('Duration Display', () => {
    it('should display duration when both start and end times are present', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'completed',
        startTime: 1000,
        endTime: 3500,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      // 3500 - 1000 = 2500ms = 2.50s
      expect(screen.getByText('2.50s')).toBeInTheDocument()
    })

    it('should not display duration when end time is missing', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'executing',
        startTime: 1000,
      })

      render(<ToolCallViewer toolCalls={toolCalls} />)

      // Should not have any duration text
      expect(screen.queryByText(/\d+\.\d+s/)).not.toBeInTheDocument()
    })
  })

  describe('Custom Class Name', () => {
    it('should apply custom class name', () => {
      const toolCalls = new Map<string, ToolCallTracking>()
      toolCalls.set('tool-1', {
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        args: '',
        status: 'completed',
        startTime: 1000,
        endTime: 2000,
      })

      const { container } = render(
        <ToolCallViewer toolCalls={toolCalls} className="custom-class" />
      )

      const rootElement = container.querySelector('.custom-class')
      expect(rootElement).toBeInTheDocument()
    })
  })
})
