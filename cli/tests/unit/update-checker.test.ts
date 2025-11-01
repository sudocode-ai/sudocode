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
} from "../../src/update-checker.js";

const CACHE_DIR = path.join(os.tmpdir(), "sudocode-cli");
const CACHE_FILE = path.join(CACHE_DIR, "update-cache.json");

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
        fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf-8")
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
        fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf-8")
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
});
