/**
 * Export agent presets to other platform formats
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentPreset } from "@sudocode-ai/types";
import { getAgentPreset, listAgentPresets } from "./agents.js";

export type ExportPlatform = "claude-code" | "cursor" | "gemini-cli" | "mcp";

export interface AgentExportOptions {
  platform: ExportPlatform;
  outputPath?: string;
  overwrite?: boolean;
}

export interface AgentExportResult {
  platform: ExportPlatform;
  outputPath: string;
  success: boolean;
  error?: string;
}

/**
 * Export an agent preset to another platform format
 */
export function exportAgentPreset(
  sudocodeDir: string,
  presetId: string,
  options: AgentExportOptions
): AgentExportResult {
  try {
    // Load the preset
    const preset = getAgentPreset(sudocodeDir, presetId);
    if (!preset) {
      return {
        platform: options.platform,
        outputPath: "",
        success: false,
        error: `Agent preset not found: ${presetId}`,
      };
    }

    // Export based on platform
    let outputPath: string;
    let content: string;

    switch (options.platform) {
      case "claude-code":
        ({ outputPath, content } = exportToClaudeCode(preset, options));
        break;
      case "cursor":
        ({ outputPath, content } = exportToCursor(preset, options));
        break;
      case "gemini-cli":
        ({ outputPath, content } = exportToGeminiCLI(preset, options));
        break;
      case "mcp":
        ({ outputPath, content } = exportToMCP(preset, options));
        break;
      default:
        return {
          platform: options.platform,
          outputPath: "",
          success: false,
          error: `Unsupported platform: ${options.platform}`,
        };
    }

    // Check if file exists and overwrite is not enabled
    if (fs.existsSync(outputPath) && !options.overwrite) {
      return {
        platform: options.platform,
        outputPath,
        success: false,
        error: `File already exists: ${outputPath}. Use --overwrite to replace.`,
      };
    }

    // Write file
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, content);

    return {
      platform: options.platform,
      outputPath,
      success: true,
    };
  } catch (error) {
    return {
      platform: options.platform,
      outputPath: "",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Export to Claude Code subagent format
 */
function exportToClaudeCode(
  preset: AgentPreset,
  options: AgentExportOptions
): { outputPath: string; content: string } {
  const outputPath =
    options.outputPath ||
    path.join(process.cwd(), ".claude", "agents", `${preset.id}.md`);

  // Build frontmatter
  const frontmatter: any = {
    id: preset.id,
    name: preset.name,
    description: preset.description,
  };

  // Add tools if specified
  if (preset.config.tools && preset.config.tools.length > 0) {
    frontmatter.tools = preset.config.tools.join(", ");
  }

  // Add model if specified
  if (preset.config.model) {
    frontmatter.model = preset.config.model;
  }

  // Convert frontmatter to YAML-like format
  const frontmatterLines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${value}`
  );

  const content = `---
${frontmatterLines.join("\n")}
---

${preset.system_prompt}
`;

  return { outputPath, content };
}

/**
 * Export to Cursor .mdc format
 */
function exportToCursor(
  preset: AgentPreset,
  options: AgentExportOptions
): { outputPath: string; content: string } {
  const outputPath =
    options.outputPath ||
    path.join(process.cwd(), ".cursor", "rules", `${preset.id}.mdc`);

  // Build frontmatter for Cursor
  const frontmatter: any = {
    name: preset.id,
    description: preset.description,
    alwaysApply: preset.config.platform_configs?.cursor?.alwaysApply ?? true,
  };

  // Add globs from platform_configs if available
  if (preset.config.platform_configs?.cursor?.globs) {
    frontmatter.globs = preset.config.platform_configs.cursor.globs;
  }

  // Convert frontmatter to YAML
  const frontmatterYaml = Object.entries(frontmatter)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((v) => `  - ${v}`).join("\n")}`;
      } else if (typeof value === "string") {
        return `${key}: "${value}"`;
      } else {
        return `${key}: ${value}`;
      }
    })
    .join("\n");

  const content = `---
${frontmatterYaml}
---

${preset.system_prompt}
`;

  return { outputPath, content };
}

/**
 * Export to Gemini CLI format
 */
function exportToGeminiCLI(
  preset: AgentPreset,
  options: AgentExportOptions
): { outputPath: string; content: string } {
  const outputPath =
    options.outputPath ||
    path.join(
      process.cwd(),
      ".gemini",
      "agents",
      `${preset.id}.agent.json`
    );

  // Build Gemini CLI agent config
  const config: any = {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    version: preset.version,
    systemPrompt: preset.system_prompt,
  };

  // Add tools (map to Gemini CLI format - lowercase)
  if (preset.config.tools && preset.config.tools.length > 0) {
    config.tools = preset.config.tools.map((t) => t.toLowerCase());
  }

  // Add model
  if (preset.config.model) {
    config.model = preset.config.model;
  }

  // Add hooks if specified
  if (preset.config.hooks) {
    config.hooks = preset.config.hooks;
  }

  // Add capabilities and tags
  if (preset.config.capabilities) {
    config.capabilities = preset.config.capabilities;
  }
  if (preset.config.tags) {
    config.tags = preset.config.tags;
  }

  const content = JSON.stringify(config, null, 2);

  return { outputPath, content };
}

/**
 * Export to MCP server configuration format
 */
function exportToMCP(
  preset: AgentPreset,
  options: AgentExportOptions
): { outputPath: string; content: string } {
  const outputPath =
    options.outputPath ||
    path.join(process.cwd(), ".config", "mcp", `${preset.id}.json`);

  // Build MCP server config
  const config = {
    mcpServers: {
      [preset.id]: {
        command: "npx",
        args: ["-y", "@sudocode-ai/mcp-server", "--preset", preset.id],
        env: {
          SUDOCODE_DIR: "${workspaceFolder}/.sudocode",
        },
      },
    },
  };

  const content = JSON.stringify(config, null, 2);

  return { outputPath, content };
}

/**
 * Export all presets for a platform
 */
export function exportAllPresets(
  sudocodeDir: string,
  platform: ExportPlatform,
  options?: {
    outputDir?: string;
    overwrite?: boolean;
  }
): AgentExportResult[] {
  const presets = listAgentPresets(sudocodeDir);

  const results: AgentExportResult[] = [];

  for (const preset of presets) {
    const result = exportAgentPreset(sudocodeDir, preset.id, {
      platform,
      outputPath: options?.outputDir
        ? path.join(options.outputDir, getExportFileName(preset.id, platform))
        : undefined,
      overwrite: options?.overwrite,
    });

    results.push(result);
  }

  return results;
}

/**
 * Get the appropriate filename for an export
 */
function getExportFileName(presetId: string, platform: ExportPlatform): string {
  switch (platform) {
    case "claude-code":
      return `${presetId}.md`;
    case "cursor":
      return `${presetId}.mdc`;
    case "gemini-cli":
      return `${presetId}.agent.json`;
    case "mcp":
      return `${presetId}.json`;
    default:
      return `${presetId}.txt`;
  }
}

/**
 * Get recommended export paths for a platform
 */
export function getRecommendedExportPath(
  platform: ExportPlatform,
  presetId: string
): string {
  const cwd = process.cwd();

  switch (platform) {
    case "claude-code":
      return path.join(cwd, ".claude", "agents", `${presetId}.md`);
    case "cursor":
      return path.join(cwd, ".cursor", "rules", `${presetId}.mdc`);
    case "gemini-cli":
      return path.join(cwd, ".gemini", "agents", `${presetId}.agent.json`);
    case "mcp":
      return path.join(cwd, ".config", "mcp", `${presetId}.json`);
    default:
      return path.join(cwd, `${presetId}.txt`);
  }
}
