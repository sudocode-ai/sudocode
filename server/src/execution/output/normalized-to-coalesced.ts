/**
 * NormalizedEntry to CoalescedSessionUpdate Converter
 *
 * Converts legacy NormalizedEntry format (from agent-execution-engine)
 * to CoalescedSessionUpdate format (ACP storage format).
 *
 * This enables unified log reading for both legacy and ACP executions.
 *
 * @module execution/output/normalized-to-coalesced
 */

import type { NormalizedEntry } from "agent-execution-engine/agents";
import type {
  CoalescedSessionUpdate,
  AgentMessageComplete,
  AgentThoughtComplete,
  ToolCallComplete,
  UserMessageComplete,
} from "./coalesced-types.js";

/**
 * Convert a NormalizedEntry to a CoalescedSessionUpdate
 *
 * Mapping:
 * - assistant_message -> agent_message_complete
 * - thinking -> agent_thought_complete
 * - tool_use -> tool_call_complete
 * - error -> tool_call_complete with failed status
 * - system_message -> agent_message_complete with [System] prefix
 * - user_message -> user_message_complete
 *
 * @param entry - NormalizedEntry from agent-execution-engine
 * @returns CoalescedSessionUpdate or null if entry type is unknown
 *
 * @example
 * ```typescript
 * const entry: NormalizedEntry = {
 *   index: 0,
 *   type: { kind: 'assistant_message' },
 *   content: 'Hello world',
 *   timestamp: new Date(),
 * };
 * const coalesced = convertNormalizedEntryToCoalesced(entry);
 * // { sessionUpdate: 'agent_message_complete', content: {...}, timestamp: Date }
 * ```
 */
export function convertNormalizedEntryToCoalesced(
  entry: NormalizedEntry
): CoalescedSessionUpdate | null {
  const timestamp =
    entry.timestamp instanceof Date
      ? entry.timestamp
      : entry.timestamp
        ? new Date(entry.timestamp)
        : new Date();

  switch (entry.type.kind) {
    case "assistant_message":
      return {
        sessionUpdate: "agent_message_complete",
        content: { type: "text", text: entry.content },
        timestamp,
      } as AgentMessageComplete;

    case "thinking":
      return {
        sessionUpdate: "agent_thought_complete",
        content: {
          type: "text",
          text: entry.type.reasoning || entry.content,
        },
        timestamp,
      } as AgentThoughtComplete;

    case "tool_use": {
      const tool = entry.type.tool;
      return {
        sessionUpdate: "tool_call_complete",
        toolCallId: `${tool.toolName}-${entry.index}`,
        title: getToolTitle(tool),
        status: mapToolStatus(tool.status),
        result: tool.result?.data,
        rawInput: extractToolInput(tool),
        rawOutput: tool.result?.data,
        timestamp,
        completedAt:
          tool.status === "success" || tool.status === "failed"
            ? new Date()
            : undefined,
      } as ToolCallComplete;
    }

    case "error": {
      // Map error to a tool_call_complete with failed status
      const error = entry.type.error;
      return {
        sessionUpdate: "tool_call_complete",
        toolCallId: `error-${entry.index}`,
        title: `Error: ${error.code || "unknown"}`,
        status: "failed",
        result: { error: error.message, stack: error.stack },
        timestamp,
        completedAt: new Date(),
      } as ToolCallComplete;
    }

    case "system_message":
      return {
        sessionUpdate: "agent_message_complete",
        content: { type: "text", text: `[System] ${entry.content}` },
        timestamp,
      } as AgentMessageComplete;

    case "user_message":
      return {
        sessionUpdate: "user_message_complete",
        content: { type: "text", text: entry.content },
        timestamp,
      } as UserMessageComplete;

    default:
      console.warn(
        "[convertNormalizedEntryToCoalesced] Unknown entry type:",
        (entry.type as any).kind
      );
      return null;
  }
}

/**
 * Get a human-readable title for a tool use
 */
function getToolTitle(tool: {
  toolName: string;
  action: any;
  status: string;
}): string {
  const action = tool.action;
  switch (action.kind) {
    case "file_read":
      return `Read ${action.path}`;
    case "file_write":
      return `Write ${action.path}`;
    case "file_edit":
      return `Edit ${action.path}`;
    case "command_run":
      return `Run: ${action.command?.substring(0, 50) || "command"}`;
    case "search":
      return `Search: ${action.query}`;
    case "tool":
      return `${action.toolName}`;
    default:
      return tool.toolName;
  }
}

/**
 * Extract tool input from action type
 */
function extractToolInput(tool: { action: any }): unknown {
  const action = tool.action;
  switch (action.kind) {
    case "file_read":
      return { path: action.path };
    case "file_write":
      return { path: action.path };
    case "file_edit":
      return { path: action.path, changes: action.changes };
    case "command_run":
      return { command: action.command };
    case "search":
      return { query: action.query };
    case "tool":
      return action.args;
    default:
      return {};
  }
}

/**
 * Map tool status to ToolCallStatus
 */
function mapToolStatus(
  status: "created" | "running" | "success" | "failed"
): "working" | "completed" | "failed" | "incomplete" {
  switch (status) {
    case "created":
    case "running":
      return "working";
    case "success":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "incomplete";
  }
}
