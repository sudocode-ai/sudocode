import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommitChangesDialog } from '@/components/executions/CommitChangesDialog'
import type { Execution } from '@/types/execution'

describe('CommitChangesDialog', () => {
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
    branch_name: 'feature/test',
    before_commit: 'abc123',
    after_commit: null,
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
    files_changed: JSON.stringify(['file1.ts', 'file2.ts', 'file3.ts']),
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
  }

  const mockOnClose = vi.fn()
  const mockOnConfirm = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
    mockOnConfirm.mockClear()
  })

  it('should render dialog when open', () => {
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.getByText('Commit Changes')).toBeInTheDocument()
    // The description includes file count and branch name
    expect(screen.getByText(/Commit 3 file changes to/)).toBeInTheDocument()
  })

  it('should not render dialog when closed', () => {
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={false}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.queryByText('Commit Changes')).not.toBeInTheDocument()
  })

  it('should display execution details', () => {
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    expect(screen.getByText('feature/test')).toBeInTheDocument()
  })

  it('should show placeholder commit message', () => {
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const textarea = screen.getByPlaceholderText(/Implement i-test1/)
    expect(textarea).toBeInTheDocument()
  })

  it('should enable commit button when message is entered', async () => {
    const user = userEvent.setup()
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const textarea = screen.getByPlaceholderText(/Implement i-test1/)
    const commitButton = screen.getByRole('button', { name: /Commit/i })

    // Initially enabled (pre-filled with "Implement i-test1")
    expect(commitButton).toBeEnabled()

    // Clear the message
    await user.clear(textarea)

    // Should be disabled with empty message
    expect(commitButton).toBeDisabled()

    // Type a new message
    await user.type(textarea, 'Fix bug in authentication')

    // Should be enabled now
    expect(commitButton).toBeEnabled()
  })

  it('should call onConfirm with commit message when committed', async () => {
    const user = userEvent.setup()
    mockOnConfirm.mockResolvedValue(undefined)

    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const textarea = screen.getByPlaceholderText(/Implement i-test1/)
    const commitButton = screen.getByRole('button', { name: /Commit/i })

    // Clear the pre-filled message and enter a new one
    await user.clear(textarea)
    await user.type(textarea, 'Fix bug in authentication')
    await user.click(commitButton)

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalledWith('Fix bug in authentication')
    })
  })

  it('should show loading state while committing', () => {
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        isCommitting={true}
      />
    )

    expect(screen.getByText('Committing...')).toBeInTheDocument()

    const commitButton = screen.getByRole('button', { name: /Committing.../i })
    expect(commitButton).toBeDisabled()
  })

  it('should disable close during commit', () => {
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        isCommitting={true}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /Cancel/i })
    expect(cancelButton).toBeDisabled()
  })

  it('should call onClose when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(
      <CommitChangesDialog
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

  it('should handle single file change text', () => {
    const singleFileExecution: Execution = {
      ...mockExecution,
      files_changed: JSON.stringify(['file1.ts']),
    }

    render(
      <CommitChangesDialog
        execution={singleFileExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    // The description includes file count and branch name
    expect(screen.getByText(/Commit 1 file change to/)).toBeInTheDocument()
  })

  it('should handle execution with no issue_id', () => {
    const noIssueExecution: Execution = {
      ...mockExecution,
      issue_id: null,
    }

    render(
      <CommitChangesDialog
        execution={noIssueExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const textarea = screen.getByPlaceholderText(/Commit changes from execution/)
    expect(textarea).toBeInTheDocument()
  })

  it('should prevent empty commit message', async () => {
    const user = userEvent.setup()
    render(
      <CommitChangesDialog
        execution={mockExecution}
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    )

    const textarea = screen.getByPlaceholderText(/Implement i-test1/)
    const commitButton = screen.getByRole('button', { name: /Commit/i })

    // Clear the pre-filled message
    await user.clear(textarea)

    // Button should be disabled with empty message
    expect(commitButton).toBeDisabled()

    // Try to click anyway (shouldn't call onConfirm)
    await user.click(commitButton)
    expect(mockOnConfirm).not.toHaveBeenCalled()
  })
})
