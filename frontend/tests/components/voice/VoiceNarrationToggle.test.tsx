import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceNarrationToggle } from '@/components/voice/VoiceNarrationToggle'
import { TooltipProvider } from '@/components/ui/tooltip'
import React from 'react'

describe('VoiceNarrationToggle', () => {
  const mockOnToggle = vi.fn()

  beforeEach(() => {
    mockOnToggle.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to render with TooltipProvider
  const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>)
  }

  describe('Disabled State (narration off)', () => {
    it('should render muted volume icon when disabled', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      // Check for VolumeX icon (muted)
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('should have correct aria-label when disabled', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Enable voice narration')
    })

    it('should have aria-pressed=false when disabled', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-pressed', 'false')
    })

    it('should call onToggle with true when clicked while disabled', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnToggle).toHaveBeenCalledWith(true)
    })

    it('should apply muted-foreground text color when disabled', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('text-muted-foreground')
    })
  })

  describe('Enabled State (narration on, not speaking)', () => {
    it('should render volume icon when enabled', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('should have correct aria-label when enabled but not speaking', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Voice narration enabled - Click to disable')
    })

    it('should have aria-pressed=true when enabled', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-pressed', 'true')
    })

    it('should call onToggle with false when clicked while enabled', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnToggle).toHaveBeenCalledWith(false)
    })

    it('should apply primary text color when enabled', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('text-primary')
    })

    it('should not show sound wave animation when not speaking', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} isSpeaking={false} />)

      // Sound wave bars have specific animation style
      const animatedElements = document.querySelectorAll('[style*="animation"]')
      expect(animatedElements.length).toBe(0)
    })
  })

  describe('Speaking State', () => {
    it('should have correct aria-label when speaking', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} isSpeaking={true} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Voice narration active - Click to disable')
    })

    it('should show sound wave animation when speaking', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} isSpeaking={true} />)

      // Sound wave bars have animation styles
      const animatedElements = document.querySelectorAll('[style*="animation"]')
      expect(animatedElements.length).toBeGreaterThan(0)
    })

    it('should render multiple sound wave bars when speaking', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} isSpeaking={true} />)

      // There should be 5 sound wave bars (based on delays array)
      const animatedElements = document.querySelectorAll('[style*="animation"]')
      expect(animatedElements.length).toBe(5)
    })
  })

  describe('Button Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} disabled={true} />)

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should not call onToggle when clicked while disabled', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} disabled={true} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnToggle).not.toHaveBeenCalled()
    })
  })

  describe('Keyboard Accessibility', () => {
    it('should toggle on Enter key', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      button.focus()
      await user.keyboard('{Enter}')

      expect(mockOnToggle).toHaveBeenCalledWith(true)
    })

    it('should toggle on Space key', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceNarrationToggle enabled={true} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      button.focus()
      await user.keyboard(' ')

      expect(mockOnToggle).toHaveBeenCalledWith(false)
    })
  })

  describe('Custom className', () => {
    it('should apply custom className', () => {
      renderWithTooltip(
        <VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} className="custom-class" />
      )

      const button = screen.getByRole('button')
      expect(button.className).toContain('custom-class')
    })
  })

  describe('Button Type', () => {
    it('should have type="button" to prevent form submission', () => {
      renderWithTooltip(<VoiceNarrationToggle enabled={false} onToggle={mockOnToggle} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'button')
    })
  })
})
