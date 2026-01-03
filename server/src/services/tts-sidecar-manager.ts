/**
 * TTS Sidecar Manager Service
 *
 * Manages the lifecycle of the Python Kokoro TTS sidecar process.
 * Handles installation, startup, health checks, and graceful shutdown.
 *
 * The sidecar communicates via JSON-lines protocol over stdin/stdout:
 * - stdin: {"id": "req-123", "type": "generate", "text": "Hello", "voice": "af_heart", "speed": 1.0}
 * - stdout: {"id": "req-123", "type": "audio", "chunk": "<base64>", "index": 0}
 *
 * Audio format: mono, 24kHz, float32 PCM (base64 encoded)
 */

import { spawn, ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

/**
 * Sidecar state machine states
 */
export type SidecarState =
  | "idle"
  | "installing"
  | "starting"
  | "ready"
  | "error"
  | "shutdown";

/**
 * Request to generate TTS audio
 */
export interface TTSGenerateRequest {
  /** Unique request ID for correlating responses */
  id: string;
  /** Text to synthesize */
  text: string;
  /** Voice identifier (e.g., "af_heart", "af_sarah") */
  voice?: string;
  /** Speech speed multiplier (default: 1.0) */
  speed?: number;
}

/**
 * Base response from sidecar
 */
interface SidecarResponseBase {
  id: string;
  type: string;
}

/**
 * Ready signal from sidecar
 */
export interface SidecarReadyResponse extends SidecarResponseBase {
  type: "ready";
}

/**
 * Audio chunk response
 */
export interface SidecarAudioResponse extends SidecarResponseBase {
  type: "audio";
  /** Base64-encoded PCM audio (mono, 24kHz, float32) */
  chunk: string;
  /** Zero-based chunk index */
  index: number;
}

/**
 * Generation complete response
 */
export interface SidecarDoneResponse extends SidecarResponseBase {
  type: "done";
  /** Total number of chunks sent */
  total_chunks: number;
}

/**
 * Error response
 */
export interface SidecarErrorResponse extends SidecarResponseBase {
  type: "error";
  /** Error message */
  error: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Pong response (health check)
 */
export interface SidecarPongResponse extends SidecarResponseBase {
  type: "pong";
}

/**
 * Union of all sidecar response types
 */
export type SidecarResponse =
  | SidecarReadyResponse
  | SidecarAudioResponse
  | SidecarDoneResponse
  | SidecarErrorResponse
  | SidecarPongResponse;

/**
 * Events emitted by the sidecar manager
 */
export interface TTSSidecarManagerEvents {
  state: (state: SidecarState) => void;
  response: (response: SidecarResponse) => void;
  audio: (response: SidecarAudioResponse) => void;
  done: (response: SidecarDoneResponse) => void;
  error: (response: SidecarErrorResponse) => void;
}

/**
 * Installation status result
 */
export interface InstallationStatus {
  installed: boolean;
  venvPath?: string;
  pythonPath?: string;
  error?: string;
}

/**
 * ONNX runtime variant based on platform
 */
type OnnxRuntime =
  | "onnxruntime"
  | "onnxruntime-silicon"
  | "onnxruntime-gpu"
  | "onnxruntime-directml";

// =============================================================================
// Constants
// =============================================================================

/** Health check interval in milliseconds */
const HEALTH_CHECK_INTERVAL_MS = 30_000;

/** Minimum restart delay */
const MIN_RESTART_DELAY_MS = 1_000;

/** Maximum restart delay */
const MAX_RESTART_DELAY_MS = 30_000;

/** Restart delay multiplier for exponential backoff */
const RESTART_DELAY_MULTIPLIER = 2;

/** Timeout for graceful shutdown before SIGKILL */
const SHUTDOWN_TIMEOUT_MS = 5_000;

/** Timeout for waiting for ready signal */
const READY_TIMEOUT_MS = 30_000;

/** Model file URLs */
const MODEL_URL =
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx";
const VOICES_URL =
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";

// =============================================================================
// TTSSidecarManager
// =============================================================================

/**
 * Manages the Python Kokoro TTS sidecar process lifecycle.
 *
 * Features:
 * - Lazy initialization (only installs/starts when first TTS request arrives)
 * - Platform-specific ONNX runtime detection
 * - Health monitoring with auto-restart on crash
 * - Exponential backoff for restart attempts
 * - Graceful shutdown with timeout
 *
 * @example
 * ```typescript
 * const manager = getTTSSidecarManager();
 *
 * manager.on('audio', (response) => {
 *   console.log('Received audio chunk:', response.index);
 * });
 *
 * await manager.ensureReady();
 * await manager.generate({
 *   id: 'req-1',
 *   text: 'Hello, world!',
 *   voice: 'af_heart',
 * });
 * ```
 */
export class TTSSidecarManager extends EventEmitter {
  private state: SidecarState = "idle";
  private process: ChildProcess | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private restartDelay: number = MIN_RESTART_DELAY_MS;
  private restartTimer: NodeJS.Timeout | null = null;
  private lineBuffer: string = "";
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private shuttingDown: boolean = false;
  private consecutiveHealthFailures: number = 0;
  private readonly maxHealthFailures: number = 3;

  constructor() {
    super();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get the current state of the sidecar manager.
   */
  getState(): SidecarState {
    return this.state;
  }

  /**
   * Get the cross-platform TTS directory path.
   *
   * - Windows: %APPDATA%/sudocode/tts
   * - macOS/Linux: ~/.config/sudocode/tts
   */
  getTTSDirectory(): string {
    if (process.platform === "win32") {
      const appData =
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      return path.join(appData, "sudocode", "tts");
    }

    const configHome =
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(configHome, "sudocode", "tts");
  }

  /**
   * Get the path to the Python virtual environment.
   */
  getVenvPath(): string {
    return path.join(this.getTTSDirectory(), "venv");
  }

  /**
   * Get the path to the Python executable in the venv.
   */
  getPythonPath(): string {
    const venvPath = this.getVenvPath();
    if (process.platform === "win32") {
      return path.join(venvPath, "Scripts", "python.exe");
    }
    return path.join(venvPath, "bin", "python");
  }

  /**
   * Get the path to the models directory.
   */
  getModelsPath(): string {
    return path.join(this.getTTSDirectory(), "models");
  }

  /**
   * Get the path to the sidecar Python script.
   */
  getSidecarScriptPath(): string {
    // The sidecar script is located relative to this module
    const thisDir = path.dirname(new URL(import.meta.url).pathname);
    return path.join(thisDir, "..", "tts", "sidecar.py");
  }

  /**
   * Check if the TTS environment is installed.
   */
  async isInstalled(): Promise<InstallationStatus> {
    const venvPath = this.getVenvPath();
    const pythonPath = this.getPythonPath();
    const modelsPath = this.getModelsPath();

    try {
      // Check venv exists
      await fs.access(venvPath);
      await fs.access(pythonPath);

      // Check model files exist
      const modelPath = path.join(modelsPath, "kokoro-v1.0.onnx");
      const voicesPath = path.join(modelsPath, "voices-v1.0.bin");
      await fs.access(modelPath);
      await fs.access(voicesPath);

      // Try to verify kokoro-onnx is installed
      try {
        await execFileAsync(pythonPath, ["-c", "import kokoro_onnx"], {
          timeout: 10_000,
        });
      } catch {
        return {
          installed: false,
          venvPath,
          pythonPath,
          error: "kokoro-onnx package not installed",
        };
      }

      return {
        installed: true,
        venvPath,
        pythonPath,
      };
    } catch {
      return {
        installed: false,
        error: "TTS environment not installed",
      };
    }
  }

  /**
   * Detect the appropriate ONNX runtime for the current platform.
   *
   * Note: This is a synchronous method that does a quick filesystem check
   * for NVIDIA drivers on Linux. For most platforms, no I/O is performed.
   */
  detectOnnxRuntime(): OnnxRuntime {
    const platform = process.platform;
    const arch = process.arch;

    // Apple Silicon
    if (platform === "darwin" && arch === "arm64") {
      return "onnxruntime-silicon";
    }

    // NVIDIA GPU on Linux
    if (platform === "linux") {
      try {
        // Check for NVIDIA driver - use sync fs for simplicity
        // since this is a one-time check during install
        const fsSync = require("node:fs");
        const nvidiaProcPath = "/proc/driver/nvidia";
        const stats = fsSync.statSync(nvidiaProcPath);
        if (stats.isDirectory()) {
          return "onnxruntime-gpu";
        }
      } catch {
        // Not an NVIDIA system
      }
    }

    // Windows with DirectML
    if (platform === "win32") {
      return "onnxruntime-directml";
    }

    // Fallback to CPU
    return "onnxruntime";
  }

  /**
   * Install the TTS environment (venv, kokoro-onnx, appropriate ONNX runtime, model files).
   *
   * @throws Error if installation fails
   */
  async install(): Promise<void> {
    if (this.state !== "idle" && this.state !== "error") {
      throw new Error(
        `Cannot install while in state: ${this.state}`
      );
    }

    this.setState("installing");

    const ttsDir = this.getTTSDirectory();
    const venvPath = this.getVenvPath();
    const modelsPath = this.getModelsPath();
    const pythonPath = this.getPythonPath();
    const onnxRuntime = this.detectOnnxRuntime();

    try {
      // Create directories
      await fs.mkdir(ttsDir, { recursive: true });
      await fs.mkdir(modelsPath, { recursive: true });

      // Find system Python
      const systemPython = await this.findSystemPython();

      // Create virtual environment
      console.log("[tts-sidecar] Creating Python virtual environment...");
      await execFileAsync(systemPython, ["-m", "venv", venvPath], {
        timeout: 60_000,
      });

      // Upgrade pip
      console.log("[tts-sidecar] Upgrading pip...");
      await execFileAsync(
        pythonPath,
        ["-m", "pip", "install", "--upgrade", "pip"],
        { timeout: 120_000 }
      );

      // Install kokoro-onnx and appropriate ONNX runtime
      console.log(
        `[tts-sidecar] Installing kokoro-onnx and ${onnxRuntime}...`
      );
      await execFileAsync(
        pythonPath,
        ["-m", "pip", "install", "kokoro-onnx", onnxRuntime],
        { timeout: 300_000 }
      );

      // Download model files
      console.log("[tts-sidecar] Downloading model files...");
      await this.downloadFile(
        MODEL_URL,
        path.join(modelsPath, "kokoro-v1.0.onnx")
      );
      await this.downloadFile(
        VOICES_URL,
        path.join(modelsPath, "voices-v1.0.bin")
      );

      console.log("[tts-sidecar] Installation complete");
      this.setState("idle");
    } catch (error) {
      console.error("[tts-sidecar] Installation failed:", error);
      this.setState("error");
      throw error;
    }
  }

  /**
   * Start the sidecar process.
   *
   * @throws Error if start fails or ready signal not received
   */
  async start(): Promise<void> {
    if (this.state === "ready") {
      return; // Already running
    }

    if (this.state === "starting") {
      // Wait for existing start to complete
      if (this.readyPromise) {
        await this.readyPromise;
        return;
      }
    }

    if (this.state !== "idle" && this.state !== "error") {
      throw new Error(`Cannot start while in state: ${this.state}`);
    }

    this.setState("starting");
    this.shuttingDown = false;

    const pythonPath = this.getPythonPath();
    const sidecarPath = this.getSidecarScriptPath();
    const modelsPath = this.getModelsPath();

    // Create promise for ready signal
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    try {
      // Spawn the sidecar process
      this.process = spawn(pythonPath, [sidecarPath], {
        env: {
          ...process.env,
          KOKORO_MODELS_DIR: modelsPath,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Handle stdout (JSON-lines responses)
      this.process.stdout?.on("data", (data: Buffer) => {
        this.handleStdout(data);
      });

      // Handle stderr (logs)
      this.process.stderr?.on("data", (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          console.log(`[kokoro-sidecar] ${message}`);
        }
      });

      // Handle process exit
      this.process.on("exit", (code, signal) => {
        this.handleProcessExit(code, signal);
      });

      // Handle process error
      this.process.on("error", (error) => {
        console.error("[tts-sidecar] Process error:", error);
        this.handleProcessExit(1, null);
      });

      // Wait for ready signal with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Timeout waiting for sidecar ready signal"));
        }, READY_TIMEOUT_MS);
      });

      await Promise.race([this.readyPromise, timeoutPromise]);

      // Start health checks
      this.startHealthChecks();
    } catch (error) {
      console.error("[tts-sidecar] Start failed:", error);
      this.cleanup();
      this.setState("error");
      throw error;
    }
  }

  /**
   * Ensure the sidecar is ready for TTS generation.
   * Installs if necessary, then starts the sidecar.
   */
  async ensureReady(): Promise<void> {
    if (this.state === "ready") {
      return;
    }

    const status = await this.isInstalled();
    if (!status.installed) {
      await this.install();
    }

    await this.start();
  }

  /**
   * Generate TTS audio from text.
   *
   * @param request - The TTS generation request
   * @throws Error if sidecar is not ready
   */
  async generate(request: TTSGenerateRequest): Promise<void> {
    if (this.state !== "ready") {
      throw new Error(`Sidecar not ready, current state: ${this.state}`);
    }

    if (!this.process?.stdin?.writable) {
      throw new Error("Sidecar stdin not writable");
    }

    const message = JSON.stringify({
      id: request.id,
      type: "generate",
      text: request.text,
      voice: request.voice || "af_heart",
      speed: request.speed || 1.0,
    });

    this.process.stdin.write(message + "\n");
  }

  /**
   * Gracefully shutdown the sidecar process.
   *
   * Sends shutdown command, waits for graceful exit.
   * If timeout expires, sends SIGKILL.
   */
  async shutdown(): Promise<void> {
    if (this.state === "idle" || this.state === "shutdown") {
      return;
    }

    this.setState("shutdown");
    this.shuttingDown = true;

    // Stop health checks
    this.stopHealthChecks();

    // Clear restart timer
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (!this.process) {
      this.setState("idle");
      return;
    }

    // Try graceful shutdown
    if (this.process.stdin?.writable) {
      const shutdownMessage = JSON.stringify({ type: "shutdown" });
      this.process.stdin.write(shutdownMessage + "\n");
    }

    // Wait for graceful exit with timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running
        if (this.process) {
          console.log("[tts-sidecar] Forcing shutdown with SIGKILL");
          this.process.kill("SIGKILL");
        }
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);

      if (this.process) {
        this.process.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    this.cleanup();
    this.setState("idle");
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Set the current state and emit state event.
   */
  private setState(newState: SidecarState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit("state", newState);
    }
  }

  /**
   * Find the system Python interpreter.
   */
  private async findSystemPython(): Promise<string> {
    const candidates =
      process.platform === "win32"
        ? ["python", "python3", "py"]
        : ["python3", "python"];

    for (const candidate of candidates) {
      try {
        const { stdout } = await execFileAsync(candidate, ["--version"], {
          timeout: 5_000,
        });
        // Ensure it's Python 3.8+
        const versionMatch = stdout.match(/Python (\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1], 10);
          const minor = parseInt(versionMatch[2], 10);
          if (major >= 3 && minor >= 8) {
            return candidate;
          }
        }
      } catch {
        // Try next candidate
      }
    }

    throw new Error(
      "Python 3.8+ not found. Please install Python from https://python.org"
    );
  }

  /**
   * Download a file from URL to disk.
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    // Use native fetch (Node 18+)
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(arrayBuffer));
  }

  /**
   * Handle stdout data from the sidecar process.
   * Parses JSON-lines and emits appropriate events.
   */
  private handleStdout(data: Buffer): void {
    this.lineBuffer += data.toString();

    // Process complete lines
    let newlineIndex: number;
    while ((newlineIndex = this.lineBuffer.indexOf("\n")) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const response = JSON.parse(line) as SidecarResponse;
        this.handleResponse(response);
      } catch (error) {
        console.error("[tts-sidecar] Failed to parse response:", line, error);
      }
    }
  }

  /**
   * Handle a parsed response from the sidecar.
   */
  private handleResponse(response: SidecarResponse): void {
    // Emit generic response event
    this.emit("response", response);

    switch (response.type) {
      case "ready":
        this.setState("ready");
        this.restartDelay = MIN_RESTART_DELAY_MS;
        this.consecutiveHealthFailures = 0;
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
          this.readyReject = null;
          this.readyPromise = null;
        }
        break;

      case "audio":
        this.emit("audio", response);
        break;

      case "done":
        this.emit("done", response);
        break;

      case "error":
        this.emit("error", response);
        break;

      case "pong":
        // Health check response - reset failure counter
        this.consecutiveHealthFailures = 0;
        break;
    }
  }

  /**
   * Handle sidecar process exit.
   */
  private handleProcessExit(
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    console.log(
      `[tts-sidecar] Process exited with code ${code}, signal ${signal}`
    );

    // Reject any pending ready promise
    if (this.readyReject) {
      this.readyReject(
        new Error(`Sidecar exited unexpectedly: code=${code}, signal=${signal}`)
      );
      this.readyResolve = null;
      this.readyReject = null;
      this.readyPromise = null;
    }

    this.cleanup();

    // Auto-restart if not shutting down
    if (!this.shuttingDown && this.state !== "shutdown") {
      this.setState("error");
      this.scheduleRestart();
    }
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    this.stopHealthChecks();
    this.process = null;
    this.lineBuffer = "";
  }

  /**
   * Schedule a restart with exponential backoff.
   */
  private scheduleRestart(): void {
    if (this.restartTimer) {
      return; // Already scheduled
    }

    console.log(
      `[tts-sidecar] Scheduling restart in ${this.restartDelay}ms`
    );

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;

      try {
        await this.start();
      } catch (error) {
        console.error("[tts-sidecar] Restart failed:", error);
        // Increase delay for next attempt (exponential backoff)
        this.restartDelay = Math.min(
          this.restartDelay * RESTART_DELAY_MULTIPLIER,
          MAX_RESTART_DELAY_MS
        );
      }
    }, this.restartDelay);
  }

  /**
   * Start the health check timer.
   */
  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop the health check timer.
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Perform a health check by sending a ping.
   */
  private performHealthCheck(): void {
    if (this.state !== "ready") {
      return;
    }

    if (!this.process?.stdin?.writable) {
      console.warn("[tts-sidecar] Health check failed: stdin not writable");
      this.consecutiveHealthFailures++;
      this.checkHealthFailures();
      return;
    }

    try {
      const pingMessage = JSON.stringify({
        id: "health",
        type: "ping",
      });
      this.process.stdin.write(pingMessage + "\n");
    } catch (error) {
      console.warn("[tts-sidecar] Health check failed:", error);
      this.consecutiveHealthFailures++;
      this.checkHealthFailures();
    }
  }

  /**
   * Check if consecutive health failures exceed threshold.
   */
  private checkHealthFailures(): void {
    if (this.consecutiveHealthFailures >= this.maxHealthFailures) {
      console.error(
        `[tts-sidecar] Too many consecutive health failures (${this.consecutiveHealthFailures}), restarting`
      );

      // Force process termination
      if (this.process) {
        this.process.kill("SIGKILL");
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Global TTS sidecar manager instance (singleton).
 * Lazy-initialized on first use.
 */
let sidecarManagerInstance: TTSSidecarManager | null = null;

/**
 * Get or create the global TTS sidecar manager instance.
 *
 * @returns The TTS sidecar manager instance
 */
export function getTTSSidecarManager(): TTSSidecarManager {
  if (!sidecarManagerInstance) {
    sidecarManagerInstance = new TTSSidecarManager();
  }
  return sidecarManagerInstance;
}

/**
 * Reset the global TTS sidecar manager instance (for testing).
 * Shuts down any running sidecar before resetting.
 */
export async function resetTTSSidecarManager(): Promise<void> {
  if (sidecarManagerInstance) {
    await sidecarManagerInstance.shutdown();
    sidecarManagerInstance = null;
  }
}
