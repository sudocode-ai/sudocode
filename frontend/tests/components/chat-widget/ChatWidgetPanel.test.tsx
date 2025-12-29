import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatWidgetPanel } from '@/components/chat-widget/ChatWidgetPanel'

describe('ChatWidgetPanel', () => {
  const defaultProps = {
    onClose: vi.fn(),
  }

  // Store original body overflow
  let originalOverflow: string

  beforeEach(() => {
    originalOverflow = document.body.style.overflow
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.style.overflow = originalOverflow
  })

  it('should render children', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div data-testid="child-content">Child Content</div>
      </ChatWidgetPanel>
    )

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.getByText('Child Content')).toBeInTheDocument()
  })

  it('should have dialog role', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-label', 'Assistant panel')
  })

  it('should render backdrop overlay', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    // Backdrop has fixed positioning and covers screen
    const backdrop = document.querySelector('[aria-hidden="true"]')
    expect(backdrop).toBeInTheDocument()
    expect(backdrop?.className).toContain('fixed')
    expect(backdrop?.className).toContain('inset-0')
  })

  it('should call onClose when backdrop is clicked', () => {
    const onClose = vi.fn()

    render(
      <ChatWidgetPanel onClose={onClose}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    // Find and click the backdrop
    const backdrop = document.querySelector('[aria-hidden="true"]')
    if (backdrop) {
      fireEvent.click(backdrop)
    }

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should not call onClose when panel content is clicked', () => {
    const onClose = vi.fn()

    render(
      <ChatWidgetPanel onClose={onClose}>
        <div data-testid="panel-content">Content</div>
      </ChatWidgetPanel>
    )

    // Click on the content
    fireEvent.click(screen.getByTestId('panel-content'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('should have slide-in panel on the right', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('right-0')
  })

  it('should have full height via inset-y-0', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('inset-y-0')
  })

  it('should have max-w-md width', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-w-md')
  })

  it('should have border on the left', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('border-l')
  })

  it('should have shadow', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('shadow-lg')
  })

  it('should have high z-index', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('z-50')
  })

  it('should prevent body scroll when mounted', () => {
    render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    expect(document.body.style.overflow).toBe('hidden')
  })

  it('should restore body scroll when unmounted', () => {
    const { unmount } = render(
      <ChatWidgetPanel {...defaultProps}>
        <div>Content</div>
      </ChatWidgetPanel>
    )

    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('unset')
  })

  it('should apply custom className', () => {
    render(
      <ChatWidgetPanel {...defaultProps} className="custom-class">
        <div>Content</div>
      </ChatWidgetPanel>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('custom-class')
  })
})
