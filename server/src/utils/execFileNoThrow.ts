/**
 * Safe wrapper around execFile that returns result instead of throwing
 *
 * This utility provides a safe way to execute commands without throwing errors.
 * It's particularly useful for detection operations where command failure
 * indicates absence rather than error.
 *
 * @module utils/execFileNoThrow
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Result of command execution
 */
export interface ExecFileResult {
  /** Standard output from command */
  stdout: string;
  /** Standard error from command */
  stderr: string;
  /** Exit status code (0 = success, non-zero = failure) */
  status: number;
}

/**
 * Execute a file/command safely without throwing errors
 *
 * Unlike the standard execFile which throws on non-zero exit codes,
 * this function returns a result object indicating success/failure
 * through the status code.
 *
 * @param file - Command to execute (e.g., 'which', 'where')
 * @param args - Command arguments (e.g., ['sudocode-mcp'])
 * @returns Result object with stdout, stderr, and status
 *
 * @example
 * ```typescript
 * const result = await execFileNoThrow('which', ['sudocode-mcp']);
 * if (result.status === 0) {
 *   console.log('Found:', result.stdout.trim());
 * } else {
 *   console.log('Not found');
 * }
 * ```
 */
export async function execFileNoThrow(
  file: string,
  args?: string[]
): Promise<ExecFileResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args || []);
    return {
      stdout,
      stderr,
      status: 0,
    };
  } catch (error: any) {
    // execFile throws on non-zero exit codes
    // Extract stdout/stderr from the error object if available
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      status: error.code || 1,
    };
  }
}
