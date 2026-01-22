/**
 * SessionUpdate Coalescer
 *
 * Merges streaming SessionUpdate events into complete messages for storage.
 * Accumulates chunks and tracks tool lifecycles to produce storage-efficient
 * CoalescedSessionUpdate events.
 *
 * @module execution/output/session-update-coalescer
 */

import type {
  SessionUpdate,
  ExtendedSessionUpdate,
  ContentBlock,
  ToolCallStatus,
  ToolCallContent,
} from "acp-factory";
import type {
  CoalescedSessionUpdate,
  AgentMessageComplete,
  AgentThoughtComplete,
  ToolCallComplete,
  UserMessageComplete,
  PlanUpdate,
  SessionNotification,
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
   * Accepts ExtendedSessionUpdate to support compaction events from acp-factory 0.1.2+.
   *
   * @param update - The streaming SessionUpdate or ExtendedSessionUpdate event
   * @returns Coalesced event(s) if any are ready, otherwise empty array
   */
  process(
    update: SessionUpdate | ExtendedSessionUpdate
  ): CoalescedSessionUpdate[] {
    const results: CoalescedSessionUpdate[] = [];

    // Handle extended session update types (compaction, etc.) that aren't part of base SessionUpdate
    const updateType = (update as { sessionUpdate: string }).sessionUpdate;

    // Check for notification-style events from ExtendedSessionUpdate
    // These are events that should be stored as generic session notifications
    if (this.isNotificationEvent(updateType)) {
      // Flush pending text if any (notifications interrupt text accumulation)
      if (this.pendingText) {
        results.push(this.flushPendingText()!);
      }

      // Convert to generic SessionNotification
      const notification = this.createSessionNotification(updateType, update);
      if (notification) {
        results.push(notification);
      }
      return results;
    }

    // Handle standard SessionUpdate types
    const sessionUpdate = update as SessionUpdate;
    switch (sessionUpdate.sessionUpdate) {
      case "agent_message_chunk":
        // Flush pending text if switching types
        if (this.pendingText && this.pendingText.type !== "agent_message") {
          results.push(this.flushPendingText()!);
        }
        this.accumulateText("agent_message", sessionUpdate.content);
        break;

      case "agent_thought_chunk":
        // Flush pending text if switching types
        if (this.pendingText && this.pendingText.type !== "agent_thought") {
          results.push(this.flushPendingText()!);
        }
        this.accumulateText("agent_thought", sessionUpdate.content);
        break;

      case "user_message_chunk":
        // Flush pending text if switching types
        if (this.pendingText && this.pendingText.type !== "user_message") {
          results.push(this.flushPendingText()!);
        }
        this.accumulateText("user_message", sessionUpdate.content);
        break;

      case "tool_call":
        // Tool calls interrupt text accumulation
        if (this.pendingText) {
          results.push(this.flushPendingText()!);
        }
        // Start tracking this tool call
        // Capture rawInput, rawOutput, and content - some tools complete immediately
        this.pendingToolCalls.set(sessionUpdate.toolCallId, {
          toolCallId: sessionUpdate.toolCallId,
          title: sessionUpdate.title,
          status: sessionUpdate.status ?? "in_progress",
          rawInput: sessionUpdate.rawInput,
          rawOutput: sessionUpdate.rawOutput,
          content: sessionUpdate.content,
          timestamp: new Date(),
        });
        break;

      case "tool_call_update":
        // Update existing tool call
        const pending = this.pendingToolCalls.get(sessionUpdate.toolCallId);
        if (pending) {
          if (sessionUpdate.status) {
            pending.status = sessionUpdate.status;
          }
          if (sessionUpdate.rawInput !== undefined) {
            pending.rawInput = sessionUpdate.rawInput;
          }
          if (sessionUpdate.rawOutput !== undefined) {
            pending.rawOutput = sessionUpdate.rawOutput;
          }
          if (
            sessionUpdate.content !== undefined &&
            sessionUpdate.content !== null
          ) {
            pending.content = sessionUpdate.content;
          }
          if (sessionUpdate.title) {
            pending.title = sessionUpdate.title;
          }

          // Check if tool call is complete (terminal status)
          if (this.isTerminalStatus(pending.status)) {
            this.pendingToolCalls.delete(sessionUpdate.toolCallId);
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
        const planUpdate = sessionUpdate as {
          sessionUpdate: "plan";
          entries?: Array<{
            content: string;
            status: string;
            priority: string;
          }>;
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

      // Note: compaction_started and compaction_completed are handled at the top
      // of this method before the switch statement

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

  /**
   * Check if an update type is a notification-style event that should be
   * stored as a generic SessionNotification.
   *
   * This includes compaction events and other extended session updates
   * that don't require coalescing.
   */
  private isNotificationEvent(updateType: string): boolean {
    return (
      updateType === "compaction_started" ||
      updateType === "compaction_completed"
      // Add other notification types here as needed:
      // updateType === "session_info_update" ||
      // updateType === "config_option_update" ||
    );
  }

  /**
   * Create a generic SessionNotification from an extended session update.
   *
   * Extracts the notification type and relevant data from the update,
   * normalizing it into a consistent format for storage.
   */
  private createSessionNotification(
    notificationType: string,
    update: unknown
  ): SessionNotification | null {
    const u = update as Record<string, unknown>;

    // Extract common fields
    const sessionId = u.sessionId as string | undefined;

    // Build the data payload by excluding known metadata fields
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(u)) {
      // Skip metadata fields that are captured separately
      if (key === "sessionUpdate" || key === "sessionId") {
        continue;
      }
      data[key] = value;
    }

    return {
      sessionUpdate: "session_notification",
      notificationType,
      sessionId,
      data,
      timestamp: new Date(),
    };
  }
}
