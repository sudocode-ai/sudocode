/**
 * VoiceContext - Global context for voice state management
 *
 * Manages voice-enabled executions and coordinates text-to-speech across
 * multiple concurrent executions to prevent overlapping speech.
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { VoiceService } from '../lib/voice-service'
import type { VoiceConfig, Priority } from '@sudocode-ai/types'

/**
 * TTS queue item
 */
interface TtsQueueItem {
  executionId: string
  text: string
  priority: Priority
  timestamp: number
}

/**
 * Voice context value type
 */
interface VoiceContextValue {
  // Global voice service instance
  voiceService: VoiceService

  // Support detection
  isSupported: boolean

  // Execution tracking
  enabledExecutions: Set<string>
  currentlySpeaking: string | null

  // Registration
  registerExecution: (id: string, config: VoiceConfig) => void
  unregisterExecution: (id: string) => void

  // TTS queue management
  enqueueSpeech: (executionId: string, text: string, priority?: Priority) => void
  interruptSpeech: () => void

  // Configuration
  getExecutionConfig: (id: string) => VoiceConfig | undefined
  updateExecutionConfig: (id: string, config: Partial<VoiceConfig>) => void
}

/**
 * Voice context
 */
const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

/**
 * Priority ordering (higher number = higher priority)
 */
const PRIORITY_ORDER: Record<Priority, number> = {
  high: 3,
  normal: 2,
  low: 1,
}

/**
 * Voice provider component
 */
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const voiceServiceRef = useRef<VoiceService>(new VoiceService())
  const [enabledExecutions, setEnabledExecutions] = useState<Set<string>>(new Set())
  const [currentlySpeaking, setCurrentlySpeaking] = useState<string | null>(null)
  const [ttsQueue, setTtsQueue] = useState<TtsQueueItem[]>([])
  const executionConfigsRef = useRef<Map<string, VoiceConfig>>(new Map())
  const isProcessingRef = useRef(false)

  // Check browser support
  const isSupported = voiceServiceRef.current.isSupported().fullSupport

  /**
   * Register an execution for voice features
   */
  const registerExecution = useCallback((id: string, config: VoiceConfig) => {
    executionConfigsRef.current.set(id, config)
    if (config.enabled) {
      setEnabledExecutions((prev) => new Set(prev).add(id))
    }
  }, [])

  /**
   * Unregister an execution
   */
  const unregisterExecution = useCallback((id: string) => {
    executionConfigsRef.current.delete(id)
    setEnabledExecutions((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

    // Remove items from queue
    setTtsQueue((prev) => prev.filter((item) => item.executionId !== id))

    // Stop speaking if this execution is currently speaking
    if (currentlySpeaking === id) {
      voiceServiceRef.current.stopSpeaking()
      setCurrentlySpeaking(null)
    }
  }, [currentlySpeaking])

  /**
   * Get execution config
   */
  const getExecutionConfig = useCallback((id: string): VoiceConfig | undefined => {
    return executionConfigsRef.current.get(id)
  }, [])

  /**
   * Update execution config
   */
  const updateExecutionConfig = useCallback((id: string, config: Partial<VoiceConfig>) => {
    const currentConfig = executionConfigsRef.current.get(id)
    if (currentConfig) {
      const newConfig = { ...currentConfig, ...config }
      executionConfigsRef.current.set(id, newConfig)

      // Update enabled executions set
      if (newConfig.enabled) {
        setEnabledExecutions((prev) => new Set(prev).add(id))
      } else {
        setEnabledExecutions((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    }
  }, [])

  /**
   * Enqueue speech for TTS
   */
  const enqueueSpeech = useCallback(
    (executionId: string, text: string, priority: Priority = 'normal') => {
      const config = executionConfigsRef.current.get(executionId)
      if (!config || !config.enabled || !config.outputEnabled) {
        return
      }

      const item: TtsQueueItem = {
        executionId,
        text,
        priority,
        timestamp: Date.now(),
      }

      setTtsQueue((prev) => {
        // Check if should interrupt
        if (priority === 'high' && currentlySpeaking) {
          voiceServiceRef.current.stopSpeaking()
          setCurrentlySpeaking(null)
        }

        // Insert by priority
        const newQueue = [...prev, item]
        newQueue.sort((a, b) => {
          const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]
          if (priorityDiff !== 0) return priorityDiff
          return a.timestamp - b.timestamp // FIFO for same priority
        })

        return newQueue
      })
    },
    [currentlySpeaking]
  )

  /**
   * Interrupt current speech
   */
  const interruptSpeech = useCallback(() => {
    if (currentlySpeaking) {
      voiceServiceRef.current.stopSpeaking()
      setCurrentlySpeaking(null)
    }
  }, [currentlySpeaking])

  /**
   * Process TTS queue
   */
  const processQueue = useCallback(async () => {
    // Prevent concurrent processing
    if (isProcessingRef.current || currentlySpeaking) {
      return
    }

    const nextItem = ttsQueue[0]
    if (!nextItem) {
      return
    }

    // Check if execution is still enabled
    const config = executionConfigsRef.current.get(nextItem.executionId)
    if (!config || !config.enabled || !config.outputEnabled) {
      // Remove item and try next
      setTtsQueue((prev) => prev.slice(1))
      return
    }

    isProcessingRef.current = true
    setCurrentlySpeaking(nextItem.executionId)

    try {
      // Speak the text
      await voiceServiceRef.current.speak(nextItem.text, {
        rate: config.rate,
        pitch: config.pitch,
        volume: config.volume,
      })
    } catch (error) {
      console.error('TTS error:', error)
    } finally {
      // Remove processed item
      setTtsQueue((prev) => prev.slice(1))
      setCurrentlySpeaking(null)
      isProcessingRef.current = false
    }
  }, [ttsQueue, currentlySpeaking])

  /**
   * Process queue when it changes
   */
  useEffect(() => {
    if (ttsQueue.length > 0 && !currentlySpeaking && !isProcessingRef.current) {
      processQueue()
    }
  }, [ttsQueue, currentlySpeaking, processQueue])

  /**
   * Listen for speak end events
   */
  useEffect(() => {
    const handleSpeakEnd = () => {
      setCurrentlySpeaking(null)
      isProcessingRef.current = false
    }

    voiceServiceRef.current.on('speakEnd', handleSpeakEnd)

    return () => {
      voiceServiceRef.current.off('speakEnd', handleSpeakEnd)
    }
  }, [])

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      voiceServiceRef.current.stopListening()
      voiceServiceRef.current.stopSpeaking()
    }
  }, [])

  const value: VoiceContextValue = {
    voiceService: voiceServiceRef.current,
    isSupported,
    enabledExecutions,
    currentlySpeaking,
    registerExecution,
    unregisterExecution,
    enqueueSpeech,
    interruptSpeech,
    getExecutionConfig,
    updateExecutionConfig,
  }

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

/**
 * Hook to access voice context
 */
export function useVoiceContext() {
  const context = useContext(VoiceContext)
  if (context === undefined) {
    throw new Error('useVoiceContext must be used within a VoiceProvider')
  }
  return context
}
