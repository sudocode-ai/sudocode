/**
 * Kokoro TTS Singleton Module
 *
 * Manages a single KokoroTTS instance for the application.
 * Uses the kokoro-js library which runs a 82M parameter TTS model
 * entirely in the browser via WebAssembly.
 */

import { KokoroTTS } from "kokoro-js";

// =============================================================================
// Types
// =============================================================================

export type KokoroModelStatus = "idle" | "loading" | "ready" | "error";

export interface KokoroState {
  status: KokoroModelStatus;
  progress: number; // 0-100
  error: string | null;
}

export interface KokoroVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
}

export interface GenerateSpeechOptions {
  voice?: string;
  speed?: number;
}

// =============================================================================
// Constants
// =============================================================================

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_DTYPE = "q8" as const; // ~86MB, good balance of quality/size

// =============================================================================
// Module State (Singleton)
// =============================================================================

let kokoroInstance: KokoroTTS | null = null;
let loadingPromise: Promise<KokoroTTS> | null = null;
let currentState: KokoroState = {
  status: "idle",
  progress: 0,
  error: null,
};

// State listeners for React integration
const listeners = new Set<(state: KokoroState) => void>();

// Audio context for playback
let audioContext: AudioContext | null = null;

// =============================================================================
// State Management
// =============================================================================

function setState(updates: Partial<KokoroState>): void {
  currentState = { ...currentState, ...updates };
  listeners.forEach((listener) => listener(currentState));
}

/**
 * Get the current Kokoro model state
 * Note: Returns the same reference for useSyncExternalStore compatibility
 */
export function getKokoroState(): KokoroState {
  return currentState;
}

/**
 * Subscribe to state changes
 * @returns Unsubscribe function
 */
export function subscribeToState(
  listener: (state: KokoroState) => void
): () => void {
  listeners.add(listener);
  // Call immediately with current state
  listener(currentState);
  return () => listeners.delete(listener);
}

/**
 * Check if the model is ready
 */
export function isKokoroReady(): boolean {
  return currentState.status === "ready" && kokoroInstance !== null;
}

// =============================================================================
// Model Loading
// =============================================================================

/**
 * Load the Kokoro TTS model
 *
 * This function is idempotent - calling it multiple times will reuse
 * the existing model or loading promise.
 *
 * @param onProgress - Optional progress callback (0-100)
 * @returns The loaded KokoroTTS instance
 */
export async function loadKokoroModel(
  onProgress?: (progress: number) => void
): Promise<KokoroTTS> {
  // Already loaded
  if (kokoroInstance) {
    return kokoroInstance;
  }

  // Already loading - wait for existing promise
  if (loadingPromise) {
    return loadingPromise;
  }

  // Start loading
  setState({ status: "loading", progress: 0, error: null });

  loadingPromise = (async () => {
    try {
      // Use WASM for now - WebGPU has precision issues with q8 quantization
      // that cause jumbled audio output on some platforms
      const device = "wasm";

      const instance = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: DEFAULT_DTYPE,
        device,
        progress_callback: (progressInfo: { progress?: number; status?: string }) => {
          // Calculate overall progress from the progress info
          // The callback receives { status, name, file, progress, loaded, total }
          if (typeof progressInfo.progress === 'number') {
            const pct = Math.round(progressInfo.progress);
            setState({ progress: pct });
            onProgress?.(pct);
          }
        },
      });

      kokoroInstance = instance;
      setState({ status: "ready", progress: 100, error: null });
      return instance;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load Kokoro model";
      console.error("[KokoroTTS] Model load failed:", errorMessage);
      setState({ status: "error", progress: 0, error: errorMessage });
      loadingPromise = null;
      throw err;
    }
  })();

  return loadingPromise;
}

// =============================================================================
// Audio Generation
// =============================================================================

/**
 * Get or create the AudioContext for playback
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Generate speech from text
 *
 * @param text - The text to synthesize
 * @param options - Voice and speed options
 * @returns AudioBuffer ready for playback
 */
export async function generateSpeech(
  text: string,
  options: GenerateSpeechOptions = {}
): Promise<AudioBuffer> {
  if (!kokoroInstance) {
    throw new Error("Kokoro model not loaded. Call loadKokoroModel() first.");
  }

  const { voice = "af_heart", speed = 1.0 } = options;

  // Generate raw audio using Kokoro
  const rawAudio = await kokoroInstance.generate(text, {
    voice: voice as keyof typeof kokoroInstance.voices,
    speed,
  });

  // Convert RawAudio to AudioBuffer
  const ctx = getAudioContext();
  const audioBuffer = ctx.createBuffer(
    1, // mono
    rawAudio.audio.length,
    rawAudio.sampling_rate
  );

  // Copy the Float32Array data to the AudioBuffer
  audioBuffer.copyToChannel(new Float32Array(rawAudio.audio), 0);

  return audioBuffer;
}

/**
 * Generate and play speech
 *
 * @param text - The text to synthesize
 * @param options - Voice and speed options
 * @returns AudioBufferSourceNode that can be used to stop playback
 */
export async function generateAndPlay(
  text: string,
  options: GenerateSpeechOptions = {}
): Promise<AudioBufferSourceNode> {
  const audioBuffer = await generateSpeech(text, options);
  const ctx = getAudioContext();

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.start(0);

  return source;
}

// =============================================================================
// Voice Information
// =============================================================================

/**
 * Get list of available Kokoro voices
 */
export function getAvailableVoices(): KokoroVoice[] {
  if (!kokoroInstance) {
    // Return default list when model not loaded
    return getDefaultVoiceList();
  }

  const voices = kokoroInstance.voices;
  return Object.entries(voices).map(([id, info]) => ({
    id,
    name: info.name,
    language: info.language,
    gender: info.gender,
  }));
}

/**
 * Default voice list (used before model is loaded)
 */
function getDefaultVoiceList(): KokoroVoice[] {
  return [
    { id: "af_heart", name: "Heart", language: "en-US", gender: "female" },
    { id: "af_bella", name: "Bella", language: "en-US", gender: "female" },
    { id: "af_nova", name: "Nova", language: "en-US", gender: "female" },
    { id: "af_sarah", name: "Sarah", language: "en-US", gender: "female" },
    { id: "af_nicole", name: "Nicole", language: "en-US", gender: "female" },
    { id: "af_sky", name: "Sky", language: "en-US", gender: "female" },
    { id: "am_adam", name: "Adam", language: "en-US", gender: "male" },
    { id: "am_michael", name: "Michael", language: "en-US", gender: "male" },
    { id: "am_eric", name: "Eric", language: "en-US", gender: "male" },
    { id: "am_liam", name: "Liam", language: "en-US", gender: "male" },
    { id: "bf_emma", name: "Emma", language: "en-GB", gender: "female" },
    { id: "bf_isabella", name: "Isabella", language: "en-GB", gender: "female" },
    { id: "bf_alice", name: "Alice", language: "en-GB", gender: "female" },
    { id: "bf_lily", name: "Lily", language: "en-GB", gender: "female" },
    { id: "bm_george", name: "George", language: "en-GB", gender: "male" },
    { id: "bm_lewis", name: "Lewis", language: "en-GB", gender: "male" },
    { id: "bm_daniel", name: "Daniel", language: "en-GB", gender: "male" },
  ];
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Reset the Kokoro singleton state
 * Useful for testing or when switching projects
 */
export function resetKokoro(): void {
  kokoroInstance = null;
  loadingPromise = null;
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  setState({ status: "idle", progress: 0, error: null });
}
