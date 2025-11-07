/**
 * useVoiceInput React Hook
 *
 * Manages voice input/output state for a specific execution. Provides
 * methods to control voice features and tracks real-time transcript,
 * listening/speaking state, and errors.
 *
 * @module hooks/useVoiceInput
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useVoiceContext } from '../contexts/VoiceContext'
import type { VoiceConfig } from '@sudocode-ai/types'

/**
 * Hook options
 */
export interface UseVoiceInputOptions {
  /**
   * Execution ID
   */
  executionId: string

  /**
   * Initial voice configuration
   */
  initialConfig?: VoiceConfig

  /**
   * Callback when final transcript is received
   */
  onTranscript?: (transcript: string, confidence: number) => void

  /**
   * Callback when interim (partial) transcript is received
   */
  onInterimTranscript?: (transcript: string) => void

  /**
   * Callback when error occurs
   */
  onError?: (error: string) => void
}

/**
 * Default voice configuration
 */
const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  inputEnabled: false,
  outputEnabled: false,
  rate: 1,
  pitch: 1,
  volume: 1,
  autoSpeak: true,
  interruptOnInput: true,
}

/**
 * useVoiceInput hook return value
 */
export interface UseVoiceInputReturn {
  // State
  isEnabled: boolean
  isListening: boolean
  isSpeaking: boolean
  transcript: string
  interimTranscript: string
  confidence: number
  error: string | null

  // Controls
  toggleVoiceInput: () => void
  toggleVoiceOutput: () => void
  startListening: () => Promise<void>
  stopListening: () => void
  pauseListening: () => void
  resumeListening: () => void

  // Configuration
  config: VoiceConfig
  updateConfig: (config: Partial<VoiceConfig>) => void

  // Voices
  availableVoices: SpeechSynthesisVoice[]
}

/**
 * useVoiceInput hook
 *
 * Usage:
 * ```typescript
 * const {
 *   isListening,
 *   transcript,
 *   startListening,
 *   toggleVoiceInput,
 * } = useVoiceInput({
 *   executionId: 'exec-123',
 *   onTranscript: (text) => console.log('User said:', text),
 * })
 * ```
 */
export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputReturn {
  const { executionId, initialConfig, onTranscript, onInterimTranscript, onError } = options

  const {
    voiceService,
    registerExecution,
    unregisterExecution,
    getExecutionConfig,
    updateExecutionConfig,
    currentlySpeaking,
  } = useVoiceContext()

  // Local state
  const [config, setConfig] = useState<VoiceConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...initialConfig,
  }))
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [confidence, setConfidence] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])

  // Track if currently listening
  const isListening = voiceService.getState().isListening
  const isSpeaking = currentlySpeaking === executionId

  // Register execution on mount
  useEffect(() => {
    registerExecution(executionId, config)
    return () => {
      unregisterExecution(executionId)
    }
  }, [executionId, registerExecution, unregisterExecution, config])

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = voiceService.getAvailableVoices()
      setAvailableVoices(voices)
    }

    loadVoices()

    // Some browsers load voices asynchronously
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices
    }

    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null
      }
    }
  }, [voiceService])

  // Listen for transcript events
  useEffect(() => {
    const handleTranscript = (data: { transcript: string; confidence: number; isFinal: boolean }) => {
      if (data.isFinal) {
        setTranscript(data.transcript)
        setConfidence(data.confidence)
        setInterimTranscript('')
        onTranscript?.(data.transcript, data.confidence)
      } else {
        setInterimTranscript(data.transcript)
        onInterimTranscript?.(data.transcript)
      }
    }

    voiceService.on('transcript', handleTranscript)
    return () => voiceService.off('transcript', handleTranscript)
  }, [voiceService, onTranscript, onInterimTranscript])

  // Listen for final transcript events
  useEffect(() => {
    const handleFinalTranscript = (data: { transcript: string; confidence: number }) => {
      setTranscript(data.transcript)
      setConfidence(data.confidence)
      setInterimTranscript('')
      onTranscript?.(data.transcript, data.confidence)
    }

    voiceService.on('transcriptFinal', handleFinalTranscript)
    return () => voiceService.off('transcriptFinal', handleFinalTranscript)
  }, [voiceService, onTranscript])

  // Listen for error events
  useEffect(() => {
    const handleError = (errorData: { message: string }) => {
      setError(errorData.message)
      onError?.(errorData.message)
    }

    voiceService.on('error', handleError)
    return () => voiceService.off('error', handleError)
  }, [voiceService, onError])

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timeout)
    }
  }, [error])

  /**
   * Toggle voice input on/off
   */
  const toggleVoiceInput = useCallback(() => {
    const newConfig = { ...config, inputEnabled: !config.inputEnabled }
    setConfig(newConfig)
    updateExecutionConfig(executionId, newConfig)

    // Stop listening if turning off
    if (config.inputEnabled) {
      voiceService.stopListening()
    }
  }, [config, executionId, updateExecutionConfig, voiceService])

  /**
   * Toggle voice output on/off
   */
  const toggleVoiceOutput = useCallback(() => {
    const newConfig = { ...config, outputEnabled: !config.outputEnabled }
    setConfig(newConfig)
    updateExecutionConfig(executionId, newConfig)
  }, [config, executionId, updateExecutionConfig])

  /**
   * Start listening
   */
  const startListening = useCallback(async () => {
    if (!config.enabled || !config.inputEnabled) {
      return
    }

    try {
      await voiceService.startListening()
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start listening'
      setError(message)
      onError?.(message)
    }
  }, [config, voiceService, onError])

  /**
   * Stop listening
   */
  const stopListening = useCallback(() => {
    voiceService.stopListening()
  }, [voiceService])

  /**
   * Pause listening
   */
  const pauseListening = useCallback(() => {
    voiceService.pauseListening()
  }, [voiceService])

  /**
   * Resume listening
   */
  const resumeListening = useCallback(() => {
    voiceService.resumeListening()
  }, [voiceService])

  /**
   * Update configuration
   */
  const updateConfig = useCallback(
    (updates: Partial<VoiceConfig>) => {
      const newConfig = { ...config, ...updates }
      setConfig(newConfig)
      updateExecutionConfig(executionId, newConfig)
    },
    [config, executionId, updateExecutionConfig]
  )

  return {
    // State
    isEnabled: config.enabled,
    isListening,
    isSpeaking,
    transcript,
    interimTranscript,
    confidence,
    error,

    // Controls
    toggleVoiceInput,
    toggleVoiceOutput,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,

    // Configuration
    config,
    updateConfig,

    // Voices
    availableVoices,
  }
}
