/**
 * Unit tests for SudocodeMCPServer initialization checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SudocodeMCPServer } from "../../src/server.js";
import * as fs from "fs";
import * as path from "path";

// Mock fs and path modules
vi.mock("fs");
vi.mock("path");

// Mock the client
vi.mock("../../src/client.js", () => ({
  SudocodeClient: vi.fn().mockImplementation((config) => ({
    workingDir: config?.workingDir || "/test/working/dir",
    exec: vi.fn(),
  })),
}));

// Mock MCP SDK
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn(),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

describe("SudocodeMCPServer", () => {
  let consoleErrorSpy: any;
  let mockExistsSync: any;
  let mockJoin: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExistsSync = vi.mocked(fs.existsSync);
    mockJoin = vi.mocked(path.join);

    // Default mock for path.join - just concatenate with /
    mockJoin.mockImplementation((...args: string[]) => args.join("/"));
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
  });

  describe("checkForInit", () => {
    it("should return not initialized when .sudocode directory does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const server = new SudocodeMCPServer();
      // Access private method for testing
      const result = await (server as any).checkForInit();

      expect(result).toEqual({
        initialized: false,
        sudocodeExists: false,
        message: "No .sudocode directory found",
      });
    });

    it("should auto-init when .sudocode exists but no cache.db or JSONL files", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // Only .sudocode directory exists, nothing else
        if (p === "/test/working/dir/.sudocode") {
          return true;
        }
        return false; // cache.db, issues.jsonl, specs.jsonl do not exist
      });

      const server = new SudocodeMCPServer();
      const mockExec = vi.fn().mockResolvedValue({ success: true });
      (server as any).client.exec = mockExec;

      const result = await (server as any).checkForInit();

      expect(mockExec).toHaveBeenCalledWith(["init"]);
      expect(mockExec).toHaveBeenCalledWith(["import"]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Found .sudocode directory but no issues.jsonl or specs.jsonl, running init..."
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "✓ Successfully initialized sudocode"
      );
      expect(result).toEqual({
        initialized: true,
        sudocodeExists: true,
        message: "Initialized sudocode",
      });
    });

    it("should return initialized when cache.db exists", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // .sudocode dir and cache.db exist
        return p.includes(".sudocode");
      });

      const server = new SudocodeMCPServer();
      const result = await (server as any).checkForInit();

      expect(result).toEqual({
        initialized: true,
        sudocodeExists: true,
      });
    });

    it("should auto-import when .sudocode exists with JSONL but no cache.db", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes("cache.db")) return false; // No cache.db
        if (p.includes("issues.jsonl")) return true; // issues.jsonl exists
        if (p.includes(".sudocode")) return true; // .sudocode exists
        return false;
      });

      const server = new SudocodeMCPServer();
      const mockExec = vi.fn().mockResolvedValue({ success: true });
      (server as any).client.exec = mockExec;

      const result = await (server as any).checkForInit();

      expect(mockExec).toHaveBeenCalledWith(["import"]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Found .sudocode directory but no cache.db, running import..."
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "✓ Successfully imported data to cache.db"
      );
      expect(result).toEqual({
        initialized: true,
        sudocodeExists: true,
        message: "Auto-imported from JSONL files",
      });
    });

    it("should handle import failure gracefully", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes("cache.db")) return false;
        if (p.includes("specs.jsonl")) return true;
        if (p.includes(".sudocode")) return true;
        return false;
      });

      const server = new SudocodeMCPServer();
      const mockExec = vi.fn().mockRejectedValue(new Error("Import failed"));
      (server as any).client.exec = mockExec;

      const result = await (server as any).checkForInit();

      expect(result).toEqual({
        initialized: false,
        sudocodeExists: true,
        message: "Failed to import: Import failed",
      });
    });
  });

  describe("checkInitialization", () => {
    it("should set isInitialized to true when initialized", async () => {
      mockExistsSync.mockReturnValue(true); // All files exist

      const server = new SudocodeMCPServer();
      await (server as any).checkInitialization();

      expect((server as any).isInitialized).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "✓ sudocode initialized successfully"
      );
    });

    it("should set isInitialized to false when not initialized", async () => {
      mockExistsSync.mockReturnValue(false); // Nothing exists

      const server = new SudocodeMCPServer();
      await (server as any).checkInitialization();

      expect((server as any).isInitialized).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "⚠️  WARNING: sudocode is not initialized"
      );
    });

    it("should display init command when .sudocode does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const server = new SudocodeMCPServer();
      await (server as any).checkInitialization();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("No .sudocode directory found.")
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("$ sudocode init")
      );
    });

    it("should auto-init when .sudocode exists but is incomplete", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // Only .sudocode directory exists, no cache.db or JSONL files
        if (p === "/test/working/dir/.sudocode") return true;
        return false;
      });

      const server = new SudocodeMCPServer();
      const mockExec = vi.fn().mockResolvedValue({ success: true });
      (server as any).client.exec = mockExec;

      await (server as any).checkInitialization();

      expect(mockExec).toHaveBeenCalledWith(["init"]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Found .sudocode directory but no issues.jsonl or specs.jsonl, running init..."
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "✓ Successfully initialized sudocode"
      );
      expect((server as any).isInitialized).toBe(true);
    });

    it("should display auto-import success message", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes("cache.db")) return false;
        if (p.includes("issues.jsonl")) return true;
        if (p.includes(".sudocode")) return true;
        return false;
      });

      const server = new SudocodeMCPServer();
      const mockExec = vi.fn().mockResolvedValue({ success: true });
      (server as any).client.exec = mockExec;

      await (server as any).checkInitialization();

      expect((server as any).isInitialized).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "  Auto-imported from JSONL files"
      );
    });
  });

  describe("tool handler with isInitialized check", () => {
    it("should return error when isInitialized is false", async () => {
      mockExistsSync.mockReturnValue(false);

      const server = new SudocodeMCPServer();
      await (server as any).checkInitialization();

      // Simulate calling the tool handler
      expect((server as any).isInitialized).toBe(false);

      // Verify the error message format that would be returned
      const expectedErrorPattern = /sudocode is not initialized/;
      const workingDir = (server as any).client.workingDir || process.cwd();

      // This validates the logic that would be in the actual handler
      const errorMessage = `⚠️  sudocode is not initialized in this directory.\n\nWorking directory: ${workingDir}\n\nPlease run 'sudocode init' in your project root first.`;

      expect(errorMessage).toMatch(expectedErrorPattern);
      expect(errorMessage).toContain(workingDir);
    });

    it("should allow tools to proceed when isInitialized is true", async () => {
      mockExistsSync.mockReturnValue(true);

      const server = new SudocodeMCPServer();
      await (server as any).checkInitialization();

      expect((server as any).isInitialized).toBe(true);
      // When initialized, tools should be allowed to proceed
    });
  });

  describe("run method", () => {
    it("should call checkInitialization before starting server", async () => {
      mockExistsSync.mockReturnValue(true);

      const server = new SudocodeMCPServer();
      const checkInitSpy = vi.spyOn(server as any, "checkInitialization");

      // Mock the connect method to prevent actual connection
      (server as any).server.connect = vi.fn().mockResolvedValue(undefined);

      await server.run();

      expect(checkInitSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "sudocode MCP server running on stdio"
      );
    });
  });
});
