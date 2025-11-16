/**
 * Terminal Transport
 *
 * Manages bidirectional communication between WebSocket client and PTY process.
 * Provides a bridge for interactive terminal sessions over WebSocket.
 *
 * @module execution/transport/terminal-transport
 */

import type { WebSocket } from 'ws';
import type { ManagedPtyProcess } from '../process/types.js';

/**
 * WebSocket message types for terminal communication
 */
export type TerminalMessageType =
  | 'terminal:data'    // Server → Client: terminal output
  | 'terminal:exit'    // Server → Client: process exited
  | 'terminal:input'   // Client → Server: user input
  | 'terminal:resize'; // Client → Server: terminal resized

/**
 * Base message structure for terminal WebSocket communication
 */
export interface TerminalMessage {
  type: TerminalMessageType;
  data?: string;
  exitCode?: number;
  signal?: number;
  cols?: number;
  rows?: number;
}

/**
 * Server → Client: Terminal output data
 */
export interface TerminalDataMessage {
  type: 'terminal:data';
  data: string;  // ANSI-formatted terminal output
}

/**
 * Server → Client: Process exit notification
 */
export interface TerminalExitMessage {
  type: 'terminal:exit';
  exitCode: number;
  signal?: number;
}

/**
 * Client → Server: User typed input
 */
export interface TerminalInputMessage {
  type: 'terminal:input';
  data: string;  // User keystrokes
}

/**
 * Client → Server: Terminal window resized
 */
export interface TerminalResizeMessage {
  type: 'terminal:resize';
  cols: number;
  rows: number;
}

/**
 * Terminal Transport
 *
 * Bridges WebSocket connection and PTY process for interactive terminal sessions.
 * Handles bidirectional data flow and connection lifecycle.
 *
 * @example
 * ```typescript
 * const transport = new TerminalTransport(ws, ptyProcess);
 *
 * // Transport automatically:
 * // - Forwards PTY output to WebSocket
 * // - Forwards WebSocket input to PTY
 * // - Handles resize events
 * // - Manages connection lifecycle
 *
 * // Clean up when done
 * transport.close();
 * ```
 */
export class TerminalTransport {
  private ws: WebSocket;
  private process: ManagedPtyProcess;
  private isAlive = true;

  constructor(ws: WebSocket, process: ManagedPtyProcess) {
    this.ws = ws;
    this.process = process;
    this.setupHandlers();
  }

  /**
   * Set up bidirectional message handlers
   */
  private setupHandlers(): void {
    // Forward PTY output to WebSocket
    this.process.onData((data) => {
      if (this.isAlive) {
        this.send({
          type: 'terminal:data',
          data,
        });
      }
    });

    // Handle PTY exit
    this.process.onExit((exitCode, signal) => {
      if (this.isAlive) {
        this.send({
          type: 'terminal:exit',
          exitCode,
          signal,
        });
      }
    });

    // Handle WebSocket messages (input from client)
    this.ws.on('message', (rawMessage) => {
      try {
        const message: TerminalMessage = JSON.parse(rawMessage.toString());
        this.handleClientMessage(message);
      } catch (error) {
        console.error('Failed to parse terminal message:', error);
      }
    });

    // Handle WebSocket close
    this.ws.on('close', () => {
      this.isAlive = false;
      // Note: We don't auto-terminate the PTY here
      // That's handled by the session manager
    });

    // Handle WebSocket error
    this.ws.on('error', (error) => {
      console.error('Terminal WebSocket error:', error);
      this.isAlive = false;
    });
  }

  /**
   * Handle incoming message from WebSocket client
   */
  private handleClientMessage(message: TerminalMessage): void {
    switch (message.type) {
      case 'terminal:input':
        if (message.data) {
          this.process.write(message.data);
        }
        break;

      case 'terminal:resize':
        if (message.cols && message.rows) {
          this.process.resize(message.cols, message.rows);
        }
        break;

      default:
        console.warn('Unknown terminal message type:', message.type);
    }
  }

  /**
   * Send message to WebSocket client
   */
  private send(message: TerminalMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send terminal message:', error);
      }
    }
  }

  /**
   * Close the transport and clean up
   */
  close(): void {
    this.isAlive = false;
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) {
      this.ws.close();
    }
  }

  /**
   * Check if transport is still alive
   */
  get alive(): boolean {
    return this.isAlive;
  }
}
