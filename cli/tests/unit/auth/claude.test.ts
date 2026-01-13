/**
 * Unit tests for Claude authentication command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import { handleClaudeAuth } from "../../../src/auth/claude.js";
import * as credentials from "../../../src/auth/credentials.js";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock readline for both confirmation prompts and token input
// We'll customize the behavior per test
let mockReadlineCallback: ((message: string, callback: (answer: string) => void) => void) | null = null;

vi.mock("readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((message: string, callback: (answer: string) => void) => {
      if (mockReadlineCallback) {
        mockReadlineCallback(message, callback);
      } else {
        // Default behavior: "y" for confirmations, valid token for prompts
        if (message.includes('Overwrite')) {
          callback("y");
        } else if (message.includes('paste')) {
          callback("sk-ant-api03-test123");
        } else {
          callback("y");
        }
      }
    }),
    close: vi.fn(),
  })),
}));

// Use temporary directory for tests
let TEST_CONFIG_DIR: string;
let TEST_CREDENTIALS_FILE: string;
let originalConfigDir: string | undefined;

/**
 * Helper to write test credentials file
 */
function writeTestCredentials(credentials: any): void {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TEST_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

/**
 * Mock ChildProcess for testing spawn
 * Note: With stdio: 'inherit', we don't capture stdout/stderr
 */
class MockChildProcess extends EventEmitter {
  // Simulate successful process
  simulateSuccess() {
    setTimeout(() => {
      this.emit('close', 0);
    }, 10);
  }
  
  // Simulate failed process
  simulateFailure(code: number) {
    setTimeout(() => {
      this.emit('close', code);
    }, 10);
  }
  
  // Simulate error (e.g., command not found)
  simulateError(error: any) {
    setTimeout(() => {
      this.emit('error', error);
    }, 10);
  }
}

describe("Claude Authentication Command", () => {
  let spawn: any;
  let readline: any;
  
  beforeEach(async () => {
    // Setup temp directory
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));
    TEST_CONFIG_DIR = path.join(tempBase, "sudocode");
    TEST_CREDENTIALS_FILE = path.join(TEST_CONFIG_DIR, "user_credentials.json");
    
    originalConfigDir = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempBase;
    
    // Get mocked modules
    const childProcess = await import("child_process");
    spawn = childProcess.spawn;
    
    const readlineModule = await import("readline");
    readline = readlineModule;
    
    // Reset mocks
    vi.clearAllMocks();
    mockReadlineCallback = null;
    
    // Mock console methods to prevent cluttering test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up test directory
    const parentDir = path.dirname(TEST_CONFIG_DIR);
    if (fs.existsSync(parentDir) && parentDir.includes('sudocode-test-')) {
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
    
    // Restore environment
    if (originalConfigDir) {
      process.env.XDG_CONFIG_HOME = originalConfigDir;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    
    // Restore console
    vi.restoreAllMocks();
  });

  describe("CLI Detection", () => {
    it("should detect when claude CLI is installed", async () => {
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      // Simulate successful version check and OAuth flow
      const authPromise = handleClaudeAuth({ force: true });
      
      // First call is version check (--version)
      expect(spawn).toHaveBeenCalledWith('claude', ['--version']);
      mockVersionCheck.simulateSuccess();
      
      // Wait for version check to complete
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Second call is OAuth flow
      expect(spawn).toHaveBeenCalledWith('claude', ['setup-token'], { stdio: 'inherit' });
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      // Should have called spawn twice (version check + OAuth)
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it("should error when claude CLI is not found", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      // Simulate ENOENT error (command not found)
      const authPromise = handleClaudeAuth({ force: true });
      mockProcess.simulateError({ code: 'ENOENT' });
      
      await expect(authPromise).rejects.toThrow();
      
      // Should show helpful error message
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('claude CLI not found')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('npm install -g @anthropic-ai/claude-cli')
      );
    });
  });

  describe("Token Input", () => {
    it("should prompt user for token and store it", async () => {
      const testToken = 'sk-ant-api03-xxxxxxxxxxxxx';
      
      // Mock readline to return test token
      mockReadlineCallback = (message: string, callback: (answer: string) => void) => {
        if (message.includes('paste')) {
          callback(testToken);
        } else {
          callback('y');
        }
      };
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      // Should have stored the token
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe(testToken);
    });

    it("should handle token with various valid formats", async () => {
      const testCases = [
        'sk-ant-api03-xxxxx',
        'sk-ant-sid01-xxxxx',
        'sk-ant-xxxxx',
      ];
      
      for (const testToken of testCases) {
        // Clear credentials between tests
        await credentials.clearAllCredentials();
        
        // Mock readline to return test token
        mockReadlineCallback = (message: string, callback: (answer: string) => void) => {
          if (message.includes('paste')) {
            callback(testToken);
          } else {
            callback('y');
          }
        };
        
        const mockVersionCheck = new MockChildProcess();
        const mockOAuthProcess = new MockChildProcess();
        spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
        
        const authPromise = handleClaudeAuth({ force: true });
        
        // Version check
        mockVersionCheck.simulateSuccess();
        await new Promise(resolve => setTimeout(resolve, 20));
        
        // OAuth flow
        mockOAuthProcess.simulateSuccess();
        
        await authPromise;
        
        const storedToken = await credentials.getClaudeToken();
        expect(storedToken).toBe(testToken);
      }
    });

    it("should trim whitespace from pasted token", async () => {
      const testToken = '  sk-ant-api03-xxxxxxxxxxxxx  \n';
      
      // Mock readline to return token with whitespace
      mockReadlineCallback = (message: string, callback: (answer: string) => void) => {
        if (message.includes('paste')) {
          callback(testToken);
        } else {
          callback('y');
        }
      };
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      // Should have stored trimmed token
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe('sk-ant-api03-xxxxxxxxxxxxx');
    });
  });

  describe("Token Validation", () => {
    it("should reject token with invalid format (must start with sk-ant-)", async () => {
      // Mock readline to return invalid token
      mockReadlineCallback = (message: string, callback: (answer: string) => void) => {
        if (message.includes('paste')) {
          callback('invalid-token-format');
        } else {
          callback('y');
        }
      };
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid token format')
      );
    });

    it("should reject empty token", async () => {
      // Mock readline to return empty token
      mockReadlineCallback = (message: string, callback: (answer: string) => void) => {
        if (message.includes('paste')) {
          callback('');
        } else {
          callback('y');
        }
      };
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No token provided')
      );
    });
  });

  describe("OAuth Flow Handling", () => {
    it("should handle successful OAuth flow", async () => {
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Authentication successful')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Token stored securely')
      );
    });

    it("should handle OAuth flow cancellation", async () => {
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow cancelled (non-zero exit code)
      mockOAuthProcess.simulateFailure(1);
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('cancelled')
      );
    });

    it("should handle OAuth flow failure", async () => {
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow failed
      mockOAuthProcess.simulateFailure(1);
      
      await expect(authPromise).rejects.toThrow();
    });
  });

  describe("Overwrite Confirmation", () => {
    it("should prompt for confirmation when already authenticated", async () => {
      // Setup existing credentials
      writeTestCredentials({
        claudeCodeOAuthToken: 'sk-ant-existing-token'
      });
      
      // Mock readline: "y" for confirmation, then token
      let callCount = 0;
      mockReadlineCallback = (message: string, callback: (answer: string) => void) => {
        callCount++;
        if (message.includes('Overwrite')) {
          callback('y');
        } else if (message.includes('paste')) {
          callback('sk-ant-api03-newtoken');
        } else {
          callback('y');
        }
      };
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: false });
      
      // Should prompt for confirmation
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(callCount).toBeGreaterThan(0);
      
      // Continue with OAuth flow
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      // Token should be updated
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe('sk-ant-api03-newtoken');
    });

    it("should cancel when user declines overwrite", async () => {
      // Setup existing credentials
      writeTestCredentials({
        claudeCodeOAuthToken: 'sk-ant-existing-token'
      });
      
      // Mock readline to return "no"
      mockReadlineCallback = (message: string, callback: (answer: string) => void) => {
        if (message.includes('Overwrite')) {
          callback('n');
        } else {
          callback('y');
        }
      };
      
      await handleClaudeAuth({ force: false });
      
      // Should not have called spawn (no OAuth flow)
      expect(spawn).not.toHaveBeenCalled();
      
      // Token should remain unchanged
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe('sk-ant-existing-token');
    });

    it("should skip confirmation with force flag", async () => {
      // Setup existing credentials
      writeTestCredentials({
        claudeCodeOAuthToken: 'sk-ant-existing-token'
      });
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Continue with OAuth flow (no confirmation prompt)
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe('sk-ant-api03-test123'); // Default mock token
    });
  });

  describe("Error Handling", () => {
    it("should handle permission errors during write", async () => {
      // Mock setClaudeToken to throw permission error
      vi.spyOn(credentials, 'setClaudeToken').mockRejectedValue(
        new Error('Failed to write credentials: EACCES: permission denied')
      );
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Permission error')
      );
      
      // Restore original function
      vi.mocked(credentials.setClaudeToken).mockRestore();
    });

    it("should handle spawn errors during OAuth flow", async () => {
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check succeeds
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow fails with spawn error
      mockOAuthProcess.simulateError(new Error('Spawn failed'));
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed')
      );
    });
  });

  describe("Token Storage", () => {
    it("should store token with secure permissions", async () => {
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      // Check file exists with correct permissions
      expect(fs.existsSync(TEST_CREDENTIALS_FILE)).toBe(true);
      
      const stats = fs.statSync(TEST_CREDENTIALS_FILE);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("should preserve existing credentials when storing new token", async () => {
      // Setup existing credentials
      writeTestCredentials({
        claudeCodeOAuthToken: 'sk-ant-old',
        llmKey: 'sk-proj-existing'
      });
      
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      // Check that Claude token was updated but LLM key preserved
      const allCreds = await credentials.getAllCredentials();
      expect(allCreds.claudeToken).toBe('sk-ant-api03-test123'); // Default mock token
      expect(allCreds.llmKey).toBe('sk-proj-existing');
    });
  });

  describe("User Experience", () => {
    it("should show clear success message", async () => {
      const mockVersionCheck = new MockChildProcess();
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValueOnce(mockVersionCheck).mockReturnValueOnce(mockOAuthProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockVersionCheck.simulateSuccess();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // OAuth flow
      mockOAuthProcess.simulateSuccess();
      
      await authPromise;
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Authentication successful')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('sudocode auth status')
      );
    });

    it("should show helpful error messages", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // CLI not found
      mockProcess.simulateError({ code: 'ENOENT' });
      
      await expect(authPromise).rejects.toThrow();
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('npm install -g @anthropic-ai/claude-cli')
      );
    });
  });
});
