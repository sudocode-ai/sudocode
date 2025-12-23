import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceSpeakingIndicator } from '@/components/voice/VoiceSpeakingIndicator'

describe('VoiceSpeakingIndicator', () => {
  const mockOnSkip = vi.fn()

  beforeEach(() => {
    mockOnSkip.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Visibility', () => {
    it('should not render when isSpeaking is false', () => {
      render(<VoiceSpeakingIndicator text="Hello world" isSpeaking={false} />)

      expect(screen.queryByText(/Hello world/)).not.toBeInTheDocument()
    })

    it('should not render when text is null', () => {
      render(<VoiceSpeakingIndicator text={null} isSpeaking={true} />)

      expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument()
    })

    it('should not render when text is empty string', () => {
      render(<VoiceSpeakingIndicator text="" isSpeaking={true} />)

      // Component returns null for empty/falsy text
      expect(document.querySelector('.flex.items-center')).not.toBeInTheDocument()
    })

    it('should render when isSpeaking is true and text is provided', () => {
      render(<VoiceSpeakingIndicator text="Hello world" isSpeaking={true} />)

      expect(screen.getByText(/"Hello world"/)).toBeInTheDocument()
    })
  })

  describe('Text Display', () => {
    it('should display the text in quotes', () => {
      render(<VoiceSpeakingIndicator text="Reading the file" isSpeaking={true} />)

      expect(screen.getByText(/"Reading the file"/)).toBeInTheDocument()
    })

    it('should truncate long text to 50 characters with ellipsis', () => {
      const longText = 'This is a very long text that exceeds fifty characters and should be truncated'
      render(<VoiceSpeakingIndicator text={longText} isSpeaking={true} />)

      // Text should be truncated to 47 chars + '...' = 50 total
      // "This is a very long text that exceeds fifty c" = 47 chars
      const truncatedContent = longText.slice(0, 47) + '...'
      expect(screen.getByText(`"${truncatedContent}"`)).toBeInTheDocument()
    })

    it('should not truncate text that is exactly 50 characters', () => {
      // Create a string that is exactly 50 characters
      const fiftyCharText = '12345678901234567890123456789012345678901234567890'
      expect(fiftyCharText.length).toBe(50)

      render(<VoiceSpeakingIndicator text={fiftyCharText} isSpeaking={true} />)

      expect(screen.getByText(`"${fiftyCharText}"`)).toBeInTheDocument()
    })

    it('should show full text in title attribute for accessibility', () => {
      const longText = 'This is a very long text that should be shown in the title attribute'
      render(<VoiceSpeakingIndicator text={longText} isSpeaking={true} />)

      const textElement = screen.getByTitle(longText)
      expect(textElement).toBeInTheDocument()
    })
  })

  describe('Sound Wave Visualization', () => {
    it('should render animated sound wave bars', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} />)

      // Sound wave bars have animation styles
      const animatedElements = document.querySelectorAll('[style*="animation"]')
      expect(animatedElements.length).toBeGreaterThan(0)
    })

    it('should render 7 sound wave bars', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} />)

      // Based on delays array: [0, 100, 200, 300, 200, 100, 0]
      const animatedElements = document.querySelectorAll('[style*="animation"]')
      expect(animatedElements.length).toBe(7)
    })
  })

  describe('Skip Button', () => {
    it('should render skip button when onSkip is provided', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} onSkip={mockOnSkip} />)

      const skipButton = screen.getByRole('button', { name: /skip narration/i })
      expect(skipButton).toBeInTheDocument()
    })

    it('should not render skip button when onSkip is not provided', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} />)

      expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument()
    })

    it('should call onSkip when skip button is clicked', async () => {
      const user = userEvent.setup()

      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} onSkip={mockOnSkip} />)

      const skipButton = screen.getByRole('button', { name: /skip narration/i })
      await user.click(skipButton)

      expect(mockOnSkip).toHaveBeenCalledTimes(1)
    })

    it('should display Skip text with icon', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} onSkip={mockOnSkip} />)

      const skipButton = screen.getByRole('button', { name: /skip narration/i })
      expect(skipButton).toHaveTextContent('Skip')
      // Check for SkipForward icon
      expect(skipButton.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Volume Icon', () => {
    it('should render volume icon', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} />)

      // Volume2 icon is rendered
      const svgElements = document.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThan(0)
    })
  })

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <VoiceSpeakingIndicator text="Hello" isSpeaking={true} className="custom-class" />
      )

      const indicator = container.firstChild as HTMLElement
      expect(indicator.className).toContain('custom-class')
    })
  })

  describe('Styling', () => {
    it('should have rounded border and muted background', () => {
      const { container } = render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} />)

      const indicator = container.firstChild as HTMLElement
      expect(indicator.className).toContain('rounded-md')
      expect(indicator.className).toContain('border')
      expect(indicator.className).toContain('bg-muted')
    })

    it('should have fade-in animation class', () => {
      const { container } = render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} />)

      const indicator = container.firstChild as HTMLElement
      expect(indicator.className).toContain('animate-in')
      expect(indicator.className).toContain('fade-in')
    })
  })

  describe('Accessibility', () => {
    it('should have accessible skip button with aria-label', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} onSkip={mockOnSkip} />)

      const skipButton = screen.getByRole('button')
      expect(skipButton).toHaveAttribute('aria-label', 'Skip narration')
    })

    it('should have type="button" on skip button', () => {
      render(<VoiceSpeakingIndicator text="Hello" isSpeaking={true} onSkip={mockOnSkip} />)

      const skipButton = screen.getByRole('button')
      expect(skipButton).toHaveAttribute('type', 'button')
    })
  })
})
