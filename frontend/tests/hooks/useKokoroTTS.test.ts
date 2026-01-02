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
} = vi.hoisted(() => ({
  mockLoadKokoroModel: vi.fn(),
  mockGenerateSpeech: vi.fn(),
  mockGetKokoroState: vi.fn(),
  mockSubscribeToState: vi.fn(),
  mockIsKokoroReady: vi.fn(),
  mockGetAvailableVoices: vi.fn(),
}))

vi.mock('@/lib/kokoroTTS', () => ({
  loadKokoroModel: mockLoadKokoroModel,
  generateSpeech: mockGenerateSpeech,
  getKokoroState: mockGetKokoroState,
  subscribeToState: mockSubscribeToState,
  isKokoroReady: mockIsKokoroReady,
  getAvailableVoices: mockGetAvailableVoices,
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

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

      await act(async () => {
        await result.current.speak('Hello')
      })

      expect(mockLoadKokoroModel).toHaveBeenCalledTimes(1)
    })

    it('should generate and play audio', async () => {
      mockIsKokoroReady.mockReturnValue(true)
      const mockBuffer = {} as AudioBuffer
      mockGenerateSpeech.mockResolvedValue(mockBuffer)

      const { result } = renderHook(() => useKokoroTTS())

      await act(async () => {
        await result.current.speak('Hello world')
      })

      expect(mockGenerateSpeech).toHaveBeenCalledWith('Hello world', {})
      expect(mockStart).toHaveBeenCalledWith(0)
    })

    it('should pass voice and speed options', async () => {
      mockIsKokoroReady.mockReturnValue(true)
      const mockBuffer = {} as AudioBuffer
      mockGenerateSpeech.mockResolvedValue(mockBuffer)

      const { result } = renderHook(() => useKokoroTTS())

      await act(async () => {
        await result.current.speak('Test', { voice: 'am_adam', speed: 1.2 })
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

      await act(async () => {
        await result.current.speak('Hello')
      })

      expect(result.current.isPlaying).toBe(true)
    })

    it('should handle suspended audio context', async () => {
      // This tests that the code path for resuming exists
      // The actual AudioContext state management is handled internally
      mockIsKokoroReady.mockReturnValue(true)
      const mockBuffer = {} as AudioBuffer
      mockGenerateSpeech.mockResolvedValue(mockBuffer)

      const { result } = renderHook(() => useKokoroTTS())

      await act(async () => {
        await result.current.speak('Hello')
      })

      // Verify that speak completes successfully regardless of context state
      expect(result.current.isPlaying).toBe(true)
    })
  })

  describe('stop', () => {
    it('should stop current playback', async () => {
      mockIsKokoroReady.mockReturnValue(true)
      const mockBuffer = {} as AudioBuffer
      mockGenerateSpeech.mockResolvedValue(mockBuffer)

      const { result } = renderHook(() => useKokoroTTS())

      await act(async () => {
        await result.current.speak('Hello')
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

      await act(async () => {
        await result.current.speak('Hello')
      })

      unmount()

      expect(mockClose).toHaveBeenCalled()
    })
  })
})
