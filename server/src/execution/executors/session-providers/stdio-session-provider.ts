/**
 * Stdio Session Provider
 *
 * Implements AcpSessionProvider for stdio-based agents.
 * Spawns agent as subprocess and communicates via stdin/stdout using ACP protocol.
 *
 * Used for: claude-code, codex, gemini, opencode
 *
 * @module execution/executors/session-providers/stdio-session-provider
 */

import {
  AgentFactory,
  type AgentHandle,
  type Session,
} from "acp-factory";
import type {
  AcpSession,
  AcpSessionProvider,
  SessionProviderConfig,
  CreateSessionOptions,
  ExtendedSessionUpdate,
} from "./types.js";

/**
 * Stdio-based ACP session provider.
 * Spawns agent as subprocess and communicates via stdin/stdout.
 */
export class StdioSessionProvider implements AcpSessionProvider {
  private agent: AgentHandle | null = null;

  constructor(
    private readonly agentType: string,
    private readonly config: SessionProviderConfig
  ) {}

  /**
   * Create a new session.
   * Spawns the agent subprocess if not already running.
   */
  async createSession(
    workDir: string,
    options?: CreateSessionOptions
  ): Promise<AcpSession> {
    // Spawn agent if not already running
    if (!this.agent) {
      await this.spawnAgent();
    }

    // Create session
    const session = await this.agent!.createSession(workDir, {
      mcpServers: options?.mcpServers,
      mode: options?.mode,
    });

    return new StdioSession(session);
  }

  /**
   * Load/resume an existing session.
   * Spawns the agent subprocess if not already running.
   * Falls back to creating a new session if the agent doesn't support loading.
   */
  async loadSession(
    sessionId: string,
    workDir: string,
    options?: CreateSessionOptions
  ): Promise<AcpSession> {
    // Spawn agent if not already running
    if (!this.agent) {
      await this.spawnAgent();
    }

    // Check if agent supports session loading
    if (this.agent!.capabilities?.loadSession) {
      const session = await this.agent!.loadSession(sessionId, workDir);
      return new StdioSession(session);
    }

    // Fallback: create new session if loading not supported
    console.log(
      `[StdioSessionProvider] Agent ${this.agentType} doesn't support session loading, creating new session`
    );
    const session = await this.agent!.createSession(workDir, {
      mcpServers: options?.mcpServers,
      mode: options?.mode,
    });

    return new StdioSession(session);
  }

  /**
   * Check if the provider supports session loading/resuming.
   * Must spawn the agent first to check capabilities.
   */
  supportsSessionLoading(): boolean {
    return this.agent?.capabilities?.loadSession ?? false;
  }

  /**
   * Close the provider and release resources.
   * Kills the subprocess.
   */
  async close(): Promise<void> {
    if (this.agent?.isRunning()) {
      try {
        await this.agent.close();
        console.log(`[StdioSessionProvider] Closed agent ${this.agentType}`);
      } catch (error) {
        console.warn(
          `[StdioSessionProvider] Error closing agent ${this.agentType}:`,
          error
        );
      }
    }
    this.agent = null;
  }

  /**
   * Spawn the agent subprocess.
   */
  private async spawnAgent(): Promise<void> {
    console.log(`[StdioSessionProvider] Spawning ${this.agentType} agent`);

    const permissionMode = this.config.permissionMode ?? "interactive";

    this.agent = await AgentFactory.spawn(this.agentType, {
      env: this.config.env,
      permissionMode,
      onFileRead: this.config.fileHandlers?.onRead,
      onFileWrite: this.config.fileHandlers?.onWrite,
    });
  }
}

/**
 * AcpSession implementation wrapping acp-factory Session.
 * Delegates all operations to the underlying acp-factory session.
 */
class StdioSession implements AcpSession {
  constructor(private readonly session: Session) {}

  get id(): string {
    return this.session.id;
  }

  async *prompt(text: string): AsyncIterable<ExtendedSessionUpdate> {
    for await (const update of this.session.prompt(text)) {
      yield update;
    }
  }

  async cancel(): Promise<void> {
    await this.session.cancel();
  }

  async setMode(mode: string): Promise<void> {
    await this.session.setMode(mode);
  }

  respondToPermission(requestId: string, optionId: string): void {
    this.session.respondToPermission(requestId, optionId);
  }

  async close(): Promise<void> {
    // For stdio, session close is handled by provider.close()
    // Individual session close is a no-op since the subprocess manages it
  }
}
