import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeleteAllWorkflowsDialog } from '@/components/workflows/DeleteAllWorkflowsDialog'

describe('DeleteAllWorkflowsDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    inactiveCount: 5,
    isDeleting: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('should render dialog with inactive workflow count', () => {
    render(<DeleteAllWorkflowsDialog {...defaultProps} />)
    expect(screen.getByText('Delete All Inactive Workflows')).toBeInTheDocument()
    expect(screen.getByText(/5 inactive workflows/)).toBeInTheDocument()
  })

  it('should handle singular workflow count', () => {
    render(<DeleteAllWorkflowsDialog {...defaultProps} inactiveCount={1} />)
    expect(screen.getByText(/1 inactive workflow\?/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete 1 Workflow' })).toBeInTheDocument()
  })

  it('should render cleanup options checkboxes', () => {
    render(<DeleteAllWorkflowsDialog {...defaultProps} />)
    expect(screen.getByLabelText(/Delete worktrees/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Delete branches/)).toBeInTheDocument()
  })

  it('should have cleanup options checked by default', () => {
    render(<DeleteAllWorkflowsDialog {...defaultProps} />)
    expect(screen.getByLabelText(/Delete worktrees/)).toBeChecked()
    expect(screen.getByLabelText(/Delete branches/)).toBeChecked()
  })

  it('should call onConfirm with correct options when delete clicked', async () => {
    render(<DeleteAllWorkflowsDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Delete 5 Workflows/ }))
    await waitFor(() => {
      expect(defaultProps.onConfirm).toHaveBeenCalledWith({
        deleteWorktrees: true,
        deleteBranches: true,
      })
    })
  })

  it('should call onConfirm with unchecked options', async () => {
    render(<DeleteAllWorkflowsDialog {...defaultProps} />)
    fireEvent.click(screen.getByLabelText(/Delete worktrees/))
    fireEvent.click(screen.getByLabelText(/Delete branches/))
    fireEvent.click(screen.getByRole('button', { name: /Delete 5 Workflows/ }))
    await waitFor(() => {
      expect(defaultProps.onConfirm).toHaveBeenCalledWith({
        deleteWorktrees: false,
        deleteBranches: false,
      })
    })
  })

  it('should show progress when deleting', () => {
    render(
      <DeleteAllWorkflowsDialog
        {...defaultProps}
        isDeleting={true}
        deletionProgress={{ current: 3, total: 5 }}
      />
    )
    expect(screen.getByText(/Deleting 3 of 5/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deleting/ })).toBeDisabled()
  })

  it('should hide cleanup options while deleting', () => {
    render(
      <DeleteAllWorkflowsDialog
        {...defaultProps}
        isDeleting={true}
        deletionProgress={{ current: 1, total: 5 }}
      />
    )
    expect(screen.queryByLabelText(/Delete worktrees/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Delete branches/)).not.toBeInTheDocument()
  })

  it('should disable buttons while deleting', () => {
    render(
      <DeleteAllWorkflowsDialog
        {...defaultProps}
        isDeleting={true}
        deletionProgress={{ current: 1, total: 5 }}
      />
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Deleting/ })).toBeDisabled()
  })

  it('should call onOpenChange when cancel clicked', () => {
    render(<DeleteAllWorkflowsDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('should not close while deleting', () => {
    render(
      <DeleteAllWorkflowsDialog
        {...defaultProps}
        isDeleting={true}
        deletionProgress={{ current: 1, total: 5 }}
      />
    )
    // Try clicking overlay/cancel
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // Dialog should still be open since isDeleting is true
    expect(screen.getByText('Delete All Inactive Workflows')).toBeInTheDocument()
  })

  it('should persist deleteWorktrees preference in localStorage', () => {
    const { rerender } = render(<DeleteAllWorkflowsDialog {...defaultProps} />)

    // Uncheck the worktrees checkbox
    fireEvent.click(screen.getByLabelText(/Delete worktrees/))

    // Verify localStorage was updated
    expect(localStorage.getItem('deleteAllWorkflows.deleteWorktrees')).toBe('false')

    // Re-render and verify checkbox state persisted
    rerender(<DeleteAllWorkflowsDialog {...defaultProps} open={false} />)
    rerender(<DeleteAllWorkflowsDialog {...defaultProps} open={true} />)
    expect(screen.getByLabelText(/Delete worktrees/)).not.toBeChecked()
  })

  it('should persist deleteBranches preference in localStorage', () => {
    const { rerender } = render(<DeleteAllWorkflowsDialog {...defaultProps} />)

    // Uncheck the branches checkbox
    fireEvent.click(screen.getByLabelText(/Delete branches/))

    // Verify localStorage was updated
    expect(localStorage.getItem('deleteAllWorkflows.deleteBranches')).toBe('false')

    // Re-render and verify checkbox state persisted
    rerender(<DeleteAllWorkflowsDialog {...defaultProps} open={false} />)
    rerender(<DeleteAllWorkflowsDialog {...defaultProps} open={true} />)
    expect(screen.getByLabelText(/Delete branches/)).not.toBeChecked()
  })
})
