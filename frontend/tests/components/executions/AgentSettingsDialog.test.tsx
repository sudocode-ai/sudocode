/**
 * Unit tests for AgentSettingsDialog component
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentSettingsDialog } from '../../../src/components/executions/AgentSettingsDialog'
import type { ExecutionConfig } from '../../../src/types/execution'
import type { CodexConfig } from '../../../src/components/executions/CodexConfigForm'

describe('AgentSettingsDialog', () => {
  const defaultConfig: ExecutionConfig = {
    mode: 'worktree',
    cleanupMode: 'manual',
  }

  const defaultCodexConfig: CodexConfig = {
    fullAuto: true,
    search: true,
    json: true,
  }

  const mockOnConfigChange = vi.fn()
  const mockOnClose = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should render general execution settings', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={defaultConfig}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Advanced Agent Settings')).toBeInTheDocument()
      // Check for section headers in the new layout (using heading role to get section headers)
      expect(screen.getByRole('heading', { name: 'Model & Agent' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Behavior' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Advanced' })).toBeInTheDocument()
      // Check for individual settings
      expect(screen.getByLabelText('Worktree Cleanup Mode')).toBeInTheDocument()
      expect(screen.getByLabelText('Timeout (ms)')).toBeInTheDocument()
      expect(screen.getByLabelText('Max Tokens')).toBeInTheDocument()
      expect(screen.getByLabelText('Temperature')).toBeInTheDocument()
    })

    it('should show placeholder when no agent selected', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={defaultConfig}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Select an agent to see model and agent-specific settings.')).toBeInTheDocument()
    })

    it('should show message when agent has no specific settings', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={defaultConfig}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
          agentType="claude-code"
        />
      )

      expect(screen.getByText('No specific settings available for this agent.')).toBeInTheDocument()
    })

    it('should render Codex config when agent is codex', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={{
            ...defaultConfig,
            agentConfig: defaultCodexConfig,
          }}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
          agentType="codex"
        />
      )

      // CodexConfigForm should be rendered in the Model & Agent section
      expect(screen.getByLabelText(/Model/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Full Auto Mode/i)).toBeInTheDocument()
    })
  })

  describe('configuration changes', () => {
    it('should handle cleanup mode changes', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={defaultConfig}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
        />
      )

      const cleanupSelect = screen.getByLabelText('Worktree Cleanup Mode')
      fireEvent.click(cleanupSelect)

      const autoOption = screen.getByText('Auto Cleanup')
      fireEvent.click(autoOption)

      expect(mockOnConfigChange).toHaveBeenCalledWith({ cleanupMode: 'auto' })
    })

    it('should handle timeout changes', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={defaultConfig}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
        />
      )

      const timeoutInput = screen.getByLabelText('Timeout (ms)')
      fireEvent.change(timeoutInput, { target: { value: '30000' } })

      expect(mockOnConfigChange).toHaveBeenCalledWith({ timeout: 30000 })
    })

    it('should handle agent-specific config changes', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={{
            ...defaultConfig,
            agentConfig: defaultCodexConfig,
          }}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
          agentType="codex"
        />
      )

      const fullAutoSwitch = screen.getByRole('switch', { name: /Full Auto Mode/i })
      fireEvent.click(fullAutoSwitch)

      expect(mockOnConfigChange).toHaveBeenCalledWith({
        agentConfig: {
          ...defaultCodexConfig,
          fullAuto: false,
        },
      })
    })
  })

  describe('dialog interactions', () => {
    it('should close when Done button is clicked', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={defaultConfig}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
        />
      )

      const doneButton = screen.getByText('Done')
      fireEvent.click(doneButton)

      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})
