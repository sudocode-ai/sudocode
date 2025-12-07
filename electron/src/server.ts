import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import { app } from "electron";

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serverProcess: ChildProcess | null = null;

/**
 * Gets the path to the server entry point
 */
function getServerPath(): string {
  if (app.isPackaged) {
    // In production, the server is bundled in node_modules
    // We use the compiled dist/cli.js from the @sudocode-ai/local-server package
    return path.join(
      app.getAppPath(),
      "node_modules",
      "@sudocode-ai",
      "local-server",
      "dist",
      "cli.js"
    );
  } else {
    // In development, use the workspace sibling
    return path.join(__dirname, "..", "..", "server", "dist", "cli.js");
  }
}

/**
 * Gets the path to the frontend dist for the server to serve
 */
function getFrontendDistPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "frontend");
  } else {
    return path.join(__dirname, "..", "..", "frontend", "dist");
  }
}

/**
 * Starts the server process
 * @param port Port to run the server on
 * @returns Promise that resolves when server process is spawned
 */
export async function startServer(port: number): Promise<void> {
  if (serverProcess) {
    console.log("[server] Server already running");
    return;
  }

  const serverPath = getServerPath();
  const frontendPath = getFrontendDistPath();

  console.log(`[server] Starting server from: ${serverPath}`);
  console.log(`[server] Frontend path: ${frontendPath}`);
  console.log(`[server] Port: ${port}`);

  // Set up environment for the server process
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUDOCODE_PORT: String(port),
    NODE_ENV: app.isPackaged ? "production" : "development",
    // Tell the server where to find the frontend (in production)
    SUDOCODE_FRONTEND_PATH: frontendPath,
  };

  // Spawn the server process
  serverProcess = spawn(process.execPath, [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: app.isPackaged ? app.getAppPath() : path.join(__dirname, "..", ".."),
  });

  // Forward server stdout
  serverProcess.stdout?.on("data", (data: Buffer) => {
    const message = data.toString().trim();
    if (message) {
      console.log(`[server:stdout] ${message}`);
    }
  });

  // Forward server stderr
  serverProcess.stderr?.on("data", (data: Buffer) => {
    const message = data.toString().trim();
    if (message) {
      console.error(`[server:stderr] ${message}`);
    }
  });

  // Handle server exit
  serverProcess.on("exit", (code, signal) => {
    console.log(`[server] Server exited with code ${code}, signal ${signal}`);
    serverProcess = null;
  });

  // Handle server errors
  serverProcess.on("error", (error) => {
    console.error(`[server] Server process error:`, error);
    serverProcess = null;
  });
}

/**
 * Stops the server process gracefully
 */
export async function stopServer(): Promise<void> {
  if (!serverProcess) {
    console.log("[server] No server process to stop");
    return;
  }

  console.log("[server] Stopping server...");

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log("[server] Force killing server process");
      serverProcess?.kill("SIGKILL");
      resolve();
    }, 5000);

    serverProcess!.once("exit", () => {
      clearTimeout(timeout);
      console.log("[server] Server stopped");
      serverProcess = null;
      resolve();
    });

    // Send SIGTERM for graceful shutdown
    serverProcess!.kill("SIGTERM");
  });
}

/**
 * Check if server is running
 */
export function isServerRunning(): boolean {
  return serverProcess !== null && serverProcess.exitCode === null;
}
