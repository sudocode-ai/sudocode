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

export { ClaudeCodeOutputProcessor } from "./claude-code-output-processor.js";

export { AgUiEventAdapter } from "./ag-ui-adapter.js";
export type { AgUiEventListener } from "./ag-ui-adapter.js";

export {
  createAgUiSystem,
  wireManually,
  createAgUiSystemWithProcessor,
} from "./ag-ui-integration.js";
export type { AgUiSystem } from "./ag-ui-integration.js";
