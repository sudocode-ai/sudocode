/**
 * Tests for CLI utilities
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { execSync, spawnSync } from "child_process";
import {
  isBeadsCLIAvailable,
  getBeadsCLICommand,
  execBeadsCommand,
  parseBeadsCreateOutput,
  clearCLICache,
} from "../src/cli-utils.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

describe("CLI Utils", () => {
  beforeEach(() => {
    clearCLICache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearCLICache();
  });

  describe("isBeadsCLIAvailable", () => {
    it("should return true when beads command is available", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from("beads v1.0.0"));

      expect(isBeadsCLIAvailable()).toBe(true);
      expect(execSync).toHaveBeenCalledWith("beads --version", { stdio: "ignore" });
    });

    it("should try bd command when beads is not available", () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === "beads --version") {
          throw new Error("command not found");
        }
        return Buffer.from("bd v1.0.0");
      });

      expect(isBeadsCLIAvailable()).toBe(true);
      expect(execSync).toHaveBeenCalledWith("bd --version", { stdio: "ignore" });
    });

    it("should return false when neither command is available", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });

      expect(isBeadsCLIAvailable()).toBe(false);
    });

    it("should cache the result", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from("beads v1.0.0"));

      // First call
      isBeadsCLIAvailable();
      // Second call should use cache
      isBeadsCLIAvailable();

      // execSync should only be called once (for beads --version)
      expect(execSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("getBeadsCLICommand", () => {
    it("should return beads when beads is available", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from("beads v1.0.0"));

      isBeadsCLIAvailable(); // Populate cache
      expect(getBeadsCLICommand()).toBe("beads");
    });

    it("should return bd when only bd is available", () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === "beads --version") {
          throw new Error("command not found");
        }
        return Buffer.from("bd v1.0.0");
      });

      isBeadsCLIAvailable(); // Populate cache
      expect(getBeadsCLICommand()).toBe("bd");
    });

    it("should return null when no CLI is available", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });

      isBeadsCLIAvailable(); // Populate cache
      expect(getBeadsCLICommand()).toBeNull();
    });
  });

  describe("execBeadsCommand", () => {
    it("should execute command with beads CLI", () => {
      // Setup CLI as available
      vi.mocked(execSync).mockImplementation(() => Buffer.from("beads v1.0.0"));
      isBeadsCLIAvailable();

      // Setup spawnSync for the actual command
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: "Created issue beads-a1b2c3d4",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = execBeadsCommand(["create", "Test Issue"], "/project");

      expect(spawnSync).toHaveBeenCalledWith(
        "beads",
        ["create", "Test Issue"],
        expect.objectContaining({
          cwd: "/project",
          encoding: "utf-8",
        })
      );
      expect(result).toBe("Created issue beads-a1b2c3d4");
    });

    it("should throw error when CLI is not available", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });
      isBeadsCLIAvailable();

      expect(() => execBeadsCommand(["create", "Test"], "/project")).toThrow(
        "Beads CLI is not available"
      );
    });

    it("should throw error when command fails", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from("beads v1.0.0"));
      isBeadsCLIAvailable();

      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Error: Invalid arguments",
        pid: 1234,
        output: [],
        signal: null,
      });

      expect(() => execBeadsCommand(["invalid"], "/project")).toThrow(
        "Beads command failed: Error: Invalid arguments"
      );
    });

    it("should throw error when spawn fails", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from("beads v1.0.0"));
      isBeadsCLIAvailable();

      vi.mocked(spawnSync).mockReturnValue({
        status: null,
        stdout: "",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
        error: new Error("ENOENT"),
      });

      expect(() => execBeadsCommand(["create", "Test"], "/project")).toThrow("ENOENT");
    });
  });

  describe("parseBeadsCreateOutput", () => {
    it("should parse standard beads output", () => {
      expect(parseBeadsCreateOutput("Created issue beads-a1b2c3d4")).toBe("beads-a1b2c3d4");
    });

    it("should parse output with only the ID", () => {
      expect(parseBeadsCreateOutput("beads-abcd1234")).toBe("beads-abcd1234");
    });

    it("should parse alternative ID formats", () => {
      expect(parseBeadsCreateOutput("Created bd-12345678")).toBe("bd-12345678");
    });

    it("should handle output with extra whitespace", () => {
      expect(parseBeadsCreateOutput("  Created issue beads-a1b2c3d4  \n")).toBe("beads-a1b2c3d4");
    });

    it("should handle output with multiple lines", () => {
      const output = "Processing...\nCreated issue beads-a1b2c3d4\nDone.";
      expect(parseBeadsCreateOutput(output)).toBe("beads-a1b2c3d4");
    });

    it("should throw when no ID found", () => {
      expect(() => parseBeadsCreateOutput("Success!")).toThrow("Could not parse issue ID");
    });

    it("should throw on empty output", () => {
      expect(() => parseBeadsCreateOutput("")).toThrow("Could not parse issue ID");
    });
  });

  describe("clearCLICache", () => {
    it("should clear the cache so CLI is re-detected", () => {
      // First call - CLI available
      vi.mocked(execSync).mockImplementation(() => Buffer.from("beads v1.0.0"));
      expect(isBeadsCLIAvailable()).toBe(true);

      // Clear and change behavior
      clearCLICache();
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });

      // Second call after cache clear - should re-check
      expect(isBeadsCLIAvailable()).toBe(false);
    });
  });
});
