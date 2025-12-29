import { useState, useCallback, useRef, useEffect } from 'react'
import type { VoiceInputState, VoiceInputError, TranscriptionResult } from '@sudocode-ai/types'
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  getSupportedMimeType,
  isMediaRecorderSupported,
  isSpeechRecognitionSupported,
} from '@/lib/voice'
import { createWebSpeechSession, type WebSpeechController } from '@/lib/webSpeechSTT'
import { useVoiceConfig } from './useVoiceConfig'

/**
 * API function to transcribe audio
 * Sends audio blob to the server for transcription
 */
async function transcribeAudio(audio: Blob, language = 'en'): Promise<TranscriptionResult> {
  const formData = new FormData()
  formData.append('audio', audio)
  formData.append('language', language)

  const response = await fetch('/api/voice/transcribe', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Transcription failed' }))
    throw new Error(error.message || 'Transcription failed')
  }

  return response.json()
}

/**
 * Options for the useVoiceInput hook
 */
export interface UseVoiceInputOptions {
  /** Language code for transcription (default: 'en') */
  language?: string
  /** Callback when transcription completes successfully */
  onTranscription?: (text: string) => void
  /** Callback when an error occurs */
  onError?: (error: VoiceInputError) => void
  /** Audio MIME type (default: 'audio/webm') */
  mimeType?: string
  /** Callback for interim results (browser mode only) */
  onInterimResult?: (text: string) => void
}

/**
 * Return type for useVoiceInput hook
 */
export interface UseVoiceInputReturn {
  /** Current state of the voice input */
  state: VoiceInputState
  /** Error object if in error state */
  error: VoiceInputError | null
  /** Last transcription result (null if none yet) */
  transcription: string | null
  /** Recording duration in seconds */
  recordingDuration: number
  /** Start recording audio */
  startRecording: () => Promise<void>
  /** Stop recording and return transcription */
  stopRecording: () => Promise<string>
  /** Cancel recording without transcribing */
  cancelRecording: () => void
  /** Clear the current transcription */
  clearTranscription: () => void
  /** Whether microphone permission has been granted */
  hasPermission: boolean | null
  /** Request microphone permission */
  requestPermission: () => Promise<boolean>
  /** Whether the browser supports audio recording */
  isSupported: boolean
  /** Current STT provider being used ('whisper' | 'browser' | null) */
  sttProvider: 'whisper' | 'browser' | null
  /** Whether config is still loading */
  isConfigLoading: boolean
  /**
   * @deprecated Use recordingDuration instead
   */
  duration: number
}

/**
 * Hook for handling voice input with automatic fallback.
 *
 * Uses Whisper server if available, otherwise falls back to
 * browser Web Speech API for transcription.
 *
 * @example
 * ```tsx
 * function VoiceButton() {
 *   const {
 *     state,
 *     startRecording,
 *     stopRecording,
 *     error,
 *     duration,
 *     sttProvider
 *   } = useVoiceInput({
 *     onTranscription: (text) => setPrompt(text),
 *     onError: (err) => console.error(err)
 *   })
 *
 *   return (
 *     <button
 *       onClick={state === 'recording' ? stopRecording : startRecording}
 *       disabled={state === 'transcribing'}
 *     >
 *       {state === 'recording' ? `Recording... ${duration}s` : 'Record'}
 *       {sttProvider === 'browser' && ' (Basic)'}
 *     </button>
 *   )
 * }
 * ```
 */
export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const { language = 'en', onTranscription, onError, mimeType, onInterimResult } = options

  const [state, setState] = useState<VoiceInputState>('idle')
  const [error, setError] = useState<VoiceInputError | null>(null)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [duration, setDuration] = useState(0)
  const [transcription, setTranscription] = useState<string | null>(null)

  // Get voice configuration to determine which provider to use
  const { preferredSTTProvider, isLoading: isConfigLoading } = useVoiceConfig()

  // Refs for MediaRecorder mode (Whisper)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // Refs for Web Speech mode
  const webSpeechRef = useRef<WebSpeechController | null>(null)
  const webSpeechTranscriptRef = useRef<string>('')
  const isStoppingRef = useRef<boolean>(false)

  // Common refs
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const currentModeRef = useRef<'whisper' | 'browser' | null>(null)

  // Callback refs to avoid stale closures during async operations
  const onTranscriptionRef = useRef(onTranscription)
  const onErrorRef = useRef(onError)
  const onInterimResultRef = useRef(onInterimResult)

  // Keep refs in sync with latest callbacks
  useEffect(() => {
    onTranscriptionRef.current = onTranscription
    onErrorRef.current = onError
    onInterimResultRef.current = onInterimResult
  }, [onTranscription, onError, onInterimResult])

  // Check if any recording method is supported
  const isSupported = isMediaRecorderSupported() || isSpeechRecognitionSupported()

  // Check permission status on mount
  useEffect(() => {
    checkMicrophonePermission().then(setHasPermission)
  }, [])

  // Cleanup function for MediaRecorder mode
  const cleanupMediaRecorder = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    mediaRecorderRef.current = null
    chunksRef.current = []
  }, [])

  // Cleanup function for Web Speech mode
  const cleanupWebSpeech = useCallback(() => {
    if (webSpeechRef.current) {
      webSpeechRef.current.abort()
      webSpeechRef.current = null
    }
    webSpeechTranscriptRef.current = ''
  }, [])

  // Combined cleanup function
  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    cleanupMediaRecorder()
    cleanupWebSpeech()
    setDuration(0)
    currentModeRef.current = null
  }, [cleanupMediaRecorder, cleanupWebSpeech])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  /**
   * Start recording using MediaRecorder (for Whisper transcription)
   */
  const startMediaRecorderMode = useCallback(async () => {
    if (!isMediaRecorderSupported()) {
      throw new Error('MediaRecorder is not supported')
    }

    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    setHasPermission(true)

    // Determine best MIME type
    const actualMimeType = mimeType || getSupportedMimeType()

    // Create MediaRecorder
    const recorder = new MediaRecorder(stream, actualMimeType ? { mimeType: actualMimeType } : undefined)
    mediaRecorderRef.current = recorder

    // Collect audio data
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    // Handle errors
    recorder.onerror = () => {
      const err: VoiceInputError = {
        code: 'transcription_failed',
        message: 'Recording failed',
      }
      setError(err)
      setState('error')
      onErrorRef.current?.(err)
      cleanup()
    }

    // Start recording
    recorder.start(100) // Collect data every 100ms
    currentModeRef.current = 'whisper'
    setState('recording')
  }, [mimeType, cleanup])

  /**
   * Start recording using Web Speech API (browser fallback)
   */
  const startWebSpeechMode = useCallback(async () => {
    if (!isSpeechRecognitionSupported()) {
      throw new Error('Web Speech API is not supported')
    }

    // Convert language code format (e.g., 'en' -> 'en-US')
    const speechLang = language.includes('-') ? language : `${language}-US`

    webSpeechTranscriptRef.current = ''
    isStoppingRef.current = false

    const controller = createWebSpeechSession({
      language: speechLang,
      onResult: (result) => {
        // Ignore results that come in after we've started stopping
        if (isStoppingRef.current) {
          return
        }
        if (result.isFinal) {
          // Accumulate final results (add space only if needed)
          const prev = webSpeechTranscriptRef.current
          const needsSpace = prev && !prev.endsWith(' ') && !result.text.startsWith(' ')
          webSpeechTranscriptRef.current = prev + (needsSpace ? ' ' : '') + result.text
          // Also report finals as interim so UI stays in sync
          onInterimResultRef.current?.(webSpeechTranscriptRef.current)
        } else {
          // Report cumulative transcript: accumulated finals + current interim
          const prev = webSpeechTranscriptRef.current
          const needsSpace = prev && !prev.endsWith(' ') && !result.text.startsWith(' ')
          const cumulative = prev + (needsSpace ? ' ' : '') + result.text
          onInterimResultRef.current?.(cumulative)
        }
      },
      onError: (err) => {
        setError(err)
        setState('error')
        onErrorRef.current?.(err)
        cleanup()
      },
      onEnd: () => {
        // This is called when recognition ends naturally
        // We handle this in stopRecording instead
      },
    })

    if (!controller) {
      throw new Error('Failed to create speech recognition session')
    }

    webSpeechRef.current = controller
    controller.start()
    currentModeRef.current = 'browser'
    setHasPermission(true) // Web Speech API handles its own permissions
    setState('recording')
  }, [language, cleanup])

  /**
   * Start recording audio from the microphone
   */
  const startRecording = useCallback(async () => {
    if (!isSupported) {
      const err: VoiceInputError = {
        code: 'not_supported',
        message: 'Audio recording is not supported in this browser',
      }
      setError(err)
      setState('error')
      onErrorRef.current?.(err)
      return
    }

    // Reset state
    setError(null)
    chunksRef.current = []
    webSpeechTranscriptRef.current = ''

    try {
      // Choose mode based on provider availability
      if (preferredSTTProvider === 'whisper') {
        await startMediaRecorderMode()
      } else if (preferredSTTProvider === 'browser') {
        await startWebSpeechMode()
      } else {
        // No provider available - try browser as last resort
        if (isSpeechRecognitionSupported()) {
          await startWebSpeechMode()
        } else if (isMediaRecorderSupported()) {
          // MediaRecorder available but Whisper not - will fail on transcription
          await startMediaRecorderMode()
        } else {
          throw new Error('No speech recognition method available')
        }
      }

      // Start duration timer
      startTimeRef.current = Date.now()
      durationIntervalRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 100)
    } catch (err) {
      let voiceError: VoiceInputError

      if (err instanceof Error && err.name === 'NotAllowedError') {
        voiceError = {
          code: 'permission_denied',
          message: 'Microphone access was denied. Please allow microphone access to use voice input.',
        }
        setHasPermission(false)
      } else {
        voiceError = {
          code: 'transcription_failed',
          message: err instanceof Error ? err.message : 'Failed to start recording',
        }
      }

      setError(voiceError)
      setState('error')
      onErrorRef.current?.(voiceError)
      cleanup()
    }
  }, [isSupported, preferredSTTProvider, startMediaRecorderMode, startWebSpeechMode, cleanup])

  /**
   * Stop recording and transcribe (MediaRecorder mode)
   */
  const stopMediaRecorderMode = useCallback((): Promise<string> => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      return Promise.resolve('')
    }

    return new Promise<string>((resolve) => {
      recorder.onstop = async () => {
        // Create blob from chunks
        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        // Stop the media stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }

        // Don't transcribe if audio is too short
        if (audioBlob.size < 1000) {
          setState('idle')
          cleanup()
          resolve('')
          return
        }

        // Start transcription
        setState('transcribing')

        try {
          const result = await transcribeAudio(audioBlob, language)
          setState('idle')
          setTranscription(result.text)
          onTranscriptionRef.current?.(result.text)
          resolve(result.text)
        } catch (err) {
          const voiceError: VoiceInputError = {
            code: 'transcription_failed',
            message: err instanceof Error ? err.message : 'Transcription failed',
          }
          setError(voiceError)
          setState('error')
          onErrorRef.current?.(voiceError)
          resolve('')
        } finally {
          cleanup()
        }
      }

      recorder.stop()
    })
  }, [language, cleanup])

  /**
   * Stop recording and get transcript (Web Speech mode)
   */
  const stopWebSpeechMode = useCallback((): Promise<string> => {
    const controller = webSpeechRef.current
    if (!controller) {
      return Promise.resolve('')
    }

    return new Promise<string>((resolve) => {
      // Give a small delay for final results to come in
      setTimeout(() => {
        // Mark as stopping BEFORE stop/abort to ignore any late results
        isStoppingRef.current = true
        controller.stop()

        const text = webSpeechTranscriptRef.current.trim()

        if (text) {
          setState('idle')
          setTranscription(text)
          onTranscriptionRef.current?.(text)
        } else {
          setState('idle')
        }

        cleanup()
        resolve(text)
      }, 100)
    })
  }, [cleanup])

  /**
   * Stop recording and transcribe the audio
   * @returns The transcribed text, or empty string if transcription failed or audio too short
   */
  const stopRecording = useCallback(async (): Promise<string> => {
    // Stop the timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    if (currentModeRef.current === 'whisper') {
      return stopMediaRecorderMode()
    } else if (currentModeRef.current === 'browser') {
      return stopWebSpeechMode()
    }

    return ''
  }, [stopMediaRecorderMode, stopWebSpeechMode])

  /**
   * Cancel recording without transcribing
   */
  const cancelRecording = useCallback(() => {
    if (currentModeRef.current === 'whisper') {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.onstop = null // Prevent transcription
        mediaRecorderRef.current.stop()
      }
    } else if (currentModeRef.current === 'browser') {
      if (webSpeechRef.current) {
        webSpeechRef.current.abort()
      }
    }

    cleanup()
    setState('idle')
    setError(null)
  }, [cleanup])

  /**
   * Clear the current transcription
   */
  const clearTranscription = useCallback(() => {
    setTranscription(null)
  }, [])

  /**
   * Request microphone permission
   * @returns true if permission was granted, false otherwise
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const granted = await requestMicrophonePermission()
    setHasPermission(granted)
    return granted
  }, [])

  return {
    state,
    error,
    transcription,
    recordingDuration: duration,
    startRecording,
    stopRecording,
    cancelRecording,
    clearTranscription,
    hasPermission,
    requestPermission,
    isSupported,
    sttProvider: preferredSTTProvider,
    isConfigLoading,
    // Deprecated - kept for backwards compatibility
    duration,
  }
}
