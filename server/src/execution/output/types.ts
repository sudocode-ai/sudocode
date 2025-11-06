/**
 * Output Processing Layer Types
 *
 * Core types for the Output Processing Layer (Layer 5) that handles
 * real-time parsing and processing of coding agent output.
 *
 * Currently optimized for Claude Code's stream-json format, but designed
 * with extension points for future multi-agent support (Aider, Gemini, Codex, etc.)
 *
 * @module execution/output/types
 */

/**
 * MessageType - Types of messages in agent output
 *
 * These types represent common semantic operations across coding agents.
 * Agent-specific adapters map their output to these standard types.
 */
export type MessageType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "usage"
  | "error"
  | "system"
  | "unknown";

/**
 * FileOperation - Type of file operation performed
 *
 * Extended to support operations from various agents:
 * - read: File read operations
 * - write: File write (create or overwrite)
 * - edit: In-place file edits (e.g., Aider's inline edits)
 * - delete: File deletion
 * - create: Explicit file creation (vs overwrite)
 */
export type FileOperation = "read" | "write" | "edit" | "delete" | "create";

/**
 * ToolCallStatus - Status of a tool invocation
 */
export type ToolCallStatus = "pending" | "success" | "error";

/**
 * OutputMessage - Discriminated union for all message types
 *
 * Represents a parsed message from agent output.
 * Uses a discriminated union pattern for type-safe message handling.
 *
 * The `metadata` field on each variant provides an extension point for
 * agent-specific data without breaking the core type structure.
 */
export type OutputMessage =
  | {
      type: "text";
      content: string;
      timestamp: Date;
      /** Agent-specific metadata (e.g., formatting, styling) */
      metadata?: Record<string, any>;
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, any>;
      timestamp: Date;
      /** Agent-specific metadata (e.g., execution context, permissions) */
      metadata?: Record<string, any>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      result: any;
      isError: boolean;
      timestamp: Date;
      /** Agent-specific metadata (e.g., exit codes, duration) */
      metadata?: Record<string, any>;
    }
  | {
      type: "usage";
      tokens: {
        input: number;
        output: number;
        cache: number;
      };
      timestamp: Date;
      /** Agent-specific metadata (e.g., model name, pricing tier) */
      metadata?: Record<string, any>;
    }
  | {
      type: "error";
      message: string;
      details?: any;
      timestamp: Date;
      /** Agent-specific metadata (e.g., error codes, stack traces) */
      metadata?: Record<string, any>;
    }
  | {
      type: "system";
      subtype?: string;
      sessionId?: string;
      timestamp: Date;
      /** Agent-specific metadata (e.g., version, capabilities) */
      metadata?: Record<string, any>;
    }
  | {
      type: "unknown";
      raw: string;
      timestamp: Date;
      /** Agent-specific metadata (e.g., original format, parsing hints) */
      metadata?: Record<string, any>;
    };

/**
 * FileChange - Track file modifications during execution
 */
export interface FileChange {
  /**
   * Path to the file that was changed
   */
  path: string;

  /**
   * Type of operation performed on the file
   */
  operation: FileOperation;

  /**
   * When the change occurred
   */
  timestamp: Date;

  /**
   * Tool call ID that caused this change (optional)
   */
  toolCallId?: string;

  /**
   * Additional change details (e.g., line numbers, diffs)
   * Useful for agents that provide inline diff information
   */
  changes?: {
    linesAdded?: number;
    linesDeleted?: number;
    diff?: string;
  };

  /**
   * Agent-specific metadata (e.g., Git integration, review status)
   */
  metadata?: Record<string, any>;
}

/**
 * ToolCall - Represents a tool invocation and its result
 */
export interface ToolCall {
  /**
   * Unique identifier for this tool call
   */
  id: string;

  /**
   * Name of the tool (e.g., 'Bash', 'Read', 'Write', 'Edit')
   */
  name: string;

  /**
   * Input parameters passed to the tool
   */
  input: Record<string, any>;

  /**
   * Current status of the tool call
   */
  status: ToolCallStatus;

  /**
   * Result from the tool execution (if completed)
   */
  result?: any;

  /**
   * Error message (if status is 'error')
   */
  error?: string;

  /**
   * When the tool was invoked
   */
  timestamp: Date;

  /**
   * When the tool completed (if finished)
   */
  completedAt?: Date;
}

/**
 * UsageMetrics - Token usage and cost tracking
 */
export interface UsageMetrics {
  /**
   * Input tokens consumed
   */
  inputTokens: number;

  /**
   * Output tokens generated
   */
  outputTokens: number;

  /**
   * Cache tokens used (optional, for agents that support caching)
   */
  cacheTokens: number;

  /**
   * Total tokens (input + output)
   */
  totalTokens: number;

  /**
   * Estimated cost in USD (if available)
   */
  cost?: number;

  /**
   * Provider/model information for multi-agent scenarios
   */
  provider?: string; // e.g., 'anthropic', 'openai', 'google'
  model?: string; // e.g., 'claude-sonnet-4', 'gpt-5', 'gemini-2.5-pro'
}

/**
 * ProcessingMetrics - Aggregate statistics from output processing
 */
export interface ProcessingMetrics {
  /**
   * Total number of messages processed
   */
  totalMessages: number;

  /**
   * All tool calls tracked during execution
   */
  toolCalls: ToolCall[];

  /**
   * All file changes detected during execution
   */
  fileChanges: FileChange[];

  /**
   * Token usage and cost metrics
   */
  usage: UsageMetrics;

  /**
   * Errors encountered during execution
   */
  errors: Array<{
    message: string;
    timestamp: Date;
    details?: any;
  }>;

  /**
   * When processing started
   */
  startedAt: Date;

  /**
   * When processing last updated
   */
  lastUpdate: Date;

  /**
   * When processing ended (if finished)
   */
  endedAt?: Date;
}

/**
 * ExecutionSummary - High-level summary of execution
 *
 * Provides an aggregate view of the execution including counts,
 * success rates, and cost information. Useful for dashboards and reporting.
 */
export interface ExecutionSummary {
  /**
   * Total number of messages processed
   */
  totalMessages: number;

  /**
   * Tool call counts grouped by tool name
   * Example: { "Bash": 5, "Read": 3, "Write": 2 }
   */
  toolCallsByType: Record<string, number>;

  /**
   * File operation counts grouped by operation type
   * Example: { "read": 3, "write": 2, "edit": 1 }
   */
  fileOperationsByType: Record<string, number>;

  /**
   * Success rate of tool calls (percentage 0-100)
   */
  successRate: number;

  /**
   * Total tokens used
   */
  totalTokens: {
    input: number;
    output: number;
    cache: number;
  };

  /**
   * Total cost in USD
   */
  totalCost: number;

  /**
   * Processing duration in milliseconds
   */
  duration: number;

  /**
   * When processing started
   */
  startTime: Date;

  /**
   * When processing ended (if finished)
   */
  endTime?: Date;
}

/**
 * ToolCallHandler - Callback invoked when a tool is called
 */
export type ToolCallHandler = (toolCall: ToolCall) => void;

/**
 * FileChangeHandler - Callback invoked when a file is changed
 */
export type FileChangeHandler = (change: FileChange) => void;

/**
 * ProgressHandler - Callback invoked when metrics are updated
 */
export type ProgressHandler = (metrics: ProcessingMetrics) => void;

/**
 * ErrorHandler - Callback invoked when an error occurs
 */
export type ErrorHandler = (error: {
  message: string;
  timestamp: Date;
  details?: any;
}) => void;

/**
 * MessageHandler - Callback invoked when a text message is received
 */
export type MessageHandler = (message: OutputMessage) => void;

/**
 * UsageHandler - Callback invoked when usage metrics are updated
 */
export type UsageHandler = (usage: UsageMetrics) => void;

/**
 * SessionHandler - Callback invoked when a session ID is detected
 */
export type SessionHandler = (sessionId: string) => void;

/**
 * IOutputProcessor - Interface for output processing implementations
 *
 * Defines the contract for parsing coding agent output in real-time,
 * extracting structured data, and providing event-driven updates.
 *
 * Current implementations focus on Claude Code's stream-json format,
 * but the interface is designed to support future agent adapters.
 */
export interface IOutputProcessor {
  /**
   * Process a single line of output
   *
   * The format depends on the agent (stream-json, JSON, text, etc.)
   *
   * @param line - Raw output line from the agent
   * @returns Promise that resolves when line is processed
   */
  processLine(line: string): Promise<void>;

  /**
   * Get current processing metrics
   *
   * @returns Current aggregate metrics
   */
  getMetrics(): ProcessingMetrics;

  /**
   * Get all tool calls recorded during processing
   *
   * @returns Array of all tool calls
   */
  getToolCalls(): ToolCall[];

  /**
   * Get all file changes detected during processing
   *
   * @returns Array of all file changes
   */
  getFileChanges(): FileChange[];

  /**
   * Register a callback for tool call events
   *
   * @param handler - Function to call when a tool is invoked
   */
  onToolCall(handler: ToolCallHandler): void;

  /**
   * Register a callback for file change events
   *
   * @param handler - Function to call when a file is modified
   */
  onFileChange(handler: FileChangeHandler): void;

  /**
   * Register a callback for progress update events
   *
   * @param handler - Function to call when metrics are updated
   */
  onProgress(handler: ProgressHandler): void;

  /**
   * Register a callback for error events
   *
   * @param handler - Function to call when an error occurs
   */
  onError(handler: ErrorHandler): void;

  /**
   * Register a callback for message events
   *
   * @param handler - Function to call when a text message is received
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register a callback for usage metric updates
   *
   * @param handler - Function to call when usage metrics are updated
   */
  onUsage(handler: UsageHandler): void;

  /**
   * Register a callback for session ID detection
   *
   * @param handler - Function to call when a session ID is detected
   */
  onSession(handler: SessionHandler): void;
}

// ============================================================================
// Extension Point: Agent Adapters
// ============================================================================

/**
 * IAgentAdapter - Interface for agent-specific output parsing
 *
 * This interface is the extension point for supporting multiple coding agents.
 * Each agent (Claude Code, Aider, Gemini, Codex) can have its own adapter
 * that translates agent-specific output to OutputMessage[].
 *
 * Future implementation will move agent-specific parsing logic into adapters,
 * keeping the core IOutputProcessor implementation agent-agnostic.
 *
 * @example
 * ```typescript
 * class ClaudeCodeAdapter implements IAgentAdapter {
 *   name = 'claude-code';
 *   parse(line: string): OutputMessage[] {
 *     // Parse Claude's stream-json format
 *   }
 * }
 * ```
 */
export interface IAgentAdapter {
  /**
   * Unique identifier for this agent
   * Examples: 'claude-code', 'aider', 'gemini-code-assist', 'codex-cli'
   */
  readonly name: string;

  /**
   * Parse a line of agent output into structured messages
   *
   * @param line - Raw output line from the agent
   * @returns Array of parsed messages (may be empty for unparseable lines)
   */
  parse(line: string): OutputMessage[];
}

/**
 * Default usage metrics (empty state)
 */
export const DEFAULT_USAGE_METRICS: UsageMetrics = {
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  totalTokens: 0,
  cost: 0,
};
