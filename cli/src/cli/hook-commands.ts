/**
 * CLI handlers for hook commands
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import {
  listHooks,
  addHook,
  removeHook,
  validateHook,
  executeHook,
  loadHooksConfig,
  type HookExecutionContext,
} from "../operations/hooks.js";
import type { HookConfig, HookEvent } from "@sudocode-ai/types";

export interface HookListOptions {
  dir?: string;
  event?: string;
  jsonOutput?: boolean;
}

export interface HookAddOptions {
  dir?: string;
  event: string;
  type: string;
  command: string;
  matcher?: string;
  matcherType?: string;
  timeout?: string;
  required?: boolean;
  onFailure?: string;
  jsonOutput?: boolean;
}

export interface HookRemoveOptions {
  dir?: string;
  jsonOutput?: boolean;
}

export interface HookTestOptions {
  dir?: string;
  presetId?: string;
  issueId?: string;
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
 * Handle hook list command
 */
export async function handleHookList(
  options: HookListOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    const hooks = listHooks(sudocodeDir, {
      event: options.event as HookEvent | undefined,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(hooks, null, 2));
      return;
    }

    if (hooks.length === 0) {
      console.log(chalk.yellow("No hooks configured."));
      return;
    }

    console.log(chalk.bold(`\nConfigured Hooks (${hooks.length}):\n`));

    for (const hook of hooks) {
      console.log(chalk.cyan(`  ${hook.id}`));
      console.log(chalk.gray(`    Event: ${hook.event}`));
      console.log(chalk.gray(`    Type: ${hook.type}`));
      console.log(chalk.gray(`    Command: ${hook.command}`));

      if (hook.matcher) {
        console.log(
          chalk.gray(
            `    Matcher: ${hook.matcher.type} "${hook.matcher.pattern}"`
          )
        );
      }

      if (hook.required) {
        console.log(
          chalk.gray(`    Required: yes (on_failure: ${hook.on_failure})`)
        );
      }

      console.log();
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("✗ Failed to list hooks"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle hook add command
 */
export async function handleHookAdd(
  hookId: string,
  options: HookAddOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    // Build hook config
    const hook: HookConfig = {
      id: hookId,
      event: options.event as HookEvent,
      type: options.type as "command" | "plugin",
      command: options.command,
    };

    // Add optional fields
    if (options.matcher && options.matcherType) {
      hook.matcher = {
        type: options.matcherType as any,
        pattern: options.matcher,
      };
    }

    if (options.timeout) {
      hook.timeout_ms = parseInt(options.timeout);
    }

    if (options.required !== undefined) {
      hook.required = options.required;
    }

    if (options.onFailure) {
      hook.on_failure = options.onFailure as any;
    }

    // Validate hook
    const errors = validateHook(sudocodeDir, hook);
    if (errors.length > 0) {
      if (jsonOutput) {
        console.error(JSON.stringify({ errors }));
      } else {
        console.error(chalk.red("✗ Invalid hook configuration:"));
        for (const error of errors) {
          console.error(chalk.gray(`  - ${error}`));
        }
      }
      process.exit(1);
    }

    // Add hook
    addHook(sudocodeDir, hook);

    if (jsonOutput) {
      console.log(JSON.stringify({ hookId, success: true }));
    } else {
      console.log(chalk.green("✓ Added hook:"), chalk.cyan(hookId));
      console.log(chalk.gray(`  Event: ${hook.event}`));
      console.log(chalk.gray(`  Command: ${hook.command}`));
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("✗ Failed to add hook"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle hook remove command
 */
export async function handleHookRemove(
  hookId: string,
  options: HookRemoveOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    const removed = removeHook(sudocodeDir, hookId);

    if (!removed) {
      if (jsonOutput) {
        console.error(JSON.stringify({ error: "Hook not found" }));
      } else {
        console.error(chalk.red("✗ Hook not found:"), chalk.cyan(hookId));
      }
      process.exit(1);
    }

    if (jsonOutput) {
      console.log(JSON.stringify({ hookId, success: true }));
    } else {
      console.log(chalk.green("✓ Removed hook:"), chalk.cyan(hookId));
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("✗ Failed to remove hook"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Handle hook test command
 */
export async function handleHookTest(
  hookId: string,
  options: HookTestOptions
): Promise<void> {
  try {
    const sudocodeDir = getSudocodeDir(options.dir);
    const jsonOutput = options.jsonOutput || false;

    // Load hooks config
    const config = loadHooksConfig(sudocodeDir);
    const hook = config.hooks.find((h) => h.id === hookId);

    if (!hook) {
      if (jsonOutput) {
        console.error(JSON.stringify({ error: "Hook not found" }));
      } else {
        console.error(chalk.red("✗ Hook not found:"), chalk.cyan(hookId));
      }
      process.exit(1);
    }

    if (!jsonOutput) {
      console.log(chalk.blue(`Testing hook: ${hookId}...`));
    }

    // Build test context
    const context: HookExecutionContext = {
      event: hook.event,
      sudocodeDir,
      presetId: options.presetId,
      issueId: options.issueId,
    };

    // Execute hook
    const result = await executeHook(hook, context);

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) {
        process.exit(1);
      }
      return;
    }

    // Display result
    if (result.success) {
      console.log(chalk.green("✓ Hook executed successfully"));
      console.log(chalk.gray(`  Duration: ${result.duration}ms`));

      if (result.stdout) {
        console.log(chalk.bold("\nStdout:"));
        console.log(result.stdout);
      }
    } else {
      console.log(chalk.red("✗ Hook execution failed"));
      console.log(chalk.gray(`  Duration: ${result.duration}ms`));

      if (result.error) {
        console.log(chalk.red(`  Error: ${result.error}`));
      }

      if (result.exitCode !== undefined) {
        console.log(chalk.gray(`  Exit code: ${result.exitCode}`));
      }

      if (result.stderr) {
        console.log(chalk.bold("\nStderr:"));
        console.log(result.stderr);
      }

      process.exit(1);
    }
  } catch (error) {
    if (options.jsonOutput) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("✗ Failed to test hook"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}
