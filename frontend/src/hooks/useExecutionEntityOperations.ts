/**
 * useExecutionEntityOperations Hook
 *
 * Processes tool calls from an execution chain and extracts entity operations
 * (create/update, read, link, feedback).
 *
 * @module hooks/useExecutionEntityOperations
 */

import { useMemo } from 'react'
import type { ToolCallTracking } from './useAgUiStream'
import type { EntityOperation } from '../types/execution'

/**
 * MCP sudocode tool names we care about
 */
const MCP_TOOL_NAMES = [
  'upsert_issue',
  'upsert_spec',
  'show_issue',
  'show_spec',
  'link',
  'add_feedback',
  'list_issues',
  'list_specs',
] as const

/**
 * Hook return type
 */
export interface UseExecutionEntityOperationsReturn {
  updated: EntityOperation[]
  linked: EntityOperation[]
  read: EntityOperation[]
  listOperations: EntityOperation[]
}

/**
 * Extract entity ID from parsed args based on tool name
 */
function extractEntityId(toolName: string, args: any): string | null {
  switch (toolName) {
    case 'upsert_issue':
      return args.issue_id || null
    case 'upsert_spec':
      return args.spec_id || null
    case 'show_issue':
      return args.issue_id || null
    case 'show_spec':
      return args.spec_id || null
    case 'link':
      return args.from_id || null
    case 'add_feedback':
      return args.issue_id || null
    default:
      return null
  }
}

/**
 * Extract entity type from entity ID
 */
function extractEntityType(entityId: string): 'issue' | 'spec' | null {
  if (entityId.startsWith('i-')) return 'issue'
  if (entityId.startsWith('s-')) return 'spec'
  return null
}

/**
 * Parse tool call args and extract entity operation
 */
function parseToolCall(toolCall: ToolCallTracking): EntityOperation | null {
  const toolName = toolCall.toolCallName

  // Check if this is an MCP sudocode tool call
  if (!toolName.includes('sudocode')) {
    return null
  }

  // Extract the actual tool name (e.g., "mcp__plugin_sudocode_sudocode__upsert_issue" -> "upsert_issue")
  const actualToolName = MCP_TOOL_NAMES.find((name) => toolName.includes(name))
  if (!actualToolName) {
    return null
  }

  // Parse args JSON
  let parsedArgs: any
  try {
    parsedArgs = JSON.parse(toolCall.args)
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Failed to parse tool call args for ${toolName}:`, error)
    }
    return null
  }

  // Handle list operations separately (no specific entity ID)
  if (actualToolName === 'list_issues' || actualToolName === 'list_specs') {
    return {
      operationType: 'list',
      entityId: '', // No specific entity ID for list operations
      entityType: actualToolName === 'list_issues' ? 'issue' : 'spec',
      timestamp: toolCall.startTime,
      toolCallId: toolCall.toolCallId,
    }
  }

  // Extract entity ID based on tool name
  const entityId = extractEntityId(actualToolName, parsedArgs)
  if (!entityId) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Missing entity ID in tool call ${actualToolName}:`, parsedArgs)
    }
    return null
  }

  const entityType = extractEntityType(entityId)
  if (!entityType) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Invalid entity ID format: ${entityId}`)
    }
    return null
  }

  // Determine operation type
  let operationType: EntityOperation['operationType']
  if (actualToolName === 'upsert_issue' || actualToolName === 'upsert_spec') {
    operationType = 'upsert'
  } else if (actualToolName === 'show_issue' || actualToolName === 'show_spec') {
    operationType = 'read'
  } else if (actualToolName === 'link') {
    operationType = 'link'
  } else if (actualToolName === 'add_feedback') {
    operationType = 'feedback'
  } else {
    return null
  }

  const operation: EntityOperation = {
    operationType,
    entityId,
    entityType,
    timestamp: toolCall.startTime,
    toolCallId: toolCall.toolCallId,
  }

  // Add link target if this is a link operation
  if (operationType === 'link' && parsedArgs.to_id && parsedArgs.type) {
    const targetEntityType = extractEntityType(parsedArgs.to_id)
    if (targetEntityType) {
      operation.linkTarget = {
        entityId: parsedArgs.to_id,
        entityType: targetEntityType,
        relationshipType: parsedArgs.type,
      }
    }
  }

  // Add feedback target if this is a feedback operation
  if (operationType === 'feedback' && parsedArgs.to_id) {
    const targetEntityType = extractEntityType(parsedArgs.to_id)
    if (targetEntityType) {
      operation.feedbackTarget = {
        entityId: parsedArgs.to_id,
        entityType: targetEntityType,
      }
    }
  }

  return operation
}

/**
 * Deduplicate operations by entity ID (keep latest timestamp)
 */
function deduplicateOperations(operations: EntityOperation[]): EntityOperation[] {
  const map = new Map<string, EntityOperation>()

  for (const op of operations) {
    const key = op.entityId
    const existing = map.get(key)

    if (!existing || op.timestamp > existing.timestamp) {
      map.set(key, op)
    }
  }

  return Array.from(map.values())
}

/**
 * useExecutionEntityOperations Hook
 *
 * Processes tool calls from an execution chain and extracts entity operations.
 *
 * @example
 * ```typescript
 * const { updated, linked, read, listOperations } = useExecutionEntityOperations(toolCallsMap)
 * ```
 */
export function useExecutionEntityOperations(
  toolCalls: Map<string, ToolCallTracking>
): UseExecutionEntityOperationsReturn {
  return useMemo(() => {
    const allOperations: EntityOperation[] = []

    // Parse all tool calls
    const toolCallsArray = Array.from(toolCalls.values())
    for (const toolCall of toolCallsArray) {
      const operation = parseToolCall(toolCall)
      if (operation) {
        allOperations.push(operation)
      }
    }

    // Categorize operations
    const updated: EntityOperation[] = []
    const linked: EntityOperation[] = []
    const read: EntityOperation[] = []
    const listOperations: EntityOperation[] = []

    for (const op of allOperations) {
      switch (op.operationType) {
        case 'upsert':
          updated.push(op)
          break
        case 'link':
          linked.push(op)
          break
        case 'read':
          read.push(op)
          break
        case 'list':
          listOperations.push(op)
          break
        case 'feedback':
          // Feedback is tracked separately, but we could add it to a category if needed
          break
      }
    }

    // Deduplicate each category (keep latest timestamp)
    return {
      updated: deduplicateOperations(updated),
      linked: deduplicateOperations(linked),
      read: deduplicateOperations(read),
      listOperations: deduplicateOperations(listOperations),
    }
  }, [toolCalls])
}
