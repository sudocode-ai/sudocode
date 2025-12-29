/**
 * Voice functionality types for sudocode
 * Covers Speech-to-Text (STT) and Text-to-Speech (TTS) capabilities
 */

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Available STT (Speech-to-Text) providers
 */
export type STTProvider = "whisper-local" | "openai";

/**
 * Available TTS (Text-to-Speech) providers
 */
export type TTSProvider = "browser" | "kokoro" | "openai";

// =============================================================================
// Project Settings (config.json)
// =============================================================================

/**
 * Voice settings stored in .sudocode/config.json
 *
 * These settings configure how voice features work for a project.
 *
 * @example
 * ```json
 * {
 *   "voice": {
 *     "enabled": true,
 *     "stt": {
 *       "provider": "whisper-local",
 *       "whisperUrl": "http://localhost:2022/v1",
 *       "whisperModel": "base"
 *     },
 *     "tts": {
 *       "provider": "browser"
 *     }
 *   }
 * }
 * ```
 */
export interface VoiceSettingsConfig {
  /** Whether voice features are enabled (default: true) */
  enabled?: boolean;
  /** Speech-to-text settings */
  stt?: {
    /** Preferred STT provider */
    provider?: STTProvider;
    /** URL for local Whisper server (default: http://localhost:2022/v1) */
    whisperUrl?: string;
    /** Whisper model to use (default: base) */
    whisperModel?: string;
  };
  /** Text-to-speech settings */
  tts?: {
    /** Preferred TTS provider */
    provider?: TTSProvider;
  };
}

// =============================================================================
// STT Types
// =============================================================================

/**
 * Result from a speech-to-text transcription
 */
export interface TranscriptionResult {
  /** The transcribed text */
  text: string;
  /** Confidence score from 0 to 1 (optional, provider-dependent) */
  confidence?: number;
  /** Duration of the audio in milliseconds */
  duration_ms?: number;
}

/**
 * Options for speech-to-text transcription
 */
export interface STTOptions {
  /** Language code (e.g., "en", "es", "fr") - defaults to "en" */
  language?: string;
  /** Preferred STT provider */
  provider?: STTProvider;
}

// =============================================================================
// TTS Types
// =============================================================================

/**
 * Options for text-to-speech synthesis
 */
export interface TTSOptions {
  /** Voice identifier (provider-specific) */
  voice?: string;
  /** Preferred TTS provider */
  provider?: TTSProvider;
  /** Speech rate multiplier (0.5 to 2.0) */
  rate?: number;
  /** Volume level (0 to 1) */
  volume?: number;
}

/**
 * Request for text-to-speech synthesis
 */
export interface SynthesizeRequest {
  /** Text to synthesize */
  text: string;
  /** Voice identifier */
  voice?: string;
  /** TTS provider to use */
  provider?: TTSProvider;
}

/**
 * Response from text-to-speech synthesis
 * For browser provider: returns text for Web Speech API
 * For kokoro/openai: audio is returned as a stream (audio/mpeg)
 */
export interface SynthesizeResponse {
  /** Text to speak (for browser provider) */
  text?: string;
  /** Audio content type (for kokoro/openai) */
  contentType?: string;
}

// =============================================================================
// Voice Input States
// =============================================================================

/**
 * State of the voice input UI
 */
export type VoiceInputState = "idle" | "recording" | "transcribing" | "error";

/**
 * Error codes for voice input failures
 */
export type VoiceInputErrorCode =
  | "permission_denied"
  | "not_supported"
  | "transcription_failed"
  | "network_error";

/**
 * Error object for voice input failures
 */
export interface VoiceInputError {
  /** Error code for programmatic handling */
  code: VoiceInputErrorCode;
  /** Human-readable error message */
  message: string;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/**
 * Request for POST /api/voice/transcribe
 * Note: Actual request is multipart/form-data with audio blob
 */
export interface TranscribeRequest {
  /** Audio blob (audio/webm, audio/mp3, audio/wav) */
  audio: Blob;
  /** Language code (optional, defaults to "en") */
  language?: string;
}

/**
 * Response from POST /api/voice/transcribe
 */
export interface TranscribeResponse {
  /** Transcribed text */
  text: string;
  /** Confidence score from 0 to 1 */
  confidence?: number;
  /** Duration of the audio in milliseconds */
  duration_ms?: number;
}

// =============================================================================
// Voice Configuration
// =============================================================================

/**
 * STT configuration from GET /api/voice/config
 */
export interface STTConfig {
  /** Available STT providers */
  providers: STTProvider[];
  /** Default provider */
  default: STTProvider;
  /** Whether local Whisper is available */
  whisperAvailable: boolean;
}

/**
 * TTS configuration from GET /api/voice/config
 */
export interface TTSConfig {
  /** Available TTS providers */
  providers: TTSProvider[];
  /** Default provider */
  default: TTSProvider;
  /** Whether Kokoro is available */
  kokoroAvailable: boolean;
  /** Available voices per provider */
  voices: Record<TTSProvider, string[]>;
}

/**
 * Full voice configuration from GET /api/voice/config
 */
export interface VoiceConfig {
  /** Whether voice features are enabled for this project */
  enabled: boolean;
  /** Speech-to-text configuration */
  stt: STTConfig;
  /** Text-to-speech configuration */
  tts: TTSConfig;
}

// =============================================================================
// Voice Narration Events (WebSocket)
// =============================================================================

/**
 * Category of narration content
 */
export type NarrationCategory = "status" | "progress" | "result" | "error";

/**
 * Priority level for narration
 */
export type NarrationPriority = "low" | "normal" | "high";

/**
 * WebSocket event for voice narration
 */
export interface VoiceNarrationEvent {
  /** Event type identifier */
  type: "voice_narration";
  /** Associated execution ID */
  executionId: string;
  /** Text to be narrated */
  text: string;
  /** Category of the narration */
  category: NarrationCategory;
  /** Priority level for queue ordering */
  priority: NarrationPriority;
}

// =============================================================================
// User Preferences
// =============================================================================

/**
 * User voice preferences stored in localStorage
 */
export interface VoicePreferences {
  /** Whether voice narration is enabled */
  narrationEnabled: boolean;
  /** Preferred TTS provider */
  ttsProvider: TTSProviderType;
  /** Preferred voice for TTS */
  ttsVoice: string;
  /** Narration playback speed (0.5 to 2.0) */
  narrationSpeed: number;
  /** Narration volume (0 to 1) */
  narrationVolume: number;
}

// =============================================================================
// TTS Provider Interface (Service-side)
// =============================================================================

/**
 * TTS provider type identifier
 * Used to distinguish between different provider implementations
 */
export type TTSProviderType = TTSProvider;

/**
 * Options passed to TTS providers for synthesis
 */
export interface TTSProviderOptions {
  /** Voice identifier (provider-specific) */
  voice?: string;
  /** Speech speed multiplier (0.5 to 2.0, default: 1.0) */
  speed?: number;
  /** Speech pitch multiplier (0.5 to 2.0, default: 1.0) */
  pitch?: number;
}

/**
 * Result from TTS synthesis
 *
 * Different providers return results in different forms:
 * - Server-side TTS (Kokoro, OpenAI): Returns audio buffer
 * - Browser TTS: Returns text for client-side Web Speech API synthesis
 */
export interface TTSProviderResult {
  /**
   * Audio buffer for server-side TTS providers.
   * Present when audio is synthesized server-side.
   */
  audio?: Buffer;

  /**
   * MIME type of the audio (e.g., "audio/mpeg", "audio/wav")
   * Present when audio is returned
   */
  mimeType?: string;

  /**
   * Text to synthesize client-side.
   * Present when using browser TTS (client does actual synthesis).
   */
  text?: string;

  /**
   * SSML markup for enhanced synthesis.
   * Optional, used for providers that support SSML.
   */
  ssml?: string;
}

/**
 * Information about a TTS voice
 */
export interface TTSVoice {
  /** Unique voice identifier (provider-specific) */
  id: string;
  /** Human-readable voice name */
  name: string;
  /** Language code (e.g., "en-US", "en-GB", "es-ES") */
  language: string;
  /** Provider that offers this voice */
  provider: TTSProviderType;
}
