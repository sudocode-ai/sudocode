/**
 * Error handling for remote deployment
 * 
 * STUB: This is a placeholder implementation.
 * Full implementation will be done in a separate issue.
 */

/**
 * Configuration error class
 */
export class ConfigurationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Format error message for display
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
