/**
 * Tests for AddFeedbackDialog component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AddFeedbackDialog } from '@/components/specs/AddFeedbackDialog'

describe('AddFeedbackDialog', () => {
  const mockIssues = [
    {
      id: 'ISSUE-001',
      uuid: 'uuid-001',
      title: 'Test Issue 1',
      content: 'Test content',
      status: 'open' as const,
      priority: 1,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      archived: false,
    },
    {
      id: 'ISSUE-002',
      uuid: 'uuid-002',
      title: 'Test Issue 2',
      content: 'Test content 2',
      status: 'open' as const,
      priority: 2,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      archived: false,
    },
  ]

  it('should render trigger button', () => {
    const onSubmit = vi.fn()
    render(<AddFeedbackDialog issues={mockIssues} onSubmit={onSubmit} />)

    expect(screen.getByRole('button', { name: /add feedback/i })).toBeInTheDocument()
  })

  it('should disable button when no issues available', () => {
    const onSubmit = vi.fn()
    render(<AddFeedbackDialog issues={[]} onSubmit={onSubmit} />)

    expect(screen.getByRole('button', { name: /add feedback/i })).toBeInTheDocument()
  })

  it('should open dialog when button clicked', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AddFeedbackDialog issues={mockIssues} onSubmit={onSubmit} />)

    const button = screen.getByRole('button', { name: /add feedback/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: /add feedback/i })).toBeInTheDocument()
  })

  it('should show line number in dialog description when provided', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AddFeedbackDialog issues={mockIssues} lineNumber={42} onSubmit={onSubmit} />)

    const button = screen.getByRole('button', { name: /add feedback/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText(/anchored to line 42/i)).toBeInTheDocument()
    })
  })

  it('should render feedback form inside dialog', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AddFeedbackDialog issues={mockIssues} onSubmit={onSubmit} />)

    const button = screen.getByRole('button', { name: /add feedback/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByLabelText(/type/i)).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/content/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add feedback/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('should close dialog when cancel clicked', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AddFeedbackDialog issues={mockIssues} onSubmit={onSubmit} />)

    // Open dialog
    const openButton = screen.getByRole('button', { name: /add feedback/i })
    await user.click(openButton)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Click cancel
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should call onSubmit and close dialog when form submitted', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AddFeedbackDialog issues={mockIssues} onSubmit={onSubmit} />)

    // Open dialog
    const openButton = screen.getByRole('button', { name: /add feedback/i })
    await user.click(openButton)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Select an issue first
    const issueSelect = screen.getByRole('combobox', { name: /issue/i })
    await user.click(issueSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /issue-001/i })).toBeInTheDocument()
    })

    const issueOption = screen.getByRole('option', { name: /issue-001/i })
    await user.click(issueOption)

    // Fill form
    const contentInput = screen.getByLabelText(/content/i)
    await user.type(contentInput, 'Test feedback content')

    // Wait for submit button to be enabled
    const submitButtons = screen.getAllByRole('button', { name: /add feedback/i })
    const submitButton = submitButtons[submitButtons.length - 1]

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled()
    })

    await user.click(submitButton)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled()
    })

    // Check call arguments
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'comment',
        content: 'Test feedback content',
      })
    )

    // Dialog should close after submission
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should include anchor when lineNumber provided', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AddFeedbackDialog issues={mockIssues} lineNumber={10} onSubmit={onSubmit} />)

    // Open dialog
    const openButton = screen.getByRole('button', { name: /add feedback/i })
    await user.click(openButton)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Select an issue first
    const issueSelect = screen.getByRole('combobox', { name: /issue/i })
    await user.click(issueSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /issue-001/i })).toBeInTheDocument()
    })

    const issueOption = screen.getByRole('option', { name: /issue-001/i })
    await user.click(issueOption)

    // Fill form
    const contentInput = screen.getByLabelText(/content/i)
    await user.type(contentInput, 'Test feedback with anchor')

    // Wait for submit button to be enabled
    const submitButtons = screen.getAllByRole('button', { name: /add feedback/i })
    const submitButton = submitButtons[submitButtons.length - 1]

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled()
    })

    await user.click(submitButton)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled()
    })

    // Verify that anchor was included
    const callArgs = onSubmit.mock.calls[0][0]
    expect(callArgs.type).toBe('comment')
    expect(callArgs.content).toBe('Test feedback with anchor')
    expect(callArgs.anchor).toBeDefined()
    expect(callArgs.anchor.line_number).toBe(10)
    expect(callArgs.anchor.anchor_status).toBe('valid')
  })

  it('should include text snippet in anchor when provided', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <AddFeedbackDialog
        issues={mockIssues}
        lineNumber={10}
        textSnippet="selected text snippet"
        onSubmit={onSubmit}
      />
    )

    // Open dialog
    const openButton = screen.getByRole('button', { name: /add feedback/i })
    await user.click(openButton)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Verify snippet is shown
    expect(screen.getByText(/"selected text snippet"/i)).toBeInTheDocument()

    // Select an issue first
    const issueSelect = screen.getByRole('combobox', { name: /issue/i })
    await user.click(issueSelect)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /issue-001/i })).toBeInTheDocument()
    })

    const issueOption = screen.getByRole('option', { name: /issue-001/i })
    await user.click(issueOption)

    // Fill form
    const contentInput = screen.getByLabelText(/content/i)
    await user.type(contentInput, 'Test feedback')

    // Wait for submit button to be enabled
    const submitButtons = screen.getAllByRole('button', { name: /add feedback/i })
    const submitButton = submitButtons[submitButtons.length - 1]

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled()
    })

    await user.click(submitButton)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled()
    })

    // Verify that anchor includes text snippet
    const callArgs = onSubmit.mock.calls[0][0]
    expect(callArgs.anchor).toBeDefined()
    expect(callArgs.anchor.line_number).toBe(10)
    expect(callArgs.anchor.text_snippet).toBe('selected text snippet')
    expect(callArgs.anchor.anchor_status).toBe('valid')
  })
})
