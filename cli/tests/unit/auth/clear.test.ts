/**
 * Tests for auth clear command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import { handleAuthClear } from "../../../src/auth/clear.js";
import { setClaudeToken, getCredentialsFilePath } from "../../../src/auth/credentials.js";

// Mock readline
vi.mock("readline", () => ({
  createInterface: vi.fn(),
}));

describe("handleAuthClear", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Create temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-test-"));
    
    // Override XDG_CONFIG_HOME to use temp directory
    originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    
    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.XDG_CONFIG_HOME = originalEnv;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("with no credentials file", () => {
    it("should display message when no credentials file exists", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(consoleSpy).toHaveBeenCalledWith("No credentials configured. Nothing to clear.");
      
      consoleSpy.mockRestore();
    });
  });

  describe("with empty credentials", () => {
    it("should display message when credentials file exists but is empty", async () => {
      // Create empty credentials file
      const configDir = path.join(tempDir, "sudocode");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "user_credentials.json"), "{}");
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(consoleSpy).toHaveBeenCalledWith("No credentials configured. Nothing to clear.");
      
      consoleSpy.mockRestore();
    });
  });

  describe("force mode", () => {
    it("should delete credentials file without confirmation when force flag is set", async () => {
      // Create credentials file
      await setClaudeToken("sk-ant-test-token");
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(true);
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: true });
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✓ All credentials cleared"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✓ Removed"));
      
      consoleSpy.mockRestore();
    });
  });

  describe("interactive confirmation", () => {
    it("should prompt for confirmation and delete when user confirms with 'y'", async () => {
      // Create credentials file
      await setClaudeToken("sk-ant-test-token");
      
      // Mock readline to return 'y'
      const mockQuestion = vi.fn((question, callback) => {
        callback("y");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(mockQuestion).toHaveBeenCalledWith(
        "Delete all credentials? (y/N): ",
        expect.any(Function)
      );
      expect(mockClose).toHaveBeenCalled();
      expect(fs.existsSync(getCredentialsFilePath())).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✓ All credentials cleared"));
      
      consoleSpy.mockRestore();
    });

    it("should prompt for confirmation and delete when user confirms with 'yes'", async () => {
      // Create credentials file
      await setClaudeToken("sk-ant-test-token");
      
      // Mock readline to return 'yes'
      const mockQuestion = vi.fn((question, callback) => {
        callback("yes");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("✓ All credentials cleared"));
      
      consoleSpy.mockRestore();
    });

    it("should prompt for confirmation and NOT delete when user rejects with 'n'", async () => {
      // Create credentials file
      await setClaudeToken("sk-ant-test-token");
      
      // Mock readline to return 'n'
      const mockQuestion = vi.fn((question, callback) => {
        callback("n");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
      
      consoleSpy.mockRestore();
    });

    it("should prompt for confirmation and NOT delete when user rejects with 'no'", async () => {
      // Create credentials file
      await setClaudeToken("sk-ant-test-token");
      
      // Mock readline to return 'no'
      const mockQuestion = vi.fn((question, callback) => {
        callback("no");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
      
      consoleSpy.mockRestore();
    });

    it("should prompt for confirmation and NOT delete when user provides empty input", async () => {
      // Create credentials file
      await setClaudeToken("sk-ant-test-token");
      
      // Mock readline to return empty string
      const mockQuestion = vi.fn((question, callback) => {
        callback("");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
      
      consoleSpy.mockRestore();
    });

    it("should be case-insensitive for 'Y' and 'YES'", async () => {
      // Test 'Y'
      await setClaudeToken("sk-ant-test-token");
      
      const mockQuestion = vi.fn((question, callback) => {
        callback("Y");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(false);
      
      // Test 'YES'
      await setClaudeToken("sk-ant-test-token");
      
      mockQuestion.mockClear();
      mockQuestion.mockImplementation((question, callback) => {
        callback("YES");
      });
      
      await handleAuthClear({ force: false });
      
      expect(fs.existsSync(getCredentialsFilePath())).toBe(false);
      
      consoleSpy.mockRestore();
    });
  });

  describe("display configured credentials", () => {
    it("should display configured credential types before prompting", async () => {
      // Create credentials file
      await setClaudeToken("sk-ant-test-token");
      
      // Mock readline to return 'n'
      const mockQuestion = vi.fn((question, callback) => {
        callback("n");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      // Should display warning
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning"));
      
      // Should display "Current credentials:"
      expect(consoleSpy).toHaveBeenCalledWith("Current credentials:");
      
      // Should display Claude Code as configured
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Claude Code"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("configured"));
      
      consoleSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle missing credentials file gracefully in force mode", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: true });
      
      expect(consoleSpy).toHaveBeenCalledWith("No credentials configured. Nothing to clear.");
      
      consoleSpy.mockRestore();
    });

    it("should close readline interface after use", async () => {
      await setClaudeToken("sk-ant-test-token");
      
      const mockQuestion = vi.fn((question, callback) => {
        callback("n");
      });
      const mockClose = vi.fn();
      
      (readline.createInterface as any).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      await handleAuthClear({ force: false });
      
      expect(mockClose).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });
});
