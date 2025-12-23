/**
 * Text-to-Speech Service
 *
 * Provides a pluggable TTS abstraction with multiple provider support.
 * Handles provider selection, fallback, voice listing, and availability checking.
 */

import type {
  TTSProvider as TTSProviderType,
  TTSProviderOptions,
  TTSProviderResult,
  TTSVoice,
} from "@sudocode-ai/types/voice";

/**
 * Interface for TTS providers
 */
export interface TTSProvider {
  /** Provider identifier */
  readonly id: TTSProviderType;

  /** Human-readable provider name */
  readonly name: string;

  /**
   * Synthesize text to speech
   *
   * @param text - Text to synthesize
   * @param options - Optional synthesis options
   * @returns Promise resolving to synthesis result
   */
  synthesize(text: string, options?: TTSProviderOptions): Promise<TTSProviderResult>;

  /**
   * Check if this provider is currently available
   * (e.g., service is running, API key is configured)
   *
   * @returns Promise resolving to true if provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get available voices for this provider
   * Optional - not all providers support voice listing
   *
   * @returns Promise resolving to array of available voices
   */
  getVoices?(): Promise<TTSVoice[]>;
}

/**
 * Configuration for the TTS service
 */
export interface TTSServiceConfig {
  /** Default provider to use when none specified */
  defaultProvider: TTSProviderType;
  /** Kokoro server URL for local TTS */
  kokoroUrl: string;
  /** Default voice to use */
  defaultVoice: string;
}

/**
 * Get TTS configuration from environment variables
 */
export function getTTSConfig(): TTSServiceConfig {
  return {
    defaultProvider:
      (process.env.VOICE_TTS_PROVIDER as TTSProviderType) || "browser",
    kokoroUrl: process.env.VOICE_KOKORO_URL || "http://localhost:8880/v1",
    defaultVoice: process.env.VOICE_TTS_VOICE || "nova",
  };
}

/**
 * Error thrown when no TTS providers are available
 */
export class NoTTSProviderError extends Error {
  constructor() {
    super("No TTS providers are available");
    this.name = "NoTTSProviderError";
  }
}

/**
 * Error thrown when a specific provider is not found
 */
export class TTSProviderNotFoundError extends Error {
  constructor(providerName: string) {
    super(`TTS provider '${providerName}' not found`);
    this.name = "TTSProviderNotFoundError";
  }
}

/**
 * Error thrown when synthesis fails
 */
export class SynthesisError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "SynthesisError";
  }
}

/**
 * Text-to-Speech Service
 *
 * Manages multiple TTS providers with automatic fallback support.
 */
export class TTSService {
  private providers: Map<TTSProviderType, TTSProvider> = new Map();
  private config: TTSServiceConfig;
  private availabilityCache: Map<TTSProviderType, boolean> = new Map();
  private availabilityCacheTime: Map<TTSProviderType, number> = new Map();
  private readonly CACHE_TTL_MS = 30000; // 30 seconds

  constructor(config?: Partial<TTSServiceConfig>) {
    this.config = { ...getTTSConfig(), ...config };
  }

  /**
   * Register a TTS provider
   *
   * @param provider - The provider to register
   */
  registerProvider(provider: TTSProvider): void {
    this.providers.set(provider.id, provider);
    // Invalidate availability cache when a new provider is registered
    this.availabilityCache.delete(provider.id);
    this.availabilityCacheTime.delete(provider.id);
  }

  /**
   * Unregister a TTS provider
   *
   * @param providerId - ID of the provider to unregister
   */
  unregisterProvider(providerId: TTSProviderType): void {
    this.providers.delete(providerId);
    this.availabilityCache.delete(providerId);
    this.availabilityCacheTime.delete(providerId);
  }

  /**
   * Get a provider by ID
   *
   * @param providerId - ID of the provider
   * @returns The provider if found
   */
  getProvider(providerId: TTSProviderType): TTSProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Check if a provider's availability is cached and still valid
   */
  private isCacheValid(providerId: TTSProviderType): boolean {
    const cacheTime = this.availabilityCacheTime.get(providerId);
    if (!cacheTime) return false;
    return Date.now() - cacheTime < this.CACHE_TTL_MS;
  }

  /**
   * Check if a provider is available (with caching)
   *
   * @param providerId - ID of the provider to check
   * @returns Promise resolving to true if available
   */
  async isProviderAvailable(providerId: TTSProviderType): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider) return false;

    // Check cache first
    if (this.isCacheValid(providerId)) {
      return this.availabilityCache.get(providerId) ?? false;
    }

    // Check actual availability
    try {
      const available = await provider.isAvailable();
      this.availabilityCache.set(providerId, available);
      this.availabilityCacheTime.set(providerId, Date.now());
      return available;
    } catch {
      this.availabilityCache.set(providerId, false);
      this.availabilityCacheTime.set(providerId, Date.now());
      return false;
    }
  }

  /**
   * Get all available providers (those that are registered and currently available)
   *
   * @returns Promise resolving to array of available provider IDs
   */
  async getAvailableProviders(): Promise<TTSProviderType[]> {
    const availableProviders: TTSProviderType[] = [];

    for (const providerId of this.providers.keys()) {
      if (await this.isProviderAvailable(providerId)) {
        availableProviders.push(providerId);
      }
    }

    return availableProviders;
  }

  /**
   * Get all registered provider IDs
   *
   * @returns Array of registered provider IDs
   */
  getRegisteredProviders(): TTSProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get the default provider ID from configuration
   *
   * @returns The default provider ID
   */
  getDefaultProvider(): TTSProviderType {
    return this.config.defaultProvider;
  }

  /**
   * Get the configuration
   *
   * @returns The current configuration
   */
  getConfig(): TTSServiceConfig {
    return { ...this.config };
  }

  /**
   * Clear the availability cache
   */
  clearAvailabilityCache(): void {
    this.availabilityCache.clear();
    this.availabilityCacheTime.clear();
  }

  /**
   * Get all available voices across all available providers
   *
   * @returns Promise resolving to array of voices from all providers
   */
  async getAllVoices(): Promise<TTSVoice[]> {
    const allVoices: TTSVoice[] = [];

    for (const [providerId, provider] of this.providers) {
      if (!(await this.isProviderAvailable(providerId))) {
        continue;
      }

      if (provider.getVoices) {
        try {
          const voices = await provider.getVoices();
          allVoices.push(...voices);
        } catch {
          // If voice listing fails, skip this provider
        }
      }
    }

    return allVoices;
  }

  /**
   * Get voices for a specific provider
   *
   * @param providerId - ID of the provider
   * @returns Promise resolving to array of voices
   */
  async getVoicesForProvider(providerId: TTSProviderType): Promise<TTSVoice[]> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new TTSProviderNotFoundError(providerId);
    }

    if (!provider.getVoices) {
      return [];
    }

    return provider.getVoices();
  }

  /**
   * Synthesize text using the specified or default provider
   *
   * Falls back to other available providers if the preferred one fails.
   *
   * @param text - Text to synthesize
   * @param options - Optional synthesis options
   * @param preferredProvider - Preferred provider ID (uses default if not specified)
   * @returns Promise resolving to synthesis result
   * @throws {NoTTSProviderError} If no providers are available
   * @throws {SynthesisError} If synthesis fails on all providers
   */
  async synthesize(
    text: string,
    options?: TTSProviderOptions,
    preferredProvider?: TTSProviderType
  ): Promise<TTSProviderResult> {
    const providerToUse = preferredProvider || this.config.defaultProvider;

    // Build provider order: preferred first, then others
    const providerOrder: TTSProviderType[] = [providerToUse];
    for (const providerId of this.providers.keys()) {
      if (providerId !== providerToUse) {
        providerOrder.push(providerId);
      }
    }

    const errors: Array<{ provider: string; error: Error }> = [];

    for (const providerId of providerOrder) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      // Check availability
      if (!(await this.isProviderAvailable(providerId))) {
        continue;
      }

      try {
        const result = await provider.synthesize(text, options);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ provider: providerId, error: err });
        // Invalidate cache for this provider since it failed
        this.availabilityCache.delete(providerId);
        this.availabilityCacheTime.delete(providerId);
        // Continue to next provider
      }
    }

    // If we get here, all providers failed
    if (errors.length === 0) {
      throw new NoTTSProviderError();
    }

    const lastError = errors[errors.length - 1];
    throw new SynthesisError(
      `Synthesis failed on all providers. Last error: ${lastError.error.message}`,
      lastError.provider,
      lastError.error
    );
  }
}

/**
 * Global TTS service instance
 * Lazy-initialized on first use
 */
let ttsServiceInstance: TTSService | null = null;

/**
 * Get or create the global TTS service instance
 *
 * @param config - Optional configuration override
 * @returns The TTS service instance
 */
export function getTTSService(config?: Partial<TTSServiceConfig>): TTSService {
  if (!ttsServiceInstance) {
    ttsServiceInstance = new TTSService(config);
  }
  return ttsServiceInstance;
}

/**
 * Reset the global TTS service instance (for testing)
 */
export function resetTTSService(): void {
  ttsServiceInstance = null;
}
