/**
 * ProgressIndicator Component Tests
 *
 * Tests for the progress indicator component
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressIndicator } from '@/components/executions/ProgressIndicator'
import type { State } from '@ag-ui/core'

describe('ProgressIndicator', () => {
  describe('Progress Bar', () => {
    it('should display progress bar when state has progress and totalSteps', () => {
      const state: State = {
        progress: 50,
        totalSteps: 100,
      }

      render(<ProgressIndicator state={state} />)

      expect(screen.getByText('Progress')).toBeInTheDocument()
      expect(screen.getByText('50 / 100')).toBeInTheDocument()
    })

    it('should calculate progress bar width correctly', () => {
      const state: State = {
        progress: 30,
        totalSteps: 100,
      }

      const { container } = render(<ProgressIndicator state={state} />)

      const progressBar = container.querySelector('.bg-primary')
      expect(progressBar).toBeInTheDocument()
      expect(progressBar?.getAttribute('style')).toContain('width: 30%')
    })

    it('should handle 100% progress', () => {
      const state: State = {
        progress: 100,
        totalSteps: 100,
      }

      const { container } = render(<ProgressIndicator state={state} />)

      const progressBar = container.querySelector('.bg-primary')
      expect(progressBar?.getAttribute('style')).toContain('width: 100%')
    })

    it('should not exceed 100% width even if progress > totalSteps', () => {
      const state: State = {
        progress: 150,
        totalSteps: 100,
      }

      const { container } = render(<ProgressIndicator state={state} />)

      const progressBar = container.querySelector('.bg-primary')
      // Should be clamped to 100%
      expect(progressBar?.getAttribute('style')).toContain('width: 100%')
    })

    it('should not display progress bar when progress is undefined', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} />)

      expect(screen.queryByText('Progress')).not.toBeInTheDocument()
    })

    it('should not display progress bar when totalSteps is undefined', () => {
      const state: State = {
        progress: 50,
      }

      render(<ProgressIndicator state={state} />)

      expect(screen.queryByText('Progress')).not.toBeInTheDocument()
    })
  })

  describe('Tool Calls Metrics', () => {
    it('should display tool call count', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} toolCallCount={5} />)

      expect(screen.getByText('Tool Calls')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('should display completed tool calls', () => {
      const state: State = {}

      render(
        <ProgressIndicator state={state} toolCallCount={10} completedToolCalls={7} />
      )

      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('7 completed')).toBeInTheDocument()
    })

    it('should not display completed count when zero', () => {
      const state: State = {}

      render(
        <ProgressIndicator state={state} toolCallCount={5} completedToolCalls={0} />
      )

      expect(screen.queryByText('completed')).not.toBeInTheDocument()
    })
  })

  describe('Message Count', () => {
    it('should display message count', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} messageCount={3} />)

      expect(screen.getByText('Messages')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })
  })

  describe('State Metrics', () => {
    it('should display files changed from state', () => {
      const state: State = {
        filesChanged: 12,
      }

      render(<ProgressIndicator state={state} />)

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
      expect(screen.getByText('12')).toBeInTheDocument()
    })

    it('should display token usage from state', () => {
      const state: State = {
        tokenUsage: 1500,
      }

      render(<ProgressIndicator state={state} />)

      expect(screen.getByText('Tokens')).toBeInTheDocument()
      expect(screen.getByText('1,500')).toBeInTheDocument()
    })

    it('should display cost from state', () => {
      const state: State = {
        cost: 0.0234,
      }

      render(<ProgressIndicator state={state} />)

      expect(screen.getByText('Cost')).toBeInTheDocument()
      expect(screen.getByText('$0.0234')).toBeInTheDocument()
    })

    it('should display cost with 4 decimal places', () => {
      const state: State = {
        cost: 1.23456789,
      }

      render(<ProgressIndicator state={state} />)

      expect(screen.getByText('$1.2346')).toBeInTheDocument()
    })
  })

  describe('Duration Display', () => {
    it('should display duration when start and end times provided', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} startTime={1000} endTime={3500} />)

      expect(screen.getByText('Duration')).toBeInTheDocument()
      // 3500 - 1000 = 2500ms = 2.50s
      expect(screen.getByText('2.50s')).toBeInTheDocument()
    })

    it('should not display duration when only start time provided', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} startTime={1000} />)

      expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    })

    it('should not display duration when only end time provided', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} endTime={3500} />)

      expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    })
  })

  describe('All Metrics View', () => {
    it('should display expandable view with all state metrics', () => {
      const state: State = {
        progress: 50,
        totalSteps: 100,
        filesChanged: 5,
        tokenUsage: 1000,
        cost: 0.01,
      }

      render(<ProgressIndicator state={state} />)

      expect(screen.getByText('View all metrics')).toBeInTheDocument()
    })

    it('should render state as JSON in details', () => {
      const state: State = {
        progress: 50,
        totalSteps: 100,
        customField: 'test',
      }

      const { container } = render(<ProgressIndicator state={state} />)

      const pre = container.querySelector('details pre')
      expect(pre).toBeInTheDocument()
      expect(pre?.textContent).toContain('"progress": 50')
      expect(pre?.textContent).toContain('"totalSteps": 100')
      expect(pre?.textContent).toContain('"customField": "test"')
    })

    it('should not display expandable view when state is empty', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} />)

      // Should not display expandable view when state has no keys
      expect(screen.queryByText('View all metrics')).not.toBeInTheDocument()
    })
  })

  describe('Comprehensive Display', () => {
    it('should display all metrics together', () => {
      const state: State = {
        progress: 75,
        totalSteps: 100,
        filesChanged: 8,
        tokenUsage: 2500,
        cost: 0.05,
      }

      render(
        <ProgressIndicator
          state={state}
          toolCallCount={15}
          completedToolCalls={12}
          messageCount={5}
          startTime={1000}
          endTime={6000}
        />
      )

      // Progress
      expect(screen.getByText('75 / 100')).toBeInTheDocument()

      // Tool calls
      expect(screen.getByText('15')).toBeInTheDocument()
      expect(screen.getByText('12 completed')).toBeInTheDocument()

      // Messages
      expect(screen.getByText('5')).toBeInTheDocument()

      // Files changed
      expect(screen.getByText('8')).toBeInTheDocument()

      // Tokens
      expect(screen.getByText('2,500')).toBeInTheDocument()

      // Cost
      expect(screen.getByText('$0.0500')).toBeInTheDocument()

      // Duration (6000 - 1000 = 5000ms = 5.00s)
      expect(screen.getByText('5.00s')).toBeInTheDocument()
    })
  })

  describe('Custom Class Name', () => {
    it('should apply custom class name', () => {
      const state: State = {}

      const { container } = render(
        <ProgressIndicator state={state} className="custom-class" />
      )

      const rootElement = container.querySelector('.custom-class')
      expect(rootElement).toBeInTheDocument()
    })
  })

  describe('Default Props', () => {
    it('should use default values for optional props', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} />)

      // Should display 0 for tool calls and messages by default
      const zeros = screen.getAllByText('0')
      expect(zeros.length).toBe(2) // One for tool calls, one for messages
    })

    it('should handle null startTime gracefully', () => {
      const state: State = {}

      render(<ProgressIndicator state={state} startTime={null} endTime={null} />)

      expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    })
  })
})
