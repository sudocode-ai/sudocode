import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { MessageInput } from '@/components/executions/MessageInput'
import { executionsApi } from '@/lib/api'
import { toast } from 'sonner'

// Mock the API - use importOriginal to preserve other exports
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    executionsApi: {
      ...actual.executionsApi,
      inject: vi.fn(),
    },
  }
})

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('MessageInput', () => {
  const mockOnSent = vi.fn()
  const executionId = 'test-execution-123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render input and send button', () => {
    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    expect(screen.getByPlaceholderText('Send message...')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should render with custom placeholder', () => {
    renderWithProviders(
      <MessageInput executionId={executionId} placeholder="Type a message..." />
    )

    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
  })

  it('should disable send button when input is empty', () => {
    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const submitButton = screen.getByRole('button')
    expect(submitButton).toBeDisabled()
  })

  it('should enable send button when input has content', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Hello agent')

    const submitButton = screen.getByRole('button')
    expect(submitButton).toBeEnabled()
  })

  it('should keep send button disabled for whitespace-only input', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, '   ')

    const submitButton = screen.getByRole('button')
    expect(submitButton).toBeDisabled()
  })

  it('should call inject API and clear input on successful submission', async () => {
    const user = userEvent.setup()
    // Response interceptor unwraps ApiResponse, so we return the data directly
    vi.mocked(executionsApi.inject).mockResolvedValue({
      executionId,
      method: 'inject' as const,
    })

    renderWithProviders(
      <MessageInput executionId={executionId} onSent={mockOnSent} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Please add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(executionsApi.inject).toHaveBeenCalledWith(executionId, 'Please add tests')
    })

    await waitFor(() => {
      expect(input).toHaveValue('')
    })

    expect(mockOnSent).toHaveBeenCalled()
  })

  it('should trim whitespace before submitting', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.inject).mockResolvedValue({
      executionId,
      method: 'inject' as const,
    })

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, '  Add tests  ')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(executionsApi.inject).toHaveBeenCalledWith(executionId, 'Add tests')
    })
  })

  it('should show loading state while submitting', async () => {
    const user = userEvent.setup()
    let resolveSubmit: () => void
    vi.mocked(executionsApi.inject).mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = () => resolve({
          executionId,
          method: 'inject' as const,
        })
      })
    )

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    // Input and button should be disabled during submission
    await waitFor(() => {
      expect(input).toBeDisabled()
      expect(submitButton).toBeDisabled()
    })

    // Resolve submission
    resolveSubmit!()

    await waitFor(() => {
      expect(input).not.toBeDisabled()
    })
  })

  it('should show toast info when message sent via interrupt', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.inject).mockResolvedValue({
      executionId,
      method: 'interrupt' as const,
    })

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('Message sent via interrupt')
    })
  })

  it('should succeed without toast when message sent via prompt method', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.inject).mockResolvedValue({
      executionId,
      method: 'prompt' as const,
    })

    renderWithProviders(
      <MessageInput executionId={executionId} onSent={mockOnSent} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(executionsApi.inject).toHaveBeenCalledWith(executionId, 'Add tests')
    })

    // Should clear input and call onSent
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
    expect(mockOnSent).toHaveBeenCalled()

    // Should NOT show any toast for prompt method (only interrupt shows toast)
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should show error toast when API returns error (interceptor throws)', async () => {
    const user = userEvent.setup()
    // Response interceptor throws when API returns success: false
    vi.mocked(executionsApi.inject).mockRejectedValue(new Error('No active session'))

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('No active session')
    })

    // Input should not be cleared on failure
    expect(input).toHaveValue('Add tests')
  })

  it('should show error toast when API throws', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.inject).mockRejectedValue(new Error('Network error'))

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Network error')
    })

    // Input should not be cleared on failure
    expect(input).toHaveValue('Add tests')
  })

  it('should show generic error toast when API throws non-Error', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.inject).mockRejectedValue('Unknown error')

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to send message')
    })
  })

  it('should disable input and button when disabled prop is true', () => {
    renderWithProviders(
      <MessageInput executionId={executionId} disabled={true} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    const submitButton = screen.getByRole('button')

    expect(input).toBeDisabled()
    expect(submitButton).toBeDisabled()
  })

  it('should submit on Enter key press', async () => {
    const user = userEvent.setup()
    vi.mocked(executionsApi.inject).mockResolvedValue({
      executionId,
      method: 'inject' as const,
    })

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(executionsApi.inject).toHaveBeenCalledWith(executionId, 'Add tests')
    })
  })

  it('should not submit on Enter when input is empty', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(executionsApi.inject).not.toHaveBeenCalled()
  })

  it('should not submit on Enter when disabled', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <MessageInput executionId={executionId} disabled={true} />
    )

    // Input is disabled, so keyboard events should not trigger submit
    await user.keyboard('{Enter}')

    expect(executionsApi.inject).not.toHaveBeenCalled()
  })

  it('should not submit on Enter while already submitting', async () => {
    const user = userEvent.setup()
    let resolveSubmit: () => void
    vi.mocked(executionsApi.inject).mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = () => resolve({
          executionId,
          method: 'inject' as const,
        })
      })
    )

    renderWithProviders(
      <MessageInput executionId={executionId} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')
    await user.keyboard('{Enter}')

    // Wait for submission to start
    await waitFor(() => {
      expect(input).toBeDisabled()
    })

    // Try pressing Enter again - should not call inject twice
    await user.keyboard('{Enter}')
    expect(executionsApi.inject).toHaveBeenCalledTimes(1)

    // Resolve submission
    resolveSubmit!()
  })

  it('should not call onSent when submission fails', async () => {
    const user = userEvent.setup()
    // Response interceptor throws when API returns error
    vi.mocked(executionsApi.inject).mockRejectedValue(new Error('Failed'))

    renderWithProviders(
      <MessageInput executionId={executionId} onSent={mockOnSent} />
    )

    const input = screen.getByPlaceholderText('Send message...')
    await user.type(input, 'Add tests')

    const submitButton = screen.getByRole('button')
    await user.click(submitButton)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })

    expect(mockOnSent).not.toHaveBeenCalled()
  })
})
