import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatWidgetOverlay } from '@/components/chat-widget/ChatWidgetOverlay'

describe('ChatWidgetOverlay', () => {
  it('should render children', () => {
    render(
      <ChatWidgetOverlay>
        <div data-testid="child-content">Child Content</div>
      </ChatWidgetOverlay>
    )

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.getByText('Child Content')).toBeInTheDocument()
  })

  it('should have dialog role', () => {
    render(
      <ChatWidgetOverlay>
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-label', 'Assistant chat')
  })

  it('should have fixed positioning', () => {
    render(
      <ChatWidgetOverlay>
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const overlay = screen.getByRole('dialog')
    expect(overlay.className).toContain('fixed')
  })

  it('should be positioned at bottom-right', () => {
    render(
      <ChatWidgetOverlay>
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const overlay = screen.getByRole('dialog')
    expect(overlay.className).toContain('bottom-6')
    expect(overlay.className).toContain('right-6')
  })

  it('should have proper dimensions', () => {
    render(
      <ChatWidgetOverlay>
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const overlay = screen.getByRole('dialog')
    expect(overlay.className).toContain('h-[calc(100vh-7rem)]')
    expect(overlay.className).toContain('w-[420px]')
  })

  it('should have opaque background', () => {
    render(
      <ChatWidgetOverlay>
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const overlay = screen.getByRole('dialog')
    expect(overlay.className).toContain('bg-white')
  })

  it('should have border and rounded corners', () => {
    render(
      <ChatWidgetOverlay>
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const overlay = screen.getByRole('dialog')
    expect(overlay.className).toContain('border')
    expect(overlay.className).toContain('rounded-lg')
  })

  it('should have shadow', () => {
    render(
      <ChatWidgetOverlay>
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const overlay = screen.getByRole('dialog')
    expect(overlay.className).toContain('shadow-2xl')
  })

  it('should apply custom className', () => {
    render(
      <ChatWidgetOverlay className="custom-class">
        <div>Content</div>
      </ChatWidgetOverlay>
    )

    const overlay = screen.getByRole('dialog')
    expect(overlay.className).toContain('custom-class')
  })
})
