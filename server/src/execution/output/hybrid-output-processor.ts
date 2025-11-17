/**
 * Hybrid Output Processor
 *
 * Extends ClaudeCodeOutputProcessor to support hybrid execution mode.
 * Provides structured JSON event parsing from PTY output mixed with raw terminal data.
 *
 * In hybrid mode:
 * - PTY process runs with `--output-format stream-json`
 * - Output contains BOTH JSON lines AND raw terminal output (prompts, progress, etc.)
 * - TerminalTransport (separate) forwards ALL PTY output to WebSocket
 * - HybridOutputProcessor extracts JSON lines for structured processing
 *
 * **Architecture:**
 * ```
 * PTY Process (--output-format stream-json)
 *    ├─> TerminalTransport → WebSocket → Client (ALL output, raw)
 *    └─> HybridOutputProcessor → Line Buffer
 *          ├─> JSON Detection
 *          │     ├─> Valid JSON → Parse → Parent Class → Database/SSE
 *          │     └─> Invalid JSON → Log warning, continue
 *          └─> Non-JSON → Skip (already shown in terminal)
 * ```
 *
 * @module execution/output/hybrid-output-processor
 */

import { ClaudeCodeOutputProcessor } from './claude-code-output-processor.js';

/**
 * Hybrid Output Processor
 *
 * Extends ClaudeCodeOutputProcessor with line-buffered processing for PTY output.
 * Extracts and parses JSON events from mixed PTY output (JSON + raw terminal data).
 *
 * **Key Features:**
 * - Line-buffered processing for proper JSON detection
 * - JSON lines → parsed as structured events (via parent class)
 * - Non-JSON lines → ignored (already shown in terminal)
 * - Graceful handling of malformed JSON
 * - No blocking on parse errors
 *
 * **Usage Pattern:**
 * The process manager calls `processOutput()` for each chunk of PTY data.
 * The HybridOutputProcessor buffers by lines and extracts JSON for structured processing.
 * Terminal forwarding is handled separately by TerminalTransport.
 *
 * @example
 * ```typescript
 * const processor = new HybridOutputProcessor();
 *
 * // Process mixed output (JSON + raw terminal)
 * processor.processOutput(Buffer.from('{"type":"result",...}\n'), 'stdout');
 * processor.processOutput(Buffer.from('Loading project...\n'), 'stdout');
 * processor.processOutput(Buffer.from('{"type":"tool_use",...}\n'), 'stdout');
 *
 * // JSON lines → parsed and stored in DB
 * // Non-JSON lines → ignored (shown in terminal via TerminalTransport)
 * ```
 */
export class HybridOutputProcessor extends ClaudeCodeOutputProcessor {
  private lineBuffer = '';

  /**
   * Process output from PTY with line buffering and JSON extraction
   *
   * Buffers data by lines, detects JSON lines, and forwards them to
   * the parent class's processLine() method for structured processing.
   *
   * Non-JSON lines are ignored here (they're already forwarded to the
   * terminal WebSocket by TerminalTransport).
   *
   * @param data - Raw output buffer from PTY
   * @param _type - Output stream type (stdout or stderr, currently unused)
   */
  processOutput(data: Buffer, _type: 'stdout' | 'stderr'): void {
    const text = data.toString();

    // Line-buffered processing
    this.lineBuffer += text;
    const lines = this.lineBuffer.split('\n');

    // Keep the last incomplete line in buffer
    this.lineBuffer = lines.pop() || '';

    // Process each complete line
    for (const line of lines) {
      // Check if line looks like JSON before attempting parse
      if (this.looksLikeJSON(line)) {
        this.attemptJSONParse(line);
      }
      // Non-JSON lines are skipped for structured processing
      // (they're already visible in the terminal view)
    }
  }

  /**
   * Check if a line looks like JSON
   *
   * Fast heuristic check before expensive JSON.parse().
   * Looks for lines that start with '{' and end with '}'.
   *
   * @param line - Line of text to check
   * @returns True if line appears to be JSON
   */
  private looksLikeJSON(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('{') && trimmed.endsWith('}');
  }

  /**
   * Attempt to parse JSON and forward to parent class
   *
   * Tries to parse the line as JSON and process it using the parent
   * class's processLine method. Handles parse errors gracefully.
   *
   * @param line - Line that appears to be JSON
   */
  private attemptJSONParse(line: string): void {
    try {
      // Validate it's actually JSON by parsing
      JSON.parse(line);

      // If parse succeeded, forward to parent class for structured processing
      // Parent class (ClaudeCodeOutputProcessor) will:
      // - Extract tool calls
      // - Track file changes
      // - Update usage metrics
      // - Emit events
      this.processLine(line).catch((error) => {
        // processLine is async, so we catch errors here
        console.warn('[HybridProcessor] Failed to process JSON line:', error);
      });
    } catch (error) {
      // JSON parse failed - log but continue processing
      // This is expected for lines that look like JSON but aren't valid
      console.warn('[HybridProcessor] Failed to parse JSON line:', {
        line: line.substring(0, 100), // Truncate for logging
        error: error instanceof Error ? error.message : String(error),
      });

      // Important: We don't throw here. The terminal output stream
      // continues regardless of JSON parse failures.
    }
  }

  /**
   * Flush any remaining buffered data
   *
   * Call this when the process exits to ensure the last incomplete
   * line is processed if it's valid JSON.
   */
  flush(): void {
    if (this.lineBuffer.trim()) {
      // Try to process the remaining buffer as JSON
      if (this.looksLikeJSON(this.lineBuffer)) {
        this.attemptJSONParse(this.lineBuffer);
      }
      this.lineBuffer = '';
    }
  }
}
