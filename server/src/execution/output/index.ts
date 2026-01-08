/**
 * Output Processing Layer
 *
 * Exports all types and utilities for the Output Processing Layer (Layer 5).
 *
 * Currently focused on Claude Code support with extension points for future
 * multi-agent capabilities (Aider, Gemini, Codex, etc.)
 *
 * @module execution/output
 */

export type {
  MessageType,
  FileOperation,
  ToolCallStatus,
  OutputMessage,
  FileChange,
  ToolCall,
  UsageMetrics,
  ProcessingMetrics,
  ExecutionSummary,
  ToolCallHandler,
  FileChangeHandler,
  ProgressHandler,
  ErrorHandler,
  IOutputProcessor,
  IAgentAdapter,
} from "./types.js";

export { DEFAULT_USAGE_METRICS } from "./types.js";

// ACP SessionUpdate coalescing for storage
export { SessionUpdateCoalescer } from "./session-update-coalescer.js";
export type {
  CoalescedSessionUpdate,
  AgentMessageComplete,
  AgentThoughtComplete,
  ToolCallComplete,
  UserMessageComplete,
} from "./coalesced-types.js";
export {
  isCoalescedUpdate,
  serializeCoalescedUpdate,
  deserializeCoalescedUpdate,
} from "./coalesced-types.js";
