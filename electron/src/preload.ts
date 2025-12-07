import { contextBridge, ipcRenderer } from "electron";

/**
 * Electron API exposed to the renderer process via context bridge
 * This provides a secure way for the frontend to communicate with the main process
 */
export interface ElectronAPI {
  // Server
  getServerPort: () => Promise<number | null>;

  // App info
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;

  // Binary paths
  getCliPath: () => Promise<string>;
  getMcpPath: () => Promise<string>;

  // Dialogs
  showOpenDialog: (
    options: OpenDialogOptions
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (
    options: SaveDialogOptions
  ) => Promise<{ canceled: boolean; filePath?: string }>;

  // Platform detection
  isElectron: boolean;
}

interface AppSettings {
  portRangeStart: number;
  portRangeEnd: number;
  runOnStartup: boolean;
  startMinimized: boolean;
  autoCheckUpdates: boolean;
  autoDownloadUpdates: boolean;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<
    | "openFile"
    | "openDirectory"
    | "multiSelections"
    | "showHiddenFiles"
    | "createDirectory"
  >;
}

interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

const electronAPI: ElectronAPI = {
  // Server
  getServerPort: () => ipcRenderer.invoke("get-server-port"),

  // App info
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),

  // Settings
  getSettings: () => ipcRenderer.invoke("get-settings"),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke("update-settings", settings),

  // Binary paths
  getCliPath: () => ipcRenderer.invoke("get-cli-path"),
  getMcpPath: () => ipcRenderer.invoke("get-mcp-path"),

  // Dialogs
  showOpenDialog: (options: OpenDialogOptions) =>
    ipcRenderer.invoke("show-open-dialog", options),
  showSaveDialog: (options: SaveDialogOptions) =>
    ipcRenderer.invoke("show-save-dialog", options),

  // Platform detection - sync property
  isElectron: true,
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// TypeScript declaration for window object
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
