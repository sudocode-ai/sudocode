import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { VoiceNarrationEvent, NarrationPriority } from '@sudocode-ai/types'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { WebSocketMessage } from '@/types/api'

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
  /** Whether narration is enabled (default: true) */
  enabled?: boolean
  /** Voice name for Web Speech API (default: system default) */
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
    enabled: initialEnabled = true,
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

  // Refs for mutable state
  const queueRef = useRef<QueuedNarration[]>([])
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const isProcessingRef = useRef(false)
  const enabledRef = useRef(enabled)

  // Keep enabledRef in sync
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

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
   * Process the next item in the queue
   */
  const processQueue = useCallback(() => {
    if (!synth || !enabledRef.current || isProcessingRef.current || queueRef.current.length === 0) {
      return
    }

    // Get the next item (already sorted by priority)
    const nextItem = queueRef.current.shift()
    if (!nextItem) return

    isProcessingRef.current = true
    setCurrentText(nextItem.text)
    setIsSpeaking(true)
    setIsPaused(false)

    // Create utterance
    const utterance = new SpeechSynthesisUtterance(nextItem.text)
    utterance.rate = Math.max(0.5, Math.min(2.0, rate))
    utterance.volume = Math.max(0, Math.min(1, volume))

    if (selectedVoice) {
      utterance.voice = selectedVoice
    }

    // Handle speech start
    utterance.onstart = () => {
      onStart?.()
    }

    // Handle speech end
    utterance.onend = () => {
      isProcessingRef.current = false
      currentUtteranceRef.current = null
      setCurrentText(null)

      // Process next item in queue
      if (queueRef.current.length > 0) {
        // Small delay to prevent overwhelming the speech synthesis
        setTimeout(() => processQueue(), 50)
      } else {
        setIsSpeaking(false)
        onEnd?.()
      }
    }

    // Handle errors
    utterance.onerror = (event) => {
      // 'interrupted' and 'canceled' are expected when skipping/stopping
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        onError?.(new Error(`Speech synthesis error: ${event.error}`))
      }
      isProcessingRef.current = false
      currentUtteranceRef.current = null
      setCurrentText(null)

      // Continue with queue even after error
      if (queueRef.current.length > 0) {
        setTimeout(() => processQueue(), 50)
      } else {
        setIsSpeaking(false)
      }
    }

    currentUtteranceRef.current = utterance
    synth.speak(utterance)
  }, [synth, rate, volume, selectedVoice, onStart, onEnd, onError])

  /**
   * Add text to the narration queue with priority handling
   */
  const speak = useCallback(
    (text: string, priority: NarrationPriority = 'normal') => {
      if (!synth || !enabledRef.current || !text.trim()) return

      const queueItem: QueuedNarration = {
        text: text.trim(),
        priority,
        timestamp: Date.now(),
      }

      // Priority handling
      if (priority === 'high') {
        // High priority: interrupt current and play immediately
        synth.cancel()
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
    if (!synth) return
    synth.cancel()
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
    if (!synth) return
    synth.cancel()
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

    console.log(`[useVoiceNarration] Setting up handler for ${executionId}, enabled: ${enabledRef.current}, synth: ${!!synth}`)

    const handleMessage = (message: WebSocketMessage) => {
      console.log(`[useVoiceNarration] Received message:`, message.type)
      if (message.type !== 'voice_narration') return
      if (!enabledRef.current) {
        console.log(`[useVoiceNarration] Narration disabled, skipping`)
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
        console.log(`[useVoiceNarration] Invalid data structure:`, data)
        return
      }

      // Filter by executionId
      if (data.executionId !== executionId) {
        console.log(`[useVoiceNarration] Execution ID mismatch: ${data.executionId} !== ${executionId}`)
        return
      }

      console.log(`[useVoiceNarration] Queueing narration: "${data.text.substring(0, 50)}..."`)
      // Queue the narration
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
  }
}
