/**
 * Unit tests for voice-config utilities
 *
 * Tests the shared voice configuration helpers used by
 * execution services to determine if voice narration broadcasts
 * should be enabled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  readVoiceConfig,
  isVoiceBroadcastEnabled,
} from "../../../src/utils/voice-config.js";
import type { VoiceSettingsConfig } from "@sudocode-ai/types/voice";

// Mock fs module
vi.mock("fs");

describe("voice-config utilities", () => {
  const mockRepoPath = "/test/repo";
  const configPath = path.join(mockRepoPath, ".sudocode", "config.json");

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.log/error during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readVoiceConfig", () => {
    it("should return undefined when config.json does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = readVoiceConfig(mockRepoPath);

      expect(result).toBeUndefined();
      expect(fs.existsSync).toHaveBeenCalledWith(configPath);
    });

    it("should return undefined when voice section is missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ version: "1.0.0" })
      );

      const result = readVoiceConfig(mockRepoPath);

      expect(result).toBeUndefined();
    });

    it("should return voice config when present", () => {
      const voiceConfig: VoiceSettingsConfig = {
        enabled: true,
        tts: {
          provider: "kokoro",
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ voice: voiceConfig })
      );

      const result = readVoiceConfig(mockRepoPath);

      expect(result).toEqual(voiceConfig);
    });

    it("should return voice config with browser TTS provider", () => {
      const voiceConfig: VoiceSettingsConfig = {
        enabled: true,
        tts: {
          provider: "browser",
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ voice: voiceConfig })
      );

      const result = readVoiceConfig(mockRepoPath);

      expect(result).toEqual(voiceConfig);
      expect(result?.tts?.provider).toBe("browser");
    });

    it("should return undefined when JSON parsing fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid json{");

      const result = readVoiceConfig(mockRepoPath);

      expect(result).toBeUndefined();
    });

    it("should return undefined when fs.readFileSync throws", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("Read failed");
      });

      const result = readVoiceConfig(mockRepoPath);

      expect(result).toBeUndefined();
    });
  });

  describe("isVoiceBroadcastEnabled", () => {
    it("should return false when voiceConfig is undefined", () => {
      const result = isVoiceBroadcastEnabled(undefined);

      expect(result).toBe(false);
    });

    it("should return false when voice.enabled is false", () => {
      const config: VoiceSettingsConfig = {
        enabled: false,
      };

      const result = isVoiceBroadcastEnabled(config);

      expect(result).toBe(false);
    });

    it("should return false when voice.enabled is missing", () => {
      const config: VoiceSettingsConfig = {
        tts: {
          provider: "kokoro",
        },
      } as VoiceSettingsConfig;

      const result = isVoiceBroadcastEnabled(config);

      expect(result).toBe(false);
    });

    it("should return false when narration.enabled is false", () => {
      const config: VoiceSettingsConfig = {
        enabled: true,
        narration: {
          enabled: false,
        },
      };

      const result = isVoiceBroadcastEnabled(config);

      expect(result).toBe(false);
    });

    it("should return false when narration is not configured", () => {
      const config: VoiceSettingsConfig = {
        enabled: true,
      };

      const result = isVoiceBroadcastEnabled(config);

      expect(result).toBe(false);
    });

    it("should return true when voice and narration are both enabled", () => {
      const config: VoiceSettingsConfig = {
        enabled: true,
        narration: {
          enabled: true,
        },
      };

      const result = isVoiceBroadcastEnabled(config);

      expect(result).toBe(true);
    });

    it("should return true regardless of TTS provider when narration is enabled", () => {
      const config: VoiceSettingsConfig = {
        enabled: true,
        narration: {
          enabled: true,
        },
        tts: {
          provider: "browser",
        },
      };

      const result = isVoiceBroadcastEnabled(config);

      // TTS provider doesn't affect broadcast decision - client handles rendering
      expect(result).toBe(true);
    });

    it("should return true for kokoro TTS when narration is enabled", () => {
      const config: VoiceSettingsConfig = {
        enabled: true,
        narration: {
          enabled: true,
        },
        tts: {
          provider: "kokoro",
        },
      };

      const result = isVoiceBroadcastEnabled(config);

      expect(result).toBe(true);
    });
  });
});
