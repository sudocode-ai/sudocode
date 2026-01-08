/**
 * ToolCallViewer Component
 *
 * Displays a list of tool calls with their status, arguments, and results.
 * Supports expand/collapse for detailed information.
 */

import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import type { ToolCallTracking } from '@/types/stream'

export interface ToolCallViewerProps {
  /**
   * Map of tool calls to display
   */
  toolCalls: Map<string, ToolCallTracking>

  /**
   * Custom class name
   */
  className?: string
}

/**
 * ToolCallViewer Component
 *
 * @example
 * ```tsx
 * <ToolCallViewer toolCalls={toolCalls} />
 * ```
 */
export function ToolCallViewer({ toolCalls, className = '' }: ToolCallViewerProps) {
  const toolCallArray = Array.from(toolCalls.values())

  if (toolCallArray.length === 0) {
    return null
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-sm font-medium">Tool Calls</h4>
      {toolCallArray.map((toolCall) => (
        <div
          key={toolCall.toolCallId}
          className="rounded-md border bg-card p-3 text-sm"
        >
          {/* Tool Call Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{toolCall.toolCallName}</span>
              <Badge
                variant={
                  toolCall.status === 'completed'
                    ? 'default'
                    : toolCall.status === 'error'
                    ? 'destructive'
                    : 'secondary'
                }
                className="text-xs"
              >
                {toolCall.status === 'executing' && (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                )}
                {toolCall.status}
              </Badge>
            </div>
            {toolCall.endTime && toolCall.startTime && (
              <span className="text-xs text-muted-foreground">
                {((toolCall.endTime - toolCall.startTime) / 1000).toFixed(2)}s
              </span>
            )}
          </div>

          {/* Tool Arguments */}
          {toolCall.args && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Arguments
              </summary>
              <pre className="mt-1 text-xs bg-muted/50 p-2 rounded overflow-x-auto">
                {toolCall.args}
              </pre>
            </details>
          )}

          {/* Tool Result */}
          {toolCall.result && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Result
              </summary>
              <pre className="mt-1 text-xs bg-muted/50 p-2 rounded overflow-x-auto max-h-40">
                {toolCall.result}
              </pre>
            </details>
          )}

          {/* Tool Error */}
          {toolCall.error && (
            <div className="mt-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
              <span className="font-medium">Error:</span> {toolCall.error}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
