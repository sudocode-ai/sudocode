/**
 * Tests for server command handlers
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { handleServerStart } from "../../../src/cli/server-commands.js";
import * as updateChecker from "../../../src/update-checker.js";
import * as childProcess from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    unref: vi.fn(),
    kill: vi.fn(),
    on: vi.fn(),
  })),
}));

// Mock update checker
vi.mock("../../../src/update-checker.js", () => ({
  getUpdateNotification: vi.fn(),
}));

describe("Server Commands", () => {
  const mockContext = {
    db: {},
    outputDir: "/test/.sudocode",
    jsonOutput: false,
  };

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("handleServerStart", () => {
    it("should check for updates before starting server", async () => {
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      getUpdateNotificationMock.mockResolvedValue(null);

      await handleServerStart(mockContext, { detach: true });

      expect(getUpdateNotificationMock).toHaveBeenCalledOnce();
    });

    it("should display update notification if available", async () => {
      const notification = "Update available: 0.1.0 → 0.2.0";
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      getUpdateNotificationMock.mockResolvedValue(notification);

      await handleServerStart(mockContext, { detach: true });

      expect(consoleLogSpy).toHaveBeenCalledWith();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(notification)
      );
    });

    it("should not display notification if no update available", async () => {
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      getUpdateNotificationMock.mockResolvedValue(null);

      await handleServerStart(mockContext, { detach: true });

      // Should still call console.log for server startup messages
      expect(consoleLogSpy).toHaveBeenCalled();
      // But not with update notification content
      const allLogs = consoleLogSpy.mock.calls
        .map((call) => call.join(" "))
        .join(" ");
      expect(allLogs).not.toContain("Update available");
    });

    it("should start server in detached mode", async () => {
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      getUpdateNotificationMock.mockResolvedValue(null);

      const spawnMock = vi.mocked(childProcess.spawn);

      await handleServerStart(mockContext, { detach: true, port: "3001" });

      expect(spawnMock).toHaveBeenCalledWith(
        "node",
        [expect.stringContaining("server/dist/src/index.js")],
        expect.objectContaining({
          detached: true,
          stdio: "ignore",
          env: expect.objectContaining({
            SUDOCODE_DIR: "/test/.sudocode",
            PORT: "3001",
          }),
        })
      );
    });

    it("should start server in attached mode", async () => {
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      getUpdateNotificationMock.mockResolvedValue(null);

      const spawnMock = vi.mocked(childProcess.spawn);

      await handleServerStart(mockContext, { detach: false });

      expect(spawnMock).toHaveBeenCalledWith(
        "node",
        [expect.stringContaining("server/dist/src/index.js")],
        expect.objectContaining({
          detached: false,
          stdio: "inherit",
        })
      );
    });

    it("should use default port if not specified", async () => {
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      getUpdateNotificationMock.mockResolvedValue(null);

      const spawnMock = vi.mocked(childProcess.spawn);

      await handleServerStart(mockContext, { detach: true });

      const call = spawnMock.mock.calls[0];
      const options = call?.[2] as any;
      expect(options?.env?.PORT).toBe("3000");
    });

    it("should pass SUDOCODE_DIR environment variable", async () => {
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      getUpdateNotificationMock.mockResolvedValue(null);

      const spawnMock = vi.mocked(childProcess.spawn);

      await handleServerStart(mockContext, { detach: true });

      const call = spawnMock.mock.calls[0];
      const options = call?.[2] as any;
      expect(options?.env?.SUDOCODE_DIR).toBe("/test/.sudocode");
    });

    it("should handle update check failures gracefully", async () => {
      const getUpdateNotificationMock = vi.mocked(
        updateChecker.getUpdateNotification
      );
      // Simulate update check failure
      getUpdateNotificationMock.mockRejectedValue(
        new Error("Network error")
      );

      // Should not throw
      await expect(
        handleServerStart(mockContext, { detach: true })
      ).resolves.not.toThrow();
    });
  });
});
