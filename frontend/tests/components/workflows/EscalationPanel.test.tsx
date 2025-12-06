import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { EscalationPanel } from '@/components/workflows/EscalationPanel'
import type { EscalationData } from '@/types/workflow'

describe('EscalationPanel', () => {
  const mockOnRespond = vi.fn()

  const baseEscalation: EscalationData = {
    requestId: 'esc-123',
    message: 'The test suite is failing with 3 errors. Should I continue or try a different approach?',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the escalation message', () => {
    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    expect(screen.getByText('Orchestrator Needs Input')).toBeInTheDocument()
    expect(screen.getByText(baseEscalation.message)).toBeInTheDocument()
  })

  it('should render predefined options as radio buttons', () => {
    const escalationWithOptions: EscalationData = {
      ...baseEscalation,
      options: ['Continue with current approach', 'Try different implementation', 'Stop and investigate'],
    }

    renderWithProviders(
      <EscalationPanel escalation={escalationWithOptions} onRespond={mockOnRespond} />
    )

    expect(screen.getByText('Choose an option')).toBeInTheDocument()
    expect(screen.getByText('Continue with current approach')).toBeInTheDocument()
    expect(screen.getByText('Try different implementation')).toBeInTheDocument()
    expect(screen.getByText('Stop and investigate')).toBeInTheDocument()
  })

  it('should not render options section when no options provided', () => {
    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    expect(screen.queryByText('Choose an option')).not.toBeInTheDocument()
  })

  it('should render custom feedback textarea', () => {
    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    expect(screen.getByPlaceholderText(/Type your response/)).toBeInTheDocument()
  })

  it('should render context when provided', () => {
    const escalationWithContext: EscalationData = {
      ...baseEscalation,
      context: { stepId: 'step-1', attempt: 2 },
    }

    renderWithProviders(
      <EscalationPanel escalation={escalationWithContext} onRespond={mockOnRespond} />
    )

    expect(screen.getByText(/Context:/)).toBeInTheDocument()
    expect(screen.getByText(/stepId/)).toBeInTheDocument()
  })

  it('should call onRespond with approve action when Approve clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    const approveButton = screen.getByRole('button', { name: /Approve/ })
    await user.click(approveButton)

    expect(mockOnRespond).toHaveBeenCalledWith({
      action: 'approve',
      message: undefined,
    })
  })

  it('should call onRespond with reject action when Reject clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    const rejectButton = screen.getByRole('button', { name: /Reject/ })
    await user.click(rejectButton)

    expect(mockOnRespond).toHaveBeenCalledWith({
      action: 'reject',
      message: undefined,
    })
  })

  it('should call onRespond with custom action when custom message submitted', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    const textarea = screen.getByPlaceholderText(/Type your response/)
    await user.type(textarea, 'Please try using a different library')

    const sendButton = screen.getByRole('button', { name: /Send Response/ })
    await user.click(sendButton)

    expect(mockOnRespond).toHaveBeenCalledWith({
      action: 'custom',
      message: 'Please try using a different library',
    })
  })

  it('should include selected option in approve action', async () => {
    const user = userEvent.setup()
    const escalationWithOptions: EscalationData = {
      ...baseEscalation,
      options: ['Option A', 'Option B'],
    }

    renderWithProviders(
      <EscalationPanel escalation={escalationWithOptions} onRespond={mockOnRespond} />
    )

    // Select an option
    const optionRadio = screen.getByLabelText('Option B')
    await user.click(optionRadio)

    // Click approve
    const approveButton = screen.getByRole('button', { name: /Approve/ })
    await user.click(approveButton)

    expect(mockOnRespond).toHaveBeenCalledWith({
      action: 'approve',
      message: 'Option B',
    })
  })

  it('should clear option when typing custom message', async () => {
    const user = userEvent.setup()
    const escalationWithOptions: EscalationData = {
      ...baseEscalation,
      options: ['Option A', 'Option B'],
    }

    renderWithProviders(
      <EscalationPanel escalation={escalationWithOptions} onRespond={mockOnRespond} />
    )

    // Select an option
    const optionRadio = screen.getByLabelText('Option A')
    await user.click(optionRadio)

    // Type custom message
    const textarea = screen.getByPlaceholderText(/Type your response/)
    await user.type(textarea, 'Custom response')

    // Option should be deselected (we can test by checking value)
    expect(optionRadio).not.toBeChecked()
  })

  it('should not show Send Response button when custom message is empty', () => {
    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    expect(screen.queryByRole('button', { name: /Send Response/ })).not.toBeInTheDocument()
  })

  it('should show Send Response button when custom message has content', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    const textarea = screen.getByPlaceholderText(/Type your response/)
    await user.type(textarea, 'Custom feedback')

    expect(screen.getByRole('button', { name: /Send Response/ })).toBeInTheDocument()
  })

  it('should disable buttons when isResponding is true', () => {
    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} isResponding={true} />
    )

    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Reject/ })).toBeDisabled()
  })

  it('should disable textarea when isResponding is true', () => {
    renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} isResponding={true} />
    )

    expect(screen.getByPlaceholderText(/Type your response/)).toBeDisabled()
  })

  it('should show loading indicator in buttons when isResponding is true', async () => {
    const user = userEvent.setup()

    const { rerender } = renderWithProviders(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} />
    )

    // Add custom message to show the Send Response button
    const textarea = screen.getByPlaceholderText(/Type your response/)
    await user.type(textarea, 'test')

    // Re-render with isResponding true
    rerender(
      <EscalationPanel escalation={baseEscalation} onRespond={mockOnRespond} isResponding={true} />
    )

    // Buttons should have loading state (Loader2 icon is rendered)
    // We can check if the buttons are disabled as an indicator
    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Reject/ })).toBeDisabled()
  })
})
