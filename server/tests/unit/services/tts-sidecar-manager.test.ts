/**
 * Unit tests for TTS Sidecar Manager Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import * as path from "path";
import * as os from "os";
import {
  TTSSidecarManager,
  getTTSSidecarManager,
  resetTTSSidecarManager,
  type SidecarState,
  type SidecarAudioResponse,
  type SidecarDoneResponse,
  type SidecarErrorResponse,
} from "../../../src/services/tts-sidecar-manager.js";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

// Mock node-fetch
vi.mock("node-fetch", () => ({
  default: vi.fn(),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

describe("TTSSidecarManager", () => {
  let manager: TTSSidecarManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTTSSidecarManager();
    manager = new TTSSidecarManager();
  });

  afterEach(async () => {
    await resetTTSSidecarManager();
  });

  describe("initialization", () => {
    it("should initialize with idle state", () => {
      expect(manager.getState()).toBe("idle");
    });

    it("should be an EventEmitter", () => {
      expect(manager).toBeInstanceOf(EventEmitter);
    });
  });

  describe("getTTSDirectory", () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      process.env = { ...originalEnv };
    });

    it("should return correct path on macOS/Linux", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      delete process.env.XDG_CONFIG_HOME;

      const ttsDir = manager.getTTSDirectory();
      expect(ttsDir).toBe(path.join(os.homedir(), ".config", "sudocode", "tts"));
    });

    it("should respect XDG_CONFIG_HOME on Unix", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.XDG_CONFIG_HOME = "/custom/config";

      const ttsDir = manager.getTTSDirectory();
      expect(ttsDir).toBe(path.join("/custom/config", "sudocode", "tts"));
    });

    it("should return correct path on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming";

      const ttsDir = manager.getTTSDirectory();
      expect(ttsDir).toBe(
        path.join("C:\\Users\\Test\\AppData\\Roaming", "sudocode", "tts")
      );
    });
  });

  describe("getVenvPath", () => {
    it("should return venv subdirectory of TTS directory", () => {
      const venvPath = manager.getVenvPath();
      expect(venvPath).toBe(path.join(manager.getTTSDirectory(), "venv"));
    });
  });

  describe("getPythonPath", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should return correct Python path on Unix", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      const pythonPath = manager.getPythonPath();
      expect(pythonPath).toBe(
        path.join(manager.getVenvPath(), "bin", "python")
      );
    });

    it("should return correct Python path on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const pythonPath = manager.getPythonPath();
      expect(pythonPath).toBe(
        path.join(manager.getVenvPath(), "Scripts", "python.exe")
      );
    });
  });

  describe("getModelsPath", () => {
    it("should return models subdirectory of TTS directory", () => {
      const modelsPath = manager.getModelsPath();
      expect(modelsPath).toBe(path.join(manager.getTTSDirectory(), "models"));
    });
  });

  describe("detectOnnxRuntime", () => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      Object.defineProperty(process, "arch", { value: originalArch });
    });

    it("should detect Apple Silicon", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      Object.defineProperty(process, "arch", { value: "arm64" });

      const runtime = manager.detectOnnxRuntime();
      expect(runtime).toBe("onnxruntime-silicon");
    });

    it("should use CPU on macOS x64", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      Object.defineProperty(process, "arch", { value: "x64" });

      const runtime = manager.detectOnnxRuntime();
      expect(runtime).toBe("onnxruntime");
    });

    it("should detect Windows DirectML", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      Object.defineProperty(process, "arch", { value: "x64" });

      const runtime = manager.detectOnnxRuntime();
      expect(runtime).toBe("onnxruntime-directml");
    });

    it("should fallback to CPU on Linux without NVIDIA", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      Object.defineProperty(process, "arch", { value: "x64" });

      // statSync will throw because /proc/driver/nvidia doesn't exist
      const runtime = manager.detectOnnxRuntime();
      expect(runtime).toBe("onnxruntime");
    });
  });

  describe("isInstalled", () => {
    it("should return not installed when venv does not exist", async () => {
      const fs = await import("fs/promises");
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

      const status = await manager.isInstalled();
      expect(status.installed).toBe(false);
      expect(status.error).toBe("TTS environment not installed");
    });

    it("should return not installed when kokoro-onnx is missing", async () => {
      const fs = await import("fs/promises");
      const { execFile } = await import("child_process");

      // All file accesses succeed
      vi.mocked(fs.access).mockResolvedValue(undefined);

      // But kokoro-onnx import fails
      vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
        const callback = typeof opts === "function" ? opts : cb;
        if (callback) {
          callback(new Error("ModuleNotFoundError"), "", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const status = await manager.isInstalled();
      expect(status.installed).toBe(false);
      expect(status.error).toBe("kokoro-onnx package not installed");
    });

    it("should return installed when everything is present", async () => {
      const fs = await import("fs/promises");
      const { execFile } = await import("child_process");

      // All file accesses succeed
      vi.mocked(fs.access).mockResolvedValue(undefined);

      // kokoro-onnx import succeeds
      vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
        const callback = typeof opts === "function" ? opts : cb;
        if (callback) {
          callback(null, "", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const status = await manager.isInstalled();
      expect(status.installed).toBe(true);
      expect(status.venvPath).toBeDefined();
      expect(status.pythonPath).toBeDefined();
    });
  });

  describe("state transitions", () => {
    it("should emit state events", () => {
      const stateHandler = vi.fn();
      manager.on("state", stateHandler);

      // Access private method through any cast for testing
      (manager as any).setState("installing");

      expect(stateHandler).toHaveBeenCalledWith("installing");
      expect(manager.getState()).toBe("installing");
    });

    it("should not emit duplicate state events", () => {
      const stateHandler = vi.fn();
      manager.on("state", stateHandler);

      (manager as any).setState("ready");
      (manager as any).setState("ready"); // Same state again

      expect(stateHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("generate", () => {
    it("should throw if not ready", async () => {
      await expect(
        manager.generate({
          id: "test-1",
          text: "Hello",
        })
      ).rejects.toThrow("Sidecar not ready");
    });
  });

  describe("singleton", () => {
    it("should return the same instance", () => {
      const instance1 = getTTSSidecarManager();
      const instance2 = getTTSSidecarManager();
      expect(instance1).toBe(instance2);
    });

    it("should reset instance correctly", async () => {
      const instance1 = getTTSSidecarManager();
      await resetTTSSidecarManager();
      const instance2 = getTTSSidecarManager();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("event emission", () => {
    it("should emit audio events", () => {
      const audioHandler = vi.fn();
      manager.on("audio", audioHandler);

      const audioResponse: SidecarAudioResponse = {
        id: "req-1",
        type: "audio",
        chunk: "base64data",
        index: 0,
      };

      // Simulate response handling
      (manager as any).handleResponse(audioResponse);

      expect(audioHandler).toHaveBeenCalledWith(audioResponse);
    });

    it("should emit done events", () => {
      const doneHandler = vi.fn();
      manager.on("done", doneHandler);

      const doneResponse: SidecarDoneResponse = {
        id: "req-1",
        type: "done",
        total_chunks: 3,
      };

      (manager as any).handleResponse(doneResponse);

      expect(doneHandler).toHaveBeenCalledWith(doneResponse);
    });

    it("should emit error events", () => {
      const errorHandler = vi.fn();
      manager.on("error", errorHandler);

      const errorResponse: SidecarErrorResponse = {
        id: "req-1",
        type: "error",
        error: "Test error",
        recoverable: true,
      };

      (manager as any).handleResponse(errorResponse);

      expect(errorHandler).toHaveBeenCalledWith(errorResponse);
    });

    it("should emit response events for all types", () => {
      const responseHandler = vi.fn();
      manager.on("response", responseHandler);

      const audioResponse: SidecarAudioResponse = {
        id: "req-1",
        type: "audio",
        chunk: "base64data",
        index: 0,
      };

      (manager as any).handleResponse(audioResponse);

      expect(responseHandler).toHaveBeenCalledWith(audioResponse);
    });
  });

  describe("ready signal handling", () => {
    it("should resolve ready promise on ready response", () => {
      // Set up ready promise
      const readyPromise = new Promise<void>((resolve) => {
        (manager as any).readyResolve = resolve;
      });
      (manager as any).readyPromise = readyPromise;

      // Simulate ready response
      (manager as any).handleResponse({
        id: "init",
        type: "ready",
      });

      expect(manager.getState()).toBe("ready");
    });

    it("should reset restart delay on ready", () => {
      // Set a high restart delay
      (manager as any).restartDelay = 30000;

      // Simulate ready response
      (manager as any).readyResolve = () => {};
      (manager as any).handleResponse({
        id: "init",
        type: "ready",
      });

      expect((manager as any).restartDelay).toBe(1000); // MIN_RESTART_DELAY_MS
    });
  });

  describe("health check failure handling", () => {
    it("should track consecutive health failures", () => {
      // Set state to ready
      (manager as any).state = "ready";
      (manager as any).consecutiveHealthFailures = 0;

      // Simulate health check failures
      (manager as any).checkHealthFailures();
      expect((manager as any).consecutiveHealthFailures).toBe(0);

      (manager as any).consecutiveHealthFailures = 2;
      (manager as any).checkHealthFailures();
      expect((manager as any).consecutiveHealthFailures).toBe(2);
    });

    it("should reset health failures on pong", () => {
      (manager as any).consecutiveHealthFailures = 2;

      (manager as any).handleResponse({
        id: "health",
        type: "pong",
      });

      expect((manager as any).consecutiveHealthFailures).toBe(0);
    });
  });

  describe("stdout line buffer handling", () => {
    it("should handle partial lines correctly", () => {
      const responseHandler = vi.fn();
      manager.on("response", responseHandler);

      // Simulate partial data
      (manager as any).handleStdout(Buffer.from('{"id":"req-1"'));
      expect(responseHandler).not.toHaveBeenCalled();

      // Complete the line
      (manager as any).handleStdout(Buffer.from(',"type":"pong"}\n'));
      expect(responseHandler).toHaveBeenCalledWith({
        id: "req-1",
        type: "pong",
      });
    });

    it("should handle multiple lines in one chunk", () => {
      const responseHandler = vi.fn();
      manager.on("response", responseHandler);

      const data =
        '{"id":"1","type":"pong"}\n{"id":"2","type":"pong"}\n';
      (manager as any).handleStdout(Buffer.from(data));

      expect(responseHandler).toHaveBeenCalledTimes(2);
    });

    it("should skip empty lines", () => {
      const responseHandler = vi.fn();
      manager.on("response", responseHandler);

      (manager as any).handleStdout(Buffer.from('\n\n{"id":"1","type":"pong"}\n\n'));

      expect(responseHandler).toHaveBeenCalledTimes(1);
    });

    it("should handle malformed JSON gracefully", () => {
      const responseHandler = vi.fn();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      manager.on("response", responseHandler);

      (manager as any).handleStdout(Buffer.from('not valid json\n'));

      expect(responseHandler).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("install validation", () => {
    it("should reject install when not in idle or error state", async () => {
      (manager as any).state = "starting";

      await expect(manager.install()).rejects.toThrow(
        "Cannot install while in state: starting"
      );
    });

    it("should reject install when already installing", async () => {
      (manager as any).state = "installing";

      await expect(manager.install()).rejects.toThrow(
        "Cannot install while in state: installing"
      );
    });
  });

  describe("start validation", () => {
    it("should return early if already ready", async () => {
      (manager as any).state = "ready";

      // Should not throw
      await manager.start();
      expect(manager.getState()).toBe("ready");
    });

    it("should reject start when in invalid state", async () => {
      (manager as any).state = "installing";

      await expect(manager.start()).rejects.toThrow(
        "Cannot start while in state: installing"
      );
    });
  });

  describe("shutdown", () => {
    it("should return early if already idle", async () => {
      expect(manager.getState()).toBe("idle");

      await manager.shutdown();
      expect(manager.getState()).toBe("idle");
    });

    it("should transition to shutdown state", async () => {
      // Manually set a state that requires shutdown
      (manager as any).state = "ready";
      (manager as any).process = null;

      const states: SidecarState[] = [];
      manager.on("state", (state) => states.push(state));

      await manager.shutdown();

      expect(states).toContain("shutdown");
      expect(manager.getState()).toBe("idle");
    });
  });
});
