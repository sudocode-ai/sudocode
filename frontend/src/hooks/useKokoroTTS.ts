/**
 * useKokoroTTS Hook
 *
 * React hook for managing Kokoro TTS model and audio generation.
 * Wraps the kokoroTTS singleton module for use in React components.
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

// =============================================================================
// Types
// =============================================================================

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
// Hook Implementation
// =============================================================================

export function useKokoroTTS(): UseKokoroTTSReturn {
  // Subscribe to singleton state using useSyncExternalStore for concurrent mode safety
  const state = useSyncExternalStore(subscribeToState, getKokoroState, getKokoroState);

  // Local state for playback
  const [isPlaying, setIsPlaying] = useState(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Get or create audio context
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  // Load the model
  const load = useCallback(async () => {
    if (isKokoroReady()) {
      return;
    }
    await loadKokoroModel();
  }, []);

  // Stop current playback
  const stop = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // Already stopped
      }
      currentSourceRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // Generate and play speech
  const speak = useCallback(
    async (text: string, options: GenerateSpeechOptions = {}) => {
      // Stop any current playback
      stop();

      // Ensure model is loaded
      if (!isKokoroReady()) {
        await loadKokoroModel();
      }

      try {
        // Generate the audio
        const audioBuffer = await generateSpeech(text, options);

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

        source.onended = () => {
          setIsPlaying(false);
          currentSourceRef.current = null;
        };

        source.start(0);
      } catch (err) {
        console.error('[useKokoroTTS] speak() error:', err);
        setIsPlaying(false);
        throw err;
      }
    },
    [stop, getAudioContext]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stop]);

  return {
    status: state.status,
    progress: state.progress,
    error: state.error,
    isReady: state.status === "ready",
    isPlaying,
    load,
    speak,
    stop,
    availableVoices: getAvailableVoices(),
  };
}

export default useKokoroTTS;
