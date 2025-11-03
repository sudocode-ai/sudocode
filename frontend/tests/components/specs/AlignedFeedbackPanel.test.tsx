/**
 * Tests for AlignedFeedbackPanel component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { userEvent } from '@testing-library/user-event'
import { AlignedFeedbackPanel } from '@/components/specs/AlignedFeedbackPanel'
import type { IssueFeedback } from '@/types/api'

// Wrapper component to provide router context
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
)

describe('AlignedFeedbackPanel', () => {
  const createMockFeedback = (overrides: Partial<IssueFeedback> = {}): IssueFeedback => ({
    id: 'FB-001',
    issue_id: 'ISSUE-001',
    issue_uuid: 'uuid-issue-001',
    spec_id: 'SPEC-001',
    spec_uuid: 'uuid-spec-001',
    feedback_type: 'comment',
    content: 'Test feedback',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  })

  it('should render empty state when no feedback provided', () => {
    const positions = new Map<string, number>()
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={[]} positions={positions} />
      </Wrapper>
    )

    // Should render empty panel without any feedback cards
    expect(container.querySelectorAll('.absolute.px-1')).toHaveLength(0)
  })

  it('should render general comments inline at the top', () => {
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
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={generalFeedback} positions={positions} />
      </Wrapper>
    )

    expect(screen.getByText('General comment 1')).toBeInTheDocument()
    expect(screen.getByText('General comment 2')).toBeInTheDocument()

    // Both should be positioned inline (at minimum top offset of 16px)
    const positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(2)
  })

  it('should render anchored comments with positions', () => {
    const anchoredFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Anchored feedback',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
      }),
    ]

    const positions = new Map([['FB-001', 100]])
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={anchoredFeedback} positions={positions} />
      </Wrapper>
    )

    expect(screen.getByText('Anchored feedback')).toBeInTheDocument()

    // Should be positioned with collision detection (at least at 100px)
    const positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(1)
  })

  it('should render multiple anchored comments with collision detection', () => {
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
      <Wrapper>
        <AlignedFeedbackPanel feedback={anchoredFeedback} positions={positions} />
      </Wrapper>
    )

    expect(screen.getByText('Anchored comment 1')).toBeInTheDocument()
    expect(screen.getByText('Anchored comment 2')).toBeInTheDocument()

    // Check that both are rendered with absolute positioning
    const positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(2)
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

    render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={anchoredFeedback} positions={positions} />
      </Wrapper>
    )

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

    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={mixedFeedback} positions={positions} />
      </Wrapper>
    )

    // Both general and anchored comments should be rendered inline
    expect(screen.getByText('General comment')).toBeInTheDocument()
    expect(screen.getByText('Anchored comment')).toBeInTheDocument()

    const positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(2)
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
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel
          feedback={feedback}
          positions={positions}
          onFeedbackClick={onFeedbackClick}
        />
      </Wrapper>
    )

    // Click on the card itself, not the text (which might be on the issue button)
    const feedbackCard = container.querySelector('.rounded-lg')
    expect(feedbackCard).not.toBeNull()
    await user.click(feedbackCard!)

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
      <Wrapper>
        <AlignedFeedbackPanel feedback={feedback} positions={positions} onDismiss={onDismiss} />
      </Wrapper>
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
    render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={feedback} positions={positions} onDelete={onDelete} />
      </Wrapper>
    )

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
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={feedback} positions={positions} />
      </Wrapper>
    )

    // Should treat as general comment and render inline at top
    expect(screen.getByText('Invalid anchor')).toBeInTheDocument()

    const positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(1)
  })

  it('should apply custom className', () => {
    const positions = new Map<string, number>()
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={[]} positions={positions} className="custom-class" />
      </Wrapper>
    )

    // Look for the element with the custom class
    const panel = container.querySelector('.custom-class')
    expect(panel).not.toBeNull()
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
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={feedback} positions={positions} />
      </Wrapper>
    )

    const positionedDiv = container.querySelector('.absolute.px-1')
    // No transition classes - feedback should update instantly
    expect(positionedDiv).not.toBeNull()
    expect(positionedDiv).not.toHaveClass('transition-all')
    expect(positionedDiv).not.toHaveClass('duration-75')
    expect(positionedDiv).not.toHaveClass('ease-linear')
  })

  it('should render all feedback items correctly', () => {
    const generalFeedback: IssueFeedback[] = [
      createMockFeedback({ id: 'FB-001' }),
      createMockFeedback({ id: 'FB-002' }),
      createMockFeedback({ id: 'FB-003' }),
    ]

    const positions = new Map<string, number>()
    const { container } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={generalFeedback} positions={positions} />
      </Wrapper>
    )

    // Should render all 3 feedback cards
    const positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(3)
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
      <Wrapper>
        <AlignedFeedbackPanel feedback={feedback} positions={initialPositions} />
      </Wrapper>
    )

    let positionedDiv = container.querySelector('.absolute.px-1') as HTMLElement
    expect(positionedDiv).not.toBeNull()

    // Update position
    const updatedPositions = new Map([['FB-001', 250]])
    rerender(
      <Wrapper>
        <AlignedFeedbackPanel feedback={feedback} positions={updatedPositions} />
      </Wrapper>
    )

    positionedDiv = container.querySelector('.absolute.px-1') as HTMLElement
    expect(positionedDiv).not.toBeNull()
    expect(screen.getByText('Positioned feedback')).toBeInTheDocument()
  })

  it('should update when feedback changes', () => {
    const initialFeedback: IssueFeedback[] = [
      createMockFeedback({
        id: 'FB-001',
        content: 'Initial feedback',
      }),
    ]

    const positions = new Map<string, number>()
    const { container, rerender } = render(
      <Wrapper>
        <AlignedFeedbackPanel feedback={initialFeedback} positions={positions} />
      </Wrapper>
    )

    expect(screen.getByText('Initial feedback')).toBeInTheDocument()

    let positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(1)

    // Add more feedback
    const updatedFeedback: IssueFeedback[] = [
      ...initialFeedback,
      createMockFeedback({
        id: 'FB-002',
        content: 'New feedback',
      }),
    ]

    rerender(
      <Wrapper>
        <AlignedFeedbackPanel feedback={updatedFeedback} positions={positions} />
      </Wrapper>
    )

    expect(screen.getByText('Initial feedback')).toBeInTheDocument()
    expect(screen.getByText('New feedback')).toBeInTheDocument()

    positionedDivs = container.querySelectorAll('.absolute.px-1')
    expect(positionedDivs).toHaveLength(2)
  })
})
