/**
 * TTS Providers Index
 *
 * Exports all TTS provider implementations and factory functions.
 */

export {
  BrowserTTSProvider,
  createBrowserTTSProvider,
  type BrowserTTSConfig,
} from "./browser-tts.js";

import { BrowserTTSProvider } from "./browser-tts.js";
import { TTSService } from "../tts-service.js";

/**
 * Initialize the TTS service with all available providers
 *
 * @param service - The TTS service to initialize
 */
export function initializeTTSProviders(service: TTSService): void {
  // Register Browser TTS provider (default, always available)
  service.registerProvider(new BrowserTTSProvider());

  // Future providers will be registered here:
  // - KokoroTTSProvider (local high-quality TTS)
  // - OpenAITTSProvider (cloud TTS)
}

/**
 * Create a fully initialized TTS service with all providers registered
 *
 * @returns Initialized TTS service
 */
export function createInitializedTTSService(): TTSService {
  const service = new TTSService();
  initializeTTSProviders(service);
  return service;
}
