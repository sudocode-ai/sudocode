/**
 * Editor types and configuration for IDE opening functionality
 */

/**
 * Supported editor types for opening worktrees
 */
export enum EditorType {
  VS_CODE = "vs-code",
  CURSOR = "cursor",
  WINDSURF = "windsurf",
  INTELLIJ = "intellij",
  ZED = "zed",
  XCODE = "xcode",
  CUSTOM = "custom",
}

/**
 * Editor configuration interface
 * Loaded from .sudocode/config.local.json
 */
export interface EditorConfig {
  editorType: EditorType;
  customCommand?: string; // Required when editorType === 'custom'
}

/**
 * Error codes for editor opening failures
 */
export type EditorErrorCode =
  | "EDITOR_NOT_FOUND" // Editor command not in PATH
  | "WORKTREE_MISSING" // Execution has no worktree path
  | "SPAWN_FAILED"; // Process spawn failed

/**
 * Custom error class for editor opening failures
 * Provides structured error information for API responses
 */
export class EditorOpenError extends Error {
  constructor(
    public code: EditorErrorCode,
    public editorType: EditorType,
    message: string,
    public details?: string
  ) {
    super(message);
    this.name = "EditorOpenError";

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EditorOpenError);
    }
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        editorType: this.editorType,
      },
    };
  }
}
