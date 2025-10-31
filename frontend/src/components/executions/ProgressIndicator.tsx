/**
 * ProgressIndicator Component
 *
 * Displays progress metrics including tool calls, files, tokens, and cost.
 * Updates in real-time from STATE_DELTA events.
 */

import type { State } from '@ag-ui/core'

export interface ProgressIndicatorProps {
  /**
   * Current execution state
   */
  state: State

  /**
   * Number of tool calls
   */
  toolCallCount?: number

  /**
   * Number of completed tool calls
   */
  completedToolCalls?: number

  /**
   * Number of messages
   */
  messageCount?: number

  /**
   * Execution start time
   */
  startTime?: number | null

  /**
   * Execution end time
   */
  endTime?: number | null

  /**
   * Custom class name
   */
  className?: string
}

/**
 * ProgressIndicator Component
 *
 * @example
 * ```tsx
 * <ProgressIndicator
 *   state={state}
 *   toolCallCount={5}
 *   completedToolCalls={3}
 *   messageCount={2}
 * />
 * ```
 */
export function ProgressIndicator({
  state,
  toolCallCount = 0,
  completedToolCalls = 0,
  messageCount = 0,
  startTime,
  endTime,
  className = '',
}: ProgressIndicatorProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {/* Progress Bar */}
      {state.progress !== undefined && state.totalSteps && (
        <div>
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
            <span>Progress</span>
            <span>
              {state.progress} / {state.totalSteps}
            </span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.min(100, (state.progress / state.totalSteps) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Tool Calls */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Tool Calls</div>
          <div className="text-2xl font-semibold">{toolCallCount}</div>
          {completedToolCalls > 0 && (
            <div className="text-xs text-muted-foreground">
              {completedToolCalls} completed
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Messages</div>
          <div className="text-2xl font-semibold">{messageCount}</div>
        </div>

        {/* Files Changed (from state) */}
        {state.filesChanged !== undefined && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Files Changed</div>
            <div className="text-2xl font-semibold">{state.filesChanged}</div>
          </div>
        )}

        {/* Token Usage */}
        {state.tokenUsage !== undefined && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Tokens</div>
            <div className="text-2xl font-semibold">
              {state.tokenUsage.toLocaleString()}
            </div>
          </div>
        )}

        {/* Cost */}
        {state.cost !== undefined && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Cost</div>
            <div className="text-2xl font-semibold">
              ${state.cost.toFixed(4)}
            </div>
          </div>
        )}

        {/* Duration */}
        {startTime && endTime && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Duration</div>
            <div className="text-2xl font-semibold">
              {((endTime - startTime) / 1000).toFixed(2)}s
            </div>
          </div>
        )}
      </div>

      {/* Additional State Metrics */}
      {Object.keys(state).length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            View all metrics
          </summary>
          <pre className="mt-2 bg-muted/50 p-2 rounded overflow-x-auto">
            {JSON.stringify(state, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
