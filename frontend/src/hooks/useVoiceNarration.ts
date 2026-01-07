import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { VoiceNarrationEvent, NarrationPriority, TTSProvider } from '@sudocode-ai/types/voice'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { WebSocketMessage } from '@/types/api'
import {
  loadKokoroModel,
  generateSpeech,
  isKokoroReady,
  getKokoroState,
  subscribeToState,
  type KokoroState,
} from '@/lib/kokoroTTS'
import { useKokoroTTS } from '@/hooks/useKokoroTTS'
import { toast } from 'sonner'

/**
 * Queued narration item with priority
 */
interface QueuedNarration {
  text: string
  priority: NarrationPriority
  timestamp: number
}

/**
 * Options for the useVoiceNarration hook
 */
export interface UseVoiceNarrationOptions {
  /** Execution ID to filter narration events for */
  executionId: string
  /** Whether narration is enabled (default: false) */
  enabled?: boolean
  /** TTS provider to use (default: 'browser') */
  ttsProvider?: TTSProvider
  /** Kokoro execution mode: 'browser' for WASM, 'server' for streaming (default: 'browser') */
  kokoroMode?: 'browser' | 'server'
  /** Voice name for Web Speech API or Kokoro voice ID (default: system default) */
  voice?: string
  /** Speech rate from 0.5 to 2.0 (default: 1.0) */
  rate?: number
  /** Volume from 0 to 1 (default: 1.0) */
  volume?: number
  /** Callback when speech starts */
  onStart?: () => void
  /** Callback when speech ends (including all queued items) */
  onEnd?: () => void
  /** Callback when an error occurs */
  onError?: (error: Error) => void
}

/**
 * Return type for useVoiceNarration hook
 */
export interface UseVoiceNarrationReturn {
  /** Whether the synthesizer is currently speaking */
  isSpeaking: boolean
  /** Whether speech is paused */
  isPaused: boolean
  /** Current text being spoken (null if not speaking) */
  currentText: string | null
  /** Number of items waiting in the queue */
  queueLength: number
  /** Manually speak text with optional priority */
  speak: (text: string, priority?: NarrationPriority) => void
  /** Pause current speech */
  pause: () => void
  /** Resume paused speech */
  resume: () => void
  /** Skip current utterance and move to next in queue */
  skip: () => void
  /** Stop all speech and clear the queue */
  stop: () => void
  /** Enable or disable narration */
  setEnabled: (enabled: boolean) => void
  /** Whether Web Speech API is supported */
  isSupported: boolean
  /** Available voices for the browser */
  availableVoices: SpeechSynthesisVoice[]
  /** Kokoro model state (for UI display) */
  kokoroState: KokoroState
}

/**
 * Maximum queue size for low priority narrations
 * When queue exceeds this, low priority items are skipped
 */
const LOW_PRIORITY_QUEUE_THRESHOLD = 3

/**
 * Hook for managing TTS playback using the browser's Web Speech API.
 * Subscribes to voice_narration WebSocket events and manages a priority queue.
 *
 * @example
 * ```tsx
 * function ExecutionView({ executionId }: { executionId: string }) {
 *   const {
 *     isSpeaking,
 *     isPaused,
 *     queueLength,
 *     pause,
 *     resume,
 *     skip,
 *     stop,
 *     setEnabled
 *   } = useVoiceNarration({
 *     executionId,
 *     enabled: true,
 *     rate: 1.0,
 *     volume: 0.8,
 *     onError: (err) => console.error('TTS error:', err)
 *   })
 *
 *   return (
 *     <div>
 *       {isSpeaking && <span>Speaking... ({queueLength} queued)</span>}
 *       <button onClick={isPaused ? resume : pause}>
 *         {isPaused ? 'Resume' : 'Pause'}
 *       </button>
 *       <button onClick={skip}>Skip</button>
 *       <button onClick={stop}>Stop</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useVoiceNarration(options: UseVoiceNarrationOptions): UseVoiceNarrationReturn {
  const {
    executionId,
    enabled: initialEnabled = false,
    ttsProvider = 'browser',
    kokoroMode = 'browser',
    voice,
    rate = 1.0,
    volume = 1.0,
    onStart,
    onEnd,
    onError,
  } = options

  // State
  const [enabled, setEnabledState] = useState(initialEnabled)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [currentText, setCurrentText] = useState<string | null>(null)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [kokoroState, setKokoroState] = useState<KokoroState>(getKokoroState)

  // Refs for mutable state
  const queueRef = useRef<QueuedNarration[]>([])
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const isProcessingRef = useRef(false)
  const enabledRef = useRef(enabled)
  const ttsProviderRef = useRef(ttsProvider)
  const kokoroModeRef = useRef(kokoroMode)

  // Use Kokoro TTS hook for server streaming mode
  const kokoroTTS = useKokoroTTS({ useServer: kokoroMode === 'server' })

  // Kokoro-specific refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const kokoroLoadingToastRef = useRef<string | number | undefined>(undefined)

  // Keep refs in sync
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    ttsProviderRef.current = ttsProvider
  }, [ttsProvider])

  useEffect(() => {
    kokoroModeRef.current = kokoroMode
  }, [kokoroMode])

  // Subscribe to Kokoro state changes
  useEffect(() => {
    return subscribeToState(setKokoroState)
  }, [])

  // WebSocket context
  const { addMessageHandler, removeMessageHandler, subscribe, unsubscribe } = useWebSocketContext()

  // Check if Web Speech API is supported
  const isSupported = useMemo(() => {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }, [])

  // Get speechSynthesis reference
  const synth = useMemo(() => {
    if (!isSupported) return null
    return window.speechSynthesis
  }, [isSupported])

  // Load available voices
  useEffect(() => {
    if (!synth) return

    const loadVoices = () => {
      const voices = synth.getVoices()
      setAvailableVoices(voices)
    }

    // Voices may be loaded asynchronously
    loadVoices()
    synth.addEventListener('voiceschanged', loadVoices)

    return () => {
      synth.removeEventListener('voiceschanged', loadVoices)
    }
  }, [synth])

  // Find the selected voice
  const selectedVoice = useMemo(() => {
    if (!voice || availableVoices.length === 0) return null
    return availableVoices.find((v) => v.name === voice || v.voiceURI === voice) || null
  }, [voice, availableVoices])

  /**
   * Get or create AudioContext for Kokoro playback
   */
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])

  /**
   * Speak text using Kokoro TTS (browser WASM mode)
   */
  const speakWithKokoroBrowser = useCallback(
    async (text: string): Promise<void> => {
      // Ensure model is loaded
      if (!isKokoroReady()) {
        // Show loading toast
        kokoroLoadingToastRef.current = toast.loading('Loading Kokoro TTS model...', {
          description: 'This may take a moment on first use.',
        })

        try {
          await loadKokoroModel((progress) => {
            if (kokoroLoadingToastRef.current !== null) {
              toast.loading(`Loading Kokoro TTS model... ${progress}%`, {
                id: kokoroLoadingToastRef.current,
                description: 'This may take a moment on first use.',
              })
            }
          })
          toast.success('Kokoro TTS model loaded!', {
            id: kokoroLoadingToastRef.current,
          })
          kokoroLoadingToastRef.current = undefined
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to load model'
          toast.error('Failed to load Kokoro TTS', {
            id: kokoroLoadingToastRef.current,
            description: errorMessage,
          })
          kokoroLoadingToastRef.current = undefined
          throw err
        }
      }

      // Generate audio
      const audioBuffer = await generateSpeech(text, {
        voice: voice || 'af_heart',
        speed: rate,
      })

      // Get audio context and resume if needed
      const ctx = getAudioContext()
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      // Create and play source
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer

      // Apply volume via gain node
      const gainNode = ctx.createGain()
      gainNode.gain.value = Math.max(0, Math.min(1, volume))
      source.connect(gainNode)
      gainNode.connect(ctx.destination)

      currentSourceRef.current = source
      source.start(0)

      // Return a promise that resolves when audio ends
      return new Promise((resolve) => {
        source.onended = () => {
          currentSourceRef.current = null
          resolve()
        }
      })
    },
    [voice, rate, volume, getAudioContext]
  )

  /**
   * Speak text using Kokoro TTS (routes to browser or server based on kokoroMode)
   */
  const speakWithKokoro = useCallback(
    async (text: string): Promise<void> => {
      // Use server streaming mode if kokoroMode is 'server'
      if (kokoroModeRef.current === 'server') {
        await kokoroTTS.speak(text, {
          voice: voice || 'af_heart',
          speed: rate,
        })
      } else {
        // Use browser WASM mode
        await speakWithKokoroBrowser(text)
      }
    },
    [kokoroTTS, voice, rate, speakWithKokoroBrowser]
  )

  /**
   * Speak text using browser Web Speech API
   */
  const speakWithBrowser = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (!synth) {
          reject(new Error('Speech synthesis not supported'))
          return
        }

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = Math.max(0.5, Math.min(2.0, rate))
        utterance.volume = Math.max(0, Math.min(1, volume))

        if (selectedVoice) {
          utterance.voice = selectedVoice
        }

        utterance.onend = () => {
          currentUtteranceRef.current = null
          resolve()
        }

        utterance.onerror = (event) => {
          currentUtteranceRef.current = null
          if (event.error !== 'interrupted' && event.error !== 'canceled') {
            reject(new Error(`Speech synthesis error: ${event.error}`))
          } else {
            resolve() // Interrupted/canceled is not an error
          }
        }

        currentUtteranceRef.current = utterance
        synth.speak(utterance)
      })
    },
    [synth, rate, volume, selectedVoice]
  )

  /**
   * Process the next item in the queue
   */
  const processQueue = useCallback(() => {
    console.log('[useVoiceNarration] processQueue called:', {
      enabled: enabledRef.current,
      isProcessing: isProcessingRef.current,
      queueLength: queueRef.current.length,
      provider: ttsProviderRef.current,
    })

    if (!enabledRef.current || isProcessingRef.current || queueRef.current.length === 0) {
      console.log('[useVoiceNarration] processQueue early exit:', {
        enabled: enabledRef.current,
        isProcessing: isProcessingRef.current,
        queueLength: queueRef.current.length,
      })
      return
    }

    // For browser TTS, check synth is available
    if (ttsProviderRef.current === 'browser' && !synth) {
      console.log('[useVoiceNarration] processQueue - no synth available')
      return
    }

    // Get the next item (already sorted by priority)
    const nextItem = queueRef.current.shift()
    if (!nextItem) return

    console.log('[useVoiceNarration] Processing item:', {
      text: nextItem.text.substring(0, 50),
      priority: nextItem.priority,
      remainingQueue: queueRef.current.length,
    })

    isProcessingRef.current = true
    setCurrentText(nextItem.text)
    setIsSpeaking(true)
    setIsPaused(false)
    onStart?.()

    // Route to appropriate TTS provider
    const speakPromise =
      ttsProviderRef.current === 'kokoro'
        ? speakWithKokoro(nextItem.text)
        : speakWithBrowser(nextItem.text)

    speakPromise
      .then(() => {
        console.log('[useVoiceNarration] Speak completed, checking queue:', {
          remainingQueue: queueRef.current.length,
        })
        isProcessingRef.current = false
        setCurrentText(null)

        // Process next item in queue
        if (queueRef.current.length > 0) {
          setTimeout(() => processQueue(), 50)
        } else {
          setIsSpeaking(false)
          onEnd?.()
        }
      })
      .catch((err) => {
        // If Kokoro fails, fall back to browser TTS
        if (ttsProviderRef.current === 'kokoro' && synth) {
          console.warn('[useVoiceNarration] Kokoro failed, falling back to browser TTS:', err)
          toast.warning('Kokoro TTS failed, using browser voice', {
            description: 'The browser speech synthesis will be used instead.',
          })

          speakWithBrowser(nextItem.text)
            .then(() => {
              isProcessingRef.current = false
              setCurrentText(null)
              if (queueRef.current.length > 0) {
                setTimeout(() => processQueue(), 50)
              } else {
                setIsSpeaking(false)
                onEnd?.()
              }
            })
            .catch((fallbackErr) => {
              onError?.(fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr)))
              isProcessingRef.current = false
              setCurrentText(null)
              if (queueRef.current.length > 0) {
                setTimeout(() => processQueue(), 50)
              } else {
                setIsSpeaking(false)
              }
            })
        } else {
          onError?.(err instanceof Error ? err : new Error(String(err)))
          isProcessingRef.current = false
          setCurrentText(null)
          if (queueRef.current.length > 0) {
            setTimeout(() => processQueue(), 50)
          } else {
            setIsSpeaking(false)
          }
        }
      })
  }, [synth, speakWithKokoro, speakWithBrowser, onStart, onEnd, onError])

  /**
   * Add text to the narration queue with priority handling
   */
  const speak = useCallback(
    (text: string, priority: NarrationPriority = 'normal') => {
      // For browser TTS, need synth. For Kokoro, it will be loaded on demand.
      if (ttsProviderRef.current === 'browser' && !synth) return
      if (!enabledRef.current || !text.trim()) return

      const queueItem: QueuedNarration = {
        text: text.trim(),
        priority,
        timestamp: Date.now(),
      }

      // Priority handling
      if (priority === 'high') {
        // High priority: interrupt current and play immediately
        if (synth) {
          synth.cancel()
        }
        // Also stop Kokoro if playing
        if (currentSourceRef.current) {
          try {
            currentSourceRef.current.stop()
          } catch {
            // Already stopped
          }
          currentSourceRef.current = null
        }
        isProcessingRef.current = false
        currentUtteranceRef.current = null
        queueRef.current.unshift(queueItem)
      } else if (priority === 'low') {
        // Low priority: skip if queue is too long
        if (queueRef.current.length >= LOW_PRIORITY_QUEUE_THRESHOLD) {
          return // Skip this narration
        }
        queueRef.current.push(queueItem)
      } else {
        // Normal priority: add to queue
        queueRef.current.push(queueItem)
      }

      // Sort queue by priority (high > normal > low)
      const priorityOrder: Record<NarrationPriority, number> = {
        high: 0,
        normal: 1,
        low: 2,
      }
      queueRef.current.sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (priorityDiff !== 0) return priorityDiff
        return a.timestamp - b.timestamp // FIFO within same priority
      })

      // Start processing if not already
      processQueue()
    },
    [synth, processQueue]
  )

  /**
   * Pause current speech
   */
  const pause = useCallback(() => {
    if (!synth) return
    synth.pause()
    setIsPaused(true)
  }, [synth])

  /**
   * Resume paused speech
   */
  const resume = useCallback(() => {
    if (!synth) return
    synth.resume()
    setIsPaused(false)
  }, [synth])

  /**
   * Skip current utterance and move to next
   */
  const skip = useCallback(() => {
    // Stop browser TTS
    if (synth) {
      synth.cancel()
    }
    // Stop Kokoro audio
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop()
      } catch {
        // Already stopped
      }
      currentSourceRef.current = null
    }

    isProcessingRef.current = false
    currentUtteranceRef.current = null
    setCurrentText(null)
    setIsPaused(false)

    // Process next item
    if (queueRef.current.length > 0) {
      setTimeout(() => processQueue(), 50)
    } else {
      setIsSpeaking(false)
      onEnd?.()
    }
  }, [synth, processQueue, onEnd])

  /**
   * Stop all speech and clear the queue
   */
  const stop = useCallback(() => {
    // Stop browser TTS
    if (synth) {
      synth.cancel()
    }
    // Stop Kokoro audio
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop()
      } catch {
        // Already stopped
      }
      currentSourceRef.current = null
    }

    queueRef.current = []
    isProcessingRef.current = false
    currentUtteranceRef.current = null
    setCurrentText(null)
    setIsSpeaking(false)
    setIsPaused(false)
    onEnd?.()
  }, [synth, onEnd])

  /**
   * Enable or disable narration
   */
  const setEnabled = useCallback(
    (newEnabled: boolean) => {
      setEnabledState(newEnabled)
      if (!newEnabled) {
        // Stop and clear when disabled
        stop()
      }
    },
    [stop]
  )

  /**
   * Handle incoming WebSocket messages for voice narration
   */
  useEffect(() => {
    const handlerId = `voice-narration-${executionId}`

    const handleMessage = (message: WebSocketMessage) => {
      if (message.type !== 'voice_narration') return

      console.log('[useVoiceNarration] Received voice_narration message:', {
        enabled: enabledRef.current,
        messageData: message.data,
        expectedExecutionId: executionId,
      })

      if (!enabledRef.current) {
        console.log('[useVoiceNarration] Ignoring - narration disabled')
        return
      }

      const data = message.data as VoiceNarrationEvent['executionId'] extends string
        ? Omit<VoiceNarrationEvent, 'type'>
        : never

      // Type guard for the data
      if (
        !data ||
        typeof data !== 'object' ||
        !('executionId' in data) ||
        !('text' in data) ||
        !('priority' in data)
      ) {
        console.log('[useVoiceNarration] Ignoring - invalid data structure')
        return
      }

      // Filter by executionId
      if (data.executionId !== executionId) {
        console.log('[useVoiceNarration] Ignoring - executionId mismatch:', data.executionId)
        return
      }

      // Queue the narration
      console.log('[useVoiceNarration] Queuing narration:', {
        text: data.text.substring(0, 50),
        priority: data.priority,
        currentQueueLength: queueRef.current.length,
        isProcessing: isProcessingRef.current,
      })
      speak(data.text, data.priority as NarrationPriority)
    }

    addMessageHandler(handlerId, handleMessage)

    // Subscribe to execution events
    subscribe('execution', executionId)

    return () => {
      removeMessageHandler(handlerId)
      unsubscribe('execution', executionId)
    }
  }, [executionId, addMessageHandler, removeMessageHandler, subscribe, unsubscribe, speak, synth])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (synth) {
        synth.cancel()
      }
      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.stop()
        } catch {
          // Already stopped
        }
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
      queueRef.current = []
    }
  }, [synth])

  // Update enabled state when prop changes
  useEffect(() => {
    setEnabledState(initialEnabled)
  }, [initialEnabled])

  return {
    isSpeaking,
    isPaused,
    currentText,
    queueLength: queueRef.current.length,
    speak,
    pause,
    resume,
    skip,
    stop,
    setEnabled,
    isSupported,
    availableVoices,
    kokoroState,
  }
}
