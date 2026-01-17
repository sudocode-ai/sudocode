import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CleanupWorktreeDialog } from '@/components/executions/CleanupWorktreeDialog'
import type { Execution } from '@/types/execution'

describe('CleanupWorktreeDialog', () => {
  const mockExecution: Execution = {
    id: 'exec-123',
    issue_id: 'i-test1',
    issue_uuid: 'uuid-123',
    mode: 'worktree',
    prompt: 'Test prompt',
    config: JSON.stringify({ mode: 'worktree' }),
    agent_type: 'claude-code',
    session_id: 'session-123',
    workflow_execution_id: null,
    target_branch: 'main',
    branch_name: 'feature/test-branch',
    before_commit: 'abc123',
    after_commit: 'def456',
    worktree_path: '/path/to/worktree',
    status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T01:00:00Z',
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T01:00:00Z',
    cancelled_at: null,
    exit_code: 0,
    error_message: null,
    error: null,
    model: 'claude-sonnet-4',
    summary: 'Completed successfully',
    files_changed: JSON.stringify(['file1.ts', 'file2.ts']),
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
    stream_id: null,
    deleted_at: null,
    deletion_reason: null,
  }

  const mockOnClose = vi.fn()
  const mockOnConfirm = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
    mockOnConfirm.mockClear()
  })

  it('should render dialog when open', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.getByText('Cleanup Worktree')).toBeInTheDocument()
    expect(screen.getByText('Permanently delete the worktree directory')).toBeInTheDocument()
  })

  it('should not render dialog when closed', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={false}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.queryByText('Cleanup Worktree')).not.toBeInTheDocument()
  })

  it('should display worktree path', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.getByText('/path/to/worktree')).toBeInTheDocument()
    expect(screen.getByText('Worktree Path')).toBeInTheDocument()
  })

  it('should display worktree branch name', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.getByText('feature/test-branch')).toBeInTheDocument()
    expect(screen.getByText(/Worktree branch/)).toBeInTheDocument()
  })

  it('should display base branch', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText(/Base Branch/)).toBeInTheDocument()
  })

  it('should have delete branch checkbox checked by default', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()
  })

  it('should toggle delete branch checkbox', async () => {
    const user = userEvent.setup()
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)
    expect(checkbox).toBeChecked()
  })

  it('should show "to be deleted" text when checkbox is checked', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.getByText(/to be deleted/)).toBeInTheDocument()
  })

  it('should call onConfirm with deleteBranch=true when confirmed with checkbox checked', async () => {
    const user = userEvent.setup()
    mockOnConfirm.mockResolvedValue(undefined)

    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const deleteButton = screen.getByRole('button', { name: /Delete/i })
    await user.click(deleteButton)

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalledWith(true)
    })
  })

  it('should call onConfirm with deleteBranch=false when confirmed with checkbox unchecked', async () => {
    const user = userEvent.setup()
    mockOnConfirm.mockResolvedValue(undefined)

    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox) // Uncheck

    const deleteButton = screen.getByRole('button', { name: /Delete/i })
    await user.click(deleteButton)

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalledWith(false)
    })
  })

  it('should show loading state while cleaning', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        isCleaning={true}
      />
    )

    expect(screen.getByText('Deleting...')).toBeInTheDocument()

    const deleteButton = screen.getByRole('button', { name: /Deleting.../i })
    expect(deleteButton).toBeDisabled()
  })

  it('should disable controls during cleanup', () => {
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        isCleaning={true}
      />
    )

    const checkbox = screen.getByRole('checkbox')
    const cancelButton = screen.getByRole('button', { name: /Cancel/i })
    const deleteButton = screen.getByRole('button', { name: /Deleting.../i })

    expect(checkbox).toBeDisabled()
    expect(cancelButton).toBeDisabled()
    expect(deleteButton).toBeDisabled()
  })

  it('should call onClose when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /Cancel/i })
    await user.click(cancelButton)

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should display descriptive text about branch deletion based on checkbox state', async () => {
    const user = userEvent.setup()
    render(
      <CleanupWorktreeDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    // Initially checked - should show deletion warning
    expect(screen.getByText(/The branch will be deleted/)).toBeInTheDocument()

    // Uncheck
    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    // Should show preservation message
    expect(screen.getByText(/The branch will be preserved/)).toBeInTheDocument()
  })

  it('should handle execution with null worktree_path', () => {
    const executionWithoutWorktree: Execution = {
      ...mockExecution,
      worktree_path: null,
    }

    render(
      <CleanupWorktreeDialog
        execution={executionWithoutWorktree}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    // Should still render but show null
    expect(screen.getByText('Cleanup Worktree')).toBeInTheDocument()
  })
})
