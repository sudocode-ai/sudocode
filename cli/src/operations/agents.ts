/**
 * Operations for Agent Presets
 * Agent presets are stored as .agent.md files in .sudocode/agents/presets/
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentPreset, AgentConfig } from "@sudocode-ai/types";
import {
  parseAgentPresetFile,
  createAgentPresetFile,
  validateAgentPreset,
} from "../markdown.js";

export interface CreateAgentPresetInput {
  id: string;
  name: string;
  description: string;
  version?: string;
  agent_type?: string;
  model?: string;
  tools?: string[];
  mcp_servers?: string[];
  max_context_tokens?: number;
  isolation_mode?: "subagent" | "isolated" | "shared";
  hooks?: {
    before_execution?: string[];
    after_execution?: string[];
    on_error?: string[];
  };
  variables?: Record<string, any>;
  platform_configs?: Record<string, any>;
  capabilities?: string[];
  protocols?: string[];
  tags?: string[];
  system_prompt?: string;
}

export interface ListAgentPresetsOptions {
  tag?: string;
  agent_type?: string;
  capability?: string;
}

/**
 * Get the agents directory path for a sudocode directory
 */
export function getAgentsDir(sudocodeDir: string): string {
  return path.join(sudocodeDir, "agents");
}

/**
 * Get the presets directory path
 */
export function getPresetsDir(sudocodeDir: string): string {
  return path.join(getAgentsDir(sudocodeDir), "presets");
}

/**
 * Get the hooks directory path
 */
export function getHooksDir(sudocodeDir: string): string {
  return path.join(getAgentsDir(sudocodeDir), "hooks");
}

/**
 * Get agent configuration file path
 */
export function getAgentConfigPath(sudocodeDir: string): string {
  return path.join(getAgentsDir(sudocodeDir), "config.json");
}

/**
 * Get hooks configuration file path
 */
export function getHooksConfigPath(sudocodeDir: string): string {
  return path.join(getHooksDir(sudocodeDir), "hooks.config.json");
}

/**
 * Initialize agents directory structure
 */
export function initializeAgentsDirectory(sudocodeDir: string): void {
  const agentsDir = getAgentsDir(sudocodeDir);
  const presetsDir = getPresetsDir(sudocodeDir);
  const hooksDir = getHooksDir(sudocodeDir);

  // Create directories
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  if (!fs.existsSync(presetsDir)) {
    fs.mkdirSync(presetsDir, { recursive: true });
  }
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Create default config.json if it doesn't exist
  const configPath = getAgentConfigPath(sudocodeDir);
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      version: "1.0.0",
      defaults: {
        agent_type: "claude-code",
        model: "claude-sonnet-4-5",
        isolation_mode: "subagent",
        max_context_tokens: 200000,
        allow_tool_defaults: false,
      },
      execution: {
        auto_claim_issues: true,
        max_concurrent_executions: 3,
        worktree_mode: "auto",
        cleanup_on_complete: false,
      },
      hooks: {
        enabled: false,
        timeout_ms: 30000,
        retry_on_failure: true,
        max_retries: 3,
      },
      interoperability: {
        mcp_enabled: true,
        a2a_enabled: false,
        export_formats: ["claude-code", "cursor", "gemini-cli"],
      },
      security: {
        require_approval_for_tools: ["Bash", "Write", "Edit"],
        sandbox_executions: true,
        audit_log_enabled: true,
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  }

  // Create default hooks.config.json if it doesn't exist
  const hooksConfigPath = getHooksConfigPath(sudocodeDir);
  if (!fs.existsSync(hooksConfigPath)) {
    const defaultHooksConfig = {
      version: "1.0.0",
      hooks: [],
      global_env: {
        SUDOCODE_DIR: "${REPO_ROOT}/.sudocode",
        SUDOCODE_ISSUE_ID: "${EXECUTION_ISSUE_ID}",
        SUDOCODE_EXECUTION_ID: "${EXECUTION_ID}",
      },
    };
    fs.writeFileSync(
      hooksConfigPath,
      JSON.stringify(defaultHooksConfig, null, 2)
    );
  }

  // Create README in presets directory
  const readmePath = path.join(presetsDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    const readme = `# Agent Presets

This directory contains agent preset definitions for sudocode.

## Creating a New Preset

Use the CLI to create a new preset:

\`\`\`bash
sudocode agent create <preset-id> --name "Agent Name" --description "Description"
\`\`\`

Or create a file manually with the format:

\`\`\`markdown
---
id: my-agent
name: My Agent
description: What this agent does
version: 1.0.0
agent_type: claude-code
model: claude-sonnet-4-5
tools:
  - Read
  - Grep
  - Glob
---

# System Prompt

Your agent instructions here...
\`\`\`

## Using Presets

Execute an issue with a preset:

\`\`\`bash
sudocode execute ISSUE-001 --agent code-reviewer
\`\`\`

## Available Presets

- See \`.agent.md\` files in this directory
`;
    fs.writeFileSync(readmePath, readme);
  }
}

/**
 * Create a new agent preset
 */
export function createAgentPreset(
  sudocodeDir: string,
  input: CreateAgentPresetInput
): AgentPreset {
  const presetsDir = getPresetsDir(sudocodeDir);

  // Ensure presets directory exists
  if (!fs.existsSync(presetsDir)) {
    initializeAgentsDirectory(sudocodeDir);
  }

  // Build file path
  const fileName = `${input.id}.agent.md`;
  const filePath = path.join(presetsDir, fileName);

  // Check if preset already exists
  if (fs.existsSync(filePath)) {
    throw new Error(`Agent preset already exists: ${input.id}`);
  }

  // Build AgentConfig
  const config: AgentConfig = {
    preset_id: input.id,
    agent_type: (input.agent_type as any) || "claude-code",
    model: input.model,
    tools: input.tools,
    mcp_servers: input.mcp_servers,
    max_context_tokens: input.max_context_tokens,
    isolation_mode: input.isolation_mode,
    hooks: input.hooks,
    variables: input.variables,
    platform_configs: input.platform_configs,
    capabilities: input.capabilities,
    protocols: input.protocols,
    tags: input.tags,
  };

  // Create preset object
  const preset: Partial<AgentPreset> & {
    id: string;
    name: string;
    description: string;
  } = {
    id: input.id,
    name: input.name,
    description: input.description,
    version: input.version || "1.0.0",
    config,
    system_prompt: input.system_prompt,
  };

  // Create the file
  createAgentPresetFile(filePath, preset);

  // Read it back to get the complete preset with timestamps
  return parseAgentPresetFile(filePath);
}

/**
 * Get a specific agent preset by ID
 */
export function getAgentPreset(
  sudocodeDir: string,
  presetId: string
): AgentPreset | null {
  const presetsDir = getPresetsDir(sudocodeDir);
  const filePath = path.join(presetsDir, `${presetId}.agent.md`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return parseAgentPresetFile(filePath);
  } catch (error) {
    console.error(`Error parsing agent preset ${presetId}:`, error);
    return null;
  }
}

/**
 * List all agent presets
 */
export function listAgentPresets(
  sudocodeDir: string,
  options?: ListAgentPresetsOptions
): AgentPreset[] {
  const presetsDir = getPresetsDir(sudocodeDir);

  if (!fs.existsSync(presetsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(presetsDir)
    .filter((file) => file.endsWith(".agent.md"));

  const presets = files
    .map((file) => {
      const filePath = path.join(presetsDir, file);
      try {
        return parseAgentPresetFile(filePath);
      } catch (error) {
        console.error(`Error parsing ${file}:`, error);
        return null;
      }
    })
    .filter((preset): preset is AgentPreset => preset !== null);

  // Apply filters
  let filtered = presets;

  if (options?.tag) {
    filtered = filtered.filter(
      (preset) => preset.config.tags?.includes(options.tag!)
    );
  }

  if (options?.agent_type) {
    filtered = filtered.filter(
      (preset) => preset.config.agent_type === options.agent_type
    );
  }

  if (options?.capability) {
    filtered = filtered.filter(
      (preset) => preset.config.capabilities?.includes(options.capability!)
    );
  }

  return filtered;
}

/**
 * Delete an agent preset
 */
export function deleteAgentPreset(
  sudocodeDir: string,
  presetId: string
): boolean {
  const presetsDir = getPresetsDir(sudocodeDir);
  const filePath = path.join(presetsDir, `${presetId}.agent.md`);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}

/**
 * Validate all agent presets in a directory
 */
export function validateAgentPresets(
  sudocodeDir: string
): { preset: AgentPreset; errors: string[] }[] {
  const presets = listAgentPresets(sudocodeDir);

  return presets.map((preset) => ({
    preset,
    errors: validateAgentPreset(preset),
  }));
}

/**
 * Check if agents directory is initialized
 */
export function isAgentsDirectoryInitialized(sudocodeDir: string): boolean {
  const agentsDir = getAgentsDir(sudocodeDir);
  const presetsDir = getPresetsDir(sudocodeDir);
  const configPath = getAgentConfigPath(sudocodeDir);

  return (
    fs.existsSync(agentsDir) &&
    fs.existsSync(presetsDir) &&
    fs.existsSync(configPath)
  );
}

/**
 * Get path to template presets directory
 */
function getTemplatePresetsDir(): string {
  // Templates are in cli/templates/agents/presets/
  // This file is in cli/dist/operations/agents.js
  // So we need to go up to cli/templates/
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  return path.join(currentDir, "..", "..", "templates", "agents", "presets");
}

/**
 * Install default agent presets from templates
 * @param sudocodeDir - Sudocode directory
 * @param options - Installation options
 * @returns List of installed preset IDs
 */
export function installDefaultPresets(
  sudocodeDir: string,
  options?: {
    overwrite?: boolean;
    presets?: string[]; // Specific presets to install, or all if not specified
  }
): string[] {
  const presetsDir = getPresetsDir(sudocodeDir);
  const templatesDir = getTemplatePresetsDir();

  // Ensure presets directory exists
  if (!fs.existsSync(presetsDir)) {
    initializeAgentsDirectory(sudocodeDir);
  }

  // Check if templates directory exists
  if (!fs.existsSync(templatesDir)) {
    throw new Error(`Template presets directory not found: ${templatesDir}`);
  }

  // Get list of template files
  const templateFiles = fs
    .readdirSync(templatesDir)
    .filter((file) => file.endsWith(".agent.md"));

  const installed: string[] = [];
  const overwrite = options?.overwrite ?? false;
  const specificPresets = options?.presets;

  for (const templateFile of templateFiles) {
    const presetId = templateFile.replace(".agent.md", "");

    // Skip if specific presets requested and this isn't one of them
    if (specificPresets && !specificPresets.includes(presetId)) {
      continue;
    }

    const sourcePath = path.join(templatesDir, templateFile);
    const destPath = path.join(presetsDir, templateFile);

    // Skip if file exists and overwrite is false
    if (fs.existsSync(destPath) && !overwrite) {
      continue;
    }

    // Copy template to presets directory
    fs.copyFileSync(sourcePath, destPath);
    installed.push(presetId);
  }

  return installed;
}

/**
 * List available default presets from templates
 * @returns List of default preset IDs
 */
export function listDefaultPresets(): string[] {
  const templatesDir = getTemplatePresetsDir();

  if (!fs.existsSync(templatesDir)) {
    return [];
  }

  return fs
    .readdirSync(templatesDir)
    .filter((file) => file.endsWith(".agent.md"))
    .map((file) => file.replace(".agent.md", ""));
}
