/**
 * Stream Types
 *
 * Type definitions for execution streaming, used by trajectory components
 * and execution monitoring.
 *
 * Note: These Map-based types are legacy and retained for backwards compatibility
 * with callback interfaces like onToolCallsUpdate. New code should use the array-based
 * types from useSessionUpdateStream (AgentMessage[], ToolCall[]).
 */

/**
 * Message buffer for streaming text messages (legacy Map-based interface)
 * @deprecated Use AgentMessage from useSessionUpdateStream instead
 */
export interface MessageBuffer {
  messageId: string
  role: string
  content: string
  complete: boolean
  timestamp: number
  /** Sequential index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Tool call tracking (legacy Map-based interface)
 * @deprecated Use ToolCall from useSessionUpdateStream for new code.
 * This type is retained for onToolCallsUpdate callback compatibility.
 */
export interface ToolCallTracking {
  toolCallId: string
  toolCallName: string
  args: string
  status: 'started' | 'executing' | 'completed' | 'error'
  result?: string
  error?: string
  startTime: number
  endTime?: number
  /** Sequential index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Workflow execution tracking
 */
export interface WorkflowExecution {
  runId: string | null
  threadId: string | null
  status: 'idle' | 'running' | 'completed' | 'error'
  currentStep: string | null
  error: string | null
  startTime: number | null
  endTime: number | null
}
