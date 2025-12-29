/**
 * Hook to fetch and cache voice configuration
 *
 * Retrieves the voice config from /api/voice/config to determine
 * which STT/TTS providers are available.
 */

import { useState, useEffect, useCallback } from 'react'
import type { VoiceConfig } from '@sudocode-ai/types/voice'
import { isSpeechRecognitionSupported } from '@/lib/voice'

/**
 * Extended voice config with browser capability info
 */
export interface VoiceConfigState {
  /** Server voice configuration */
  config: VoiceConfig | null
  /** Whether Whisper server is available */
  whisperAvailable: boolean
  /** Whether browser Web Speech API is supported */
  webSpeechSupported: boolean
  /** Whether any STT provider is available */
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

// Module-level cache for config (shared across hook instances)
let cachedConfig: VoiceConfig | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60000 // 1 minute cache

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
      const response = await fetch('/api/voice/config')

      if (!response.ok) {
        throw new Error(`Failed to fetch voice config: ${response.status}`)
      }

      const data: VoiceConfig = await response.json()

      // Update cache
      cachedConfig = data
      cacheTimestamp = Date.now()

      setConfig(data)
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

  // Compute derived values
  const whisperAvailable = config?.stt?.whisperAvailable ?? false
  const sttAvailable = whisperAvailable || webSpeechSupported

  // Prefer browser (works out of the box), fallback to Whisper
  let preferredSTTProvider: 'whisper' | 'browser' | null = null
  if (webSpeechSupported) {
    preferredSTTProvider = 'browser'
  } else if (whisperAvailable) {
    preferredSTTProvider = 'whisper'
  }


  return {
    config,
    whisperAvailable,
    webSpeechSupported,
    sttAvailable,
    preferredSTTProvider,
    isLoading,
    error,
    refetch: fetchConfig,
  }
}
