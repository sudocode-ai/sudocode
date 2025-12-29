import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatWidgetFAB } from '@/components/chat-widget/ChatWidgetFAB'
import { TooltipProvider } from '@/components/ui/tooltip'

// Helper to wrap component with TooltipProvider
const renderWithTooltip = (ui: React.ReactElement) => {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('ChatWidgetFAB', () => {
  it('should render the FAB button', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-label', 'Open assistant')
  })

  it('should call onClick when clicked', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should show "Close assistant" aria-label when open', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={true} />)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-label', 'Close assistant')
  })

  it('should apply scale effect when open', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={true} />)

    const button = screen.getByRole('button')
    expect(button.className).toContain('scale-95')
    expect(button.className).toContain('opacity-75')
  })

  it('should show spinner when running', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} isRunning={true} />)

    // The Loader2 icon should be rendered with animate-spin class
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('should show bot icon when not running', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} isRunning={false} />)

    // Should not have a spinner
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).not.toBeInTheDocument()
  })

  it('should show notification dot when hasNotification is true', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} hasNotification={true} />)

    // The notification dot should have animate-pulse class
    const notificationDot = document.querySelector('.animate-pulse')
    expect(notificationDot).toBeInTheDocument()
  })

  it('should not show notification dot when hasNotification is false', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} hasNotification={false} />)

    // Should not have a notification dot with animate-pulse
    const notificationDot = document.querySelector('.animate-pulse')
    expect(notificationDot).not.toBeInTheDocument()
  })

  it('should show both spinner and notification dot when both are true', () => {
    const onClick = vi.fn()

    renderWithTooltip(
      <ChatWidgetFAB onClick={onClick} isOpen={false} isRunning={true} hasNotification={true} />
    )

    const spinner = document.querySelector('.animate-spin')
    const notificationDot = document.querySelector('.animate-pulse')

    expect(spinner).toBeInTheDocument()
    expect(notificationDot).toBeInTheDocument()
  })

  it('should have fixed positioning', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} />)

    const button = screen.getByRole('button')
    expect(button.className).toContain('fixed')
    expect(button.className).toContain('bottom-6')
    expect(button.className).toContain('right-6')
  })

  it('should have proper hover and focus styles', () => {
    const onClick = vi.fn()

    renderWithTooltip(<ChatWidgetFAB onClick={onClick} isOpen={false} />)

    const button = screen.getByRole('button')
    expect(button.className).toContain('hover:text-foreground')
    expect(button.className).toContain('focus-visible:ring-2')
  })
})
