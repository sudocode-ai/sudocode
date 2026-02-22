/**
 * Tests for install source detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock child_process before importing the module
vi.mock("child_process");

// Mock fs for musl detection
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

import { execSync } from "child_process";
import * as fs from "fs";
import {
  detectInstallSource,
  isBinaryInstall,
  detectPlatform,
  getBinaryInstallDir,
} from "../../src/install-source.js";

describe("Install Source Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isBinaryInstall", () => {
    it("should return false in non-SEA environment", () => {
      // In a normal Node.js environment, require('node:sea') throws
      expect(isBinaryInstall()).toBe(false);
    });
  });

  describe("detectInstallSource", () => {
    it("should detect npm metapackage when npm list succeeds", () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (typeof cmd === "string" && cmd.includes("npm list -g sudocode")) {
          return Buffer.from("sudocode@0.1.21");
        }
        throw new Error("command not found");
      });

      const source = detectInstallSource();
      expect(source).toBe("npm-meta");
    });

    it("should fall back to npm-standalone when metapackage not found", () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (typeof cmd === "string" && cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        throw new Error("command not found");
      });

      const source = detectInstallSource();
      expect(source).toBe("npm-standalone");
    });

    it("should detect Volta when execPath contains /.volta/", () => {
      const originalExecPath = process.execPath;
      Object.defineProperty(process, "execPath", {
        value: "/home/user/.volta/bin/node",
        writable: true,
        configurable: true,
      });

      try {
        // Should not shell out to npm when Volta is detected first
        const source = detectInstallSource();
        expect(source).toBe("volta");
      } finally {
        Object.defineProperty(process, "execPath", {
          value: originalExecPath,
          writable: true,
          configurable: true,
        });
      }
    });

    it("should detect Volta via VOLTA_HOME env var", () => {
      const originalExecPath = process.execPath;
      const originalVoltaHome = process.env.VOLTA_HOME;

      Object.defineProperty(process, "execPath", {
        value: "/custom/volta/path/bin/node",
        writable: true,
        configurable: true,
      });
      process.env.VOLTA_HOME = "/custom/volta/path";

      try {
        const source = detectInstallSource();
        expect(source).toBe("volta");
      } finally {
        Object.defineProperty(process, "execPath", {
          value: originalExecPath,
          writable: true,
          configurable: true,
        });
        if (originalVoltaHome === undefined) {
          delete process.env.VOLTA_HOME;
        } else {
          process.env.VOLTA_HOME = originalVoltaHome;
        }
      }
    });
  });

  describe("detectPlatform", () => {
    it("should return a valid platform string", () => {
      const platform = detectPlatform();
      // Should match one of our known platform patterns
      expect(platform).toMatch(
        /^(linux|darwin|win)-(x64|arm64)(-musl)?$/
      );
    });

    it("should start with the correct OS prefix", () => {
      const platform = detectPlatform();
      const expectedOs =
        process.platform === "win32"
          ? "win"
          : process.platform === "darwin"
            ? "darwin"
            : "linux";
      expect(platform.startsWith(expectedOs)).toBe(true);
    });

    it("should include the correct arch", () => {
      const platform = detectPlatform();
      const expectedArch = process.arch === "arm64" ? "arm64" : "x64";
      expect(platform).toContain(expectedArch);
    });
  });

  describe("getBinaryInstallDir", () => {
    it("should return SUDOCODE_INSTALL_DIR if set", () => {
      const original = process.env.SUDOCODE_INSTALL_DIR;
      process.env.SUDOCODE_INSTALL_DIR = "/custom/install/dir";

      try {
        expect(getBinaryInstallDir()).toBe("/custom/install/dir");
      } finally {
        if (original === undefined) {
          delete process.env.SUDOCODE_INSTALL_DIR;
        } else {
          process.env.SUDOCODE_INSTALL_DIR = original;
        }
      }
    });

    it("should resolve from process.execPath when bin/ subdir exists", () => {
      const original = process.env.SUDOCODE_INSTALL_DIR;
      delete process.env.SUDOCODE_INSTALL_DIR;

      // Mock fs.existsSync to return true for the expected bin/ path
      const originalExecPath = process.execPath;
      Object.defineProperty(process, "execPath", {
        value: "/home/user/.local/share/sudocode/bin/sudocode",
        writable: true,
        configurable: true,
      });

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (String(p) === "/home/user/.local/share/sudocode/bin") return true;
        return false;
      });

      try {
        expect(getBinaryInstallDir()).toBe("/home/user/.local/share/sudocode");
      } finally {
        Object.defineProperty(process, "execPath", {
          value: originalExecPath,
          writable: true,
          configurable: true,
        });
        if (original === undefined) {
          delete process.env.SUDOCODE_INSTALL_DIR;
        } else {
          process.env.SUDOCODE_INSTALL_DIR = original;
        }
      }
    });

    it("should return null when install dir cannot be determined", () => {
      const original = process.env.SUDOCODE_INSTALL_DIR;
      delete process.env.SUDOCODE_INSTALL_DIR;

      vi.mocked(fs.existsSync).mockReturnValue(false);

      try {
        expect(getBinaryInstallDir()).toBeNull();
      } finally {
        if (original === undefined) {
          delete process.env.SUDOCODE_INSTALL_DIR;
        } else {
          process.env.SUDOCODE_INSTALL_DIR = original;
        }
      }
    });
  });
});
