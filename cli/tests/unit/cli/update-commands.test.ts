/**
 * Unit tests for update CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import {
  handleUpdate,
  handleUpdateCheck,
  handleUpdateDismiss,
} from "../../../src/cli/update-commands.js";
import * as updateChecker from "../../../src/update-checker.js";

// Mock child_process
vi.mock("child_process");

describe("Update CLI Commands", () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("Package Detection", () => {
    it("should detect metapackage installation", async () => {
      // Mock successful npm list for metapackage
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          return Buffer.from("sudocode@1.1.7");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdate();

      // Should show metapackage detection message
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("metapackage installation");

      // Should attempt to install metapackage
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("npm install -g sudocode"),
        expect.any(Object)
      );
    });

    it("should detect standalone CLI installation", async () => {
      // Mock failed npm list for metapackage (not installed)
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdate();

      // Should show standalone CLI detection message
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("standalone CLI installation");

      // Should attempt to install CLI package
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("npm install -g @sudocode-ai/cli"),
        expect.any(Object)
      );
    });
  });

  describe("Smart Force Retry", () => {
    it("should succeed without --force on first try", async () => {
      let callCount = 0;
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        callCount++;
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        // First install succeeds
        if (cmd.includes("npm install -g")) {
          return Buffer.from("success");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdate();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Update completed successfully");

      // Should not mention retrying with --force
      expect(output).not.toContain("retrying with --force");
    });

    it("should retry with --force when EEXIST error occurs", async () => {
      let installAttempts = 0;
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        if (cmd.includes("npm install -g")) {
          installAttempts++;
          if (installAttempts === 1 && !cmd.includes("--force")) {
            // First attempt fails with EEXIST
            const error: any = new Error(
              "npm error code EEXIST\nnpm error File exists"
            );
            error.status = 1;
            throw error;
          }
          // Second attempt with --force succeeds
          return Buffer.from("success");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdate();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("File already exists, retrying with --force");
      expect(output).toContain("Update completed successfully");
      expect(installAttempts).toBe(2);
    });

    it("should fail immediately on non-EEXIST errors", async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        if (cmd.includes("npm install -g")) {
          const error: any = new Error("Network error");
          error.status = 1;
          throw error;
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdate();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).not.toContain("retrying with --force");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Update failed")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("handleUpdate", () => {
    it("should skip update if already on latest version", async () => {
      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.7",
        latest: "0.1.7",
        updateAvailable: false,
      });

      await handleUpdate();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Already on latest version");
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining("npm install"),
        expect.any(Object)
      );
    });

    it("should attempt update even if version check fails", async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue(null);

      await handleUpdate();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Unable to check for updates");
      expect(output).toContain("Attempting to update anyway");

      // Should still attempt install
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("npm install -g"),
        expect.any(Object)
      );
    });

    it("should show correct package name in error fallback", async () => {
      // Test with metapackage
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          return Buffer.from("sudocode@1.1.7");
        }
        if (cmd.includes("npm install -g")) {
          const error: any = new Error("Fatal error");
          error.status = 1;
          throw error;
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdate();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("npm install -g sudocode --force");
    });
  });

  describe("handleUpdateCheck", () => {
    it("should show update available with detected package name", async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          return Buffer.from("sudocode@1.1.7");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdateCheck();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Current version");
      expect(output).toContain("0.1.5");
      expect(output).toContain("Latest version");
      expect(output).toContain("0.1.7");
      expect(output).toContain("Package");
      expect(output).toContain("sudocode");
      expect(output).toContain("Update available");
      expect(output).toContain("sudocode update");
      expect(output).toContain("npm install -g sudocode --force");
    });

    it("should show already on latest version", async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.7",
        latest: "0.1.7",
        updateAvailable: false,
      });

      await handleUpdateCheck();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("You are using the latest version");
    });

    it("should handle version check failure gracefully", async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue(null);

      await handleUpdateCheck();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Unable to check for updates");
      expect(output).toContain("npm view @sudocode-ai/cli version");
    });

    it("should show correct package name for CLI installation", async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes("npm list -g sudocode")) {
          throw new Error("Package not found");
        }
        return Buffer.from("");
      });

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdateCheck();

      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Package: @sudocode-ai/cli");
      expect(output).toContain("npm install -g @sudocode-ai/cli --force");
    });
  });

  describe("handleUpdateDismiss", () => {
    it("should dismiss update notifications", async () => {
      const dismissSpy = vi
        .spyOn(updateChecker, "dismissUpdate")
        .mockImplementation(() => {});

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.5",
        latest: "0.1.7",
        updateAvailable: true,
      });

      await handleUpdateDismiss();

      expect(dismissSpy).toHaveBeenCalledWith("0.1.7");
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Update notifications dismissed for 30 days");
    });

    it("should not dismiss if already on latest version", async () => {
      const dismissSpy = vi
        .spyOn(updateChecker, "dismissUpdate")
        .mockImplementation(() => {});

      vi.spyOn(updateChecker, "checkForUpdates").mockResolvedValue({
        current: "0.1.7",
        latest: "0.1.7",
        updateAvailable: false,
      });

      await handleUpdateDismiss();

      expect(dismissSpy).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(" ");
      expect(output).toContain("Already on latest version");
      expect(output).toContain("No update notifications to dismiss");
    });
  });
});
