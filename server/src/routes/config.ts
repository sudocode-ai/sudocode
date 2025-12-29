import { Router, Request, Response } from "express";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import type { IntegrationsConfig } from "@sudocode-ai/types";
import type { VoiceSettingsConfig } from "@sudocode-ai/types/voice";
import {
  validateIntegrationsConfig,
  testProviderConnection as pluginTestConnection,
  type ValidationResult,
} from "@sudocode-ai/cli/dist/integrations/index.js";

/**
 * Helper to read config.json
 */
function readConfig(sudocodeDir: string): Record<string, unknown> {
  const configPath = path.join(sudocodeDir, "config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

/**
 * Helper to write config.json
 */
function writeConfig(
  sudocodeDir: string,
  config: Record<string, unknown>
): void {
  const configPath = path.join(sudocodeDir, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function createConfigRouter(): Router {
  const router = Router();

  // GET /api/config - returns full sudocode configuration
  router.get("/", (req: Request, res: Response) => {
    try {
      const config = readConfig(req.project!.sudocodeDir);
      res.status(200).json(config);
    } catch (error) {
      console.error("Failed to read config:", error);
      res.status(500).json({ error: "Failed to read config" });
    }
  });

  // GET /api/config/integrations - returns integrations section only
  router.get("/integrations", (req: Request, res: Response) => {
    try {
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;
      res.status(200).json(integrations);
    } catch (error) {
      console.error("Failed to read integrations config:", error);
      res.status(500).json({ error: "Failed to read integrations config" });
    }
  });

  // PUT /api/config/integrations - update integrations config
  // Validates config and returns warnings, but still saves (non-blocking validation)
  router.put("/integrations", (req: Request, res: Response) => {
    try {
      const integrations = req.body as IntegrationsConfig;

      // Validate the integrations config (base validation only)
      const validation: ValidationResult =
        validateIntegrationsConfig(integrations);

      // If there are errors (not warnings), reject the request
      if (!validation.valid) {
        res.status(400).json({
          error: "Invalid integrations configuration",
          errors: validation.errors,
          warnings: validation.warnings,
        });
        return;
      }

      // Read existing config and update integrations section
      const config = readConfig(req.project!.sudocodeDir);
      config.integrations = integrations;

      // Write updated config
      writeConfig(req.project!.sudocodeDir, config);

      res.status(200).json({
        success: true,
        integrations,
        warnings: validation.warnings,
      });
    } catch (error) {
      console.error("Failed to update integrations config:", error);
      res.status(500).json({ error: "Failed to update integrations config" });
    }
  });

  // POST /api/config/integrations/:provider/test - test provider connection
  // Returns validation status and whether the provider can connect
  router.post("/integrations/:provider/test", async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      // Check if provider is configured
      const providerConfig = integrations[provider];
      if (!providerConfig) {
        res.status(404).json({
          success: false,
          error: `Provider '${provider}' is not configured`,
        });
        return;
      }

      // Check if provider is enabled
      if (!providerConfig.enabled) {
        res.status(200).json({
          success: false,
          error: `Provider '${provider}' is disabled`,
          configured: true,
          enabled: false,
        });
        return;
      }

      // Delegate to plugin for testing
      const testResult = await pluginTestConnection(
        provider,
        providerConfig,
        req.project!.path
      );

      res.status(200).json(testResult);
    } catch (error) {
      console.error("Failed to test provider:", error);
      res.status(500).json({ error: "Failed to test provider" });
    }
  });

  // GET /api/config/voice - returns voice settings section
  router.get("/voice", (req: Request, res: Response) => {
    try {
      const config = readConfig(req.project!.sudocodeDir);
      const voice = (config.voice || {}) as VoiceSettingsConfig;
      res.status(200).json({ success: true, data: voice });
    } catch (error) {
      console.error("Failed to read voice config:", error);
      res.status(500).json({ success: false, message: "Failed to read voice config" });
    }
  });

  // PUT /api/config/voice - update voice settings
  router.put("/voice", (req: Request, res: Response) => {
    try {
      const voice = req.body as VoiceSettingsConfig;

      // Basic validation
      if (voice.enabled !== undefined && typeof voice.enabled !== "boolean") {
        res.status(400).json({
          error: "Invalid voice configuration",
          message: "'enabled' must be a boolean",
        });
        return;
      }

      if (voice.stt) {
        if (
          voice.stt.provider &&
          !["whisper-local", "openai"].includes(voice.stt.provider)
        ) {
          res.status(400).json({
            error: "Invalid voice configuration",
            message: "Invalid STT provider",
          });
          return;
        }
      }

      // Read existing config and update voice section
      const config = readConfig(req.project!.sudocodeDir);
      config.voice = voice;

      // Write updated config
      writeConfig(req.project!.sudocodeDir, config);

      res.status(200).json({
        success: true,
        data: voice,
      });
    } catch (error) {
      console.error("Failed to update voice config:", error);
      res.status(500).json({ success: false, message: "Failed to update voice config" });
    }
  });

  return router;
}
