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
      expect(screen.getByText('Execution Settings')).toBeInTheDocument()
      expect(screen.getByLabelText('Worktree Cleanup Mode')).toBeInTheDocument()
      expect(screen.getByLabelText('Timeout (ms)')).toBeInTheDocument()
      expect(screen.getByLabelText('Max Tokens')).toBeInTheDocument()
      expect(screen.getByLabelText('Temperature')).toBeInTheDocument()
    })

    it('should not render Codex config when agent is not codex', () => {
      render(
        <AgentSettingsDialog
          open={true}
          config={defaultConfig}
          onConfigChange={mockOnConfigChange}
          onClose={mockOnClose}
          agentType="claude-code"
        />
      )

      expect(screen.queryByText('Codex Configuration')).not.toBeInTheDocument()
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

      expect(screen.getByText('Codex Configuration')).toBeInTheDocument()
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
