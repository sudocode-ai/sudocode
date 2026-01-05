/**
 * STT Providers Index
 *
 * Exports all STT provider implementations and factory functions.
 */

export {
  WhisperLocalProvider,
  createWhisperLocalProvider,
  WhisperServerError,
  type WhisperLocalConfig,
} from "./whisper-local.js";

export {
  OpenAIWhisperProvider,
  createOpenAIWhisperProvider,
  OpenAIWhisperError,
  type OpenAIWhisperConfig,
} from "./openai-whisper.js";

import { WhisperLocalProvider } from "./whisper-local.js";
import { OpenAIWhisperProvider } from "./openai-whisper.js";
import { STTService } from "../stt-service.js";

/**
 * Initialize the STT service with all available providers
 *
 * @param service - The STT service to initialize
 */
export function initializeSTTProviders(service: STTService): void {
  // Register Whisper local provider (preferred)
  service.registerProvider(new WhisperLocalProvider());

  // Register OpenAI Whisper provider (fallback)
  service.registerProvider(new OpenAIWhisperProvider());
}

/**
 * Create a fully initialized STT service with all providers registered
 *
 * @returns Initialized STT service
 */
export function createInitializedSTTService(): STTService {
  const service = new STTService();
  initializeSTTProviders(service);
  return service;
}
