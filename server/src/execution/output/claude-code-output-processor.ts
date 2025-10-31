/**
 * Claude Code Output Processor
 *
 * Implements the IOutputProcessor interface specifically for parsing
 * Claude Code's stream-json output format in real-time.
 *
 * This processor is tailored to Claude Code's CLI output and handles its
 * specific message structure, tool calling patterns, and metadata format.
 *
 * @module execution/output/claude-code-output-processor
 */

import type {
  IOutputProcessor,
  OutputMessage,
  ProcessingMetrics,
  ToolCall,
  FileChange,
  ToolCallHandler,
  FileChangeHandler,
  ProgressHandler,
  ErrorHandler,
  MessageType,
} from "./types.js";

/**
 * ClaudeCodeOutputProcessor - Parses Claude Code's stream-json output
 *
 * This processor is specifically designed for Claude Code's output format.
 * It handles line-by-line parsing of Claude's stream-json messages,
 * extracting tool calls, file changes, and usage metrics in real-time.
 *
 * **Claude Code Specific Features:**
 * - Parses Claude's message.content array structure
 * - Handles tool_use and tool_result content types
 * - Extracts usage metrics from result messages
 * - Processes Claude-specific error formats
 *
 * @example
 * ```typescript
 * const processor = new ClaudeCodeOutputProcessor();
 *
 * processor.onToolCall((toolCall) => {
 *   console.log(`Claude called tool: ${toolCall.name}`, toolCall.input);
 * });
 *
 * // Process Claude Code's stream-json output
 * await processor.processLine('{"type":"assistant","message":{"content":[...]}}');
 * const metrics = processor.getMetrics();
 * ```
 */
export class ClaudeCodeOutputProcessor implements IOutputProcessor {
  // Internal state
  private _metrics: ProcessingMetrics;
  private _toolCalls: Map<string, ToolCall>;
  private _fileChanges: FileChange[];

  // Event handlers
  private _toolCallHandlers: ToolCallHandler[] = [];
  private _fileChangeHandlers: FileChangeHandler[] = [];
  private _progressHandlers: ProgressHandler[] = [];
  private _errorHandlers: ErrorHandler[] = [];

  // Processing state
  private _lineNumber = 0;

  constructor() {
    // Initialize metrics with empty state
    this._metrics = {
      totalMessages: 0,
      toolCalls: [],
      fileChanges: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        cost: 0,
        provider: "anthropic",
        model: "claude", // Will be updated when we parse actual model info
      },
      errors: [],
      startedAt: new Date(),
      lastUpdate: new Date(),
    };

    this._toolCalls = new Map();
    this._fileChanges = [];
  }

  /**
   * Process a single line of Claude Code's stream-json output
   *
   * Parses the JSON line and routes to appropriate handler based on message type.
   * Handles malformed JSON gracefully and skips empty lines.
   *
   * @param line - Raw JSON line from Claude Code CLI output
   */
  async processLine(line: string): Promise<void> {
    this._lineNumber++;

    // Skip empty lines
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      // Parse JSON
      const data = JSON.parse(trimmed);

      // Detect message type (Claude-specific structure)
      const messageType = this._detectMessageType(data);

      // Create OutputMessage
      const message: OutputMessage = this._parseMessage(data, messageType);

      // Update metrics
      this._metrics.totalMessages++;
      this._metrics.lastUpdate = new Date();

      // Route to message-specific handlers
      switch (message.type) {
        case "tool_use":
          this._handleToolUse(message);
          break;
        case "tool_result":
          this._handleToolResult(message);
          break;
        case "text":
          this._handleText(message);
          break;
        case "usage":
          this._handleUsage(message);
          break;
        case "error":
          this._handleError(message);
          break;
        case "unknown":
          // Already tracked in metrics, no special handling needed
          break;
      }

      // Emit progress event
      this._emitProgress();
    } catch (error) {
      // Handle malformed JSON
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorInfo = {
        message: `Failed to parse Claude Code output line ${this._lineNumber}: ${errorMessage}`,
        timestamp: new Date(),
        details: {
          line: trimmed,
          error: errorMessage,
          lineNumber: this._lineNumber,
        },
      };

      this._metrics.errors.push(errorInfo);
      this._emitError(errorInfo);
    }
  }

  /**
   * Get current processing metrics
   *
   * @returns Current aggregate metrics
   */
  getMetrics(): ProcessingMetrics {
    return {
      ...this._metrics,
      // Return current arrays (not references to internal state)
      toolCalls: [...this._metrics.toolCalls],
      fileChanges: [...this._metrics.fileChanges],
      errors: [...this._metrics.errors],
    };
  }

  /**
   * Get all tool calls recorded during processing
   *
   * @returns Array of all tool calls
   */
  getToolCalls(): ToolCall[] {
    return Array.from(this._toolCalls.values());
  }

  /**
   * Get all file changes detected during processing
   *
   * @returns Array of all file changes
   */
  getFileChanges(): FileChange[] {
    return [...this._fileChanges];
  }

  /**
   * Register a callback for tool call events
   *
   * @param handler - Function to call when a tool is invoked
   */
  onToolCall(handler: ToolCallHandler): void {
    this._toolCallHandlers.push(handler);
  }

  /**
   * Register a callback for file change events
   *
   * @param handler - Function to call when a file is modified
   */
  onFileChange(handler: FileChangeHandler): void {
    this._fileChangeHandlers.push(handler);
  }

  /**
   * Register a callback for progress update events
   *
   * @param handler - Function to call when metrics are updated
   */
  onProgress(handler: ProgressHandler): void {
    this._progressHandlers.push(handler);
  }

  /**
   * Register a callback for error events
   *
   * @param handler - Function to call when an error occurs
   */
  onError(handler: ErrorHandler): void {
    this._errorHandlers.push(handler);
  }

  // ============================================================================
  // Query Methods - Data Aggregation and Filtering
  // ============================================================================

  /**
   * Get tool calls filtered by tool name
   *
   * @param toolName - Name of the tool to filter by (e.g., 'Bash', 'Read', 'Write')
   * @returns Array of tool calls matching the tool name
   *
   * @example
   * ```typescript
   * const bashCalls = processor.getToolCallsByName('Bash');
   * console.log(`Executed ${bashCalls.length} bash commands`);
   * ```
   */
  getToolCallsByName(toolName: string): ToolCall[] {
    return this.getToolCalls().filter((call) => call.name === toolName);
  }

  /**
   * Get file changes filtered by file path
   *
   * @param path - File path to filter by (exact match)
   * @returns Array of file changes to the specified path
   *
   * @example
   * ```typescript
   * const changes = processor.getFileChangesByPath('src/index.ts');
   * console.log(`File modified ${changes.length} times`);
   * ```
   */
  getFileChangesByPath(path: string): FileChange[] {
    return this.getFileChanges().filter((change) => change.path === path);
  }

  /**
   * Get file changes filtered by operation type
   *
   * @param operation - Operation type to filter by ('read', 'write', 'edit')
   * @returns Array of file changes with the specified operation
   *
   * @example
   * ```typescript
   * const writes = processor.getFileChangesByOperation('write');
   * console.log(`Wrote to ${writes.length} files`);
   * ```
   */
  getFileChangesByOperation(
    operation: "read" | "write" | "edit"
  ): FileChange[] {
    return this.getFileChanges().filter(
      (change) => change.operation === operation
    );
  }

  /**
   * Get only failed tool calls
   *
   * @returns Array of tool calls with status='error'
   *
   * @example
   * ```typescript
   * const failures = processor.getFailedToolCalls();
   * failures.forEach(call => {
   *   console.error(`${call.name} failed:`, call.error);
   * });
   * ```
   */
  getFailedToolCalls(): ToolCall[] {
    return this.getToolCalls().filter((call) => call.status === "error");
  }

  /**
   * Get only successful tool calls
   *
   * @returns Array of tool calls with status='success'
   *
   * @example
   * ```typescript
   * const successes = processor.getSuccessfulToolCalls();
   * console.log(`${successes.length} tool calls succeeded`);
   * ```
   */
  getSuccessfulToolCalls(): ToolCall[] {
    return this.getToolCalls().filter((call) => call.status === "success");
  }

  /**
   * Get total cost of execution in USD
   *
   * @returns Total cost based on token usage
   *
   * @example
   * ```typescript
   * const cost = processor.getTotalCost();
   * console.log(`Execution cost: $${cost.toFixed(2)}`);
   * ```
   */
  getTotalCost(): number {
    return this._metrics.usage.cost || 0;
  }

  /**
   * Get execution summary with aggregate statistics
   *
   * Provides a high-level overview of the execution including:
   * - Tool call counts by type
   * - File operation counts by type
   * - Success rates
   * - Token usage and costs
   * - Duration
   *
   * @returns Complete execution summary
   *
   * @example
   * ```typescript
   * const summary = processor.getExecutionSummary();
   * console.log('Execution Summary:', {
   *   duration: `${summary.duration}ms`,
   *   cost: `$${summary.totalCost.toFixed(2)}`,
   *   successRate: `${summary.successRate.toFixed(1)}%`,
   *   toolCalls: summary.toolCallsByType,
   * });
   * ```
   */
  getExecutionSummary(): import("./types.js").ExecutionSummary {
    const toolCalls = this.getToolCalls();
    const fileChanges = this.getFileChanges();

    // Calculate tool calls by type
    const toolCallsByType: Record<string, number> = {};
    for (const call of toolCalls) {
      toolCallsByType[call.name] = (toolCallsByType[call.name] || 0) + 1;
    }

    // Calculate file operations by type
    const fileOperationsByType: Record<string, number> = {};
    for (const change of fileChanges) {
      fileOperationsByType[change.operation] =
        (fileOperationsByType[change.operation] || 0) + 1;
    }

    // Calculate success rate
    const completedCalls = toolCalls.filter(
      (call) => call.status === "success" || call.status === "error"
    );
    const successfulCalls = toolCalls.filter(
      (call) => call.status === "success"
    );
    const successRate =
      completedCalls.length > 0
        ? (successfulCalls.length / completedCalls.length) * 100
        : 0;

    // Calculate duration
    const endTime = this._metrics.endedAt || new Date();
    const duration = endTime.getTime() - this._metrics.startedAt.getTime();

    return {
      totalMessages: this._metrics.totalMessages,
      toolCallsByType,
      fileOperationsByType,
      successRate,
      totalTokens: {
        input: this._metrics.usage.inputTokens,
        output: this._metrics.usage.outputTokens,
        cache: this._metrics.usage.cacheTokens,
      },
      totalCost: this._metrics.usage.cost || 0,
      duration,
      startTime: this._metrics.startedAt,
      endTime: this._metrics.endedAt,
    };
  }

  // ============================================================================
  // Private methods - Message Type Handlers
  // ============================================================================

  /**
   * Handle tool_use message from Claude Code
   *
   * Creates a new ToolCall entry with pending status and emits onToolCall event.
   * Also detects potential file operations based on tool name.
   *
   * @param message - Parsed tool_use message
   */
  private _handleToolUse(message: OutputMessage): void {
    if (message.type !== "tool_use") return;

    const toolCall: ToolCall = {
      id: message.id,
      name: message.name,
      input: message.input,
      status: "pending",
      timestamp: message.timestamp,
    };

    // Store in map for fast lookup
    this._toolCalls.set(toolCall.id, toolCall);

    // Update metrics
    this._metrics.toolCalls.push(toolCall);

    // Emit tool call event
    for (const handler of this._toolCallHandlers) {
      try {
        handler(toolCall);
      } catch (error) {
        console.error("Tool call handler error:", error);
      }
    }
  }

  /**
   * Handle tool_result message from Claude Code
   *
   * Updates the corresponding ToolCall with result/error status.
   * Detects file changes from Read/Write/Edit tools and emits onFileChange event.
   *
   * @param message - Parsed tool_result message
   */
  private _handleToolResult(message: OutputMessage): void {
    if (message.type !== "tool_result") return;

    // Find the corresponding tool call
    const toolCall = this._toolCalls.get(message.toolUseId);
    if (!toolCall) {
      // Tool call not found - might be from before we started processing
      return;
    }

    // Update tool call status
    toolCall.status = message.isError ? "error" : "success";
    toolCall.result = message.result;
    toolCall.error = message.isError ? String(message.result) : undefined;
    toolCall.completedAt = message.timestamp;

    // Detect file changes from file operation tools
    const fileOperationTools = ["Read", "Write", "Edit", "Glob"];
    if (fileOperationTools.includes(toolCall.name)) {
      const fileChange = this._detectFileChange(toolCall, message);
      if (fileChange) {
        this._fileChanges.push(fileChange);
        this._metrics.fileChanges.push(fileChange);

        // Emit file change event
        for (const handler of this._fileChangeHandlers) {
          try {
            handler(fileChange);
          } catch (error) {
            console.error("File change handler error:", error);
          }
        }
      }
    }
  }

  /**
   * Handle text message from Claude Code
   *
   * Text messages are already tracked in metrics, no special handling needed.
   *
   * @param message - Parsed text message
   */
  private _handleText(message: OutputMessage): void {
    if (message.type !== "text") return;
    // Text messages are already counted in totalMessages
    // No additional processing needed
  }

  /**
   * Handle usage message from Claude Code
   *
   * Updates usage metrics with token counts and calculates cost.
   *
   * @param message - Parsed usage message
   */
  private _handleUsage(message: OutputMessage): void {
    if (message.type !== "usage") return;

    // Aggregate usage metrics
    this._metrics.usage.inputTokens += message.tokens.input;
    this._metrics.usage.outputTokens += message.tokens.output;
    this._metrics.usage.cacheTokens += message.tokens.cache;
    this._metrics.usage.totalTokens =
      this._metrics.usage.inputTokens + this._metrics.usage.outputTokens;

    // Calculate cost (Claude Sonnet 4 pricing as of 2025)
    // Input: $3/million tokens, Output: $15/million tokens, Cache: $0.30/million tokens
    const inputCost = (this._metrics.usage.inputTokens / 1_000_000) * 3.0;
    const outputCost = (this._metrics.usage.outputTokens / 1_000_000) * 15.0;
    const cacheCost = (this._metrics.usage.cacheTokens / 1_000_000) * 0.3;
    this._metrics.usage.cost = inputCost + outputCost + cacheCost;
  }

  /**
   * Handle error message from Claude Code
   *
   * Tracks error in metrics and emits onError event.
   *
   * @param message - Parsed error message
   */
  private _handleError(message: OutputMessage): void {
    if (message.type !== "error") return;

    const errorInfo = {
      message: message.message,
      timestamp: message.timestamp,
      details: message.details,
    };

    // Already added to metrics.errors in processLine's catch block if it's a parse error
    // Add this error if it's from Claude Code itself
    if (!this._metrics.errors.find((e) => e.timestamp === message.timestamp)) {
      this._metrics.errors.push(errorInfo);
    }

    // Emit error event
    this._emitError(errorInfo);
  }

  /**
   * Detect file change from a tool call
   *
   * Analyzes tool calls to file operation tools (Read/Write/Edit) and
   * extracts file change information.
   *
   * @param toolCall - The completed tool call
   * @param message - The tool result message
   * @returns FileChange object if file operation detected, null otherwise
   */
  private _detectFileChange(
    toolCall: ToolCall,
    message: OutputMessage
  ): FileChange | null {
    // Extract file path from tool input
    const filePath = toolCall.input.file_path || toolCall.input.path;
    if (!filePath || typeof filePath !== "string") {
      return null;
    }

    // Map tool name to operation
    let operation: FileChange["operation"];
    switch (toolCall.name) {
      case "Read":
      case "Glob": // Glob reads files too
        operation = "read";
        break;
      case "Write":
        operation = "write";
        break;
      case "Edit":
        operation = "edit";
        break;
      default:
        return null;
    }

    return {
      path: filePath,
      operation,
      timestamp: message.timestamp,
      toolCallId: toolCall.id,
      metadata: {
        toolName: toolCall.name,
        success: toolCall.status === "success",
      },
    };
  }

  // ============================================================================
  // Private methods - Claude Code Specific Parsing
  // ============================================================================

  /**
   * Detect the type of message from parsed Claude Code JSON data
   *
   * Claude Code uses a specific structure with type and message.content fields.
   * This method understands Claude's output format.
   *
   * @param data - Parsed JSON object from Claude Code
   * @returns Message type
   */
  private _detectMessageType(data: any): MessageType {
    // Check for explicit type field
    if (data.type === "error") {
      return "error";
    }

    // Check for result message (contains usage information)
    if (data.type === "result" && data.usage) {
      return "usage";
    }

    // Check message content for tool_use or tool_result
    // Claude structures content as an array or single object
    if (data.message?.content) {
      const content = Array.isArray(data.message.content)
        ? data.message.content[0]
        : data.message.content;

      if (content?.type === "tool_use") {
        return "tool_use";
      }

      if (content?.type === "tool_result") {
        return "tool_result";
      }

      // Text content
      if (typeof content === "string" || content?.type === "text") {
        return "text";
      }
    }

    // Default to unknown
    return "unknown";
  }

  /**
   * Parse raw Claude Code JSON data into an OutputMessage
   *
   * @param data - Parsed JSON object from Claude Code
   * @param type - Detected message type
   * @returns Structured OutputMessage
   */
  private _parseMessage(data: any, type: MessageType): OutputMessage {
    const timestamp = new Date();

    switch (type) {
      case "text": {
        const content = this._extractTextContent(data);
        return {
          type: "text",
          content,
          timestamp,
          metadata: { raw: data, source: "claude-code" },
        };
      }

      case "tool_use": {
        const toolUse = this._extractToolUse(data);
        return {
          type: "tool_use",
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
          timestamp,
          metadata: { raw: data, source: "claude-code" },
        };
      }

      case "tool_result": {
        const toolResult = this._extractToolResult(data);
        return {
          type: "tool_result",
          toolUseId: toolResult.toolUseId,
          result: toolResult.result,
          isError: toolResult.isError,
          timestamp,
          metadata: { raw: data, source: "claude-code" },
        };
      }

      case "usage": {
        const usage = this._extractUsage(data);
        return {
          type: "usage",
          tokens: usage,
          timestamp,
          metadata: { raw: data, source: "claude-code" },
        };
      }

      case "error": {
        return {
          type: "error",
          message: data.error?.message || data.message || "Unknown error",
          details: data.error || data,
          timestamp,
          metadata: { raw: data, source: "claude-code" },
        };
      }

      case "unknown":
      default: {
        return {
          type: "unknown",
          raw: JSON.stringify(data),
          timestamp,
          metadata: { raw: data, source: "claude-code" },
        };
      }
    }
  }

  /**
   * Extract text content from Claude Code message data
   *
   * Claude can return content as a string or an array of content blocks.
   * This method handles both formats.
   */
  private _extractTextContent(data: any): string {
    if (typeof data.message?.content === "string") {
      return data.message.content;
    }

    if (Array.isArray(data.message?.content)) {
      const textContent = data.message.content
        .filter((item: any) => item.type === "text" || typeof item === "string")
        .map((item: any) => (typeof item === "string" ? item : item.text))
        .join("");
      return textContent;
    }

    return "";
  }

  /**
   * Extract tool use information from Claude Code message data
   *
   * Claude includes tool_use blocks in the message.content array.
   */
  private _extractToolUse(data: any): {
    id: string;
    name: string;
    input: Record<string, any>;
  } {
    const content = Array.isArray(data.message?.content)
      ? data.message.content.find((c: any) => c.type === "tool_use")
      : data.message?.content;

    return {
      id: content?.id || "unknown",
      name: content?.name || "unknown",
      input: content?.input || {},
    };
  }

  /**
   * Extract tool result information from Claude Code message data
   *
   * Claude includes tool_result blocks with execution results.
   */
  private _extractToolResult(data: any): {
    toolUseId: string;
    result: any;
    isError: boolean;
  } {
    const content = Array.isArray(data.message?.content)
      ? data.message.content.find((c: any) => c.type === "tool_result")
      : data.message?.content;

    return {
      toolUseId: content?.tool_use_id || "unknown",
      result: content?.content || content?.result || null,
      isError: content?.is_error || false,
    };
  }

  /**
   * Extract usage information from Claude Code result message
   *
   * Claude provides token usage in result messages with detailed breakdowns.
   */
  private _extractUsage(data: any): {
    input: number;
    output: number;
    cache: number;
  } {
    const usage = data.usage || {};
    return {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cache:
        usage.cache_creation_input_tokens || usage.cache_read_input_tokens || 0,
    };
  }

  /**
   * Emit progress event to all registered handlers
   */
  private _emitProgress(): void {
    const metrics = this.getMetrics();
    for (const handler of this._progressHandlers) {
      try {
        handler(metrics);
      } catch (error) {
        // Ignore handler errors to prevent cascade failures
        console.error("Progress handler error:", error);
      }
    }
  }

  /**
   * Emit error event to all registered handlers
   */
  private _emitError(error: {
    message: string;
    timestamp: Date;
    details?: any;
  }): void {
    for (const handler of this._errorHandlers) {
      try {
        handler(error);
      } catch (handlerError) {
        // Ignore handler errors to prevent cascade failures
        console.error("Error handler error:", handlerError);
      }
    }
  }
}
