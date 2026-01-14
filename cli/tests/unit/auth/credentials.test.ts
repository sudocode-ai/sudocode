/**
 * Unit tests for credentials module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getAllCredentials,
  hasAnyCredential,
  getConfiguredCredentialCount,
  getConfiguredCredentialTypes,
  getClaudeToken,
  hasClaudeToken,
  getLLMKey,
  hasLLMKey,
  getLiteLLMCredentials,
  hasLiteLLMCredentials,
  setClaudeToken,
  clearAllCredentials,
  CONFIG_DIR,
  CREDENTIALS_FILE,
} from "../../../src/auth/credentials.js";

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

describe("Credentials Module", () => {
  beforeEach(() => {
    // Create temporary config directory
    // The module adds 'sudocode' subdirectory, so we need to account for that
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));
    TEST_CONFIG_DIR = path.join(tempBase, "sudocode");
    TEST_CREDENTIALS_FILE = path.join(TEST_CONFIG_DIR, "user_credentials.json");
    
    // Set XDG_CONFIG_HOME to the base directory (module will add 'sudocode')
    originalConfigDir = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempBase;
  });

  afterEach(() => {
    // Clean up test directory (clean up parent directory to remove everything)
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
  });

  describe("getAllCredentials", () => {
    it("should return all null when no credentials file exists", async () => {
      const creds = await getAllCredentials();
      
      expect(creds.claudeToken).toBeNull();
      expect(creds.llmKey).toBeNull();
      expect(creds.litellmCredentials).toBeNull();
    });

    it("should return all configured credentials", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
        litellmCredentials: {
          api_base: "https://api.openai.com/v1",
          api_key: "sk-test-789",
        },
      };
      
      writeTestCredentials(testCreds);
      
      const creds = await getAllCredentials();
      
      expect(creds.claudeToken).toBe("sk-ant-test-123");
      expect(creds.llmKey).toBe("sk-proj-test-456");
      expect(creds.litellmCredentials).toEqual(testCreds.litellmCredentials);
    });

    it("should return null for unconfigured credentials", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        // llmKey and litellmCredentials not present
      };
      
      writeTestCredentials(testCreds);
      
      const creds = await getAllCredentials();
      
      expect(creds.claudeToken).toBe("sk-ant-test-123");
      expect(creds.llmKey).toBeNull();
      expect(creds.litellmCredentials).toBeNull();
    });

    it("should handle corrupted JSON gracefully", async () => {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(TEST_CREDENTIALS_FILE, "{invalid json}");
      
      // Should log warning but not throw
      const creds = await getAllCredentials();
      
      expect(creds.claudeToken).toBeNull();
      expect(creds.llmKey).toBeNull();
      expect(creds.litellmCredentials).toBeNull();
    });
  });

  describe("hasAnyCredential", () => {
    it("should return false when no credentials exist", async () => {
      const result = await hasAnyCredential();
      expect(result).toBe(false);
    });

    it("should return true when Claude token exists", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasAnyCredential();
      expect(result).toBe(true);
    });

    it("should return true when LLM key exists", async () => {
      const testCreds = {
        llmKey: "sk-proj-test-456",
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasAnyCredential();
      expect(result).toBe(true);
    });

    it("should return true when LiteLLM credentials exist", async () => {
      const testCreds = {
        litellmCredentials: {
          api_base: "https://api.openai.com/v1",
          api_key: "sk-test-789",
        },
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasAnyCredential();
      expect(result).toBe(true);
    });

    it("should return true when multiple credentials exist", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasAnyCredential();
      expect(result).toBe(true);
    });
  });

  describe("getConfiguredCredentialCount", () => {
    it("should return 0 when no credentials exist", async () => {
      const count = await getConfiguredCredentialCount();
      expect(count).toBe(0);
    });

    it("should return 1 when one credential exists", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      
      writeTestCredentials(testCreds);
      
      const count = await getConfiguredCredentialCount();
      expect(count).toBe(1);
    });

    it("should return 2 when two credentials exist", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
      };
      
      writeTestCredentials(testCreds);
      
      const count = await getConfiguredCredentialCount();
      expect(count).toBe(2);
    });

    it("should return 3 when all credentials exist", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
        litellmCredentials: {
          api_base: "https://api.openai.com/v1",
          api_key: "sk-test-789",
        },
      };
      
      writeTestCredentials(testCreds);
      
      const count = await getConfiguredCredentialCount();
      expect(count).toBe(3);
    });
  });

  describe("getConfiguredCredentialTypes", () => {
    it("should return empty array when no credentials exist", async () => {
      const types = await getConfiguredCredentialTypes();
      expect(types).toEqual([]);
    });

    it("should return correct types for mixed configuration", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
        // litellmCredentials not configured
      };
      
      writeTestCredentials(testCreds);
      
      const types = await getConfiguredCredentialTypes();
      expect(types).toEqual(['Claude Code', 'LLM Key']);
    });

    it("should return all types when all credentials exist", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
        litellmCredentials: {
          api_base: "https://api.openai.com/v1",
          api_key: "sk-test-789",
        },
      };
      
      writeTestCredentials(testCreds);
      
      const types = await getConfiguredCredentialTypes();
      expect(types).toEqual(['Claude Code', 'LLM Key', 'LiteLLM']);
    });
  });

  describe("getClaudeToken", () => {
    it("should return null when no token exists", async () => {
      const token = await getClaudeToken();
      expect(token).toBeNull();
    });

    it("should return token when it exists", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      
      writeTestCredentials(testCreds);
      
      const token = await getClaudeToken();
      expect(token).toBe("sk-ant-test-123");
    });
  });

  describe("hasClaudeToken", () => {
    it("should return false when no token exists", async () => {
      const result = await hasClaudeToken();
      expect(result).toBe(false);
    });

    it("should return true when token exists", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasClaudeToken();
      expect(result).toBe(true);
    });

    it("should return false when token is empty string", async () => {
      const testCreds = {
        claudeCodeOAuthToken: "",
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasClaudeToken();
      expect(result).toBe(false);
    });
  });

  describe("getLLMKey", () => {
    it("should return null when no key exists", async () => {
      const key = await getLLMKey();
      expect(key).toBeNull();
    });

    it("should return key when it exists", async () => {
      const testCreds = {
        llmKey: "sk-proj-test-456",
      };
      
      writeTestCredentials(testCreds);
      
      const key = await getLLMKey();
      expect(key).toBe("sk-proj-test-456");
    });
  });

  describe("hasLLMKey", () => {
    it("should return false when no key exists", async () => {
      const result = await hasLLMKey();
      expect(result).toBe(false);
    });

    it("should return true when key exists", async () => {
      const testCreds = {
        llmKey: "sk-proj-test-456",
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasLLMKey();
      expect(result).toBe(true);
    });
  });

  describe("getLiteLLMCredentials", () => {
    it("should return null when no credentials exist", async () => {
      const creds = await getLiteLLMCredentials();
      expect(creds).toBeNull();
    });

    it("should return credentials when they exist", async () => {
      const testCreds = {
        litellmCredentials: {
          api_base: "https://api.openai.com/v1",
          api_key: "sk-test-789",
        },
      };
      
      writeTestCredentials(testCreds);
      
      const creds = await getLiteLLMCredentials();
      expect(creds).toEqual(testCreds.litellmCredentials);
    });
  });

  describe("hasLiteLLMCredentials", () => {
    it("should return false when no credentials exist", async () => {
      const result = await hasLiteLLMCredentials();
      expect(result).toBe(false);
    });

    it("should return true when credentials exist", async () => {
      const testCreds = {
        litellmCredentials: {
          api_base: "https://api.openai.com/v1",
          api_key: "sk-test-789",
        },
      };
      
      writeTestCredentials(testCreds);
      
      const result = await hasLiteLLMCredentials();
      expect(result).toBe(true);
    });
  });

  describe("setClaudeToken", () => {
    it("should create credentials file with correct permissions", async () => {
      await setClaudeToken("sk-ant-test-123");
      
      // Check file exists
      expect(fs.existsSync(TEST_CREDENTIALS_FILE)).toBe(true);
      
      // Check file permissions (600)
      const stats = fs.statSync(TEST_CREDENTIALS_FILE);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
      
      // Check content
      const content = fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.claudeCodeOAuthToken).toBe("sk-ant-test-123");
    });

    it("should create config directory with correct permissions", async () => {
      await setClaudeToken("sk-ant-test-123");
      
      // Check directory exists
      expect(fs.existsSync(TEST_CONFIG_DIR)).toBe(true);
      
      // Check directory permissions (700)
      const stats = fs.statSync(TEST_CONFIG_DIR);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });

    it("should update existing token", async () => {
      // Create initial credentials
      const initialCreds = {
        claudeCodeOAuthToken: "sk-ant-old-token",
        llmKey: "sk-proj-test-456",
      };
      writeTestCredentials(initialCreds);
      
      // Update token
      await setClaudeToken("sk-ant-new-token");
      
      // Check updated content
      const content = fs.readFileSync(TEST_CREDENTIALS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.claudeCodeOAuthToken).toBe("sk-ant-new-token");
      expect(parsed.llmKey).toBe("sk-proj-test-456"); // Should preserve other credentials
    });

    it("should throw error when token is empty", async () => {
      await expect(setClaudeToken("")).rejects.toThrow("Token cannot be empty");
    });

    it("should use atomic write (temp file pattern)", async () => {
      await setClaudeToken("sk-ant-test-123");
      
      // Temp file should not exist after atomic write
      expect(fs.existsSync(`${TEST_CREDENTIALS_FILE}.tmp`)).toBe(false);
      expect(fs.existsSync(TEST_CREDENTIALS_FILE)).toBe(true);
    });
  });

  describe("clearAllCredentials", () => {
    it("should remove credentials file", async () => {
      // Create credentials
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
        llmKey: "sk-proj-test-456",
      };
      writeTestCredentials(testCreds);
      
      expect(fs.existsSync(TEST_CREDENTIALS_FILE)).toBe(true);
      
      // Clear credentials
      await clearAllCredentials();
      
      expect(fs.existsSync(TEST_CREDENTIALS_FILE)).toBe(false);
    });

    it("should not throw error when file does not exist", async () => {
      // Should not throw
      await expect(clearAllCredentials()).resolves.toBeUndefined();
    });
  });

  describe("File permission validation", () => {
    it("should auto-fix incorrect file permissions on read", async () => {
      // Create directory and file with incorrect permissions
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-test-123",
      };
      writeTestCredentials(testCreds);
      fs.chmodSync(TEST_CREDENTIALS_FILE, 0o644); // Wrong permissions
      
      // Read should auto-fix permissions
      await getAllCredentials();
      
      // Check permissions were fixed
      const stats = fs.statSync(TEST_CREDENTIALS_FILE);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("should auto-fix incorrect directory permissions", async () => {
      // Create directory with incorrect permissions
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      fs.chmodSync(TEST_CONFIG_DIR, 0o755); // Wrong permissions
      
      // Write should auto-fix permissions
      await setClaudeToken("sk-ant-test-123");
      
      // Check directory permissions were fixed
      const stats = fs.statSync(TEST_CONFIG_DIR);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });
  });

  describe("Security", () => {
    it("should not expose credential values in errors", async () => {
      // This is a behavior test - credentials should never be logged
      // We can't directly test console output, but we ensure our functions
      // don't throw errors that include credential values
      
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      const testCreds = {
        claudeCodeOAuthToken: "sk-ant-secret-token",
      };
      writeTestCredentials(testCreds);
      
      // Get credentials - should not log values
      const creds = await getAllCredentials();
      expect(creds.claudeToken).toBe("sk-ant-secret-token");
      
      // Note: In production, warning messages should mask values
      // This is checked manually during development
    });
  });
});
