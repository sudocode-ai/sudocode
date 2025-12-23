import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatWidgetContent } from '@/components/chat-widget/ChatWidgetContent'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/contexts/ThemeContext'
import type { Execution } from '@/types/execution'

// Mock the API
const mockGetChain = vi.fn()
const mockCreateFollowUp = vi.fn()
const mockCreateAdhoc = vi.fn()
const mockGetBranches = vi.fn().mockResolvedValue({ current: 'main', branches: ['main', 'develop'] })

vi.mock('@/lib/api', () => ({
  executionsApi: {
    getChain: (...args: unknown[]) => mockGetChain(...args),
    createFollowUp: (...args: unknown[]) => mockCreateFollowUp(...args),
    createAdhoc: (...args: unknown[]) => mockCreateAdhoc(...args),
  },
  repositoryApi: {
    getBranches: () => mockGetBranches(),
  },
}))

// Mock useExecutions hook
const mockExecutions: Execution[] = []
vi.mock('@/hooks/useExecutions', () => ({
  useExecutions: () => ({
    data: { executions: mockExecutions },
    isLoading: false,
    error: null,
  }),
}))

// Mock useAgents hook
vi.mock('@/hooks/useAgents', () => ({
  useAgents: () => ({
    agents: [
      { type: 'claude-code', displayName: 'Claude Code', implemented: true },
      { type: 'codex', displayName: 'Codex', implemented: true },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// Mock AgentSettingsDialog
vi.mock('@/components/executions/AgentSettingsDialog', () => ({
  AgentSettingsDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="agent-settings-dialog">
        <button data-testid="settings-close" onClick={onClose}>
          Close Settings
        </button>
      </div>
    ) : null,
}))

// Mock ExecutionMonitor component
vi.mock('@/components/executions/ExecutionMonitor', () => ({
  ExecutionMonitor: ({ executionId, execution }: { executionId: string; execution: Execution }) => (
    <div data-testid={`execution-monitor-${executionId}`}>
      <span>Execution: {execution.id}</span>
      <span>Status: {execution.status}</span>
    </div>
  ),
}))

// Mock AgentConfigPanel component
vi.mock('@/components/executions/AgentConfigPanel', () => ({
  AgentConfigPanel: ({
    onStart,
    isFollowUp,
    promptPlaceholder,
  }: {
    onStart: (...args: unknown[]) => void
    isFollowUp: boolean
    promptPlaceholder: string
  }) => (
    <div data-testid="agent-config-panel">
      <input
        data-testid="prompt-input"
        placeholder={promptPlaceholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onStart({}, (e.target as HTMLInputElement).value, 'claude-code')
          }
        }}
      />
      <span data-testid="is-follow-up">{isFollowUp ? 'true' : 'false'}</span>
    </div>
  ),
}))

// Mock ExecutionSelector component
vi.mock('@/components/chat-widget/ExecutionSelector', () => ({
  ExecutionSelector: ({
    value,
    onChange,
  }: {
    value: string | null
    onChange: (id: string | null) => void
  }) => (
    <select
      data-testid="execution-selector"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Select...</option>
      <option value="exec-1">Execution 1</option>
      <option value="exec-2">Execution 2</option>
    </select>
  ),
}))

// Helper to create mock execution
const createMockExecution = (overrides: Partial<Execution> = {}): Execution => ({
  id: 'exec-123',
  issue_id: 'i-abc',
  issue_uuid: 'uuid-abc',
  mode: 'worktree',
  prompt: 'Test prompt',
  config: null,
  agent_type: 'claude-code',
  session_id: 'session-123',
  workflow_execution_id: null,
  target_branch: 'main',
  branch_name: 'sudocode/exec-123',
  before_commit: 'commit-before',
  after_commit: null,
  worktree_path: '/path/to/worktree',
  status: 'completed',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  cancelled_at: null,
  exit_code: 0,
  error_message: null,
  error: null,
  model: null,
  summary: null,
  files_changed: null,
  parent_execution_id: null,
  step_type: null,
  step_index: null,
  step_config: null,
  ...overrides,
})

// Helper to render with providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <ThemeProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </ThemeProvider>
  )
}

describe('ChatWidgetContent', () => {
  const defaultProps = {
    executionId: null,
    execution: null,
    autoConnectLatest: true,
    mode: 'floating' as const,
    agentType: 'claude-code',
    executionConfig: { mode: 'local' as const },
    onClose: vi.fn(),
    onModeToggle: vi.fn(),
    onExecutionSelect: vi.fn(),
    onAutoConnectChange: vi.fn(),
    onCreatedExecution: vi.fn(),
    onAgentTypeChange: vi.fn(),
    onExecutionConfigChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecutions.length = 0
  })

  describe('Empty State', () => {
    it('should show config panel when no executions exist', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      // Should show the Project Assistant config panel
      expect(screen.getByText('Project Assistant')).toBeInTheDocument()
      expect(screen.getByText('Environment')).toBeInTheDocument()
    })

    it('should show config panel when executions exist but none selected', () => {
      mockExecutions.push(createMockExecution({ id: 'exec-1' }))

      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      // Should show the config panel
      expect(screen.getByText('Project Assistant')).toBeInTheDocument()
      expect(screen.getByText('Environment')).toBeInTheDocument()
    })
  })

  describe('Header', () => {
    it('should render execution selector', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      expect(screen.getByTestId('execution-selector')).toBeInTheDocument()
    })

    it('should render mode toggle button', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      // Find the button by its tooltip content indirectly via button count
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(3) // settings + mode toggle + close
    })

    it('should open settings dialog when settings button is clicked', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      // Settings button is the first button
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      expect(screen.getByTestId('agent-settings-dialog')).toBeInTheDocument()
    })

    it('should close settings dialog when close button is clicked', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      // Open settings dialog
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      expect(screen.getByTestId('agent-settings-dialog')).toBeInTheDocument()

      // Close settings dialog
      fireEvent.click(screen.getByTestId('settings-close'))

      expect(screen.queryByTestId('agent-settings-dialog')).not.toBeInTheDocument()
    })

  })

  describe('Welcome/Config Panel', () => {
    it('should show project assistant info when no chain exists', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      expect(screen.getByText('Project Assistant')).toBeInTheDocument()
      expect(screen.getByText(/Ask questions, run tasks/)).toBeInTheDocument()
    })

    it('should render execution mode selector in config panel', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      // Mode selector should be visible - look for Local text which is the default
      expect(screen.getByText('Local')).toBeInTheDocument()
      expect(screen.getByText('Environment')).toBeInTheDocument()
    })

    it('should call onExecutionConfigChange when mode is changed', () => {
      const onExecutionConfigChange = vi.fn()

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} onExecutionConfigChange={onExecutionConfigChange} />
      )

      // Find comboboxes - the second one is the mode selector (first is execution selector)
      const comboboxes = screen.getAllByRole('combobox')
      const modeSelect = comboboxes[1] // Mode selector is after execution selector
      fireEvent.click(modeSelect)

      // Select worktree option
      const worktreeOption = screen.getByText('Worktree')
      fireEvent.click(worktreeOption)

      expect(onExecutionConfigChange).toHaveBeenCalledWith({ mode: 'worktree' })
    })

    it('should show agent info with configure button', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      expect(screen.getByText('Agent')).toBeInTheDocument()
      expect(screen.getByText('Configure')).toBeInTheDocument()
    })

    it('should open settings dialog when Configure button is clicked', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      fireEvent.click(screen.getByText('Configure'))

      expect(screen.getByTestId('agent-settings-dialog')).toBeInTheDocument()
    })
  })

  describe('Execution Chain Display', () => {
    it('should fetch and display execution chain when executionId is provided', async () => {
      const execution = createMockExecution({ id: 'exec-1' })
      mockGetChain.mockResolvedValue({
        rootId: 'exec-1',
        executions: [execution],
      })

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} executionId="exec-1" execution={execution} />
      )

      await waitFor(() => {
        expect(mockGetChain).toHaveBeenCalledWith('exec-1')
      })

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-1')).toBeInTheDocument()
      })
    })

    it('should display multiple executions in chain', async () => {
      const exec1 = createMockExecution({ id: 'exec-1', status: 'completed' })
      const exec2 = createMockExecution({
        id: 'exec-2',
        parent_execution_id: 'exec-1',
        status: 'running',
      })

      mockGetChain.mockResolvedValue({
        rootId: 'exec-1',
        executions: [exec1, exec2],
      })

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} executionId="exec-1" execution={exec1} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-1')).toBeInTheDocument()
        expect(screen.getByTestId('execution-monitor-exec-2')).toBeInTheDocument()
      })
    })

    it('should clear chain data when executionId becomes null', async () => {
      const execution = createMockExecution({ id: 'exec-1' })
      mockGetChain.mockResolvedValue({
        rootId: 'exec-1',
        executions: [execution],
      })

      const { rerender } = renderWithProviders(
        <ChatWidgetContent {...defaultProps} executionId="exec-1" execution={execution} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-1')).toBeInTheDocument()
      })

      // Rerender with null executionId
      rerender(
        <ThemeProvider>
          <TooltipProvider>
            <ChatWidgetContent {...defaultProps} executionId={null} execution={null} />
          </TooltipProvider>
        </ThemeProvider>
      )

      // Should show empty state
      await waitFor(() => {
        expect(screen.queryByTestId('execution-monitor-exec-1')).not.toBeInTheDocument()
      })
    })
  })

  describe('AgentConfigPanel', () => {
    it('should show "Start a new execution" placeholder when no chain', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      const input = screen.getByTestId('prompt-input')
      expect(input).toHaveAttribute('placeholder', 'Start a new execution...')
    })

    it('should show "Send a follow-up" placeholder when chain exists', async () => {
      const execution = createMockExecution({ id: 'exec-1' })
      mockGetChain.mockResolvedValue({
        rootId: 'exec-1',
        executions: [execution],
      })

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} executionId="exec-1" execution={execution} />
      )

      await waitFor(() => {
        const input = screen.getByTestId('prompt-input')
        expect(input).toHaveAttribute('placeholder', 'Send a follow-up message...')
      })
    })

    it('should set isFollowUp to true when chain exists', async () => {
      const execution = createMockExecution({ id: 'exec-1' })
      mockGetChain.mockResolvedValue({
        rootId: 'exec-1',
        executions: [execution],
      })

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} executionId="exec-1" execution={execution} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('is-follow-up')).toHaveTextContent('true')
      })
    })

    it('should set isFollowUp to false when no chain', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      expect(screen.getByTestId('is-follow-up')).toHaveTextContent('false')
    })
  })

  describe('Follow-up Creation', () => {
    it('should create follow-up and add to chain when chain exists', async () => {
      const execution = createMockExecution({ id: 'exec-1', status: 'completed' })
      const newExecution = createMockExecution({ id: 'exec-2', parent_execution_id: 'exec-1' })

      mockGetChain.mockResolvedValue({
        rootId: 'exec-1',
        executions: [execution],
      })

      mockCreateFollowUp.mockResolvedValue(newExecution)

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} executionId="exec-1" execution={execution} />
      )

      // Wait for chain to load
      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-1')).toBeInTheDocument()
      })

      // Simulate typing and submitting
      const input = screen.getByTestId('prompt-input')
      fireEvent.change(input, { target: { value: 'Follow-up message' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => {
        expect(mockCreateFollowUp).toHaveBeenCalledWith('exec-1', {
          feedback: 'Follow-up message',
        })
      })

      // New execution should be added to the chain
      await waitFor(() => {
        expect(screen.getByTestId('execution-monitor-exec-2')).toBeInTheDocument()
      })
    })
  })

  describe('Adhoc Execution Creation', () => {
    it('should create adhoc execution when no chain exists', async () => {
      const newExecution = createMockExecution({ id: 'exec-new' })
      const onCreatedExecution = vi.fn()

      mockCreateAdhoc.mockResolvedValue(newExecution)

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} onCreatedExecution={onCreatedExecution} />
      )

      // Simulate typing and submitting
      const input = screen.getByTestId('prompt-input')
      fireEvent.change(input, { target: { value: 'New execution prompt' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => {
        expect(mockCreateAdhoc).toHaveBeenCalledWith({
          config: { tags: ['project-assistant'] },
          prompt: 'New execution prompt',
          agentType: 'claude-code',
        })
      })

      await waitFor(() => {
        expect(onCreatedExecution).toHaveBeenCalledWith(newExecution)
      })
    })
  })
})
