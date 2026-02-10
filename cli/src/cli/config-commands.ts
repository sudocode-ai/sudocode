/**
 * CLI handlers for config commands
 */

import chalk from "chalk";
import type Database from "better-sqlite3";
import {
  getConfig,
  getProjectConfig,
  getLocalConfig,
  updateProjectConfig,
  updateLocalConfig,
  PROJECT_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
} from "../config.js";
import type { StorageMode, Config, ProjectConfig, LocalConfig } from "@sudocode-ai/types";

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

/**
 * Valid values for sourceOfTruth config option
 */
const VALID_SOURCE_OF_TRUTH: StorageMode[] = ["jsonl", "markdown"];

export interface ConfigGetOptions {
  jsonOutput?: boolean;
}

export interface ConfigSetOptions {
  jsonOutput?: boolean;
}

/**
 * Handle config get command
 */
export async function handleConfigGet(
  ctx: CommandContext,
  key: string | undefined,
  options: ConfigGetOptions
): Promise<void> {
  const jsonOutput = options.jsonOutput || ctx.jsonOutput;

  if (!key) {
    // Show all config
    const config = getConfig(ctx.outputDir);
    const projectConfig = getProjectConfig(ctx.outputDir);
    const localConfig = getLocalConfig(ctx.outputDir);

    if (jsonOutput) {
      console.log(JSON.stringify({ config, projectConfig, localConfig }, null, 2));
      return;
    }

    console.log(chalk.bold("Project Config") + chalk.gray(` (${PROJECT_CONFIG_FILE} - git-tracked)`));
    console.log(JSON.stringify(projectConfig, null, 2));
    console.log();
    console.log(chalk.bold("Local Config") + chalk.gray(` (${LOCAL_CONFIG_FILE} - gitignored)`));
    console.log(JSON.stringify(localConfig, null, 2));
    return;
  }

  // Get specific key
  const config = getConfig(ctx.outputDir);
  const value = getNestedValue(config, key);

  if (value === undefined) {
    if (jsonOutput) {
      console.log(JSON.stringify({ key, value: null }));
    } else {
      console.log(chalk.yellow(`Config key '${key}' is not set`));
    }
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ key, value }));
  } else {
    if (typeof value === "object") {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(value);
    }
  }
}

/**
 * Handle config set command
 */
export async function handleConfigSet(
  ctx: CommandContext,
  key: string,
  value: string,
  options: ConfigSetOptions
): Promise<void> {
  const jsonOutput = options.jsonOutput || ctx.jsonOutput;

  // Special handling for sourceOfTruth
  if (key === "sourceOfTruth") {
    if (!VALID_SOURCE_OF_TRUTH.includes(value as StorageMode)) {
      const error = `Invalid value '${value}' for sourceOfTruth. Valid values: ${VALID_SOURCE_OF_TRUTH.join(", ")}`;
      if (jsonOutput) {
        console.log(JSON.stringify({ error }));
      } else {
        console.error(chalk.red(`Error: ${error}`));
      }
      process.exit(1);
    }

    updateProjectConfig(ctx.outputDir, { sourceOfTruth: value as StorageMode });

    if (jsonOutput) {
      console.log(JSON.stringify({ key, value, file: PROJECT_CONFIG_FILE }));
    } else {
      console.log(chalk.green(`Set ${key} = ${value}`));
      console.log(chalk.gray(`  Updated ${PROJECT_CONFIG_FILE} (git-tracked)`));

      if (value === "markdown") {
        console.log();
        console.log(chalk.yellow("Note: Markdown is now the source of truth."));
        console.log(chalk.gray("  - Deleting .md files will delete entities"));
        console.log(chalk.gray("  - JSONL files are derived (still exported for git tracking)"));
        console.log(chalk.gray("  - Run 'sudocode sync' to ensure files are in sync"));
      }
    }
    return;
  }

  // For other keys, determine which config file to use
  const projectKeys = ["sourceOfTruth", "integrations"];
  const localKeys = ["worktree", "editor", "voice"];

  const isProjectKey = projectKeys.includes(key) || key.startsWith("integrations.");
  const isLocalKey = localKeys.includes(key) ||
    key.startsWith("worktree.") ||
    key.startsWith("editor.") ||
    key.startsWith("voice.");

  if (!isProjectKey && !isLocalKey) {
    const error = `Unknown config key '${key}'. Valid keys: ${[...projectKeys, ...localKeys].join(", ")}`;
    if (jsonOutput) {
      console.log(JSON.stringify({ error }));
    } else {
      console.error(chalk.red(`Error: ${error}`));
    }
    process.exit(1);
  }

  // Parse the value (try JSON first, then use as string)
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(value);
  } catch {
    parsedValue = value;
  }

  // Handle nested keys
  if (isProjectKey) {
    const config = getProjectConfig(ctx.outputDir);
    setNestedValue(config, key, parsedValue);
    updateProjectConfig(ctx.outputDir, config);

    if (jsonOutput) {
      console.log(JSON.stringify({ key, value: parsedValue, file: PROJECT_CONFIG_FILE }));
    } else {
      console.log(chalk.green(`Set ${key} = ${JSON.stringify(parsedValue)}`));
      console.log(chalk.gray(`  Updated ${PROJECT_CONFIG_FILE} (git-tracked)`));
    }
  } else {
    const config = getLocalConfig(ctx.outputDir);
    setNestedValue(config, key, parsedValue);
    updateLocalConfig(ctx.outputDir, config);

    if (jsonOutput) {
      console.log(JSON.stringify({ key, value: parsedValue, file: LOCAL_CONFIG_FILE }));
    } else {
      console.log(chalk.green(`Set ${key} = ${JSON.stringify(parsedValue)}`));
      console.log(chalk.gray(`  Updated ${LOCAL_CONFIG_FILE} (gitignored)`));
    }
  }
}

/**
 * Handle config show command (show current source of truth info)
 */
export async function handleConfigShow(
  ctx: CommandContext,
  options: ConfigGetOptions
): Promise<void> {
  const jsonOutput = options.jsonOutput || ctx.jsonOutput;
  const config = getConfig(ctx.outputDir);
  const sourceOfTruth = config.sourceOfTruth || "jsonl";

  if (jsonOutput) {
    console.log(JSON.stringify({ sourceOfTruth }));
    return;
  }

  console.log(chalk.bold("Source of Truth: ") + chalk.cyan(sourceOfTruth));
  console.log();

  if (sourceOfTruth === "jsonl") {
    console.log(chalk.gray("JSONL files are authoritative:"));
    console.log(chalk.gray("  - specs.jsonl, issues.jsonl contain the source data"));
    console.log(chalk.gray("  - Markdown files (.md) are derived from JSONL"));
    console.log(chalk.gray("  - Deleting .md files does NOT delete entities"));
  } else {
    console.log(chalk.gray("Markdown files are authoritative:"));
    console.log(chalk.gray("  - .md files contain the source data"));
    console.log(chalk.gray("  - JSONL files are derived (exported for git tracking)"));
    console.log(chalk.gray("  - Deleting .md files WILL delete entities"));
  }
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Config | ProjectConfig | LocalConfig, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj: ProjectConfig | LocalConfig, path: string, value: unknown): void {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}
