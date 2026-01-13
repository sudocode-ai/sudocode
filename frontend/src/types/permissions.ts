/**
 * Permission types for ACP interactive mode
 *
 * These types represent permission requests from agents running in
 * interactive permission mode, where the agent asks the user to
 * approve or deny tool operations.
 *
 * @module types/permissions
 */

/**
 * A permission option kind (maps to ACP PermissionOptionKind)
 */
export type PermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'deny_once'
  | 'deny_always'

/**
 * A single permission option presented to the user
 */
export interface PermissionOption {
  /** Unique identifier for this option */
  optionId: string
  /** Display name for this option */
  name: string
  /** Kind of permission (affects UI treatment) */
  kind: PermissionOptionKind
}

/**
 * Tool call information for a permission request
 */
export interface PermissionToolCall {
  /** Unique ID for the tool call */
  toolCallId: string
  /** Tool title (e.g., "Bash", "Write", "Edit") */
  title: string
  /** Current status */
  status: string
  /** Raw input to the tool (command, file path, etc.) */
  rawInput?: unknown
}

/**
 * A permission request from the agent
 */
export interface PermissionRequest {
  /** Unique ID for this permission request */
  requestId: string
  /** Session this request belongs to */
  sessionId: string
  /** The tool call that triggered this request */
  toolCall: PermissionToolCall
  /** Available options for the user to choose from */
  options: PermissionOption[]
  /** Whether this request has been responded to */
  responded: boolean
  /** The selected option ID (after response) */
  selectedOptionId?: string
  /** Timestamp when the request was received */
  timestamp: Date
  /** Optional index for stable ordering when timestamps are equal */
  index?: number
}

/**
 * Permission request session update (from ACP)
 */
export interface PermissionRequestUpdate {
  sessionUpdate: 'permission_request'
  requestId: string
  sessionId: string
  toolCall: PermissionToolCall
  options: PermissionOption[]
}
