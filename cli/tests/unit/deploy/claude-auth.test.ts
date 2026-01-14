/**
 * Tests for ClaudeAuthIntegration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ClaudeAuthIntegration } from '../../../src/deploy/claude-auth.js';
import * as credentialsModule from '../../../src/auth/credentials.js';
import * as claudeModule from '../../../src/auth/claude.js';

describe('ClaudeAuthIntegration', () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: any;

  beforeEach(async () => {
    // Create temp directory for test isolation
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudocode-claude-auth-test-'));

    // Set XDG_CONFIG_HOME to temp directory
    originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;

    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.XDG_CONFIG_HOME = originalEnv;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Restore console.log and clear all mocks
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('isAuthenticated', () => {
    it('should return true when Claude token exists', async () => {
      // Setup: Create credentials file with Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-test123456789'
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      const result = await ClaudeAuthIntegration.isAuthenticated();

      // Verify
      expect(result).toBe(true);
    });

    it('should return false when no credentials file exists', async () => {
      // No credentials file exists

      // Execute
      const result = await ClaudeAuthIntegration.isAuthenticated();

      // Verify
      expect(result).toBe(false);
    });

    it('should return false when credentials file exists but no Claude token', async () => {
      // Setup: Create credentials file without Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        llmKey: 'sk-proj-test123456789'
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      const result = await ClaudeAuthIntegration.isAuthenticated();

      // Verify
      expect(result).toBe(false);
    });

    it('should return false when Claude token is empty string', async () => {
      // Setup: Create credentials file with empty Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: ''
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      const result = await ClaudeAuthIntegration.isAuthenticated();

      // Verify
      expect(result).toBe(false);
    });
  });

  describe('getToken', () => {
    it('should return token when Claude is authenticated', async () => {
      // Setup: Create credentials file with Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      const expectedToken = 'sk-ant-api03-test123456789abcdefghijklmnopqrstuvwxyz';
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: expectedToken
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      const token = await ClaudeAuthIntegration.getToken();

      // Verify
      expect(token).toBe(expectedToken);
    });

    it('should return null when no credentials file exists', async () => {
      // No credentials file exists

      // Execute
      const token = await ClaudeAuthIntegration.getToken();

      // Verify
      expect(token).toBe(null);
    });

    it('should return null when credentials file exists but no Claude token', async () => {
      // Setup: Create credentials file without Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        llmKey: 'sk-proj-test123456789'
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      const token = await ClaudeAuthIntegration.getToken();

      // Verify
      expect(token).toBe(null);
    });

    it('should return null when Claude token is empty string', async () => {
      // Setup: Create credentials file with empty Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: ''
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      const token = await ClaudeAuthIntegration.getToken();

      // Verify
      expect(token).toBe(null);
    });
  });

  describe('ensureAuthenticated', () => {
    it('should succeed immediately when already authenticated', async () => {
      // Setup: Create credentials file with Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-test123456789'
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      await expect(ClaudeAuthIntegration.ensureAuthenticated()).resolves.toBeUndefined();

      // Verify
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('✓ Claude authentication verified');
    });

    it('should not show message when silent option is true and already authenticated', async () => {
      // Setup: Create credentials file with Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-test123456789'
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Execute
      await ClaudeAuthIntegration.ensureAuthenticated({ silent: true });

      // Verify
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should trigger auth flow when not authenticated', async () => {
      // Setup: Mock handleClaudeAuth to simulate successful authentication
      const handleClaudeAuthSpy = vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          // Simulate successful auth by creating credentials file
          const sudocodeDir = path.join(tempDir, 'sudocode');
          await fs.mkdir(sudocodeDir, { recursive: true });
          const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
          await fs.writeFile(credentialsFile, JSON.stringify({
            claudeCodeOAuthToken: 'sk-ant-api03-test123456789'
          }, null, 2));
          await fs.chmod(credentialsFile, 0o600);
        });

      // Execute
      await ClaudeAuthIntegration.ensureAuthenticated();

      // Verify
      expect(handleClaudeAuthSpy).toHaveBeenCalledWith({ force: false });

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('⚠ Claude authentication required for deployment');
      expect(output).toContain('Setting up Claude authentication...');
      expect(output).toContain('✓ Claude authentication successful');
    });

    it('should not show messages when silent and triggering auth flow', async () => {
      // Setup: Mock handleClaudeAuth to simulate successful authentication
      const handleClaudeAuthSpy = vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          // Simulate successful auth by creating credentials file
          const sudocodeDir = path.join(tempDir, 'sudocode');
          await fs.mkdir(sudocodeDir, { recursive: true });
          const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
          await fs.writeFile(credentialsFile, JSON.stringify({
            claudeCodeOAuthToken: 'sk-ant-api03-test123456789'
          }, null, 2));
          await fs.chmod(credentialsFile, 0o600);
        });

      // Execute
      await ClaudeAuthIntegration.ensureAuthenticated({ silent: true });

      // Verify handleClaudeAuth was called
      expect(handleClaudeAuthSpy).toHaveBeenCalled();

      // Verify no messages were logged
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should pass force option to handleClaudeAuth', async () => {
      // Setup: Create credentials file with Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-test123456789'
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Mock handleClaudeAuth
      const handleClaudeAuthSpy = vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockResolvedValue(undefined);

      // Execute with force
      await ClaudeAuthIntegration.ensureAuthenticated({ force: true });

      // Verify force was passed to handleClaudeAuth
      expect(handleClaudeAuthSpy).toHaveBeenCalledWith({ force: true });
    });

    it('should throw error when auth flow fails', async () => {
      // Setup: Mock handleClaudeAuth to throw error
      const authError = new Error('OAuth flow was cancelled');
      vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockRejectedValue(authError);

      // Execute and verify
      await expect(ClaudeAuthIntegration.ensureAuthenticated())
        .rejects
        .toThrow('Claude authentication failed: OAuth flow was cancelled');
    });

    it('should throw error when auth completes but token not found', async () => {
      // Setup: Mock handleClaudeAuth to succeed but not create token
      vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockResolvedValue(undefined);

      // Execute and verify
      await expect(ClaudeAuthIntegration.ensureAuthenticated())
        .rejects
        .toThrow('Authentication completed but token not found');
    });

    it('should handle permission errors gracefully', async () => {
      // Setup: Mock handleClaudeAuth to throw permission error
      const permissionError = new Error('Failed to write credentials: EACCES: permission denied');
      vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockRejectedValue(permissionError);

      // Execute and verify
      await expect(ClaudeAuthIntegration.ensureAuthenticated())
        .rejects
        .toThrow('Claude authentication failed: Failed to write credentials: EACCES: permission denied');
    });
  });

  describe('Integration scenarios', () => {
    it('should work in deployment flow: check → trigger auth → verify → get token', async () => {
      // Step 1: Check authentication (should be false)
      let isAuth = await ClaudeAuthIntegration.isAuthenticated();
      expect(isAuth).toBe(false);

      // Step 2: Mock handleClaudeAuth to simulate successful authentication
      vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          const sudocodeDir = path.join(tempDir, 'sudocode');
          await fs.mkdir(sudocodeDir, { recursive: true });
          const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
          await fs.writeFile(credentialsFile, JSON.stringify({
            claudeCodeOAuthToken: 'sk-ant-api03-deployment-token-123456789'
          }, null, 2));
          await fs.chmod(credentialsFile, 0o600);
        });

      // Step 3: Ensure authenticated (should trigger auth flow)
      await ClaudeAuthIntegration.ensureAuthenticated();

      // Step 4: Verify authentication (should be true now)
      isAuth = await ClaudeAuthIntegration.isAuthenticated();
      expect(isAuth).toBe(true);

      // Step 5: Get token for remote provisioning
      const token = await ClaudeAuthIntegration.getToken();
      expect(token).toBe('sk-ant-api03-deployment-token-123456789');
    });

    it('should handle re-authentication with force option', async () => {
      // Setup: Create initial credentials
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-old-token'
      }, null, 2));

      await fs.chmod(credentialsFile, 0o600);

      // Verify old token exists
      let token = await ClaudeAuthIntegration.getToken();
      expect(token).toBe('sk-ant-api03-old-token');

      // Mock handleClaudeAuth to simulate re-authentication
      vi.spyOn(claudeModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          await fs.writeFile(credentialsFile, JSON.stringify({
            claudeCodeOAuthToken: 'sk-ant-api03-new-token'
          }, null, 2));
        });

      // Force re-authentication
      await ClaudeAuthIntegration.ensureAuthenticated({ force: true });

      // Verify new token
      token = await ClaudeAuthIntegration.getToken();
      expect(token).toBe('sk-ant-api03-new-token');
    });
  });

  describe('Error handling', () => {
    it('should handle corrupted credentials file gracefully', async () => {
      // Setup: Create corrupted credentials file
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');

      await fs.writeFile(credentialsFile, 'invalid json{{{');
      await fs.chmod(credentialsFile, 0o600);

      // Execute - should handle gracefully
      const isAuth = await ClaudeAuthIntegration.isAuthenticated();
      expect(isAuth).toBe(false);

      const token = await ClaudeAuthIntegration.getToken();
      expect(token).toBe(null);
    });

    it('should handle missing config directory', async () => {
      // Setup: Delete config directory if it exists
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.rm(sudocodeDir, { recursive: true, force: true });

      // Execute - should handle gracefully
      const isAuth = await ClaudeAuthIntegration.isAuthenticated();
      expect(isAuth).toBe(false);

      const token = await ClaudeAuthIntegration.getToken();
      expect(token).toBe(null);
    });
  });
});
