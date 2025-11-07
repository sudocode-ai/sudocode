/**
 * Terminal Transport
 *
 * Manages bidirectional communication between WebSocket client and PTY process.
 * Enables real-time terminal interaction with ANSI support and proper sizing.
 *
 * Supports two modes:
 * - Interactive: Pure terminal forwarding (no structured parsing)
 * - Hybrid: Terminal forwarding + JSON parsing for structured data
 *
 * @module execution/transport/terminal-transport
 */

import type { WebSocket } from 'ws';
import type { ManagedPtyProcess } from '../process/types.js';
import { HybridOutputProcessor } from '../output/hybrid-output-processor.js';

/**
 * Terminal message types for WebSocket protocol
 */
export interface TerminalMessage {
  /** Message type */
  type: 'terminal:data' | 'terminal:exit' | 'terminal:input' | 'terminal:resize' | 'terminal:error';
  /** Terminal output data */
  data?: string;
  /** Exit code (for terminal:exit) */
  exitCode?: number;
  /** Exit signal (for terminal:exit) */
  signal?: number;
  /** Terminal width in columns (for terminal:resize) */
  cols?: number;
  /** Terminal height in rows (for terminal:resize) */
  rows?: number;
  /** Error message (for terminal:error) */
  error?: string;
}

/**
 * Terminal Transport
 *
 * Bridges WebSocket and PTY process for bidirectional terminal I/O.
 * Handles:
 * - Forwarding PTY output to WebSocket client
 * - Forwarding client input to PTY
 * - Terminal resize events
 * - Process exit notifications
 *
 * @example
 * ```typescript
 * import { TerminalTransport } from './terminal-transport.js';
 *
 * const transport = new TerminalTransport(ws, ptyProcess);
 *
 * // Transport automatically handles all I/O
 * // Client will receive terminal output and can send input
 *
 * // Clean up when done
 * transport.close();
 * ```
 */
export class TerminalTransport {
  private ws: WebSocket;
  private process: ManagedPtyProcess;
  private isAlive = true;
  private hybridProcessor?: HybridOutputProcessor;

  /**
   * Create a new terminal transport
   *
   * @param ws - WebSocket connection to client
   * @param process - Managed PTY process
   * @param hybridProcessor - Optional hybrid processor for parsing JSON from terminal stream
   */
  constructor(
    ws: WebSocket,
    process: ManagedPtyProcess,
    hybridProcessor?: HybridOutputProcessor
  ) {
    this.ws = ws;
    this.process = process;
    this.hybridProcessor = hybridProcessor;
    this.setupHandlers();
  }

  /**
   * Set up bidirectional communication handlers
   */
  private setupHandlers(): void {
    // Set up hybrid processing if processor provided
    if (this.hybridProcessor) {
      // Forward terminal data to WebSocket via hybrid processor
      this.hybridProcessor.onTerminalData((data) => {
        if (this.isAlive && this.ws.readyState === this.ws.OPEN) {
          this.send({
            type: 'terminal:data',
            data,
          });
        }
      });

      // Process PTY output through hybrid processor
      this.process.onData((data) => {
        this.hybridProcessor!.processTerminalData(data);
      });
    } else {
      // Pure interactive mode - forward PTY output directly to WebSocket
      this.process.onData((data) => {
        if (this.isAlive && this.ws.readyState === this.ws.OPEN) {
          this.send({
            type: 'terminal:data',
            data,
          });
        }
      });
    }

    // Handle PTY exit
    this.process.onExit(async (exitCode, signal) => {
      // Flush any remaining buffered data in hybrid processor
      if (this.hybridProcessor) {
        await this.hybridProcessor.flush();
      }

      if (this.isAlive && this.ws.readyState === this.ws.OPEN) {
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
        this.sendError('Invalid message format');
      }
    });

    // Handle WebSocket close
    this.ws.on('close', () => {
      this.isAlive = false;
      // Optionally: terminate process when client disconnects
      // Uncomment if you want to kill the process on disconnect:
      // this.process.ptyProcess.kill();
    });

    // Handle WebSocket error
    this.ws.on('error', (error) => {
      console.error('Terminal WebSocket error:', error);
      this.isAlive = false;
    });

    // Send initial connection confirmation
    this.send({
      type: 'terminal:data',
      data: '\r\n\x1b[1;32m[Terminal connected]\x1b[0m\r\n\r\n',
    });
  }

  /**
   * Handle messages from WebSocket client
   *
   * @param message - Terminal message from client
   */
  private handleClientMessage(message: TerminalMessage): void {
    if (!this.isAlive) {
      return;
    }

    switch (message.type) {
      case 'terminal:input':
        // User typed something - send to PTY
        if (message.data) {
          try {
            this.process.write(message.data);
          } catch (error) {
            console.error('Failed to write to PTY:', error);
            this.sendError('Failed to send input to terminal');
          }
        }
        break;

      case 'terminal:resize':
        // Terminal was resized - update PTY
        if (message.cols && message.rows) {
          try {
            this.process.resize(message.cols, message.rows);
          } catch (error) {
            console.error('Failed to resize PTY:', error);
            // Don't send error to client for resize failures
          }
        }
        break;

      default:
        console.warn('Unknown terminal message type:', message.type);
    }
  }

  /**
   * Send a message to the WebSocket client
   *
   * @param message - Terminal message to send
   */
  private send(message: TerminalMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send message to client:', error);
        this.isAlive = false;
      }
    }
  }

  /**
   * Send an error message to the client
   *
   * @param error - Error message
   */
  private sendError(error: string): void {
    this.send({
      type: 'terminal:error',
      error,
    });
  }

  /**
   * Close the transport and clean up
   *
   * Closes the WebSocket connection but does not terminate the PTY process.
   * The process can be kept alive for reconnection or cleanup elsewhere.
   */
  close(): void {
    this.isAlive = false;
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
    }
  }

  /**
   * Close the transport and terminate the PTY process
   *
   * Use this when you want to fully clean up the terminal session.
   */
  closeAndTerminate(): void {
    this.close();
    this.process.ptyProcess.kill();
  }

  /**
   * Check if the transport is alive
   *
   * @returns True if transport is active
   */
  isActive(): boolean {
    return this.isAlive && this.ws.readyState === this.ws.OPEN;
  }

  /**
   * Get the hybrid output processor if available
   *
   * @returns Hybrid processor or undefined if in pure interactive mode
   */
  getHybridProcessor(): HybridOutputProcessor | undefined {
    return this.hybridProcessor;
  }
}
