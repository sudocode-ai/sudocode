/**
 * OpenAI Whisper STT Provider
 *
 * Uses the OpenAI Whisper API as a fallback STT provider.
 * Requires OPENAI_API_KEY environment variable.
 */

import type {
  STTProvider as STTProviderType,
  STTOptions,
  TranscriptionResult,
} from "@sudocode-ai/types/voice";
import type { STTProvider } from "../stt-service.js";

/**
 * Configuration for the OpenAI Whisper provider
 */
export interface OpenAIWhisperConfig {
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Model to use for transcription (default: whisper-1) */
  model: string;
  /** Base URL for the OpenAI API (default: https://api.openai.com/v1) */
  baseUrl: string;
  /** Timeout in milliseconds for requests (default: 60000) */
  timeout: number;
}

/**
 * Error thrown when OpenAI API communication fails
 */
export class OpenAIWhisperError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "OpenAIWhisperError";
  }
}

/**
 * OpenAI Whisper STT Provider
 *
 * Fallback provider using OpenAI's Whisper API.
 */
export class OpenAIWhisperProvider implements STTProvider {
  readonly name: STTProviderType = "openai";
  private config: OpenAIWhisperConfig;

  constructor(config?: Partial<OpenAIWhisperConfig>) {
    this.config = {
      apiKey: config?.apiKey ?? process.env.OPENAI_API_KEY,
      model: config?.model ?? "whisper-1",
      baseUrl: config?.baseUrl ?? "https://api.openai.com/v1",
      timeout: config?.timeout ?? 60000,
    };
  }

  /**
   * Check if the OpenAI API is available (API key is configured)
   */
  async isAvailable(): Promise<boolean> {
    // OpenAI is "available" if we have an API key configured
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;
    return Boolean(apiKey && apiKey.length > 0);
  }

  /**
   * Get the API key, throwing if not configured
   */
  private getApiKey(): string {
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new OpenAIWhisperError(
        "OpenAI API key not configured. Set OPENAI_API_KEY environment variable."
      );
    }
    return apiKey;
  }

  /**
   * Transcribe audio using the OpenAI Whisper API
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
    const apiKey = this.getApiKey();

    // Create form data with the audio file
    const formData = new FormData();

    // Create a Blob from the Buffer
    const audioBlob = new Blob([audio], { type: "audio/webm" });
    formData.set("file", audioBlob, "audio.webm");
    formData.set("model", this.config.model);

    if (options?.language) {
      formData.set("language", options.language);
    }

    // Request verbose JSON to get more details if available
    formData.set("response_format", "verbose_json");

    // Set up request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(
        `${this.config.baseUrl}/audio/transcriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          // FormData is natively supported by fetch in Node.js 18+
          body: formData,
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          (errorData as { error?: { message?: string } })?.error?.message ||
          `HTTP ${response.status}`;
        throw new OpenAIWhisperError(
          `OpenAI API error: ${errorMessage}`,
          response.status
        );
      }

      const data = (await response.json()) as {
        text?: string;
        duration?: number;
      };
      const duration_ms = Date.now() - startTime;

      if (!data.text && data.text !== "") {
        throw new OpenAIWhisperError(
          "Invalid response from OpenAI API: missing text field"
        );
      }

      return {
        text: data.text.trim(),
        duration_ms,
        // OpenAI doesn't provide word-level confidence in the standard API
        // but the transcription quality is generally high
      };
    } catch (error) {
      if (error instanceof OpenAIWhisperError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenAIWhisperError(
          `Request timed out after ${this.config.timeout}ms`
        );
      }

      throw new OpenAIWhisperError(
        `Failed to communicate with OpenAI API: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get the current configuration (without the API key for security)
   */
  getConfig(): Omit<OpenAIWhisperConfig, "apiKey"> & { hasApiKey: boolean } {
    return {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      hasApiKey: Boolean(this.config.apiKey ?? process.env.OPENAI_API_KEY),
    };
  }
}

/**
 * Create a new OpenAI Whisper provider instance
 */
export function createOpenAIWhisperProvider(
  config?: Partial<OpenAIWhisperConfig>
): OpenAIWhisperProvider {
  return new OpenAIWhisperProvider(config);
}
