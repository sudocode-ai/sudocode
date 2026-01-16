/**
 * Tests for MacroAgentServerManager
 *
 * Tests the lifecycle management of the macro-agent server process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";

// Mock child_process before importing the module
vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

// Mock observability service
const mockObservabilityService = {
  connect: vi.fn(),
  close: vi.fn(),
  isConnected: vi.fn(),
};

vi.mock("../../../src/services/macro-agent-observability.js", () => ({
  MacroAgentObservabilityService: vi.fn(() => mockObservabilityService),
}));

// Mock get-port - return the requested port as available
vi.mock("get-port", () => ({
  default: vi.fn((options?: { port?: number }) => Promise.resolve(options?.port ?? 3100)),
}));

// Import after mocking
import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import {
  MacroAgentServerManager,
  getMacroAgentServerManager,
  resetMacroAgentServerManager,
} from "../../../src/services/macro-agent-server-manager.js";

describe("MacroAgentServerManager", () => {
  let mockProcess: MockChildProcess;

  // Helper to create mock child process
  class MockChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    pid = 12345;
    killed = false;

    kill(signal?: string) {
      this.killed = true;
      // Emit exit after a short delay to simulate process termination
      setTimeout(() => this.emit("exit", 0, signal), 10);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetMacroAgentServerManager();
    mockProcess = new MockChildProcess();

    // Default mocks
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("Command not found");
    });
    vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

    // Mock fetch for health checks
    global.fetch = vi.fn();

    // Reset observability mocks
    mockObservabilityService.connect.mockReset();
    mockObservabilityService.close.mockReset();
    mockObservabilityService.isConnected.mockReset();
    mockObservabilityService.connect.mockResolvedValue(undefined);
    mockObservabilityService.close.mockResolvedValue(undefined);
    mockObservabilityService.isConnected.mockReturnValue(false);
  });

  afterEach(async () => {
    // Clean up any running managers
    resetMacroAgentServerManager();
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================
  describe("constructor", () => {
    it("should create manager with default config", () => {
      const manager = new MacroAgentServerManager();

      expect(manager.getState()).toBe("stopped");
      expect(manager.isReady()).toBe(false);
    });

    it("should create manager with custom config", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: {
          enabled: true,
          port: 4000,
          host: "0.0.0.0",
        },
      });

      // URLs are null until server starts
      expect(manager.getAcpUrl()).toBeNull();
      expect(manager.getApiUrl()).toBeNull();

      // Start server to verify config is used
      await manager.start();
      expect(manager.getAcpUrl()).toBe("ws://0.0.0.0:4000/acp");
      expect(manager.getApiUrl()).toBe("http://0.0.0.0:4000");
    });
  });

  // ===========================================================================
  // Executable Discovery Tests
  // ===========================================================================
  describe("findExecutablePath", () => {
    it("should find executable in local node_modules", () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes("node_modules/.bin/multiagent-acp");
      });

      const manager = new MacroAgentServerManager();
      const path = manager.findExecutablePath();

      expect(path).toContain("node_modules/.bin/multiagent-acp");
    });

    it("should fall back to PATH when not in node_modules", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue("/usr/local/bin/multiagent-acp\n");

      const manager = new MacroAgentServerManager();
      const path = manager.findExecutablePath();

      expect(path).toBe("/usr/local/bin/multiagent-acp");
    });

    it("should return null when executable not found anywhere", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const manager = new MacroAgentServerManager();
      const path = manager.findExecutablePath();

      expect(path).toBeNull();
    });

    it("should cache the executable path", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const manager = new MacroAgentServerManager();

      // First call
      manager.findExecutablePath();
      // Second call should use cache
      manager.findExecutablePath();

      // existsSync should only be called once per path during first lookup
      expect(existsSync).toHaveBeenCalled();
    });
  });

  describe("isExecutableAvailable", () => {
    it("should return true when executable is found", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const manager = new MacroAgentServerManager();

      expect(manager.isExecutableAvailable()).toBe(true);
    });

    it("should return false when executable is not found", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const manager = new MacroAgentServerManager();

      expect(manager.isExecutableAvailable()).toBe(false);
    });
  });

  // ===========================================================================
  // Start Tests
  // ===========================================================================
  describe("start", () => {
    it("should set state to unavailable when executable not found", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.getState()).toBe("unavailable");
      expect(manager.isReady()).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    it("should spawn process with correct arguments", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: {
          enabled: true,
          port: 3100,
          host: "localhost",
        },
      });

      // Start async but don't await yet
      const startPromise = manager.start();

      // Simulate health check success
      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      await startPromise;

      expect(spawn).toHaveBeenCalledWith(
        expect.stringContaining("multiagent-acp"),
        expect.arrayContaining([
          "--api",
          "--port",
          "3100",
          "--host",
          "localhost",
        ]),
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        })
      );
    });

    it("should add --cwd argument when cwd is provided", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
        cwd: "/test/workdir",
      });

      const startPromise = manager.start();
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await startPromise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["--cwd", "/test/workdir"]),
        expect.any(Object)
      );
    });

    it("should add --sessions-path argument when sessionsPath is provided", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
        sessionsPath: "/custom/sessions",
      });

      const startPromise = manager.start();
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await startPromise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["--sessions-path", "/custom/sessions"]),
        expect.any(Object)
      );
    });

    it("should not start if already running", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager();

      await manager.start();
      await manager.start(); // Second call should be no-op

      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it("should transition to running state after successful health check", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.getState()).toBe("running");
      expect(manager.isReady()).toBe(true);
    });

    it("should throw error when health check times out", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      // Health check always fails
      vi.mocked(global.fetch).mockRejectedValue(new Error("Connection refused"));

      const manager = new MacroAgentServerManager();
      // Override health check timeout for faster test
      (manager as any).healthCheckTimeout = 100;

      await expect(manager.start()).rejects.toThrow("Server failed to become ready");
      expect(manager.getState()).toBe("stopped");
    });
  });

  // ===========================================================================
  // Stop Tests
  // ===========================================================================
  describe("stop", () => {
    it("should do nothing if already stopped", async () => {
      const manager = new MacroAgentServerManager();
      await manager.stop();

      expect(manager.getState()).toBe("stopped");
    });

    it("should do nothing if unavailable", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const manager = new MacroAgentServerManager();
      await manager.start(); // Sets state to unavailable
      await manager.stop();

      expect(manager.getState()).toBe("unavailable");
    });

    it("should send SIGTERM and wait for process exit", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.isReady()).toBe(true);

      await manager.stop();

      expect(mockProcess.killed).toBe(true);
      expect(manager.getState()).toBe("stopped");
      expect(manager.isReady()).toBe(false);
    });
  });

  // ===========================================================================
  // URL Accessor Tests
  // ===========================================================================
  describe("getAcpUrl", () => {
    it("should return null when server not started", () => {
      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
      });

      expect(manager.getAcpUrl()).toBeNull();
    });

    it("should return correct WebSocket URL after server starts", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
      });
      await manager.start();

      expect(manager.getAcpUrl()).toBe("ws://localhost:3100/acp");
    });

    it("should use custom host and port after server starts", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 4000, host: "0.0.0.0" },
      });
      await manager.start();

      expect(manager.getAcpUrl()).toBe("ws://0.0.0.0:4000/acp");
    });
  });

  describe("getApiUrl", () => {
    it("should return null when server not started", () => {
      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
      });

      expect(manager.getApiUrl()).toBeNull();
    });

    it("should return correct HTTP URL after server starts", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
      });
      await manager.start();

      expect(manager.getApiUrl()).toBe("http://localhost:3100");
    });
  });

  describe("getActualPort", () => {
    it("should return null when server not started", () => {
      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
      });

      expect(manager.getActualPort()).toBeNull();
    });

    it("should return actual port after server starts", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager({
        serverConfig: { enabled: true, port: 3100, host: "localhost" },
      });
      await manager.start();

      expect(manager.getActualPort()).toBe(3100);
    });
  });

  // ===========================================================================
  // State Tests
  // ===========================================================================
  describe("state management", () => {
    it("should report correct availability", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.isAvailable()).toBe(false);
      expect(manager.getState()).toBe("unavailable");
    });

    it("should report running when started successfully", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.isAvailable()).toBe(true);
      expect(manager.isReady()).toBe(true);
      expect(manager.getState()).toBe("running");
    });
  });

  // ===========================================================================
  // Process Event Handling Tests
  // ===========================================================================
  describe("process event handling", () => {
    it("should log stdout from process", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const manager = new MacroAgentServerManager();
      await manager.start();

      // Simulate stdout output
      mockProcess.stdout.emit("data", Buffer.from("Test output message\n"));

      // Check that one of the log calls contains [macro-agent] prefix
      const macroAgentCalls = consoleSpy.mock.calls.filter(
        (call) => String(call[0]).includes("[macro-agent]")
      );
      expect(macroAgentCalls.length).toBeGreaterThan(0);
      expect(macroAgentCalls.some((call) => String(call[0]).includes("Test output message"))).toBe(
        true
      );

      consoleSpy.mockRestore();
    });

    it("should log stderr from process", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const manager = new MacroAgentServerManager();
      await manager.start();

      // Simulate stderr output
      mockProcess.stderr.emit("data", Buffer.from("Error message\n"));

      // Check that one of the error calls contains [macro-agent] prefix
      const macroAgentCalls = consoleSpy.mock.calls.filter(
        (call) => String(call[0]).includes("[macro-agent]")
      );
      expect(macroAgentCalls.length).toBeGreaterThan(0);
      expect(macroAgentCalls.some((call) => String(call[0]).includes("Error message"))).toBe(true);

      consoleSpy.mockRestore();
    });

    it("should handle process errors", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const manager = new MacroAgentServerManager();
      await manager.start();

      // Simulate process error
      mockProcess.emit("error", new Error("Process error"));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[MacroAgentServerManager] Process error"),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Auto-Restart Tests
  // ===========================================================================
  describe("auto-restart", () => {
    it("should schedule restart when process exits unexpectedly", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.isReady()).toBe(true);

      // Simulate unexpected exit (not during stop)
      mockProcess.emit("exit", 1, null);

      // State should change to stopped
      expect(manager.getState()).toBe("stopped");

      // Should log restart scheduling
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Scheduling restart")
      );

      consoleSpy.mockRestore();
    });

    it("should not restart when intentionally stopping", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const manager = new MacroAgentServerManager();
      await manager.start();

      // Stop intentionally
      await manager.stop();

      // Should not schedule restart
      const restartCalls = consoleSpy.mock.calls.filter(
        (call) => String(call[0]).includes("Scheduling restart")
      );
      expect(restartCalls.length).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================
  describe("singleton pattern", () => {
    it("should return same instance from getMacroAgentServerManager", () => {
      const instance1 = getMacroAgentServerManager();
      const instance2 = getMacroAgentServerManager();

      expect(instance1).toBe(instance2);
    });

    it("should use config only on first call", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const instance1 = getMacroAgentServerManager({
        serverConfig: { enabled: true, port: 4000, host: "custom" },
      });
      const instance2 = getMacroAgentServerManager({
        serverConfig: { enabled: true, port: 5000, host: "other" },
      });

      // Start server to verify config was used
      await instance1.start();

      // Both should use the first config (port 4000, host "custom")
      expect(instance1.getAcpUrl()).toBe("ws://custom:4000/acp");
      expect(instance2.getAcpUrl()).toBe("ws://custom:4000/acp");
    });

    it("should reset singleton with resetMacroAgentServerManager", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const instance1 = getMacroAgentServerManager({
        serverConfig: { enabled: true, port: 4000, host: "first" },
      });

      resetMacroAgentServerManager();

      const instance2 = getMacroAgentServerManager({
        serverConfig: { enabled: true, port: 5000, host: "second" },
      });

      expect(instance1).not.toBe(instance2);

      // Start second instance to verify its config was used
      await instance2.start();
      expect(instance2.getAcpUrl()).toBe("ws://second:5000/acp");
    });
  });

  // ===========================================================================
  // Observability Integration Tests
  // ===========================================================================
  describe("observability integration", () => {
    it("should start observability after server is ready", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(mockObservabilityService.connect).toHaveBeenCalledTimes(1);
    });

    it("should not fail server startup if observability fails", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      mockObservabilityService.connect.mockRejectedValue(
        new Error("Observability connection failed")
      );

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const manager = new MacroAgentServerManager();

      // Should NOT throw
      await expect(manager.start()).resolves.toBeUndefined();

      // Server should still be running
      expect(manager.getState()).toBe("running");
      expect(manager.isReady()).toBe(true);

      // Should log warning about observability failure
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Observability service failed to connect"),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should close observability before stopping server", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager();
      await manager.start();
      await manager.stop();

      expect(mockObservabilityService.close).toHaveBeenCalledTimes(1);
    });

    it("should return observability service via getter", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const manager = new MacroAgentServerManager();
      await manager.start();

      const service = manager.getObservabilityService();
      expect(service).toBe(mockObservabilityService);
    });

    it("should return null observability service when not started", () => {
      const manager = new MacroAgentServerManager();
      expect(manager.getObservabilityService()).toBeNull();
    });

    it("should report observability connected status", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      mockObservabilityService.isConnected.mockReturnValue(true);

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.isObservabilityConnected()).toBe(true);
    });

    it("should report observability not connected when service is null", () => {
      const manager = new MacroAgentServerManager();
      expect(manager.isObservabilityConnected()).toBe(false);
    });

    it("should handle observability close error gracefully", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
      mockObservabilityService.close.mockRejectedValue(
        new Error("Close failed")
      );

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const manager = new MacroAgentServerManager();
      await manager.start();

      // Should NOT throw
      await expect(manager.stop()).resolves.toBeUndefined();

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error closing observability service"),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should not start observability when executable unavailable", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const manager = new MacroAgentServerManager();
      await manager.start();

      expect(manager.getState()).toBe("unavailable");
      expect(mockObservabilityService.connect).not.toHaveBeenCalled();
    });
  });
});
