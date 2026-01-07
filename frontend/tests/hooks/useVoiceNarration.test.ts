import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Use vi.hoisted for kokoroTTS mocks
const {
  mockLoadKokoroModel,
  mockGenerateSpeech,
  mockIsKokoroReady,
  mockGetKokoroState,
  mockSubscribeToState,
  mockGetAvailableVoices,
} = vi.hoisted(() => ({
  mockLoadKokoroModel: vi.fn(),
  mockGenerateSpeech: vi.fn(),
  mockIsKokoroReady: vi.fn(),
  mockGetKokoroState: vi.fn(),
  mockSubscribeToState: vi.fn(),
  mockGetAvailableVoices: vi.fn(() => [
    { id: 'af_heart', name: 'Heart', gender: 'female', language: 'en-US' },
    { id: 'am_adam', name: 'Adam', gender: 'male', language: 'en-US' },
  ]),
}))

vi.mock('@/lib/kokoroTTS', () => ({
  loadKokoroModel: mockLoadKokoroModel,
  generateSpeech: mockGenerateSpeech,
  isKokoroReady: mockIsKokoroReady,
  getKokoroState: mockGetKokoroState,
  subscribeToState: mockSubscribeToState,
  getAvailableVoices: mockGetAvailableVoices,
}))

// Mock sonner toast
const mockToast = vi.hoisted(() => ({
  loading: vi.fn(() => 'toast-id'),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

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

// Mock AudioContext for Kokoro
const mockAudioStop = vi.fn()
const mockAudioStart = vi.fn()
const mockAudioConnect = vi.fn()
const mockAudioContextResume = vi.fn()
const mockAudioContextClose = vi.fn()
const mockGainNode = {
  gain: { value: 1 },
  connect: vi.fn(),
}

class MockAudioBufferSourceNode {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  stop = mockAudioStop
  start = mockAudioStart
  connect = mockAudioConnect
}

class MockAudioContext {
  state = 'running'
  resume = mockAudioContextResume.mockResolvedValue(undefined)
  close = mockAudioContextClose
  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode())
  createGain = vi.fn(() => mockGainNode)
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
    // @ts-expect-error - Mocking global
    globalThis.AudioContext = MockAudioContext

    // Default mock implementations
    mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
      // Simulate immediate start
      utterance.onstart?.()
    })

    // Default Kokoro mock implementations
    mockGetKokoroState.mockReturnValue({
      status: 'idle',
      progress: 0,
      error: null,
    })
    mockSubscribeToState.mockImplementation((callback) => {
      callback(mockGetKokoroState())
      return () => {}
    })
    mockIsKokoroReady.mockReturnValue(false)
    mockLoadKokoroModel.mockResolvedValue(undefined)
    mockGenerateSpeech.mockResolvedValue({} as AudioBuffer)
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
          enabled: true,
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
          enabled: true,
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
          enabled: true,
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
      )

      act(() => {
        result.current.speak('First', 'normal')
        result.current.speak('Second', 'normal')
      })

      expect(result.current.currentText).toBe('First')

      // Simulate end of first utterance
      await act(async () => {
        currentUtterance?.onend?.()
        // Use async timer to properly flush microtasks and promises
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(result.current.currentText).toBe('Second')
    })
  })

  describe('Controls', () => {
    it('should pause speech', () => {
      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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

      // Advance timers for queue processing - use async version to flush microtasks
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })

      // Should move to next item
      expect(result.current.currentText).toBe('Second')
    })

    it('should stop all speech and clear queue', () => {
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        utterance.onstart?.()
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true, onStart })
      )

      act(() => {
        result.current.speak('Test')
      })

      expect(onStart).toHaveBeenCalled()
    })

    it('should call onEnd when all speech completes', async () => {
      let currentUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        currentUtterance = utterance
        utterance.onstart?.()
      })

      const onEnd = vi.fn()

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, onEnd })
      )

      act(() => {
        result.current.speak('Test')
      })

      // Simulate speech end
      await act(async () => {
        currentUtterance?.onend?.()
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(onEnd).toHaveBeenCalled()
    })

    it('should call onError on speech synthesis error', async () => {
      let currentUtterance: MockSpeechSynthesisUtterance | null = null
      mockSpeak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
        currentUtterance = utterance
        utterance.onstart?.()
      })

      const onError = vi.fn()

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, onError })
      )

      act(() => {
        result.current.speak('Test')
      })

      // Simulate error
      await act(async () => {
        currentUtterance?.onerror?.({ error: 'synthesis-failed' })
        await vi.advanceTimersByTimeAsync(50)
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true, onError })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
          enabled: true,
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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
        useVoiceNarration({ executionId: 'exec-123', enabled: true })
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

  describe('Kokoro TTS Provider', () => {
    it('should return kokoroState from singleton', () => {
      mockGetKokoroState.mockReturnValue({
        status: 'ready',
        progress: 100,
        error: null,
      })

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      expect(result.current.kokoroState).toEqual({
        status: 'ready',
        progress: 100,
        error: null,
      })
    })

    it('should load Kokoro model when speaking with kokoro provider', async () => {
      mockIsKokoroReady.mockReturnValue(false)

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Hello Kokoro!')
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockLoadKokoroModel).toHaveBeenCalled()
    })

    it('should skip model loading when already ready', async () => {
      mockIsKokoroReady.mockReturnValue(true)

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Hello Kokoro!')
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockLoadKokoroModel).not.toHaveBeenCalled()
      expect(mockGenerateSpeech).toHaveBeenCalledWith('Hello Kokoro!', {
        voice: 'af_heart',
        speed: 1.0,
      })
    })

    it('should use custom voice and rate for Kokoro', async () => {
      mockIsKokoroReady.mockReturnValue(true)

      const { result } = renderHook(() =>
        useVoiceNarration({
          executionId: 'exec-123',
          enabled: true,
          ttsProvider: 'kokoro',
          voice: 'am_adam',
          rate: 1.5,
        })
      )

      await act(async () => {
        result.current.speak('Custom voice test')
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockGenerateSpeech).toHaveBeenCalledWith('Custom voice test', {
        voice: 'am_adam',
        speed: 1.5,
      })
    })

    it('should show loading toast when model is not ready', async () => {
      mockIsKokoroReady.mockReturnValue(false)

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Loading test')
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockToast.loading).toHaveBeenCalledWith(
        'Loading Kokoro TTS model...',
        expect.objectContaining({
          description: 'This may take a moment on first use.',
        })
      )
    })

    it('should show success toast after model loads', async () => {
      mockIsKokoroReady.mockReturnValue(false)
      mockLoadKokoroModel.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Success test')
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockToast.success).toHaveBeenCalledWith(
        'Kokoro TTS model loaded!',
        expect.objectContaining({ id: 'toast-id' })
      )
    })

    it('should fall back to browser TTS when Kokoro fails', async () => {
      mockIsKokoroReady.mockReturnValue(true)
      mockGenerateSpeech.mockRejectedValue(new Error('Kokoro generation failed'))

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Fallback test')
        await vi.advanceTimersByTimeAsync(100)
      })

      // Should show warning toast
      expect(mockToast.warning).toHaveBeenCalledWith(
        'Kokoro TTS failed, using browser voice',
        expect.objectContaining({
          description: 'The browser speech synthesis will be used instead.',
        })
      )

      // Should fall back to browser speech
      expect(mockSpeak).toHaveBeenCalled()
    })

    it('should play audio using AudioContext when Kokoro succeeds', async () => {
      mockIsKokoroReady.mockReturnValue(true)
      const mockBuffer = {} as AudioBuffer
      mockGenerateSpeech.mockResolvedValue(mockBuffer)

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Audio test')
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockAudioStart).toHaveBeenCalledWith(0)
    })

    it('should stop Kokoro audio on high priority interrupt', async () => {
      mockIsKokoroReady.mockReturnValue(true)

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      // Start speaking
      await act(async () => {
        result.current.speak('Normal message')
        await vi.advanceTimersByTimeAsync(5) // Before audio ends
      })

      // Interrupt with high priority
      await act(async () => {
        result.current.speak('High priority!', 'high')
        await vi.advanceTimersByTimeAsync(50)
      })

      // Should have stopped the audio
      expect(mockAudioStop).toHaveBeenCalled()
    })

    it('should stop Kokoro audio on skip', async () => {
      mockIsKokoroReady.mockReturnValue(true)
      // Don't auto-end audio
      mockAudioStart.mockImplementation(() => {})

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Test message')
        await vi.advanceTimersByTimeAsync(5)
      })

      act(() => {
        result.current.skip()
      })

      expect(mockAudioStop).toHaveBeenCalled()
    })

    it('should stop Kokoro audio on stop', async () => {
      mockIsKokoroReady.mockReturnValue(true)
      // Don't auto-end audio
      mockAudioStart.mockImplementation(() => {})

      const { result } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Test message')
        await vi.advanceTimersByTimeAsync(5)
      })

      act(() => {
        result.current.stop()
      })

      expect(mockAudioStop).toHaveBeenCalled()
      expect(result.current.isSpeaking).toBe(false)
    })

    it('should cleanup AudioContext on unmount', async () => {
      mockIsKokoroReady.mockReturnValue(true)

      const { result, unmount } = renderHook(() =>
        useVoiceNarration({ executionId: 'exec-123', enabled: true, ttsProvider: 'kokoro' })
      )

      await act(async () => {
        result.current.speak('Cleanup test')
        await vi.advanceTimersByTimeAsync(50)
      })

      unmount()

      expect(mockAudioContextClose).toHaveBeenCalled()
    })

    it('should show error toast when model loading fails', async () => {
      mockIsKokoroReady.mockReturnValue(false)
      mockLoadKokoroModel.mockRejectedValue(new Error('Network error'))

      const onError = vi.fn()

      const { result } = renderHook(() =>
        useVoiceNarration({
          executionId: 'exec-123',
          enabled: true,
          ttsProvider: 'kokoro',
          onError,
        })
      )

      await act(async () => {
        result.current.speak('Error test')
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to load Kokoro TTS',
        expect.objectContaining({
          description: 'Network error',
        })
      )

      // Should fall back to browser
      expect(mockSpeak).toHaveBeenCalled()
    })
  })
})
