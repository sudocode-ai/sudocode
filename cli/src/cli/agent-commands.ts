/**
 * CLI handlers for agent commands
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import {
  createAgentPreset,
  getAgentPreset,
  listAgentPresets,
  deleteAgentPreset,
  validateAgentPresets,
  isAgentsDirectoryInitialized,
  initializeAgentsDirectory,
  type CreateAgentPresetInput,
  type ListAgentPresetsOptions,
} from "../operations/agents.js";
import type { AgentPreset } from "@sudocode-ai/types";

export interface AgentCreateOptions {
  dir?: string;
  name?: string;
  description?: string;
  agentType?: string;
  model?: string;
  tools?: string;
  mcpServers?: string;
  template?: string;
  interactive?: boolean;
  jsonOutput?: boolean;
}

export interface AgentListOptions {
  dir?: string;
  verbose?: boolean;
  tag?: string;
  type?: string;
  jsonOutput?: boolean;
}

export interface AgentShowOptions {
  dir?: string;
  format?: "text" | "json" | "yaml";
  jsonOutput?: boolean;
}

export interface AgentValidateOptions {
  dir?: string;
  all?: boolean;
  fix?: boolean;
  jsonOutput?: boolean;
}

export interface AgentDeleteOptions {
  dir?: string;
  force?: boolean;
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
 * Ensure agents directory is initialized
 */
function ensureAgentsDirectory(sudocodeDir: string, jsonOutput: boolean): void {
  if (!isAgentsDirectoryInitialized(sudocodeDir)) {
    if (!jsonOutput) {
      console.log(
        chalk.yellow("Agents directory not initialized. Initializing...")
      );
    }
    initializeAgentsDirectory(sudocodeDir);
  }
}

/**
 * Get template content for common agent types
 */
function getTemplateContent(
  template: string,
  name: string,
  description: string
): { tools?: string[]; system_prompt?: string } {
  const templates: Record<
    string,
    { tools: string[]; system_prompt: string }
  > = {
    reviewer: {
      tools: ["Read", "Grep", "Glob"],
      system_prompt: `# System Prompt

You are ${name}, a code review agent.

${description}

## Your Role

1. **Analyze code changes** - Review diffs for:
   - Logic errors and bugs
   - Security vulnerabilities
   - Performance issues
   - Code style and readability

2. **Provide actionable feedback** - Write clear, constructive comments
3. **Respect project conventions** - Check project guidelines and patterns
4. **Focus on high-impact issues** - Prioritize critical problems
5. **Never modify code** - You are read-only

## Review Process

1. Read the issue description and linked specs for context
2. Examine changed files using git diff
3. Search for related code that might be affected
4. Check for test coverage
5. Document findings in structured feedback
`,
    },
    tester: {
      tools: ["Read", "Write", "Grep", "Glob", "Bash"],
      system_prompt: `# System Prompt

You are ${name}, a test writing agent.

${description}

## Your Role

1. **Write comprehensive tests** - Create unit and integration tests
2. **Follow TDD practices** - Write tests before implementation when appropriate
3. **Ensure coverage** - Aim for high test coverage of critical paths
4. **Use best practices** - Follow testing conventions for the project

## Testing Process

1. Read the implementation code and requirements
2. Identify test cases (happy path, edge cases, errors)
3. Write clear, maintainable test code
4. Run tests to verify they work
5. Update test documentation
`,
    },
    refactorer: {
      tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"],
      system_prompt: `# System Prompt

You are ${name}, a code refactoring agent.

${description}

## Your Role

1. **Improve code quality** - Refactor for clarity and maintainability
2. **Preserve behavior** - Ensure refactoring doesn't change functionality
3. **Follow patterns** - Use established patterns from the codebase
4. **Run tests** - Verify tests pass after refactoring

## Refactoring Process

1. Read and understand the code to be refactored
2. Identify specific improvements
3. Make incremental changes
4. Run tests after each change
5. Document the rationale for changes
`,
    },
    documenter: {
      tools: ["Read", "Write", "Edit", "Grep", "Glob"],
      system_prompt: `# System Prompt

You are ${name}, a documentation agent.

${description}

## Your Role

1. **Write clear documentation** - Create and update docs
2. **Explain complex concepts** - Make technical content accessible
3. **Maintain consistency** - Follow documentation standards
4. **Include examples** - Provide code examples where helpful

## Documentation Process

1. Read the code and existing documentation
2. Identify gaps or outdated content
3. Write or update documentation
4. Add code examples and diagrams
5. Review for clarity and completeness
`,
    },
  };

  return templates[template] || {};
}

/**
 * Handle agent create command
 */
export async function handleAgentCreate(
  presetId: string,
  options: AgentCreateOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    ensureAgentsDirectory(sudocodeDir, jsonOutput);

    // Build input from options
    const input: CreateAgentPresetInput = {
      id: presetId,
      name: options.name || presetId,
      description: options.description || `Agent preset: ${presetId}`,
      agent_type: options.agentType || "claude-code",
      model: options.model,
      tools: options.tools ? options.tools.split(",").map((t) => t.trim()) : undefined,
      mcp_servers: options.mcpServers ? options.mcpServers.split(",").map((s) => s.trim()) : undefined,
    };

    // Apply template if specified
    if (options.template) {
      const templateContent = getTemplateContent(
        options.template,
        input.name,
        input.description
      );
      if (templateContent.tools) {
        input.tools = templateContent.tools;
      }
      if (templateContent.system_prompt) {
        input.system_prompt = templateContent.system_prompt;
      }
    }

    // Create the preset
    const preset = createAgentPreset(sudocodeDir, input);

    if (jsonOutput) {
      console.log(JSON.stringify(preset, null, 2));
    } else {
      console.log(chalk.green("✓ Created agent preset:"), chalk.cyan(preset.id));
      console.log(chalk.gray(`  Name: ${preset.name}`));
      console.log(chalk.gray(`  Description: ${preset.description}`));
      console.log(chalk.gray(`  Type: ${preset.config.agent_type}`));
      console.log(chalk.gray(`  File: ${preset.file_path}`));
      console.log();
      console.log(
        chalk.gray("Edit the preset file to customize the system prompt:")
      );
      console.log(chalk.cyan(`  ${preset.file_path}`));
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } else {
      console.error(chalk.red("✗ Failed to create agent preset"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle agent list command
 */
export async function handleAgentList(
  options: AgentListOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    if (!isAgentsDirectoryInitialized(sudocodeDir)) {
      if (jsonOutput) {
        console.log(JSON.stringify([]));
      } else {
        console.log(
          chalk.yellow("No agent presets found. Create one with:"),
          chalk.cyan("sudocode agent create")
        );
      }
      return;
    }

    const listOptions: ListAgentPresetsOptions = {
      tag: options.tag,
      agent_type: options.type,
    };

    const presets = listAgentPresets(sudocodeDir, listOptions);

    if (jsonOutput) {
      console.log(JSON.stringify(presets, null, 2));
      return;
    }

    if (presets.length === 0) {
      console.log(
        chalk.yellow("No agent presets found matching the filters.")
      );
      return;
    }

    console.log(chalk.bold(`\nAgent Presets (${presets.length}):\n`));

    for (const preset of presets) {
      console.log(chalk.cyan(`  ${preset.id}`));
      console.log(chalk.gray(`    Name: ${preset.name}`));
      console.log(chalk.gray(`    Description: ${preset.description}`));
      console.log(chalk.gray(`    Type: ${preset.config.agent_type}`));

      if (options.verbose) {
        console.log(chalk.gray(`    Version: ${preset.version}`));
        if (preset.config.model) {
          console.log(chalk.gray(`    Model: ${preset.config.model}`));
        }
        if (preset.config.tools && preset.config.tools.length > 0) {
          console.log(
            chalk.gray(`    Tools: ${preset.config.tools.join(", ")}`)
          );
        }
        if (preset.config.tags && preset.config.tags.length > 0) {
          console.log(chalk.gray(`    Tags: ${preset.config.tags.join(", ")}`));
        }
        console.log(chalk.gray(`    File: ${preset.file_path}`));
      }
      console.log();
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } else {
      console.error(chalk.red("✗ Failed to list agent presets"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle agent show command
 */
export async function handleAgentShow(
  presetId: string,
  options: AgentShowOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;
    const format = options.format || "text";

    const preset = getAgentPreset(sudocodeDir, presetId);

    if (!preset) {
      if (jsonOutput || format === "json") {
        console.error(JSON.stringify({ error: "Agent preset not found" }));
      } else {
        console.error(
          chalk.red("✗ Agent preset not found:"),
          chalk.cyan(presetId)
        );
      }
      process.exit(1);
    }

    if (format === "json") {
      console.log(JSON.stringify(preset, null, 2));
      return;
    }

    if (format === "yaml") {
      // Simple YAML output (without dependencies)
      console.log("---");
      console.log(`id: ${preset.id}`);
      console.log(`name: ${preset.name}`);
      console.log(`description: ${preset.description}`);
      console.log(`version: ${preset.version}`);
      console.log(`agent_type: ${preset.config.agent_type}`);
      if (preset.config.model) {
        console.log(`model: ${preset.config.model}`);
      }
      if (preset.config.tools && preset.config.tools.length > 0) {
        console.log("tools:");
        preset.config.tools.forEach((tool) => console.log(`  - ${tool}`));
      }
      console.log("---");
      console.log();
      console.log(preset.system_prompt);
      return;
    }

    // Text format
    console.log(chalk.bold(`\nAgent Preset: ${preset.name}\n`));
    console.log(chalk.gray(`ID: ${preset.id}`));
    console.log(chalk.gray(`Version: ${preset.version}`));
    console.log(chalk.gray(`Description: ${preset.description}`));
    console.log(chalk.gray(`Type: ${preset.config.agent_type}`));

    if (preset.config.model) {
      console.log(chalk.gray(`Model: ${preset.config.model}`));
    }

    if (preset.config.tools && preset.config.tools.length > 0) {
      console.log(chalk.gray(`Tools: ${preset.config.tools.join(", ")}`));
    }

    if (preset.config.mcp_servers && preset.config.mcp_servers.length > 0) {
      console.log(
        chalk.gray(`MCP Servers: ${preset.config.mcp_servers.join(", ")}`)
      );
    }

    if (preset.config.tags && preset.config.tags.length > 0) {
      console.log(chalk.gray(`Tags: ${preset.config.tags.join(", ")}`));
    }

    console.log(chalk.gray(`File: ${preset.file_path}`));
    console.log(chalk.gray(`Created: ${preset.created_at}`));
    console.log(chalk.gray(`Updated: ${preset.updated_at}`));

    console.log(chalk.bold("\nSystem Prompt:\n"));
    console.log(preset.system_prompt);
    console.log();
  } catch (error) {
    if (options.jsonOutput) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } else {
      console.error(chalk.red("✗ Failed to show agent preset"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle agent validate command
 */
export async function handleAgentValidate(
  presetId: string | undefined,
  options: AgentValidateOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    if (!isAgentsDirectoryInitialized(sudocodeDir)) {
      if (jsonOutput) {
        console.log(JSON.stringify({ presets: [], valid: true }));
      } else {
        console.log(chalk.yellow("No agent presets to validate."));
      }
      return;
    }

    let results: { preset: AgentPreset; errors: string[] }[];

    if (options.all || !presetId) {
      // Validate all presets
      results = validateAgentPresets(sudocodeDir);
    } else {
      // Validate specific preset
      const preset = getAgentPreset(sudocodeDir, presetId);
      if (!preset) {
        if (jsonOutput) {
          console.error(JSON.stringify({ error: "Agent preset not found" }));
        } else {
          console.error(
            chalk.red("✗ Agent preset not found:"),
            chalk.cyan(presetId)
          );
        }
        process.exit(1);
      }

      const { validateAgentPreset } = await import("../markdown.js");
      results = [{ preset, errors: validateAgentPreset(preset) }];
    }

    if (jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    const totalPresets = results.length;
    const invalidPresets = results.filter((r) => r.errors.length > 0);

    console.log(
      chalk.bold(`\nValidated ${totalPresets} preset(s):\n`)
    );

    if (invalidPresets.length === 0) {
      console.log(chalk.green("✓ All presets are valid!"));
      return;
    }

    for (const result of invalidPresets) {
      console.log(chalk.red(`✗ ${result.preset.id}`));
      for (const error of result.errors) {
        console.log(chalk.gray(`    - ${error}`));
      }
      console.log();
    }

    console.log(
      chalk.yellow(
        `${invalidPresets.length} of ${totalPresets} preset(s) have validation errors.`
      )
    );

    process.exit(1);
  } catch (error) {
    if (options.jsonOutput) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } else {
      console.error(chalk.red("✗ Validation failed"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle agent delete command
 */
export async function handleAgentDelete(
  presetId: string,
  options: AgentDeleteOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    // Check if preset exists
    const preset = getAgentPreset(sudocodeDir, presetId);
    if (!preset) {
      if (jsonOutput) {
        console.error(JSON.stringify({ error: "Agent preset not found" }));
      } else {
        console.error(
          chalk.red("✗ Agent preset not found:"),
          chalk.cyan(presetId)
        );
      }
      process.exit(1);
    }

    // Delete the preset
    const deleted = deleteAgentPreset(sudocodeDir, presetId);

    if (!deleted) {
      if (jsonOutput) {
        console.error(JSON.stringify({ error: "Failed to delete preset" }));
      } else {
        console.error(chalk.red("✗ Failed to delete preset"));
      }
      process.exit(1);
    }

    if (jsonOutput) {
      console.log(JSON.stringify({ deleted: true, presetId }));
    } else {
      console.log(
        chalk.green("✓ Deleted agent preset:"),
        chalk.cyan(presetId)
      );
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } else {
      console.error(chalk.red("✗ Failed to delete agent preset"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

export interface AgentInstallOptions {
  dir?: string;
  overwrite?: boolean;
  presets?: string;
  jsonOutput?: boolean;
}

/**
 * Handle agent install-defaults command
 */
export async function handleAgentInstallDefaults(
  options: AgentInstallOptions
): Promise<void> {
  const { installDefaultPresets, listDefaultPresets } = await import("../operations/agents.js");
  
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    ensureAgentsDirectory(sudocodeDir, jsonOutput);

    // Parse presets option
    const specificPresets = options.presets
      ? options.presets.split(",").map((p) => p.trim())
      : undefined;

    // List available defaults
    const availableDefaults = listDefaultPresets();

    if (!jsonOutput) {
      console.log(chalk.blue("Available default presets:"));
      for (const preset of availableDefaults) {
        console.log(chalk.gray(`  - ${preset}`));
      }
      console.log();
    }

    // Install defaults
    const installed = installDefaultPresets(sudocodeDir, {
      overwrite: options.overwrite,
      presets: specificPresets,
    });

    if (jsonOutput) {
      console.log(
        JSON.stringify({ installed, available: availableDefaults })
      );
    } else {
      if (installed.length === 0) {
        console.log(
          chalk.yellow("No presets installed (already exist)."),
          chalk.gray("Use --overwrite to replace existing presets.")
        );
      } else {
        console.log(
          chalk.green(`✓ Installed ${installed.length} default preset(s):`)
        );
        for (const presetId of installed) {
          console.log(chalk.cyan(`  - ${presetId}`));
        }
      }
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("✗ Failed to install default presets"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}
