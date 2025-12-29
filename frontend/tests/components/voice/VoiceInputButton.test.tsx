import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceInputButton } from '@/components/voice/VoiceInputButton'
import { TooltipProvider } from '@/components/ui/tooltip'
import React from 'react'

// Mock the useVoiceInput hook
const mockStartRecording = vi.fn()
const mockStopRecording = vi.fn()
const mockCancelRecording = vi.fn()

vi.mock('@/hooks/useVoiceInput', () => ({
  useVoiceInput: vi.fn(() => ({
    state: 'idle',
    error: null,
    startRecording: mockStartRecording,
    stopRecording: mockStopRecording,
    cancelRecording: mockCancelRecording,
    hasPermission: true,
    duration: 0,
    isSupported: true,
    sttProvider: 'browser',
    isConfigLoading: false,
  })),
}))

// Import the mocked module
import { useVoiceInput } from '@/hooks/useVoiceInput'
const mockUseVoiceInput = vi.mocked(useVoiceInput)

describe('VoiceInputButton', () => {
  const mockOnTranscription = vi.fn()

  beforeEach(() => {
    mockOnTranscription.mockClear()
    mockStartRecording.mockClear()
    mockStopRecording.mockClear()
    mockCancelRecording.mockClear()
    // Reset to default state
    mockUseVoiceInput.mockReturnValue({
      state: 'idle',
      error: null,
      transcription: null,
      recordingDuration: 0,
      startRecording: mockStartRecording,
      stopRecording: mockStopRecording,
      cancelRecording: mockCancelRecording,
      clearTranscription: vi.fn(),
      hasPermission: true,
      requestPermission: vi.fn(),
      isSupported: true,
      duration: 0,
      sttProvider: 'browser',
      isConfigLoading: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to render with TooltipProvider
  const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>)
  }

  describe('Idle State', () => {
    it('should render microphone icon in idle state', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      // Check for Mic icon (SVG should be present)
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('should have correct aria-label in idle state', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Click to start voice input')
    })

    it('should call startRecording when clicked in idle state', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockStartRecording).toHaveBeenCalled()
    })

    it('should use ghost variant in idle state', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      // Ghost variant has transparent background
      expect(button.className).not.toContain('bg-red')
    })
  })

  describe('Recording State', () => {
    beforeEach(() => {
      mockUseVoiceInput.mockReturnValue({
        state: 'recording',
        error: null,
        transcription: null,
        recordingDuration: 5,
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
        cancelRecording: mockCancelRecording,
        clearTranscription: vi.fn(),
        hasPermission: true,
        requestPermission: vi.fn(),
        isSupported: true,
        duration: 5,
        sttProvider: 'browser',
        isConfigLoading: false,
      })
    })

    it('should show square/stop icon when recording', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('should have red background when recording', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-red-500')
    })

    it('should have correct aria-label when recording', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Click to stop recording')
    })

    it('should call stopRecording when clicked while recording', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockStopRecording).toHaveBeenCalled()
    })

    it('should cancel recording when Escape is pressed', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      button.focus()
      await user.keyboard('{Escape}')

      expect(mockCancelRecording).toHaveBeenCalled()
    })
  })

  describe('Transcribing State', () => {
    beforeEach(() => {
      mockUseVoiceInput.mockReturnValue({
        state: 'transcribing',
        error: null,
        transcription: null,
        recordingDuration: 0,
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
        cancelRecording: mockCancelRecording,
        clearTranscription: vi.fn(),
        hasPermission: true,
        requestPermission: vi.fn(),
        isSupported: true,
        duration: 0,
        sttProvider: 'browser',
        isConfigLoading: false,
      })
    })

    it('should show loading spinner when transcribing', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      const svg = button.querySelector('svg')
      expect(svg).toBeInTheDocument()
      // Lucide icons have the animate-spin class applied via cn()
      expect(svg?.classList.toString()).toContain('animate-spin')
    })

    it('should be disabled when transcribing', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should have correct aria-label when transcribing', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Transcribing...')
    })

    it('should not call any action when clicked while transcribing', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockStartRecording).not.toHaveBeenCalled()
      expect(mockStopRecording).not.toHaveBeenCalled()
    })
  })

  describe('Error State', () => {
    beforeEach(() => {
      mockUseVoiceInput.mockReturnValue({
        state: 'error',
        error: { code: 'transcription_failed', message: 'Transcription failed' },
        transcription: null,
        recordingDuration: 0,
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
        cancelRecording: mockCancelRecording,
        clearTranscription: vi.fn(),
        hasPermission: true,
        requestPermission: vi.fn(),
        isSupported: true,
        duration: 0,
        sttProvider: 'browser',
        isConfigLoading: false,
      })
    })

    it('should show alert icon in error state', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('should have error styling in error state', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('border-destructive')
      expect(button.className).toContain('text-destructive')
    })

    it('should show error message in aria-label', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Transcription failed')
    })

    it('should allow retry by clicking in error state', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockStartRecording).toHaveBeenCalled()
    })
  })

  describe('Permission Denied', () => {
    beforeEach(() => {
      mockUseVoiceInput.mockReturnValue({
        state: 'idle',
        error: null,
        transcription: null,
        recordingDuration: 0,
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
        cancelRecording: mockCancelRecording,
        clearTranscription: vi.fn(),
        hasPermission: false,
        requestPermission: vi.fn(),
        isSupported: true,
        duration: 0,
        sttProvider: 'browser',
        isConfigLoading: false,
      })
    })

    it('should show permission denied message in aria-label', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Microphone access denied. Click to retry.')
    })
  })

  describe('Not Supported', () => {
    beforeEach(() => {
      mockUseVoiceInput.mockReturnValue({
        state: 'idle',
        error: null,
        transcription: null,
        recordingDuration: 0,
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
        cancelRecording: mockCancelRecording,
        clearTranscription: vi.fn(),
        hasPermission: null,
        requestPermission: vi.fn(),
        isSupported: false,
        duration: 0,
        sttProvider: null,
        isConfigLoading: false,
      })
    })

    it('should be disabled when not supported', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should show not supported message in aria-label', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Voice input is not supported in this browser')
    })
  })

  describe('Disabled Prop', () => {
    it('should be disabled when disabled prop is true', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} disabled={true} />)

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should not be disabled when disabled prop is false', () => {
      renderWithTooltip(
        <VoiceInputButton onTranscription={mockOnTranscription} disabled={false} />
      )

      const button = screen.getByRole('button')
      expect(button).not.toBeDisabled()
    })
  })

  describe('Size Prop', () => {
    it('should use default size when no size prop provided', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('h-8')
      expect(button.className).toContain('w-8')
    })

    it('should use small size when size=sm', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} size="sm" />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('h-7')
      expect(button.className).toContain('w-7')
    })
  })

  describe('Duration Display', () => {
    beforeEach(() => {
      mockUseVoiceInput.mockReturnValue({
        state: 'recording',
        error: null,
        transcription: null,
        recordingDuration: 65,
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
        cancelRecording: mockCancelRecording,
        clearTranscription: vi.fn(),
        hasPermission: true,
        requestPermission: vi.fn(),
        isSupported: true,
        duration: 65,
        sttProvider: 'browser',
        isConfigLoading: false,
      })
    })

    it('should format duration correctly in tooltip', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} showDuration />)

      const button = screen.getByRole('button')

      // Hover to show tooltip
      await user.hover(button)

      // Wait for tooltip to appear - Radix may render multiple elements for accessibility
      await waitFor(() => {
        const durationElements = screen.getAllByText('1:05')
        expect(durationElements.length).toBeGreaterThan(0)
      })
    })

    it('should not show duration when showDuration is false', async () => {
      const user = userEvent.setup()

      renderWithTooltip(
        <VoiceInputButton onTranscription={mockOnTranscription} showDuration={false} />
      )

      const button = screen.getByRole('button')
      await user.hover(button)

      await waitFor(() => {
        expect(screen.queryByText('1:05')).not.toBeInTheDocument()
      })
    })
  })

  describe('Language Prop', () => {
    it('should pass language to useVoiceInput', () => {
      renderWithTooltip(
        <VoiceInputButton onTranscription={mockOnTranscription} language="es" />
      )

      // Check that useVoiceInput was called with the language option
      expect(mockUseVoiceInput).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'es' })
      )
    })

    it('should use en as default language', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      expect(mockUseVoiceInput).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'en' })
      )
    })
  })

  describe('Custom className', () => {
    it('should apply custom className', () => {
      renderWithTooltip(
        <VoiceInputButton onTranscription={mockOnTranscription} className="custom-class" />
      )

      const button = screen.getByRole('button')
      expect(button.className).toContain('custom-class')
    })
  })

  describe('Button Styling', () => {
    it('should have rounded-full class for circular button', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('rounded-full')
    })

    it('should have shrink-0 to prevent shrinking', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('shrink-0')
    })

    it('should have transition classes for smooth state changes', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('transition-all')
    })
  })

  describe('Keyboard Accessibility', () => {
    it('should be focusable', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      button.focus()
      expect(document.activeElement).toBe(button)
    })

    it('should be activatable with Enter key', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      button.focus()
      await user.keyboard('{Enter}')

      expect(mockStartRecording).toHaveBeenCalled()
    })

    it('should be activatable with Space key', async () => {
      const user = userEvent.setup()

      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      const button = screen.getByRole('button')
      button.focus()
      await user.keyboard(' ')

      expect(mockStartRecording).toHaveBeenCalled()
    })
  })

  describe('onTranscription callback', () => {
    it('should pass onTranscription to useVoiceInput', () => {
      renderWithTooltip(<VoiceInputButton onTranscription={mockOnTranscription} />)

      expect(mockUseVoiceInput).toHaveBeenCalledWith(
        expect.objectContaining({ onTranscription: mockOnTranscription })
      )
    })
  })
})
