import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const { mockGenerate, mockFromPretrained, mockVoices } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockFromPretrained: vi.fn(),
  mockVoices: {
    af_heart: { name: 'Heart', language: 'en-US', gender: 'female' },
    af_bella: { name: 'Bella', language: 'en-US', gender: 'female' },
    am_adam: { name: 'Adam', language: 'en-US', gender: 'male' },
  },
}))

vi.mock('kokoro-js', () => ({
  KokoroTTS: {
    from_pretrained: mockFromPretrained,
  },
}))

// Import after mocking
import {
  loadKokoroModel,
  generateSpeech,
  getKokoroState,
  subscribeToState,
  isKokoroReady,
  getAvailableVoices,
  resetKokoro,
} from '@/lib/kokoroTTS'

// Mock AudioContext
class MockAudioContext {
  state = 'running'
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => ({
    copyToChannel: vi.fn(),
    numberOfChannels: channels,
    length,
    sampleRate,
  }))
  close = vi.fn()
}

// @ts-expect-error - Mocking global
globalThis.AudioContext = MockAudioContext

describe('kokoroTTS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetKokoro()
  })

  afterEach(() => {
    resetKokoro()
  })

  describe('getKokoroState', () => {
    it('should return initial idle state', () => {
      const state = getKokoroState()
      expect(state).toEqual({
        status: 'idle',
        progress: 0,
        error: null,
      })
    })
  })

  describe('isKokoroReady', () => {
    it('should return false when not loaded', () => {
      expect(isKokoroReady()).toBe(false)
    })

    it('should return true after successful load', async () => {
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)

      await loadKokoroModel()
      expect(isKokoroReady()).toBe(true)
    })
  })

  describe('subscribeToState', () => {
    it('should call listener with current state immediately', () => {
      const listener = vi.fn()
      subscribeToState(listener)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({
        status: 'idle',
        progress: 0,
        error: null,
      })
    })

    it('should return unsubscribe function', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeToState(listener)

      expect(typeof unsubscribe).toBe('function')
      unsubscribe()
    })

    it('should call listener on state changes during load', async () => {
      const listener = vi.fn()
      subscribeToState(listener)
      listener.mockClear() // Clear the initial call

      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }
      mockFromPretrained.mockImplementation((_modelId, options) => {
        // Simulate progress callback
        if (options?.progress_callback) {
          options.progress_callback({ progress: 50 })
          options.progress_callback({ progress: 100 })
        }
        return Promise.resolve(mockInstance)
      })

      await loadKokoroModel()

      // Should have received: loading, progress updates, ready
      expect(listener).toHaveBeenCalled()
      const calls = listener.mock.calls
      // First call should be loading state
      expect(calls[0][0].status).toBe('loading')
      // Last call should be ready state
      expect(calls[calls.length - 1][0].status).toBe('ready')
    })
  })

  describe('loadKokoroModel', () => {
    it('should load the model successfully', async () => {
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)

      await loadKokoroModel()

      expect(mockFromPretrained).toHaveBeenCalledWith(
        'onnx-community/Kokoro-82M-v1.0-ONNX',
        expect.objectContaining({
          dtype: 'q8',
          device: 'wasm', // WebGPU disabled due to q8 precision issues
        })
      )

      const state = getKokoroState()
      expect(state.status).toBe('ready')
      expect(state.progress).toBe(100)
    })

    it('should track progress during loading', async () => {
      const progressValues: number[] = []
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }

      mockFromPretrained.mockImplementation((_modelId, options) => {
        if (options?.progress_callback) {
          options.progress_callback({ progress: 25 })
          options.progress_callback({ progress: 50 })
          options.progress_callback({ progress: 75 })
          options.progress_callback({ progress: 100 })
        }
        return Promise.resolve(mockInstance)
      })

      await loadKokoroModel((progress) => {
        progressValues.push(progress)
      })

      expect(progressValues).toEqual([25, 50, 75, 100])
    })

    it('should return existing instance if already loaded', async () => {
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)

      const first = await loadKokoroModel()
      const second = await loadKokoroModel()

      expect(first).toBe(second)
      expect(mockFromPretrained).toHaveBeenCalledTimes(1)
    })

    it('should reuse loading promise if called while loading', async () => {
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }

      let resolveLoad: (value: unknown) => void
      mockFromPretrained.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveLoad = resolve
        })
      )

      const promise1 = loadKokoroModel()
      const promise2 = loadKokoroModel()

      // @ts-expect-error - resolveLoad is assigned in the mock
      resolveLoad(mockInstance)

      const [result1, result2] = await Promise.all([promise1, promise2])
      expect(result1).toBe(result2)
      expect(mockFromPretrained).toHaveBeenCalledTimes(1)
    })

    it('should set error state on failure', async () => {
      const error = new Error('Failed to load model')
      mockFromPretrained.mockRejectedValueOnce(error)

      await expect(loadKokoroModel()).rejects.toThrow('Failed to load model')

      const state = getKokoroState()
      expect(state.status).toBe('error')
      expect(state.error).toBe('Failed to load model')
    })

    it('should allow retry after failure', async () => {
      const error = new Error('Network error')
      mockFromPretrained.mockRejectedValueOnce(error)

      await expect(loadKokoroModel()).rejects.toThrow()

      // Reset and try again
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)

      await loadKokoroModel()
      expect(getKokoroState().status).toBe('ready')
    })
  })

  describe('generateSpeech', () => {
    it('should throw if model not loaded', async () => {
      await expect(generateSpeech('Hello')).rejects.toThrow(
        'Kokoro model not loaded'
      )
    })

    it('should generate audio from text', async () => {
      const mockAudio = new Float32Array([0.1, 0.2, 0.3])
      const mockInstance = {
        generate: vi.fn().mockResolvedValue({
          audio: mockAudio,
          sampling_rate: 24000,
        }),
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)
      await loadKokoroModel()

      const result = await generateSpeech('Hello world')

      expect(mockInstance.generate).toHaveBeenCalledWith('Hello world', {
        voice: 'af_heart',
        speed: 1.0,
      })
      expect(result).toBeDefined()
    })

    it('should use custom voice and speed', async () => {
      const mockAudio = new Float32Array([0.1, 0.2, 0.3])
      const mockInstance = {
        generate: vi.fn().mockResolvedValue({
          audio: mockAudio,
          sampling_rate: 24000,
        }),
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)
      await loadKokoroModel()

      await generateSpeech('Test', { voice: 'am_adam', speed: 1.5 })

      expect(mockInstance.generate).toHaveBeenCalledWith('Test', {
        voice: 'am_adam',
        speed: 1.5,
      })
    })
  })

  describe('getAvailableVoices', () => {
    it('should return default voice list when model not loaded', () => {
      const voices = getAvailableVoices()

      expect(voices.length).toBeGreaterThan(0)
      expect(voices[0]).toHaveProperty('id')
      expect(voices[0]).toHaveProperty('name')
      expect(voices[0]).toHaveProperty('language')
      expect(voices[0]).toHaveProperty('gender')
    })

    it('should include common voices in default list', () => {
      const voices = getAvailableVoices()
      const voiceIds = voices.map((v) => v.id)

      expect(voiceIds).toContain('af_heart')
      expect(voiceIds).toContain('am_adam')
    })

    it('should return model voices when loaded', async () => {
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)
      await loadKokoroModel()

      const voices = getAvailableVoices()

      expect(voices).toContainEqual({
        id: 'af_heart',
        name: 'Heart',
        language: 'en-US',
        gender: 'female',
      })
    })
  })

  describe('resetKokoro', () => {
    it('should reset state to idle', async () => {
      const mockInstance = {
        generate: mockGenerate,
        voices: mockVoices,
      }
      mockFromPretrained.mockResolvedValueOnce(mockInstance)
      await loadKokoroModel()

      expect(getKokoroState().status).toBe('ready')

      resetKokoro()

      expect(getKokoroState().status).toBe('idle')
      expect(isKokoroReady()).toBe(false)
    })
  })
})
