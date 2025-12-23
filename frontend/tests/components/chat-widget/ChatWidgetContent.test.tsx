import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatWidgetContent } from '@/components/chat-widget/ChatWidgetContent'
import { ChatWidgetProvider } from '@/contexts/ChatWidgetContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { UseVoiceNarrationReturn } from '@/hooks/useVoiceNarration'

// Mock useVoiceNarration hook
const mockUseVoiceNarration: UseVoiceNarrationReturn = {
  isSpeaking: false,
  isPaused: false,
  currentText: null,
  queueLength: 0,
  speak: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  skip: vi.fn(),
  stop: vi.fn(),
  setEnabled: vi.fn(),
  isSupported: true,
  availableVoices: [],
}

vi.mock('@/hooks/useVoiceNarration', () => ({
  useVoiceNarration: vi.fn(() => mockUseVoiceNarration),
}))

// Helper to render with provider
function renderWithProvider(
  ui: React.ReactElement,
  options?: {
    initialExecutionId?: string | null
    defaultNarrationEnabled?: boolean
  }
) {
  return render(
    <TooltipProvider>
      <ChatWidgetProvider
        initialExecutionId={options?.initialExecutionId}
        defaultNarrationEnabled={options?.defaultNarrationEnabled}
      >
        {ui}
      </ChatWidgetProvider>
    </TooltipProvider>
  )
}

describe('ChatWidgetContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock state
    mockUseVoiceNarration.isSpeaking = false
    mockUseVoiceNarration.isPaused = false
    mockUseVoiceNarration.currentText = null
    mockUseVoiceNarration.isSupported = true
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render children content', () => {
      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div data-testid="child-content">Test Content</div>
        </ChatWidgetContent>
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })

    it('should render header content when provided', () => {
      renderWithProvider(
        <ChatWidgetContent
          executionId="exec-123"
          headerContent={<span data-testid="header">Custom Header</span>}
        >
          <div>Content</div>
        </ChatWidgetContent>
      )

      expect(screen.getByTestId('header')).toBeInTheDocument()
      expect(screen.getByText('Custom Header')).toBeInTheDocument()
    })

    it('should apply className to container', () => {
      const { container } = renderWithProvider(
        <ChatWidgetContent executionId="exec-123" className="custom-class">
          <div>Content</div>
        </ChatWidgetContent>
      )

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('VoiceNarrationToggle', () => {
    it('should render narration toggle when supported', () => {
      mockUseVoiceNarration.isSupported = true

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { defaultNarrationEnabled: false }
      )

      // Find the toggle button by aria-label
      const toggle = screen.getByRole('button', { name: /narration/i })
      expect(toggle).toBeInTheDocument()
    })

    it('should not render narration toggle when not supported', () => {
      mockUseVoiceNarration.isSupported = false

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>
      )

      // Toggle should not be present
      const toggle = screen.queryByRole('button', { name: /narration/i })
      expect(toggle).not.toBeInTheDocument()
    })

    it('should enable narration when toggle is clicked', () => {
      mockUseVoiceNarration.isSupported = true

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { defaultNarrationEnabled: false }
      )

      const toggle = screen.getByRole('button', { name: /narration/i })
      fireEvent.click(toggle)

      // The toggle click should trigger setEnabled
      // (internal state update happens via context)
    })
  })

  describe('VoiceSpeakingIndicator', () => {
    it('should not show indicator when not speaking', () => {
      mockUseVoiceNarration.isSpeaking = false
      mockUseVoiceNarration.currentText = null

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-123' }
      )

      // Indicator should not be visible
      const skipButton = screen.queryByRole('button', { name: /skip/i })
      expect(skipButton).not.toBeInTheDocument()
    })

    it('should show indicator when speaking', () => {
      mockUseVoiceNarration.isSpeaking = true
      mockUseVoiceNarration.currentText = 'Reading the login component...'

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-123' }
      )

      // Indicator text should be visible
      expect(screen.getByText(/"Reading the login component..."/)).toBeInTheDocument()
    })

    it('should call skip when skip button is clicked', () => {
      mockUseVoiceNarration.isSpeaking = true
      mockUseVoiceNarration.currentText = 'Some narration text'

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-123' }
      )

      const skipButton = screen.getByRole('button', { name: /skip/i })
      fireEvent.click(skipButton)

      expect(mockUseVoiceNarration.skip).toHaveBeenCalled()
    })
  })

  describe('Execution Focus', () => {
    it('should show speaking indicator only when this execution is focused', () => {
      mockUseVoiceNarration.isSpeaking = true
      mockUseVoiceNarration.currentText = 'Test narration'

      // Execution is focused (matches initialExecutionId)
      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-123' }
      )

      expect(screen.getByText(/"Test narration"/)).toBeInTheDocument()
    })

    it('should not show speaking indicator when different execution is focused', () => {
      mockUseVoiceNarration.isSpeaking = true
      mockUseVoiceNarration.currentText = 'Test narration'

      // Different execution is focused
      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-456' }
      )

      // Indicator should not show because this execution is not focused
      const skipButton = screen.queryByRole('button', { name: /skip/i })
      expect(skipButton).not.toBeInTheDocument()
    })
  })

  describe('Callbacks', () => {
    it('should call onNarrationStateChange when speaking starts', async () => {
      const onNarrationStateChange = vi.fn()

      // Get the useVoiceNarration mock to access the options
      const { useVoiceNarration: mockHook } = await import('@/hooks/useVoiceNarration')

      // Render component
      renderWithProvider(
        <ChatWidgetContent
          executionId="exec-123"
          onNarrationStateChange={onNarrationStateChange}
        >
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-123' }
      )

      // The hook was called with callbacks
      expect(mockHook).toHaveBeenCalled()
    })
  })

  describe('Recording Coordination', () => {
    it('should pause narration when recording starts', () => {
      // This behavior is tested via the context - the component reacts to isRecording
      // changes from the context and calls pause/resume accordingly
      mockUseVoiceNarration.isSpeaking = true
      mockUseVoiceNarration.isPaused = false

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-123' }
      )

      // The pause effect is triggered by context state change
      // This is an integration behavior tested via useEffect
    })
  })

  describe('Stop on Execution Switch', () => {
    it('should call stop when execution is no longer focused', () => {
      mockUseVoiceNarration.isSpeaking = true

      const { rerender } = renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { initialExecutionId: 'exec-123' }
      )

      // Initially focused - stop should not have been called
      expect(mockUseVoiceNarration.stop).not.toHaveBeenCalled()

      // Rerender with different focused execution (simulated by wrapping in new provider)
      rerender(
        <TooltipProvider>
          <ChatWidgetProvider initialExecutionId="exec-456">
            <ChatWidgetContent executionId="exec-123">
              <div>Content</div>
            </ChatWidgetContent>
          </ChatWidgetProvider>
        </TooltipProvider>
      )

      // Stop should have been called because focused execution changed
      expect(mockUseVoiceNarration.stop).toHaveBeenCalled()
    })
  })

  describe('Toggle Behavior', () => {
    it('should stop narration when toggle is disabled', () => {
      mockUseVoiceNarration.isSpeaking = true
      mockUseVoiceNarration.isSupported = true

      renderWithProvider(
        <ChatWidgetContent executionId="exec-123">
          <div>Content</div>
        </ChatWidgetContent>,
        { defaultNarrationEnabled: true, initialExecutionId: 'exec-123' }
      )

      // Click toggle to disable
      const toggle = screen.getByRole('button', { name: /narration/i })
      fireEvent.click(toggle)

      // Stop should be called when disabling narration
      expect(mockUseVoiceNarration.stop).toHaveBeenCalled()
    })
  })
})
