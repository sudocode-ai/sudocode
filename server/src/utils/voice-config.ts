/**
 * Voice Configuration Utilities
 *
 * Shared helpers for reading and checking voice configuration.
 *
 * @module utils/voice-config
 */

import fs from "fs";
import path from "path";
import type { VoiceSettingsConfig } from "@sudocode-ai/types/voice";

/**
 * Read voice config from .sudocode/config.json
 * Returns undefined if config doesn't exist or voice section is missing
 */
export function readVoiceConfig(repoPath: string): VoiceSettingsConfig | undefined {
  try {
    const configPath = path.join(repoPath, ".sudocode", "config.json");
    if (!fs.existsSync(configPath)) {
      return undefined;
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.voice as VoiceSettingsConfig | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check if voice narration broadcasts should be enabled.
 * Returns true only if:
 * - voice.enabled is true (voice features enabled for project)
 * - voice.narration.enabled is true (user wants narration)
 *
 * Note: The TTS provider (browser/kokoro/openai) doesn't affect whether
 * we broadcast events - it only affects how the client renders audio.
 * For browser TTS, client uses Web Speech API. For kokoro/openai, client
 * could fetch audio from server (future feature).
 */
export function isVoiceBroadcastEnabled(voiceConfig: VoiceSettingsConfig | undefined): boolean {
  if (!voiceConfig?.enabled) {
    return false;
  }
  // Check if narration is specifically enabled by the user
  if (!voiceConfig.narration?.enabled) {
    return false;
  }
  return true;
}
