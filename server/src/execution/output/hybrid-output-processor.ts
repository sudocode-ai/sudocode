/**
 * Hybrid Output Processor
 *
 * Processes terminal output in hybrid mode where the stream contains both:
 * - Interactive terminal data (ANSI codes, user prompts, etc.)
 * - Structured JSON messages (stream-json format from Claude Code)
 *
 * This processor extracts JSON lines from the terminal stream and parses them
 * using ClaudeCodeOutputProcessor, while also forwarding all raw terminal data.
 *
 * @module execution/output/hybrid-output-processor
 */

import { ClaudeCodeOutputProcessor } from './claude-code-output-processor.js';
import type {
  ProcessingMetrics,
  ToolCall,
  FileChange,
  ToolCallHandler,
  FileChangeHandler,
  ProgressHandler,
  ErrorHandler,
  MessageHandler,
  UsageHandler,
} from './types.js';

/**
 * Handler for raw terminal data
 */
export type TerminalDataHandler = (data: string) => void;

/**
 * HybridOutputProcessor
 *
 * Handles dual-mode output where we need both:
 * 1. Raw terminal data for display in xterm.js
 * 2. Structured JSON parsing for execution tracking
 *
 * The processor maintains a line buffer and attempts to extract JSON messages
 * from complete lines, while forwarding all data to terminal handlers.
 *
 * @example
 * ```typescript
 * const processor = new HybridOutputProcessor();
 *
 * // Register handlers for structured data
 * processor.onToolCall((toolCall) => {
 *   console.log('Tool called:', toolCall.name);
 * });
 *
 * // Register handler for terminal display
 * processor.onTerminalData((data) => {
 *   terminal.write(data);
 * });
 *
 * // Process terminal stream
 * ptyProcess.onData((data) => {
 *   processor.processTerminalData(data);
 * });
 * ```
 */
export class HybridOutputProcessor {
  private jsonProcessor: ClaudeCodeOutputProcessor;
  private lineBuffer: string = '';
  private terminalDataHandlers: TerminalDataHandler[] = [];

  constructor() {
    this.jsonProcessor = new ClaudeCodeOutputProcessor();
  }

  /**
   * Process raw terminal data
   *
   * This is the main entry point for hybrid processing:
   * 1. Forwards all data to terminal handlers (for display)
   * 2. Buffers data by lines
   * 3. Attempts to parse JSON from complete lines
   * 4. Emits structured events when JSON is found
   *
   * @param data - Raw terminal output (may contain ANSI codes, partial lines, etc.)
   */
  async processTerminalData(data: string): Promise<void> {
    // Always forward raw data to terminal handlers first
    this._emitTerminalData(data);

    // Add to line buffer
    this.lineBuffer += data;

    // Process complete lines
    await this._processBufferedLines();
  }

  /**
   * Process buffered lines, extracting and parsing JSON
   *
   * Splits buffer by newlines, attempts to parse each complete line as JSON,
   * and forwards successful parses to the JSON processor.
   */
  private async _processBufferedLines(): Promise<void> {
    const lines = this.lineBuffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.lineBuffer = lines.pop() || '';

    // Process each complete line
    for (const line of lines) {
      await this._processLine(line);
    }
  }

  /**
   * Process a single line, checking if it contains JSON
   *
   * Attempts to detect and parse JSON from the line. If successful,
   * forwards to ClaudeCodeOutputProcessor. If it's not JSON, silently ignores
   * (it's just terminal output).
   *
   * @param line - Complete line from terminal output
   */
  private async _processLine(line: string): Promise<void> {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      return;
    }

    // Check if line looks like JSON (starts with { or [)
    if (!this._looksLikeJson(trimmed)) {
      return;
    }

    // Attempt to parse as JSON and forward to processor
    try {
      // Validate it's actually valid JSON
      JSON.parse(trimmed);

      // Forward to JSON processor
      await this.jsonProcessor.processLine(trimmed);
    } catch (error) {
      // Not JSON or malformed - that's okay, just terminal output
      // Don't log errors here as most lines won't be JSON
    }
  }

  /**
   * Quick heuristic check if a line might contain JSON
   *
   * @param line - Trimmed line to check
   * @returns true if line might be JSON
   */
  private _looksLikeJson(line: string): boolean {
    // JSON messages from Claude Code start with {
    return line.startsWith('{');
  }

  /**
   * Emit raw terminal data to all registered handlers
   *
   * @param data - Raw terminal data
   */
  private _emitTerminalData(data: string): void {
    for (const handler of this.terminalDataHandlers) {
      try {
        handler(data);
      } catch (error) {
        console.error('[hybrid-processor] Terminal data handler error:', error);
      }
    }
  }

  // ============================================================================
  // Event Registration - Structured Data Events
  // ============================================================================

  /**
   * Register a callback for tool call events
   *
   * @param handler - Function to call when a tool is invoked
   */
  onToolCall(handler: ToolCallHandler): void {
    this.jsonProcessor.onToolCall(handler);
  }

  /**
   * Register a callback for file change events
   *
   * @param handler - Function to call when a file is modified
   */
  onFileChange(handler: FileChangeHandler): void {
    this.jsonProcessor.onFileChange(handler);
  }

  /**
   * Register a callback for progress update events
   *
   * @param handler - Function to call when metrics are updated
   */
  onProgress(handler: ProgressHandler): void {
    this.jsonProcessor.onProgress(handler);
  }

  /**
   * Register a callback for error events
   *
   * @param handler - Function to call when an error occurs
   */
  onError(handler: ErrorHandler): void {
    this.jsonProcessor.onError(handler);
  }

  /**
   * Register a callback for message events
   *
   * @param handler - Function to call when a text message is received
   */
  onMessage(handler: MessageHandler): void {
    this.jsonProcessor.onMessage(handler);
  }

  /**
   * Register a callback for usage metric updates
   *
   * @param handler - Function to call when usage metrics are updated
   */
  onUsage(handler: UsageHandler): void {
    this.jsonProcessor.onUsage(handler);
  }

  /**
   * Register a callback for terminal data events
   *
   * This is unique to hybrid mode - it forwards all raw terminal output
   * for display in xterm.js or other terminal emulators.
   *
   * @param handler - Function to call with raw terminal data
   */
  onTerminalData(handler: TerminalDataHandler): void {
    this.terminalDataHandlers.push(handler);
  }

  // ============================================================================
  // Query Methods - Delegate to JSON Processor
  // ============================================================================

  /**
   * Get current processing metrics
   *
   * @returns Current aggregate metrics from structured data parsing
   */
  getMetrics(): ProcessingMetrics {
    return this.jsonProcessor.getMetrics();
  }

  /**
   * Get all tool calls recorded during processing
   *
   * @returns Array of all tool calls
   */
  getToolCalls(): ToolCall[] {
    return this.jsonProcessor.getToolCalls();
  }

  /**
   * Get all file changes detected during processing
   *
   * @returns Array of all file changes
   */
  getFileChanges(): FileChange[] {
    return this.jsonProcessor.getFileChanges();
  }

  /**
   * Get tool calls filtered by tool name
   *
   * @param toolName - Name of the tool to filter by
   * @returns Array of tool calls matching the tool name
   */
  getToolCallsByName(toolName: string): ToolCall[] {
    return this.jsonProcessor.getToolCallsByName(toolName);
  }

  /**
   * Get file changes filtered by file path
   *
   * @param path - File path to filter by
   * @returns Array of file changes to the specified path
   */
  getFileChangesByPath(path: string): FileChange[] {
    return this.jsonProcessor.getFileChangesByPath(path);
  }

  /**
   * Get file changes filtered by operation type
   *
   * @param operation - Operation type to filter by
   * @returns Array of file changes with the specified operation
   */
  getFileChangesByOperation(operation: 'read' | 'write' | 'edit'): FileChange[] {
    return this.jsonProcessor.getFileChangesByOperation(operation);
  }

  /**
   * Get only failed tool calls
   *
   * @returns Array of tool calls with status='error'
   */
  getFailedToolCalls(): ToolCall[] {
    return this.jsonProcessor.getFailedToolCalls();
  }

  /**
   * Get only successful tool calls
   *
   * @returns Array of tool calls with status='success'
   */
  getSuccessfulToolCalls(): ToolCall[] {
    return this.jsonProcessor.getSuccessfulToolCalls();
  }

  /**
   * Get total cost of execution in USD
   *
   * @returns Total cost based on token usage
   */
  getTotalCost(): number {
    return this.jsonProcessor.getTotalCost();
  }

  /**
   * Get execution summary with aggregate statistics
   *
   * @returns Complete execution summary
   */
  getExecutionSummary() {
    return this.jsonProcessor.getExecutionSummary();
  }

  /**
   * Flush any remaining buffered data
   *
   * Should be called when the process exits to ensure all data is processed.
   */
  async flush(): Promise<void> {
    if (this.lineBuffer.trim()) {
      await this._processLine(this.lineBuffer);
      this.lineBuffer = '';
    }
  }
}
