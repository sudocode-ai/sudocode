import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useVoiceNarration } from '@/hooks/useVoiceNarration'

// Mock WebSocket context
const mockAddMessageHandler = vi.fn()
const mockRemoveMessageHandler = vi.fn()
const mockSubscribe = vi.fn()
const mockUnsubscribe = vi.fn()

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    addMessageHandler: mockAddMessageHandler,
    removeMessageHandler: mockRemoveMessageHandler,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    connected: true,
  }),
}))

// Mock SpeechSynthesis
class MockSpeechSynthesisUtterance {
  text: string
  rate: number = 1
  volume: number = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

// Mock SpeechSynthesis API
const mockSpeak = vi.fn()
const mockCancel = vi.fn()
const mockPause = vi.fn()
const mockResume = vi.fn()
const mockGetVoices = vi.fn(() => [
  { name: 'English Voice', voiceURI: 'en-US', lang: 'en-US' },
  { name: 'Spanish Voice', voiceURI: 'es-ES', lang: 'es-ES' },
])

const mockSpeechSynthesis = {
  speak: mockSpeak,
  cancel: mockCancel,
  pause: mockPause,
  resume: mockResume,
  getVoices: mockGetVoices,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}

describe('useVoiceNarration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Setup global mocks
    global.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance as unknown as typeof SpeechSynthesisUtterance
    Object.defineProperty(window, 'speechSynthesis', {
      value: mockSpeechSynthesis,
      writable: true,
      configurable: true,
    })

    // Default mock implementations
    mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
      // Simulate immediate start
      utterance.onstart?.()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      expect(result.current.isSpeaking).toBe(false)
      expect(result.current.isPaused).toBe(false)
      expect(result.current.currentText).toBeNull()
      expect(result.current.queueLength).toBe(0)
      expect(result.current.isSupported).toBe(true)
    })

    it('should report isSupported as false when speechSynthesis unavailable', () => {
      // Save original
      const originalSpeechSynthesis = window.speechSynthesis

      // Delete speechSynthesis before rendering
      // @ts-expect-error - intentionally removing for test
      delete window.speechSynthesis

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      expect(result.current.isSupported).toBe(false)

      // Restore
      Object.defineProperty(window, 'speechSynthesis', {
        value: originalSpeechSynthesis,
        writable: true,
        configurable: true,
      })
    })

    it('should subscribe to execution WebSocket events on mount', () => {
      renderHook(() => useVoiceNarration({ executionId: 'exec-123' }))

      expect(mockAddMessageHandler).toHaveBeenCalledWith(
        'voice-narration-exec-123',
        expect.any(Function)
      )
      expect(mockSubscribe).toHaveBeenCalledWith('execution', 'exec-123')
    })

    it('should unsubscribe from WebSocket events on unmount', () => {
      const { unmount } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      unmount()

      expect(mockRemoveMessageHandler).toHaveBeenCalledWith(
        'voice-narration-exec-123'
      )
      expect(mockUnsubscribe).toHaveBeenCalledWith('execution', 'exec-123')
    })
  })

  describe('speak()', () => {
    it('should start speaking text', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('Hello, world!')
      })

      expect(mockSpeak).toHaveBeenCalled()
      expect(result.current.isSpeaking).toBe(true)
      expect(result.current.currentText).toBe('Hello, world!')
    })

    it('should not speak when disabled', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: false })
      )

      act(() => {
        result.current.speak('Hello, world!')
      })

      expect(mockSpeak).not.toHaveBeenCalled()
    })

    it('should not speak empty text', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('')
        result.current.speak('   ')
      })

      expect(mockSpeak).not.toHaveBeenCalled()
    })

    it('should apply rate and volume options', () => {
      let capturedUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        capturedUtterance = utterance
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({
          executionId: 'exec-123',
          rate: 1.5,
          volume: 0.8,
        })
      )

      act(() => {
        result.current.speak('Test text')
      })

      expect(capturedUtterance).not.toBeNull()
      expect(capturedUtterance!.rate).toBe(1.5)
      expect(capturedUtterance!.volume).toBe(0.8)
    })

    it('should clamp rate to valid range (0.5 - 2.0)', () => {
      let capturedUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        capturedUtterance = utterance
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({
          executionId: 'exec-123',
          rate: 5.0, // Too high
        })
      )

      act(() => {
        result.current.speak('Test text')
      })

      expect(capturedUtterance!.rate).toBe(2.0)
    })

    it('should clamp volume to valid range (0 - 1)', () => {
      let capturedUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        capturedUtterance = utterance
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({
          executionId: 'exec-123',
          volume: 2.0, // Too high
        })
      )

      act(() => {
        result.current.speak('Test text')
      })

      expect(capturedUtterance!.volume).toBe(1)
    })
  })

  describe('Priority Queue', () => {
    it('should queue normal priority items in order', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
        // Don't call onend to keep items in queue
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('First', 'normal')
        result.current.speak('Second', 'normal')
        result.current.speak('Third', 'normal')
      })

      // First item is being spoken, rest are queued
      expect(result.current.currentText).toBe('First')
      expect(result.current.queueLength).toBe(2)
    })

    it('should interrupt current speech for high priority items', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('Normal item', 'normal')
      })

      expect(mockCancel).not.toHaveBeenCalled()

      act(() => {
        result.current.speak('High priority!', 'high')
      })

      expect(mockCancel).toHaveBeenCalled()
    })

    it('should skip low priority items when queue is full', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
        // Don't call onend to keep processing occupied
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      // Fill the queue
      act(() => {
        result.current.speak('Item 1', 'normal')
        result.current.speak('Item 2', 'normal')
        result.current.speak('Item 3', 'normal')
        result.current.speak('Item 4', 'normal')
      })

      // Queue should have items 2, 3, 4 (item 1 is being spoken)
      const queueLengthBefore = result.current.queueLength

      // Try to add a low priority item
      act(() => {
        result.current.speak('Low priority', 'low')
      })

      // Low priority should be skipped since queue > 3
      expect(result.current.queueLength).toBe(queueLengthBefore)
    })

    it('should process queue when current utterance ends', async () => {
      let currentUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        currentUtterance = utterance
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('First', 'normal')
        result.current.speak('Second', 'normal')
      })

      expect(result.current.currentText).toBe('First')

      // Simulate end of first utterance
      act(() => {
        currentUtterance?.onend?.()
      })

      // Advance timers for the small delay
      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      expect(result.current.currentText).toBe('Second')
    })
  })

  describe('Controls', () => {
    it('should pause speech', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('Test text')
        result.current.pause()
      })

      expect(mockPause).toHaveBeenCalled()
      expect(result.current.isPaused).toBe(true)
    })

    it('should resume speech', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('Test text')
        result.current.pause()
        result.current.resume()
      })

      expect(mockResume).toHaveBeenCalled()
      expect(result.current.isPaused).toBe(false)
    })

    it('should skip current utterance', async () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('First', 'normal')
        result.current.speak('Second', 'normal')
      })

      expect(result.current.currentText).toBe('First')

      act(() => {
        result.current.skip()
      })

      expect(mockCancel).toHaveBeenCalled()

      // Advance timers for queue processing
      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      // Should move to next item
      expect(result.current.currentText).toBe('Second')
    })

    it('should stop all speech and clear queue', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('First', 'normal')
        result.current.speak('Second', 'normal')
        result.current.speak('Third', 'normal')
      })

      act(() => {
        result.current.stop()
      })

      expect(mockCancel).toHaveBeenCalled()
      expect(result.current.isSpeaking).toBe(false)
      expect(result.current.currentText).toBeNull()
      expect(result.current.queueLength).toBe(0)
    })
  })

  describe('setEnabled()', () => {
    it('should enable narration', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: false })
      )

      act(() => {
        result.current.setEnabled(true)
      })

      act(() => {
        result.current.speak('Test')
      })

      expect(mockSpeak).toHaveBeenCalled()
    })

    it('should disable narration and stop current speech', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
      )

      act(() => {
        result.current.speak('Test')
      })

      expect(result.current.isSpeaking).toBe(true)

      act(() => {
        result.current.setEnabled(false)
      })

      expect(mockCancel).toHaveBeenCalled()
      expect(result.current.isSpeaking).toBe(false)
    })
  })

  describe('Callbacks', () => {
    it('should call onStart when speech starts', () => {
      const onStart = vi.fn()

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', onStart })
      )

      act(() => {
        result.current.speak('Test')
      })

      expect(onStart).toHaveBeenCalled()
    })

    it('should call onEnd when all speech completes', () => {
      let currentUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        currentUtterance = utterance
        utterance.onstart?.()
      })

      const onEnd = vi.fn()

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', onEnd })
      )

      act(() => {
        result.current.speak('Test')
      })

      // Simulate speech end
      act(() => {
        currentUtterance?.onend?.()
      })

      expect(onEnd).toHaveBeenCalled()
    })

    it('should call onError on speech synthesis error', () => {
      let currentUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        currentUtterance = utterance
        utterance.onstart?.()
      })

      const onError = vi.fn()

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', onError })
      )

      act(() => {
        result.current.speak('Test')
      })

      // Simulate error
      act(() => {
        currentUtterance?.onerror?.({ error: 'synthesis-failed' })
      })

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('synthesis-failed'),
        })
      )
    })

    it('should not call onError for interrupted/canceled errors', () => {
      let currentUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        currentUtterance = utterance
        utterance.onstart?.()
      })

      const onError = vi.fn()

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', onError })
      )

      act(() => {
        result.current.speak('Test')
      })

      // Simulate interrupted error (expected when skipping)
      act(() => {
        currentUtterance?.onerror?.({ error: 'interrupted' })
      })

      expect(onError).not.toHaveBeenCalled()

      // Simulate canceled error (expected when stopping)
      act(() => {
        currentUtterance?.onerror?.({ error: 'canceled' })
      })

      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('WebSocket Message Handling', () => {
    it('should handle voice_narration messages', () => {
      let messageHandler: ((message: any) => void) | null = null
      mockAddMessageHandler.mockImplementation((_id: string, handler: any) => {
        messageHandler = handler
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      // Simulate receiving a voice_narration message
      act(() => {
        messageHandler?.({
          type: 'voice_narration',
          data: {
            executionId: 'exec-123',
            text: 'Reading file.ts',
            category: 'progress',
            priority: 'normal',
          },
        })
      })

      expect(mockSpeak).toHaveBeenCalled()
      expect(result.current.currentText).toBe('Reading file.ts')
    })

    it('should filter messages by executionId', () => {
      let messageHandler: ((message: any) => void) | null = null
      mockAddMessageHandler.mockImplementation((_id: string, handler: any) => {
        messageHandler = handler
      })

      renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      // Simulate message for different execution
      act(() => {
        messageHandler?.({
          type: 'voice_narration',
          data: {
            executionId: 'exec-different',
            text: 'Should be ignored',
            category: 'progress',
            priority: 'normal',
          },
        })
      })

      expect(mockSpeak).not.toHaveBeenCalled()
    })

    it('should ignore non voice_narration messages', () => {
      let messageHandler: ((message: any) => void) | null = null
      mockAddMessageHandler.mockImplementation((_id: string, handler: any) => {
        messageHandler = handler
      })

      renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      // Simulate different message type
      act(() => {
        messageHandler?.({
          type: 'execution_updated',
          data: { id: 'exec-123' },
        })
      })

      expect(mockSpeak).not.toHaveBeenCalled()
    })

    it('should not handle messages when disabled', () => {
      let messageHandler: ((message: any) => void) | null = null
      mockAddMessageHandler.mockImplementation((_id: string, handler: any) => {
        messageHandler = handler
      })

      renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: false })
      )

      // Simulate receiving a voice_narration message
      act(() => {
        messageHandler?.({
          type: 'voice_narration',
          data: {
            executionId: 'exec-123',
            text: 'Should be ignored',
            category: 'progress',
            priority: 'normal',
          },
        })
      })

      expect(mockSpeak).not.toHaveBeenCalled()
    })
  })

  describe('Voice Selection', () => {
    it('should load available voices', async () => {
      vi.useRealTimers()

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      await waitFor(() => {
        expect(result.current.availableVoices.length).toBeGreaterThan(0)
      })

      vi.useFakeTimers()
    })

    it('should select voice by name', () => {
      let capturedUtterance: MockSpeechSynthesisUtterance | undefined
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        capturedUtterance = utterance
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({
          executionId: 'exec-123',
          voice: 'English Voice',
        })
      )

      act(() => {
        result.current.speak('Test')
      })

      expect(capturedUtterance).toBeDefined()
      expect(capturedUtterance!.voice).toEqual(
        expect.objectContaining({ name: 'English Voice' })
      )
    })
  })

  describe('Cleanup', () => {
    it('should cancel speech on unmount', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
      })

      const { result, unmount } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        result.current.speak('Test')
      })

      unmount()

      expect(mockCancel).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid speak calls', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123' })
      )

      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.speak(`Message ${i}`)
        }
      })

      // First message should be speaking
      expect(result.current.isSpeaking).toBe(true)
      // Rest should be queued (minus the first one being spoken)
      expect(result.current.queueLength).toBe(9)
    })

    it('should handle enabled prop changes', () => {
      const { result, rerender } = renderHook(
        ({ enabled }) => useVoiceNarration({ executionId: 'exec-123', enabled }),
        { initialProps: { enabled: true } }
      )

      // Initially enabled
      act(() => {
        result.current.speak('Test')
      })
      expect(mockSpeak).toHaveBeenCalled()

      // Disable via prop change
      rerender({ enabled: false })

      vi.clearAllMocks()

      // Should not speak when disabled
      act(() => {
        result.current.speak('Another test')
      })
      expect(mockSpeak).not.toHaveBeenCalled()
    })
  })
})
