/**
 * Unit tests for STT Service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  STTService,
  STTProvider,
  NoSTTProviderError,
  STTProviderNotFoundError,
  TranscriptionError,
  resetSTTService,
} from "../../../../src/services/stt-service.js";
import type {
  STTProvider as STTProviderType,
  STTOptions,
  TranscriptionResult,
} from "@sudocode-ai/types/voice";

/**
 * Create a mock STT provider for testing
 */
function createMockProvider(
  name: STTProviderType,
  options?: {
    available?: boolean;
    transcribeResult?: TranscriptionResult;
    transcribeError?: Error;
  }
): STTProvider {
  const available = options?.available ?? true;
  const result = options?.transcribeResult ?? {
    text: `Transcribed by ${name}`,
    duration_ms: 1000,
  };

  return {
    name,
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribe: options?.transcribeError
      ? vi.fn().mockRejectedValue(options.transcribeError)
      : vi.fn().mockResolvedValue(result),
  };
}

describe("STTService", () => {
  let service: STTService;

  beforeEach(() => {
    resetSTTService();
    service = new STTService();
  });

  afterEach(() => {
    resetSTTService();
  });

  describe("initialization", () => {
    it("should initialize with default configuration", () => {
      const config = service.getConfig();
      expect(config.defaultProvider).toBe("whisper-local");
      expect(config.whisperUrl).toBe("http://localhost:2022/v1");
      expect(config.whisperModel).toBe("base");
    });

    it("should initialize with custom configuration", () => {
      const customService = new STTService({
        defaultProvider: "openai",
        whisperUrl: "http://custom:8080/v1",
        whisperModel: "large",
      });

      const config = customService.getConfig();
      expect(config.defaultProvider).toBe("openai");
      expect(config.whisperUrl).toBe("http://custom:8080/v1");
      expect(config.whisperModel).toBe("large");
    });

    it("should start with no providers registered", async () => {
      const providers = await service.getAvailableProviders();
      expect(providers).toHaveLength(0);
    });
  });

  describe("provider registration", () => {
    it("should register a provider", () => {
      const mockProvider = createMockProvider("whisper-local");
      service.registerProvider(mockProvider);

      const provider = service.getProvider("whisper-local");
      expect(provider).toBeDefined();
      expect(provider?.name).toBe("whisper-local");
    });

    it("should unregister a provider", async () => {
      const mockProvider = createMockProvider("whisper-local");
      service.registerProvider(mockProvider);

      service.unregisterProvider("whisper-local");

      const provider = service.getProvider("whisper-local");
      expect(provider).toBeUndefined();
    });

    it("should handle registering multiple providers", async () => {
      const whisperProvider = createMockProvider("whisper-local");
      const openaiProvider = createMockProvider("openai");

      service.registerProvider(whisperProvider);
      service.registerProvider(openaiProvider);

      const providers = await service.getAvailableProviders();
      expect(providers).toHaveLength(2);
      expect(providers).toContain("whisper-local");
      expect(providers).toContain("openai");
    });
  });

  describe("getDefaultProvider", () => {
    it("should return the configured default provider", () => {
      expect(service.getDefaultProvider()).toBe("whisper-local");
    });

    it("should return custom default provider", () => {
      const customService = new STTService({ defaultProvider: "openai" });
      expect(customService.getDefaultProvider()).toBe("openai");
    });
  });

  describe("isProviderAvailable", () => {
    it("should return false for unregistered provider", async () => {
      const available = await service.isProviderAvailable("whisper-local");
      expect(available).toBe(false);
    });

    it("should return true for available provider", async () => {
      const mockProvider = createMockProvider("whisper-local", {
        available: true,
      });
      service.registerProvider(mockProvider);

      const available = await service.isProviderAvailable("whisper-local");
      expect(available).toBe(true);
    });

    it("should return false for unavailable provider", async () => {
      const mockProvider = createMockProvider("whisper-local", {
        available: false,
      });
      service.registerProvider(mockProvider);

      const available = await service.isProviderAvailable("whisper-local");
      expect(available).toBe(false);
    });

    it("should cache availability results", async () => {
      const mockProvider = createMockProvider("whisper-local");
      service.registerProvider(mockProvider);

      // First call
      await service.isProviderAvailable("whisper-local");
      // Second call (should use cache)
      await service.isProviderAvailable("whisper-local");

      expect(mockProvider.isAvailable).toHaveBeenCalledTimes(1);
    });

    it("should handle errors when checking availability", async () => {
      const mockProvider = createMockProvider("whisper-local");
      (mockProvider.isAvailable as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Connection failed")
      );
      service.registerProvider(mockProvider);

      const available = await service.isProviderAvailable("whisper-local");
      expect(available).toBe(false);
    });
  });

  describe("getAvailableProviders", () => {
    it("should return empty array when no providers registered", async () => {
      const providers = await service.getAvailableProviders();
      expect(providers).toEqual([]);
    });

    it("should return only available providers", async () => {
      const whisperProvider = createMockProvider("whisper-local", {
        available: true,
      });
      const openaiProvider = createMockProvider("openai", { available: false });

      service.registerProvider(whisperProvider);
      service.registerProvider(openaiProvider);

      const providers = await service.getAvailableProviders();
      expect(providers).toEqual(["whisper-local"]);
    });
  });

  describe("transcribe", () => {
    it("should transcribe using the preferred provider", async () => {
      const mockProvider = createMockProvider("whisper-local", {
        transcribeResult: { text: "Hello world", duration_ms: 500 },
      });
      service.registerProvider(mockProvider);

      const audio = Buffer.from("fake audio data");
      const result = await service.transcribe(audio);

      expect(result.text).toBe("Hello world");
      expect(result.duration_ms).toBe(500);
    });

    it("should use options when transcribing", async () => {
      const mockProvider = createMockProvider("whisper-local");
      service.registerProvider(mockProvider);

      const audio = Buffer.from("fake audio data");
      const options: STTOptions = { language: "es", provider: "whisper-local" };

      await service.transcribe(audio, options);

      expect(mockProvider.transcribe).toHaveBeenCalledWith(audio, options);
    });

    it("should fallback to another provider when preferred fails", async () => {
      const failingProvider = createMockProvider("whisper-local", {
        transcribeError: new Error("Whisper server unavailable"),
      });
      const workingProvider = createMockProvider("openai", {
        transcribeResult: { text: "Fallback result", duration_ms: 1000 },
      });

      service.registerProvider(failingProvider);
      service.registerProvider(workingProvider);

      const audio = Buffer.from("fake audio data");
      const result = await service.transcribe(audio);

      expect(result.text).toBe("Fallback result");
    });

    it("should throw NoSTTProviderError when no providers available", async () => {
      const audio = Buffer.from("fake audio data");

      await expect(service.transcribe(audio)).rejects.toThrow(
        NoSTTProviderError
      );
    });

    it("should throw TranscriptionError when all providers fail", async () => {
      const failingProvider1 = createMockProvider("whisper-local", {
        transcribeError: new Error("Whisper failed"),
      });
      const failingProvider2 = createMockProvider("openai", {
        transcribeError: new Error("OpenAI failed"),
      });

      service.registerProvider(failingProvider1);
      service.registerProvider(failingProvider2);

      const audio = Buffer.from("fake audio data");

      await expect(service.transcribe(audio)).rejects.toThrow(
        TranscriptionError
      );
    });

    it("should skip unavailable providers", async () => {
      const unavailableProvider = createMockProvider("whisper-local", {
        available: false,
      });
      const availableProvider = createMockProvider("openai", {
        available: true,
        transcribeResult: { text: "Success", duration_ms: 500 },
      });

      service.registerProvider(unavailableProvider);
      service.registerProvider(availableProvider);

      const audio = Buffer.from("fake audio data");
      const result = await service.transcribe(audio);

      expect(result.text).toBe("Success");
      expect(unavailableProvider.transcribe).not.toHaveBeenCalled();
    });

    it("should invalidate cache when provider fails", async () => {
      const mockProvider = createMockProvider("whisper-local", {
        transcribeError: new Error("Failed"),
      });
      service.registerProvider(mockProvider);

      // Mark as available initially
      await service.isProviderAvailable("whisper-local");

      const audio = Buffer.from("fake audio data");

      try {
        await service.transcribe(audio);
      } catch {
        // Expected to fail
      }

      // Cache should be cleared, next availability check should call isAvailable again
      service.clearAvailabilityCache();
      await service.isProviderAvailable("whisper-local");

      expect(mockProvider.isAvailable).toHaveBeenCalledTimes(2);
    });
  });

  describe("clearAvailabilityCache", () => {
    it("should clear the cache", async () => {
      const mockProvider = createMockProvider("whisper-local");
      service.registerProvider(mockProvider);

      await service.isProviderAvailable("whisper-local");
      service.clearAvailabilityCache();
      await service.isProviderAvailable("whisper-local");

      expect(mockProvider.isAvailable).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Error classes", () => {
  describe("NoSTTProviderError", () => {
    it("should have correct name and message", () => {
      const error = new NoSTTProviderError();
      expect(error.name).toBe("NoSTTProviderError");
      expect(error.message).toBe("No STT providers are available");
    });
  });

  describe("STTProviderNotFoundError", () => {
    it("should have correct name and message", () => {
      const error = new STTProviderNotFoundError("whisper");
      expect(error.name).toBe("STTProviderNotFoundError");
      expect(error.message).toBe("STT provider 'whisper' not found");
    });
  });

  describe("TranscriptionError", () => {
    it("should have correct name, message, and provider", () => {
      const cause = new Error("Original error");
      const error = new TranscriptionError(
        "Transcription failed",
        "whisper",
        cause
      );

      expect(error.name).toBe("TranscriptionError");
      expect(error.message).toBe("Transcription failed");
      expect(error.provider).toBe("whisper");
      expect(error.cause).toBe(cause);
    });
  });
});
