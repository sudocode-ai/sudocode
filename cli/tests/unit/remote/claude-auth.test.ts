/**
 * Unit tests for ClaudeAuthIntegration service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ClaudeAuthIntegration } from "../../../src/remote/claude-auth.js";
import * as credentialsModule from "../../../src/auth/credentials.js";
import * as claudeAuthModule from "../../../src/auth/claude.js";

// Use temporary directory for tests
let TEST_CONFIG_DIR: string;
let TEST_CREDENTIALS_FILE: string;
let originalConfigDir: string | undefined;

/**
 * Helper to write test credentials file (ensures directory exists)
 */
function writeTestCredentials(credentials: any): void {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TEST_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

describe("ClaudeAuthIntegration", () => {
  let authIntegration: ClaudeAuthIntegration;

  beforeEach(() => {
    // Create temporary config directory
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));
    TEST_CONFIG_DIR = path.join(tempBase, "sudocode");
    TEST_CREDENTIALS_FILE = path.join(TEST_CONFIG_DIR, "user_credentials.json");
    
    // Set XDG_CONFIG_HOME to the base directory (module will add 'sudocode')
    originalConfigDir = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempBase;

    // Create fresh instance
    authIntegration = new ClaudeAuthIntegration();
  });

  afterEach(() => {
    // Clean up test directory
    const parentDir = path.dirname(TEST_CONFIG_DIR);
    if (fs.existsSync(parentDir) && parentDir.includes('sudocode-test-')) {
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
    
    // Restore original environment
    if (originalConfigDir) {
      process.env.XDG_CONFIG_HOME = originalConfigDir;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    // Clear all mocks
    vi.restoreAllMocks();
  });

  describe("isAuthenticated", () => {
    it("should return false when no token exists", async () => {
      const result = await authIntegration.isAuthenticated();
      expect(result).toBe(false);
    });

    it("should return true when token exists", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      writeTestCredentials(testCreds);
      
      const result = await authIntegration.isAuthenticated();
      expect(result).toBe(true);
    });

    it("should return false when token is empty string", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "",
      };
      writeTestCredentials(testCreds);
      
      const result = await authIntegration.isAuthenticated();
      expect(result).toBe(false);
    });
  });

  describe("getToken", () => {
    it("should return null when no token exists", async () => {
      const token = await authIntegration.getToken();
      expect(token).toBeNull();
    });

    it("should return token when it exists", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      writeTestCredentials(testCreds);
      
      const token = await authIntegration.getToken();
      expect(token).toBe("sk-ant-test-123");
    });

    it("should return correct token from multiple credentials", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
      };
      writeTestCredentials(testCreds);
      
      const token = await authIntegration.getToken();
      expect(token).toBe("sk-ant-test-123");
    });
  });

  describe("checkAuth", () => {
    it("should return not authenticated with null token when no token exists", async () => {
      const result = await authIntegration.checkAuth();
      
      expect(result.isAuthenticated).toBe(false);
      expect(result.token).toBeNull();
    });

    it("should return authenticated with token when token exists", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      writeTestCredentials(testCreds);
      
      const result = await authIntegration.checkAuth();
      
      expect(result.isAuthenticated).toBe(true);
      expect(result.token).toBe("sk-ant-test-123");
    });

    it("should return consistent values for isAuthenticated and token", async () => {
      // Test both authenticated and unauthenticated states
      let result = await authIntegration.checkAuth();
      expect(result.isAuthenticated).toBe(false);
      expect(result.token).toBeNull();

      // Add token
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      writeTestCredentials(testCreds);

      result = await authIntegration.checkAuth();
      expect(result.isAuthenticated).toBe(true);
      expect(result.token).not.toBeNull();
    });
  });

  describe("ensureAuthenticated", () => {
    it("should return existing token without triggering auth flow", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-existing-token",
      };
      writeTestCredentials(testCreds);

      // Mock handleClaudeAuth to track if it's called
      const handleClaudeAuthSpy = vi.spyOn(claudeAuthModule, 'handleClaudeAuth');

      const token = await authIntegration.ensureAuthenticated();
      
      expect(token).toBe("sk-ant-existing-token");
      expect(handleClaudeAuthSpy).not.toHaveBeenCalled();
    });

    it("should trigger auth flow when no token exists", async () => {
      // Mock handleClaudeAuth to simulate successful auth
      const handleClaudeAuthMock = vi.spyOn(claudeAuthModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          // Simulate token being saved after auth
          const testCreds = {
            claudeCodeOAuthToken: "sk-ant-new-token",
          };
          writeTestCredentials(testCreds);
        });

      const token = await authIntegration.ensureAuthenticated();
      
      expect(handleClaudeAuthMock).toHaveBeenCalledWith({ force: false });
      expect(token).toBe("sk-ant-new-token");
    });

    it("should force re-authentication when force=true", async () => {
      // Start with existing token
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-old-token",
      };
      writeTestCredentials(testCreds);

      // Mock handleClaudeAuth to simulate successful re-auth
      const handleClaudeAuthMock = vi.spyOn(claudeAuthModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          // Simulate new token being saved after auth
          const newCreds = {
            claudeCodeOAuthToken: "sk-ant-new-token",
          };
          writeTestCredentials(newCreds);
        });

      const token = await authIntegration.ensureAuthenticated(true);
      
      expect(handleClaudeAuthMock).toHaveBeenCalledWith({ force: true });
      expect(token).toBe("sk-ant-new-token");
    });

    it("should throw error when auth flow fails", async () => {
      // Mock handleClaudeAuth to simulate failed auth
      const handleClaudeAuthMock = vi.spyOn(claudeAuthModule, 'handleClaudeAuth')
        .mockRejectedValue(new Error('OAuth flow cancelled'));

      await expect(authIntegration.ensureAuthenticated()).rejects.toThrow(
        'Claude authentication failed: OAuth flow cancelled'
      );
      
      expect(handleClaudeAuthMock).toHaveBeenCalled();
    });

    it("should throw error when token not found after auth completes", async () => {
      // Mock handleClaudeAuth to simulate auth completing but no token saved
      const handleClaudeAuthMock = vi.spyOn(claudeAuthModule, 'handleClaudeAuth')
        .mockResolvedValue(undefined);

      await expect(authIntegration.ensureAuthenticated()).rejects.toThrow(
        'Authentication completed but token not found'
      );
      
      expect(handleClaudeAuthMock).toHaveBeenCalled();
    });

    it("should handle unknown errors gracefully", async () => {
      // Mock handleClaudeAuth to throw non-Error object
      const handleClaudeAuthMock = vi.spyOn(claudeAuthModule, 'handleClaudeAuth')
        .mockRejectedValue('Unknown error string');

      await expect(authIntegration.ensureAuthenticated()).rejects.toThrow(
        'Claude authentication failed with unknown error'
      );
      
      expect(handleClaudeAuthMock).toHaveBeenCalled();
    });
  });

  describe("setToken", () => {
    it("should set token successfully", async () => {
      await authIntegration.setToken("sk-ant-manual-token");
      
      // Verify token was saved
      const content = fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.claudeCodeOAuthToken).toBe("sk-ant-manual-token");
    });

    it("should update existing token", async () => {
      // Start with existing token
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-old-token",
      };
      writeTestCredentials(testCreds);

      await authIntegration.setToken("sk-ant-updated-token");
      
      // Verify token was updated
      const content = fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.claudeCodeOAuthToken).toBe("sk-ant-updated-token");
    });

    it("should throw error when token is empty", async () => {
      await expect(authIntegration.setToken("")).rejects.toThrow(
        'Token cannot be empty'
      );
    });

    it("should throw error when token is whitespace only", async () => {
      await expect(authIntegration.setToken("   ")).rejects.toThrow(
        'Token cannot be empty'
      );
    });

    it("should preserve other credentials when setting token", async () => {
      // Start with multiple credentials
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-old-token",
        llmKey: "sk-proj-test-456",
      };
      writeTestCredentials(testCreds);

      await authIntegration.setToken("sk-ant-new-token");
      
      // Verify token updated but other credentials preserved
      const content = fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.claudeCodeOAuthToken).toBe("sk-ant-new-token");
      expect(parsed.llmKey).toBe("sk-proj-test-456");
    });
  });

  describe("Integration workflow", () => {
    it("should complete full authentication workflow", async () => {
      // Start unauthenticated
      let isAuth = await authIntegration.isAuthenticated();
      expect(isAuth).toBe(false);

      // Mock auth flow
      const handleClaudeAuthMock = vi.spyOn(claudeAuthModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          const testCreds = {
            claudeCodeOAuthToken: "sk-ant-workflow-token",
          };
          writeTestCredentials(testCreds);
        });

      // Ensure authenticated (triggers auth flow)
      const token = await authIntegration.ensureAuthenticated();
      expect(token).toBe("sk-ant-workflow-token");
      expect(handleClaudeAuthMock).toHaveBeenCalled();

      // Now authenticated
      isAuth = await authIntegration.isAuthenticated();
      expect(isAuth).toBe(true);

      // Can retrieve token
      const retrievedToken = await authIntegration.getToken();
      expect(retrievedToken).toBe("sk-ant-workflow-token");
    });

    it("should handle re-authentication workflow", async () => {
      // Start with existing token
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-old-token",
      };
      writeTestCredentials(testCreds);

      // Mock re-auth flow
      const handleClaudeAuthMock = vi.spyOn(claudeAuthModule, 'handleClaudeAuth')
        .mockImplementation(async () => {
          const newCreds = {
            claudeCodeOAuthToken: "sk-ant-refreshed-token",
          };
          writeTestCredentials(newCreds);
        });

      // Force re-authentication
      const newToken = await authIntegration.ensureAuthenticated(true);
      expect(newToken).toBe("sk-ant-refreshed-token");
      expect(handleClaudeAuthMock).toHaveBeenCalledWith({ force: true });

      // Verify new token
      const retrievedToken = await authIntegration.getToken();
      expect(retrievedToken).toBe("sk-ant-refreshed-token");
    });
  });

  describe("Error handling", () => {
    it("should handle file system errors gracefully", async () => {
      // Mock getClaudeToken to throw filesystem error
      const getTokenSpy = vi.spyOn(credentialsModule, 'getClaudeToken')
        .mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(authIntegration.getToken()).rejects.toThrow('EACCES: permission denied');
    });

    it("should propagate setClaudeToken errors", async () => {
      // Mock setClaudeToken to throw error
      const setTokenSpy = vi.spyOn(credentialsModule, 'setClaudeToken')
        .mockRejectedValue(new Error('Failed to write credentials'));

      await expect(authIntegration.setToken("sk-ant-test")).rejects.toThrow(
        'Failed to write credentials'
      );
    });
  });

  describe("Singleton instance", () => {
    it("should export a default singleton instance", async () => {
      // Import the singleton
      const { claudeAuthIntegration } = await import("../../../src/remote/claude-auth.js");
      
      expect(claudeAuthIntegration).toBeInstanceOf(ClaudeAuthIntegration);
    });
  });
});
