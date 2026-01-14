/**
 * Macro-Agent Configuration Utilities
 *
 * Shared helpers for reading and validating macro-agent configuration.
 *
 * @module utils/macro-agent-config
 */

import fs from "fs";
import path from "path";
import type { MacroAgentServerConfig } from "@sudocode-ai/types";

/**
 * Default macro-agent server configuration
 */
export const MACRO_AGENT_DEFAULTS: Required<MacroAgentServerConfig> = {
  enabled: true,
  port: 3100,
  host: "localhost",
};

/**
 * Read macro-agent config from .sudocode/config.json
 * Returns config merged with defaults if section exists,
 * or defaults if section is missing
 *
 * @param repoPath - Path to the repository root
 * @returns Resolved macro-agent config with defaults applied
 */
export function readMacroAgentConfig(
  repoPath: string
): Required<MacroAgentServerConfig> {
  try {
    const configPath = path.join(repoPath, ".sudocode", "config.json");
    if (!fs.existsSync(configPath)) {
      return { ...MACRO_AGENT_DEFAULTS };
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const macroAgentConfig = config.macroAgent as
      | MacroAgentServerConfig
      | undefined;

    if (!macroAgentConfig) {
      return { ...MACRO_AGENT_DEFAULTS };
    }

    // Merge with defaults
    return {
      enabled: macroAgentConfig.enabled ?? MACRO_AGENT_DEFAULTS.enabled,
      port: macroAgentConfig.port ?? MACRO_AGENT_DEFAULTS.port,
      host: macroAgentConfig.host ?? MACRO_AGENT_DEFAULTS.host,
    };
  } catch {
    return { ...MACRO_AGENT_DEFAULTS };
  }
}

/**
 * Check if macro-agent server should be started
 *
 * @param config - Macro-agent configuration
 * @returns true if macro-agent server should be started
 */
export function isMacroAgentEnabled(
  config: MacroAgentServerConfig | undefined
): boolean {
  return config?.enabled !== false;
}

/**
 * Get the WebSocket ACP URL for connecting to macro-agent
 *
 * @param config - Macro-agent configuration
 * @returns WebSocket URL (e.g., "ws://localhost:3100/acp")
 */
export function getMacroAgentAcpUrl(
  config: Required<MacroAgentServerConfig>
): string {
  return `ws://${config.host}:${config.port}/acp`;
}

/**
 * Get the HTTP API URL for macro-agent observability
 *
 * @param config - Macro-agent configuration
 * @returns HTTP URL (e.g., "http://localhost:3100")
 */
export function getMacroAgentApiUrl(
  config: Required<MacroAgentServerConfig>
): string {
  return `http://${config.host}:${config.port}`;
}
