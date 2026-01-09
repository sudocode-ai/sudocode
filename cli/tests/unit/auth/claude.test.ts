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

// Mock readline for confirmation prompts
vi.mock("readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((message: string, callback: (answer: string) => void) => {
      // Default to "yes" for tests
      callback("y");
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
 */
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  
  // Simulate successful process
  simulateSuccess(output: string, token: string) {
    setTimeout(() => {
      this.stdout.emit('data', Buffer.from(output));
      this.stdout.emit('data', Buffer.from(`Token: ${token}\n`));
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
  
  // Simulate cancellation
  simulateCancellation() {
    setTimeout(() => {
      this.stdout.emit('data', Buffer.from('OAuth flow cancelled\n'));
      this.emit('close', 1);
    }, 10);
  }
  
  // Simulate output without token
  simulateNoToken(output: string) {
    setTimeout(() => {
      this.stdout.emit('data', Buffer.from(output));
      this.emit('close', 0);
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
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      // Simulate successful version check and OAuth flow
      const authPromise = handleClaudeAuth({ force: true });
      
      // First call is version check (--version)
      expect(spawn).toHaveBeenCalledWith('claude', ['--version']);
      mockProcess.simulateSuccess('', 'sk-ant-test-token');
      
      // Second call is OAuth flow
      spawn.mockReturnValue(mockProcess);
      mockProcess.simulateSuccess('Authentication successful!\n', 'sk-ant-api03-test123');
      
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

  describe("Token Extraction", () => {
    it("should extract token from Claude CLI output", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check succeeds
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow succeeds with token
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess(
        'Please visit: https://console.anthropic.com/...\n' +
        'Waiting for authentication...\n' +
        'Authentication successful!\n',
        'sk-ant-api03-xxxxxxxxxxxxx'
      );
      
      await authPromise;
      
      // Should have stored the token
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe('sk-ant-api03-xxxxxxxxxxxxx');
    });

    it("should extract token from stderr output", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow with token in stderr
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      
      setTimeout(() => {
        mockOAuthProcess.stderr.emit('data', Buffer.from('Token: sk-ant-api03-test456\n'));
        mockOAuthProcess.emit('close', 0);
      }, 10);
      
      await authPromise;
      
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe('sk-ant-api03-test456');
    });

    it("should handle token with various formats", async () => {
      const testCases = [
        'sk-ant-api03-xxxxx',
        'sk-ant-sid01-xxxxx',
        'sk-ant-xxxxx',
      ];
      
      for (const testToken of testCases) {
        // Clear credentials between tests
        await credentials.clearAllCredentials();
        
        const mockProcess = new MockChildProcess();
        spawn.mockReturnValue(mockProcess);
        
        const authPromise = handleClaudeAuth({ force: true });
        
        // Version check
        mockProcess.simulateSuccess('', 'sk-ant-test');
        
        // OAuth flow
        const mockOAuthProcess = new MockChildProcess();
        spawn.mockReturnValue(mockOAuthProcess);
        mockOAuthProcess.simulateSuccess('Success!\n', testToken);
        
        await authPromise;
        
        const storedToken = await credentials.getClaudeToken();
        expect(storedToken).toBe(testToken);
      }
    });
  });

  describe("Token Validation", () => {
    it("should validate token format (must start with sk-ant-)", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow with invalid token format
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess(
        'Success!\n',
        'invalid-token-format'  // Wrong prefix
      );
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to extract token')
      );
    });

    it("should error when no token is found in output", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow without token
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateNoToken('Authentication successful but no token in output\n');
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to extract token')
      );
    });
  });

  describe("OAuth Flow Handling", () => {
    it("should handle successful OAuth flow", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess(
        'Please authenticate in your browser...\n',
        'sk-ant-api03-success'
      );
      
      await authPromise;
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Authentication successful')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Token stored securely')
      );
    });

    it("should handle OAuth flow cancellation", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow cancelled (non-zero exit code)
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateCancellation();
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('cancelled')
      );
    });

    it("should handle OAuth flow failure", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow failed
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
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
      
      // Mock readline to return "yes"
      const mockReadline = {
        question: vi.fn((message: string, callback: (answer: string) => void) => {
          callback('y');
        }),
        close: vi.fn(),
      };
      (readline.createInterface as any).mockReturnValue(mockReadline);
      
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: false });
      
      // Should prompt for confirmation
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(mockReadline.question).toHaveBeenCalledWith(
        expect.stringContaining('Overwrite existing token?'),
        expect.any(Function)
      );
      
      // Continue with OAuth flow
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess('Success!\n', 'sk-ant-api03-newtoken');
      
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
      const mockReadline = {
        question: vi.fn((message: string, callback: (answer: string) => void) => {
          callback('n');
        }),
        close: vi.fn(),
      };
      (readline.createInterface as any).mockReturnValue(mockReadline);
      
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
      
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Should not prompt (force mode)
      const mockReadline = readline.createInterface as any;
      expect(mockReadline).not.toHaveBeenCalled();
      
      // Continue with OAuth flow
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess('Success!\n', 'sk-ant-api03-forced');
      
      await authPromise;
      
      const storedToken = await credentials.getClaudeToken();
      expect(storedToken).toBe('sk-ant-api03-forced');
    });
  });

  describe("Error Handling", () => {
    it("should handle permission errors during write", async () => {
      // Mock setClaudeToken to throw permission error
      const originalSetClaudeToken = credentials.setClaudeToken;
      vi.spyOn(credentials, 'setClaudeToken').mockRejectedValue(
        new Error('Failed to write credentials: EACCES: permission denied')
      );
      
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess('Success!\n', 'sk-ant-api03-test');
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Permission error')
      );
      
      // Restore original function
      vi.mocked(credentials.setClaudeToken).mockRestore();
    });

    it("should handle spawn errors during version check", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check fails with non-ENOENT error (other spawn errors still mean CLI exists)
      // So we simulate this during the OAuth flow instead
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow fails with spawn error
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateError(new Error('Spawn failed'));
      
      await expect(authPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed')
      );
    });
  });

  describe("Token Storage", () => {
    it("should store token with secure permissions", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess('Success!\n', 'sk-ant-api03-secure');
      
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
      
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess('Success!\n', 'sk-ant-api03-new');
      
      await authPromise;
      
      // Check that Claude token was updated but LLM key preserved
      const allCreds = await credentials.getAllCredentials();
      expect(allCreds.claudeToken).toBe('sk-ant-api03-new');
      expect(allCreds.llmKey).toBe('sk-proj-existing');
    });
  });

  describe("User Experience", () => {
    it("should show clear success message", async () => {
      const mockProcess = new MockChildProcess();
      spawn.mockReturnValue(mockProcess);
      
      const authPromise = handleClaudeAuth({ force: true });
      
      // Version check
      mockProcess.simulateSuccess('', 'sk-ant-test');
      
      // OAuth flow
      const mockOAuthProcess = new MockChildProcess();
      spawn.mockReturnValue(mockOAuthProcess);
      mockOAuthProcess.simulateSuccess('Success!\n', 'sk-ant-api03-ux');
      
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
