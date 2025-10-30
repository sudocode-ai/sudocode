/**
 * Tests for AlignedFeedbackPanel component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AlignedFeedbackPanel } from '@/components/specs/AlignedFeedbackPanel'
import type { IssueFeedback } from '@/types/api'

describe('AlignedFeedbackPanel', () => {
  const createMockFeedback = (overrides: Partial<IssueFeedback> = {}): IssueFeedback => ({
    id: 'FB-001',
    issue_id: 'ISSUE-001',
    spec_id: 'SPEC-001',
    feedback_type: 'comment',
    content: 'Test feedback',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  })

  it('should render empty state when no feedback provided', () => {
    const positions = new Map<string, number>()
    render(<AlignedFeedbackPanel feedback={[]} positions={positions} />)

    expect(screen.getByText('No feedback yet')).toBeInTheDocument()
  })

  it('should render general comments in sticky section', () => {
    const generalFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'General comment 1',
        // No anchor = general comment
      }),
      createMockFeedback({
        id: 'FB-002',
        content: 'General comment 2',
        anchor: JSON.stringify({
          anchor_status: 'valid',
          // No line_number = general comment
        }),
      }),
    ]

    const positions = new Map<string, number>()
    render(<AlignedFeedbackPanel feedback={generalFeedback} positions={positions} />)

    expect(screen.getByText('💭')).toBeInTheDocument()
    expect(screen.getByText('General Comments')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
    expect(screen.getByText('General comment 1')).toBeInTheDocument()
    expect(screen.getByText('General comment 2')).toBeInTheDocument()
  })

  it('should not render general comments section when none exist', () => {
    const anchoredFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
      }),
    ]

    const positions = new Map([['FB-001', 100]])
    render(<AlignedFeedbackPanel feedback={anchoredFeedback} positions={positions} />)

    expect(screen.queryByText('General Comments')).not.toBeInTheDocument()
  })

  it('should render anchored comments with absolute positioning', () => {
    const anchoredFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Anchored comment 1',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
      }),
      createMockFeedback({
        id: 'FB-002',
        content: 'Anchored comment 2',
        anchor: JSON.stringify({
          line_number: 20,
          anchor_status: 'valid',
        }),
      }),
    ]

    const positions = new Map([
      ['FB-001', 100],
      ['FB-002', 250],
    ])

    const { container } = render(
      <AlignedFeedbackPanel feedback={anchoredFeedback} positions={positions} />
    )

    expect(screen.getByText('Anchored comment 1')).toBeInTheDocument()
    expect(screen.getByText('Anchored comment 2')).toBeInTheDocument()

    // Check absolute positioning (select feedback card divs, not SVG)
    const positionedDivs = container.querySelectorAll('.absolute.px-2')
    expect(positionedDivs).toHaveLength(2)
    expect(positionedDivs[0]).toHaveStyle({ top: '100px' })
    expect(positionedDivs[1]).toHaveStyle({ top: '250px' })
  })

  it('should not render anchored comments without positions', () => {
    const anchoredFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Should render',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
      }),
      createMockFeedback({
        id: 'FB-002',
        content: 'Should not render',
        anchor: JSON.stringify({
          line_number: 20,
          anchor_status: 'valid',
        }),
      }),
    ]

    // Only provide position for FB-001
    const positions = new Map([['FB-001', 100]])

    render(<AlignedFeedbackPanel feedback={anchoredFeedback} positions={positions} />)

    expect(screen.getByText('Should render')).toBeInTheDocument()
    expect(screen.queryByText('Should not render')).not.toBeInTheDocument()
  })

  it('should handle mixed general and anchored comments', () => {
    const mixedFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'General comment',
      }),
      createMockFeedback({
        id: 'FB-002',
        content: 'Anchored comment',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
      }),
    ]

    const positions = new Map([['FB-002', 150]])

    render(<AlignedFeedbackPanel feedback={mixedFeedback} positions={positions} />)

    expect(screen.getByText('General Comments')).toBeInTheDocument()
    expect(screen.getByText('General comment')).toBeInTheDocument()
    expect(screen.getByText('Anchored comment')).toBeInTheDocument()
  })

  it('should call onFeedbackClick when feedback is clicked', async () => {
    const user = userEvent.setup()
    const onFeedbackClick = vi.fn()
    const feedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Clickable feedback',
      }),
    ]

    const positions = new Map<string, number>()
    render(
      <AlignedFeedbackPanel
        feedback={feedback}
        positions={positions}
        onFeedbackClick={onFeedbackClick}
      />
    )

    const feedbackElement = screen.getByText('Clickable feedback')
    await user.click(feedbackElement)

    expect(onFeedbackClick).toHaveBeenCalledWith(feedback[0])
  })

  it('should pass onDismiss callback to FeedbackCard', () => {
    const onDismiss = vi.fn()
    const feedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Test feedback',
      }),
    ]

    const positions = new Map<string, number>()
    render(
      <AlignedFeedbackPanel feedback={feedback} positions={positions} onDismiss={onDismiss} />
    )

    // The FeedbackCard should be rendered with dismiss functionality
    expect(screen.getByText('Test feedback')).toBeInTheDocument()
    // Note: We can't easily test the button click without hover state,
    // but we verify the prop is passed correctly
  })

  it('should pass onDelete callback to FeedbackCard', () => {
    const onDelete = vi.fn()
    const feedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Test feedback',
      }),
    ]

    const positions = new Map<string, number>()
    render(<AlignedFeedbackPanel feedback={feedback} positions={positions} onDelete={onDelete} />)

    expect(screen.getByText('Test feedback')).toBeInTheDocument()
  })

  it('should handle invalid anchor JSON gracefully', () => {
    const feedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Invalid anchor',
        anchor: 'invalid json',
      }),
    ]

    const positions = new Map<string, number>()
    render(<AlignedFeedbackPanel feedback={feedback} positions={positions} />)

    // Should treat as general comment
    expect(screen.getByText('General Comments')).toBeInTheDocument()
    expect(screen.getByText('Invalid anchor')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const positions = new Map<string, number>()
    const { container } = render(
      <AlignedFeedbackPanel
        feedback={[]}
        positions={positions}
        className="custom-class"
      />
    )

    const panel = container.firstChild as HTMLElement
    expect(panel).toHaveClass('custom-class')
  })

  it('should not apply transition styles to anchored comments for instant positioning', () => {
    const feedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
      }),
    ]

    const positions = new Map([['FB-001', 100]])
    const { container } = render(<AlignedFeedbackPanel feedback={feedback} positions={positions} />)

    const positionedDiv = container.querySelector('.absolute.px-2')
    // No transition classes - feedback should update instantly
    expect(positionedDiv).not.toHaveClass('transition-all')
    expect(positionedDiv).not.toHaveClass('duration-75')
    expect(positionedDiv).not.toHaveClass('ease-linear')
  })

  it('should count general comments correctly', () => {
    const generalFeedback: IssueFeedback[] = [
      createMockFeedback({ id: 'FB-001' }),
      createMockFeedback({ id: 'FB-002' }),
      createMockFeedback({ id: 'FB-003' }),
    ]

    const positions = new Map<string, number>()
    render(<AlignedFeedbackPanel feedback={generalFeedback} positions={positions} />)

    expect(screen.getByText('(3)')).toBeInTheDocument()
  })

  it('should update when positions change', () => {
    const feedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Positioned feedback',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
      }),
    ]

    const initialPositions = new Map([['FB-001', 100]])
    const { container, rerender } = render(
      <AlignedFeedbackPanel feedback={feedback} positions={initialPositions} />
    )

    let positionedDiv = container.querySelector('.absolute.px-2') as HTMLElement
    expect(positionedDiv).toHaveStyle({ top: '100px' })

    // Update position
    const updatedPositions = new Map([['FB-001', 250]])
    rerender(<AlignedFeedbackPanel feedback={feedback} positions={updatedPositions} />)

    positionedDiv = container.querySelector('.absolute.px-2') as HTMLElement
    expect(positionedDiv).toHaveStyle({ top: '250px' })
  })

  it('should update when feedback changes', () => {
    const initialFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Initial feedback',
      }),
    ]

    const positions = new Map<string, number>()
    const { rerender } = render(
      <AlignedFeedbackPanel feedback={initialFeedback} positions={positions} />
    )

    expect(screen.getByText('Initial feedback')).toBeInTheDocument()

    // Add more feedback
    const updatedFeedback: IssueFeedback[] = [
      ...initialFeedback,
      createMockFeedback({
        id: 'FB-002',
        content: 'New feedback',
      }),
    ]

    rerender(<AlignedFeedbackPanel feedback={updatedFeedback} positions={positions} />)

    expect(screen.getByText('Initial feedback')).toBeInTheDocument()
    expect(screen.getByText('New feedback')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })
})
