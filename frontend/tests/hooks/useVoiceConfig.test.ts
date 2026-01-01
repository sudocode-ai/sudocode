/**
 * Unit tests for useVoiceConfig hook
 *
 * Tests the voice configuration fetching and caching behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useVoiceConfig, clearVoiceConfigCache } from '@/hooks/useVoiceConfig'
import api from '@/lib/api'
import type { VoiceConfig, VoiceSettingsConfig, STTConfig, TTSConfig } from '@sudocode-ai/types/voice'

// Mock the api module
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

// Mock voice utilities
vi.mock('@/lib/voice', () => ({
  isSpeechRecognitionSupported: vi.fn(() => true),
}))

// Helper to create a valid STTConfig mock
function mockSTTConfig(overrides?: Partial<STTConfig>): STTConfig {
  return {
    providers: ['whisper-local'],
    default: 'whisper-local',
    whisperAvailable: false,
    ...overrides,
  }
}

// Helper to create a valid TTSConfig mock
function mockTTSConfig(overrides?: Partial<TTSConfig>): TTSConfig {
  return {
    providers: ['browser'],
    default: 'browser',
    kokoroAvailable: false,
    voices: { browser: [], kokoro: [], openai: [] },
    ...overrides,
  }
}

// Helper to create default voice settings
function mockVoiceSettings(overrides?: Partial<VoiceSettingsConfig>): VoiceSettingsConfig {
  return {
    enabled: true,
    narration: {
      enabled: false,
      speed: 1.0,
      volume: 1.0,
    },
    ...overrides,
  }
}

// Helper to create a valid VoiceConfig mock (now includes settings)
function mockVoiceConfig(overrides?: Partial<VoiceConfig>): VoiceConfig {
  return {
    enabled: false,
    stt: mockSTTConfig(),
    tts: mockTTSConfig(),
    settings: mockVoiceSettings(),
    ...overrides,
  }
}

// Helper to mock the single API call that useVoiceConfig makes
function mockApiCall(voiceConfig: VoiceConfig) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/voice/config') {
      // API interceptor unwraps { success, data } so we return the data directly
      return Promise.resolve(voiceConfig)
    }
    return Promise.reject(new Error(`Unmocked endpoint: ${url}`))
  })
}

describe('useVoiceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearVoiceConfigCache()
  })

  afterEach(() => {
    clearVoiceConfigCache()
  })

  describe('default values', () => {
    it('should default voiceEnabled to false when config is null', async () => {
      // Mock API to never resolve (simulating loading state)
      vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))

      const { result } = renderHook(() => useVoiceConfig())

      // Initially loading with defaults
      expect(result.current.voiceEnabled).toBe(false)
      expect(result.current.isLoading).toBe(true)
    })

    it('should default voiceEnabled to false when config.enabled is not set', async () => {
      // VoiceConfig type requires enabled, but test the default behavior
      const config = mockVoiceConfig({ enabled: false })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.voiceEnabled).toBe(false)
    })

    it('should return voiceEnabled true when config.enabled is true', async () => {
      const config = mockVoiceConfig({
        enabled: true,
        tts: mockTTSConfig({ default: 'browser' }),
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.voiceEnabled).toBe(true)
    })

    it('should return voiceEnabled false when config.enabled is false', async () => {
      const config = mockVoiceConfig({
        enabled: false,
        stt: mockSTTConfig({ whisperAvailable: true }),
        tts: mockTTSConfig({ default: 'browser' }),
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.voiceEnabled).toBe(false)
    })
  })

  describe('narration settings', () => {
    it('should extract narration settings from config.settings', async () => {
      const config = mockVoiceConfig({
        enabled: true,
        settings: mockVoiceSettings({
          narration: {
            enabled: true,
            speed: 1.5,
            volume: 0.8,
            narrateToolUse: false,
            narrateToolResults: true,
          },
        }),
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.narration.enabled).toBe(true)
      expect(result.current.narration.speed).toBe(1.5)
      expect(result.current.narration.volume).toBe(0.8)
      expect(result.current.narration.narrateToolUse).toBe(false)
      expect(result.current.narration.narrateToolResults).toBe(true)
    })

    it('should use default narration settings when not configured', async () => {
      const config = mockVoiceConfig({
        enabled: true,
        settings: { enabled: true },
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.narration.enabled).toBe(false)
      expect(result.current.narration.speed).toBe(1.0)
      expect(result.current.narration.volume).toBe(1.0)
      expect(result.current.narration.narrateToolUse).toBe(true)
      expect(result.current.narration.narrateToolResults).toBe(false)
    })
  })

  describe('sttAvailable', () => {
    it('should return sttAvailable false when voice is disabled', async () => {
      const config = mockVoiceConfig({
        enabled: false,
        stt: mockSTTConfig({ whisperAvailable: true }),
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Even with whisper available, STT should not be available when voice is disabled
      expect(result.current.sttAvailable).toBe(false)
    })

    it('should return sttAvailable true when voice is enabled and provider available', async () => {
      const config = mockVoiceConfig({
        enabled: true,
        stt: mockSTTConfig({ whisperAvailable: false }),
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // With voice enabled and web speech supported (mocked to true), STT should be available
      expect(result.current.sttAvailable).toBe(true)
    })
  })

  describe('preferredSTTProvider', () => {
    it('should return null when voice is disabled', async () => {
      const config = mockVoiceConfig({
        enabled: false,
        stt: mockSTTConfig({ whisperAvailable: true }),
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.preferredSTTProvider).toBe(null)
    })

    it('should prefer browser when web speech is supported', async () => {
      const config = mockVoiceConfig({
        enabled: true,
        stt: mockSTTConfig({ whisperAvailable: true }),
      })

      mockApiCall(config)

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.preferredSTTProvider).toBe('browser')
    })
  })

  describe('error handling', () => {
    it('should set error message on API failure', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBe('Network error')
      // voiceEnabled should still default to false
      expect(result.current.voiceEnabled).toBe(false)
    })
  })

  describe('caching', () => {
    it('should cache config across hook instances', async () => {
      const config = mockVoiceConfig({
        enabled: true,
        stt: mockSTTConfig({ whisperAvailable: false }),
      })

      mockApiCall(config)

      // First hook call
      const { result: result1 } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result1.current.isLoading).toBe(false)
      })

      // Second hook call should use cache
      const { result: result2 } = renderHook(() => useVoiceConfig())

      // Should not need to wait for loading - cache should be used
      expect(result2.current.isLoading).toBe(false)
      expect(result2.current.voiceEnabled).toBe(true)

      // API should only be called once (single endpoint) for the first load
      // Second hook instance should use cache and not make additional calls
      expect(api.get).toHaveBeenCalledTimes(1)
    })

    it('should refetch when cache is cleared', async () => {
      const config1 = mockVoiceConfig({
        enabled: true,
        stt: mockSTTConfig({ whisperAvailable: false }),
      })
      const config2 = mockVoiceConfig({
        enabled: false,
        stt: mockSTTConfig({ whisperAvailable: true }),
      })

      // Track which config to return (starts with config1, switches to config2 after clear)
      let currentConfig = config1
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/voice/config') {
          return Promise.resolve(currentConfig)
        }
        return Promise.reject(new Error(`Unmocked endpoint: ${url}`))
      })

      // First hook call
      const { result } = renderHook(() => useVoiceConfig())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.voiceEnabled).toBe(true)

      // Switch to config2 and clear cache
      currentConfig = config2
      clearVoiceConfigCache()

      await waitFor(() => {
        expect(result.current.voiceEnabled).toBe(false)
      })

      // 2 calls: 1 for initial load + 1 after cache clear
      expect(api.get).toHaveBeenCalledTimes(2)
    })
  })
})
