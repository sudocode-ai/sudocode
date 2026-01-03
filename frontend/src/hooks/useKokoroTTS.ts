/**
 * useKokoroTTS Hook
 *
 * React hook for managing Kokoro TTS model and audio generation.
 * Supports two modes:
 * 1. Browser WASM mode (default): Uses in-browser Kokoro via WASM
 * 2. Server streaming mode: Uses WebSocket to stream audio from server
 *
 * @example
 * ```tsx
 * // Browser WASM mode (default)
 * const { speak, stop, isReady } = useKokoroTTS();
 *
 * // Server streaming mode
 * const { speak, stop, isReady } = useKokoroTTS({ useServer: true });
 * ```
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getKokoroState,
  subscribeToState,
  loadKokoroModel,
  generateSpeech,
  getAvailableVoices,
  isKokoroReady,
  type KokoroState,
  type KokoroVoice,
  type GenerateSpeechOptions,
} from "@/lib/kokoroTTS";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { StreamingAudioPlayer } from "@/lib/streamingAudioPlayer";
import type { WebSocketMessage } from "@/types/api";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for configuring useKokoroTTS hook
 */
export interface UseKokoroTTSOptions {
  /**
   * Whether to use server-side TTS via WebSocket streaming.
   * When true, audio is synthesized on the server and streamed via WebSocket.
   * When false (default), audio is synthesized in the browser using WASM.
   *
   * Falls back to browser TTS if:
   * - WebSocket is not connected
   * - Server returns tts_error with fallback=true
   */
  useServer?: boolean;
}

export interface UseKokoroTTSReturn {
  /** Current model status */
  status: KokoroState["status"];
  /** Download/loading progress (0-100) */
  progress: number;
  /** Error message if status is 'error' */
  error: string | null;
  /** Whether the model is ready for synthesis */
  isReady: boolean;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Load the Kokoro model */
  load: () => Promise<void>;
  /** Generate and play audio from text */
  speak: (text: string, options?: GenerateSpeechOptions) => Promise<void>;
  /** Stop current audio playback */
  stop: () => void;
  /** List of available voices */
  availableVoices: KokoroVoice[];
}

// =============================================================================
// Helper: Generate unique request ID
// =============================================================================

let requestIdCounter = 0;

function generateRequestId(): string {
  requestIdCounter += 1;
  return `tts-${Date.now()}-${requestIdCounter}`;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useKokoroTTS(options: UseKokoroTTSOptions = {}): UseKokoroTTSReturn {
  const { useServer = false } = options;

  // Subscribe to singleton state using useSyncExternalStore for concurrent mode safety
  const state = useSyncExternalStore(subscribeToState, getKokoroState, getKokoroState);

  // WebSocket context for server mode
  const { connected: wsConnected, sendMessage, addMessageHandler, removeMessageHandler } = useWebSocketContext();

  // Local state for playback
  const [isPlaying, setIsPlaying] = useState(false);

  // Refs for browser WASM mode
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Refs for server streaming mode
  const streamingPlayerRef = useRef<StreamingAudioPlayer | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const pendingSpeakRef = useRef<{
    text: string;
    options: GenerateSpeechOptions;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  // Get or create audio context (browser mode)
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  // Get or create streaming player (server mode)
  const getStreamingPlayer = useCallback(() => {
    if (!streamingPlayerRef.current) {
      streamingPlayerRef.current = new StreamingAudioPlayer();
    }
    return streamingPlayerRef.current;
  }, []);

  // Load the model (only needed for browser mode)
  const load = useCallback(async () => {
    if (useServer) {
      // Server mode doesn't need local model loading
      return;
    }
    if (isKokoroReady()) {
      return;
    }
    await loadKokoroModel();
  }, [useServer]);

  // Stop current playback
  const stop = useCallback(() => {
    // Stop browser mode playback
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // Already stopped
      }
      currentSourceRef.current = null;
    }

    // Stop server mode playback
    if (streamingPlayerRef.current) {
      streamingPlayerRef.current.stop();
    }

    // Clear pending request
    currentRequestIdRef.current = null;
    if (pendingSpeakRef.current) {
      pendingSpeakRef.current.reject(new Error('Playback stopped'));
      pendingSpeakRef.current = null;
    }

    setIsPlaying(false);
  }, []);

  // Speak using browser WASM mode
  const speakBrowser = useCallback(
    async (text: string, speechOptions: GenerateSpeechOptions = {}) => {
      // Ensure model is loaded
      if (!isKokoroReady()) {
        await loadKokoroModel();
      }

      // Generate the audio
      const audioBuffer = await generateSpeech(text, speechOptions);

      // Play using AudioContext
      const ctx = getAudioContext();

      // Resume context if suspended (browser autoplay policy)
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      // Track playback state
      setIsPlaying(true);
      currentSourceRef.current = source;

      return new Promise<void>((resolve) => {
        source.onended = () => {
          setIsPlaying(false);
          currentSourceRef.current = null;
          resolve();
        };

        source.start(0);
      });
    },
    [getAudioContext]
  );

  // Speak using server streaming mode
  const speakServer = useCallback(
    async (text: string, speechOptions: GenerateSpeechOptions = {}): Promise<void> => {
      const requestId = generateRequestId();
      currentRequestIdRef.current = requestId;

      // Ensure streaming player is initialized for incoming audio
      getStreamingPlayer();

      return new Promise((resolve, reject) => {
        pendingSpeakRef.current = { text, options: speechOptions, resolve, reject };

        // Send TTS request via WebSocket
        const sent = sendMessage({
          type: 'tts_request',
          request_id: requestId,
          text,
          voice: speechOptions.voice,
          speed: speechOptions.speed,
        });

        if (!sent) {
          // WebSocket send failed, reject immediately
          pendingSpeakRef.current = null;
          currentRequestIdRef.current = null;
          reject(new Error('Failed to send TTS request: WebSocket not connected'));
          return;
        }

        setIsPlaying(true);
      });
    },
    [getStreamingPlayer, sendMessage]
  );

  // Generate and play speech
  const speak = useCallback(
    async (text: string, speechOptions: GenerateSpeechOptions = {}) => {
      // Stop any current playback
      stop();

      // Determine which mode to use
      const shouldUseServer = useServer && wsConnected;

      if (shouldUseServer) {
        try {
          await speakServer(text, speechOptions);
        } catch (err) {
          // Server mode failed, try fallback to browser if it was a connection issue
          console.warn('[useKokoroTTS] Server mode failed, falling back to browser:', err);
          try {
            await speakBrowser(text, speechOptions);
          } catch (browserErr) {
            console.error('[useKokoroTTS] Browser fallback also failed:', browserErr);
            setIsPlaying(false);
            throw browserErr;
          }
        }
      } else {
        // Use browser mode
        try {
          await speakBrowser(text, speechOptions);
        } catch (err) {
          console.error('[useKokoroTTS] speak() error:', err);
          setIsPlaying(false);
          throw err;
        }
      }
    },
    [stop, useServer, wsConnected, speakServer, speakBrowser]
  );

  // Handle WebSocket messages for server streaming mode
  useEffect(() => {
    if (!useServer) {
      return;
    }

    const handlerId = 'kokoro-tts-handler';

    const handleMessage = (message: WebSocketMessage) => {
      // Handle TTS audio chunks
      if (message.type === 'tts_audio') {
        const data = message as unknown as {
          type: 'tts_audio';
          request_id: string;
          chunk: string;
          index: number;
          is_final: boolean;
        };

        // Only process if this is for our current request
        if (data.request_id !== currentRequestIdRef.current) {
          return;
        }

        // Play the audio chunk
        const player = getStreamingPlayer();
        player.playChunk(data.chunk);
      }

      // Handle TTS completion
      if (message.type === 'tts_end') {
        const data = message as unknown as {
          type: 'tts_end';
          request_id: string;
          total_chunks: number;
          duration_ms: number;
        };

        if (data.request_id !== currentRequestIdRef.current) {
          return;
        }

        // Clear request ID immediately so we don't process duplicates
        currentRequestIdRef.current = null;

        // Poll until audio actually finishes playing
        // The StreamingAudioPlayer buffers chunks, so we need to wait for playback to complete
        // IMPORTANT: We resolve the promise AFTER playback completes, not when tts_end arrives
        // This prevents the next speak() from calling stop() and cutting off audio
        const checkPlaybackComplete = () => {
          const player = streamingPlayerRef.current;
          if (!player || !player.isPlaying()) {
            setIsPlaying(false);
            // Now that audio is done, resolve the pending promise
            if (pendingSpeakRef.current) {
              pendingSpeakRef.current.resolve();
              pendingSpeakRef.current = null;
            }
          } else {
            // Still playing, check again in 100ms
            setTimeout(checkPlaybackComplete, 100);
          }
        };
        // Start checking after a brief delay to let the last chunk start
        setTimeout(checkPlaybackComplete, 200);
      }

      // Handle TTS errors
      if (message.type === 'tts_error') {
        const data = message as unknown as {
          type: 'tts_error';
          request_id: string;
          error: string;
          recoverable: boolean;
          fallback: boolean;
        };

        if (data.request_id !== currentRequestIdRef.current) {
          return;
        }

        console.warn('[useKokoroTTS] Server TTS error:', data.error, 'fallback:', data.fallback);

        // If fallback is true, fall back to browser TTS
        if (data.fallback && pendingSpeakRef.current) {
          const pending = pendingSpeakRef.current;
          pendingSpeakRef.current = null;
          currentRequestIdRef.current = null;

          // Attempt browser fallback
          speakBrowser(pending.text, pending.options)
            .then(() => pending.resolve())
            .catch((err) => {
              setIsPlaying(false);
              pending.reject(err);
            });
        } else {
          // No fallback, just reject
          if (pendingSpeakRef.current) {
            pendingSpeakRef.current.reject(new Error(data.error));
            pendingSpeakRef.current = null;
          }
          currentRequestIdRef.current = null;
          setIsPlaying(false);
        }
      }
    };

    addMessageHandler(handlerId, handleMessage);

    return () => {
      removeMessageHandler(handlerId);
    };
  }, [useServer, addMessageHandler, removeMessageHandler, getStreamingPlayer, speakBrowser]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamingPlayerRef.current) {
        streamingPlayerRef.current.close();
      }
    };
  }, [stop]);

  // For server mode, we consider it "ready" if WebSocket is connected
  // For browser mode, we check the Kokoro model state
  const isReady = useServer ? wsConnected : state.status === "ready";

  return {
    status: useServer ? (wsConnected ? "ready" : "idle") : state.status,
    progress: useServer ? (wsConnected ? 100 : 0) : state.progress,
    error: useServer ? null : state.error,
    isReady,
    isPlaying,
    load,
    speak,
    stop,
    availableVoices: getAvailableVoices(),
  };
}

export default useKokoroTTS;
