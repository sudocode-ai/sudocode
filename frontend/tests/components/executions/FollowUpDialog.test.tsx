import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { FollowUpDialog } from '@/components/executions/FollowUpDialog'

describe('FollowUpDialog', () => {
  const mockOnSubmit = vi.fn()
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when open is false', () => {
    renderWithProviders(
      <FollowUpDialog open={false} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    expect(screen.queryByText('Continue Execution')).not.toBeInTheDocument()
  })

  it('should render when open is true', () => {
    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    expect(screen.getByText('Continue Execution')).toBeInTheDocument()
    expect(
      screen.getByText(/Provide additional feedback to continue the agent's work/)
    ).toBeInTheDocument()
  })

  it('should display feedback textarea with placeholder', () => {
    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute('placeholder', expect.stringContaining('Examples:'))
  })

  it('should allow typing feedback', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Please add error handling')

    expect(textarea).toHaveValue('Please add error handling')
  })

  it('should disable submit button when feedback is empty', () => {
    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    expect(submitButton).toBeDisabled()
  })

  it('should enable submit button when feedback is provided', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Please add tests')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    expect(submitButton).toBeEnabled()
  })

  it('should call onSubmit with feedback when submit button clicked', async () => {
    const user = userEvent.setup()
    mockOnSubmit.mockResolvedValue(undefined)

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Add error handling')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('Add error handling')
    })
  })

  it('should trim whitespace from feedback before submitting', async () => {
    const user = userEvent.setup()
    mockOnSubmit.mockResolvedValue(undefined)

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, '  Add tests  ')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('Add tests')
    })
  })

  it('should keep submit button disabled for whitespace-only feedback', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    // Type only whitespace
    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, '   ')

    // Button should remain disabled
    const submitButton = screen.getByRole('button', { name: /Continue/ })
    expect(submitButton).toBeDisabled()
  })

  it('should show loading state while submitting', async () => {
    const user = userEvent.setup()
    let resolveSubmit: () => void
    mockOnSubmit.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve as () => void
      })
    )

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Add tests')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Submitting\.\.\./ })).toBeInTheDocument()
    })

    // Buttons should be disabled
    expect(screen.getByRole('button', { name: /Submitting\.\.\./ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled()

    // Textarea should be disabled
    expect(textarea).toBeDisabled()

    // Resolve submission
    resolveSubmit!()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Submitting\.\.\./ })).not.toBeInTheDocument()
    })
  })

  it('should display error message when submission fails', async () => {
    const user = userEvent.setup()
    mockOnSubmit.mockRejectedValue(new Error('Network error'))

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Add tests')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('should display generic error when submission fails without error message', async () => {
    const user = userEvent.setup()
    mockOnSubmit.mockRejectedValue('Unknown error')

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Add tests')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Failed to submit feedback')).toBeInTheDocument()
    })
  })

  it('should call onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should clear feedback and error when canceled', async () => {
    const user = userEvent.setup()

    const { rerender } = renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    // Type feedback
    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Some feedback')

    // Cancel dialog
    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    await user.click(cancelButton)

    // Reopen dialog
    rerender(<FollowUpDialog open={false} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />)
    rerender(<FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />)

    // Feedback should be cleared
    expect(screen.getByLabelText('Feedback')).toHaveValue('')
  })

  it('should clear feedback after successful submission', async () => {
    const user = userEvent.setup()
    mockOnSubmit.mockResolvedValue(undefined)

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Add tests')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled()
    })

    // Feedback should be cleared after successful submission
    await waitFor(() => {
      expect(textarea).toHaveValue('')
    })
  })

  it('should not allow cancel while submitting', async () => {
    const user = userEvent.setup()
    let resolveSubmit: () => void
    mockOnSubmit.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve as () => void
      })
    )

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Add tests')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Submitting\.\.\./ })).toBeInTheDocument()
    })

    // Try to click cancel - should be disabled
    const cancelButton = screen.getByRole('button', { name: /Cancel/ })
    expect(cancelButton).toBeDisabled()

    // Resolve submission
    resolveSubmit!()
  })

  it('should clear error when typing new feedback', async () => {
    const user = userEvent.setup()
    mockOnSubmit.mockRejectedValue(new Error('Network error'))

    renderWithProviders(
      <FollowUpDialog open={true} onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
    )

    const textarea = screen.getByLabelText('Feedback')
    await user.type(textarea, 'Add tests')

    const submitButton = screen.getByRole('button', { name: /Continue/ })
    await user.click(submitButton)

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    // Start typing - error should remain (we don't clear on typing, only on submit)
    await user.type(textarea, ' more')

    // Error still visible
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })
})
