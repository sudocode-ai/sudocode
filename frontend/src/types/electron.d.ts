/**
 * Electron API types for the renderer process
 * These are exposed via the preload script's contextBridge
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

export interface AppSettings {
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

export interface OpenDialogOptions {
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

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.isElectron === true;
}

/**
 * Get the Electron API if available
 * Returns undefined if not running in Electron
 */
export function getElectronAPI(): ElectronAPI | undefined {
  return window.electronAPI;
}
