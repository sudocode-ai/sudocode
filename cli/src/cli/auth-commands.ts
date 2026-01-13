/**
 * Authentication command handlers
 */

import { handleAuthClear } from "../auth/clear.js";
import { showAuthStatus } from "../auth/status.js";
import { handleClaudeAuth } from "../auth/claude.js";

/**
 * Context passed to command handlers
 */
interface CommandContext {
  db: any;
  outputDir: string;
  jsonOutput: boolean;
}

/**
 * Handle auth clear command
 * Note: This command doesn't need database context
 */
export async function handleAuthClearCommand(
  context: CommandContext,
  options: { force?: boolean }
): Promise<void> {
  await handleAuthClear(options);
}

/**
 * Handle auth status command
 * Note: This command doesn't need database context
 */
export async function handleAuthStatusCommand(
  context: CommandContext,
  options: { json?: boolean }
): Promise<void> {
  await showAuthStatus({ json: options.json || context.jsonOutput });
}

/**
 * Handle auth claude command
 * Note: This command doesn't need database context
 */
export async function handleAuthClaudeCommand(
  context: CommandContext,
  options: { force?: boolean }
): Promise<void> {
  await handleClaudeAuth(options);
}
