/**
 * EditorService - Manages IDE opening functionality
 */

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import which from "which";
import { EditorType, EditorConfig, EditorOpenError } from "../types/editor.js";

/**
 * Command mapping for each editor type
 */
const EDITOR_COMMANDS: Record<EditorType, string> = {
  [EditorType.VS_CODE]: "code",
  [EditorType.CURSOR]: "cursor",
  [EditorType.WINDSURF]: "windsurf",
  [EditorType.INTELLIJ]: "idea",
  [EditorType.ZED]: "zed",
  [EditorType.XCODE]: "xed",
  [EditorType.CUSTOM]: "", // Handled specially via customCommand
};

/**
 * Default editor configuration
 */
const DEFAULT_CONFIG: EditorConfig = {
  editorType: EditorType.VS_CODE,
};

/**
 * EditorService handles IDE opening operations
 */
export class EditorService {
  private repoPath: string;
  private configCache: EditorConfig | null = null;
  private configCacheTime: number = 0;
  private readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Load editor configuration from .sudocode/config.local.json
   * Falls back to default (VS Code) if file doesn't exist
   */
  async loadConfig(): Promise<EditorConfig> {
    // Check cache
    const now = Date.now();
    if (
      this.configCache &&
      now - this.configCacheTime < this.CONFIG_CACHE_TTL
    ) {
      return this.configCache;
    }

    const configPath = path.join(
      this.repoPath,
      ".sudocode",
      "config.local.json"
    );

    try {
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(content);

      if (parsed.editor && typeof parsed.editor.editorType === "string") {
        const config: EditorConfig = {
          editorType: parsed.editor.editorType as EditorType,
          customCommand: parsed.editor.customCommand,
        };

        // Validate editor type
        if (!Object.values(EditorType).includes(config.editorType)) {
          console.warn(
            `Invalid editor type in config: ${config.editorType}, using default`
          );
          return DEFAULT_CONFIG;
        }

        // Cache the config
        this.configCache = config;
        this.configCacheTime = now;

        return config;
      }
    } catch (error) {
      // Config file doesn't exist or is invalid, use default
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Failed to load editor config:", error);
      }
    }

    return DEFAULT_CONFIG;
  }

  /**
   * Get command name for editor type
   */
  getCommand(editorType: EditorType, customCommand?: string): string {
    if (editorType === EditorType.CUSTOM) {
      return customCommand || EDITOR_COMMANDS[EditorType.VS_CODE];
    }
    return EDITOR_COMMANDS[editorType];
  }

  /**
   * Check if editor command is available using 'which' package
   */
  async checkAvailability(command: string): Promise<boolean> {
    try {
      await which(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Spawn editor process with worktree path
   *
   * @param worktreePath - Absolute path to worktree directory
   * @param config - Editor configuration
   * @throws EditorOpenError if spawn fails
   */
  async spawnEditor(worktreePath: string, config: EditorConfig): Promise<void> {
    const command = this.getCommand(config.editorType, config.customCommand);

    // Check if command is available
    const isAvailable = await this.checkAvailability(command);
    if (!isAvailable) {
      throw new EditorOpenError(
        "EDITOR_NOT_FOUND",
        config.editorType,
        `Editor '${command}' not found in PATH`,
        `Please install ${this.getEditorName(config.editorType)} or configure a different editor`
      );
    }

    // Check if worktree path exists
    try {
      await fs.access(worktreePath);
      const stats = await fs.stat(worktreePath);
      if (!stats.isDirectory()) {
        throw new EditorOpenError(
          "WORKTREE_MISSING",
          config.editorType,
          `Worktree path is not a directory: ${worktreePath}`,
          "The worktree path must be a valid directory"
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new EditorOpenError(
          "WORKTREE_MISSING",
          config.editorType,
          `Worktree directory not found: ${worktreePath}`,
          "The worktree may have been deleted or the path is incorrect"
        );
      }
      // If it's already an EditorOpenError, re-throw it
      if (error instanceof EditorOpenError) {
        throw error;
      }
      // For other filesystem errors, wrap them
      throw new EditorOpenError(
        "WORKTREE_MISSING",
        config.editorType,
        `Cannot access worktree directory: ${worktreePath}`,
        error instanceof Error ? error.message : String(error)
      );
    }

    try {
      // Spawn in detached mode
      const child = spawn(command, [worktreePath], {
        detached: true,
        stdio: "ignore",
        cwd: worktreePath,
      });

      // Unref so parent process doesn't wait for child
      child.unref();
    } catch (error) {
      throw new EditorOpenError(
        "SPAWN_FAILED",
        config.editorType,
        `Failed to launch editor '${command}'`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Open worktree in IDE using configured editor
   *
   * @param worktreePath - Absolute path to worktree directory
   * @param editorTypeOverride - Optional editor type override for this operation
   */
  async openWorktree(
    worktreePath: string,
    editorTypeOverride?: EditorType
  ): Promise<void> {
    // Load config
    let config = await this.loadConfig();

    // Apply override if provided
    if (editorTypeOverride) {
      config = {
        ...config,
        editorType: editorTypeOverride,
      };
    }

    await this.spawnEditor(worktreePath, config);
  }

  /**
   * Check availability of all supported editors
   * Useful for settings UI to show which editors are installed
   */
  async checkAllAvailability(): Promise<Record<EditorType, boolean>> {
    const results: Partial<Record<EditorType, boolean>> = {};

    for (const editorType of Object.values(EditorType)) {
      if (editorType === EditorType.CUSTOM) {
        // Custom editors can't be checked without knowing the command
        results[editorType] = false;
        continue;
      }

      const command = this.getCommand(editorType);
      results[editorType] = await this.checkAvailability(command);
    }

    return results as Record<EditorType, boolean>;
  }

  /**
   * Get human-readable editor name for error messages
   */
  private getEditorName(editorType: EditorType): string {
    const names: Record<EditorType, string> = {
      [EditorType.VS_CODE]: "Visual Studio Code",
      [EditorType.CURSOR]: "Cursor",
      [EditorType.WINDSURF]: "Windsurf",
      [EditorType.INTELLIJ]: "IntelliJ IDEA",
      [EditorType.ZED]: "Zed",
      [EditorType.XCODE]: "Xcode",
      [EditorType.CUSTOM]: "Custom Editor",
    };
    return names[editorType];
  }

  /**
   * Clear the config cache
   * Useful for testing or when config file is updated
   */
  clearCache(): void {
    this.configCache = null;
    this.configCacheTime = 0;
  }
}
