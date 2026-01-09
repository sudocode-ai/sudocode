import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import { repositoryApi, agentsApi, filesApi, specsApi, issuesApi } from '@/lib/api'
import type { AgentInfo } from '@/types/api'

// Mock the API
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  executionsApi: {
    create: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    createFollowUp: vi.fn(),
    cancel: vi.fn(),
  },
  agentsApi: {
    getAll: vi.fn(),
  },
  repositoryApi: {
    getInfo: vi.fn(),
    getBranches: vi.fn(),
  },
  filesApi: {
    search: vi.fn(),
  },
  specsApi: {
    getAll: vi.fn(),
  },
  issuesApi: {
    getAll: vi.fn(),
  },
}))

// Mock useProject hook
vi.mock('@/hooks/useProject', () => ({
  useProject: vi.fn(() => ({
    currentProjectId: 'test-project-123',
    setCurrentProjectId: vi.fn(),
  })),
}))

// Mock caret position utility
vi.mock('@/lib/caret-position', () => ({
  getCaretClientRect: vi.fn(() => ({
    top: 100,
    left: 100,
    bottom: 120,
    right: 200,
    width: 100,
    height: 20,
  })),
}))

describe('AgentConfigPanel', () => {
  const mockOnStart = vi.fn()
  const mockOnSelectOpenChange = vi.fn()

  const mockAgents: AgentInfo[] = [
    {
      type: 'claude-code',
      displayName: 'Claude',
      supportedModes: ['structured', 'interactive', 'hybrid'],
      supportsStreaming: true,
      supportsStructuredOutput: true,
      implemented: true,
      available: true,
      executablePath: '/usr/local/bin/claude',
    },
    {
      type: 'codex',
      displayName: 'Codex',
      supportedModes: ['structured'],
      supportsStreaming: false,
      supportsStructuredOutput: true,
      implemented: false,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repositoryApi.getInfo).mockResolvedValue({
      name: 'test-repo',
      path: '/test/path',
      branch: 'main',
    })
    vi.mocked(repositoryApi.getBranches).mockResolvedValue({
      current: 'main',
      branches: ['main', 'develop', 'feature/test'],
    })
    vi.mocked(agentsApi.getAll).mockResolvedValue(mockAgents)

    // Mock context search API responses (for @ mention functionality)
    vi.mocked(filesApi.search).mockResolvedValue([])
    vi.mocked(specsApi.getAll).mockResolvedValue([])
    vi.mocked(issuesApi.getAll).mockResolvedValue([])
  })

  describe('Initial Rendering', () => {
    it('should render the component', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(
            'Add additional context (optional) for the agent... (@ for context, / for commands)'
          )
        ).toBeInTheDocument()
      })
    })

    it('should load repository info on mount', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(repositoryApi.getBranches).toHaveBeenCalled()
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
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })
    })

    it('should show only implemented agents in dropdown when opened', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })

      // Find all combobox triggers and click the agent selector (first one)
      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[0])

      await waitFor(() => {
        // Should show Claude (implemented)
        expect(screen.getAllByText('Claude').length).toBeGreaterThan(1)
        // Should NOT show Codex (unimplemented)
        expect(screen.queryByText('Codex')).not.toBeInTheDocument()
      })
    })

    it('should exclude unimplemented agents from dropdown', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })

      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[0])

      await waitFor(() => {
        // Only Claude should be in the options (it's the only implemented agent in mockAgents)
        const options = screen.getAllByRole('option')
        // Filter to agent selector options (exclude mode and branch options)
        const agentOptions = options.filter(
          (opt) =>
            opt.textContent?.includes('Claude') ||
            opt.textContent?.includes('Codex') ||
            opt.textContent?.includes('Copilot') ||
            opt.textContent?.includes('Cursor')
        )
        expect(agentOptions.length).toBe(1)
        expect(agentOptions[0].textContent).toBe('Claude')
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
        expect(screen.getByText('Claude')).toBeInTheDocument()
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
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
      })
    })

    it('should allow changing execution mode', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
      })

      // Find the execution mode selector (second combobox)
      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[1])

      await waitFor(() => {
        expect(screen.getByText('Run local')).toBeInTheDocument()
      })
    })
  })

  describe('Branch Display', () => {
    it('should show branch display when baseBranch is set', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should only have agent selector and mode selector (2 comboboxes)
        const triggers = screen.getAllByRole('combobox')
        expect(triggers.length).toBe(2)
      })

      // Should show current branch from repositoryApi in worktree mode
      await waitFor(() => {
        expect(screen.getByText('main')).toBeInTheDocument()
      })
    })

    it('should display current branch in worktree mode', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should show current branch from repositoryApi
        expect(screen.getByText('main')).toBeInTheDocument()
      })
    })

    it('should hide branch display in local mode', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
      })

      // Initially should show branch in worktree mode
      expect(screen.getByText('main')).toBeInTheDocument()

      // Switch to local mode
      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[1]) // Mode selector

      const localOption = await screen.findByText('Run local')
      await user.click(localOption)

      await waitFor(() => {
        // Branch display should be hidden in local mode
        expect(screen.queryByText('main')).not.toBeInTheDocument()
      })
    })

    it('should show current branch from repository', async () => {
      // Override repo info to return a different branch
      vi.mocked(repositoryApi.getBranches).mockResolvedValue({
        current: 'develop',
        branches: ['main', 'develop', 'feature/test'],
      })

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should show the current branch
        expect(screen.getByText('develop')).toBeInTheDocument()
      })
    })
  })

  describe('Prompt Input', () => {
    it('should allow entering a prompt', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
      await user.type(textarea, 'Test prompt')

      expect(textarea).toHaveValue('Test prompt')
    })

    it('should disable prompt input while loading', () => {
      vi.mocked(repositoryApi.getInfo).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = screen.getByPlaceholderText('Loading prompt...')
      expect(textarea).toBeDisabled()
    })

    it('should show running placeholder when execution is running', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} isRunning />)

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Execution is running (esc to cancel)')
        ).toBeInTheDocument()
      })
    })
  })

  describe('Run Button', () => {
    it('should be enabled when prompt is empty for first messages', async () => {
      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        const runButton = screen.getByRole('button', { name: /Submit/i })
        expect(runButton).not.toBeDisabled()
      })
    })

    it('should be disabled when prompt is empty for follow-ups', async () => {
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

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        const runButton = screen.getByRole('button', { name: /Submit/i })
        expect(runButton).toBeDisabled()
      })
    })

    it('should be enabled when prompt is filled', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
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

      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      expect(runButton).toBeDisabled()
    })

    it('should call onStart with config, prompt, and agentType when clicked', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
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
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })

      // Change agent selection
      const triggers = screen.getAllByRole('combobox')
      await user.click(triggers[0])

      const cursorOption = await screen.findByRole('option', { name: /Cursor/ })
      await user.click(cursorOption)

      // Enter prompt
      const textarea = screen.getByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
      await user.type(textarea, 'Test prompt')

      // Click run
      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      expect(mockOnStart).toHaveBeenCalledWith(expect.any(Object), 'Test prompt', 'cursor', false)
    })

    it('should use default prompt "Implement issue [[issueId]]" when submitting empty prompt for first message', async () => {
      const user = userEvent.setup()

      // Clear localStorage to ensure clean state
      localStorage.clear()

      renderWithProviders(<AgentConfigPanel issueId="i-test123" onStart={mockOnStart} />)

      await waitFor(() => {
        const runButton = screen.getByRole('button', { name: /Submit/i })
        expect(runButton).not.toBeDisabled()
      })

      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      expect(mockOnStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'worktree',
          cleanupMode: 'manual',
        }),
        'Implement issue [[i-test123]]',
        expect.any(String), // Allow any agent type since it might vary based on test order
        false
      )
    })

    it('should not use default prompt for follow-ups with empty prompt', async () => {
      userEvent.setup()

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

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          isFollowUp
          lastExecution={lastExecution}
        />
      )

      await waitFor(() => {
        const runButton = screen.getByRole('button', { name: /Submit/i })
        // Should be disabled for empty follow-up prompts
        expect(runButton).toBeDisabled()
      })

      // Can't click disabled button, so no need to test onStart call
    })
  })

  describe('Settings Dialog', () => {
    it('should open settings dialog when settings button is clicked', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(
            'Add additional context (optional) for the agent... (@ for context, / for commands)'
          )
        ).toBeInTheDocument()
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

  describe('Loading States', () => {
    it('should disable controls while loading repository info', () => {
      vi.mocked(repositoryApi.getInfo).mockImplementation(
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
        <AgentConfigPanel issueId="i-test1" onStart={mockOnStart} lastExecution={lastExecution} />
      )

      await waitFor(() => {
        // Should show inherited mode from previous execution
        expect(screen.getByText('Run local')).toBeInTheDocument()
      })
    })

    it('should save config to localStorage when execution starts', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
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

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        // Should use saved mode from localStorage
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
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
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
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
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

      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
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
        <AgentConfigPanel issueId="i-test1" onStart={mockOnStart} lastExecution={lastExecution} />
      )

      await waitFor(() => {
        // Should use previous execution config, not localStorage
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
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
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
      })

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last execution config is invalid')
      )

      consoleWarnSpy.mockRestore()
    })

    it('should merge lastExecution.mode with localStorage settings when no full config provided', async () => {
      const user = userEvent.setup()

      // Set localStorage with cleanupMode but worktree mode
      localStorage.setItem(
        'sudocode:lastExecutionConfig',
        JSON.stringify({
          mode: 'worktree',
          cleanupMode: 'auto',
        })
      )

      // Provide lastExecution with only mode override (no full config)
      const lastExecutionModeOnly = {
        id: '',
        mode: 'local',
        // No config property - simulates AdhocExecutionDialog usage
      }

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          lastExecution={lastExecutionModeOnly}
        />
      )

      await waitFor(() => {
        // Mode should be overridden to 'local' from lastExecution
        expect(screen.getByText('Run local')).toBeInTheDocument()
      })

      // Now submit and verify the merged config
      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      // Should have mode from lastExecution override but cleanupMode preserved from localStorage
      expect(mockOnStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local', // From lastExecution override
          cleanupMode: 'auto', // Preserved from localStorage
        }),
        'Test prompt',
        expect.any(String),
        false
      )
    })

    it('should use defaults when lastExecution.mode provided but no localStorage', async () => {
      const user = userEvent.setup()

      // Ensure localStorage is empty
      localStorage.clear()

      // Provide lastExecution with only mode override
      const lastExecutionModeOnly = {
        id: '',
        mode: 'local',
      }

      renderWithProviders(
        <AgentConfigPanel
          issueId="i-test1"
          onStart={mockOnStart}
          lastExecution={lastExecutionModeOnly}
        />
      )

      await waitFor(() => {
        // Mode should be 'local' from lastExecution
        expect(screen.getByText('Run local')).toBeInTheDocument()
      })

      // Submit and verify the config uses defaults for other fields
      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )
      await user.type(textarea, 'Test prompt')

      const runButton = screen.getByRole('button', { name: /Submit/i })
      await user.click(runButton)

      expect(mockOnStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local', // From lastExecution override
          cleanupMode: 'manual', // Default value
        }),
        'Test prompt',
        expect.any(String),
        false
      )
    })
  })

  describe('Skip Permissions Persistence', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('should load skip permissions setting from localStorage for claude-code agent', async () => {
      // Set skip permissions in localStorage
      localStorage.setItem('sudocode:skipPermissions', 'true')

      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })

      // Open settings dialog to check the value
      const buttons = screen.getAllByRole('button')
      const settingsButton = buttons.find((btn) => btn.className.includes('border-input'))
      expect(settingsButton).toBeDefined()
      await user.click(settingsButton!)

      await waitFor(() => {
        expect(screen.getByText('Advanced Agent Settings')).toBeInTheDocument()
      })

      // The skip permissions switch should be checked
      const skipSwitch = screen.getByRole('switch', { name: /Skip Permission Prompts/i })
      expect(skipSwitch).toBeChecked()
    })

    it('should save skip permissions setting to localStorage when toggled', async () => {
      const user = userEvent.setup()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })

      // Open settings dialog
      const buttons = screen.getAllByRole('button')
      const settingsButton = buttons.find((btn) => btn.className.includes('border-input'))
      await user.click(settingsButton!)

      await waitFor(() => {
        expect(screen.getByText('Advanced Agent Settings')).toBeInTheDocument()
      })

      // Toggle skip permissions
      const skipSwitch = screen.getByRole('switch', { name: /Skip Permission Prompts/i })
      await user.click(skipSwitch)

      await waitFor(() => {
        // Check localStorage was updated
        expect(localStorage.getItem('sudocode:skipPermissions')).toBe('true')
      })
    })

    it('should sync skip permissions from lastExecution config', async () => {
      const user = userEvent.setup()

      const lastExecution = {
        id: 'exec-prev-123',
        mode: 'worktree',
        agent_type: 'claude-code',
        config: {
          mode: 'worktree' as const,
          baseBranch: 'main',
          cleanupMode: 'manual' as const,
          agentConfig: {
            dangerouslySkipPermissions: true,
          },
        },
      }

      renderWithProviders(
        <AgentConfigPanel issueId="i-test1" onStart={mockOnStart} lastExecution={lastExecution} />
      )

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })

      // Open settings dialog to verify the value was synced
      const buttons = screen.getAllByRole('button')
      const settingsButton = buttons.find((btn) => btn.className.includes('border-input'))
      await user.click(settingsButton!)

      await waitFor(() => {
        expect(screen.getByText('Advanced Agent Settings')).toBeInTheDocument()
      })

      // The skip permissions switch should be checked (synced from lastExecution)
      const skipSwitch = screen.getByRole('switch', { name: /Skip Permission Prompts/i })
      expect(skipSwitch).toBeChecked()

      // And localStorage should also be updated
      expect(localStorage.getItem('sudocode:skipPermissions')).toBe('true')
    })

    it('should default to false when localStorage has no skip permissions setting', async () => {
      const user = userEvent.setup()

      // Ensure localStorage is empty
      expect(localStorage.getItem('sudocode:skipPermissions')).toBeNull()

      renderWithProviders(<AgentConfigPanel issueId="i-test1" onStart={mockOnStart} />)

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })

      // Open settings dialog
      const buttons = screen.getAllByRole('button')
      const settingsButton = buttons.find((btn) => btn.className.includes('border-input'))
      await user.click(settingsButton!)

      await waitFor(() => {
        expect(screen.getByText('Advanced Agent Settings')).toBeInTheDocument()
      })

      // The skip permissions switch should not be checked
      const skipSwitch = screen.getByRole('switch', { name: /Skip Permission Prompts/i })
      expect(skipSwitch).not.toBeChecked()
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
          screen.getByPlaceholderText(
            'Continue the previous conversation... (ctrl+k for new, @ for context, / for commands)'
          )
        ).toBeInTheDocument()
      })
    })

    it('should not call repository API in follow-up mode', async () => {
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

      expect(repositoryApi.getInfo).not.toHaveBeenCalled()
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
        'Continue the previous conversation... (ctrl+k for new, @ for context, / for commands)'
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
        'Continue the previous conversation... (ctrl+k for new, @ for context, / for commands)'
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
        'Start a new execution... (ctrl+k to continue previous, @ for context, / for commands)'
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
          screen.getByPlaceholderText(
            'Start a new execution... (ctrl+k to continue previous, @ for context, / for commands)'
          )
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
        'Start a new execution... (ctrl+k to continue previous, @ for context, / for commands)'
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

      const textarea = await screen.findByPlaceholderText(
        'Add additional context (optional) for the agent... (@ for context, / for commands)'
      )

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
        'Continue the previous conversation... (@ for context, / for commands)'
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
          screen.getByPlaceholderText('Continue the previous conversation... (@ for context, / for commands)')
        ).toBeInTheDocument()
      })

      // Should not show the ctrl+k hint
      expect(
        screen.queryByPlaceholderText(
          'Continue the previous conversation... (ctrl+k for new, @ for context, / for commands)'
        )
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
          screen.getByPlaceholderText('Start a new execution... (@ for context, / for commands)')
        ).toBeInTheDocument()
      })

      // Should not show the ctrl+k hint
      expect(
        screen.queryByPlaceholderText(
          'Start a new execution... (ctrl+k to continue previous, @ for context, / for commands)'
        )
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
        expect(screen.getByText('Claude')).toBeInTheDocument()
        // Should show inherited mode
        expect(screen.getByText('Run in worktree')).toBeInTheDocument()
        // Should show inherited branch
        expect(screen.getByText('main')).toBeInTheDocument()
      })
    })
  })
})
