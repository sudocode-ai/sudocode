import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { DeleteIssueDialog } from '@/components/issues/DeleteIssueDialog'
import type { Issue } from '@sudocode/types'

const mockIssue: Issue = {
  id: 'ISSUE-001',
  uuid: 'test-uuid-1',
  title: 'Test Issue to Delete',
  content: 'Test content',
  status: 'open',
  priority: 2,
  assignee: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  closed_at: null,
  parent_id: null,
}

describe('DeleteIssueDialog', () => {
  it('should not render when isOpen is false', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    renderWithProviders(
      <DeleteIssueDialog
        issue={mockIssue}
        isOpen={false}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )

    expect(screen.queryByText('Delete Issue')).not.toBeInTheDocument()
  })

  it('should render when isOpen is true', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    renderWithProviders(
      <DeleteIssueDialog
        issue={mockIssue}
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByText('Delete Issue')).toBeInTheDocument()
    expect(screen.getByText(/Test Issue to Delete/)).toBeInTheDocument()
    expect(screen.getByText(/ISSUE-001/)).toBeInTheDocument()
    expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument()
  })

  it('should call onConfirm when Delete button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    renderWithProviders(
      <DeleteIssueDialog
        issue={mockIssue}
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )

    const deleteButton = screen.getByRole('button', { name: /Delete/ })
    await user.click(deleteButton)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('should call onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    renderWithProviders(
      <DeleteIssueDialog
        issue={mockIssue}
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('should disable buttons when isDeleting is true', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    renderWithProviders(
      <DeleteIssueDialog
        issue={mockIssue}
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        isDeleting={true}
      />
    )

    expect(screen.getByRole('button', { name: /Deleting\.\.\./ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled()
  })

  it('should show "Deleting..." text when isDeleting is true', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    renderWithProviders(
      <DeleteIssueDialog
        issue={mockIssue}
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        isDeleting={true}
      />
    )

    expect(screen.getByRole('button', { name: /Deleting\.\.\./ })).toBeInTheDocument()
  })

  it('should return null when issue is null', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    const { container } = renderWithProviders(
      <DeleteIssueDialog
        issue={null}
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('should call onClose when dialog overlay is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    renderWithProviders(
      <DeleteIssueDialog
        issue={mockIssue}
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )

    // Pressing Escape should trigger onClose
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
