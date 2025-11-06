/**
 * Voice dictation types for browser-based speech input/output
 */

/**
 * Voice configuration for execution
 */
export interface VoiceConfig {
  /** Whether voice features are enabled for this execution */
  enabled: boolean
  /** Enable speech-to-text input */
  inputEnabled: boolean
  /** Enable text-to-speech output */
  outputEnabled: boolean
  /** Selected TTS voice name (from browser SpeechSynthesis) */
  voiceName?: string
  /** Speech rate (0.1-10, default 1) */
  rate?: number
  /** Speech pitch (0-2, default 1) */
  pitch?: number
  /** Volume (0-1, default 1) */
  volume?: number
  /** Automatically speak agent messages */
  autoSpeak?: boolean
  /** Interrupt current speech when user speaks */
  interruptOnInput?: boolean
}

/**
 * Voice event types
 */
export type VoiceEventType = 'voice_input' | 'voice_output' | 'voice_status'

/**
 * Voice event - sent between browser and server
 */
export interface VoiceEvent {
  type: VoiceEventType
  executionId: string
  timestamp: string
  data: VoiceInputData | VoiceOutputData | VoiceStatusData
}

/**
 * Voice input data (speech-to-text result)
 */
export interface VoiceInputData {
  /** Transcribed text */
  transcript: string
  /** Recognition confidence (0-1) */
  confidence: number
  /** Whether this is a final result (vs interim) */
  isFinal: boolean
  /** Interim text (for real-time display) */
  interim?: string
}

/**
 * Voice output data (text-to-speech request)
 */
export interface VoiceOutputData {
  /** Text to speak */
  text: string
  /** Priority level for TTS queue */
  priority: VoicePriority
  /** Whether to interrupt current speech */
  interrupt?: boolean
  /** Chunk index (for long messages split into parts) */
  chunkIndex?: number
  /** Total number of chunks */
  totalChunks?: number
}

/**
 * Voice status data
 */
export interface VoiceStatusData {
  /** Current voice status */
  status: VoiceStatus
  /** Optional message (e.g., error description) */
  message?: string
}

/**
 * Voice status enum
 */
export type VoiceStatus = 'listening' | 'speaking' | 'idle' | 'error'

/**
 * Voice priority for TTS queue management
 */
export type VoicePriority = 'high' | 'normal' | 'low'

/**
 * Speech synthesis options
 * Note: This interface uses browser Web Speech API types
 */
export interface SpeechOptions {
  /** Voice to use (SpeechSynthesisVoice in browser) */
  voice?: any
  /** Speech rate (0.1-10) */
  rate?: number
  /** Speech pitch (0-2) */
  pitch?: number
  /** Volume (0-1) */
  volume?: number
}

/**
 * Browser voice support capabilities
 */
export interface VoiceSupport {
  /** Whether SpeechRecognition is supported */
  recognition: boolean
  /** Whether SpeechSynthesis is supported */
  synthesis: boolean
  /** Whether both are supported */
  fullSupport: boolean
}

/**
 * Voice service state
 */
export interface VoiceServiceState {
  /** Is currently listening for voice input */
  isListening: boolean
  /** Is currently speaking */
  isSpeaking: boolean
  /** Current transcript (interim or final) */
  transcript: string
  /** Recognition confidence */
  confidence: number
  /** Any error message */
  error: string | null
  /** Current status */
  status: VoiceStatus
}
