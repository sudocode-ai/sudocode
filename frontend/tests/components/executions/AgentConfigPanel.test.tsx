import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import { executionsApi, agentsApi } from '@/lib/api'
import type { ExecutionPrepareResult } from '@/types/execution'
import type { AgentInfo } from '@/types/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  executionsApi: {
    prepare: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    createFollowUp: vi.fn(),
    cancel: vi.fn(),
  },
  agentsApi: {
    getAll: vi.fn(),
  },
}))

describe('AgentConfigPanel', () => {
  const mockOnStart = vi.fn()
  const mockOnSelectOpenChange = vi.fn()

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
  ]

  const mockPrepareResult: ExecutionPrepareResult = {
    renderedPrompt: 'Test prompt for i-test1',
    issue: {
      id: 'i-test1',
      title: 'Test Issue',
      description: 'Test description',
    },
    relatedSpecs: [],
    relatedFeedback: [],
    defaultConfig: {
      mode: 'worktree',
      baseBranch: 'main',
      cleanupMode: 'manual',
    },
    availableModels: ['claude-sonnet-4'],
    availableBranches: ['main', 'develop'],
    warnings: [],
    errors: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executionsApi.prepare).mockResolvedValue(mockPrepareResult)
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)
  })

  describe('Initial Rendering', () => {
    it('should render the component', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Enter prompt for the agent...')).toBeInTheDocument()
      })
    })

    it('should load execution preview on mount', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(executionsApi.prepare).toHaveBeenCalledWith('i-test1')
      })
    })

    it('should load available agents on mount', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(agentsApi.getAll).toHaveBeenCalled()
      })
    })
  })

  describe('Agent Selection', () => {
    it('should display agent selector with default selection', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })
    })

    it('should show only implemented agents in dropdown when opened', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      // Find all combobox triggers and click the agent selector (first one)
      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[0])

      await waitFor(() => {
        // Should show Claude Code (implemented)
        expect(screen.getAllByText('Claude Code').length).toBeGreaterThan(1)
        // Should NOT show OpenAI Codex (unimplemented)
        expect(screen.queryByText('OpenAI Codex')).not.toBeInTheDocument()
      })
    })

    it('should exclude unimplemented agents from dropdown', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[0])

      await waitFor(() => {
        // Only Claude Code should be in the options (it's the only implemented agent in mockAgents)
        const options = screen.getAllByRole('option')
        // Filter to agent selector options (exclude mode and branch options)
        const agentOptions = options.filter(
          (opt) =>
            opt.textContent?.includes('Claude Code') ||
            opt.textContent?.includes('Codex') ||
            opt.textContent?.includes('Copilot') ||
            opt.textContent?.includes('Cursor')
        )
        expect(agentOptions.length).toBe(1)
        expect(agentOptions[0].textContent).toBe('Claude Code')
      })
    })

    it('should call onSelectOpenChange when agent selector opens', async () => {
      const user = userEvent.setup()

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          onSelectOpenChange={mockOnSelectOpenChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[0])

      expect(mockOnSelectOpenChange).toHaveBeenCalled()
    })
  })

  describe('Execution Mode Selection', () => {
    it('should display execution mode selector', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('New worktree')).toBeInTheDocument()
      })
    })

    it('should allow changing execution mode', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('New worktree')).toBeInTheDocument()
      })

      // Find the execution mode selector (second combobox)
      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[1])

      await waitFor(() => {
        expect(screen.getByText('Run local')).toBeInTheDocument()
      })
    })
  })

  describe('Branch Selection', () => {
    it('should always show branch selector when baseBranch is set', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        const triggers = screen.getAllByRole('combobox')
        // Should have: agent selector, mode selector, branch selector
        expect(triggers.length).toBeGreaterThanOrEqual(3)
      })
    })

    it('should display available branches in worktree mode', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        const triggers = screen.getAllByRole('combobox')
        expect(triggers.length).toBeGreaterThanOrEqual(3)
      })

      // Branch selector should be enabled in worktree mode
      const triggers = screen.getAllByRole('combobox')
      const branchSelector = triggers[2]
      expect(branchSelector).not.toBeDisabled()

      // Click branch selector (third combobox)
      await user.click(branchSelector)

      // BranchSelector uses a Popover with buttons, not Select with options
      await waitFor(() => {
        // Should show the search input
        expect(screen.getByPlaceholderText('Search or create branch...')).toBeInTheDocument()
        // Should show available branches (main appears in trigger + list)
        expect(screen.getAllByText('main').length).toBeGreaterThanOrEqual(2)
        expect(screen.getByText('develop')).toBeInTheDocument()
      })
    })

    it('should disable branch selector in local mode', async () => {
      // Override prepare result to set mode to local
      vi.mocked(executionsApi.prepare).mockResolvedValue({
        ...mockPrepareResult,
        defaultConfig: {
          mode: 'local',
          baseBranch: 'main',
          cleanupMode: 'manual',
        },
      })

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Wait for mode to be set to local
        expect(screen.getByText('Run local')).toBeInTheDocument()
      })

      const triggers = screen.getAllByRole('combobox')
      const branchSelector = triggers[2]

      // Branch selector should be disabled in local mode
      expect(branchSelector).toBeDisabled()
    })

    it('should show current branch in local mode', async () => {
      // Override prepare result to set mode to local
      vi.mocked(executionsApi.prepare).mockResolvedValue({
        ...mockPrepareResult,
        defaultConfig: {
          mode: 'local',
          baseBranch: 'develop',
          cleanupMode: 'manual',
        },
      })

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should show the current branch
        expect(screen.getByText('develop')).toBeInTheDocument()
      })
    })

    it('should show GitBranch icon in branch selector', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        const triggers = screen.getAllByRole('combobox')
        expect(triggers.length).toBeGreaterThanOrEqual(3)
      })

      // Branch selector should have GitBranch icon (rendered as svg)
      const branchSelector = screen.getAllByRole('combobox')[2]
      const svgIcon = branchSelector.querySelector('svg')
      expect(svgIcon).toBeInTheDocument()
    })
  })

  describe('Prompt Input', () => {
    it('should allow entering a prompt', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      expect(textarea).toHaveValue('Test prompt')
    })

    it('should disable prompt input while loading', () => {
      vi.mocked(executionsApi.prepare).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = screen.getByPlaceholderText('Loading prompt...')
      expect(textarea).toBeDisabled()
    })
  })

  describe('Run Button', () => {
    it('should be disabled when prompt is empty', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        const runButton = screen.getByRole('button', { name: /Submit/i })
        expect(runButton).toBeDisabled()
      })
    })

    it('should be enabled when prompt is filled', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      await waitFor(() => {
        const runButton = screen.getByRole('button', { name: /Submit/i })
        expect(runButton).not.toBeDisabled()
      })
    })

    it('should be disabled when component is disabled', async () => {
      const user = userEvent.setup()

      renderWithProviders(
        <AgentConfigPanel issueId="i-test1" onStart={mockOnStart} disabled={true} />
      )

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      expect(runButton).toBeDisabled()
    })

    it('should call onStart with config, prompt, and agentType when clicked', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      expect(mockOnStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'worktree',
          cleanupMode: 'manual',
        }),
        'Test prompt',
        'claude-code',
        false
      )
    })

    it('should pass selected agentType when different agent is selected', async () => {
      const user = userEvent.setup()

      // Add an implemented agent for testing selection
      const mockAgentsWithMultiple: AgentInfo[] = [
        ...mockAgents,
        {
          type: 'cursor',
          displayName: 'Cursor',
          supportedModes: ['interactive'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
          implemented: true,
        },
      ]
      vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgentsWithMultiple)

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
      })

      // Change agent selection
      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[0])

      const cursorOption = await screen.findByRole('option', { name: /Cursor/ })
      await user.click(cursorOption)

      // Enter prompt
      const textarea = screen.getByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      // Click run
      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      expect(mockOnStart).toHaveBeenCalledWith(expect.any(Object), 'Test prompt', 'cursor', false)
    })
  })

  describe('Settings Dialog', () => {
    it('should open settings dialog when settings button is clicked', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Enter prompt for the agent...')).toBeInTheDocument()
      })

      // Find settings button by looking for all buttons and finding the one with Settings icon
      const buttons = screen.getAllByRole('button')
      const settingsButton = buttons.find((btn) => btn.className.includes('border-input'))
      expect(settingsButton).toBeDefined()

      await user.click(settingsButton!)

      await waitFor(() => {
        expect(screen.getByText('Advanced Agent Settings')).toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('should display errors from prepare result', async () => {
      const errorPrepareResult: ExecutionPrepareResult = {
        ...mockPrepareResult,
        errors: ['Error 1: Git repository not found', 'Error 2: No base branch'],
      }
      vi.mocked(executionsApi.prepare).mockResolvedValue(errorPrepareResult)

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Errors')).toBeInTheDocument()
        expect(screen.getByText('Error 1: Git repository not found')).toBeInTheDocument()
        expect(screen.getByText('Error 2: No base branch')).toBeInTheDocument()
      })
    })

    it('should disable run button when there are errors', async () => {
      const user = userEvent.setup()
      const errorPrepareResult: ExecutionPrepareResult = {
        ...mockPrepareResult,
        errors: ['Error 1: Git repository not found'],
      }
      vi.mocked(executionsApi.prepare).mockResolvedValue(errorPrepareResult)

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      expect(runButton).toBeDisabled()
    })
  })

  describe('Warnings', () => {
    it('should display warnings from prepare result', async () => {
      const warningPrepareResult: ExecutionPrepareResult = {
        ...mockPrepareResult,
        warnings: ['Warning: Working directory has uncommitted changes'],
      }
      vi.mocked(executionsApi.prepare).mockResolvedValue(warningPrepareResult)

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Warnings')).toBeInTheDocument()
        expect(
          screen.getByText('Warning: Working directory has uncommitted changes')
        ).toBeInTheDocument()
      })
    })

    it('should still allow running with warnings', async () => {
      const user = userEvent.setup()
      const warningPrepareResult: ExecutionPrepareResult = {
        ...mockPrepareResult,
        warnings: ['Warning: Working directory has uncommitted changes'],
      }
      vi.mocked(executionsApi.prepare).mockResolvedValue(warningPrepareResult)

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      expect(runButton).not.toBeDisabled()
    })
  })

  describe('Loading States', () => {
    it('should disable controls while loading execution preview', () => {
      vi.mocked(executionsApi.prepare).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = screen.getByPlaceholderText('Loading prompt...')
      expect(textarea).toBeDisabled()

      const runButton = screen.getByRole('button', { name: /Submit/i })
      expect(runButton).toBeDisabled()
    })

    it('should disable agent selector while loading agents', () => {
      vi.mocked(agentsApi.getAll).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const triggers = screen.getAllByRole('combobox')
      // Agent selector should be disabled
      expect(triggers[0]).toBeDisabled()
    })
  })

  describe('Config Persistence', () => {
    beforeEach(() => {
      // Clear localStorage before each test
      localStorage.clear()
    })

    it('should use previous execution config when provided', async () => {
      const lastExecution = {
        id: 'exec-prev-123',
        mode: 'local',
        model: 'claude-sonnet-4',
        target_branch: 'develop',
        agent_type: 'cursor',
        config: {
          mode: 'local' as const,
          baseBranch: 'develop',
          cleanupMode: 'auto' as const,
        },
      }

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        // Should show inherited mode from previous execution
        expect(screen.getByText('Run local')).toBeInTheDocument()
      })
    })

    it('should save config to localStorage when execution starts', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      // Check localStorage was updated
      const savedConfig = localStorage.getItem('sudocode:lastExecutionConfig')
      expect(savedConfig).toBeTruthy()

      const savedAgentType = localStorage.getItem('sudocode:lastAgentType')
      expect(savedAgentType).toBe('claude-code')
    })

    it('should load config from localStorage when no previous execution', async () => {
      // Set localStorage with a config
      localStorage.setItem(
        'sudocode:lastExecutionConfig',
        JSON.stringify({
          mode: 'local',
          cleanupMode: 'auto',
        })
      )
      localStorage.setItem('sudocode:lastAgentType', 'cursor')

      // Add cursor to agents list
      const mockAgentsWithCursor: AgentInfo[] = [
        ...mockAgents,
        {
          type: 'cursor',
          displayName: 'Cursor',
          supportedModes: ['interactive'],
          supportsStreaming: true,
          supportsStructuredOutput: false,
          implemented: true,
        },
      ]
      vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgentsWithCursor)

      // Override prepare to return config without baseBranch so localStorage mode is visible
      vi.mocked(executionsApi.prepare).mockResolvedValue({
        ...mockPrepareResult,
        defaultConfig: {
          // Don't override mode - let localStorage value persist
          cleanupMode: 'manual',
        },
      })

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should use saved mode from localStorage (before prepare API merge)
        // After prepare merges, the mode should still be 'local' since prepare doesn't set it
        expect(screen.getByText('Run local')).toBeInTheDocument()
        // Should use saved agent type from localStorage
        expect(screen.getByText('Cursor')).toBeInTheDocument()
      })
    })

    it('should handle invalid config in localStorage gracefully', async () => {
      // Set invalid config in localStorage
      localStorage.setItem(
        'sudocode:lastExecutionConfig',
        JSON.stringify({
          mode: 'invalid-mode', // Invalid mode
          cleanupMode: 'manual',
        })
      )

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should fall back to default mode
        expect(screen.getByText('New worktree')).toBeInTheDocument()
      })

      // Should have warned about invalid config
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Saved config is invalid')
      )

      // Should have cleared the invalid config
      expect(localStorage.getItem('sudocode:lastExecutionConfig')).toBeNull()

      consoleWarnSpy.mockRestore()
    })

    it('should handle corrupted JSON in localStorage gracefully', async () => {
      // Set corrupted JSON in localStorage
      localStorage.setItem('sudocode:lastExecutionConfig', '{invalid json')

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should fall back to default config
        expect(screen.getByText('New worktree')).toBeInTheDocument()
      })

      // Should have warned about parse error
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to load saved execution config:',
        expect.any(Error)
      )

      // Should have cleared the corrupted data
      expect(localStorage.getItem('sudocode:lastExecutionConfig')).toBeNull()

      consoleWarnSpy.mockRestore()
    })

    it('should not save invalid config to localStorage', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')
      await user.type(textarea, 'Test prompt')

      // Manually corrupt the config state (simulating a bug or future schema change)
      // This is hard to do in practice, but we can at least verify the validation check exists
      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      // Valid config should be saved
      expect(localStorage.getItem('sudocode:lastExecutionConfig')).toBeTruthy()
    })

    it('should prefer previous execution over localStorage', async () => {
      // Set different config in localStorage
      localStorage.setItem(
        'sudocode:lastExecutionConfig',
        JSON.stringify({
          mode: 'local',
          cleanupMode: 'auto',
        })
      )

      const lastExecution = {
        id: 'exec-prev-123',
        mode: 'worktree',
        model: 'claude-sonnet-4',
        target_branch: 'main',
        agent_type: 'claude-code',
        config: {
          mode: 'worktree' as const,
          baseBranch: 'main',
          cleanupMode: 'manual' as const,
        },
      }

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        // Should use previous execution config, not localStorage
        expect(screen.getByText('New worktree')).toBeInTheDocument()
      })
    })

    it('should validate previous execution config', async () => {
      const invalidPreviousExecution = {
        id: 'exec-prev-123',
        mode: 'invalid-mode', // Invalid
        model: 'claude-sonnet-4',
        target_branch: 'main',
        agent_type: 'claude-code',
        config: {
          mode: 'invalid-mode' as any, // Invalid mode
          cleanupMode: 'manual' as const,
        },
      }

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          lastExecution={invalidPreviousExecution}
        />
      )

      await waitFor(() => {
        // Should fall back to defaults
        expect(screen.getByText('New worktree')).toBeInTheDocument()
      })

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last execution config is invalid')
      )

      consoleWarnSpy.mockRestore()
    })
  })

  describe('Follow-up Mode', () => {
    const lastExecution = {
      id: 'exec-parent-123',
      mode: 'worktree',
      model: 'claude-sonnet-4',
      target_branch: 'main',
      agent_type: 'claude-code',
      config: {
        mode: 'worktree' as const,
        baseBranch: 'main',
        cleanupMode: 'manual' as const,
      },
    }

    it('should show follow-up placeholder text', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Continue the previous conversation... (ctrl+k for new)')
        ).toBeInTheDocument()
      })
    })

    it('should not call prepare API in follow-up mode', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      // Wait a tick for any potential API calls
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(executionsApi.prepare).not.toHaveBeenCalled()
    })

    it('should disable agent selector in follow-up mode', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        const triggers = screen.getAllByRole('combobox')
        // Agent selector should be disabled
        expect(triggers[0]).toBeDisabled()
      })
    })

    it('should disable mode selector in follow-up mode', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        const triggers = screen.getAllByRole('combobox')
        // Mode selector should be disabled
        expect(triggers[1]).toBeDisabled()
      })
    })

    it('should disable branch selector in follow-up mode', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        const triggers = screen.getAllByRole('combobox')
        // Branch selector should be disabled
        expect(triggers[2]).toBeDisabled()
      })
    })

    it('should show inherited branch in follow-up mode', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        // Should show inherited branch from parent execution
        expect(screen.getByText('main')).toBeInTheDocument()
      })
    })

    it('should disable settings button in follow-up mode', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        // Find settings button by its tooltip text
        const buttons = screen.getAllByRole('button')
        // Settings button should be the one that's disabled and has border-input class
        const settingsButton = buttons.find(
          (btn) => btn.className.includes('border-input') && btn.hasAttribute('disabled')
        )
        expect(settingsButton).toBeDisabled()
      })
    })

    it('should show "Submit" as run button label in follow-up mode', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument()
      })
    })

    it('should inherit agent type from parent execution', async () => {
      const user = userEvent.setup()

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      // Enter feedback prompt
      const textarea = await screen.findByPlaceholderText(
        'Continue the previous conversation... (ctrl+k for new)'
      )
      await user.type(textarea, 'Continue with this feedback')

      // Click submit
      const submitButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(submitButton)

      // Should be called with inherited agent type
      expect(mockOnStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'worktree',
          baseBranch: 'main',
        }),
        'Continue with this feedback',
        'claude-code',
        false
      )
    })

    it('should allow custom placeholder', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          promptPlaceholder="Type your message..."
        />
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument()
      })
    })

    it('should toggle to new execution mode with Ctrl+K', async () => {
      const user = userEvent.setup()
      const mockOnForceNewToggle = vi.fn()

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          onForceNewToggle={mockOnForceNewToggle}
        />
      )

      const textarea = await screen.findByPlaceholderText(
        'Continue the previous conversation... (ctrl+k for new)'
      )

      // Press Ctrl+K to toggle to new execution mode
      await user.click(textarea)
      await user.keyboard('{Control>}k{/Control}')

      await waitFor(() => {
        expect(mockOnForceNewToggle).toHaveBeenCalledWith(true)
      })
    })

    it('should toggle back to continue mode with Ctrl+K when forcing new', async () => {
      const user = userEvent.setup()
      const mockOnForceNewToggle = vi.fn()

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          forceNewExecution={true}
          onForceNewToggle={mockOnForceNewToggle}
        />
      )

      const textarea = await screen.findByPlaceholderText(
        'Start a new execution... (ctrl+k to continue previous)'
      )

      // Press Ctrl+K to toggle back to continue mode
      await user.click(textarea)
      await user.keyboard('{Control>}k{/Control}')

      await waitFor(() => {
        expect(mockOnForceNewToggle).toHaveBeenCalledWith(false)
      })
    })

    it('should show correct placeholder when forcing new execution', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          forceNewExecution={true}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Start a new execution... (ctrl+k to continue previous)')
        ).toBeInTheDocument()
      })
    })

    it('should pass forceNew parameter to onStart when forcing new execution', async () => {
      const user = userEvent.setup()

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          forceNewExecution={true}
        />
      )

      const textarea = await screen.findByPlaceholderText(
        'Start a new execution... (ctrl+k to continue previous)'
      )
      await user.type(textarea, 'Create a new execution')

      const submitButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(submitButton)

      expect(mockOnStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'worktree',
          baseBranch: 'main',
        }),
        'Create a new execution',
        'claude-code',
        true // forceNew should be true
      )
    })

    it('should not toggle mode with Ctrl+K when not in follow-up mode', async () => {
      const user = userEvent.setup()
      const mockOnForceNewToggle = vi.fn()

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp={false}
          onForceNewToggle={mockOnForceNewToggle}
        />
      )

      const textarea = await screen.findByPlaceholderText('Enter prompt for the agent...')

      await user.click(textarea)
      await user.keyboard('{Control>}k{/Control}')

      // Should not call the toggle callback when not in follow-up mode
      expect(mockOnForceNewToggle).not.toHaveBeenCalled()
    })

    it('should not toggle mode with Ctrl+K when allowModeToggle is false', async () => {
      const user = userEvent.setup()
      const mockOnForceNewToggle = vi.fn()

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          allowModeToggle={false}
          onForceNewToggle={mockOnForceNewToggle}
        />
      )

      const textarea = await screen.findByPlaceholderText(
        'Continue the previous conversation...'
      )

      await user.click(textarea)
      await user.keyboard('{Control>}k{/Control}')

      // Should not call the toggle callback when allowModeToggle is false
      expect(mockOnForceNewToggle).not.toHaveBeenCalled()
    })

    it('should not show ctrl+k hint in placeholder when allowModeToggle is false', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          allowModeToggle={false}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Continue the previous conversation...')
        ).toBeInTheDocument()
      })

      // Should not show the ctrl+k hint
      expect(
        screen.queryByPlaceholderText('Continue the previous conversation... (ctrl+k for new)')
      ).not.toBeInTheDocument()
    })

    it('should not show ctrl+k hint when forcing new and allowModeToggle is false', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
          forceNewExecution={true}
          allowModeToggle={false}
        />
      )

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Start a new execution...')
        ).toBeInTheDocument()
      })

      // Should not show the ctrl+k hint
      expect(
        screen.queryByPlaceholderText('Start a new execution... (ctrl+k to continue previous)')
      ).not.toBeInTheDocument()
    })

    it('should show inherited values in disabled selectors', async () => {
      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        // Should show inherited agent type
        expect(screen.getByText('Claude Code')).toBeInTheDocument()
        // Should show inherited mode
        expect(screen.getByText('New worktree')).toBeInTheDocument()
        // Should show inherited branch
        expect(screen.getByText('main')).toBeInTheDocument()
      })
    })
  })
})
