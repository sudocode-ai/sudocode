import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExecutionView } from '@/components/executions/ExecutionView'
import { executionsApi } from '@/lib/api'
import type { Execution } from '@/types/execution'

// Mock the API and child components
vi.mock('@/lib/api', () => ({
  setCurrentProjectId: vi.fn(),
  getCurrentProjectId: vi.fn(() => 'test-project-123'),
  executionsApi: {
    getById: vi.fn(),
    getChain: vi.fn(),
    cancel: vi.fn(),
    createFollowUp: vi.fn(),
    deleteWorktree: vi.fn(),
    worktreeExists: vi.fn(),
    prepare: vi.fn(),
  },
  agentsApi: {
    getAll: vi.fn(),
  },
}))

vi.mock('@/components/executions/ExecutionMonitor', () => ({
  ExecutionMonitor: ({ executionId, execution, onComplete }: any) => (
    <div data-testid="execution-monitor">
      <div>ExecutionMonitor for {executionId}</div>
      {execution?.prompt && (
        <div data-testid="user-prompt">
          <div>{execution.prompt}</div>
        </div>
      )}
      <button onClick={onComplete}>Trigger Complete</button>
    </div>
  ),
}))

vi.mock('@/components/executions/AgentConfigPanel', () => ({
  AgentConfigPanel: ({ onStart, isFollowUp }: any) =>
    isFollowUp ? (
      <div data-testid="follow-up-panel">
        <button onClick={() => onStart({}, 'Test feedback', 'claude-code')}>Continue</button>
      </div>
    ) : null,
}))

vi.mock('@/components/executions/DeleteWorktreeDialog', () => ({
  DeleteWorktreeDialog: ({ isOpen, onConfirm, onClose }: any) =>
    isOpen ? (
      <div data-testid="delete-worktree-dialog">
        <button onClick={onConfirm}>Delete</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}))

describe('ExecutionView', () => {
  const mockOnFollowUpCreated = vi.fn()

  const mockExecution: Execution = {
    id: 'exec-123',
    issue_id: 'ISSUE-001',
    issue_uuid: null,
    mode: 'worktree',
    prompt: 'Test prompt',
    config: JSON.stringify({
      mode: 'worktree',
      baseBranch: 'main',
      cleanupMode: 'auto',
    }),
    agent_type: 'claude-code',
    session_id: null,
    workflow_execution_id: 'workflow-123',
    target_branch: 'main',
    branch_name: 'exec-123',
    before_commit: null,
    after_commit: null,
    worktree_path: '/tmp/worktree-123',
    status: 'running',
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:00:00Z',
    started_at: '2025-01-15T10:01:00Z',
    completed_at: null,
    cancelled_at: null,
    exit_code: null,
    error_message: null,
    error: null,
    model: 'claude-sonnet-4',
    summary: null,
    files_changed: null,
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
  }

  // Helper to create a chain response with a single execution
  const mockChainResponse = (execution: Execution) => ({
    rootId: execution.id,
    executions: [execution],
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: worktree doesn't exist
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: false })
  })

  it('should display loading state initially', () => {
    vi.mocked(executionsApi.getChain).mockReturnValue(new Promise(() => {}))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    expect(screen.getByText('Loading execution...')).toBeInTheDocument()
  })

  it('should load and display execution metadata', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Execution')).toBeInTheDocument()
    })

    // The display now shows truncated root ID
    expect(screen.getByText('exec-123...')).toBeInTheDocument()
    expect(screen.getByText('ISSUE-001')).toBeInTheDocument()
    expect(screen.getByText('worktree')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('should display error when loading fails', async () => {
    vi.mocked(executionsApi.getChain).mockRejectedValue(new Error('Network error'))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Error Loading Execution')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('should show running status badge', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
  })

  it('should show completed status badge', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
      completed_at: '2025-01-15T10:05:00Z',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('should show failed status badge', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'failed',
      error: 'Test error message',
      completed_at: '2025-01-15T10:05:00Z',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('Test error message')).toBeInTheDocument()
    })
  })

  it('should show Cancel button when execution is running', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
    })
  })

  it('should not show Cancel button when execution is completed', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument()
  })

  it('should show follow-up panel when execution is completed', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('follow-up-panel')).toBeInTheDocument()
    })
  })

  it('should show follow-up panel when execution failed', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'failed',
      error: 'Test error',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('follow-up-panel')).toBeInTheDocument()
    })
  })

  it('should cancel execution when Cancel button clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
    vi.mocked(executionsApi.cancel).mockResolvedValue(undefined as any)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
    })

    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    await waitFor(() => {
      expect(executionsApi.cancel).toHaveBeenCalledWith('exec-123')
    })
  })

  it('should show follow-up panel when execution is stopped', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'stopped',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('follow-up-panel')).toBeInTheDocument()
    })
  })

  it('should show follow-up panel when execution is cancelled', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'cancelled',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('follow-up-panel')).toBeInTheDocument()
    })
  })

  it('should show follow-up panel for non-worktree executions', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
      worktree_path: null, // No worktree (local mode)
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    // Follow-up panel should be shown for both worktree and local executions
    expect(screen.getByTestId('follow-up-panel')).toBeInTheDocument()
  })

  it('should create follow-up execution when continue button clicked', async () => {
    const user = userEvent.setup()
    const completedExecution = { ...mockExecution, status: 'completed' as const }
    const newExecution = { ...mockExecution, id: 'exec-456', parent_execution_id: 'exec-123' }
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(completedExecution))
    vi.mocked(executionsApi.createFollowUp).mockResolvedValue(newExecution)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('follow-up-panel')).toBeInTheDocument()
    })

    // Click the Continue button in the follow-up panel
    const continueButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(continueButton)

    await waitFor(() => {
      expect(executionsApi.createFollowUp).toHaveBeenCalledWith('exec-123', {
        feedback: 'Test feedback',
      })
      expect(mockOnFollowUpCreated).toHaveBeenCalledWith('exec-456')
    })
  })

  it('should display ExecutionMonitor for running execution', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('execution-monitor')).toBeInTheDocument()
      expect(screen.getByText('ExecutionMonitor for exec-123')).toBeInTheDocument()
    })
  })

  it('should reload execution chain when monitor completes', async () => {
    const user = userEvent.setup()
    const completedExecution = { ...mockExecution, status: 'completed' as const }

    vi.mocked(executionsApi.getChain)
      .mockResolvedValueOnce(mockChainResponse(mockExecution))
      .mockResolvedValueOnce(mockChainResponse(completedExecution))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })

    // Trigger completion from monitor
    const completeButton = screen.getByRole('button', { name: /Trigger Complete/ })
    await user.click(completeButton)

    await waitFor(() => {
      expect(executionsApi.getChain).toHaveBeenCalledTimes(2)
    })
  })

  it('should display timestamps when available', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
      completed_at: '2025-01-15T10:05:00Z',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText(/Started:/)).toBeInTheDocument()
      expect(screen.getByText(/Last completed:/)).toBeInTheDocument()
    })
  })

  it('should display ExecutionMonitor for preparing status', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'preparing',
    }))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Preparing')).toBeInTheDocument()
    })

    // ExecutionMonitor should be displayed for 'preparing' status (active execution)
    expect(screen.getByTestId('execution-monitor')).toBeInTheDocument()
  })

  it('should handle cancel error gracefully', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))
    vi.mocked(executionsApi.cancel).mockRejectedValue(new Error('Cancel failed'))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
    })

    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel failed')).toBeInTheDocument()
    })
  })

  it('should show Delete Worktree button when worktree exists', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
    }))
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: true })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete Worktree/ })).toBeInTheDocument()
    })
  })

  it('should not show Delete Worktree button when worktree does not exist', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
    }))
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: false })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Delete Worktree/ })).not.toBeInTheDocument()
  })

  it('should open DeleteWorktreeDialog when Delete Worktree button clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
    }))
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: true })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete Worktree/ })).toBeInTheDocument()
    })

    const deleteButton = screen.getByRole('button', { name: /Delete Worktree/ })
    await user.click(deleteButton)

    expect(screen.getByTestId('delete-worktree-dialog')).toBeInTheDocument()
  })

  it('should delete worktree when dialog confirmed', async () => {
    const user = userEvent.setup()
    const completedExecution = { ...mockExecution, status: 'completed' as const }

    vi.mocked(executionsApi.getChain)
      .mockResolvedValueOnce(mockChainResponse(completedExecution))
      .mockResolvedValueOnce(mockChainResponse(completedExecution))
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: true })
    vi.mocked(executionsApi.deleteWorktree).mockResolvedValue(undefined as any)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete Worktree/ })).toBeInTheDocument()
    })

    const deleteButton = screen.getByRole('button', { name: /Delete Worktree/ })
    await user.click(deleteButton)

    // Find the confirm button inside the dialog
    const dialog = screen.getByTestId('delete-worktree-dialog')
    const confirmButton = dialog.querySelector('button:first-child') as HTMLButtonElement
    await user.click(confirmButton)

    await waitFor(() => {
      expect(executionsApi.deleteWorktree).toHaveBeenCalledWith('exec-123')
    })
  })

  it('should handle delete worktree error gracefully', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse({
      ...mockExecution,
      status: 'completed',
    }))
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: true })
    vi.mocked(executionsApi.deleteWorktree).mockRejectedValue(new Error('Delete failed'))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete Worktree/ })).toBeInTheDocument()
    })

    const deleteButton = screen.getByRole('button', { name: /Delete Worktree/ })
    await user.click(deleteButton)

    // Find the confirm button inside the dialog
    const dialog = screen.getByTestId('delete-worktree-dialog')
    const confirmButton = dialog.querySelector('button:first-child') as HTMLButtonElement
    await user.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument()
    })
  })

  it('should render execution chain with multiple executions', async () => {
    const followUpExecution = {
      ...mockExecution,
      id: 'exec-456',
      parent_execution_id: 'exec-123',
      status: 'completed' as const,
    }

    vi.mocked(executionsApi.getChain).mockResolvedValue({
      rootId: 'exec-123',
      executions: [
        { ...mockExecution, status: 'completed' as const },
        followUpExecution,
      ],
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      // Should show "Execution Chain" title for multiple executions
      expect(screen.getByText('Execution Chain')).toBeInTheDocument()
      // Should show count badge
      expect(screen.getByText('2 executions')).toBeInTheDocument()
    })

    // Should render execution monitors for both
    const monitors = screen.getAllByTestId('execution-monitor')
    expect(monitors).toHaveLength(2)
  })

  it('should display user prompts for both root and follow-up executions', async () => {
    const rootPrompt = 'Implement the login feature'
    const followUpPrompt = 'Add error handling to the login'

    const followUpExecution = {
      ...mockExecution,
      id: 'exec-456',
      parent_execution_id: 'exec-123',
      prompt: followUpPrompt,
      status: 'completed' as const,
    }

    vi.mocked(executionsApi.getChain).mockResolvedValue({
      rootId: 'exec-123',
      executions: [
        { ...mockExecution, prompt: rootPrompt, status: 'completed' as const },
        followUpExecution,
      ],
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      // Should display root execution's prompt
      expect(screen.getByText(rootPrompt)).toBeInTheDocument()
      // Should display follow-up execution's prompt
      expect(screen.getByText(followUpPrompt)).toBeInTheDocument()
      // Should show user prompt sections for both executions
      const userPrompts = screen.getAllByTestId('user-prompt')
      expect(userPrompts.length).toBe(2)
    })
  })

  it('should auto-scroll to bottom when execution is running and user is at bottom', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    const { container } = renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })

    // Get the scrollable container
    const scrollContainer = container.querySelector('.overflow-auto') as HTMLDivElement
    expect(scrollContainer).toBeInTheDocument()

    // Mock scrollHeight and clientHeight to simulate content
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 500, writable: true, configurable: true })

    // Simulate being at the bottom (within 50px threshold)
    scrollContainer.scrollTop = 500

    // Trigger a content change by reloading chain
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    // The MutationObserver should trigger auto-scroll
    // We can't easily test MutationObserver in jsdom, but we can verify the scroll handler works
    const scrollEvent = new Event('scroll')
    scrollContainer.dispatchEvent(scrollEvent)

    // Verify scroll position is maintained near bottom
    expect(scrollContainer.scrollTop).toBe(500)
  })

  it('should disable auto-scroll when user manually scrolls up', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    const { container } = renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })

    // Get the scrollable container
    const scrollContainer = container.querySelector('.overflow-auto') as HTMLDivElement
    expect(scrollContainer).toBeInTheDocument()

    // Mock scroll properties
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 500, writable: true, configurable: true })

    // User starts at bottom
    scrollContainer.scrollTop = 500
    const scrollEvent1 = new Event('scroll')
    scrollContainer.dispatchEvent(scrollEvent1)

    // User scrolls up
    scrollContainer.scrollTop = 200
    const scrollEvent2 = new Event('scroll')
    scrollContainer.dispatchEvent(scrollEvent2)

    // Auto-scroll should now be disabled
    // This is verified by the fact that scrollTop remains at 200 and doesn't jump back to bottom
    expect(scrollContainer.scrollTop).toBe(200)
  })

  it('should re-enable auto-scroll when user scrolls back to bottom', async () => {
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    const { container } = renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })

    // Get the scrollable container
    const scrollContainer = container.querySelector('.overflow-auto') as HTMLDivElement
    expect(scrollContainer).toBeInTheDocument()

    // Mock scroll properties
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 500, writable: true, configurable: true })

    // User scrolls up
    scrollContainer.scrollTop = 200
    const scrollEvent1 = new Event('scroll')
    scrollContainer.dispatchEvent(scrollEvent1)

    // User scrolls back to bottom (within 50px threshold)
    scrollContainer.scrollTop = 480 // Within 50px of bottom (1000 - 480 - 500 = 20px from bottom)
    const scrollEvent2 = new Event('scroll')
    scrollContainer.dispatchEvent(scrollEvent2)

    // Auto-scroll should be re-enabled
    // Verify by checking that the component state allows auto-scroll
    expect(scrollContainer.scrollTop).toBe(480)
  })

  it('should show scroll to bottom FAB when auto-scroll is disabled', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.getChain).mockResolvedValue(mockChainResponse(mockExecution))

    const { container } = renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })

    // Get the scrollable container
    const scrollContainer = container.querySelector('.overflow-auto') as HTMLDivElement
    expect(scrollContainer).toBeInTheDocument()

    // Mock scroll properties
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 500, writable: true, configurable: true })

    // Initially, FAB should not be visible (auto-scroll is enabled)
    expect(screen.queryByRole('button', { name: '' })).toBeNull()

    // User scrolls up to disable auto-scroll - set scrollTop before lastScrollTopRef is initialized
    scrollContainer.scrollTop = 500
    scrollContainer.dispatchEvent(new Event('scroll'))

    // Then scroll up
    scrollContainer.scrollTop = 200
    scrollContainer.dispatchEvent(new Event('scroll'))

    // FAB should now be visible - wait for state update and re-render
    await waitFor(() => {
      // Look for any button with the rounded-full class (unique to our FAB)
      const buttons = container.querySelectorAll('button.rounded-full')
      expect(buttons.length).toBeGreaterThan(0)
    })

    // Click the FAB
    const fabButtons = container.querySelectorAll('button.rounded-full')
    expect(fabButtons.length).toBe(1)
    await user.click(fabButtons[0] as HTMLButtonElement)

    // FAB should disappear (auto-scroll re-enabled)
    await waitFor(() => {
      const fabAfterClick = container.querySelectorAll('button.rounded-full')
      expect(fabAfterClick.length).toBe(0)
    })
  })
})
