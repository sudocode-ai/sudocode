import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExecutionView } from '@/components/executions/ExecutionView'
import { executionsApi } from '@/lib/api'
import type { Execution } from '@/types/execution'

// Mock the API and child components
vi.mock('@/lib/api', () => ({
  executionsApi: {
    getById: vi.fn(),
    cancel: vi.fn(),
    createFollowUp: vi.fn(),
    deleteWorktree: vi.fn(),
    worktreeExists: vi.fn(),
  },
}))

vi.mock('@/components/executions/ExecutionMonitor', () => ({
  ExecutionMonitor: ({ executionId, onComplete }: any) => (
    <div data-testid="execution-monitor">
      <div>ExecutionMonitor for {executionId}</div>
      <button onClick={onComplete}>Trigger Complete</button>
    </div>
  ),
}))

vi.mock('@/components/executions/FollowUpDialog', () => ({
  FollowUpDialog: ({ open, onSubmit, onCancel }: any) =>
    open ? (
      <div data-testid="follow-up-dialog">
        <button onClick={() => onSubmit('Test feedback')}>Submit</button>
        <button onClick={onCancel}>Cancel</button>
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

  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: worktree doesn't exist
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: false })
  })

  it('should display loading state initially', () => {
    vi.mocked(executionsApi.getById).mockReturnValue(new Promise(() => {}))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    expect(screen.getByText('Loading execution...')).toBeInTheDocument()
  })

  it('should load and display execution metadata', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue(mockExecution)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Execution')).toBeInTheDocument()
    })

    expect(screen.getByText('exec-123')).toBeInTheDocument()
    expect(screen.getByText('ISSUE-001')).toBeInTheDocument()
    expect(screen.getByText('worktree')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('should display error when loading fails', async () => {
    vi.mocked(executionsApi.getById).mockRejectedValue(new Error('Network error'))

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Error Loading Execution')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('should show running status badge', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue(mockExecution)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
  })

  it('should show completed status badge', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
      completed_at: '2025-01-15T10:05:00Z',
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('should show failed status badge', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'failed',
      error: 'Test error message',
      completed_at: '2025-01-15T10:05:00Z',
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('Test error message')).toBeInTheDocument()
    })
  })

  it('should show Cancel button when execution is running', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue(mockExecution)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
    })
  })

  it('should not show Cancel button when execution is completed', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument()
  })

  it('should show Follow Up button when execution is completed', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Follow Up/ })).toBeInTheDocument()
    })
  })

  it('should show Follow Up button when execution failed', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'failed',
      error: 'Test error',
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Follow Up/ })).toBeInTheDocument()
    })
  })

  it('should cancel execution when Cancel button clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.getById).mockResolvedValue(mockExecution)
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

  it('should open FollowUpDialog when Follow Up button clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Follow Up/ })).toBeInTheDocument()
    })

    const followUpButton = screen.getByRole('button', { name: /Follow Up/ })
    await user.click(followUpButton)

    expect(screen.getByTestId('follow-up-dialog')).toBeInTheDocument()
  })

  it('should create follow-up execution when dialog submitted', async () => {
    const user = userEvent.setup()
    const newExecution = { ...mockExecution, id: 'exec-456' }
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })
    vi.mocked(executionsApi.createFollowUp).mockResolvedValue(newExecution)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Follow Up/ })).toBeInTheDocument()
    })

    const followUpButton = screen.getByRole('button', { name: /Follow Up/ })
    await user.click(followUpButton)

    const submitButton = screen.getByRole('button', { name: /Submit/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(executionsApi.createFollowUp).toHaveBeenCalledWith('exec-123', {
        feedback: 'Test feedback',
      })
      expect(mockOnFollowUpCreated).toHaveBeenCalledWith('exec-456')
    })
  })

  it('should display ExecutionMonitor for running execution', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue(mockExecution)

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('execution-monitor')).toBeInTheDocument()
      expect(screen.getByText('ExecutionMonitor for exec-123')).toBeInTheDocument()
    })
  })

  it('should reload execution when monitor completes', async () => {
    const user = userEvent.setup()
    const completedExecution = { ...mockExecution, status: 'completed' as const }

    vi.mocked(executionsApi.getById)
      .mockResolvedValueOnce(mockExecution)
      .mockResolvedValueOnce(completedExecution)

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
      expect(executionsApi.getById).toHaveBeenCalledTimes(2)
    })
  })

  it('should display timestamps when available', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
      completed_at: '2025-01-15T10:05:00Z',
    })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByText(/Created:/)).toBeInTheDocument()
      expect(screen.getByText(/Started:/)).toBeInTheDocument()
      expect(screen.getByText(/Completed:/)).toBeInTheDocument()
    })
  })

  it('should display ExecutionMonitor for preparing status', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'preparing',
    })

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
    vi.mocked(executionsApi.getById).mockResolvedValue(mockExecution)
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
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })
    vi.mocked(executionsApi.worktreeExists).mockResolvedValue({ exists: true })

    renderWithProviders(
      <ExecutionView executionId="exec-123" onFollowUpCreated={mockOnFollowUpCreated} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete Worktree/ })).toBeInTheDocument()
    })
  })

  it('should not show Delete Worktree button when worktree does not exist', async () => {
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })
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
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })
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
    const updatedExecution = { ...mockExecution, status: 'completed' as const }

    vi.mocked(executionsApi.getById)
      .mockResolvedValueOnce({ ...mockExecution, status: 'completed' })
      .mockResolvedValueOnce(updatedExecution)
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
    vi.mocked(executionsApi.getById).mockResolvedValue({
      ...mockExecution,
      status: 'completed',
    })
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
})
