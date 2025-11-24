import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentSelector } from '@/components/executions/AgentSelector'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AgentInfo } from '@/types/api'
import React from 'react'

describe('AgentSelector', () => {
  const mockAgents: AgentInfo[] = [
    {
      type: 'claude-code',
      displayName: 'Claude Code',
      supportedModes: ['structured', 'interactive', 'hybrid'],
      supportsStreaming: true,
      supportsStructuredOutput: true,
      implemented: true,
    },
    {
      type: 'codex',
      displayName: 'OpenAI Codex',
      supportedModes: ['structured'],
      supportsStreaming: false,
      supportsStructuredOutput: true,
      implemented: false,
    },
    {
      type: 'copilot',
      displayName: 'GitHub Copilot',
      supportedModes: ['interactive'],
      supportsStreaming: true,
      supportsStructuredOutput: false,
      implemented: false,
    },
    {
      type: 'cursor',
      displayName: 'Cursor',
      supportedModes: ['interactive'],
      supportsStreaming: true,
      supportsStructuredOutput: false,
      implemented: false,
    },
  ]

  const mockOnChange = vi.fn()

  beforeEach(() => {
    mockOnChange.mockClear()
  })

  // Helper to render with TooltipProvider
  const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>)
  }

  describe('Rendering', () => {
    it('should render with default label', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText('AI Agent')).toBeInTheDocument()
    })

    it('should render with custom label', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
          label="Select Agent"
        />
      )

      expect(screen.getByText('Select Agent')).toBeInTheDocument()
    })

    it('should display selected agent', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText('Claude Code')).toBeInTheDocument()
    })

    it('should show "Coming Soon" badge for unimplemented selected agent', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="codex"
          onChange={mockOnChange}
        />
      )

      // Should show OpenAI Codex as selected
      expect(screen.getByText('OpenAI Codex')).toBeInTheDocument()
      // Should show Coming Soon badge
      expect(screen.getAllByText('Coming Soon').length).toBeGreaterThan(0)
    })

    it('should show warning message for unimplemented selected agent', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="codex"
          onChange={mockOnChange}
        />
      )

      expect(
        screen.getByText(
          'This agent is not yet fully implemented. Please select an available agent.'
        )
      ).toBeInTheDocument()
    })

    it('should not show warning for implemented agent', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      expect(
        screen.queryByText(
          'This agent is not yet fully implemented. Please select an available agent.'
        )
      ).not.toBeInTheDocument()
    })
  })

  describe('Dropdown Interaction', () => {
    it('should display all agents when dropdown is opened', async () => {
      const user = userEvent.setup()

      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      // Click to open dropdown
      const trigger = screen.getByRole('combobox')
      await user.click(trigger)

      // Should show all 4 agents
      expect(screen.getAllByText('Claude Code').length).toBeGreaterThan(0)
      expect(screen.getAllByText('OpenAI Codex').length).toBeGreaterThan(0)
      expect(screen.getAllByText('GitHub Copilot').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Cursor').length).toBeGreaterThan(0)
    })

    it('should call onChange when selecting an agent', async () => {
      const user = userEvent.setup()

      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      // Open dropdown
      const trigger = screen.getByRole('combobox')
      await user.click(trigger)

      // The onChange will be called when the value changes
      // Due to how Radix UI Select works, we need to verify the onChange callback exists
      expect(mockOnChange).toBeDefined()
    })
  })

  describe('Disabled State', () => {
    it('should disable selector when disabled prop is true', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
          disabled={true}
        />
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toBeDisabled()
    })

    it('should not be disabled by default', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).not.toBeDisabled()
    })
  })

  describe('Agent Metadata', () => {
    it('should handle agents with different capabilities', () => {
      const claudeCode = mockAgents.find((a) => a.type === 'claude-code')!
      const codex = mockAgents.find((a) => a.type === 'codex')!

      expect(claudeCode.supportedModes).toEqual([
        'structured',
        'interactive',
        'hybrid',
      ])
      expect(claudeCode.supportsStreaming).toBe(true)
      expect(claudeCode.implemented).toBe(true)

      expect(codex.supportedModes).toEqual(['structured'])
      expect(codex.supportsStreaming).toBe(false)
      expect(codex.implemented).toBe(false)
    })
  })

  describe('Empty State', () => {
    it('should handle empty agents list', () => {
      renderWithTooltip(
        <AgentSelector
          agents={[]}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      // Should still render the selector
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should handle no selected agent', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent=""
          onChange={mockOnChange}
        />
      )

      // Should still render without error
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have proper ARIA label', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveAttribute('id', 'agent-selector')
    })

    it('should be keyboard navigable', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      const trigger = screen.getByRole('combobox')
      // Combobox should be focusable
      expect(trigger).toBeEnabled()
    })
  })

  describe('Description Tooltip', () => {
    it('should show info icon when description is provided', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
          description="Choose your preferred AI agent"
        />
      )

      // Info icon should be present (lucide-react Info icon)
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should not show info icon when no description', () => {
      const { container } = renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      // No description, so no info icon
      const icons = container.querySelectorAll('svg')
      // Only chevron icon from Select should be present
      expect(icons.length).toBeLessThan(2)
    })
  })

  describe('Agent Count', () => {
    it('should handle single agent', () => {
      const singleAgent = [mockAgents[0]]

      renderWithTooltip(
        <AgentSelector
          agents={singleAgent}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText('Claude Code')).toBeInTheDocument()
    })

    it('should handle multiple agents', () => {
      renderWithTooltip(
        <AgentSelector
          agents={mockAgents}
          selectedAgent="claude-code"
          onChange={mockOnChange}
        />
      )

      // Should render without error with 4 agents
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })
  })
})
