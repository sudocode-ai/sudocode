import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentWidget, AgentBadge } from '@/components/codeviz/AgentWidget'

describe('AgentWidget', () => {
  const defaultProps = {
    executionId: 'exec-001',
    agentType: 'claude-code',
    status: 'running' as const,
    color: '#3b82f6',
  }

  describe('Rendering', () => {
    it('should render agent type name', () => {
      render(<AgentWidget {...defaultProps} />)

      expect(screen.getByText('Claude Code')).toBeInTheDocument()
    })

    it('should render status indicator', () => {
      render(<AgentWidget {...defaultProps} />)

      expect(screen.getByText('Running')).toBeInTheDocument()
    })

    it('should have correct data-testid', () => {
      render(<AgentWidget {...defaultProps} />)

      expect(screen.getByTestId('agent-widget-exec-001')).toBeInTheDocument()
    })

    it('should apply border color from color prop', () => {
      render(<AgentWidget {...defaultProps} />)

      const widget = screen.getByTestId('agent-widget-exec-001')
      expect(widget).toHaveStyle({ borderLeftColor: '#3b82f6' })
    })

    it('should have aria-label with agent type and status', () => {
      render(<AgentWidget {...defaultProps} />)

      const widget = screen.getByTestId('agent-widget-exec-001')
      expect(widget).toHaveAttribute('aria-label', 'Claude Code - Running')
    })
  })

  describe('Agent type formatting', () => {
    it.each([
      ['claude-code', 'Claude Code'],
      ['codex', 'Codex'],
      ['copilot', 'Copilot'],
      ['cursor', 'Cursor'],
      ['unknown-agent', 'unknown-agent'], // Fallback to raw name
    ])('should format %s as %s', (agentType, expected) => {
      render(<AgentWidget {...defaultProps} agentType={agentType} />)

      expect(screen.getByText(expected)).toBeInTheDocument()
    })
  })

  describe('Status indicators', () => {
    it.each([
      ['preparing', 'Preparing'],
      ['pending', 'Pending'],
      ['running', 'Running'],
      ['paused', 'Paused'],
      ['completed', 'Completed'],
      ['failed', 'Failed'],
      ['cancelled', 'Cancelled'],
      ['stopped', 'Stopped'],
    ] as const)('should show %s status as %s', (status, label) => {
      render(<AgentWidget {...defaultProps} status={status} />)

      expect(screen.getByText(label)).toBeInTheDocument()
    })
  })

  describe('Selection state', () => {
    it('should apply selected styles when isSelected is true', () => {
      render(<AgentWidget {...defaultProps} isSelected={true} />)

      const widget = screen.getByTestId('agent-widget-exec-001')
      expect(widget).toHaveClass('ring-2', 'ring-primary')
    })

    it('should not apply selected styles when isSelected is false', () => {
      render(<AgentWidget {...defaultProps} isSelected={false} />)

      const widget = screen.getByTestId('agent-widget-exec-001')
      expect(widget).not.toHaveClass('ring-primary')
    })
  })

  describe('Click handling', () => {
    it('should call onClick when clicked', () => {
      const onClick = vi.fn()
      render(<AgentWidget {...defaultProps} onClick={onClick} />)

      fireEvent.click(screen.getByTestId('agent-widget-exec-001'))

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onClick is not provided', () => {
      render(<AgentWidget {...defaultProps} />)

      expect(() => {
        fireEvent.click(screen.getByTestId('agent-widget-exec-001'))
      }).not.toThrow()
    })
  })

  describe('File count display', () => {
    it('should show file count when provided', () => {
      render(<AgentWidget {...defaultProps} fileCount={5} isSelected={true} />)

      expect(screen.getByText('5 files changed')).toBeInTheDocument()
    })

    it('should show singular "file" for count of 1', () => {
      render(<AgentWidget {...defaultProps} fileCount={1} isSelected={true} />)

      expect(screen.getByText('1 file changed')).toBeInTheDocument()
    })

    it('should not show file count when 0', () => {
      render(<AgentWidget {...defaultProps} fileCount={0} isSelected={true} />)

      expect(screen.queryByText(/files? changed/)).not.toBeInTheDocument()
    })

    it('should not show file count when undefined', () => {
      render(<AgentWidget {...defaultProps} isSelected={true} />)

      expect(screen.queryByText(/files? changed/)).not.toBeInTheDocument()
    })
  })

  describe('Prompt display', () => {
    it('should show prompt when selected', () => {
      render(<AgentWidget {...defaultProps} isSelected={true} prompt="Implement feature X" />)

      expect(screen.getByText('Implement feature X')).toBeInTheDocument()
    })

    it('should not show prompt when not selected', () => {
      render(<AgentWidget {...defaultProps} isSelected={false} prompt="Implement feature X" />)

      expect(screen.queryByText('Implement feature X')).not.toBeInTheDocument()
    })
  })
})

describe('AgentBadge', () => {
  const defaultProps = {
    agentType: 'claude-code',
    status: 'running' as const,
    color: '#3b82f6',
  }

  it('should render agent type name', () => {
    render(<AgentBadge {...defaultProps} />)

    expect(screen.getByText('Claude Code')).toBeInTheDocument()
  })

  it('should have aria-label with agent type and status', () => {
    render(<AgentBadge {...defaultProps} />)

    const badge = screen.getByRole('button')
    expect(badge).toHaveAttribute('aria-label', 'Claude Code - Running')
  })

  it('should call onClick when clicked', () => {
    const onClick = vi.fn()
    render(<AgentBadge {...defaultProps} onClick={onClick} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should apply border color from color prop', () => {
    render(<AgentBadge {...defaultProps} />)

    const badge = screen.getByRole('button')
    expect(badge).toHaveStyle({ borderColor: '#3b82f6' })
  })
})
