/**
 * Tests for update checker functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  checkForUpdates,
  getUpdateNotification,
  clearUpdateCache,
  dismissUpdate,
} from "../../src/update-checker.js";
import * as installSource from "../../src/install-source.js";

const CACHE_DIR = path.join(os.tmpdir(), "sudocode-cli");
const CACHE_FILE = path.join(CACHE_DIR, "update-cache.json");
const DISMISS_FILE = path.join(CACHE_DIR, "update-dismissed.json");

describe("Update Checker", () => {
  beforeEach(() => {
    // Clear cache before each test
    clearUpdateCache();
  });

  afterEach(() => {
    // Clean up cache after each test
    clearUpdateCache();
  });

  describe("checkForUpdates", () => {
    it("should return null if fetch fails", async () => {
      // Mock fetch to fail
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await checkForUpdates();
      expect(result).toBeNull();
    });

    it("should return update info if fetch succeeds", async () => {
      // Mock fetch to return a newer version
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      } as Response);

      const result = await checkForUpdates();
      expect(result).not.toBeNull();
      expect(result?.updateAvailable).toBe(true);
      expect(result?.latest).toBe("99.0.0");
    });

    it("should cache the result", async () => {
      // Mock fetch to return a version
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      } as Response);

      // First call
      await checkForUpdates();

      // Cache file should exist
      expect(fs.existsSync(CACHE_FILE)).toBe(true);

      // Second call should use cache (fetch should only be called once)
      global.fetch = vi.fn(); // Reset mock
      await checkForUpdates();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should not show update available if versions are equal", async () => {
      // Mock fetch to return current version
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../package.json"), "utf-8")
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: pkg.version }),
      } as Response);

      const result = await checkForUpdates();
      expect(result?.updateAvailable).toBe(false);
    });
  });

  describe("getUpdateNotification", () => {
    it("should return null if no update available", async () => {
      // Mock fetch to return current version
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../package.json"), "utf-8")
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: pkg.version }),
      } as Response);

      const notification = await getUpdateNotification();
      expect(notification).toBeNull();
    });

    it("should return notification if update available", async () => {
      // Mock fetch to return newer version
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      } as Response);

      const notification = await getUpdateNotification();
      expect(notification).not.toBeNull();
      expect(notification).toContain("99.0.0");
      expect(notification).toContain("Update available");
      expect(notification).toContain("sudocode update");
    });

    it("should not notify if current version is newer", async () => {
      // Mock fetch to return older version
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.0.1" }),
      } as Response);

      const notification = await getUpdateNotification();
      expect(notification).toBeNull();
    });
  });

  describe("clearUpdateCache", () => {
    it("should remove cache file", async () => {
      // Create a cache entry
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      } as Response);

      await checkForUpdates();
      expect(fs.existsSync(CACHE_FILE)).toBe(true);

      // Clear cache
      clearUpdateCache();
      expect(fs.existsSync(CACHE_FILE)).toBe(false);
    });

    it("should handle missing cache file gracefully", () => {
      expect(() => clearUpdateCache()).not.toThrow();
    });
  });

  describe("checkForUpdates (binary install)", () => {
    it("should fetch from GitHub Releases when binary install", async () => {
      vi.spyOn(installSource, "isBinaryInstall").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "v99.0.0" }),
      } as Response);

      clearUpdateCache();
      const result = await checkForUpdates();
      expect(result).not.toBeNull();
      expect(result?.latest).toBe("99.0.0");
      expect(result?.updateAvailable).toBe(true);

      // Should have called GitHub Releases API, not npm
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("api.github.com/repos/sudocode-ai/sudocode/releases/latest"),
        expect.any(Object)
      );
    });

    it("should strip v prefix from GitHub tag", async () => {
      vi.spyOn(installSource, "isBinaryInstall").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "v1.2.3" }),
      } as Response);

      clearUpdateCache();
      const result = await checkForUpdates();
      expect(result?.latest).toBe("1.2.3");
    });

    it("should handle GitHub tag without v prefix", async () => {
      vi.spyOn(installSource, "isBinaryInstall").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "2.0.0" }),
      } as Response);

      clearUpdateCache();
      const result = await checkForUpdates();
      expect(result?.latest).toBe("2.0.0");
    });

    it("should return null if GitHub API fails", async () => {
      vi.spyOn(installSource, "isBinaryInstall").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      clearUpdateCache();
      const result = await checkForUpdates();
      expect(result).toBeNull();
    });

    it("should return null if GitHub response has no tag_name", async () => {
      vi.spyOn(installSource, "isBinaryInstall").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      clearUpdateCache();
      const result = await checkForUpdates();
      expect(result).toBeNull();
    });
  });

  describe("checkForUpdates (npm install)", () => {
    it("should fetch from npm registry when not binary install", async () => {
      vi.spyOn(installSource, "isBinaryInstall").mockReturnValue(false);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      } as Response);

      clearUpdateCache();
      const result = await checkForUpdates();
      expect(result).not.toBeNull();
      expect(result?.latest).toBe("99.0.0");

      // Should have called npm registry, not GitHub
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("registry.npmjs.org"),
        expect.any(Object)
      );
    });
  });

  describe("dismissUpdate", () => {
    it("should create dismiss file", () => {
      dismissUpdate("2.0.0");
      expect(fs.existsSync(DISMISS_FILE)).toBe(true);
    });

    it("should store version and timestamp", () => {
      dismissUpdate("2.0.0");
      const content = fs.readFileSync(DISMISS_FILE, "utf-8");
      const dismissInfo = JSON.parse(content);

      expect(dismissInfo.version).toBe("2.0.0");
      expect(dismissInfo.timestamp).toBeGreaterThan(0);
    });

    it("should suppress notifications for dismissed version", async () => {
      // Mock fetch to return newer version
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "99.0.0" }),
      } as Response);

      // Dismiss the update
      dismissUpdate("99.0.0");

      // Should return null even though update is available
      const notification = await getUpdateNotification();
      expect(notification).toBeNull();
    });

    it("should show notification when different version is available", async () => {
      // Dismiss version 2.0.0
      dismissUpdate("2.0.0");

      // Mock fetch to return version 3.0.0
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "3.0.0" }),
      } as Response);

      // Should show notification for different version
      const notification = await getUpdateNotification();
      expect(notification).not.toBeNull();
      expect(notification).toContain("3.0.0");
    });
  });
});
