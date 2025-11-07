/**
 * Hook execution and management operations
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import type {
  HookConfig,
  HooksConfig,
  HookEvent,
  HookMatcherType,
  HookFailureBehavior,
} from "@sudocode-ai/types";
import { getHooksDir, getHooksConfigPath } from "./agents.js";

export interface HookExecutionContext {
  event: HookEvent;
  presetId?: string;
  issueId?: string;
  executionId?: string;
  sudocodeDir: string;
  [key: string]: any;
}

export interface HookExecutionResult {
  hookId: string;
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration: number;
}

/**
 * Load hooks configuration
 */
export function loadHooksConfig(sudocodeDir: string): HooksConfig {
  const configPath = getHooksConfigPath(sudocodeDir);

  if (!fs.existsSync(configPath)) {
    return {
      version: "1.0.0",
      hooks: [],
      global_env: {},
    };
  }

  const content = fs.readFileSync(configPath, "utf8");
  return JSON.parse(content);
}

/**
 * Save hooks configuration
 */
export function saveHooksConfig(
  sudocodeDir: string,
  config: HooksConfig
): void {
  const configPath = getHooksConfigPath(sudocodeDir);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Get hooks for a specific event
 */
export function getHooksForEvent(
  config: HooksConfig,
  event: HookEvent,
  context: HookExecutionContext
): HookConfig[] {
  return config.hooks.filter((hook) => {
    // Check if hook is for this event
    if (hook.event !== event) {
      return false;
    }

    // Check matcher if present
    if (hook.matcher && context.presetId) {
      return matchesPattern(
        context.presetId,
        hook.matcher.pattern,
        hook.matcher.type
      );
    }

    return true;
  });
}

/**
 * Check if a string matches a pattern
 */
function matchesPattern(
  value: string,
  pattern: string,
  type: HookMatcherType
): boolean {
  switch (type) {
    case "exact":
      return value === pattern;
    case "regex":
      try {
        const regex = new RegExp(pattern);
        return regex.test(value);
      } catch (error) {
        console.error(`Invalid regex pattern: ${pattern}`);
        return false;
      }
    case "wildcard":
      // Convert wildcard to regex: * -> .*, ? -> .
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
        .replace(/\*/g, ".*") // * -> .*
        .replace(/\?/g, "."); // ? -> .
      try {
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(value);
      } catch (error) {
        console.error(`Invalid wildcard pattern: ${pattern}`);
        return false;
      }
    default:
      return false;
  }
}

/**
 * Execute a single hook
 */
export async function executeHook(
  hook: HookConfig,
  context: HookExecutionContext
): Promise<HookExecutionResult> {
  const startTime = Date.now();

  try {
    if (hook.type === "command") {
      return await executeCommandHook(hook, context);
    } else if (hook.type === "plugin") {
      return await executePluginHook(hook, context);
    } else {
      throw new Error(`Unknown hook type: ${hook.type}`);
    }
  } catch (error) {
    return {
      hookId: hook.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute a command hook (shell script)
 */
async function executeCommandHook(
  hook: HookConfig,
  context: HookExecutionContext
): Promise<HookExecutionResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Build environment variables
    const config = loadHooksConfig(context.sudocodeDir);
    const env = {
      ...process.env,
      ...buildEnvironment(config.global_env || {}, context),
      ...buildEnvironment(hook.env || {}, context),
    };

    // Resolve hook command path (relative to hooks directory)
    const hooksDir = getHooksDir(context.sudocodeDir);
    const commandPath = path.isAbsolute(hook.command)
      ? hook.command
      : path.join(hooksDir, hook.command);

    // Check if command exists
    if (!fs.existsSync(commandPath)) {
      resolve({
        hookId: hook.id,
        success: false,
        error: `Hook command not found: ${commandPath}`,
        duration: Date.now() - startTime,
      });
      return;
    }

    // Execute command
    const child = spawn(commandPath, [], {
      env,
      cwd: context.sudocodeDir,
      timeout: hook.timeout_ms || 30000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        hookId: hook.id,
        success: code === 0,
        exitCode: code || 0,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      });
    });

    child.on("error", (error) => {
      resolve({
        hookId: hook.id,
        success: false,
        error: error.message,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Execute a plugin hook (npm package)
 */
async function executePluginHook(
  hook: HookConfig,
  context: HookExecutionContext
): Promise<HookExecutionResult> {
  const startTime = Date.now();

  try {
    // Try to dynamically import the plugin
    const plugin = await import(hook.command);

    if (typeof plugin.execute !== "function") {
      return {
        hookId: hook.id,
        success: false,
        error: `Plugin ${hook.command} does not export an execute function`,
        duration: Date.now() - startTime,
      };
    }

    // Execute plugin
    const result = await plugin.execute(context);

    return {
      hookId: hook.id,
      success: result.success ?? true,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      hookId: hook.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Build environment variables from template
 */
function buildEnvironment(
  template: Record<string, string>,
  context: HookExecutionContext
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(template)) {
    // Replace template variables
    let resolved = value;

    // ${REPO_ROOT} -> context.sudocodeDir parent
    resolved = resolved.replace(
      /\$\{REPO_ROOT\}/g,
      path.dirname(context.sudocodeDir)
    );

    // ${SUDOCODE_DIR} -> context.sudocodeDir
    resolved = resolved.replace(/\$\{SUDOCODE_DIR\}/g, context.sudocodeDir);

    // ${EXECUTION_ISSUE_ID} -> context.issueId
    if (context.issueId) {
      resolved = resolved.replace(/\$\{EXECUTION_ISSUE_ID\}/g, context.issueId);
    }

    // ${EXECUTION_ID} -> context.executionId
    if (context.executionId) {
      resolved = resolved.replace(
        /\$\{EXECUTION_ID\}/g,
        context.executionId
      );
    }

    env[key] = resolved;
  }

  return env;
}

/**
 * Execute all hooks for an event
 */
export async function executeHooksForEvent(
  sudocodeDir: string,
  event: HookEvent,
  context: Partial<HookExecutionContext>
): Promise<HookExecutionResult[]> {
  const config = loadHooksConfig(sudocodeDir);

  // Check if hooks are enabled
  if (!config.hooks || config.hooks.length === 0) {
    return [];
  }

  const fullContext: HookExecutionContext = {
    ...context,
    event,
    sudocodeDir,
  };

  // Get applicable hooks
  const hooks = getHooksForEvent(config, event, fullContext);

  if (hooks.length === 0) {
    return [];
  }

  // Execute hooks in sequence
  const results: HookExecutionResult[] = [];

  for (const hook of hooks) {
    const result = await executeHook(hook, fullContext);
    results.push(result);

    // Handle failure based on hook configuration
    if (!result.success && hook.required) {
      const behavior = hook.on_failure || "block";

      if (behavior === "block") {
        // Stop execution on required hook failure
        throw new Error(
          `Required hook ${hook.id} failed: ${result.error || `Exit code ${result.exitCode}`}`
        );
      }
      // For 'warn' or 'ignore', continue to next hook
    }
  }

  return results;
}

/**
 * Add a hook to configuration
 */
export function addHook(sudocodeDir: string, hook: HookConfig): void {
  const config = loadHooksConfig(sudocodeDir);

  // Check for duplicate ID
  if (config.hooks.some((h) => h.id === hook.id)) {
    throw new Error(`Hook with ID ${hook.id} already exists`);
  }

  config.hooks.push(hook);
  saveHooksConfig(sudocodeDir, config);
}

/**
 * Remove a hook from configuration
 */
export function removeHook(sudocodeDir: string, hookId: string): boolean {
  const config = loadHooksConfig(sudocodeDir);
  const initialLength = config.hooks.length;

  config.hooks = config.hooks.filter((h) => h.id !== hookId);

  if (config.hooks.length === initialLength) {
    return false;
  }

  saveHooksConfig(sudocodeDir, config);
  return true;
}

/**
 * Update a hook in configuration
 */
export function updateHook(
  sudocodeDir: string,
  hookId: string,
  updates: Partial<HookConfig>
): boolean {
  const config = loadHooksConfig(sudocodeDir);
  const hook = config.hooks.find((h) => h.id === hookId);

  if (!hook) {
    return false;
  }

  Object.assign(hook, updates);
  saveHooksConfig(sudocodeDir, config);
  return true;
}

/**
 * List all hooks
 */
export function listHooks(
  sudocodeDir: string,
  options?: {
    event?: HookEvent;
    enabled?: boolean;
  }
): HookConfig[] {
  const config = loadHooksConfig(sudocodeDir);
  let hooks = config.hooks;

  if (options?.event) {
    hooks = hooks.filter((h) => h.event === options.event);
  }

  return hooks;
}

/**
 * Test a hook without executing it
 */
export function validateHook(sudocodeDir: string, hook: HookConfig): string[] {
  const errors: string[] = [];

  // Check required fields
  if (!hook.id) {
    errors.push("Missing required field: id");
  }
  if (!hook.event) {
    errors.push("Missing required field: event");
  }
  if (!hook.type) {
    errors.push("Missing required field: type");
  }
  if (!hook.command) {
    errors.push("Missing required field: command");
  }

  // Validate event type
  const validEvents: HookEvent[] = [
    "before_execution",
    "after_execution",
    "on_error",
    "on_complete",
    "on_cancel",
  ];
  if (hook.event && !validEvents.includes(hook.event)) {
    errors.push(
      `Invalid event: ${hook.event} (must be one of: ${validEvents.join(", ")})`
    );
  }

  // Validate type
  if (hook.type && !["command", "plugin"].includes(hook.type)) {
    errors.push(`Invalid type: ${hook.type} (must be 'command' or 'plugin')`);
  }

  // Validate matcher type if present
  if (hook.matcher) {
    const validMatcherTypes: HookMatcherType[] = ["exact", "regex", "wildcard"];
    if (!validMatcherTypes.includes(hook.matcher.type)) {
      errors.push(
        `Invalid matcher type: ${hook.matcher.type} (must be one of: ${validMatcherTypes.join(", ")})`
      );
    }
  }

  // Validate on_failure behavior
  if (hook.on_failure) {
    const validBehaviors: HookFailureBehavior[] = ["block", "warn", "ignore"];
    if (!validBehaviors.includes(hook.on_failure)) {
      errors.push(
        `Invalid on_failure: ${hook.on_failure} (must be one of: ${validBehaviors.join(", ")})`
      );
    }
  }

  // Check if command exists (for command hooks)
  if (hook.type === "command") {
    const hooksDir = getHooksDir(sudocodeDir);
    const commandPath = path.isAbsolute(hook.command)
      ? hook.command
      : path.join(hooksDir, hook.command);

    if (!fs.existsSync(commandPath)) {
      errors.push(`Command not found: ${commandPath}`);
    } else {
      // Check if executable
      try {
        fs.accessSync(commandPath, fs.constants.X_OK);
      } catch {
        errors.push(`Command is not executable: ${commandPath}`);
      }
    }
  }

  return errors;
}
