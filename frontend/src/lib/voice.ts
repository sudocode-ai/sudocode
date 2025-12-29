/**
 * Voice input utility functions
 *
 * Provides browser permission handling and audio format detection
 * for the voice input feature.
 */

// Web Speech API types are declared in src/types/web-speech.d.ts

/**
 * Preferred MIME types for audio recording, in order of preference.
 * - audio/webm;codecs=opus offers the best quality/size ratio
 * - audio/webm is a fallback for browsers without opus support
 * - audio/ogg and audio/mp4 are additional fallbacks
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
]

/**
 * Check if the browser supports the Permissions API for microphone
 */
function supportsPermissionsApi(): boolean {
  return typeof navigator !== 'undefined' && 'permissions' in navigator
}

/**
 * Check if the browser supports MediaRecorder
 */
export function isMediaRecorderSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof navigator?.mediaDevices?.getUserMedia !== 'undefined'
}

/**
 * Check the current microphone permission state.
 *
 * Returns:
 * - true: Permission has been granted
 * - false: Permission has been denied
 * - null: Permission hasn't been requested yet (prompt state) or API not supported
 *
 * @example
 * ```ts
 * const hasPermission = await checkMicrophonePermission()
 * if (hasPermission === null) {
 *   // Need to prompt user
 * } else if (hasPermission) {
 *   // Can start recording
 * } else {
 *   // Permission denied
 * }
 * ```
 */
export async function checkMicrophonePermission(): Promise<boolean | null> {
  if (!supportsPermissionsApi()) {
    // Permissions API not supported - return null to indicate unknown
    return null
  }

  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })

    switch (result.state) {
      case 'granted':
        return true
      case 'denied':
        return false
      case 'prompt':
      default:
        return null
    }
  } catch {
    // Safari doesn't support querying microphone permission
    // Return null to indicate we need to try requesting it
    return null
  }
}

/**
 * Request microphone permission from the user.
 *
 * This will trigger the browser's permission prompt if permission
 * hasn't been granted yet.
 *
 * Returns:
 * - true: Permission was granted
 * - false: Permission was denied or an error occurred
 *
 * @example
 * ```ts
 * const granted = await requestMicrophonePermission()
 * if (granted) {
 *   // Can start recording
 * } else {
 *   // Show error message to user
 * }
 * ```
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (!isMediaRecorderSupported()) {
    return false
  }

  try {
    // Request access to trigger the permission prompt
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    // Immediately stop the stream - we just wanted to check/request permission
    stream.getTracks().forEach((track) => track.stop())

    return true
  } catch (error) {
    // NotAllowedError means user denied permission
    // Other errors (NotFoundError, etc.) also mean we can't record
    return false
  }
}

/**
 * Get the best supported MIME type for audio recording.
 *
 * Returns the first supported MIME type from the preferred list,
 * or an empty string if none are supported (MediaRecorder will use default).
 *
 * @example
 * ```ts
 * const mimeType = getSupportedMimeType()
 * const recorder = new MediaRecorder(stream, { mimeType })
 * ```
 */
export function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }

  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }

  // Return empty string to let MediaRecorder use its default
  return ''
}

/**
 * Check if a specific MIME type is supported for recording.
 *
 * @param mimeType - The MIME type to check (e.g., 'audio/webm')
 */
export function isMimeTypeSupported(mimeType: string): boolean {
  if (typeof MediaRecorder === 'undefined') {
    return false
  }
  return MediaRecorder.isTypeSupported(mimeType)
}

// =============================================================================
// Web Speech API (SpeechRecognition) utilities
// =============================================================================

/**
 * Get the SpeechRecognition constructor, handling vendor prefixes.
 * Returns undefined if not supported.
 */
function getSpeechRecognitionConstructor(): typeof SpeechRecognition | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  // Standard API
  if ('SpeechRecognition' in window) {
    return window.SpeechRecognition
  }

  // Webkit prefix (Chrome, Safari)
  if ('webkitSpeechRecognition' in window) {
    return (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition }).webkitSpeechRecognition
  }

  return undefined
}

/**
 * Check if the browser supports Web Speech API (SpeechRecognition).
 *
 * @example
 * ```ts
 * if (isSpeechRecognitionSupported()) {
 *   const recognition = createSpeechRecognition()
 *   recognition?.start()
 * }
 * ```
 */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== undefined
}

/**
 * Create a SpeechRecognition instance with common defaults.
 * Returns null if not supported.
 *
 * @param options - Configuration options
 * @param options.language - Language code (default: 'en-US')
 * @param options.continuous - Whether to continue listening after results (default: true)
 * @param options.interimResults - Whether to return interim results (default: true)
 *
 * @example
 * ```ts
 * const recognition = createSpeechRecognition({ language: 'en-US' })
 * if (recognition) {
 *   recognition.onresult = (event) => {
 *     const transcript = event.results[0][0].transcript
 *     console.log('Heard:', transcript)
 *   }
 *   recognition.start()
 * }
 * ```
 */
export function createSpeechRecognition(options: {
  language?: string
  continuous?: boolean
  interimResults?: boolean
} = {}): SpeechRecognition | null {
  const SpeechRecognitionClass = getSpeechRecognitionConstructor()
  if (!SpeechRecognitionClass) {
    return null
  }

  const recognition = new SpeechRecognitionClass()

  // Apply options with defaults
  recognition.lang = options.language ?? 'en-US'
  recognition.continuous = options.continuous ?? true
  recognition.interimResults = options.interimResults ?? true

  // Maximum alternatives to consider
  recognition.maxAlternatives = 1

  return recognition
}
