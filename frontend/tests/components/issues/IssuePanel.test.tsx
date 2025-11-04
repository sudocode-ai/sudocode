import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { IssuePanel } from '@/components/issues/IssuePanel'
import type { Issue } from '@sudocode-ai/types'

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
  closed_at: undefined,
  parent_id: 'ISSUE-000',
}

describe('IssuePanel', () => {
  it('should render issue details with editable fields', async () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(screen.getByText('ISSUE-001')).toBeInTheDocument()

    // Title should be in an editable input
    expect(screen.getByDisplayValue('Test Issue')).toBeInTheDocument()

    // Content is rendered by TiptapEditor
    await waitFor(() => {
      expect(screen.getByText(/Test content in detail/)).toBeInTheDocument()
    })

    // Status and Priority should be in selects
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('High (P1)')).toBeInTheDocument()

    expect(screen.getByText('john.doe')).toBeInTheDocument()
    expect(screen.getByText('ISSUE-000')).toBeInTheDocument()
  })

  it('should render close button when onClose is provided', () => {
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    expect(screen.getByLabelText('Back')).toBeInTheDocument()
  })

  it('should call onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    const closeButton = screen.getByLabelText('Back')
    await user.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should render save status when onUpdate is provided', () => {
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })

  it('should render Delete button when onDelete is provided', () => {
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    expect(screen.getByLabelText('Delete')).toBeInTheDocument()
  })

  it('should show unsaved changes status when fields are modified', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    // Initially should show all saved
    expect(screen.getByText('All changes saved')).toBeInTheDocument()

    // Modify the title
    const titleInput = screen.getByPlaceholderText('Issue title...')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Title')

    // Should show unsaved changes
    expect(screen.getByText('Unsaved changes...')).toBeInTheDocument()
  })

  it('should auto-save changes after debounce', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onUpdate={onUpdate} />)

    // Modify the title
    const titleInput = screen.getByPlaceholderText('Issue title...')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Title')

    // Wait for auto-save debounce (1 second)
    await waitFor(
      () => {
        expect(onUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Updated Title',
          })
        )
      },
      { timeout: 2000 }
    )
  })

  it('should show delete confirmation dialog when Delete button is clicked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onDelete={onDelete} />)

    const deleteButton = screen.getByLabelText('Delete')
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
    const deleteButton = screen.getByLabelText('Delete')
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
    const deleteButton = screen.getByLabelText('Delete')
    await user.click(deleteButton)

    // Cancel deletion in dialog
    const cancelButton = await screen.findByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('should show Saving status and disable Delete button when isUpdating is true', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(
      <IssuePanel issue={mockIssue} onUpdate={onUpdate} onDelete={onDelete} isUpdating={true} />
    )

    // When isUpdating is true, should show "Saving..." status
    expect(screen.getByText('Saving...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
  })

  it('should disable Delete button when isDeleting is true', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(
      <IssuePanel issue={mockIssue} onUpdate={onUpdate} onDelete={onDelete} isDeleting={true} />
    )

    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
  })

  it('should display formatted timestamps', () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    // Check that timestamps are formatted (not raw ISO strings)
    expect(screen.queryByText('2024-01-01T10:00:00Z')).not.toBeInTheDocument()
    expect(screen.queryByText('2024-01-02T15:30:00Z')).not.toBeInTheDocument()

    // Should have "Updated" timestamp
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
  })

  it('should not show closed_at when issue is not closed', () => {
    renderWithProviders(<IssuePanel issue={mockIssue} />)

    expect(screen.queryByText(/Closed/)).not.toBeInTheDocument()
  })

  it('should show closed_at when issue is closed', () => {
    const closedIssue = {
      ...mockIssue,
      status: 'closed' as const,
      closed_at: '2024-01-03T12:00:00Z',
    }

    renderWithProviders(<IssuePanel issue={closedIssue} />)

    expect(screen.getByText(/Closed.*ago/)).toBeInTheDocument()
  })

  it('should not show assignee section when assignee is undefined', () => {
    const issueWithoutAssignee = { ...mockIssue, assignee: undefined }

    renderWithProviders(<IssuePanel issue={issueWithoutAssignee} />)

    expect(screen.queryByText('Assignee')).not.toBeInTheDocument()
    expect(screen.queryByText('john.doe')).not.toBeInTheDocument()
  })

  it('should not show parent section when parent_id is undefined', () => {
    const issueWithoutParent = { ...mockIssue, parent_id: undefined }

    renderWithProviders(<IssuePanel issue={issueWithoutParent} />)

    expect(screen.queryByText('Parent Issue')).not.toBeInTheDocument()
    expect(screen.queryByText('ISSUE-000')).not.toBeInTheDocument()
  })

  it('should render Archive button when issue is not archived', () => {
    const onArchive = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onArchive={onArchive} />)

    expect(screen.getByRole('button', { name: /Archive/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unarchive/ })).not.toBeInTheDocument()
  })

  it('should render Unarchive button when issue is archived', () => {
    const archivedIssue = { ...mockIssue, archived: true, archived_at: '2024-01-04T10:00:00Z' }
    const onUnarchive = vi.fn()

    renderWithProviders(<IssuePanel issue={archivedIssue} onUnarchive={onUnarchive} />)

    expect(screen.getByRole('button', { name: /Unarchive/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Archive$/ })).not.toBeInTheDocument()
  })

  it('should call onArchive when Archive button is clicked', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onArchive={onArchive} />)

    const archiveButton = screen.getByRole('button', { name: /Archive/ })
    await user.click(archiveButton)

    expect(onArchive).toHaveBeenCalledWith('ISSUE-001')
  })

  it('should call onUnarchive when Unarchive button is clicked', async () => {
    const user = userEvent.setup()
    const archivedIssue = { ...mockIssue, archived: true, archived_at: '2024-01-04T10:00:00Z' }
    const onUnarchive = vi.fn()

    renderWithProviders(<IssuePanel issue={archivedIssue} onUnarchive={onUnarchive} />)

    const unarchiveButton = screen.getByRole('button', { name: /Unarchive/ })
    await user.click(unarchiveButton)

    expect(onUnarchive).toHaveBeenCalledWith('ISSUE-001')
  })

  it('should disable Archive button when isUpdating is true', () => {
    const onArchive = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onArchive={onArchive} isUpdating={true} />)

    expect(screen.getByRole('button', { name: /Archive/ })).toBeDisabled()
  })

  it('should call onClose when ESC key is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should not call onClose when ESC is pressed while delete dialog is open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDelete = vi.fn()

    renderWithProviders(<IssuePanel issue={mockIssue} onClose={onClose} onDelete={onDelete} />)

    // Open delete dialog
    const deleteButton = screen.getByLabelText('Delete')
    await user.click(deleteButton)

    // ESC should not close the panel when dialog is open
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })
})
