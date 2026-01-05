/**
 * Unit tests for Whisper Local STT Provider
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  WhisperLocalProvider,
  createWhisperLocalProvider,
  WhisperServerError,
} from "../../../../src/services/stt-providers/whisper-local.js";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("WhisperLocalProvider", () => {
  let provider: WhisperLocalProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new WhisperLocalProvider();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with default configuration", () => {
      const config = provider.getConfig();
      expect(config.baseUrl).toBe("http://localhost:2022/v1");
      expect(config.model).toBe("base");
      expect(config.timeout).toBe(30000);
    });

    it("should initialize with custom configuration", () => {
      const customProvider = new WhisperLocalProvider({
        baseUrl: "http://custom:8080/v1",
        model: "large",
        timeout: 60000,
      });

      const config = customProvider.getConfig();
      expect(config.baseUrl).toBe("http://custom:8080/v1");
      expect(config.model).toBe("large");
      expect(config.timeout).toBe(60000);
    });

    it("should have correct name", () => {
      expect(provider.name).toBe("whisper-local");
    });
  });

  describe("isAvailable", () => {
    it("should return true when models endpoint responds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const available = await provider.isAvailable();
      expect(available).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:2022/v1/models",
        expect.any(Object)
      );
    });

    it("should return false when models endpoint fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Second call to base URL should also fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it("should try base URL if models endpoint throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const available = await provider.isAvailable();
      expect(available).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should return false when both endpoints fail", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it("should cache availability results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      await provider.isAvailable();
      await provider.isAvailable();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should clear health cache", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      await provider.isAvailable();
      provider.clearHealthCache();
      await provider.isAvailable();

      expect(mockFetch).toHaveBeenCalledTimes(2);
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

    it("should include language option in request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "Hola mundo" }),
      });

      const audio = Buffer.from("fake audio data");
      await provider.transcribe(audio, { language: "es" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:2022/v1/audio/transcriptions",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("should throw WhisperServerError on server error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        WhisperServerError
      );
    });

    it("should throw WhisperServerError on invalid response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: "response" }),
      });

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        WhisperServerError
      );
    });

    it("should throw WhisperServerError on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const audio = Buffer.from("fake audio data");

      await expect(provider.transcribe(audio)).rejects.toThrow(
        WhisperServerError
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
  });

  describe("createWhisperLocalProvider", () => {
    it("should create a provider instance", () => {
      const created = createWhisperLocalProvider();
      expect(created).toBeInstanceOf(WhisperLocalProvider);
    });

    it("should create a provider with custom config", () => {
      const created = createWhisperLocalProvider({
        baseUrl: "http://custom:8080",
      });
      expect(created.getConfig().baseUrl).toBe("http://custom:8080");
    });
  });
});

describe("WhisperServerError", () => {
  it("should have correct properties", () => {
    const cause = new Error("Original error");
    const error = new WhisperServerError("Server error", 500, cause);

    expect(error.name).toBe("WhisperServerError");
    expect(error.message).toBe("Server error");
    expect(error.statusCode).toBe(500);
    expect(error.cause).toBe(cause);
  });

  it("should work without optional properties", () => {
    const error = new WhisperServerError("Server error");

    expect(error.name).toBe("WhisperServerError");
    expect(error.message).toBe("Server error");
    expect(error.statusCode).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});
