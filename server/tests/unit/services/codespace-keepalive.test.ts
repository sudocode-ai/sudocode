/**
 * Unit tests for Codespace Keep-Alive Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CodespaceKeepAlive } from "../../../src/services/codespace-keepalive.js";

describe("CodespaceKeepAlive", () => {
  let keepAlive: CodespaceKeepAlive;
  const testPort = 8766; // Use different port to avoid conflicts

  afterEach(async () => {
    if (keepAlive) {
      keepAlive.stop();
    }
  });

  describe("initialization", () => {
    it("should create instance with duration in hours", () => {
      keepAlive = new CodespaceKeepAlive(72, testPort);
      expect(keepAlive).toBeDefined();
    });

    it("should create instance with custom port", () => {
      keepAlive = new CodespaceKeepAlive(72, 9999);
      expect(keepAlive).toBeDefined();
    });

    it("should create instance with default port", () => {
      keepAlive = new CodespaceKeepAlive(72);
      expect(keepAlive).toBeDefined();
    });
  });

  describe("start", () => {
    it("should start HTTP server on specified port", async () => {
      keepAlive = new CodespaceKeepAlive(72, testPort);
      await keepAlive.start();

      // Verify server is listening by making a request
      const response = await fetch(`http://localhost:${testPort}/`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe("alive");
    });

    it("should handle requests on any path", async () => {
      keepAlive = new CodespaceKeepAlive(72, testPort);
      await keepAlive.start();

      const response = await fetch(`http://localhost:${testPort}/health`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe("alive");
    });

    it("should reject if port is already in use", async () => {
      const keepAlive1 = new CodespaceKeepAlive(72, testPort);
      await keepAlive1.start();

      const keepAlive2 = new CodespaceKeepAlive(72, testPort);
      await expect(keepAlive2.start()).rejects.toThrow();

      keepAlive1.stop();
    });
  });

  describe("stop", () => {
    it("should stop HTTP server", async () => {
      keepAlive = new CodespaceKeepAlive(72, testPort);
      await keepAlive.start();

      keepAlive.stop();

      // Wait a bit for server to close
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify server is no longer listening
      await expect(fetch(`http://localhost:${testPort}/`)).rejects.toThrow();
    });

    it("should be safe to call stop multiple times", async () => {
      keepAlive = new CodespaceKeepAlive(72, testPort);
      await keepAlive.start();

      keepAlive.stop();
      keepAlive.stop(); // Should not throw
    });

    it("should be safe to call stop without start", () => {
      keepAlive = new CodespaceKeepAlive(72, testPort);
      expect(() => keepAlive.stop()).not.toThrow();
    });
  });

  describe("keep-alive timer", () => {
    it("should ping server every 60 seconds", async () => {
      vi.useFakeTimers();

      keepAlive = new CodespaceKeepAlive(72, testPort);
      await keepAlive.start();

      // Mock console.log to verify pings
      const consoleSpy = vi.spyOn(console, "log");

      // Fast-forward 61 seconds
      await vi.advanceTimersByTimeAsync(61000);

      // Wait for async fetch to complete
      await vi.runAllTimersAsync();

      // Should have logged a ping
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[KeepAlive] Pinged at")
      );

      vi.useRealTimers();
      consoleSpy.mockRestore();
    });

    it("should stop after duration expires", async () => {
      vi.useFakeTimers();

      // Use very short duration for testing (0.001 hours = 3.6 seconds)
      keepAlive = new CodespaceKeepAlive(0.001, testPort);
      await keepAlive.start();

      const consoleSpy = vi.spyOn(console, "log");

      // Fast-forward past the duration
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runAllTimersAsync();

      // Should have logged stop message
      expect(consoleSpy).toHaveBeenCalledWith("[KeepAlive] Stopped");

      vi.useRealTimers();
      consoleSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("should handle ping failures gracefully", async () => {
      vi.useFakeTimers();

      keepAlive = new CodespaceKeepAlive(72, testPort);
      await keepAlive.start();

      // Stop server to simulate ping failure
      keepAlive.stop();

      // Create a new instance that will try to ping the stopped server
      keepAlive = new CodespaceKeepAlive(72, testPort);
      await keepAlive.start();

      const consoleWarnSpy = vi.spyOn(console, "warn");

      // Fast-forward to trigger ping
      await vi.advanceTimersByTimeAsync(61000);
      await vi.runAllTimersAsync();

      // Should log warning but not crash
      expect(consoleWarnSpy).toHaveBeenCalled();

      vi.useRealTimers();
      consoleWarnSpy.mockRestore();
    });
  });
});
