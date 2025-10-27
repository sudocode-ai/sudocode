import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { IssuePanel } from '@/components/issues/IssuePanel'
import type { Issue } from '@sudocode/types'

const mockIssue: Issue = {
  id: 'ISSUE-001',
  uuid: 'test-uuid-1',
  title: 'Test Issue',
  content: 'Test content in detail',
  status: 'in_progress',
  priority: 1,
  assignee: 'john.doe',
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-02T15:30:00Z',
  closed_at: null,
  parent_id: 'ISSUE-000',
}

describe('IssuePanel', () => {
  it('should render issue details in view mode', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(screen.getByText('Test Issue')).toBeInTheDocument()
    expect(screen.getByText('ISSUE-001')).toBeInTheDocument()
    // Content is rendered by TiptapMarkdownViewer, wait for it to appear
    await waitFor(() => {
      expect(screen.getByText(/Test content in detail/)).toBeInTheDocument()
    })
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('john.doe')).toBeInTheDocument()
    expect(screen.getByText('ISSUE-000')).toBeInTheDocument()
  })

  it('should render close button when onClose is provided', () => {
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('should call onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    const closeButton = screen.getByLabelText('Close')
    await user.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should render Edit button when onUpdate is provided', () => {
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument()
  })

  it('should render Delete button when onDelete is provided', () => {
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument()
  })

  it('should switch to edit mode when Edit button is clicked', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    const editButton = screen.getByRole('button', { name: /Edit/ })
    await user.click(editButton)

    // Should show the edit form
    await waitFor(() => {
      expect(screen.getByText('Edit Issue')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Update Issue/ })).toBeInTheDocument()
    })
  })

  it('should call onUpdate when edit form is saved', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    // Enter edit mode
    const editButton = screen.getByRole('button', { name: /Edit/ })
    await user.click(editButton)

    // Modify the title
    const titleInput = screen.getByLabelText(/Title/)
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Title')

    // Save changes
    const saveButton = screen.getByRole('button', { name: /Update Issue/ })
    await user.click(saveButton)

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated Title',
        })
      )
    })
  })

  it('should exit edit mode and not save when Cancel is clicked in edit form', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    // Enter edit mode
    const editButton = screen.getByRole('button', { name: /Edit/ })
    await user.click(editButton)

    // Cancel editing - get all Cancel buttons and click the last one (form's Cancel button)
    const cancelButtons = screen.getAllByRole('button', { name: /Cancel/ })
    await user.click(cancelButtons[cancelButtons.length - 1])

    // Should return to view mode
    await waitFor(() => {
      expect(screen.queryByText('Edit Issue')).not.toBeInTheDocument()
      expect(screen.getByText('Test Issue')).toBeInTheDocument()
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('should show delete confirmation dialog when Delete button is clicked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    const deleteButton = screen.getByRole('button', { name: /Delete/ })
    await user.click(deleteButton)

    // Should show delete confirmation dialog
    await waitFor(() => {
      expect(screen.getByText('Delete Issue')).toBeInTheDocument()
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument()
    })
  })

  it('should call onDelete when delete is confirmed', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    // Click Delete button
    const deleteButton = screen.getByRole('button', { name: /^Delete$/ })
    await user.click(deleteButton)

    // Confirm deletion in dialog
    const confirmButton = await screen.findByRole('button', { name: /^Delete$/ })
    await user.click(confirmButton)

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should not call onDelete when deletion is cancelled', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    // Click Delete button
    const deleteButton = screen.getByRole('button', { name: /^Delete$/ })
    await user.click(deleteButton)

    // Cancel deletion in dialog
    const cancelButton = await screen.findByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('should disable Edit and Delete buttons when isUpdating is true', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(
      <IssuePanel issue={mockIssue} onUpdate={onUpdate} onDelete={onDelete} isUpdating={true} />
    )

    expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
  })

  it('should disable Edit and Delete buttons when isDeleting is true', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(
      <IssuePanel issue={mockIssue} onUpdate={onUpdate} onDelete={onDelete} isDeleting={true} />
    )

    expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
  })

  it('should display formatted timestamps', () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    // Check that timestamps are formatted (not raw ISO strings)
    expect(screen.queryByText('2024-01-01T10:00:00Z')).not.toBeInTheDocument()
    expect(screen.queryByText('2024-01-02T15:30:00Z')).not.toBeInTheDocument()

    // Should have "Created:" and "Updated:" labels
    expect(screen.getByText(/Created:/)).toBeInTheDocument()
    expect(screen.getByText(/Updated:/)).toBeInTheDocument()
  })

  it('should not show closed_at when issue is not closed', () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(screen.queryByText(/Closed:/)).not.toBeInTheDocument()
  })

  it('should show closed_at when issue is closed', () => {
    const closedIssue = {
      ...mockIssue,
      status: 'closed' as const,
      closed_at: '2024-01-03T12:00:00Z',
    }

    renderWithProviders(<IssuePanel issue={closedIssue} />)

    expect(screen.getByText(/Closed:/)).toBeInTheDocument()
  })

  it('should not show assignee section when assignee is null', () => {
    const issueWithoutAssignee = { ...mockIssue, assignee: null }

    renderWithProviders(<IssuePanel issue={issueWithoutAssignee} />)

    expect(screen.queryByText('Assignee')).not.toBeInTheDocument()
    expect(screen.queryByText('john.doe')).not.toBeInTheDocument()
  })

  it('should not show parent section when parent_id is null', () => {
    const issueWithoutParent = { ...mockIssue, parent_id: null }

    renderWithProviders(<IssuePanel issue={issueWithoutParent} />)

    expect(screen.queryByText('Parent Issue')).not.toBeInTheDocument()
    expect(screen.queryByText('ISSUE-000')).not.toBeInTheDocument()
  })
})
