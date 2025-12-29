/**
 * Voice API Routes
 *
 * Provides REST endpoints for voice functionality:
 * - POST /api/voice/transcribe - Transcribe audio to text
 * - GET /api/voice/config - Get available voice providers and configuration
 *
 * Voice settings are read from project config.json under the "voice" key.
 */

import { Router, Request, Response, NextFunction } from "express";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import multer from "multer";
import {
  STTService,
  getSTTConfig,
  NoSTTProviderError,
  STTProviderNotFoundError,
  TranscriptionError,
} from "../services/stt-service.js";
import { createWhisperLocalProvider } from "../services/stt-providers/whisper-local.js";
import type {
  VoiceConfig,
  STTOptions,
  VoiceSettingsConfig,
} from "@sudocode-ai/types/voice";
import type { Config } from "@sudocode-ai/types";

// Configure multer for memory storage (we process the file directly)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Accept common audio formats
    const allowedMimes = [
      "audio/webm",
      "audio/mp3",
      "audio/mpeg",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/ogg",
      "audio/flac",
      "audio/m4a",
      "audio/mp4",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid audio format: ${file.mimetype}. Supported formats: webm, mp3, wav, ogg, flac, m4a`
        )
      );
    }
  },
});

/**
 * Read voice configuration from project config.json
 */
function readVoiceConfig(sudocodeDir: string): VoiceSettingsConfig | undefined {
  const configPath = path.join(sudocodeDir, "config.json");
  if (!existsSync(configPath)) {
    return undefined;
  }
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    return config.voice;
  } catch {
    return undefined;
  }
}

/**
 * Check if voice is enabled for a project.
 * Defaults to true if not explicitly set.
 */
function isVoiceEnabled(sudocodeDir: string): boolean {
  const voiceConfig = readVoiceConfig(sudocodeDir);
  // Default to true if not configured
  return voiceConfig?.enabled !== false;
}

/**
 * Create an STT service configured for a specific project.
 *
 * Reads voice settings from project config.json and initializes
 * providers with the appropriate configuration.
 */
function createProjectSTTService(sudocodeDir: string): STTService {
  const voiceConfig = readVoiceConfig(sudocodeDir);
  const sttConfig = getSTTConfig(voiceConfig);

  const service = new STTService(sttConfig);

  // Register the Whisper local provider with project-specific config
  const whisperProvider = createWhisperLocalProvider({
    baseUrl: sttConfig.whisperUrl,
    model: sttConfig.whisperModel,
  });
  service.registerProvider(whisperProvider);

  // TODO: Register OpenAI Whisper provider when API key is configured
  // if (process.env.OPENAI_API_KEY) {
  //   const openaiProvider = createOpenAIWhisperProvider();
  //   service.registerProvider(openaiProvider);
  // }

  return service;
}

/**
 * Request timeout middleware
 */
function withTimeout(timeoutMs: number = 30000) {
  return (req: Request, _res: Response, next: () => void) => {
    req.setTimeout(timeoutMs);
    next();
  };
}

export function createVoiceRouter(): Router {
  const router = Router();

  /**
   * POST /api/voice/transcribe
   *
   * Transcribe audio to text using STT providers.
   *
   * Request:
   *   Content-Type: multipart/form-data
   *   - audio: File (audio/webm, audio/mp3, audio/wav, etc.)
   *   - language?: string (default: "en")
   *   - provider?: string (optional provider override)
   *
   * Response (200):
   *   {
   *     "text": "transcribed text",
   *     "confidence": 0.95,
   *     "duration_ms": 2340
   *   }
   *
   * Error responses:
   *   - 400: Invalid audio format or missing file
   *   - 503: No STT provider available
   *   - 500: Transcription failed
   */
  // Custom multer error handler middleware
  const handleMulterUpload = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    upload.single("audio")(req, res, (err: unknown) => {
      if (err) {
        const error = err as Error;
        // Handle multer errors (file validation)
        if (err instanceof multer.MulterError) {
          console.error(`[voice] Multer error: ${err.message}`);
          res.status(400).json({
            error: "Invalid request",
            message: err.message,
          });
          return;
        }
        // Handle file filter errors
        if (error.message?.includes("Invalid audio")) {
          console.error(`[voice] Invalid audio format: ${error.message}`);
          res.status(400).json({
            error: "Invalid audio format",
            message: error.message,
          });
          return;
        }
        // Unknown multer error
        console.error(`[voice] Upload error: ${error.message}`);
        res.status(400).json({
          error: "Upload failed",
          message: error.message,
        });
        return;
      }
      next();
    });
  };

  router.post(
    "/transcribe",
    withTimeout(30000),
    handleMulterUpload,
    async (req: Request, res: Response) => {
      const requestStartTime = Date.now();

      try {
        // Check if file was provided
        if (!req.file) {
          console.log("[voice] Transcription request missing audio file");
          return res.status(400).json({
            error: "Missing audio file",
            message: "Please provide an audio file in the 'audio' field",
          });
        }

        // Get project context for config
        if (!req.project) {
          return res.status(400).json({
            error: "Missing project context",
            message: "Voice transcription requires a project context",
          });
        }

        const { language, provider } = req.body;
        const audioBuffer = req.file.buffer;
        const audioSize = audioBuffer.length;
        const audioMime = req.file.mimetype;

        console.log(
          `[voice] Transcription request: ${audioSize} bytes, format: ${audioMime}, language: ${language || "en"}, provider: ${provider || "default"}`
        );

        // Create project-scoped STT service
        const sttService = createProjectSTTService(req.project.sudocodeDir);

        // Build STT options
        const options: STTOptions = {
          language: language || "en",
        };

        if (provider) {
          options.provider = provider;
        }

        // Perform transcription
        const result = await sttService.transcribe(audioBuffer, options);

        const totalDuration = Date.now() - requestStartTime;
        console.log(
          `[voice] Transcription complete: "${result.text.substring(0, 50)}${result.text.length > 50 ? "..." : ""}" (${totalDuration}ms total)`
        );

        return res.status(200).json({
          text: result.text,
          confidence: result.confidence,
          duration_ms: result.duration_ms,
        });
      } catch (error) {
        const totalDuration = Date.now() - requestStartTime;

        if (error instanceof NoSTTProviderError) {
          console.error(
            `[voice] No STT provider available (${totalDuration}ms)`
          );
          return res.status(503).json({
            error: "No STT provider available",
            message:
              "No speech-to-text providers are currently available. Please check your configuration.",
          });
        }

        if (error instanceof STTProviderNotFoundError) {
          console.error(`[voice] STT provider not found: ${error.message}`);
          return res.status(400).json({
            error: "Invalid provider",
            message: error.message,
          });
        }

        if (error instanceof TranscriptionError) {
          console.error(
            `[voice] Transcription failed on ${error.provider}: ${error.message} (${totalDuration}ms)`
          );
          return res.status(500).json({
            error: "Transcription failed",
            message: error.message,
            provider: error.provider,
          });
        }

        // Unknown error
        console.error(
          `[voice] Unexpected error during transcription (${totalDuration}ms):`,
          error
        );
        return res.status(500).json({
          error: "Internal server error",
          message: "An unexpected error occurred during transcription",
        });
      }
    }
  );

  /**
   * GET /api/voice/config
   *
   * Get available voice providers and configuration.
   *
   * Response (200):
   *   {
   *     "stt": {
   *       "providers": ["whisper-local", "openai"],
   *       "default": "whisper-local",
   *       "whisperAvailable": true
   *     },
   *     "tts": {
   *       "providers": ["browser", "kokoro", "openai"],
   *       "default": "browser",
   *       "kokoroAvailable": false,
   *       "voices": { ... }
   *     }
   *   }
   */
  router.get("/config", async (req: Request, res: Response) => {
    try {
      // Get project context for config
      if (!req.project) {
        return res.status(400).json({
          error: "Missing project context",
          message: "Voice config requires a project context",
        });
      }

      // Check if voice is enabled
      const voiceEnabled = isVoiceEnabled(req.project.sudocodeDir);

      // Create project-scoped STT service
      const sttService = createProjectSTTService(req.project.sudocodeDir);

      // Get available STT providers
      const availableSTTProviders = await sttService.getAvailableProviders();
      const sttConfig = sttService.getConfig();

      // Check whisper availability specifically
      const whisperAvailable =
        await sttService.isProviderAvailable("whisper-local");

      // Build response
      const config: VoiceConfig = {
        enabled: voiceEnabled,
        stt: {
          providers: availableSTTProviders,
          default: sttConfig.defaultProvider,
          whisperAvailable,
        },
        tts: {
          // TTS implementation is in a future phase
          // For now, return browser as the only available provider
          providers: ["browser"],
          default: "browser",
          kokoroAvailable: false, // TODO: Check Kokoro availability when implemented
          voices: {
            browser: ["default"],
            kokoro: [],
            openai: [],
          },
        },
      };

      return res.status(200).json({ success: true, data: config });
    } catch (error) {
      console.error("[voice] Error getting voice config:", error);
      return res.status(500).json({
        error: "Internal server error",
        message: "Failed to retrieve voice configuration",
      });
    }
  });

  return router;
}
