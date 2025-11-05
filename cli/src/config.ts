import * as fs from "fs";
import * as path from "path";
import type { Config } from "@sudocode-ai/types";
import { VERSION } from "./version.js";

/**
 * Read config file (version-controlled)
 */
function readConfig(outputDir: string): Config {
  const configPath = path.join(outputDir, "config.json");

  if (!fs.existsSync(configPath)) {
    // Create default config if not exists
    const defaultConfig: Config = {
      version: VERSION,
    };
    writeConfig(outputDir, defaultConfig);
    return defaultConfig;
  }

  const content = fs.readFileSync(configPath, "utf8");
  return JSON.parse(content) as Config;
}

/**
 * Write config file (version-controlled)
 */
function writeConfig(outputDir: string, config: Config): void {
  const configPath = path.join(outputDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Get current config
 */
export function getConfig(outputDir: string): Config {
  return readConfig(outputDir);
}

/**
 * Update config (version-controlled)
 */
export function updateConfig(
  outputDir: string,
  updates: Partial<Config>
): void {
  const config = readConfig(outputDir);
  Object.assign(config, updates);
  writeConfig(outputDir, config);
}
