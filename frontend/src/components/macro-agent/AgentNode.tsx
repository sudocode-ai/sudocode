/**
 * AgentNode - Custom React Flow node for macro-agent hierarchy
 * Displays agent state, task, and provides interactive selection
 */

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Loader2, Circle, StopCircle, Users, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentRecord } from '@/types/macro-agent'

// =============================================================================
// Types
// =============================================================================

export interface AgentNodeData {
  agent: AgentRecord
  isSelected?: boolean
  onSelect?: (agentId: string) => void
}

// =============================================================================
// State Styling
// =============================================================================

const STATE_STYLES = {
  spawning: {
    border: 'border-amber-500',
    background: 'bg-amber-50 dark:bg-amber-950/20',
    text: 'text-amber-700 dark:text-amber-300',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    handle: '!bg-amber-500',
  },
  running: {
    border: 'border-blue-500',
    background: 'bg-blue-50 dark:bg-blue-950/20',
    text: 'text-blue-700 dark:text-blue-300',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    handle: '!bg-blue-500',
  },
  stopped: {
    border: 'border-gray-400',
    background: 'bg-gray-50 dark:bg-gray-900/20',
    text: 'text-gray-600 dark:text-gray-400',
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400',
    handle: '!bg-gray-400',
  },
} as const

const STATE_LABELS = {
  spawning: 'Spawning',
  running: 'Running',
  stopped: 'Stopped',
} as const

// =============================================================================
// Status Icon Component
// =============================================================================

interface StatusIconProps {
  state: AgentRecord['state']
  className?: string
}

function StatusIcon({ state, className }: StatusIconProps) {
  const iconClass = cn('h-4 w-4', className)

  switch (state) {
    case 'spawning':
      return <Loader2 className={cn(iconClass, 'text-amber-500 animate-spin')} />
    case 'running':
      return <Circle className={cn(iconClass, 'text-blue-500 fill-blue-500')} />
    case 'stopped':
      return <StopCircle className={cn(iconClass, 'text-gray-400')} />
    default:
      return <Circle className={cn(iconClass, 'text-muted-foreground')} />
  }
}

// =============================================================================
// Status Badge Component
// =============================================================================

function StateBadge({ state }: { state: AgentRecord['state'] }) {
  const label = STATE_LABELS[state] || state
  const styles = STATE_STYLES[state] || STATE_STYLES.stopped

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        styles.badge
      )}
    >
      {label}
    </span>
  )
}

// =============================================================================
// Time Formatting
// =============================================================================

function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const seconds = Math.floor((now - timestamp) / 1000)

  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// =============================================================================
// Main Component
// =============================================================================

function AgentNodeComponent({ data }: NodeProps) {
  // Cast data to our expected type
  const nodeData = data as unknown as AgentNodeData
  const { agent, isSelected, onSelect } = nodeData
  const styles = STATE_STYLES[agent.state] || STATE_STYLES.stopped

  // Direct click handler for reliable selection
  const handleClick = useCallback(() => {
    onSelect?.(agent.id)
  }, [onSelect, agent.id])

  // Truncate agent ID and task
  const displayId = agent.id.length > 12 ? `${agent.id.slice(0, 12)}...` : agent.id
  const displayTask =
    agent.task.length > 40 ? `${agent.task.slice(0, 40)}...` : agent.task

  return (
    <>
      {/* Input handle (top) - for parent connection */}
      <Handle
        type="target"
        position={Position.Top}
        className={cn(
          '!h-2.5 !w-2.5 !border-2 !border-background !rounded-full transition-colors',
          styles.handle
        )}
      />

      {/* Node content */}
      <div
        onClick={handleClick}
        className={cn(
          'rounded-lg border-2 bg-background p-3 shadow-sm',
          'min-w-[200px] max-w-[260px]',
          'cursor-pointer select-none',
          'hover:bg-muted/50',
          styles.border,
          styles.background,
          isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
        )}
      >
        {/* Header: Status icon + Agent ID + State badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusIcon state={agent.state} />
            <span className="font-mono font-medium">{displayId}</span>
          </div>
          <StateBadge state={agent.state} />
        </div>

        {/* Divider */}
        <div className="my-2 border-t border-border/50" />

        {/* Task description */}
        <div
          className={cn(
            'text-sm font-medium leading-tight',
            styles.text,
            agent.state === 'stopped' && 'opacity-60'
          )}
        >
          {displayTask}
        </div>

        {/* Footer: Children count + Created time */}
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {agent.children_count > 0 && (
              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium">
                <Users className="h-3 w-3" />
                {agent.children_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 opacity-50" />
            <span className={cn(agent.state === 'running' && 'text-blue-500')}>
              {formatTimeAgo(agent.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Output handle (bottom) - for children connections */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          '!h-2.5 !w-2.5 !border-2 !border-background !rounded-full transition-colors',
          styles.handle
        )}
      />
    </>
  )
}

export const AgentNode = memo(AgentNodeComponent)
