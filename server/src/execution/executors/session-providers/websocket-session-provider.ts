/**
 * WebSocket Session Provider
 *
 * Implements AcpSessionProvider for WebSocket-based agents (macro-agent).
 * Connects to a running macro-agent server via WebSocket ACP.
 *
 * Unlike StdioSessionProvider which spawns a subprocess, this provider
 * connects to a shared server that stays running across executions.
 *
 * Used for: macro-agent
 *
 * @module execution/executors/session-providers/websocket-session-provider
 */

import { WebSocket } from "ws";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AcpSession,
  AcpSessionProvider,
  SessionProviderConfig,
  CreateSessionOptions,
  ExtendedSessionUpdate,
  PermissionMode,
} from "./types.js";

/**
 * Configuration for WebSocket session provider
 */
export interface WebSocketSessionProviderConfig extends SessionProviderConfig {
  /** WebSocket URL to connect to (e.g., "ws://localhost:3100/acp") */
  wsUrl: string;

  /** Connection timeout in milliseconds (default: 10000) */
  connectionTimeout?: number;

  /** Auto-reconnect on disconnect (default: false) */
  autoReconnect?: boolean;
}

/**
 * Connection state for the WebSocket
 */
type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "closed";

/**
 * WebSocket-based ACP session provider.
 * Connects to a macro-agent server via WebSocket ACP.
 */
export class WebSocketSessionProvider implements AcpSessionProvider {
  private ws: WebSocket | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private clientHandler: WebSocketClientHandler | null = null;
  private state: ConnectionState = "disconnected";
  private capabilities: acp.AgentCapabilities | null = null;

  private readonly config: WebSocketSessionProviderConfig;
  private readonly connectionTimeout: number;

  constructor(config: WebSocketSessionProviderConfig) {
    this.config = config;
    this.connectionTimeout = config.connectionTimeout ?? 10000;
  }

  /**
   * Create a new session.
   * Connects to the server if not already connected.
   */
  async createSession(
    workDir: string,
    options?: CreateSessionOptions
  ): Promise<AcpSession> {
    // Connect if not already connected
    if (this.state !== "connected") {
      await this.connect();
    }

    if (!this.connection || !this.clientHandler) {
      throw new Error(
        "[WebSocketSessionProvider] Not connected to macro-agent server"
      );
    }

    // Create session via ACP
    const result = await this.connection.newSession({
      cwd: workDir,
      mcpServers: options?.mcpServers ?? [],
    });

    // Set mode if specified
    if (options?.mode && this.connection.setSessionMode) {
      await this.connection.setSessionMode({
        sessionId: result.sessionId,
        modeId: options.mode,
      });
    }

    return new WebSocketSession(
      result.sessionId,
      this.connection,
      this.clientHandler
    );
  }

  /**
   * Load/resume an existing session.
   * Connects to the server if not already connected.
   */
  async loadSession(
    sessionId: string,
    workDir: string,
    options?: CreateSessionOptions
  ): Promise<AcpSession> {
    // Connect if not already connected
    if (this.state !== "connected") {
      await this.connect();
    }

    if (!this.connection || !this.clientHandler) {
      throw new Error(
        "[WebSocketSessionProvider] Not connected to macro-agent server"
      );
    }

    // Check if server supports session loading
    if (this.capabilities?.loadSession) {
      await this.connection.loadSession({
        sessionId,
        cwd: workDir,
        mcpServers: options?.mcpServers ?? [],
      });
      return new WebSocketSession(
        sessionId,
        this.connection,
        this.clientHandler
      );
    }

    // Fallback: create new session if loading not supported
    console.log(
      `[WebSocketSessionProvider] Server doesn't support session loading, creating new session`
    );
    return this.createSession(workDir, options);
  }

  /**
   * Check if the provider supports session loading/resuming.
   * Must connect first to check capabilities.
   */
  supportsSessionLoading(): boolean {
    return this.capabilities?.loadSession ?? false;
  }

  /**
   * Close the provider and release resources.
   * Closes the WebSocket connection (server keeps running).
   */
  async close(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "Provider closing");
    }

    this.ws = null;
    this.connection = null;
    this.clientHandler = null;
    this.state = "closed";
    this.capabilities = null;

    console.log(`[WebSocketSessionProvider] Closed connection`);
  }

  /**
   * Connect to the macro-agent server.
   */
  private async connect(): Promise<void> {
    if (this.state === "connecting") {
      // Wait for existing connection attempt
      await this.waitForConnection();
      return;
    }

    if (this.state === "connected") {
      return;
    }

    this.state = "connecting";
    console.log(
      `[WebSocketSessionProvider] Connecting to ${this.config.wsUrl}...`
    );

    try {
      // Create WebSocket connection
      this.ws = new WebSocket(this.config.wsUrl);

      // Wait for connection to open
      await this.waitForOpen();

      // Create the ACP stream adapter
      const stream = webSocketClientStream(this.ws);

      // Create client handler
      this.clientHandler = new WebSocketClientHandler(
        this.config.permissionMode ?? "auto-approve"
      );

      // Create ACP connection
      this.connection = new acp.ClientSideConnection(
        () => this.clientHandler!,
        stream
      );

      // Initialize connection
      const initResult = await this.connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: false,
        },
      });

      this.capabilities = initResult.agentCapabilities ?? {};
      this.state = "connected";

      console.log(`[WebSocketSessionProvider] Connected to macro-agent server`);

      // Setup disconnect handler
      this.setupDisconnectHandler();
    } catch (error) {
      this.state = "disconnected";
      this.cleanup();
      throw new Error(
        `[WebSocketSessionProvider] Failed to connect: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Wait for WebSocket to open.
   */
  private waitForOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not created"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.connectionTimeout}ms`));
      }, this.connectionTimeout);

      this.ws.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.ws.once("close", (code, reason) => {
        clearTimeout(timeout);
        reject(new Error(`Connection closed: ${code} ${reason.toString()}`));
      });
    });
  }

  /**
   * Wait for existing connection attempt to complete.
   */
  private async waitForConnection(): Promise<void> {
    const maxWait = this.connectionTimeout;
    const start = Date.now();

    while (this.state === "connecting" && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.state !== "connected") {
      throw new Error("Connection attempt failed or timed out");
    }
  }

  /**
   * Setup handler for WebSocket disconnection.
   */
  private setupDisconnectHandler(): void {
    if (!this.ws) return;

    this.ws.on("close", (code, reason) => {
      console.log(
        `[WebSocketSessionProvider] Disconnected: code=${code}, reason=${reason.toString()}`
      );
      this.state = "disconnected";
      this.cleanup();
    });

    this.ws.on("error", (err) => {
      console.error(`[WebSocketSessionProvider] Error:`, err);
    });
  }

  /**
   * Cleanup resources.
   */
  private cleanup(): void {
    this.ws = null;
    this.connection = null;
    this.clientHandler = null;
    this.capabilities = null;
  }
}

/**
 * Pushable async iterable for bridging push-based and async-iterator-based code.
 * Used to stream session updates to consumers.
 */
class Pushable<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;

  push(item: T): void {
    if (this.done) return;

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  end(): void {
    this.done = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          const value = this.queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

/**
 * Permission request update for interactive mode
 */
interface PermissionRequestUpdate {
  sessionUpdate: "permission_request";
  requestId: string;
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    status: string;
    rawInput?: unknown;
  };
  options: acp.PermissionOption[];
}

/**
 * Deferred promise for pending permission requests
 */
interface PendingPermission {
  resolve: (response: acp.RequestPermissionResponse) => void;
  reject: (error: Error) => void;
  sessionId: string;
}

/**
 * Client handler for WebSocket ACP connection.
 * Handles client-side operations (permissions, file I/O, session updates).
 */
class WebSocketClientHandler implements acp.Client {
  private permissionMode: PermissionMode;
  private sessionStreams: Map<string, Pushable<ExtendedSessionUpdate>> =
    new Map();
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private permissionRequestCounter = 0;

  constructor(permissionMode: PermissionMode = "auto-approve") {
    this.permissionMode = permissionMode;
  }

  /**
   * Get or create a pushable stream for a session
   */
  getSessionStream(sessionId: string): Pushable<ExtendedSessionUpdate> {
    let stream = this.sessionStreams.get(sessionId);
    if (!stream) {
      stream = new Pushable<ExtendedSessionUpdate>();
      this.sessionStreams.set(sessionId, stream);
    }
    return stream;
  }

  /**
   * End a session's update stream
   */
  endSessionStream(sessionId: string): void {
    const stream = this.sessionStreams.get(sessionId);
    if (stream) {
      stream.end();
      this.sessionStreams.delete(sessionId);
    }
  }

  /**
   * Respond to a pending permission request
   */
  respondToPermission(requestId: string, optionId: string): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`No pending permission request with ID: ${requestId}`);
    }

    this.pendingPermissions.delete(requestId);
    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId,
      },
    });
  }

  /**
   * Handle permission requests from the agent
   */
  async requestPermission(
    params: acp.RequestPermissionRequest
  ): Promise<acp.RequestPermissionResponse> {
    const options = params.options;

    if (this.permissionMode === "auto-approve") {
      const allowOption = options.find(
        (opt) => opt.kind === "allow_once" || opt.kind === "allow_always"
      );
      if (allowOption) {
        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        };
      }
    }

    if (this.permissionMode === "auto-deny") {
      const denyOption = options.find(
        (opt) => opt.kind === "reject_once" || opt.kind === "reject_always"
      );
      if (denyOption) {
        return {
          outcome: {
            outcome: "selected",
            optionId: denyOption.optionId,
          },
        };
      }
    }

    // Interactive mode: emit permission request as session update
    if (this.permissionMode === "interactive") {
      const requestId = `perm-${++this.permissionRequestCounter}`;

      const permissionUpdate: PermissionRequestUpdate = {
        sessionUpdate: "permission_request",
        requestId,
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: params.toolCall.toolCallId,
          title: params.toolCall.title ?? "Unknown",
          status: params.toolCall.status ?? "pending",
          rawInput: params.toolCall.rawInput,
        },
        options: params.options,
      };

      const stream = this.getSessionStream(params.sessionId);
      stream.push(permissionUpdate);

      return new Promise((resolve, reject) => {
        this.pendingPermissions.set(requestId, {
          resolve,
          reject,
          sessionId: params.sessionId,
        });
      });
    }

    // Fallback: return first option
    return {
      outcome: {
        outcome: "selected",
        optionId: options[0].optionId,
      },
    };
  }

  /**
   * Handle session updates from the agent
   */
  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const stream = this.getSessionStream(params.sessionId);
    stream.push(params.update);
  }

  /**
   * Handle file read requests (macro-agent handles these internally)
   */
  async readTextFile(
    _params: acp.ReadTextFileRequest
  ): Promise<acp.ReadTextFileResponse> {
    // Macro-agent handles file I/O internally
    throw new Error("File read not supported via WebSocket - agent handles internally");
  }

  /**
   * Handle file write requests (macro-agent handles these internally)
   */
  async writeTextFile(
    _params: acp.WriteTextFileRequest
  ): Promise<acp.WriteTextFileResponse> {
    // Macro-agent handles file I/O internally
    throw new Error("File write not supported via WebSocket - agent handles internally");
  }

  /**
   * Terminal operations not supported via WebSocket
   */
  async createTerminal(): Promise<acp.CreateTerminalResponse> {
    throw new Error("Terminal not supported via WebSocket");
  }

  async terminalOutput(): Promise<acp.TerminalOutputResponse> {
    throw new Error("Terminal not supported via WebSocket");
  }

  async killTerminal(): Promise<acp.KillTerminalCommandResponse> {
    throw new Error("Terminal not supported via WebSocket");
  }

  async releaseTerminal(): Promise<acp.ReleaseTerminalResponse> {
    throw new Error("Terminal not supported via WebSocket");
  }

  async waitForTerminalExit(): Promise<acp.WaitForTerminalExitResponse> {
    throw new Error("Terminal not supported via WebSocket");
  }
}

/**
 * AcpSession implementation for WebSocket connections.
 */
class WebSocketSession implements AcpSession {
  readonly id: string;
  private readonly connection: acp.ClientSideConnection;
  private readonly clientHandler: WebSocketClientHandler;

  constructor(
    id: string,
    connection: acp.ClientSideConnection,
    clientHandler: WebSocketClientHandler
  ) {
    this.id = id;
    this.connection = connection;
    this.clientHandler = clientHandler;
  }

  async *prompt(text: string): AsyncIterable<ExtendedSessionUpdate> {
    const promptBlocks: acp.ContentBlock[] = [{ type: "text", text }];
    const stream = this.clientHandler.getSessionStream(this.id);

    // Start the prompt
    const promptPromise = this.connection.prompt({
      sessionId: this.id,
      prompt: promptBlocks,
    });

    const updateIterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        const raceResult = await Promise.race([
          promptPromise.then((result) => ({ type: "done" as const, result })),
          updateIterator
            .next()
            .then((update) => ({ type: "update" as const, update })),
        ]);

        if (raceResult.type === "done") {
          this.clientHandler.endSessionStream(this.id);

          // Drain remaining updates
          let remaining = await updateIterator.next();
          while (!remaining.done) {
            yield remaining.value;
            remaining = await updateIterator.next();
          }
          break;
        } else {
          if (raceResult.update.done) {
            break;
          }
          yield raceResult.update.value;
        }
      }
    } finally {
      this.clientHandler.endSessionStream(this.id);
    }
  }

  async cancel(): Promise<void> {
    await this.connection.cancel({
      sessionId: this.id,
    });
  }

  async setMode(mode: string): Promise<void> {
    if (!this.connection.setSessionMode) {
      throw new Error("Agent does not support setting session mode");
    }
    await this.connection.setSessionMode({
      sessionId: this.id,
      modeId: mode,
    });
  }

  respondToPermission(requestId: string, optionId: string): void {
    this.clientHandler.respondToPermission(requestId, optionId);
  }

  async close(): Promise<void> {
    // For WebSocket, session close just ends the stream
    // The connection stays open for other sessions
    this.clientHandler.endSessionStream(this.id);
  }
}

// Type alias for ACP messages
type AnyMessage = Record<string, unknown>;

/**
 * Create an ACP Stream from a WebSocket connection (client side).
 *
 * Adapts a WebSocket to the bidirectional Stream interface expected
 * by ClientSideConnection. Each WebSocket message is a complete JSON-RPC
 * message (no newline delimiters needed).
 */
function webSocketClientStream(ws: WebSocket): acp.Stream {
  let isClosed = false;

  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        if (isClosed) return;

        try {
          const text =
            data instanceof Buffer
              ? data.toString("utf-8")
              : Buffer.from(data as ArrayBuffer).toString("utf-8");

          const message = JSON.parse(text) as AnyMessage;
          controller.enqueue(message);
        } catch (err) {
          console.error(
            "[websocket-session-provider] Failed to parse message:",
            err
          );
        }
      });

      ws.on("close", () => {
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      });

      ws.on("error", (err) => {
        if (!isClosed) {
          isClosed = true;
          controller.error(err);
        }
      });
    },

    cancel() {
      if (!isClosed) {
        isClosed = true;
        ws.close(1000, "Stream cancelled");
      }
    },
  });

  const writable = new WritableStream<AnyMessage>({
    write(message) {
      return new Promise<void>((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) {
          resolve();
          return;
        }

        try {
          const data = JSON.stringify(message);
          ws.send(data, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    },

    close() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Stream closed");
      }
      return Promise.resolve();
    },

    abort(reason) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, String(reason));
      }
      return Promise.resolve();
    },
  });

  return { readable, writable } as unknown as acp.Stream;
}
