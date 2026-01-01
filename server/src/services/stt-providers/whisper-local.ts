/**
 * Whisper Local STT Provider
 *
 * Connects to a local Whisper server (whisper.cpp or similar) that exposes
 * an OpenAI-compatible API. Default endpoint: http://localhost:2022/v1
 */

import type {
  STTProvider as STTProviderType,
  STTOptions,
  TranscriptionResult,
} from "@sudocode-ai/types/voice";
import { getSTTConfig, type STTProvider } from "../stt-service.js";

/**
 * Configuration for the Whisper local provider
 */
export interface WhisperLocalConfig {
  /** Base URL for the Whisper server (default: http://localhost:2022/v1) */
  baseUrl: string;
  /** Model to use for transcription (default: base) */
  model: string;
  /** Timeout in milliseconds for requests (default: 30000) */
  timeout: number;
}

/**
 * Error thrown when Whisper server communication fails
 */
export class WhisperServerError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "WhisperServerError";
  }
}

/**
 * Whisper Local STT Provider
 *
 * Uses a local Whisper server with OpenAI-compatible API format.
 */
export class WhisperLocalProvider implements STTProvider {
  readonly name: STTProviderType = "whisper-local";
  private config: WhisperLocalConfig;
  private lastHealthCheck: { time: number; available: boolean } | null = null;
  private readonly HEALTH_CHECK_TTL_MS = 10000; // 10 seconds

  constructor(config?: Partial<WhisperLocalConfig>) {
    const sttConfig = getSTTConfig();
    this.config = {
      baseUrl: config?.baseUrl ?? sttConfig.whisperUrl,
      model: config?.model ?? sttConfig.whisperModel,
      timeout: config?.timeout ?? 30000,
    };
  }

  /**
   * Check if the Whisper server is available by making a health check request
   */
  async isAvailable(): Promise<boolean> {
    // Check cache first
    if (
      this.lastHealthCheck &&
      Date.now() - this.lastHealthCheck.time < this.HEALTH_CHECK_TTL_MS
    ) {
      return this.lastHealthCheck.available;
    }

    try {
      // Try to hit the models endpoint (OpenAI-compatible servers usually have this)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${this.config.baseUrl}/models`, {
          method: "GET",
          signal: controller.signal,
        });

        const available = response.ok;
        this.lastHealthCheck = { time: Date.now(), available };
        return available;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      // If models endpoint doesn't exist, try a simple connection test
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          // Try the base URL - some servers respond with info at root
          const response = await fetch(this.config.baseUrl, {
            method: "GET",
            signal: controller.signal,
          });

          // Consider available if we get any response (even 404 means server is running)
          const available = response.status < 500;
          this.lastHealthCheck = { time: Date.now(), available };
          return available;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        this.lastHealthCheck = { time: Date.now(), available: false };
        return false;
      }
    }
  }

  /**
   * Transcribe audio using the local Whisper server
   *
   * @param audio - Audio buffer to transcribe
   * @param options - Transcription options
   * @returns Transcription result
   */
  async transcribe(
    audio: Buffer,
    options?: STTOptions
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // Create form data with the audio file
    const formData = new FormData();

    // Create a Blob from the Buffer
    const audioBlob = new Blob([audio], { type: "audio/webm" });
    formData.set("file", audioBlob, "audio.webm");
    formData.set("model", this.config.model);

    if (options?.language) {
      formData.set("language", options.language);
    }

    // Set up request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(
        `${this.config.baseUrl}/audio/transcriptions`,
        {
          method: "POST",
          // FormData is natively supported by fetch in Node.js 18+
          body: formData,
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new WhisperServerError(
          `Whisper server error: ${errorText}`,
          response.status
        );
      }

      const data = (await response.json()) as { text?: string };
      const duration_ms = Date.now() - startTime;

      if (!data.text && data.text !== "") {
        throw new WhisperServerError(
          "Invalid response from Whisper server: missing text field"
        );
      }

      return {
        text: data.text.trim(),
        duration_ms,
        // Local Whisper typically doesn't provide confidence scores
      };
    } catch (error) {
      if (error instanceof WhisperServerError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new WhisperServerError(
          `Request timed out after ${this.config.timeout}ms`
        );
      }

      throw new WhisperServerError(
        `Failed to communicate with Whisper server: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): WhisperLocalConfig {
    return { ...this.config };
  }

  /**
   * Clear the health check cache
   */
  clearHealthCache(): void {
    this.lastHealthCheck = null;
  }
}

/**
 * Create a new Whisper local provider instance
 */
export function createWhisperLocalProvider(
  config?: Partial<WhisperLocalConfig>
): WhisperLocalProvider {
  return new WhisperLocalProvider(config);
}
