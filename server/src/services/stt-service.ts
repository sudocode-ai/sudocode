/**
 * Speech-to-Text Service
 *
 * Provides a pluggable STT abstraction with multiple provider support.
 * Handles provider selection, fallback, and availability checking.
 */

import type {
  STTProvider as STTProviderType,
  STTOptions,
  TranscriptionResult,
  VoiceSettingsConfig,
} from "@sudocode-ai/types/voice";

/**
 * Interface for STT providers
 */
export interface STTProvider {
  /** Provider name */
  readonly name: STTProviderType;

  /**
   * Transcribe audio buffer to text
   *
   * @param audio - Audio buffer to transcribe
   * @param options - Optional transcription options
   * @returns Promise resolving to transcription result
   */
  transcribe(audio: Buffer, options?: STTOptions): Promise<TranscriptionResult>;

  /**
   * Check if this provider is currently available
   * (e.g., service is running, API key is configured)
   *
   * @returns Promise resolving to true if provider is available
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Configuration for the STT service
 */
export interface STTServiceConfig {
  /** Default provider to use when none specified */
  defaultProvider: STTProviderType;
  /** Whisper server URL for local provider */
  whisperUrl: string;
  /** Whisper model to use */
  whisperModel: string;
}

/**
 * Get STT configuration from project config.
 *
 * All settings come from .sudocode/config.json voice.stt.* with defaults:
 * - provider: "whisper-local"
 * - whisperUrl: "http://localhost:2022/v1"
 * - whisperModel: "base"
 *
 * @param projectVoiceConfig - Optional project voice settings from config.json
 */
export function getSTTConfig(
  projectVoiceConfig?: VoiceSettingsConfig
): STTServiceConfig {
  const sttSettings = projectVoiceConfig?.stt;

  return {
    defaultProvider: sttSettings?.provider || "whisper-local",
    whisperUrl: sttSettings?.whisperUrl || "http://localhost:2022/v1",
    whisperModel: sttSettings?.whisperModel || "base",
  };
}

/**
 * Error thrown when no STT providers are available
 */
export class NoSTTProviderError extends Error {
  constructor() {
    super("No STT providers are available");
    this.name = "NoSTTProviderError";
  }
}

/**
 * Error thrown when a specific provider is not found
 */
export class STTProviderNotFoundError extends Error {
  constructor(providerName: string) {
    super(`STT provider '${providerName}' not found`);
    this.name = "STTProviderNotFoundError";
  }
}

/**
 * Error thrown when transcription fails
 */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

/**
 * Speech-to-Text Service
 *
 * Manages multiple STT providers with automatic fallback support.
 */
export class STTService {
  private providers: Map<STTProviderType, STTProvider> = new Map();
  private config: STTServiceConfig;
  private availabilityCache: Map<STTProviderType, boolean> = new Map();
  private availabilityCacheTime: Map<STTProviderType, number> = new Map();
  private readonly CACHE_TTL_MS = 30000; // 30 seconds

  constructor(config?: Partial<STTServiceConfig>) {
    this.config = { ...getSTTConfig(), ...config };
  }

  /**
   * Register an STT provider
   *
   * @param provider - The provider to register
   */
  registerProvider(provider: STTProvider): void {
    this.providers.set(provider.name, provider);
    // Invalidate availability cache when a new provider is registered
    this.availabilityCache.delete(provider.name);
    this.availabilityCacheTime.delete(provider.name);
  }

  /**
   * Unregister an STT provider
   *
   * @param providerName - Name of the provider to unregister
   */
  unregisterProvider(providerName: STTProviderType): void {
    this.providers.delete(providerName);
    this.availabilityCache.delete(providerName);
    this.availabilityCacheTime.delete(providerName);
  }

  /**
   * Get a provider by name
   *
   * @param providerName - Name of the provider
   * @returns The provider if found
   */
  getProvider(providerName: STTProviderType): STTProvider | undefined {
    return this.providers.get(providerName);
  }

  /**
   * Check if a provider's availability is cached and still valid
   */
  private isCacheValid(providerName: STTProviderType): boolean {
    const cacheTime = this.availabilityCacheTime.get(providerName);
    if (!cacheTime) return false;
    return Date.now() - cacheTime < this.CACHE_TTL_MS;
  }

  /**
   * Check if a provider is available (with caching)
   *
   * @param providerName - Name of the provider to check
   * @returns Promise resolving to true if available
   */
  async isProviderAvailable(providerName: STTProviderType): Promise<boolean> {
    const provider = this.providers.get(providerName);
    if (!provider) return false;

    // Check cache first
    if (this.isCacheValid(providerName)) {
      return this.availabilityCache.get(providerName) ?? false;
    }

    // Check actual availability
    try {
      const available = await provider.isAvailable();
      this.availabilityCache.set(providerName, available);
      this.availabilityCacheTime.set(providerName, Date.now());
      return available;
    } catch {
      this.availabilityCache.set(providerName, false);
      this.availabilityCacheTime.set(providerName, Date.now());
      return false;
    }
  }

  /**
   * Get all available providers (those that are registered and currently available)
   *
   * @returns Promise resolving to array of available provider names
   */
  async getAvailableProviders(): Promise<STTProviderType[]> {
    const availableProviders: STTProviderType[] = [];

    for (const providerName of this.providers.keys()) {
      if (await this.isProviderAvailable(providerName)) {
        availableProviders.push(providerName);
      }
    }

    return availableProviders;
  }

  /**
   * Get the default provider name from configuration
   *
   * @returns The default provider name
   */
  getDefaultProvider(): STTProviderType {
    return this.config.defaultProvider;
  }

  /**
   * Get the configuration
   *
   * @returns The current configuration
   */
  getConfig(): STTServiceConfig {
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
   * Transcribe audio using the specified or default provider
   *
   * Falls back to other available providers if the preferred one fails.
   *
   * @param audio - Audio buffer to transcribe
   * @param options - Optional transcription options (can include preferred provider)
   * @returns Promise resolving to transcription result
   * @throws {NoSTTProviderError} If no providers are available
   * @throws {TranscriptionError} If transcription fails on all providers
   */
  async transcribe(
    audio: Buffer,
    options?: STTOptions
  ): Promise<TranscriptionResult> {
    const preferredProvider = options?.provider || this.config.defaultProvider;

    // Build provider order: preferred first, then others
    const providerOrder: STTProviderType[] = [preferredProvider];
    for (const providerName of this.providers.keys()) {
      if (providerName !== preferredProvider) {
        providerOrder.push(providerName);
      }
    }

    const errors: Array<{ provider: string; error: Error }> = [];

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      // Check availability
      if (!(await this.isProviderAvailable(providerName))) {
        continue;
      }

      try {
        const result = await provider.transcribe(audio, options);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ provider: providerName, error: err });
        // Invalidate cache for this provider since it failed
        this.availabilityCache.delete(providerName);
        this.availabilityCacheTime.delete(providerName);
        // Continue to next provider
      }
    }

    // If we get here, all providers failed
    if (errors.length === 0) {
      throw new NoSTTProviderError();
    }

    const lastError = errors[errors.length - 1];
    throw new TranscriptionError(
      `Transcription failed on all providers. Last error: ${lastError.error.message}`,
      lastError.provider,
      lastError.error
    );
  }
}

/**
 * Global STT service instance
 * Lazy-initialized on first use
 */
let sttServiceInstance: STTService | null = null;

/**
 * Get or create the global STT service instance
 *
 * @param config - Optional configuration override
 * @returns The STT service instance
 */
export function getSTTService(config?: Partial<STTServiceConfig>): STTService {
  if (!sttServiceInstance) {
    sttServiceInstance = new STTService(config);
  }
  return sttServiceInstance;
}

/**
 * Reset the global STT service instance (for testing)
 */
export function resetSTTService(): void {
  sttServiceInstance = null;
}
