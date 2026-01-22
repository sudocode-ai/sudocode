/**
 * Coalesced SessionUpdate Types
 *
 * Types for storage-optimized SessionUpdate events. These represent
 * complete messages and tool calls rather than streaming chunks.
 *
 * @module execution/output/coalesced-types
 */

import type { ContentBlock, ToolCallStatus, ToolCallContent } from "acp-factory";

/**
 * A complete agent message (coalesced from multiple agent_message_chunk events)
 */
export interface AgentMessageComplete {
  sessionUpdate: "agent_message_complete";
  /** Accumulated text content */
  content: ContentBlock;
  /** Timestamp of first chunk */
  timestamp: Date;
  /**
   * Optional stable message ID for deduplication.
   * When provided, frontend should use this ID instead of generating a new one.
   * This is used by legacy agents that emit multiple updates for the same message.
   */
  messageId?: string;
}

/**
 * A complete agent thought (coalesced from multiple agent_thought_chunk events)
 */
export interface AgentThoughtComplete {
  sessionUpdate: "agent_thought_complete";
  /** Accumulated thought content */
  content: ContentBlock;
  /** Timestamp of first chunk */
  timestamp: Date;
}

/**
 * A complete tool call (coalesced from tool_call + tool_call_update events)
 */
export interface ToolCallComplete {
  sessionUpdate: "tool_call_complete";
  /** Unique identifier for this tool call */
  toolCallId: string;
  /** Human-readable title describing the tool action */
  title: string;
  /** Final status of the tool call */
  status: ToolCallStatus;
  /** Tool execution result (if available) */
  result?: unknown;
  /** Raw input parameters (if available) */
  rawInput?: unknown;
  /** Raw output from tool (if available) */
  rawOutput?: unknown;
  /** Structured content produced by the tool call */
  content?: ToolCallContent[];
  /** Timestamp of initial tool_call event */
  timestamp: Date;
  /** Timestamp when tool completed */
  completedAt?: Date;
}

/**
 * A user message chunk (passed through as-is, typically only one per turn)
 */
export interface UserMessageComplete {
  sessionUpdate: "user_message_complete";
  /** Message content */
  content: ContentBlock;
  /** Timestamp */
  timestamp: Date;
}

/**
 * A plan entry (task/todo item) from Claude Code
 */
export interface PlanEntry {
  /** Human-readable description of the task */
  content: string;
  /** Current execution status */
  status: "pending" | "in_progress" | "completed";
  /** Task priority */
  priority: "high" | "medium" | "low";
}

/**
 * A plan update containing the current state of all tasks/todos
 * This is how Claude Code exposes its todo list through ACP
 */
export interface PlanUpdate {
  sessionUpdate: "plan";
  /** All current plan entries (replaces previous state) */
  entries: PlanEntry[];
  /** Timestamp of the plan update */
  timestamp: Date;
}

/**
 * Generic session notification for various agent lifecycle events.
 *
 * This is a flexible type that can represent any session notification
 * (compaction events, mode changes, status updates, etc.) without
 * requiring specific types for each notification kind.
 *
 * Common notification types:
 * - "compaction_started": { trigger: "auto"|"manual", preTokens: number, threshold?: number }
 * - "compaction_completed": { trigger: "auto"|"manual", preTokens: number }
 * - "session_info_update": { tokenCount: number, ... }
 */
export interface SessionNotification {
  sessionUpdate: "session_notification";
  /** The specific notification type (e.g., "compaction_started", "compaction_completed") */
  notificationType: string;
  /** Session where the notification occurred (if applicable) */
  sessionId?: string;
  /** Notification-specific data payload */
  data: Record<string, unknown>;
  /** Timestamp of the event */
  timestamp: Date;
}

/**
 * Union of all coalesced event types for storage
 */
export type CoalescedSessionUpdate =
  | AgentMessageComplete
  | AgentThoughtComplete
  | ToolCallComplete
  | UserMessageComplete
  | PlanUpdate
  | SessionNotification;

/**
 * Type guard for checking if an event is a coalesced type
 */
export function isCoalescedUpdate(
  update: unknown
): update is CoalescedSessionUpdate {
  if (typeof update !== "object" || update === null) return false;
  const u = update as Record<string, unknown>;
  return (
    u.sessionUpdate === "agent_message_complete" ||
    u.sessionUpdate === "agent_thought_complete" ||
    u.sessionUpdate === "tool_call_complete" ||
    u.sessionUpdate === "user_message_complete" ||
    u.sessionUpdate === "plan" ||
    u.sessionUpdate === "session_notification"
  );
}

/**
 * Serializes a CoalescedSessionUpdate for storage (handles Date serialization)
 */
export function serializeCoalescedUpdate(
  update: CoalescedSessionUpdate
): string {
  return JSON.stringify(update, (_key, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  });
}

/**
 * Deserializes a CoalescedSessionUpdate from storage (handles Date parsing)
 */
export function deserializeCoalescedUpdate(
  json: string
): CoalescedSessionUpdate {
  return JSON.parse(json, (_key, value) => {
    // Restore Date objects from ISO strings
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    ) {
      return new Date(value);
    }
    return value;
  });
}
