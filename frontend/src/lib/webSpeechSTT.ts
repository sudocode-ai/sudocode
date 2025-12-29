/**
 * Web Speech API wrapper for speech-to-text transcription
 *
 * Provides a simplified interface for browser-based speech recognition
 * using the Web Speech API (SpeechRecognition).
 */

import { createSpeechRecognition, isSpeechRecognitionSupported } from './voice'
import type { VoiceInputError } from '@sudocode-ai/types'

/**
 * Result from Web Speech API transcription
 */
export interface WebSpeechResult {
  /** Transcribed text */
  text: string
  /** Confidence score (0-1), or undefined if not available */
  confidence?: number
  /** Whether this is a final result (vs interim) */
  isFinal: boolean
}

/**
 * Controller for an active Web Speech transcription session
 */
export interface WebSpeechController {
  /** Start listening for speech */
  start: () => void
  /** Stop listening and finalize results */
  stop: () => void
  /** Abort listening without finalizing */
  abort: () => void
}

/**
 * Options for Web Speech transcription
 */
export interface WebSpeechOptions {
  /** Language code (default: 'en-US') */
  language?: string
  /** Callback for each result (interim and final) */
  onResult?: (result: WebSpeechResult) => void
  /** Callback when transcription ends (with final transcript) */
  onEnd?: (finalTranscript: string) => void
  /** Callback for errors */
  onError?: (error: VoiceInputError) => void
}

/**
 * Map Web Speech API error codes to VoiceInputError codes
 */
function mapSpeechError(event: SpeechRecognitionErrorEvent): VoiceInputError {
  switch (event.error) {
    case 'no-speech':
      return {
        code: 'transcription_failed',
        message: 'No speech detected. Please try again.',
      }
    case 'audio-capture':
      return {
        code: 'transcription_failed',
        message: 'No microphone found. Please check your audio settings.',
      }
    case 'not-allowed':
      return {
        code: 'permission_denied',
        message: 'Microphone access was denied. Please allow microphone access to use voice input.',
      }
    case 'network':
      return {
        code: 'transcription_failed',
        message: 'Network error during speech recognition. Please check your connection.',
      }
    case 'aborted':
      // User intentionally aborted - not really an error
      return {
        code: 'transcription_failed',
        message: 'Speech recognition was cancelled.',
      }
    case 'service-not-allowed':
      return {
        code: 'not_supported',
        message: 'Speech recognition service is not allowed. Try using HTTPS.',
      }
    case 'language-not-supported':
      return {
        code: 'transcription_failed',
        message: 'The selected language is not supported for speech recognition.',
      }
    default:
      return {
        code: 'transcription_failed',
        message: `Speech recognition error: ${event.error}`,
      }
  }
}

/**
 * Create a Web Speech transcription session.
 *
 * Returns a controller to start/stop the session, or null if not supported.
 *
 * @example
 * ```ts
 * const controller = createWebSpeechSession({
 *   language: 'en-US',
 *   onResult: (result) => {
 *     console.log('Interim:', result.text)
 *   },
 *   onEnd: (finalText) => {
 *     console.log('Final:', finalText)
 *   },
 *   onError: (err) => {
 *     console.error('Error:', err.message)
 *   }
 * })
 *
 * if (controller) {
 *   controller.start()
 *   // Later...
 *   controller.stop()
 * }
 * ```
 */
export function createWebSpeechSession(options: WebSpeechOptions = {}): WebSpeechController | null {
  if (!isSpeechRecognitionSupported()) {
    return null
  }

  const { language = 'en-US', onResult, onEnd, onError } = options

  const recognition = createSpeechRecognition({
    language,
    continuous: true,
    interimResults: true,
  })

  if (!recognition) {
    return null
  }

  // Track the full transcript across multiple result events
  let finalTranscript = ''
  let isActive = false

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interimTranscript = ''

    // Process all results
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const transcript = result[0].transcript
      const confidence = result[0].confidence

      if (result.isFinal) {
        finalTranscript += transcript
        onResult?.({
          text: transcript,
          confidence,
          isFinal: true,
        })
      } else {
        interimTranscript += transcript
      }
    }

    // Report interim results
    if (interimTranscript) {
      onResult?.({
        text: interimTranscript,
        confidence: undefined,
        isFinal: false,
      })
    }
  }

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    // Ignore 'aborted' errors when we intentionally stopped
    if (event.error === 'aborted' && !isActive) {
      return
    }
    onError?.(mapSpeechError(event))
  }

  recognition.onend = () => {
    isActive = false
    onEnd?.(finalTranscript)
  }

  return {
    start: () => {
      finalTranscript = ''
      isActive = true
      recognition.start()
    },
    stop: () => {
      isActive = false
      recognition.stop()
    },
    abort: () => {
      isActive = false
      recognition.abort()
    },
  }
}

/**
 * Perform a single Web Speech transcription.
 *
 * Returns a promise that resolves with the final transcript.
 * The transcription continues until the user stops speaking or
 * the timeout is reached.
 *
 * @param options - Transcription options
 * @param options.language - Language code (default: 'en-US')
 * @param options.timeoutMs - Maximum duration in ms (default: 30000)
 * @param options.onInterimResult - Callback for interim results
 *
 * @throws VoiceInputError if transcription fails
 *
 * @example
 * ```ts
 * try {
 *   const text = await transcribeWithWebSpeech({
 *     language: 'en-US',
 *     onInterimResult: (text) => console.log('Hearing:', text)
 *   })
 *   console.log('Final:', text)
 * } catch (error) {
 *   console.error('Failed:', error.message)
 * }
 * ```
 */
export async function transcribeWithWebSpeech(options: {
  language?: string
  timeoutMs?: number
  onInterimResult?: (text: string) => void
} = {}): Promise<string> {
  const { language = 'en-US', timeoutMs = 30000, onInterimResult } = options

  if (!isSpeechRecognitionSupported()) {
    const error: VoiceInputError = {
      code: 'not_supported',
      message: 'Web Speech API is not supported in this browser.',
    }
    throw error
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const controller = createWebSpeechSession({
      language,
      onResult: (result) => {
        if (!result.isFinal && onInterimResult) {
          onInterimResult(result.text)
        }
      },
      onEnd: (finalTranscript) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        resolve(finalTranscript)
      },
      onError: (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        reject(error)
      },
    })

    if (!controller) {
      const error: VoiceInputError = {
        code: 'not_supported',
        message: 'Failed to create speech recognition session.',
      }
      reject(error)
      return
    }

    // Set timeout
    timeoutId = setTimeout(() => {
      controller.stop()
    }, timeoutMs)

    controller.start()
  })
}
