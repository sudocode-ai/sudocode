/**
 * SessionUpdate Coalescer
 *
 * Merges streaming SessionUpdate events into complete messages for storage.
 * Accumulates chunks and tracks tool lifecycles to produce storage-efficient
 * CoalescedSessionUpdate events.
 *
 * @module execution/output/session-update-coalescer
 */

import type { SessionUpdate, ContentBlock, ToolCallStatus, ToolCallContent } from "acp-factory";
import type {
  CoalescedSessionUpdate,
  AgentMessageComplete,
  AgentThoughtComplete,
  ToolCallComplete,
  UserMessageComplete,
  PlanUpdate,
} from "./coalesced-types.js";

/**
 * Internal state for tracking in-progress tool calls
 */
interface PendingToolCall {
  toolCallId: string;
  title: string;
  status: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContent[];
  result?: unknown;
  timestamp: Date;
}

/**
 * Internal state for accumulating text chunks
 */
interface PendingText {
  type: "agent_message" | "agent_thought" | "user_message";
  chunks: string[];
  timestamp: Date;
}

/**
 * SessionUpdateCoalescer
 *
 * Processes streaming SessionUpdate events and produces coalesced events
 * suitable for storage. Handles:
 * - Accumulating agent_message_chunk into complete messages
 * - Accumulating agent_thought_chunk into complete thoughts
 * - Tracking tool_call → tool_call_update lifecycle
 *
 * @example
 * ```typescript
 * const coalescer = new SessionUpdateCoalescer();
 *
 * for await (const update of session.prompt("Hello")) {
 *   // Stream to frontend
 *   transport.send(update);
 *
 *   // Coalesce for storage
 *   const coalesced = coalescer.process(update);
 *   if (coalesced) {
 *     store.append(coalesced);
 *   }
 * }
 *
 * // Flush any remaining state
 * for (const remaining of coalescer.flush()) {
 *   store.append(remaining);
 * }
 * ```
 */
export class SessionUpdateCoalescer {
  /** Accumulated text content (messages or thoughts) */
  private pendingText: PendingText | null = null;

  /** Tool calls waiting for completion */
  private pendingToolCalls: Map<string, PendingToolCall> = new Map();

  /**
   * Process a streaming SessionUpdate event.
   *
   * May return a coalesced event if the incoming event completes
   * a pending accumulation (e.g., tool call finished, message interrupted).
   *
   * @param update - The streaming SessionUpdate event
   * @returns Coalesced event(s) if any are ready, otherwise empty array
   */
  process(update: SessionUpdate): CoalescedSessionUpdate[] {
    const results: CoalescedSessionUpdate[] = [];

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        // Flush pending text if switching types
        if (this.pendingText && this.pendingText.type !== "agent_message") {
          results.push(this.flushPendingText()!);
        }
        this.accumulateText("agent_message", update.content);
        break;

      case "agent_thought_chunk":
        // Flush pending text if switching types
        if (this.pendingText && this.pendingText.type !== "agent_thought") {
          results.push(this.flushPendingText()!);
        }
        this.accumulateText("agent_thought", update.content);
        break;

      case "user_message_chunk":
        // Flush pending text if switching types
        if (this.pendingText && this.pendingText.type !== "user_message") {
          results.push(this.flushPendingText()!);
        }
        this.accumulateText("user_message", update.content);
        break;

      case "tool_call":
        // Tool calls interrupt text accumulation
        if (this.pendingText) {
          results.push(this.flushPendingText()!);
        }
        // Start tracking this tool call
        // Capture rawInput, rawOutput, and content - some tools complete immediately
        this.pendingToolCalls.set(update.toolCallId, {
          toolCallId: update.toolCallId,
          title: update.title,
          status: update.status ?? "in_progress",
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
          content: update.content,
          timestamp: new Date(),
        });
        break;

      case "tool_call_update":
        // Update existing tool call
        const pending = this.pendingToolCalls.get(update.toolCallId);
        if (pending) {
          if (update.status) {
            pending.status = update.status;
          }
          if (update.rawInput !== undefined) {
            pending.rawInput = update.rawInput;
          }
          if (update.rawOutput !== undefined) {
            pending.rawOutput = update.rawOutput;
          }
          if (update.content !== undefined && update.content !== null) {
            pending.content = update.content;
          }
          if (update.title) {
            pending.title = update.title;
          }

          // Check if tool call is complete (terminal status)
          if (this.isTerminalStatus(pending.status)) {
            this.pendingToolCalls.delete(update.toolCallId);
            results.push(this.createToolCallComplete(pending));
          }
        }
        break;

      // Plan updates contain todo/task state - store them for replay
      // ACP plan structure: { sessionUpdate: "plan", entries: [...] }
      // NOT { sessionUpdate: "plan", plan: { entries: [...] } }
      case "plan": {
        // Flush pending text if any
        if (this.pendingText) {
          results.push(this.flushPendingText()!);
        }
        // Store plan update with entries - entries are directly on the update object
        const planUpdate = update as {
          sessionUpdate: "plan";
          entries?: Array<{ content: string; status: string; priority: string }>;
        };
        if (planUpdate.entries && planUpdate.entries.length > 0) {
          results.push({
            sessionUpdate: "plan",
            entries: planUpdate.entries.map((e) => ({
              content: e.content,
              status: e.status as "pending" | "in_progress" | "completed",
              priority: e.priority as "high" | "medium" | "low",
            })),
            timestamp: new Date(),
          } as PlanUpdate);
        }
        break;
      }

      // These events pass through without coalescing (informational/metadata)
      case "available_commands_update":
      case "current_mode_update":
        // Metadata updates - no coalescing needed
        // They could be stored separately or ignored for content storage
        break;

      default:
        // Handle any other session update types (future-proofing)
        // config_option_update, session_info_update, etc.
        break;
    }

    return results;
  }

  /**
   * Flush all pending state and return any remaining coalesced events.
   *
   * Call this when the prompt completes to ensure all accumulated
   * content is emitted.
   *
   * @returns Array of remaining coalesced events
   */
  flush(): CoalescedSessionUpdate[] {
    const results: CoalescedSessionUpdate[] = [];

    // Flush pending text
    if (this.pendingText) {
      results.push(this.flushPendingText()!);
    }

    // Flush any incomplete tool calls (shouldn't happen normally)
    for (const pending of Array.from(this.pendingToolCalls.values())) {
      results.push(this.createToolCallComplete(pending));
    }
    this.pendingToolCalls.clear();

    return results;
  }

  /**
   * Reset the coalescer state.
   * Useful when starting a new prompt within the same session.
   */
  reset(): void {
    this.pendingText = null;
    this.pendingToolCalls.clear();
  }

  /**
   * Check if there's any pending state that hasn't been flushed
   */
  hasPendingState(): boolean {
    return this.pendingText !== null || this.pendingToolCalls.size > 0;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private accumulateText(
    type: "agent_message" | "agent_thought" | "user_message",
    content: ContentBlock
  ): void {
    const textContent = this.extractText(content);

    if (!this.pendingText) {
      this.pendingText = {
        type,
        chunks: [textContent],
        timestamp: new Date(),
      };
    } else {
      this.pendingText.chunks.push(textContent);
    }
  }

  private flushPendingText(): CoalescedSessionUpdate | null {
    if (!this.pendingText) return null;

    const accumulated = this.pendingText.chunks.join("");
    const result = this.createTextComplete(
      this.pendingText.type,
      accumulated,
      this.pendingText.timestamp
    );

    this.pendingText = null;
    return result;
  }

  private createTextComplete(
    type: "agent_message" | "agent_thought" | "user_message",
    text: string,
    timestamp: Date
  ): CoalescedSessionUpdate {
    const content: ContentBlock = { type: "text", text };

    switch (type) {
      case "agent_message":
        return {
          sessionUpdate: "agent_message_complete",
          content,
          timestamp,
        } as AgentMessageComplete;

      case "agent_thought":
        return {
          sessionUpdate: "agent_thought_complete",
          content,
          timestamp,
        } as AgentThoughtComplete;

      case "user_message":
        return {
          sessionUpdate: "user_message_complete",
          content,
          timestamp,
        } as UserMessageComplete;
    }
  }

  private createToolCallComplete(pending: PendingToolCall): ToolCallComplete {
    return {
      sessionUpdate: "tool_call_complete",
      toolCallId: pending.toolCallId,
      title: pending.title,
      status: pending.status,
      rawInput: pending.rawInput,
      rawOutput: pending.rawOutput,
      content: pending.content,
      timestamp: pending.timestamp,
      completedAt: new Date(),
    };
  }

  private extractText(content: ContentBlock): string {
    if (content.type === "text") {
      return content.text;
    }
    // For non-text content (images, resources), return a placeholder
    // This shouldn't happen often in practice for message chunks
    return `[${content.type}]`;
  }

  private isTerminalStatus(status: ToolCallStatus): boolean {
    return status === "completed" || status === "failed";
  }
}
