import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { OrchestratorGuidancePanel } from '@/components/workflows/OrchestratorGuidancePanel'
import { executionsApi } from '@/lib/api'

// Mock the executionsApi while preserving other exports
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    executionsApi: {
      ...actual.executionsApi,
      createFollowUp: vi.fn(),
    },
  }
})

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { toast } from 'sonner'

describe('OrchestratorGuidancePanel', () => {
  const baseProps = {
    workflowId: 'wf-123',
    orchestratorExecutionId: 'exec-456',
    isOrchestratorRunning: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executionsApi.createFollowUp).mockResolvedValue({ id: 'new-exec-789' } as never)
  })

  it('should render the guidance panel with input', () => {
    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    expect(screen.getByPlaceholderText(/Type your guidance/)).toBeInTheDocument()
    expect(screen.getByText('Send guidance to orchestrator')).toBeInTheDocument()
  })

  it('should show running status when orchestrator is running', () => {
    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} isOrchestratorRunning={true} />)

    expect(screen.getByText('Orchestrator is working...')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/will be sent when ready/)).toBeInTheDocument()
  })

  it('should show idle status when orchestrator is not running', () => {
    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} isOrchestratorRunning={false} />)

    expect(screen.getByText('Send guidance to orchestrator')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Type your guidance or feedback/)).toBeInTheDocument()
  })

  it('should have disabled send button when message is empty', () => {
    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const sendButton = screen.getByRole('button')
    expect(sendButton).toBeDisabled()
  })

  it('should enable send button when message has content', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Please focus on the auth module')

    const sendButton = screen.getByRole('button')
    expect(sendButton).not.toBeDisabled()
  })

  it('should call createFollowUp API when submit button is clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Focus on unit tests')

    const sendButton = screen.getByRole('button')
    await user.click(sendButton)

    expect(executionsApi.createFollowUp).toHaveBeenCalledWith('exec-456', {
      feedback: 'Focus on unit tests',
    })
  })

  it('should submit on Enter key press', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Check the API endpoints')
    await user.keyboard('{Enter}')

    expect(executionsApi.createFollowUp).toHaveBeenCalledWith('exec-456', {
      feedback: 'Check the API endpoints',
    })
  })

  it('should not submit on Shift+Enter (allows newline)', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Line 1')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.type(textarea, 'Line 2')

    // Should NOT have called the API yet
    expect(executionsApi.createFollowUp).not.toHaveBeenCalled()
  })

  it('should clear input and show success toast on successful submit', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Some guidance')

    const sendButton = screen.getByRole('button')
    await user.click(sendButton)

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Guidance sent to orchestrator')
    })

    // Input should be cleared
    expect(textarea).toHaveValue('')
  })

  it('should show error toast on failed submit', async () => {
    vi.mocked(executionsApi.createFollowUp).mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Some guidance')

    const sendButton = screen.getByRole('button')
    await user.click(sendButton)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to send guidance: Network error')
    })
  })

  it('should disable input when disabled prop is true', () => {
    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} disabled={true} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    expect(textarea).toBeDisabled()

    const sendButton = screen.getByRole('button')
    expect(sendButton).toBeDisabled()
  })

  it('should not submit when disabled', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} disabled={true} />)

    // Try to type (won't work because disabled)
    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Some guidance')

    // Should not have called API
    expect(executionsApi.createFollowUp).not.toHaveBeenCalled()
  })

  it('should show loading state while submitting', async () => {
    // Make the API call hang
    vi.mocked(executionsApi.createFollowUp).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    )
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, 'Some guidance')

    const sendButton = screen.getByRole('button')
    await user.click(sendButton)

    // Button should be disabled and show spinner
    expect(sendButton).toBeDisabled()
    expect(textarea).toBeDisabled()
  })

  it('should not submit with whitespace-only message', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, '   ')

    const sendButton = screen.getByRole('button')
    expect(sendButton).toBeDisabled()
  })

  it('should trim message before submitting', async () => {
    const user = userEvent.setup()

    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    const textarea = screen.getByPlaceholderText(/Type your guidance/)
    await user.type(textarea, '  Some guidance with spaces  ')

    const sendButton = screen.getByRole('button')
    await user.click(sendButton)

    expect(executionsApi.createFollowUp).toHaveBeenCalledWith('exec-456', {
      feedback: 'Some guidance with spaces',
    })
  })

  it('should show hint text about keyboard shortcuts', () => {
    renderWithProviders(<OrchestratorGuidancePanel {...baseProps} />)

    expect(screen.getByText(/Press Enter to send, Shift\+Enter for new line/)).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = renderWithProviders(
      <OrchestratorGuidancePanel {...baseProps} className="custom-class" />
    )

    const panel = container.firstChild
    expect(panel).toHaveClass('custom-class')
  })
})
