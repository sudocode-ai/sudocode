/**
 * Claude authentication integration for remote deployments
 * 
 * Provides methods to check, retrieve, and provision Claude authentication
 * for remote deployment scenarios.
 */

import { hasClaudeToken, getClaudeToken } from "../auth/credentials.js";
import { handleClaudeAuth } from "../auth/claude.js";
import chalk from "chalk";
import { AuthenticationError } from "./errors.js";

/**
 * ClaudeAuthIntegration - Service for checking and provisioning Claude authentication
 * 
 * This class provides static methods to integrate Claude authentication
 * into deployment workflows. It can detect if Claude is authenticated,
 * retrieve the token for remote provisioning, and trigger the auth flow
 * when credentials are missing.
 */
export class ClaudeAuthIntegration {
  /**
   * Check if Claude is currently authenticated
   * 
   * @returns Promise that resolves to true if Claude token exists
   * 
   * @example
   * ```typescript
   * const isAuth = await ClaudeAuthIntegration.isAuthenticated();
   * if (!isAuth) {
   *   console.log('Claude authentication required');
   * }
   * ```
   */
  static async isAuthenticated(): Promise<boolean> {
    return await hasClaudeToken();
  }

  /**
   * Get the Claude authentication token
   * 
   * Retrieves the stored Claude OAuth token for use in remote provisioning.
   * Returns null if no token is configured.
   * 
   * @returns Promise that resolves to the Claude token or null
   * 
   * @example
   * ```typescript
   * const token = await ClaudeAuthIntegration.getToken();
   * if (token) {
   *   // Use token for remote provisioning
   * }
   * ```
   */
  static async getToken(): Promise<string | null> {
    return await getClaudeToken();
  }

  /**
   * Ensure Claude is authenticated, triggering auth flow if needed
   * 
   * This method checks if Claude authentication is configured and
   * automatically triggers the interactive OAuth flow if credentials
   * are missing. It provides user-friendly messages throughout the process.
   * 
   * @param options Configuration options
   * @param options.force Force re-authentication even if already configured
   * @param options.silent Suppress informational messages (errors still shown)
   * @returns Promise that resolves when authentication is confirmed
   * @throws Error if authentication fails or user cancels
   * 
   * @example
   * ```typescript
   * try {
   *   await ClaudeAuthIntegration.ensureAuthenticated();
   *   console.log('Ready to deploy with Claude authentication');
   * } catch (error) {
   *   console.error('Authentication failed:', error.message);
   * }
   * ```
   */
  static async ensureAuthenticated(options: {
    force?: boolean;
    silent?: boolean;
  } = {}): Promise<void> {
    const { force = false, silent = false } = options;

    try {
      // Check if already authenticated
      const isAuth = await this.isAuthenticated();
      
      if (isAuth && !force) {
        if (!silent) {
          console.log(chalk.green('✓ Claude authentication verified'));
        }
        return;
      }

      // Need to authenticate
      if (!silent) {
        if (!isAuth) {
          console.log(chalk.yellow('\n⚠ Claude authentication required for deployment\n'));
          console.log('Setting up Claude authentication...\n');
        }
      }

      // Trigger authentication flow
      // Note: handleClaudeAuth handles its own interactive prompts and output
      await handleClaudeAuth({ force });
      
      // Verify authentication succeeded
      const isNowAuth = await this.isAuthenticated();
      if (!isNowAuth) {
        throw new AuthenticationError(
          'Authentication completed but token not found',
          'claude',
          'Try running: sudocode auth claude'
        );
      }
      
      if (!silent) {
        console.log(chalk.green('\n✓ Claude authentication successful\n'));
      }
      
    } catch (error: any) {
      // Re-throw authentication errors as-is
      if (error instanceof AuthenticationError) {
        throw error;
      }
      
      // Wrap other errors as authentication errors
      throw new AuthenticationError(
        `Claude authentication failed: ${error.message}`,
        'claude',
        'Run: sudocode auth claude'
      );
    }
  }
}
