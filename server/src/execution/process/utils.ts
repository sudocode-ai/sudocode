/**
 * Process Layer Utilities
 *
 * Helper functions for the Process Layer including ID generation,
 * formatting, and validation utilities.
 *
 * @module execution/process/utils
 */

import { customAlphabet } from 'nanoid';

/**
 * Generate a unique process ID with a prefix
 *
 * Creates URL-safe, unique identifiers for processes. Uses nanoid for
 * cryptographically strong random IDs.
 *
 * @param prefix - Prefix for the ID (e.g., 'process', 'task')
 * @returns Unique ID string in format: `{prefix}-{randomId}`
 *
 * @example
 * ```typescript
 * const id = generateId('process');
 * // Returns: 'process-a1b2c3d4'
 * ```
 */
export function generateId(prefix: string): string {
  // Use nanoid with custom alphabet (alphanumeric, lowercase)
  // 10 characters gives us ~1.5 million years to collision at 1000 IDs/hour
  const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);
  return `${prefix}-${nanoid()}`;
}

/**
 * Format duration in milliseconds to human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(1500); // "1.5s"
 * formatDuration(65000); // "1m 5s"
 * ```
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

/**
 * Validate that a signal name is valid for Node.js
 *
 * @param signal - Signal name to validate
 * @returns True if signal is valid
 */
export function isValidSignal(signal: string): boolean {
  const validSignals = [
    'SIGTERM',
    'SIGKILL',
    'SIGINT',
    'SIGHUP',
    'SIGQUIT',
    'SIGABRT',
  ];
  return validSignals.includes(signal);
}

/**
 * Format error message from process exit
 *
 * @param exitCode - Process exit code
 * @param signal - Signal that terminated the process
 * @returns Formatted error message
 */
export function formatProcessError(
  exitCode: number | null,
  signal: string | null
): string {
  if (signal) {
    return `Process terminated by signal: ${signal}`;
  }
  if (exitCode !== null && exitCode !== 0) {
    return `Process exited with code: ${exitCode}`;
  }
  return 'Process exited unexpectedly';
}
