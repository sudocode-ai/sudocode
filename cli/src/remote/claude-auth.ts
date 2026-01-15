/**
 * Claude authentication integration for remote deployments
 * 
 * Provides methods to check, retrieve, and provision Claude authentication
 * for remote deployments. Integrates with existing credential management
 * and interactive auth flows.
 */

import { 
  getClaudeToken, 
  hasClaudeToken, 
  setClaudeToken 
} from '../auth/credentials.js';
import { handleClaudeAuth } from '../auth/claude.js';

/**
 * Result of authentication check
 */
export interface AuthCheckResult {
  isAuthenticated: boolean;
  token: string | null;
}

/**
 * Claude authentication integration service
 * 
 * Provides a unified interface for checking and provisioning Claude authentication
 * in the context of remote deployments.
 */
export class ClaudeAuthIntegration {
  /**
   * Check if Claude is authenticated
   * 
   * @returns true if Claude token exists and is valid
   */
  async isAuthenticated(): Promise<boolean> {
    return await hasClaudeToken();
  }

  /**
   * Get Claude authentication token
   * 
   * @returns Claude token if authenticated, null otherwise
   */
  async getToken(): Promise<string | null> {
    return await getClaudeToken();
  }

  /**
   * Get authentication status and token
   * 
   * @returns Object with authentication status and token
   */
  async checkAuth(): Promise<AuthCheckResult> {
    const isAuthenticated = await this.isAuthenticated();
    const token = isAuthenticated ? await this.getToken() : null;
    
    return {
      isAuthenticated,
      token,
    };
  }

  /**
   * Ensure Claude is authenticated
   * 
   * If not authenticated, triggers the interactive authentication flow.
   * If already authenticated, returns the existing token.
   * 
   * @param force Force re-authentication even if already authenticated
   * @returns Claude token after successful authentication
   * @throws Error if authentication fails or is cancelled
   */
  async ensureAuthenticated(force: boolean = false): Promise<string> {
    // Check if already authenticated
    if (!force) {
      const existingToken = await this.getToken();
      if (existingToken) {
        return existingToken;
      }
    }

    // Trigger interactive authentication flow
    try {
      await handleClaudeAuth({ force });
      
      // Retrieve and return the token
      const token = await this.getToken();
      if (!token) {
        throw new Error('Authentication completed but token not found');
      }
      
      return token;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Claude authentication failed: ${error.message}`);
      }
      throw new Error('Claude authentication failed with unknown error');
    }
  }

  /**
   * Manually set Claude token
   * 
   * Useful for programmatic provisioning or testing.
   * 
   * @param token Claude token to set
   * @throws Error if token is invalid or cannot be stored
   */
  async setToken(token: string): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new Error('Token cannot be empty');
    }
    
    await setClaudeToken(token);
  }
}

/**
 * Default singleton instance
 */
export const claudeAuthIntegration = new ClaudeAuthIntegration();
