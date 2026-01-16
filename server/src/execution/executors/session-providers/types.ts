/**
 * Session Provider Types
 *
 * Unified interfaces for ACP sessions regardless of transport (stdio vs WebSocket).
 * These abstractions allow AcpExecutorWrapper to work with different transports
 * without knowing the underlying implementation details.
 *
 * @module execution/executors/session-providers/types
 */

import type {
  SessionUpdate,
  ExtendedSessionUpdate,
  McpServer,
  PermissionMode,
} from "acp-factory";

/**
 * Unified interface for ACP sessions, regardless of transport.
 * Both stdio (via acp-factory) and WebSocket sessions implement this interface.
 */
export interface AcpSession {
  /** Unique session identifier */
  readonly id: string;

  /**
   * Send a prompt and stream responses.
   * @param text - The prompt text to send
   * @returns AsyncIterable of ExtendedSessionUpdate events
   */
  prompt(text: string): AsyncIterable<ExtendedSessionUpdate>;

  /**
   * Cancel the current prompt execution.
   */
  cancel(): Promise<void>;

  /**
   * Set the session mode (e.g., "code", "plan", "architect").
   * @param mode - The mode to set
   */
  setMode(mode: string): Promise<void>;

  /**
   * Respond to a permission request.
   * @param requestId - The permission request ID
   * @param optionId - The selected option ID (e.g., 'allow_once', 'reject')
   *
   * Note: Returns void for sync providers (stdio) or Promise<void> for async
   * providers (WebSocket/macro-agent). Callers should handle both cases.
   */
  respondToPermission(requestId: string, optionId: string): void | Promise<void>;

  /**
   * Close this session.
   * - For stdio: typically a no-op (subprocess handles cleanup)
   * - For WebSocket: closes the session on the server (connection stays open)
   */
  close(): Promise<void>;
}

/**
 * Configuration for session providers
 */
export interface SessionProviderConfig {
  /** Environment variables to pass to the agent */
  env?: Record<string, string>;

  /** Permission handling mode at ACP protocol level */
  permissionMode?: PermissionMode;

  /**
   * File operation handlers (stdio transport only).
   * WebSocket transports handle file operations internally.
   */
  fileHandlers?: {
    onRead?: (path: string) => Promise<string>;
    onWrite?: (path: string, content: string) => Promise<void>;
  };
}

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
  /** MCP servers to connect to the session */
  mcpServers?: McpServer[];

  /** Session mode to set (e.g., "code", "plan") */
  mode?: string;
}

/**
 * Factory interface for creating ACP sessions.
 * Abstracts the transport layer (stdio vs WebSocket).
 */
export interface AcpSessionProvider {
  /**
   * Create a new session.
   * @param workDir - Working directory for the session
   * @param options - Session creation options
   * @returns The created session
   */
  createSession(
    workDir: string,
    options?: CreateSessionOptions
  ): Promise<AcpSession>;

  /**
   * Load/resume an existing session.
   * @param sessionId - ID of session to resume
   * @param workDir - Working directory for the session
   * @param options - Session creation options
   * @returns The loaded session
   */
  loadSession(
    sessionId: string,
    workDir: string,
    options?: CreateSessionOptions
  ): Promise<AcpSession>;

  /**
   * Check if the provider supports session loading/resuming.
   * Some agents (like Gemini) don't support session persistence.
   */
  supportsSessionLoading(): boolean;

  /**
   * Close the provider and release resources.
   * - For stdio: kills the subprocess
   * - For WebSocket: closes the connection (server stays running)
   */
  close(): Promise<void>;
}

// Re-export types from acp-factory for convenience
export type { SessionUpdate, ExtendedSessionUpdate, McpServer, PermissionMode };
