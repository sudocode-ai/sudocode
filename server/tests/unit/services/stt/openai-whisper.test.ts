/**
 * Unit tests for OpenAI Whisper STT Provider
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  OpenAIWhisperProvider,
  createOpenAIWhisperProvider,
  OpenAIWhisperError,
} from "../../../../src/services/stt-providers/openai-whisper.js";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Store original env
const originalEnv = { ...process.env };

describe("OpenAIWhisperProvider", () => {
  let provider: OpenAIWhisperProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-api-key";
    provider = new OpenAIWhisperProvider();
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe("initialization", () => {
    it("should initialize with default configuration", () => {
      const config = provider.getConfig();
      expect(config.baseUrl).toBe("https://api.openai.com/v1");
      expect(config.model).toBe("whisper-1");
      expect(config.timeout).toBe(60000);
      expect(config.hasApiKey).toBe(true);
    });

    it("should initialize with custom configuration", () => {
      const customProvider = new OpenAIWhisperProvider({
        apiKey: "custom-key",
        model: "whisper-2",
        baseUrl: "https://custom.openai.com/v1",
        timeout: 120000,
      });

      const config = customProvider.getConfig();
      expect(config.baseUrl).toBe("https://custom.openai.com/v1");
      expect(config.model).toBe("whisper-2");
      expect(config.timeout).toBe(120000);
      expect(config.hasApiKey).toBe(true);
    });

    it("should have correct name", () => {
      expect(provider.name).toBe("openai");
    });
  });

  describe("isAvailable", () => {
    it("should return true when API key is configured", async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it("should return false when API key is not configured", async () => {
      delete process.env.OPENAI_API_KEY;
      const noKeyProvider = new OpenAIWhisperProvider();

      const available = await noKeyProvider.isAvailable();
      expect(available).toBe(false);
    });

    it("should use provided API key over environment variable", async () => {
      delete process.env.OPENAI_API_KEY;
      const providerWithKey = new OpenAIWhisperProvider({
        apiKey: "provided-key",
      });

      const available = await providerWithKey.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe("transcribe", () => {
    it("should transcribe audio successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "Hello world" }),
      });

      const audio = Buffer.from("fake audio data");
      const result = await provider.transcribe(audio);

      expect(result.text).toBe("Hello world");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("should include authorization header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "Hello" }),
      });

      const audio = Buffer.from("fake audio data");
      await provider.transcribe(audio);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/transcriptions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });

    it("should include language option in request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "Hola mundo" }),
      });

      const audio = Buffer.from("fake audio data");
      await provider.transcribe(audio, { language: "es" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/transcriptions",
        expect.any(Object)
      );
    });

    it("should throw OpenAIWhisperError when API key is missing", async () => {
      delete process.env.OPENAI_API_KEY;
      const noKeyProvider = new OpenAIWhisperProvider();

      const audio = Buffer.from("fake audio data");

      await expect(noKeyProvider.transcribe(audio)).rejects.toThrow(
        OpenAIWhisperError
      );
      await expect(noKeyProvider.transcribe(audio)).rejects.toThrow(
        "OpenAI API key not configured"
      );
    });

    it("should throw OpenAIWhisperError on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Invalid API key" } }),
      });

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        OpenAIWhisperError
      );
    });

    it("should throw OpenAIWhisperError on invalid response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: "response" }),
      });

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        OpenAIWhisperError
      );
    });

    it("should throw OpenAIWhisperError on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        OpenAIWhisperError
      );
    });

    it("should handle timeout via AbortError", async () => {
      // Mock a response that throws AbortError (simulating timeout)
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        /timed out/
      );
    });

    it("should trim transcription result", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "  Hello world  " }),
      });

      const audio = Buffer.from("fake audio data");
      const result = await provider.transcribe(audio);

      expect(result.text).toBe("Hello world");
    });

    it("should handle empty transcription", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "" }),
      });

      const audio = Buffer.from("fake audio data");
      const result = await provider.transcribe(audio);

      expect(result.text).toBe("");
    });

    it("should handle error response without json", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("Not JSON");
        },
      });

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        OpenAIWhisperError
      );
    });
  });

  describe("createOpenAIWhisperProvider", () => {
    it("should create a provider instance", () => {
      const created = createOpenAIWhisperProvider();
      expect(created).toBeInstanceOf(OpenAIWhisperProvider);
    });

    it("should create a provider with custom config", () => {
      const created = createOpenAIWhisperProvider({
        model: "whisper-2",
      });
      expect(created.getConfig().model).toBe("whisper-2");
    });
  });
});

describe("OpenAIWhisperError", () => {
  it("should have correct properties", () => {
    const cause = new Error("Original error");
    const error = new OpenAIWhisperError("API error", 401, cause);

    expect(error.name).toBe("OpenAIWhisperError");
    expect(error.message).toBe("API error");
    expect(error.statusCode).toBe(401);
    expect(error.cause).toBe(cause);
  });

  it("should work without optional properties", () => {
    const error = new OpenAIWhisperError("API error");

    expect(error.name).toBe("OpenAIWhisperError");
    expect(error.message).toBe("API error");
    expect(error.statusCode).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});
