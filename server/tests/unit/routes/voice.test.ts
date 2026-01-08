/**
 * Unit tests for Voice API Routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express, { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

/**
 * Mock project context for testing
 */
const mockProjectContext = {
  id: "test-project",
  path: "/test/project",
  sudocodeDir: "/test/project/.sudocode",
  db: {} as any,
  executionService: {} as any,
  logsStore: {} as any,
  worktreeManager: {} as any,
  openedAt: new Date(),
};

/**
 * Middleware to inject mock project context
 */
function injectProject(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  req.project = mockProjectContext as any;
  next();
}

// Mock the STT service module before importing the router
vi.mock("../../../src/services/stt-service.js", () => {
  const mockService = {
    registerProvider: vi.fn(),
    getAvailableProviders: vi.fn().mockResolvedValue(["whisper-local"]),
    getConfig: vi.fn().mockReturnValue({
      defaultProvider: "whisper-local",
      whisperUrl: "http://localhost:2022/v1",
      whisperModel: "base",
    }),
    isProviderAvailable: vi.fn().mockResolvedValue(true),
    transcribe: vi.fn().mockResolvedValue({
      text: "Hello world",
      confidence: 0.95,
      duration_ms: 1500,
    }),
  };

  // Create a mock STTService class
  class MockSTTService {
    registerProvider = mockService.registerProvider;
    getAvailableProviders = mockService.getAvailableProviders;
    getConfig = mockService.getConfig;
    isProviderAvailable = mockService.isProviderAvailable;
    transcribe = mockService.transcribe;
  }

  return {
    STTService: MockSTTService,
    getSTTConfig: vi.fn().mockReturnValue({
      defaultProvider: "whisper-local",
      whisperUrl: "http://localhost:2022/v1",
      whisperModel: "base",
    }),
    // Keep the old getSTTService for backwards compatibility in tests
    getSTTService: vi.fn(() => mockService),
    NoSTTProviderError: class NoSTTProviderError extends Error {
      constructor() {
        super("No STT providers are available");
        this.name = "NoSTTProviderError";
      }
    },
    STTProviderNotFoundError: class STTProviderNotFoundError extends Error {
      constructor(providerName: string) {
        super(`STT provider '${providerName}' not found`);
        this.name = "STTProviderNotFoundError";
      }
    },
    TranscriptionError: class TranscriptionError extends Error {
      provider: string;
      constructor(message: string, provider: string) {
        super(message);
        this.name = "TranscriptionError";
        this.provider = provider;
      }
    },
    resetSTTService: vi.fn(),
  };
});

// Mock the whisper local provider
vi.mock("../../../src/services/stt-providers/whisper-local.js", () => ({
  createWhisperLocalProvider: vi.fn(() => ({
    name: "whisper-local",
    isAvailable: vi.fn().mockResolvedValue(true),
    transcribe: vi.fn().mockResolvedValue({
      text: "Hello world",
      duration_ms: 1500,
    }),
  })),
}));

import { createVoiceRouter } from "../../../src/routes/voice.js";
import {
  getSTTService,
  NoSTTProviderError,
  STTProviderNotFoundError,
  TranscriptionError,
} from "../../../src/services/stt-service.js";

describe("Voice API Routes", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // Inject mock project context before voice routes
    app.use("/api/voice", injectProject, createVoiceRouter());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/voice/transcribe", () => {
    it("should return 400 when no audio file is provided", async () => {
      const response = await request(app).post("/api/voice/transcribe");

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error", "Missing audio file");
      expect(response.body).toHaveProperty("message");
    });

    it("should transcribe audio successfully", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.transcribe).mockResolvedValue({
        text: "Test transcription",
        confidence: 0.98,
        duration_ms: 2000,
      });

      const response = await request(app)
        .post("/api/voice/transcribe")
        .attach("audio", Buffer.from("fake audio data"), {
          filename: "test.webm",
          contentType: "audio/webm",
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("text", "Test transcription");
      expect(response.body).toHaveProperty("confidence", 0.98);
      expect(response.body).toHaveProperty("duration_ms", 2000);
    });

    it("should accept language parameter", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.transcribe).mockResolvedValue({
        text: "Hola mundo",
        duration_ms: 1500,
      });

      const response = await request(app)
        .post("/api/voice/transcribe")
        .field("language", "es")
        .attach("audio", Buffer.from("fake audio data"), {
          filename: "test.webm",
          contentType: "audio/webm",
        });

      expect(response.status).toBe(200);
      expect(response.body.text).toBe("Hola mundo");
      expect(sttService.transcribe).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ language: "es" })
      );
    });

    it("should accept provider parameter", async () => {
      const sttService = getSTTService();

      await request(app)
        .post("/api/voice/transcribe")
        .field("provider", "openai")
        .attach("audio", Buffer.from("fake audio data"), {
          filename: "test.webm",
          contentType: "audio/webm",
        });

      expect(sttService.transcribe).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ provider: "openai" })
      );
    });

    it("should return 503 when no STT provider is available", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.transcribe).mockRejectedValue(
        new NoSTTProviderError()
      );

      const response = await request(app)
        .post("/api/voice/transcribe")
        .attach("audio", Buffer.from("fake audio data"), {
          filename: "test.webm",
          contentType: "audio/webm",
        });

      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty("error", "No STT provider available");
    });

    it("should return 400 when provider is not found", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.transcribe).mockRejectedValue(
        new STTProviderNotFoundError("invalid-provider")
      );

      const response = await request(app)
        .post("/api/voice/transcribe")
        .field("provider", "invalid-provider")
        .attach("audio", Buffer.from("fake audio data"), {
          filename: "test.webm",
          contentType: "audio/webm",
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error", "Invalid provider");
    });

    it("should return 500 when transcription fails", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.transcribe).mockRejectedValue(
        new TranscriptionError("Whisper server error", "whisper-local")
      );

      const response = await request(app)
        .post("/api/voice/transcribe")
        .attach("audio", Buffer.from("fake audio data"), {
          filename: "test.webm",
          contentType: "audio/webm",
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error", "Transcription failed");
      expect(response.body).toHaveProperty("provider", "whisper-local");
    });

    it("should return 400 for invalid audio format", async () => {
      const response = await request(app)
        .post("/api/voice/transcribe")
        .attach("audio", Buffer.from("fake data"), {
          filename: "test.txt",
          contentType: "text/plain",
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should accept common audio formats", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.transcribe).mockResolvedValue({
        text: "Test",
        duration_ms: 1000,
      });

      const formats = [
        { filename: "test.webm", contentType: "audio/webm" },
        { filename: "test.mp3", contentType: "audio/mpeg" },
        { filename: "test.wav", contentType: "audio/wav" },
        { filename: "test.ogg", contentType: "audio/ogg" },
        { filename: "test.flac", contentType: "audio/flac" },
        { filename: "test.m4a", contentType: "audio/m4a" },
      ];

      for (const format of formats) {
        const response = await request(app)
          .post("/api/voice/transcribe")
          .attach("audio", Buffer.from("fake audio data"), format);

        expect(response.status).toBe(200);
      }
    });

    it("should handle unexpected errors gracefully", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.transcribe).mockRejectedValue(
        new Error("Unexpected error")
      );

      const response = await request(app)
        .post("/api/voice/transcribe")
        .attach("audio", Buffer.from("fake audio data"), {
          filename: "test.webm",
          contentType: "audio/webm",
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error", "Internal server error");
    });
  });

  describe("GET /api/voice/config", () => {
    it("should return voice configuration wrapped in ApiResponse", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.getAvailableProviders).mockResolvedValue([
        "whisper-local",
      ]);
      vi.mocked(sttService.isProviderAvailable).mockResolvedValue(true);

      const response = await request(app).get("/api/voice/config");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveProperty("stt");
      expect(response.body.data).toHaveProperty("tts");
    });

    it("should include STT configuration", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.getAvailableProviders).mockResolvedValue([
        "whisper-local",
        "openai",
      ]);
      vi.mocked(sttService.isProviderAvailable).mockResolvedValue(true);
      vi.mocked(sttService.getConfig).mockReturnValue({
        defaultProvider: "whisper-local",
        whisperUrl: "http://localhost:2022/v1",
        whisperModel: "base",
      });

      const response = await request(app).get("/api/voice/config");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.stt).toHaveProperty("providers");
      expect(response.body.data.stt).toHaveProperty("default", "whisper-local");
      expect(response.body.data.stt).toHaveProperty("whisperAvailable", true);
      expect(response.body.data.stt.providers).toContain("whisper-local");
    });

    it("should include TTS configuration", async () => {
      const response = await request(app).get("/api/voice/config");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tts).toHaveProperty("providers");
      expect(response.body.data.tts).toHaveProperty("default", "browser");
      expect(response.body.data.tts).toHaveProperty("kokoroAvailable", false);
      expect(response.body.data.tts).toHaveProperty("voices");
    });

    it("should report whisperAvailable as false when not available", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.isProviderAvailable).mockResolvedValue(false);

      const response = await request(app).get("/api/voice/config");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.stt.whisperAvailable).toBe(false);
    });

    it("should handle errors gracefully", async () => {
      const sttService = getSTTService();
      vi.mocked(sttService.getAvailableProviders).mockRejectedValue(
        new Error("Database error")
      );

      const response = await request(app).get("/api/voice/config");

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error", "Internal server error");
    });
  });
});
