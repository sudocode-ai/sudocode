/**
 * Macro-Agent Server Manager
 *
 * Manages the lifecycle of the macro-agent server process.
 * Unlike other agents (subprocess per execution), macro-agent is a shared server
 * that multiple executions connect to via WebSocket ACP.
 *
 * Features:
 * - Spawns macro-agent server on startup
 * - Health check polling during startup
 * - Auto-restart with exponential backoff on crash
 * - Graceful degradation if executable not found
 *
 * @module services/macro-agent-server-manager
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { MacroAgentServerConfig } from "@sudocode-ai/types";
import {
  MACRO_AGENT_DEFAULTS,
  getMacroAgentAcpUrl,
  getMacroAgentApiUrl,
} from "../utils/macro-agent-config.js";
import {
  MacroAgentObservabilityService,
  type MacroAgentObservabilityConfig,
} from "./macro-agent-observability.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Macro-agent server manager configuration
 */
export interface MacroAgentServerManagerConfig {
  /** Server configuration */
  serverConfig: Required<MacroAgentServerConfig>;
  /** Working directory for the server */
  cwd?: string;
  /** Path to sessions storage */
  sessionsPath?: string;
}

/**
 * Server state
 */
type ServerState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "unavailable";

/**
 * Manages the macro-agent server process lifecycle.
 *
 * The macro-agent runs as a managed server process, not a subprocess per execution.
 * Sudocode connects as a WebSocket ACP client.
 */
export class MacroAgentServerManager {
  private process: ChildProcess | null = null;
  private state: ServerState = "stopped";
  private restartCount: number = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private uptimeTimer: NodeJS.Timeout | null = null;
  private executablePath: string | null = null;
  private observabilityService: MacroAgentObservabilityService | null = null;

  private readonly config: MacroAgentServerManagerConfig;
  private readonly maxRestarts = 3;
  private readonly healthCheckInterval = 500; // ms
  private readonly healthCheckTimeout = 30000; // ms
  private readonly uptimeThreshold = 60000; // ms - reset restart count after this

  constructor(config: Partial<MacroAgentServerManagerConfig> = {}) {
    this.config = {
      serverConfig: config.serverConfig ?? { ...MACRO_AGENT_DEFAULTS },
      cwd: config.cwd,
      sessionsPath: config.sessionsPath,
    };
  }

  /**
   * Find the multiagent-acp executable path.
   * Prefers locally installed binary from node_modules, falls back to PATH.
   *
   * @returns The path to the executable, or null if not found
   */
  findExecutablePath(): string | null {
    if (this.executablePath !== null) {
      return this.executablePath;
    }

    // Check for locally installed binary in node_modules
    // Look in various possible locations relative to this file
    const possibleLocalPaths = [
      // Workspace root node_modules (monorepo structure)
      resolve(__dirname, "../../../../node_modules/.bin/multiagent-acp"),
      // Server package node_modules
      resolve(__dirname, "../../node_modules/.bin/multiagent-acp"),
      // Direct sibling in node_modules
      resolve(__dirname, "../../../node_modules/.bin/multiagent-acp"),
    ];

    for (const localPath of possibleLocalPaths) {
      if (existsSync(localPath)) {
        console.log(
          `[MacroAgentServerManager] Found local multiagent-acp at: ${localPath}`
        );
        this.executablePath = localPath;
        return localPath;
      }
    }

    // Fall back to checking PATH
    try {
      const whichResult = execSync("which multiagent-acp", {
        encoding: "utf-8",
      }).trim();
      if (whichResult) {
        console.log(
          `[MacroAgentServerManager] Found multiagent-acp in PATH: ${whichResult}`
        );
        this.executablePath = whichResult;
        return whichResult;
      }
    } catch {
      // Not found in PATH
    }

    console.warn(
      "[MacroAgentServerManager] multiagent-acp executable not found in " +
        "local node_modules or PATH"
    );
    this.executablePath = ""; // Cache negative result as empty string
    return null;
  }

  /**
   * Check if multiagent-acp executable is available
   */
  isExecutableAvailable(): boolean {
    return this.findExecutablePath() !== null;
  }

  /**
   * Start the macro-agent server process.
   * Called on sudocode server startup.
   *
   * @throws Error if server fails to start (but not if executable missing)
   */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      console.log("[MacroAgentServerManager] Server already running or starting");
      return;
    }

    // Find executable path
    const execPath = this.findExecutablePath();
    if (!execPath) {
      console.warn(
        "[MacroAgentServerManager] multiagent-acp executable not found. " +
          "Macro-agent will be unavailable. Install macro-agent package to enable."
      );
      this.state = "unavailable";
      return;
    }

    this.state = "starting";

    const { serverConfig, cwd, sessionsPath } = this.config;

    // Build command arguments
    const args = [
      "--ws",
      "--ws-port",
      String(serverConfig.port),
      "--ws-host",
      serverConfig.host,
      "--api",
      "--port",
      String(serverConfig.port),
      "--host",
      serverConfig.host,
    ];

    if (cwd) {
      args.push("--cwd", cwd);
    }

    if (sessionsPath) {
      args.push("--sessions-path", sessionsPath);
    }

    console.log(
      `[MacroAgentServerManager] Starting macro-agent server on ${serverConfig.host}:${serverConfig.port}`
    );
    console.log(`[MacroAgentServerManager] Using executable: ${execPath}`);

    try {
      this.process = spawn(execPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      // Handle process events
      this.setupProcessHandlers();

      // Wait for server to be ready
      await this.waitForReady();

      this.state = "running";
      console.log("[MacroAgentServerManager] Server is ready");

      // Start observability service connection
      await this.startObservability();

      // Start uptime timer to reset restart count
      this.startUptimeTimer();
    } catch (error) {
      this.state = "stopped";
      console.error("[MacroAgentServerManager] Failed to start server:", error);
      throw error;
    }
  }

  /**
   * Stop the macro-agent server process.
   * Called on sudocode server shutdown.
   */
  async stop(): Promise<void> {
    if (this.state === "stopped" || this.state === "unavailable") {
      return;
    }

    this.state = "stopping";
    console.log("[MacroAgentServerManager] Stopping macro-agent server");

    // Close observability connection first
    await this.stopObservability();

    // Clear timers
    this.clearTimers();

    if (this.process) {
      // Send SIGTERM for graceful shutdown
      this.process.kill("SIGTERM");

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if not exited after 5 seconds
          if (this.process) {
            console.warn(
              "[MacroAgentServerManager] Force killing server after timeout"
            );
            this.process.kill("SIGKILL");
          }
          resolve();
        }, 5000);

        this.process!.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
    }

    this.state = "stopped";
    console.log("[MacroAgentServerManager] Server stopped");
  }

  /**
   * Get the WebSocket ACP URL for client connections
   */
  getAcpUrl(): string {
    return getMacroAgentAcpUrl(this.config.serverConfig);
  }

  /**
   * Get the HTTP API base URL for observability
   */
  getApiUrl(): string {
    return getMacroAgentApiUrl(this.config.serverConfig);
  }

  /**
   * Check if the server is ready to accept connections
   */
  isReady(): boolean {
    return this.state === "running";
  }

  /**
   * Check if the server is available (executable found)
   */
  isAvailable(): boolean {
    return this.state !== "unavailable";
  }

  /**
   * Get current server state
   */
  getState(): ServerState {
    return this.state;
  }

  /**
   * Get the observability service instance.
   * Returns null if not initialized or server unavailable.
   */
  getObservabilityService(): MacroAgentObservabilityService | null {
    return this.observabilityService;
  }

  /**
   * Check if observability is connected.
   * Returns false if service not initialized or not connected.
   */
  isObservabilityConnected(): boolean {
    return this.observabilityService?.isConnected() ?? false;
  }

  // ─────────────────────────────────────────────────────────────────
  // Observability Lifecycle
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start the observability service connection.
   * Called after server is ready. Failure does not fail server startup.
   */
  private async startObservability(): Promise<void> {
    try {
      const config: MacroAgentObservabilityConfig = {
        apiBaseUrl: this.getApiUrl(),
      };

      this.observabilityService = new MacroAgentObservabilityService(config);
      await this.observabilityService.connect();

      console.log(
        "[MacroAgentServerManager] Observability service connected"
      );
    } catch (error) {
      console.warn(
        "[MacroAgentServerManager] Observability service failed to connect. " +
          "Server will continue without observability.",
        error
      );
      // Don't throw - server can function without observability
    }
  }

  /**
   * Stop the observability service connection.
   * Called before server stops.
   */
  private async stopObservability(): Promise<void> {
    if (this.observabilityService) {
      try {
        await this.observabilityService.close();
        console.log("[MacroAgentServerManager] Observability service closed");
      } catch (error) {
        console.warn(
          "[MacroAgentServerManager] Error closing observability service:",
          error
        );
      }
      this.observabilityService = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Process Lifecycle
  // ─────────────────────────────────────────────────────────────────

  /**
   * Setup event handlers for the spawned process
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    // Log stdout
    this.process.stdout?.on("data", (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.log(`[macro-agent] ${message}`);
      }
    });

    // Log stderr
    this.process.stderr?.on("data", (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.error(`[macro-agent] ${message}`);
      }
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      console.log(
        `[MacroAgentServerManager] Process exited with code ${code}, signal ${signal}`
      );

      // Don't restart if we're intentionally stopping
      if (this.state === "stopping" || this.state === "stopped") {
        return;
      }

      this.state = "stopped";
      this.process = null;

      // Attempt restart with backoff
      this.scheduleRestart();
    });

    // Handle process error
    this.process.on("error", (error) => {
      console.error("[MacroAgentServerManager] Process error:", error);
    });
  }

  /**
   * Wait for the server to be ready by polling health endpoint
   */
  private async waitForReady(): Promise<void> {
    const healthUrl = `${this.getApiUrl()}/health`;
    const startTime = Date.now();

    console.log(`[MacroAgentServerManager] Waiting for server health at ${healthUrl}`);

    while (Date.now() - startTime < this.healthCheckTimeout) {
      try {
        const response = await fetch(healthUrl);
        if (response.ok) {
          return;
        }
      } catch {
        // Server not ready yet, continue polling
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.healthCheckInterval)
      );
    }

    throw new Error(
      `Server failed to become ready within ${this.healthCheckTimeout}ms`
    );
  }

  /**
   * Schedule a restart with exponential backoff
   */
  private scheduleRestart(): void {
    if (this.restartCount >= this.maxRestarts) {
      console.error(
        `[MacroAgentServerManager] Max restarts (${this.maxRestarts}) reached. ` +
          "Server will not be restarted. Check logs for issues."
      );
      this.state = "unavailable";
      return;
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, this.restartCount) * 1000;
    this.restartCount++;

    console.log(
      `[MacroAgentServerManager] Scheduling restart ${this.restartCount}/${this.maxRestarts} in ${delay}ms`
    );

    this.restartTimer = setTimeout(async () => {
      try {
        await this.start();
      } catch (error) {
        console.error("[MacroAgentServerManager] Restart failed:", error);
        // Will trigger another restart via exit handler if process crashes
      }
    }, delay);
  }

  /**
   * Start timer to reset restart count after successful uptime
   */
  private startUptimeTimer(): void {
    this.uptimeTimer = setTimeout(() => {
      if (this.state === "running") {
        console.log(
          "[MacroAgentServerManager] Server stable, resetting restart count"
        );
        this.restartCount = 0;
      }
    }, this.uptimeThreshold);
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.uptimeTimer) {
      clearTimeout(this.uptimeTimer);
      this.uptimeTimer = null;
    }
  }
}

/**
 * Singleton instance for use across the application
 * Initialize with config before use
 */
let _instance: MacroAgentServerManager | null = null;

/**
 * Get or create the MacroAgentServerManager singleton
 *
 * @param config - Configuration (only used on first call)
 * @returns The singleton instance
 */
export function getMacroAgentServerManager(
  config?: Partial<MacroAgentServerManagerConfig>
): MacroAgentServerManager {
  if (!_instance) {
    _instance = new MacroAgentServerManager(config);
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetMacroAgentServerManager(): void {
  _instance = null;
}
