/**
 * Browser TTS Provider
 *
 * A placeholder provider for browser-based TTS using the Web Speech API.
 * This provider doesn't actually synthesize audio server-side - instead it
 * returns the text for the client to synthesize using the Web Speech API.
 *
 * This approach has several advantages:
 * - Zero server-side cost
 * - Instant response (no audio to generate/stream)
 * - Works offline (no network latency)
 * - Uses system voices already installed on user's device
 */

import type {
  TTSProvider as TTSProviderType,
  TTSProviderOptions,
  TTSProviderResult,
  TTSVoice,
} from "@sudocode-ai/types/voice";
import { type TTSProvider } from "../tts-service.js";

/**
 * Configuration for the Browser TTS provider
 */
export interface BrowserTTSConfig {
  /** Default language code for voice listing */
  defaultLanguage: string;
}

/**
 * Browser TTS Provider
 *
 * Returns text for client-side Web Speech API synthesis.
 * The actual speech synthesis happens in the browser.
 */
export class BrowserTTSProvider implements TTSProvider {
  readonly id: TTSProviderType = "browser";
  readonly name: string = "Browser (Web Speech API)";
  private config: BrowserTTSConfig;

  constructor(config?: Partial<BrowserTTSConfig>) {
    this.config = {
      defaultLanguage: config?.defaultLanguage ?? "en-US",
    };
  }

  /**
   * Browser TTS is always available on the server side
   * (actual availability depends on client browser support)
   */
  async isAvailable(): Promise<boolean> {
    // Browser TTS is always "available" server-side since we just
    // return text for the client to handle. The client determines
    // actual availability based on Web Speech API support.
    return true;
  }

  /**
   * Return text for client-side synthesis
   *
   * @param text - Text to synthesize
   * @param _options - Synthesis options (used client-side)
   * @returns Result with text for client synthesis
   */
  async synthesize(
    text: string,
    _options?: TTSProviderOptions
  ): Promise<TTSProviderResult> {
    // For browser TTS, we simply return the text.
    // The client will use the Web Speech API to synthesize it.
    // Options (voice, speed, pitch) are handled client-side.
    return {
      text,
      // No audio buffer - client synthesizes
      // No SSML - Web Speech API has limited SSML support
    };
  }

  /**
   * Get available voices
   *
   * Since voices are determined by the client's browser, we return
   * a generic placeholder. The frontend should query actual voices
   * from window.speechSynthesis.getVoices() directly.
   */
  async getVoices(): Promise<TTSVoice[]> {
    // Return a placeholder voice indicating client-side determination
    // The actual voice list is populated by the frontend from the
    // browser's speechSynthesis.getVoices() API
    return [
      {
        id: "default",
        name: "System Default",
        language: this.config.defaultLanguage,
        provider: "browser",
      },
    ];
  }

  /**
   * Get the current configuration
   */
  getConfig(): BrowserTTSConfig {
    return { ...this.config };
  }
}

/**
 * Create a new Browser TTS provider instance
 */
export function createBrowserTTSProvider(
  config?: Partial<BrowserTTSConfig>
): BrowserTTSProvider {
  return new BrowserTTSProvider(config);
}
