import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  type Rectangle,
} from "electron";
import * as path from "path";
import { fileURLToPath } from "url";
import Store from "electron-store";
import { findAvailablePort, waitForPort } from "./port-finder.js";
import { startServer, stopServer } from "./server.js";

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App settings store
interface AppSettings {
  portRangeStart: number;
  portRangeEnd: number;
  runOnStartup: boolean;
  startMinimized: boolean;
  autoCheckUpdates: boolean;
  autoDownloadUpdates: boolean;
  windowBounds?: Rectangle;
}

const store = new Store<AppSettings>({
  defaults: {
    portRangeStart: 3000,
    portRangeEnd: 3100,
    runOnStartup: false,
    startMinimized: false,
    autoCheckUpdates: true,
    autoDownloadUpdates: false,
  },
});

// State
let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;
let isQuitting = false;

/**
 * Gets the path to the frontend assets
 * In development: ../frontend/dist (workspace sibling)
 * In production: extraResources/frontend (bundled with app)
 */
function getFrontendPath(): string {
  if (app.isPackaged) {
    // Production: look in resources folder
    return path.join(process.resourcesPath, "frontend");
  } else {
    // Development: look in workspace sibling
    return path.join(__dirname, "../../frontend/dist");
  }
}

/**
 * Gets the path to bundled CLI
 */
function getCliPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "cli");
  } else {
    return path.join(__dirname, "../../cli/dist");
  }
}

/**
 * Gets the path to bundled MCP server
 */
function getMcpPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mcp");
  } else {
    return path.join(__dirname, "../../mcp/dist");
  }
}

/**
 * Creates the main application window
 */
async function createWindow(): Promise<void> {
  const savedBounds = store.get("windowBounds");

  mainWindow = new BrowserWindow({
    width: savedBounds?.width || 1400,
    height: savedBounds?.height || 900,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for preload to work with ES modules
    },
    show: false, // Don't show until ready
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#1a1a1a", // Match app background
  });

  // Load the frontend from the local server
  if (serverPort) {
    await mainWindow.loadURL(`http://localhost:${serverPort}`);
  } else {
    // Fallback to loading index.html directly
    const frontendPath = getFrontendPath();
    await mainWindow.loadFile(path.join(frontendPath, "index.html"));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    if (!store.get("startMinimized")) {
      mainWindow?.show();
    }
  });

  // Save window bounds on resize/move
  mainWindow.on("resize", () => saveWindowBounds());
  mainWindow.on("move", () => saveWindowBounds());

  // Handle window close
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

/**
 * Saves the current window bounds to the store
 */
function saveWindowBounds(): void {
  if (mainWindow && !mainWindow.isMinimized()) {
    store.set("windowBounds", mainWindow.getBounds());
  }
}

/**
 * Registers IPC handlers for communication with renderer process
 */
function registerIpcHandlers(): void {
  ipcMain.handle("get-server-port", () => serverPort);

  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("get-platform", () => process.platform);

  ipcMain.handle("get-settings", () => store.store);

  ipcMain.handle(
    "update-settings",
    (_event, settings: Partial<AppSettings>) => {
      for (const [key, value] of Object.entries(settings)) {
        store.set(key as keyof AppSettings, value);
      }

      // Handle run on startup setting
      if ("runOnStartup" in settings) {
        app.setLoginItemSettings({
          openAtLogin: settings.runOnStartup!,
          openAsHidden: store.get("startMinimized"),
        });
      }

      return store.store;
    }
  );

  ipcMain.handle("get-cli-path", () => getCliPath());

  ipcMain.handle("get-mcp-path", () => getMcpPath());

  // Dialog handlers
  ipcMain.handle("show-open-dialog", async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, options);
  });

  ipcMain.handle("show-save-dialog", async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePath: undefined };
    return dialog.showSaveDialog(mainWindow, options);
  });
}

/**
 * Initialize and start the application
 */
async function initializeApp(): Promise<void> {
  console.log("[electron] Initializing Sudocode Desktop...");

  // Find available port
  const portStart = store.get("portRangeStart");
  const portEnd = store.get("portRangeEnd");

  console.log(`[electron] Finding available port in range ${portStart}-${portEnd}...`);
  serverPort = await findAvailablePort(portStart, portEnd);
  console.log(`[electron] Found available port: ${serverPort}`);

  // Start the server
  console.log("[electron] Starting server...");
  await startServer(serverPort);

  // Wait for server to be ready
  console.log("[electron] Waiting for server to accept connections...");
  const serverReady = await waitForPort(serverPort, 30000);
  if (!serverReady) {
    throw new Error("Server failed to start within timeout");
  }
  console.log("[electron] Server is ready");

  // Create the main window
  await createWindow();
}

// Electron app lifecycle
app.whenReady().then(async () => {
  registerIpcHandlers();

  try {
    await initializeApp();
  } catch (error) {
    console.error("[electron] Failed to initialize app:", error);
    dialog.showErrorBox(
      "Startup Error",
      `Failed to start Sudocode: ${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
    return;
  }

  // macOS: re-create window when dock icon is clicked
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle before-quit to properly shut down
app.on("before-quit", async () => {
  isQuitting = true;
  console.log("[electron] Shutting down...");
  await stopServer();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
