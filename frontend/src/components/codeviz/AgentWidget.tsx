/**
 * AgentWidget - Overlay component for displaying agent execution status on the code map.
 *
 * Shows:
 * - Agent type icon and name
 * - Execution status with color indicator
 * - Progress information when available
 */

import { Bot, CircleDashed, Loader2, CheckCircle2, XCircle, Pause } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExecutionStatus } from '@/types/execution'

/**
 * Props for the AgentWidget component
 */
export interface AgentWidgetProps {
  /** Execution ID for this agent */
  executionId: string
  /** Type of agent (claude-code, codex, copilot, cursor) */
  agentType: string
  /** Current execution status */
  status: ExecutionStatus
  /** Assigned color for this agent (hex) */
  color: string
  /** Whether this widget is currently selected */
  isSelected?: boolean
  /** Click handler for selection */
  onClick?: () => void
  /** Optional prompt preview */
  prompt?: string
  /** Number of files being changed */
  fileCount?: number
}

/**
 * Status configuration for visual indicators
 */
const STATUS_CONFIG: Record<
  ExecutionStatus,
  { icon: typeof Loader2; label: string; className: string }
> = {
  preparing: {
    icon: CircleDashed,
    label: 'Preparing',
    className: 'text-yellow-500',
  },
  pending: {
    icon: CircleDashed,
    label: 'Pending',
    className: 'text-yellow-500',
  },
  running: {
    icon: Loader2,
    label: 'Running',
    className: 'text-green-500 animate-spin',
  },
  paused: {
    icon: Pause,
    label: 'Paused',
    className: 'text-orange-500',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    className: 'text-green-500',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    className: 'text-red-500',
  },
  cancelled: {
    icon: XCircle,
    label: 'Cancelled',
    className: 'text-gray-500',
  },
  stopped: {
    icon: XCircle,
    label: 'Stopped',
    className: 'text-gray-500',
  },
}

/**
 * Format agent type for display
 */
function formatAgentType(agentType: string): string {
  const displayNames: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
  }
  return displayNames[agentType] || agentType
}

/**
 * AgentWidget component displays agent status as a floating card overlay.
 *
 * Visual design:
 * - Compact card with agent icon, name, and status
 * - Color-coded border based on assigned agent color
 * - Status indicator with animated icon for active states
 * - Hover effect reveals additional info
 */
export function AgentWidget({
  executionId,
  agentType,
  status,
  color,
  isSelected = false,
  onClick,
  prompt,
  fileCount,
}: AgentWidgetProps) {
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.pending
  const StatusIcon = statusConfig.icon

  return (
    <button
      onClick={onClick}
      className={cn(
        // Base styles
        'group flex min-w-[140px] cursor-pointer flex-col gap-1 rounded-lg border-l-4 bg-background/95 px-3 py-2 text-left shadow-lg backdrop-blur transition-all',
        // Hover and interaction states
        'hover:shadow-xl hover:ring-2 hover:ring-primary/20',
        // Selected state
        isSelected && 'ring-2 ring-primary shadow-xl'
      )}
      style={{ borderLeftColor: color }}
      data-testid={`agent-widget-${executionId}`}
      aria-label={`${formatAgentType(agentType)} - ${statusConfig.label}`}
    >
      {/* Header with agent type */}
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4" style={{ color }} />
        <span className="text-sm font-medium">{formatAgentType(agentType)}</span>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-1.5">
        <StatusIcon className={cn('h-3 w-3', statusConfig.className)} />
        <span className="text-xs text-muted-foreground">{statusConfig.label}</span>
      </div>

      {/* File count - shown on hover or when selected */}
      {fileCount !== undefined && fileCount > 0 && (
        <div
          className={cn(
            'text-xs text-muted-foreground transition-opacity',
            !isSelected && 'opacity-0 group-hover:opacity-100'
          )}
        >
          {fileCount} file{fileCount !== 1 ? 's' : ''} changed
        </div>
      )}

      {/* Prompt preview - shown only when selected */}
      {isSelected && prompt && (
        <div className="mt-1 max-w-[200px] truncate border-t pt-1 text-xs text-muted-foreground">
          {prompt}
        </div>
      )}
    </button>
  )
}

/**
 * Compact version of AgentWidget for use in dense layouts
 */
export interface AgentBadgeProps {
  agentType: string
  status: ExecutionStatus
  color: string
  onClick?: () => void
}

export function AgentBadge({ agentType, status, color, onClick }: AgentBadgeProps) {
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.pending
  const StatusIcon = statusConfig.icon

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-full bg-background/95 px-2 py-0.5 text-xs shadow-md backdrop-blur transition-all hover:shadow-lg"
      style={{ borderColor: color, borderWidth: '2px', borderStyle: 'solid' }}
      aria-label={`${formatAgentType(agentType)} - ${statusConfig.label}`}
    >
      <StatusIcon className={cn('h-3 w-3', statusConfig.className)} />
      <span>{formatAgentType(agentType)}</span>
    </button>
  )
}
