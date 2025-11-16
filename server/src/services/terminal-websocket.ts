/**
 * Terminal WebSocket Service
 *
 * Manages WebSocket connections for interactive terminal sessions.
 * Creates and manages PTY processes for executions.
 *
 * @module services/terminal-websocket
 */

import type { WebSocket } from 'ws';
import type { Database } from 'better-sqlite3';
import { PtyProcessManager } from '../execution/process/pty-manager.js';
import { TerminalTransport } from '../execution/transport/terminal-transport.js';

/**
 * Terminal session information
 */
export interface TerminalSession {
  executionId: string;
  transport: TerminalTransport;
  ptyManager: PtyProcessManager;
  processId: string;
  createdAt: Date;
}

/**
 * Execution data from database
 */
interface ExecutionData {
  id: string;
  worktree_path: string | null;
  prompt: string | null;
  status: string;
  created_at: string;
}

/**
 * Terminal WebSocket Service
 *
 * Manages terminal sessions over WebSocket:
 * - Creates PTY process per connection
 * - Sets up bidirectional transport
 * - Handles session lifecycle
 * - Cleans up on disconnect
 *
 * @example
 * ```typescript
 * const service = new TerminalWebSocketService(db);
 *
 * // Handle WebSocket connection
 * wss.on('connection', (ws, req) => {
 *   const executionId = extractFromUrl(req.url);
 *   await service.handleConnection(ws, executionId, repoPath);
 * });
 *
 * // Shutdown gracefully
 * await service.shutdown();
 * ```
 */
export class TerminalWebSocketService {
  private sessions = new Map<string, TerminalSession>();

  constructor(private db: Database) {}

  /**
   * Handle new terminal WebSocket connection
   *
   * @param ws - WebSocket connection
   * @param executionId - ID of the execution
   * @param repoPath - Repository path (fallback if no worktree)
   */
  async handleConnection(
    ws: WebSocket,
    executionId: string,
    repoPath: string
  ): Promise<void> {
    try {
      // Get execution details
      const execution = await this.getExecution(executionId);
      if (!execution) {
        ws.close(1008, 'Execution not found');
        return;
      }

      // TODO: Verify user owns execution (authentication)
      // For now, we trust that the request is authenticated at the HTTP layer
      // In production, you should verify:
      // const user = await this.getUserFromWebSocket(ws);
      // if (execution.created_by !== user.id) {
      //   ws.close(1008, 'Unauthorized');
      //   return;
      // }

      // Check if session already exists
      if (this.sessions.has(executionId)) {
        ws.close(1008, 'Terminal session already active for this execution');
        return;
      }

      // Build process config for interactive mode
      const workDir = execution.worktree_path || repoPath;
      const processConfig = {
        executablePath: 'claude',
        args: [],
        workDir,
        mode: 'interactive' as const,
        terminal: {
          cols: 80,
          rows: 24,
        },
      };

      // Create PTY manager and spawn process
      const ptyManager = new PtyProcessManager();
      const ptyProcess = await ptyManager.acquireProcess(processConfig);

      // Create transport to bridge WebSocket and PTY
      const transport = new TerminalTransport(ws, ptyProcess);

      // Track session
      const session: TerminalSession = {
        executionId,
        transport,
        ptyManager,
        processId: ptyProcess.id,
        createdAt: new Date(),
      };
      this.sessions.set(executionId, session);

      console.log(
        `[TerminalWebSocket] Session created for execution ${executionId} (PID: ${ptyProcess.pid})`
      );

      // Inject initial prompt if execution has one
      if (execution.prompt) {
        // Wait a bit for terminal to be ready
        setTimeout(() => {
          try {
            ptyProcess.write(execution.prompt + '\r');
            console.log(
              `[TerminalWebSocket] Injected prompt for execution ${executionId}`
            );
          } catch (error) {
            console.error(
              `[TerminalWebSocket] Failed to inject prompt:`,
              error
            );
          }
        }, 500);
      }

      // Clean up on disconnect
      ws.on('close', () => {
        console.log(
          `[TerminalWebSocket] WebSocket closed for execution ${executionId}`
        );
        this.cleanupSession(executionId);
      });
    } catch (error) {
      console.error('[TerminalWebSocket] Failed to create terminal:', error);
      ws.close(1011, 'Internal server error');
    }
  }

  /**
   * Clean up a terminal session
   */
  private async cleanupSession(executionId: string): Promise<void> {
    const session = this.sessions.get(executionId);
    if (!session) {
      return;
    }

    console.log(
      `[TerminalWebSocket] Cleaning up session for execution ${executionId}`
    );

    try {
      // Close transport
      session.transport.close();

      // Terminate PTY process
      await session.ptyManager.terminateProcess(session.processId);

      // Shutdown manager
      await session.ptyManager.shutdown();
    } catch (error) {
      console.error(
        `[TerminalWebSocket] Error cleaning up session:`,
        error
      );
    }

    this.sessions.delete(executionId);
  }

  /**
   * Get execution from database
   */
  private async getExecution(
    executionId: string
  ): Promise<ExecutionData | null> {
    try {
      const stmt = this.db.prepare(
        'SELECT id, worktree_path, prompt, status, created_at FROM executions WHERE id = ?'
      );
      const execution = stmt.get(executionId) as ExecutionData | undefined;
      return execution || null;
    } catch (error) {
      console.error('[TerminalWebSocket] Database error:', error);
      return null;
    }
  }

  /**
   * Get active sessions (for monitoring/debugging)
   */
  getSessions(): Map<string, TerminalSession> {
    return this.sessions;
  }

  /**
   * Get session for a specific execution
   */
  getSession(executionId: string): TerminalSession | null {
    return this.sessions.get(executionId) || null;
  }

  /**
   * Shutdown service and cleanup all sessions
   */
  async shutdown(): Promise<void> {
    console.log(
      `[TerminalWebSocket] Shutting down (${this.sessions.size} active sessions)`
    );

    const executionIds = Array.from(this.sessions.keys());
    await Promise.all(executionIds.map((id) => this.cleanupSession(id)));

    console.log('[TerminalWebSocket] Shutdown complete');
  }
}
