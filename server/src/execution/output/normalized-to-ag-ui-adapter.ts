/**
 * Normalized Entry to AG-UI Adapter
 *
 * Converts NormalizedEntry output from ClaudeCodeExecutor to AG-UI events
 * that can be consumed by the frontend via SSE streaming.
 *
 * This adapter bridges the gap between agent-execution-engine's normalized
 * format and the AG-UI protocol used by the frontend.
 *
 * @module execution/output/normalized-to-ag-ui-adapter
 */

import type {
  NormalizedEntry,
  ActionType,
  ToolResult,
} from "agent-execution-engine/agents";
import type { AgUiEventAdapter } from "./ag-ui-adapter.js";
import {
  EventType,
  type TextMessageStartEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type ToolCallStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type RunErrorEvent,
} from "@ag-ui/core";

/**
 * NormalizedEntryToAgUiAdapter
 *
 * Transforms normalized entries from agent executors into AG-UI protocol events.
 * Maintains message ID tracking and ensures proper event sequencing.
 *
 * @example
 * ```typescript
 * const agUiAdapter = new AgUiEventAdapter('run-123');
 * const normalizedAdapter = new NormalizedEntryToAgUiAdapter(agUiAdapter);
 *
 * for await (const entry of normalizedStream) {
 *   await normalizedAdapter.processEntry(entry);
 * }
 * ```
 */
export class NormalizedEntryToAgUiAdapter {
  private agUiAdapter: AgUiEventAdapter;
  private toolCallMap: Map<string, string> = new Map(); // toolId -> messageId
  private messageCounter: number = 0;

  /**
   * Create a new NormalizedEntryToAgUiAdapter
   *
   * @param agUiAdapter - AG-UI event adapter to emit events through
   */
  constructor(agUiAdapter: AgUiEventAdapter) {
    this.agUiAdapter = agUiAdapter;
  }

  /**
   * Process a normalized entry and emit appropriate AG-UI events
   *
   * @param entry - Normalized entry from agent executor
   */
  async processEntry(entry: NormalizedEntry): Promise<void> {
    switch (entry.type.kind) {
      case "assistant_message":
        await this.handleAssistantMessage(entry);
        break;

      case "tool_use":
        await this.handleToolUse(entry);
        break;

      case "thinking":
        await this.handleThinking(entry);
        break;

      case "error":
        await this.handleError(entry);
        break;

      case "system_message":
        await this.handleSystemMessage(entry);
        break;

      case "user_message":
        // User messages are already sent by the client, skip
        break;

      default:
        console.warn("[NormalizedAdapter] Unknown entry type:", entry);
    }
  }

  /**
   * Handle assistant message entries
   *
   * Emits TextMessageStart, TextMessageContent, and TextMessageEnd events.
   */
  private async handleAssistantMessage(entry: NormalizedEntry): Promise<void> {
    const messageId = this.generateMessageId();
    const timestamp = Date.now();

    // Emit TEXT_MESSAGE_START
    this.emitEvent<TextMessageStartEvent>({
      type: EventType.TEXT_MESSAGE_START,
      timestamp,
      messageId,
      role: "assistant",
    });

    // Emit TEXT_MESSAGE_CONTENT
    this.emitEvent<TextMessageContentEvent>({
      type: EventType.TEXT_MESSAGE_CONTENT,
      timestamp,
      messageId,
      delta: entry.content,
    });

    // Emit TEXT_MESSAGE_END
    this.emitEvent<TextMessageEndEvent>({
      type: EventType.TEXT_MESSAGE_END,
      timestamp,
      messageId,
    });
  }

  /**
   * Handle tool use entries
   *
   * Emits ToolCallStart, and optionally ToolCallResult/End if the tool
   * execution is complete.
   */
  private async handleToolUse(entry: NormalizedEntry): Promise<void> {
    if (entry.type.kind !== "tool_use") return;

    const tool = entry.type.tool;
    const toolId = `${tool.toolName}-${entry.index}`;
    const timestamp = Date.now();

    // Check if we've already started this tool call
    let messageId = this.toolCallMap.get(toolId);

    if (!messageId) {
      // First time seeing this tool - emit start event
      messageId = this.generateMessageId();
      this.toolCallMap.set(toolId, messageId);

      const args = this.extractToolArgs(tool.action);

      // Emit TOOL_CALL_START
      this.emitEvent<ToolCallStartEvent>({
        type: EventType.TOOL_CALL_START,
        timestamp,
        toolCallId: toolId,
        toolCallName: tool.toolName,
      });

      // If we have args in the action, emit them
      if (Object.keys(args).length > 0) {
        this.emitEvent<ToolCallArgsEvent>({
          type: EventType.TOOL_CALL_ARGS,
          timestamp,
          toolCallId: toolId,
          delta: JSON.stringify(args),
        });
      }
    }

    // If tool is completed (success or failed), emit result and end
    if (tool.status === "success" || tool.status === "failed") {
      const result = this.extractToolResult(tool.result);

      // Emit TOOL_CALL_END
      this.emitEvent<ToolCallEndEvent>({
        type: EventType.TOOL_CALL_END,
        timestamp,
        toolCallId: toolId,
      });

      // Emit TOOL_CALL_RESULT
      this.emitEvent<ToolCallResultEvent>({
        type: EventType.TOOL_CALL_RESULT,
        timestamp,
        messageId,
        toolCallId: toolId,
        content:
          result.success
            ? JSON.stringify(result.output)
            : result.error || "Tool execution failed",
      });

      // Clean up tracking
      this.toolCallMap.delete(toolId);
    }
  }

  /**
   * Handle thinking entries
   *
   * Converts thinking blocks to text messages with special formatting.
   */
  private async handleThinking(entry: NormalizedEntry): Promise<void> {
    if (entry.type.kind !== "thinking") return;

    const messageId = this.generateMessageId();
    const timestamp = Date.now();
    const reasoning = entry.type.reasoning || "";

    // Emit as a text message with [Thinking] prefix
    this.emitEvent<TextMessageStartEvent>({
      type: EventType.TEXT_MESSAGE_START,
      timestamp,
      messageId,
      role: "assistant",
    });

    this.emitEvent<TextMessageContentEvent>({
      type: EventType.TEXT_MESSAGE_CONTENT,
      timestamp,
      messageId,
      delta: `[Thinking] ${reasoning}`,
    });

    this.emitEvent<TextMessageEndEvent>({
      type: EventType.TEXT_MESSAGE_END,
      timestamp,
      messageId,
    });
  }

  /**
   * Handle error entries
   *
   * Emits RunError events for execution errors.
   */
  private async handleError(entry: NormalizedEntry): Promise<void> {
    if (entry.type.kind !== "error") return;

    const error = entry.type.error;

    this.emitEvent<RunErrorEvent>({
      type: EventType.RUN_ERROR,
      timestamp: Date.now(),
      message: error.message,
      ...(error.stack && { rawEvent: { details: error.stack } }),
    });
  }

  /**
   * Handle system message entries
   *
   * Converts to custom events or text messages.
   */
  private async handleSystemMessage(entry: NormalizedEntry): Promise<void> {
    // System messages can be emitted as custom events or text messages
    // For now, emit as text messages for visibility
    const messageId = this.generateMessageId();
    const timestamp = Date.now();

    this.emitEvent<TextMessageStartEvent>({
      type: EventType.TEXT_MESSAGE_START,
      timestamp,
      messageId,
      role: "assistant",
    });

    this.emitEvent<TextMessageContentEvent>({
      type: EventType.TEXT_MESSAGE_CONTENT,
      timestamp,
      messageId,
      delta: `[System] ${entry.content}`,
    });

    this.emitEvent<TextMessageEndEvent>({
      type: EventType.TEXT_MESSAGE_END,
      timestamp,
      messageId,
    });
  }

  /**
   * Extract tool arguments from action type
   *
   * Maps the discriminated ActionType union to a plain object
   * suitable for AG-UI events.
   */
  private extractToolArgs(action: ActionType): any {
    switch (action.kind) {
      case "file_read":
        return { path: action.path };

      case "file_write":
        return { path: action.path };

      case "file_edit":
        return {
          path: action.path,
          changes: action.changes.map((c) => ({
            type: c.type,
            diff: c.unifiedDiff,
          })),
        };

      case "command_run":
        return {
          command: action.command,
          result: action.result
            ? {
                exitCode: action.result.exitCode,
                stdout: action.result.stdout,
                stderr: action.result.stderr,
              }
            : undefined,
        };

      case "search":
        return { query: action.query };

      case "tool":
        return {
          toolName: action.toolName,
          args: action.args,
        };

      default:
        return {};
    }
  }

  /**
   * Extract tool result for AG-UI events
   *
   * Converts ToolResult to AG-UI format.
   */
  private extractToolResult(result?: ToolResult): any {
    if (!result) {
      return { success: false, error: "No result available" };
    }

    return {
      success: result.success,
      output: result.data,
      error: result.error,
    };
  }

  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    this.messageCounter++;
    return `msg-${Date.now()}-${this.messageCounter}`;
  }

  /**
   * Emit an event through the AG-UI adapter
   *
   * Uses the adapter's onEvent mechanism to emit events.
   */
  private emitEvent<T>(event: T): void {
    // Access the private emit method via the adapter's listener mechanism
    // This is a workaround since AgUiEventAdapter doesn't expose public emit methods
    (this.agUiAdapter as any).emit(event);
  }
}
