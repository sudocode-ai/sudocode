/**
 * Unit tests for TTS Service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  TTSService,
  TTSProvider,
  NoTTSProviderError,
  TTSProviderNotFoundError,
  SynthesisError,
  resetTTSService,
  getTTSService,
} from "../../../../src/services/tts-service.js";
import type {
  TTSProvider as TTSProviderType,
  TTSProviderOptions,
  TTSProviderResult,
  TTSVoice,
} from "@sudocode-ai/types/voice";

/**
 * Create a mock TTS provider for testing
 */
function createMockProvider(
  id: TTSProviderType,
  options?: {
    available?: boolean;
    synthesizeResult?: TTSProviderResult;
    synthesizeError?: Error;
    voices?: TTSVoice[];
  }
): TTSProvider {
  const available = options?.available ?? true;
  const result = options?.synthesizeResult ?? {
    text: `Synthesized by ${id}`,
    provider: id,
  };
  const voices = options?.voices ?? [
    { id: "default", name: "Default Voice", language: "en-US", provider: id },
  ];

  return {
    id,
    name: `${id} Provider`,
    isAvailable: vi.fn().mockResolvedValue(available),
    synthesize: options?.synthesizeError
      ? vi.fn().mockRejectedValue(options.synthesizeError)
      : vi.fn().mockResolvedValue(result),
    getVoices: vi.fn().mockResolvedValue(voices),
  };
}

describe("TTSService", () => {
  let service: TTSService;

  beforeEach(() => {
    resetTTSService();
    service = new TTSService();
  });

  afterEach(() => {
    resetTTSService();
  });

  describe("initialization", () => {
    it("should initialize with default configuration", () => {
      const config = service.getConfig();
      expect(config.defaultProvider).toBe("browser");
      expect(config.kokoroUrl).toBe("http://localhost:8880/v1");
      expect(config.defaultVoice).toBe("nova");
    });

    it("should initialize with custom configuration", () => {
      const customService = new TTSService({
        defaultProvider: "openai",
        kokoroUrl: "http://custom:9000/v1",
        defaultVoice: "alloy",
      });

      const config = customService.getConfig();
      expect(config.defaultProvider).toBe("openai");
      expect(config.kokoroUrl).toBe("http://custom:9000/v1");
      expect(config.defaultVoice).toBe("alloy");
    });

    it("should start with no providers registered", async () => {
      const providers = await service.getAvailableProviders();
      expect(providers).toHaveLength(0);
    });
  });

  describe("provider registration", () => {
    it("should register a provider", () => {
      const mockProvider = createMockProvider("browser");
      service.registerProvider(mockProvider);

      const provider = service.getProvider("browser");
      expect(provider).toBeDefined();
      expect(provider?.id).toBe("browser");
    });

    it("should unregister a provider", () => {
      const mockProvider = createMockProvider("browser");
      service.registerProvider(mockProvider);

      service.unregisterProvider("browser");

      const provider = service.getProvider("browser");
      expect(provider).toBeUndefined();
    });

    it("should handle registering multiple providers", async () => {
      const browserProvider = createMockProvider("browser");
      const kokoroProvider = createMockProvider("kokoro");

      service.registerProvider(browserProvider);
      service.registerProvider(kokoroProvider);

      const providers = await service.getAvailableProviders();
      expect(providers).toHaveLength(2);
      expect(providers).toContain("browser");
      expect(providers).toContain("kokoro");
    });

    it("should list registered providers", () => {
      const browserProvider = createMockProvider("browser");
      const kokoroProvider = createMockProvider("kokoro");

      service.registerProvider(browserProvider);
      service.registerProvider(kokoroProvider);

      const registered = service.getRegisteredProviders();
      expect(registered).toHaveLength(2);
      expect(registered).toContain("browser");
      expect(registered).toContain("kokoro");
    });
  });

  describe("getDefaultProvider", () => {
    it("should return the configured default provider", () => {
      expect(service.getDefaultProvider()).toBe("browser");
    });

    it("should return custom default provider", () => {
      const customService = new TTSService({ defaultProvider: "kokoro" });
      expect(customService.getDefaultProvider()).toBe("kokoro");
    });
  });

  describe("isProviderAvailable", () => {
    it("should return false for unregistered provider", async () => {
      const available = await service.isProviderAvailable("browser");
      expect(available).toBe(false);
    });

    it("should return true for available provider", async () => {
      const mockProvider = createMockProvider("browser", { available: true });
      service.registerProvider(mockProvider);

      const available = await service.isProviderAvailable("browser");
      expect(available).toBe(true);
    });

    it("should return false for unavailable provider", async () => {
      const mockProvider = createMockProvider("browser", { available: false });
      service.registerProvider(mockProvider);

      const available = await service.isProviderAvailable("browser");
      expect(available).toBe(false);
    });

    it("should cache availability results", async () => {
      const mockProvider = createMockProvider("browser");
      service.registerProvider(mockProvider);

      // First call
      await service.isProviderAvailable("browser");
      // Second call (should use cache)
      await service.isProviderAvailable("browser");

      expect(mockProvider.isAvailable).toHaveBeenCalledTimes(1);
    });

    it("should handle errors when checking availability", async () => {
      const mockProvider = createMockProvider("browser");
      (mockProvider.isAvailable as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Connection failed")
      );
      service.registerProvider(mockProvider);

      const available = await service.isProviderAvailable("browser");
      expect(available).toBe(false);
    });
  });

  describe("getAvailableProviders", () => {
    it("should return empty array when no providers registered", async () => {
      const providers = await service.getAvailableProviders();
      expect(providers).toEqual([]);
    });

    it("should return only available providers", async () => {
      const browserProvider = createMockProvider("browser", { available: true });
      const kokoroProvider = createMockProvider("kokoro", { available: false });

      service.registerProvider(browserProvider);
      service.registerProvider(kokoroProvider);

      const providers = await service.getAvailableProviders();
      expect(providers).toEqual(["browser"]);
    });
  });

  describe("synthesize", () => {
    it("should synthesize using the preferred provider", async () => {
      const mockProvider = createMockProvider("browser", {
        synthesizeResult: { text: "Hello world", provider: "browser" },
      });
      service.registerProvider(mockProvider);

      const result = await service.synthesize("Hello world");

      expect(result.text).toBe("Hello world");
      expect(result.provider).toBe("browser");
    });

    it("should use options when synthesizing", async () => {
      const mockProvider = createMockProvider("browser");
      service.registerProvider(mockProvider);

      const options: TTSProviderOptions = { voice: "nova", speed: 1.5, pitch: 1.0 };
      await service.synthesize("Hello", options);

      expect(mockProvider.synthesize).toHaveBeenCalledWith("Hello", options);
    });

    it("should use specified preferred provider", async () => {
      const browserProvider = createMockProvider("browser", {
        synthesizeResult: { text: "Browser result", provider: "browser" },
      });
      const kokoroProvider = createMockProvider("kokoro", {
        synthesizeResult: { text: "Kokoro result", provider: "kokoro" },
      });

      service.registerProvider(browserProvider);
      service.registerProvider(kokoroProvider);

      const result = await service.synthesize("Hello", undefined, "kokoro");

      expect(result.text).toBe("Kokoro result");
      expect(result.provider).toBe("kokoro");
    });

    it("should fallback to another provider when preferred fails", async () => {
      const failingProvider = createMockProvider("browser", {
        synthesizeError: new Error("Browser failed"),
      });
      const workingProvider = createMockProvider("kokoro", {
        synthesizeResult: { text: "Fallback result", provider: "kokoro" },
      });

      service.registerProvider(failingProvider);
      service.registerProvider(workingProvider);

      const result = await service.synthesize("Hello");

      expect(result.text).toBe("Fallback result");
      expect(result.provider).toBe("kokoro");
    });

    it("should throw NoTTSProviderError when no providers available", async () => {
      await expect(service.synthesize("Hello")).rejects.toThrow(NoTTSProviderError);
    });

    it("should throw SynthesisError when all providers fail", async () => {
      const failingProvider1 = createMockProvider("browser", {
        synthesizeError: new Error("Browser failed"),
      });
      const failingProvider2 = createMockProvider("kokoro", {
        synthesizeError: new Error("Kokoro failed"),
      });

      service.registerProvider(failingProvider1);
      service.registerProvider(failingProvider2);

      await expect(service.synthesize("Hello")).rejects.toThrow(SynthesisError);
    });

    it("should skip unavailable providers", async () => {
      const unavailableProvider = createMockProvider("browser", {
        available: false,
      });
      const availableProvider = createMockProvider("kokoro", {
        available: true,
        synthesizeResult: { text: "Success", provider: "kokoro" },
      });

      service.registerProvider(unavailableProvider);
      service.registerProvider(availableProvider);

      const result = await service.synthesize("Hello");

      expect(result.text).toBe("Success");
      expect(unavailableProvider.synthesize).not.toHaveBeenCalled();
    });

    it("should invalidate cache when provider fails", async () => {
      const mockProvider = createMockProvider("browser", {
        synthesizeError: new Error("Failed"),
      });
      service.registerProvider(mockProvider);

      // Mark as available initially
      await service.isProviderAvailable("browser");

      try {
        await service.synthesize("Hello");
      } catch {
        // Expected to fail
      }

      // Cache should be cleared, next availability check should call isAvailable again
      service.clearAvailabilityCache();
      await service.isProviderAvailable("browser");

      expect(mockProvider.isAvailable).toHaveBeenCalledTimes(2);
    });
  });

  describe("voice listing", () => {
    it("should get all voices from available providers", async () => {
      const browserProvider = createMockProvider("browser", {
        voices: [
          { id: "default", name: "Default", language: "en-US", provider: "browser" },
        ],
      });
      const kokoroProvider = createMockProvider("kokoro", {
        voices: [
          { id: "af_sky", name: "Sky", language: "en-US", provider: "kokoro" },
          { id: "af_bella", name: "Bella", language: "en-US", provider: "kokoro" },
        ],
      });

      service.registerProvider(browserProvider);
      service.registerProvider(kokoroProvider);

      const voices = await service.getAllVoices();

      expect(voices).toHaveLength(3);
      expect(voices.map((v) => v.id)).toContain("default");
      expect(voices.map((v) => v.id)).toContain("af_sky");
      expect(voices.map((v) => v.id)).toContain("af_bella");
    });

    it("should skip unavailable providers when getting voices", async () => {
      const unavailableProvider = createMockProvider("browser", {
        available: false,
        voices: [{ id: "default", name: "Default", language: "en-US", provider: "browser" }],
      });
      const availableProvider = createMockProvider("kokoro", {
        available: true,
        voices: [{ id: "af_sky", name: "Sky", language: "en-US", provider: "kokoro" }],
      });

      service.registerProvider(unavailableProvider);
      service.registerProvider(availableProvider);

      const voices = await service.getAllVoices();

      expect(voices).toHaveLength(1);
      expect(voices[0].id).toBe("af_sky");
    });

    it("should get voices for specific provider", async () => {
      const browserProvider = createMockProvider("browser", {
        voices: [
          { id: "default", name: "Default", language: "en-US", provider: "browser" },
        ],
      });
      service.registerProvider(browserProvider);

      const voices = await service.getVoicesForProvider("browser");

      expect(voices).toHaveLength(1);
      expect(voices[0].id).toBe("default");
    });

    it("should throw TTSProviderNotFoundError for unknown provider", async () => {
      await expect(service.getVoicesForProvider("unknown" as TTSProviderType)).rejects.toThrow(
        TTSProviderNotFoundError
      );
    });

    it("should return empty array if provider has no getVoices method", async () => {
      const providerWithoutVoices: TTSProvider = {
        id: "browser",
        name: "Browser Provider",
        isAvailable: vi.fn().mockResolvedValue(true),
        synthesize: vi.fn().mockResolvedValue({ text: "Hello", provider: "browser" }),
        // No getVoices method
      };
      service.registerProvider(providerWithoutVoices);

      const voices = await service.getVoicesForProvider("browser");

      expect(voices).toEqual([]);
    });
  });

  describe("clearAvailabilityCache", () => {
    it("should clear the cache", async () => {
      const mockProvider = createMockProvider("browser");
      service.registerProvider(mockProvider);

      await service.isProviderAvailable("browser");
      service.clearAvailabilityCache();
      await service.isProviderAvailable("browser");

      expect(mockProvider.isAvailable).toHaveBeenCalledTimes(2);
    });
  });

  describe("getTTSService singleton", () => {
    it("should return the same instance", () => {
      const instance1 = getTTSService();
      const instance2 = getTTSService();

      expect(instance1).toBe(instance2);
    });

    it("should return new instance after reset", () => {
      const instance1 = getTTSService();
      resetTTSService();
      const instance2 = getTTSService();

      expect(instance1).not.toBe(instance2);
    });
  });
});

describe("Error classes", () => {
  describe("NoTTSProviderError", () => {
    it("should have correct name and message", () => {
      const error = new NoTTSProviderError();
      expect(error.name).toBe("NoTTSProviderError");
      expect(error.message).toBe("No TTS providers are available");
    });
  });

  describe("TTSProviderNotFoundError", () => {
    it("should have correct name and message", () => {
      const error = new TTSProviderNotFoundError("kokoro");
      expect(error.name).toBe("TTSProviderNotFoundError");
      expect(error.message).toBe("TTS provider 'kokoro' not found");
    });
  });

  describe("SynthesisError", () => {
    it("should have correct name, message, and provider", () => {
      const cause = new Error("Original error");
      const error = new SynthesisError("Synthesis failed", "browser", cause);

      expect(error.name).toBe("SynthesisError");
      expect(error.message).toBe("Synthesis failed");
      expect(error.provider).toBe("browser");
      expect(error.cause).toBe(cause);
    });
  });
});
