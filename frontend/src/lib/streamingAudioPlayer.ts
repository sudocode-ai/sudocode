/**
 * StreamingAudioPlayer
 *
 * Browser-side streaming audio player for WebSocket audio playback.
 * Handles gapless playback of base64-encoded PCM audio chunks received
 * via WebSocket from the Kokoro TTS server.
 *
 * Audio Format:
 * - Mono (1 channel)
 * - 24kHz sample rate (Kokoro default)
 * - Float32 PCM (little-endian)
 */

// =============================================================================
// Constants
// =============================================================================

/** Default sample rate for Kokoro TTS */
const DEFAULT_SAMPLE_RATE = 24000;

/** Buffer ahead time in seconds for gapless playback */
const BUFFER_AHEAD_SECONDS = 0.1; // 100ms

// =============================================================================
// Types
// =============================================================================

export interface StreamingAudioPlayerOptions {
  /** Sample rate for audio playback (default: 24000 Hz) */
  sampleRate?: number;
  /** Number of audio channels (default: 1 for mono) */
  channels?: number;
  /** Buffer ahead time in seconds (default: 0.1) */
  bufferAheadSeconds?: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert base64-encoded PCM audio to Float32Array.
 *
 * The audio data is expected to be Float32 PCM (little-endian),
 * which is the native format from Kokoro TTS.
 *
 * @param base64 - Base64-encoded PCM audio data
 * @returns Float32Array containing audio samples
 */
export function base64ToFloat32(base64: string): Float32Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

// =============================================================================
// StreamingAudioPlayer Class
// =============================================================================

/**
 * StreamingAudioPlayer manages gapless playback of audio chunks.
 *
 * It uses the Web Audio API to schedule audio chunks for playback,
 * ensuring smooth, gapless audio by scheduling each chunk to start
 * immediately after the previous one ends.
 *
 * @example
 * ```typescript
 * const player = new StreamingAudioPlayer();
 *
 * // When WebSocket receives audio chunk:
 * websocket.onmessage = (event) => {
 *   const { audio } = JSON.parse(event.data);
 *   player.playChunk(audio);
 * };
 *
 * // To stop playback:
 * player.stop();
 *
 * // When done:
 * player.close();
 * ```
 */
export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private scheduledTime: number = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private sampleRate: number;
  private channels: number;
  private bufferAheadSeconds: number;
  private isClosing: boolean = false;

  constructor(options: StreamingAudioPlayerOptions = {}) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.channels = options.channels ?? 1;
    this.bufferAheadSeconds = options.bufferAheadSeconds ?? BUFFER_AHEAD_SECONDS;
  }

  /**
   * Get or create the AudioContext.
   * Creates lazily to comply with browser autoplay policies.
   */
  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        sampleRate: this.sampleRate,
      });
    }
    return this.audioContext;
  }

  /**
   * Ensure the AudioContext is running.
   * Required due to browser autoplay policies that suspend contexts
   * created without user interaction.
   */
  private async ensureContextRunning(): Promise<void> {
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  /**
   * Play a chunk of base64-encoded PCM audio.
   *
   * Decodes the base64 data to Float32 samples and schedules
   * playback for gapless audio. Each chunk is scheduled to
   * start immediately after the previous chunk ends.
   *
   * @param pcmBase64 - Base64-encoded Float32 PCM audio data
   * @param sampleRate - Optional sample rate override for this chunk
   * @returns Promise that resolves when the chunk is scheduled
   */
  async playChunk(pcmBase64: string, sampleRate?: number): Promise<void> {
    if (this.isClosing) {
      return;
    }

    await this.ensureContextRunning();
    const ctx = this.getAudioContext();

    // Decode base64 to Float32 samples
    const samples = base64ToFloat32(pcmBase64);

    if (samples.length === 0) {
      return;
    }

    // Use provided sample rate or instance default
    const chunkSampleRate = sampleRate ?? this.sampleRate;

    // Create AudioBuffer for this chunk
    const audioBuffer = ctx.createBuffer(
      this.channels,
      samples.length,
      chunkSampleRate
    );

    // Copy samples to the buffer
    // Create a new Float32Array with explicit ArrayBuffer type for TypeScript compatibility
    audioBuffer.copyToChannel(new Float32Array(samples), 0);

    // Create source node
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // Calculate when to start this chunk
    // If scheduledTime is in the past, start with a small buffer ahead
    const now = ctx.currentTime;
    if (this.scheduledTime < now) {
      this.scheduledTime = now + this.bufferAheadSeconds;
    }

    // Schedule playback
    const startTime = this.scheduledTime;
    source.start(startTime);

    // Track this source for cleanup
    this.activeSources.add(source);

    // Update scheduled time for next chunk
    const chunkDuration = samples.length / chunkSampleRate;
    this.scheduledTime = startTime + chunkDuration;

    // Clean up source when done
    source.onended = () => {
      this.activeSources.delete(source);
    };
  }

  /**
   * Stop all currently playing and scheduled audio.
   * Resets the scheduling state for new playback.
   */
  stop(): void {
    // Stop all active sources
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source may already be stopped or disconnected
      }
    }
    this.activeSources.clear();

    // Reset scheduling time
    this.scheduledTime = 0;
  }

  /**
   * Check if audio is currently playing or scheduled.
   *
   * @returns true if there are active audio sources
   */
  isPlaying(): boolean {
    if (!this.audioContext) {
      return false;
    }

    // Clean up sources that have finished
    const now = this.audioContext.currentTime;

    // Check if we have any sources that are still scheduled or playing
    return this.activeSources.size > 0 && this.scheduledTime > now;
  }

  /**
   * Get the current AudioContext state.
   * Useful for debugging and UI feedback.
   *
   * @returns AudioContext state or null if not initialized
   */
  getState(): AudioContextState | null {
    return this.audioContext?.state ?? null;
  }

  /**
   * Get the number of active (playing or scheduled) audio sources.
   *
   * @returns Number of active sources
   */
  getActiveSourceCount(): number {
    return this.activeSources.size;
  }

  /**
   * Close the AudioContext and clean up resources.
   * The player cannot be used after this is called.
   */
  async close(): Promise<void> {
    this.isClosing = true;
    this.stop();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default StreamingAudioPlayer;
