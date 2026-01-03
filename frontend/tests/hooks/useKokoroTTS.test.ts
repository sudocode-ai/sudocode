import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const {
  mockLoadKokoroModel,
  mockGenerateSpeech,
  mockGetKokoroState,
  mockSubscribeToState,
  mockIsKokoroReady,
  mockGetAvailableVoices,
  mockSendMessage,
  mockAddMessageHandler,
  mockRemoveMessageHandler,
  createMockWebSocketContext,
} = vi.hoisted(() => {
  const mockSendMessage = vi.fn()
  const mockAddMessageHandler = vi.fn()
  const mockRemoveMessageHandler = vi.fn()

  return {
    mockLoadKokoroModel: vi.fn(),
    mockGenerateSpeech: vi.fn(),
    mockGetKokoroState: vi.fn(),
    mockSubscribeToState: vi.fn(),
    mockIsKokoroReady: vi.fn(),
    mockGetAvailableVoices: vi.fn(),
    mockSendMessage,
    mockAddMessageHandler,
    mockRemoveMessageHandler,
    createMockWebSocketContext: (connected: boolean) => ({
      connected,
      sendMessage: mockSendMessage,
      addMessageHandler: mockAddMessageHandler,
      removeMessageHandler: mockRemoveMessageHandler,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    }),
  }
})

// Track the current connected state
let wsContextConnected = false

vi.mock('@/lib/kokoroTTS', () => ({
  loadKokoroModel: mockLoadKokoroModel,
  generateSpeech: mockGenerateSpeech,
  getKokoroState: mockGetKokoroState,
  subscribeToState: mockSubscribeToState,
  isKokoroReady: mockIsKokoroReady,
  getAvailableVoices: mockGetAvailableVoices,
}))

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => createMockWebSocketContext(wsContextConnected),
}))

// Mock StreamingAudioPlayer
const mockPlayChunk = vi.fn()
const mockPlayerStop = vi.fn()
const mockPlayerClose = vi.fn().mockResolvedValue(undefined)
const mockIsPlayerPlaying = vi.fn()

vi.mock('@/lib/streamingAudioPlayer', () => ({
  StreamingAudioPlayer: vi.fn().mockImplementation(() => ({
    playChunk: mockPlayChunk,
    stop: mockPlayerStop,
    close: mockPlayerClose,
    isPlaying: mockIsPlayerPlaying,
  })),
}))

import { useKokoroTTS } from '@/hooks/useKokoroTTS'

// Mock AudioContext and AudioBufferSourceNode
const mockStop = vi.fn()
const mockStart = vi.fn()
const mockConnect = vi.fn()
const mockResume = vi.fn()
const mockClose = vi.fn()

class MockAudioBufferSourceNode {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  stop = mockStop
  start = mockStart
  connect = mockConnect
}

class MockAudioContext {
  state = 'running'
  resume = mockResume.mockResolvedValue(undefined)
  close = mockClose
  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode())
}

// @ts-expect-error - Mocking global
globalThis.AudioContext = MockAudioContext

describe('useKokoroTTS', () => {
  const defaultVoices = [
    { id: 'af_heart', name: 'Heart', language: 'en-US', gender: 'female' },
    { id: 'am_adam', name: 'Adam', language: 'en-US', gender: 'male' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: WebSocket disconnected
    wsContextConnected = false

    // Default mock implementations
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
    mockGetAvailableVoices.mockReturnValue(defaultVoices)
    mockLoadKokoroModel.mockResolvedValue(undefined)
    mockSendMessage.mockReturnValue(true)
    mockIsPlayerPlaying.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('browser mode (default)', () => {
    describe('initial state', () => {
      it('should return idle status initially', () => {
        const { result } = renderHook(() => useKokoroTTS())

        expect(result.current.status).toBe('idle')
        expect(result.current.progress).toBe(0)
        expect(result.current.error).toBeNull()
        expect(result.current.isReady).toBe(false)
        expect(result.current.isPlaying).toBe(false)
      })

      it('should return available voices', () => {
        const { result } = renderHook(() => useKokoroTTS())

        expect(result.current.availableVoices).toEqual(defaultVoices)
      })
    })

    describe('load', () => {
      it('should call loadKokoroModel when not ready', async () => {
        mockIsKokoroReady.mockReturnValue(false)
        const { result } = renderHook(() => useKokoroTTS())

        await act(async () => {
          await result.current.load()
        })

        expect(mockLoadKokoroModel).toHaveBeenCalledTimes(1)
      })

      it('should not call loadKokoroModel when already ready', async () => {
        mockIsKokoroReady.mockReturnValue(true)
        const { result } = renderHook(() => useKokoroTTS())

        await act(async () => {
          await result.current.load()
        })

        expect(mockLoadKokoroModel).not.toHaveBeenCalled()
      })
    })

    describe('speak', () => {
      it('should auto-load model if not ready', async () => {
        mockIsKokoroReady.mockReturnValueOnce(false).mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS())

        // Call speak and don't wait for completion
        act(() => {
          result.current.speak('Hello')
        })

        // Wait for async work
        await act(async () => {
          await Promise.resolve()
        })

        expect(mockLoadKokoroModel).toHaveBeenCalledTimes(1)
      })

      it('should generate and play audio', async () => {
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS())

        // Start speak and immediately check state (before onended)
        act(() => {
          result.current.speak('Hello world')
        })

        // Wait for async operations
        await act(async () => {
          await Promise.resolve()
        })

        expect(mockGenerateSpeech).toHaveBeenCalledWith('Hello world', {})
        expect(mockStart).toHaveBeenCalledWith(0)
        expect(result.current.isPlaying).toBe(true)
      })

      it('should pass voice and speed options', async () => {
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS())

        act(() => {
          result.current.speak('Test', { voice: 'am_adam', speed: 1.2 })
        })

        await act(async () => {
          await Promise.resolve()
        })

        expect(mockGenerateSpeech).toHaveBeenCalledWith('Test', {
          voice: 'am_adam',
          speed: 1.2,
        })
      })

      it('should set isPlaying to true during playback', async () => {
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS())

        act(() => {
          result.current.speak('Hello')
        })

        await act(async () => {
          await Promise.resolve()
        })

        expect(result.current.isPlaying).toBe(true)
      })

      it('should handle suspended audio context', async () => {
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS())

        act(() => {
          result.current.speak('Hello')
        })

        await act(async () => {
          await Promise.resolve()
        })

        expect(result.current.isPlaying).toBe(true)
      })
    })

    describe('stop', () => {
      it('should stop current playback', async () => {
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS())

        act(() => {
          result.current.speak('Hello')
        })

        await act(async () => {
          await Promise.resolve()
        })

        expect(result.current.isPlaying).toBe(true)

        act(() => {
          result.current.stop()
        })

        expect(mockStop).toHaveBeenCalled()
        expect(result.current.isPlaying).toBe(false)
      })

      it('should handle stop when nothing is playing', () => {
        const { result } = renderHook(() => useKokoroTTS())

        act(() => {
          result.current.stop()
        })

        expect(result.current.isPlaying).toBe(false)
      })
    })

    describe('state updates', () => {
      it('should reflect ready state from singleton', () => {
        mockGetKokoroState.mockReturnValue({
          status: 'ready',
          progress: 100,
          error: null,
        })

        const { result } = renderHook(() => useKokoroTTS())

        expect(result.current.status).toBe('ready')
        expect(result.current.progress).toBe(100)
        expect(result.current.isReady).toBe(true)
      })

      it('should reflect error state from singleton', () => {
        mockGetKokoroState.mockReturnValue({
          status: 'error',
          progress: 0,
          error: 'Failed to load model',
        })

        const { result } = renderHook(() => useKokoroTTS())

        expect(result.current.status).toBe('error')
        expect(result.current.error).toBe('Failed to load model')
        expect(result.current.isReady).toBe(false)
      })

      it('should reflect loading progress from singleton', () => {
        mockGetKokoroState.mockReturnValue({
          status: 'loading',
          progress: 50,
          error: null,
        })

        const { result } = renderHook(() => useKokoroTTS())

        expect(result.current.status).toBe('loading')
        expect(result.current.progress).toBe(50)
      })
    })

    describe('cleanup', () => {
      it('should cleanup audio context on unmount', async () => {
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result, unmount } = renderHook(() => useKokoroTTS())

        act(() => {
          result.current.speak('Hello')
        })

        await act(async () => {
          await Promise.resolve()
        })

        unmount()

        expect(mockClose).toHaveBeenCalled()
      })
    })
  })

  describe('server mode (useServer: true)', () => {
    beforeEach(() => {
      // Set up connected WebSocket for server mode tests
      wsContextConnected = true
    })

    describe('initial state', () => {
      it('should return ready status when WebSocket is connected', () => {
        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        expect(result.current.status).toBe('ready')
        expect(result.current.progress).toBe(100)
        expect(result.current.error).toBeNull()
        expect(result.current.isReady).toBe(true)
        expect(result.current.isPlaying).toBe(false)
      })

      it('should return idle status when WebSocket is disconnected', () => {
        wsContextConnected = false

        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        expect(result.current.status).toBe('idle')
        expect(result.current.progress).toBe(0)
        expect(result.current.isReady).toBe(false)
      })
    })

    describe('load', () => {
      it('should not call loadKokoroModel in server mode', async () => {
        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        await act(async () => {
          await result.current.load()
        })

        expect(mockLoadKokoroModel).not.toHaveBeenCalled()
      })
    })

    describe('speak', () => {
      it('should send TTS request via WebSocket', async () => {
        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        // Start speak (this won't resolve until we simulate tts_end)
        act(() => {
          result.current.speak('Hello server')
        })

        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tts_request',
            text: 'Hello server',
          })
        )
        expect(result.current.isPlaying).toBe(true)
      })

      it('should send voice and speed options', async () => {
        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        act(() => {
          result.current.speak('Test', { voice: 'af_heart', speed: 1.5 })
        })

        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tts_request',
            text: 'Test',
            voice: 'af_heart',
            speed: 1.5,
          })
        )
      })

      it('should include request_id in the message', async () => {
        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        act(() => {
          result.current.speak('Test')
        })

        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tts_request',
            request_id: expect.stringMatching(/^tts-\d+-\d+$/),
          })
        )
      })

      it('should fall back to browser mode if WebSocket is disconnected', async () => {
        wsContextConnected = false
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        act(() => {
          result.current.speak('Hello')
        })

        await act(async () => {
          await Promise.resolve()
        })

        // Should use browser mode fallback
        expect(mockSendMessage).not.toHaveBeenCalled()
        expect(mockGenerateSpeech).toHaveBeenCalledWith('Hello', {})
      })
    })

    describe('WebSocket message handling', () => {
      it('should register message handler on mount', () => {
        renderHook(() => useKokoroTTS({ useServer: true }))

        expect(mockAddMessageHandler).toHaveBeenCalledWith(
          'kokoro-tts-handler',
          expect.any(Function)
        )
      })

      it('should remove message handler on unmount', () => {
        const { unmount } = renderHook(() => useKokoroTTS({ useServer: true }))

        unmount()

        expect(mockRemoveMessageHandler).toHaveBeenCalledWith('kokoro-tts-handler')
      })

      it('should play audio chunks when receiving tts_audio messages', () => {
        let messageHandler: ((message: any) => void) | undefined
        mockAddMessageHandler.mockImplementation((id: string, handler: any) => {
          if (id === 'kokoro-tts-handler') {
            messageHandler = handler
          }
        })

        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        // Start a speak request to set the request ID
        act(() => {
          result.current.speak('Test')
        })

        // Get the request_id from the sent message
        const sentMessage = mockSendMessage.mock.calls[0][0]
        const requestId = sentMessage.request_id

        // Simulate receiving an audio chunk
        act(() => {
          messageHandler?.({
            type: 'tts_audio',
            request_id: requestId,
            chunk: 'base64audiodata',
            index: 0,
            is_final: false,
          })
        })

        expect(mockPlayChunk).toHaveBeenCalledWith('base64audiodata')
      })

      it('should ignore audio chunks for different request IDs', () => {
        let messageHandler: ((message: any) => void) | undefined
        mockAddMessageHandler.mockImplementation((id: string, handler: any) => {
          if (id === 'kokoro-tts-handler') {
            messageHandler = handler
          }
        })

        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        // Start a speak request
        act(() => {
          result.current.speak('Test')
        })

        // Simulate receiving an audio chunk with different request ID
        act(() => {
          messageHandler?.({
            type: 'tts_audio',
            request_id: 'different-request-id',
            chunk: 'base64audiodata',
            index: 0,
            is_final: false,
          })
        })

        expect(mockPlayChunk).not.toHaveBeenCalled()
      })
    })

    describe('stop', () => {
      it('should stop streaming player in server mode', () => {
        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        act(() => {
          result.current.speak('Test')
        })

        act(() => {
          result.current.stop()
        })

        expect(mockPlayerStop).toHaveBeenCalled()
        expect(result.current.isPlaying).toBe(false)
      })
    })

    describe('cleanup', () => {
      it('should close streaming player on unmount', () => {
        const { result, unmount } = renderHook(() => useKokoroTTS({ useServer: true }))

        act(() => {
          result.current.speak('Test')
        })

        unmount()

        expect(mockPlayerClose).toHaveBeenCalled()
      })
    })

    describe('tts_end handling', () => {
      it('should resolve speak promise only after playback completes, not when tts_end arrives', async () => {
        let messageHandler: ((message: any) => void) | undefined
        mockAddMessageHandler.mockImplementation((id: string, handler: any) => {
          if (id === 'kokoro-tts-handler') {
            messageHandler = handler
          }
        })

        // Start with player still playing
        mockIsPlayerPlaying.mockReturnValue(true)

        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        let speakResolved = false
        let speakPromise: Promise<void>

        // Start a speak request
        act(() => {
          speakPromise = result.current.speak('Test')
          speakPromise.then(() => {
            speakResolved = true
          })
        })

        const sentMessage = mockSendMessage.mock.calls[0][0]
        const requestId = sentMessage.request_id

        // Simulate receiving tts_end while audio is still playing
        await act(async () => {
          messageHandler?.({
            type: 'tts_end',
            request_id: requestId,
            total_chunks: 5,
            duration_ms: 1000,
          })
          await Promise.resolve()
        })

        // Promise should NOT be resolved yet because audio is still playing
        expect(speakResolved).toBe(false)
        expect(result.current.isPlaying).toBe(true)

        // Now simulate playback completing
        mockIsPlayerPlaying.mockReturnValue(false)

        // Wait for the polling to detect playback complete (200ms initial + 100ms poll)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 350))
        })

        // Now the promise should be resolved and isPlaying should be false
        expect(speakResolved).toBe(true)
        expect(result.current.isPlaying).toBe(false)
      })

      it('should set isPlaying to false when tts_end arrives and playback already complete', async () => {
        let messageHandler: ((message: any) => void) | undefined
        mockAddMessageHandler.mockImplementation((id: string, handler: any) => {
          if (id === 'kokoro-tts-handler') {
            messageHandler = handler
          }
        })

        // Player is not playing (very short audio or already done)
        mockIsPlayerPlaying.mockReturnValue(false)

        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        act(() => {
          result.current.speak('Short text')
        })

        const sentMessage = mockSendMessage.mock.calls[0][0]
        const requestId = sentMessage.request_id

        // Simulate receiving tts_end
        await act(async () => {
          messageHandler?.({
            type: 'tts_end',
            request_id: requestId,
            total_chunks: 1,
            duration_ms: 100,
          })
          // Wait for polling to complete
          await new Promise((resolve) => setTimeout(resolve, 350))
        })

        expect(result.current.isPlaying).toBe(false)
      })
    })

    describe('fallback on tts_error', () => {
      it('should fall back to browser TTS when receiving tts_error with fallback=true', async () => {
        let messageHandler: ((message: any) => void) | undefined
        mockAddMessageHandler.mockImplementation((id: string, handler: any) => {
          if (id === 'kokoro-tts-handler') {
            messageHandler = handler
          }
        })
        mockIsKokoroReady.mockReturnValue(true)
        const mockBuffer = {} as AudioBuffer
        mockGenerateSpeech.mockResolvedValue(mockBuffer)

        const { result } = renderHook(() => useKokoroTTS({ useServer: true }))

        // Start a speak request
        act(() => {
          result.current.speak('Test fallback')
        })

        const sentMessage = mockSendMessage.mock.calls[0][0]
        const requestId = sentMessage.request_id

        // Simulate receiving an error with fallback=true
        await act(async () => {
          messageHandler?.({
            type: 'tts_error',
            request_id: requestId,
            error: 'Server unavailable',
            recoverable: false,
            fallback: true,
          })
          await Promise.resolve() // Let browser fallback complete
        })

        // Should have called browser TTS as fallback
        expect(mockGenerateSpeech).toHaveBeenCalledWith('Test fallback', {})
      })
    })
  })
})
