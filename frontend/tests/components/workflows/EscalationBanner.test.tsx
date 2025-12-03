import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { EscalationBanner } from '@/components/workflows/EscalationBanner'

describe('EscalationBanner', () => {
  const mockOnRespond = vi.fn()

  const baseProps = {
    workflowId: 'wf-123',
    workflowTitle: 'Auth Implementation',
    message: 'The test suite is failing. Should I continue?',
    onRespond: mockOnRespond,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the workflow title', () => {
    renderWithProviders(<EscalationBanner {...baseProps} />)

    expect(screen.getByText(/Auth Implementation/)).toBeInTheDocument()
    expect(screen.getByText(/needs your input/)).toBeInTheDocument()
  })

  it('should render the escalation message', () => {
    renderWithProviders(<EscalationBanner {...baseProps} />)

    expect(screen.getByText(/"The test suite is failing. Should I continue\?"/)).toBeInTheDocument()
  })

  it('should truncate long messages to 80 characters', () => {
    const longMessage =
      'This is a very long message that exceeds the 80 character limit and should be truncated with an ellipsis at the end.'

    renderWithProviders(<EscalationBanner {...baseProps} message={longMessage} />)

    // Should show truncated message (77 chars + "...") - the message is wrapped in quotes
    // The truncated text is the first 77 chars of the message
    const truncated = longMessage.slice(0, 77) + '...'
    expect(screen.getByText(`"${truncated}"`)).toBeInTheDocument()
  })

  it('should not truncate messages under 80 characters', () => {
    const shortMessage = 'Short message here.'

    renderWithProviders(<EscalationBanner {...baseProps} message={shortMessage} />)

    expect(screen.getByText(`"${shortMessage}"`)).toBeInTheDocument()
  })

  it('should render Respond button when onRespond is provided', () => {
    renderWithProviders(<EscalationBanner {...baseProps} />)

    expect(screen.getByRole('button', { name: /Respond/ })).toBeInTheDocument()
  })

  it('should not render Respond button when onRespond is not provided', () => {
    renderWithProviders(
      <EscalationBanner
        workflowId={baseProps.workflowId}
        workflowTitle={baseProps.workflowTitle}
        message={baseProps.message}
      />
    )

    expect(screen.queryByRole('button', { name: /Respond/ })).not.toBeInTheDocument()
  })

  it('should call onRespond when Respond button is clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(<EscalationBanner {...baseProps} />)

    const respondButton = screen.getByRole('button', { name: /Respond/ })
    await user.click(respondButton)

    expect(mockOnRespond).toHaveBeenCalledTimes(1)
  })

  it('should render with warning styling', () => {
    const { container } = renderWithProviders(<EscalationBanner {...baseProps} />)

    // Check for yellow warning styling on the root element
    const banner = container.querySelector('.bg-yellow-500\\/10')
    expect(banner).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = renderWithProviders(
      <EscalationBanner {...baseProps} className="custom-class" />
    )

    const bannerDiv = container.firstChild
    expect(bannerDiv).toHaveClass('custom-class')
  })

  it('should render alert triangle icon', () => {
    renderWithProviders(<EscalationBanner {...baseProps} />)

    // The AlertTriangle icon should be present (check for SVG with expected class)
    const svg = document.querySelector('svg.text-yellow-600, svg.lucide-alert-triangle')
    expect(svg).toBeInTheDocument()
  })
})
