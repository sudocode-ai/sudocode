import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { IssueEditor } from '@/components/issues/IssueEditor'
import type { Issue } from '@sudocode/types'

const mockIssue: Issue = {
  id: 'ISSUE-001',
  uuid: 'test-uuid-1',
  title: 'Test Issue',
  content: 'Test content',
  status: 'open',
  priority: 2,
  assignee: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  closed_at: null,
  parent_id: null,
}

describe('IssueEditor', () => {
  it('should render empty form when creating new issue', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={null} onSave={onSave} onCancel={onCancel} />)

    expect(screen.getByLabelText(/Title/)).toHaveValue('')
    expect(screen.getByRole('button', { name: /Create Issue/ })).toBeInTheDocument()
  })

  it('should render pre-filled form when editing existing issue', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={mockIssue} onSave={onSave} onCancel={onCancel} />)

    expect(screen.getByLabelText(/Title/)).toHaveValue('Test Issue')
    expect(screen.getByRole('button', { name: /Update Issue/ })).toBeInTheDocument()
  })

  it('should show validation error when title is empty', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={null} onSave={onSave} onCancel={onCancel} />)

    const submitButton = screen.getByRole('button', { name: /Create Issue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument()
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should show validation error when title exceeds 200 characters', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={null} onSave={onSave} onCancel={onCancel} />)

    const titleInput = screen.getByLabelText(/Title/)
    const longTitle = 'a'.repeat(201)
    await user.type(titleInput, longTitle)

    const submitButton = screen.getByRole('button', { name: /Create Issue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Title must be less than 200 characters')).toBeInTheDocument()
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should call onSave with form data when valid', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={null} onSave={onSave} onCancel={onCancel} />)

    const titleInput = screen.getByLabelText(/Title/)

    await user.type(titleInput, 'New Issue Title')

    const submitButton = screen.getByRole('button', { name: /Create Issue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Issue Title',
          status: 'open',
          priority: 2,
        })
      )
    })
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={null} onSave={onSave} onCancel={onCancel} />)

    // Get all Cancel buttons and click the last one (form's Cancel button)
    const cancelButtons = screen.getAllByRole('button', { name: /Cancel/ })
    await user.click(cancelButtons[cancelButtons.length - 1])

    expect(onCancel).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('should disable form when isLoading is true', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(
      <IssueEditor issue={null} onSave={onSave} onCancel={onCancel} isLoading={true} />
    )

    expect(screen.getByLabelText(/Title/)).toBeDisabled()
    expect(screen.getByRole('button', { name: /Saving\.\.\./ })).toBeDisabled()
    // Get all Cancel buttons and check the last one (form's Cancel button) is disabled
    const cancelButtons = screen.getAllByRole('button', { name: /Cancel/ })
    expect(cancelButtons[cancelButtons.length - 1]).toBeDisabled()
  })

  it.skip('should update status via selector (skipped due to jsdom/Radix UI portal limitations)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={null} onSave={onSave} onCancel={onCancel} />)

    const titleInput = screen.getByLabelText(/Title/)
    await user.type(titleInput, 'Test Issue')

    // Open status selector
    const statusTrigger = screen.getByRole('combobox', { name: /Status/ })
    await user.click(statusTrigger)

    // Select "Blocked"
    const blockedOption = await screen.findByRole('option', { name: /Blocked/ })
    await user.click(blockedOption)

    const submitButton = screen.getByRole('button', { name: /Create Issue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'blocked',
        })
      )
    })
  })

  it.skip('should update priority via selector (skipped due to jsdom/Radix UI portal limitations)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onCancel = vi.fn()

    renderWithProviders(<IssueEditor issue={null} onSave={onSave} onCancel={onCancel} />)

    const titleInput = screen.getByLabelText(/Title/)
    await user.type(titleInput, 'Test Issue')

    // Open priority selector
    const priorityTrigger = screen.getByRole('combobox', { name: /Priority/ })
    await user.click(priorityTrigger)

    // Select "Critical (P0)"
    const p0Option = await screen.findByRole('option', { name: /Critical \(P0\)/ })
    await user.click(p0Option)

    const submitButton = screen.getByRole('button', { name: /Create Issue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 0,
        })
      )
    })
  })

  it('should update form when issue prop changes', async () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()

    const { rerender } = renderWithProviders(
      <IssueEditor issue={mockIssue} onSave={onSave} onCancel={onCancel} />
    )

    expect(screen.getByLabelText(/Title/)).toHaveValue('Test Issue')

    const updatedIssue = { ...mockIssue, title: 'Updated Title' }
    rerender(<IssueEditor issue={updatedIssue} onSave={onSave} onCancel={onCancel} />)

    await waitFor(() => {
      expect(screen.getByLabelText(/Title/)).toHaveValue('Updated Title')
    })
  })
})
