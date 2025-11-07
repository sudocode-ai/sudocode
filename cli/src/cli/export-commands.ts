/**
 * CLI handlers for export commands
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import {
  exportAgentPreset,
  exportAllPresets,
  getRecommendedExportPath,
  type ExportPlatform,
} from "../operations/export.js";

export interface ExportOptions {
  dir?: string;
  platform: string;
  output?: string;
  all?: boolean;
  overwrite?: boolean;
  jsonOutput?: boolean;
}

/**
 * Get sudocode directory
 */
function getSudocodeDir(dir?: string): string {
  if (dir) {
    return dir;
  }

  // Look for .sudocode directory starting from current directory
  let currentDir = process.cwd();
  while (currentDir !== path.parse(currentDir).root) {
    const sudocodeDir = path.join(currentDir, ".sudocode");
    if (fs.existsSync(sudocodeDir)) {
      return sudocodeDir;
    }
    currentDir = path.dirname(currentDir);
  }

  // Default to .sudocode in current directory
  return path.join(process.cwd(), ".sudocode");
}

/**
 * Handle agent export command
 */
export async function handleAgentExport(
  presetId: string,
  options: ExportOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;
    const platform = options.platform as ExportPlatform;

    // Validate platform
    const validPlatforms: ExportPlatform[] = [
      "claude-code",
      "cursor",
      "gemini-cli",
      "mcp",
    ];
    if (!validPlatforms.includes(platform)) {
      if (jsonOutput) {
        console.error(
          JSON.stringify({
            error: `Invalid platform: ${platform}. Valid platforms: ${validPlatforms.join(", ")}`,
          })
        );
      } else {
        console.error(chalk.red("✗ Invalid platform:"), chalk.cyan(platform));
        console.error(
          chalk.gray(
            `Valid platforms: ${validPlatforms.join(", ")}`
          )
        );
      }
      process.exit(1);
    }

    // Export preset
    const result = exportAgentPreset(sudocodeDir, presetId, {
      platform,
      outputPath: options.output,
      overwrite: options.overwrite,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) {
        process.exit(1);
      }
      return;
    }

    if (!result.success) {
      console.error(chalk.red("✗ Export failed"));
      console.error(chalk.gray(`  ${result.error}`));
      process.exit(1);
    }

    console.log(
      chalk.green("✓ Exported agent preset:"),
      chalk.cyan(presetId)
    );
    console.log(chalk.gray(`  Platform: ${platform}`));
    console.log(chalk.gray(`  Output: ${result.outputPath}`));

    // Show usage hint based on platform
    showPlatformHint(platform, result.outputPath);
  } catch (error) {
    if (options.jsonOutput) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("✗ Export failed"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle export all command
 */
export async function handleAgentExportAll(
  options: ExportOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;
    const platform = options.platform as ExportPlatform;

    // Validate platform
    const validPlatforms: ExportPlatform[] = [
      "claude-code",
      "cursor",
      "gemini-cli",
      "mcp",
    ];
    if (!validPlatforms.includes(platform)) {
      if (jsonOutput) {
        console.error(
          JSON.stringify({
            error: `Invalid platform: ${platform}. Valid platforms: ${validPlatforms.join(", ")}`,
          })
        );
      } else {
        console.error(chalk.red("✗ Invalid platform:"), chalk.cyan(platform));
        console.error(
          chalk.gray(
            `Valid platforms: ${validPlatforms.join(", ")}`
          )
        );
      }
      process.exit(1);
    }

    // Export all presets
    const results = exportAllPresets(sudocodeDir, platform, {
      outputDir: options.output,
      overwrite: options.overwrite,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
      if (results.some((r) => !r.success)) {
        process.exit(1);
      }
      return;
    }

    // Display results
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length > 0) {
      console.log(
        chalk.green(`✓ Exported ${successful.length} preset(s):`)
      );
      for (const result of successful) {
        const presetId = path.basename(result.outputPath).split(".")[0];
        console.log(chalk.gray(`  - ${presetId} → ${result.outputPath}`));
      }
    }

    if (failed.length > 0) {
      console.log(chalk.red(`\n✗ Failed to export ${failed.length} preset(s):`));
      for (const result of failed) {
        console.log(chalk.gray(`  - ${result.error}`));
      }
      process.exit(1);
    }

    // Show usage hint
    if (successful.length > 0) {
      showPlatformHint(platform, path.dirname(successful[0].outputPath));
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("✗ Export failed"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Show platform-specific usage hints
 */
function showPlatformHint(platform: ExportPlatform, outputPath: string): void {
  console.log();

  switch (platform) {
    case "claude-code":
      console.log(chalk.bold("Claude Code Usage:"));
      console.log(
        chalk.gray("  1. Restart Claude Code to load the new agent")
      );
      console.log(
        chalk.gray("  2. Use /agents command to see available agents")
      );
      console.log(
        chalk.gray(
          "  3. Invoke with: 'Use the <agent-name> subagent to...'"
        )
      );
      break;

    case "cursor":
      console.log(chalk.bold("Cursor Usage:"));
      console.log(chalk.gray("  1. Restart Cursor to load the new rule"));
      console.log(
        chalk.gray("  2. Rules are applied automatically based on globs")
      );
      console.log(chalk.gray("  3. Or reference with @ruleName in chat"));
      break;

    case "gemini-cli":
      console.log(chalk.bold("Gemini CLI Usage:"));
      console.log(
        chalk.gray("  1. Add to .gemini/settings.json agents array")
      );
      console.log(
        chalk.gray("  2. Use: gemini --agent <agent-id> <prompt>")
      );
      break;

    case "mcp":
      console.log(chalk.bold("MCP Server Usage:"));
      console.log(
        chalk.gray(
          "  1. Add the config to Claude Desktop's config.json"
        )
      );
      console.log(
        chalk.gray("  2. Location: ~/Library/Application Support/Claude/")
      );
      console.log(chalk.gray("  3. Restart Claude Desktop"));
      break;
  }
}
