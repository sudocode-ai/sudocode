/**
 * Hook to fetch and cache voice configuration
 *
 * Retrieves the combined voice config from /api/voice/config which includes
 * both runtime provider availability and user settings from config.json.
 */

import { useState, useEffect, useCallback } from 'react'
import type { VoiceConfig, VoiceSettingsConfig } from '@sudocode-ai/types/voice'
import { isSpeechRecognitionSupported } from '@/lib/voice'
import api from '@/lib/api'

/**
 * Narration settings from config.json
 */
export interface NarrationSettings {
  /** Whether voice narration is enabled */
  enabled: boolean
  /** Preferred voice name */
  voice?: string
  /** Speech rate (0.5 to 2.0) */
  speed: number
  /** Volume (0 to 1) */
  volume: number
  /** Whether to narrate tool use events */
  narrateToolUse: boolean
  /** Whether to narrate tool results */
  narrateToolResults: boolean
  /** Whether to narrate assistant messages */
  narrateAssistantMessages: boolean
}

/**
 * Extended voice config with browser capability info
 */
export interface VoiceConfigState {
  /** Server voice configuration (runtime availability + user settings) */
  config: VoiceConfig | null
  /** User voice settings from config.json (extracted from config.settings) */
  settings: VoiceSettingsConfig | null
  /** Narration settings with defaults applied */
  narration: NarrationSettings
  /** Whether voice is enabled for this project (from config.json) */
  voiceEnabled: boolean
  /** Whether Whisper server is available */
  whisperAvailable: boolean
  /** Whether browser Web Speech API is supported */
  webSpeechSupported: boolean
  /** Whether any STT provider is available (considers voiceEnabled) */
  sttAvailable: boolean
  /** Preferred STT provider to use */
  preferredSTTProvider: 'whisper' | 'browser' | null
  /** Whether config is still loading */
  isLoading: boolean
  /** Error message if config fetch failed */
  error: string | null
  /** Refetch the config */
  refetch: () => Promise<void>
}

/** Default narration settings */
const DEFAULT_NARRATION: NarrationSettings = {
  enabled: false,
  voice: undefined,
  speed: 1.0,
  volume: 1.0,
  narrateToolUse: true,
  narrateToolResults: false,
  narrateAssistantMessages: true,
}

// Module-level cache for config (shared across hook instances)
let cachedConfig: VoiceConfig | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60000 // 1 minute cache

// Listeners for cache invalidation (allows notifying all hook instances)
type CacheInvalidationListener = () => void
const cacheInvalidationListeners = new Set<CacheInvalidationListener>()

/**
 * Clear the voice config cache and notify all listeners.
 * Call this after updating voice settings to ensure fresh data is fetched.
 */
export function clearVoiceConfigCache(): void {
  cachedConfig = null
  cacheTimestamp = 0
  // Notify all listeners to refetch
  cacheInvalidationListeners.forEach((listener) => listener())
}

/**
 * Hook to get voice configuration and determine available providers.
 *
 * @example
 * ```tsx
 * function VoiceButton() {
 *   const { sttAvailable, preferredSTTProvider, isLoading } = useVoiceConfig()
 *
 *   if (isLoading) return <Spinner />
 *   if (!sttAvailable) return <div>Voice input not available</div>
 *
 *   return (
 *     <button>
 *       Record ({preferredSTTProvider === 'whisper' ? 'HD' : 'Basic'})
 *     </button>
 *   )
 * }
 * ```
 */
export function useVoiceConfig(): VoiceConfigState {
  const [config, setConfig] = useState<VoiceConfig | null>(cachedConfig)
  const [isLoading, setIsLoading] = useState(!cachedConfig)
  const [error, setError] = useState<string | null>(null)

  // Check browser support once
  const webSpeechSupported = isSpeechRecognitionSupported()

  const fetchConfig = useCallback(async () => {
    // Check cache first
    if (cachedConfig && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
      setConfig(cachedConfig)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Single API call - returns runtime capabilities + user settings
      // Note: The API interceptor already unwraps { success, data } to just data
      const voiceConfig = await api.get<VoiceConfig, VoiceConfig>('/voice/config')

      // Update cache
      cachedConfig = voiceConfig
      cacheTimestamp = Date.now()

      setConfig(voiceConfig)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch voice config'
      setError(message)
      // Don't clear config on error - keep using cached value if available
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch on mount
  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Subscribe to cache invalidation events
  useEffect(() => {
    const handleCacheInvalidation = () => {
      fetchConfig()
    }
    cacheInvalidationListeners.add(handleCacheInvalidation)
    return () => {
      cacheInvalidationListeners.delete(handleCacheInvalidation)
    }
  }, [fetchConfig])

  // Extract settings from config
  const settings = config?.settings ?? null

  // Compute derived values
  // Default to false if not configured (matching server default)
  const voiceEnabled = config?.enabled ?? false
  const whisperAvailable = config?.stt?.whisperAvailable ?? false

  // STT is available if voice is enabled AND a provider is available
  const hasProvider = whisperAvailable || webSpeechSupported
  const sttAvailable = voiceEnabled && hasProvider

  // Prefer browser (works out of the box), fallback to Whisper
  let preferredSTTProvider: 'whisper' | 'browser' | null = null
  if (voiceEnabled) {
    if (webSpeechSupported) {
      preferredSTTProvider = 'browser'
    } else if (whisperAvailable) {
      preferredSTTProvider = 'whisper'
    }
  }

  // Compute narration settings with defaults
  const narration: NarrationSettings = {
    enabled: settings?.narration?.enabled ?? DEFAULT_NARRATION.enabled,
    voice: settings?.narration?.voice ?? DEFAULT_NARRATION.voice,
    speed: settings?.narration?.speed ?? DEFAULT_NARRATION.speed,
    volume: settings?.narration?.volume ?? DEFAULT_NARRATION.volume,
    narrateToolUse: settings?.narration?.narrateToolUse ?? DEFAULT_NARRATION.narrateToolUse,
    narrateToolResults: settings?.narration?.narrateToolResults ?? DEFAULT_NARRATION.narrateToolResults,
    narrateAssistantMessages: settings?.narration?.narrateAssistantMessages ?? DEFAULT_NARRATION.narrateAssistantMessages,
  }

  return {
    config,
    settings,
    narration,
    voiceEnabled,
    whisperAvailable,
    webSpeechSupported,
    sttAvailable,
    preferredSTTProvider,
    isLoading,
    error,
    refetch: fetchConfig,
  }
}
