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

vi.mock('@/lib/api', () => ({
  executionsApi: {
    getChain: (...args: unknown[]) => mockGetChain(...args),
    createFollowUp: (...args: unknown[]) => mockCreateFollowUp(...args),
    createAdhoc: (...args: unknown[]) => mockCreateAdhoc(...args),
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
    onClose: vi.fn(),
    onModeToggle: vi.fn(),
    onExecutionSelect: vi.fn(),
    onAutoConnectChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecutions.length = 0
  })

  describe('Empty State', () => {
    it('should show empty state when no executions exist', () => {
      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      expect(screen.getByText('No executions yet. Start one below.')).toBeInTheDocument()
    })

    it('should show "Select an execution" when executions exist but none selected', () => {
      mockExecutions.push(createMockExecution({ id: 'exec-1' }))

      renderWithProviders(<ChatWidgetContent {...defaultProps} />)

      expect(screen.getByText('Select an execution to view')).toBeInTheDocument()
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
      expect(buttons.length).toBeGreaterThanOrEqual(2) // mode toggle + close
    })

    it('should call onModeToggle when mode toggle is clicked', () => {
      const onModeToggle = vi.fn()

      renderWithProviders(<ChatWidgetContent {...defaultProps} onModeToggle={onModeToggle} />)

      // The mode toggle is the first button (before close)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      expect(onModeToggle).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn()

      renderWithProviders(<ChatWidgetContent {...defaultProps} onClose={onClose} />)

      // The close button is the last button
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[buttons.length - 1])

      expect(onClose).toHaveBeenCalledTimes(1)
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
      const onExecutionSelect = vi.fn()

      mockCreateAdhoc.mockResolvedValue(newExecution)

      renderWithProviders(
        <ChatWidgetContent {...defaultProps} onExecutionSelect={onExecutionSelect} />
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
        expect(onExecutionSelect).toHaveBeenCalledWith('exec-new')
      })
    })
  })
})
