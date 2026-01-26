/**
 * CheckpointNode - Custom React Flow node for checkpoint DAG visualization
 * Displays checkpoint info, stats, and provides interactive selection
 */

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitCommit, Plus, Minus, FileText, Check, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CheckpointNodeData, DiffStackReviewStatus } from '@/types/checkpoint'
import { REVIEW_STATUS_STYLES, REVIEW_STATUS_LABELS } from '@/types/checkpoint'

// =============================================================================
// Status Badge Component
// =============================================================================

interface StatusBadgeProps {
  inStack: boolean
  merged: boolean
  stackStatus?: DiffStackReviewStatus
}

function StatusBadge({ inStack, merged, stackStatus }: StatusBadgeProps) {
  if (merged) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        <Check className="h-3 w-3" />
        Merged
      </span>
    )
  }

  if (inStack && stackStatus) {
    const styles = REVIEW_STATUS_STYLES[stackStatus]
    const label = REVIEW_STATUS_LABELS[stackStatus]
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
          styles.background,
          styles.text
        )}
      >
        {label}
      </span>
    )
  }

  if (inStack) {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
        In Stack
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Unstacked
    </span>
  )
}

// =============================================================================
// Stats Display Component
// =============================================================================

interface StatsDisplayProps {
  filesChanged?: number
  additions?: number
  deletions?: number
}

function StatsDisplay({ filesChanged = 0, additions = 0, deletions = 0 }: StatsDisplayProps) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-0.5">
        <FileText className="h-3 w-3" />
        {filesChanged}
      </span>
      <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
        <Plus className="h-3 w-3" />
        {additions}
      </span>
      <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
        <Minus className="h-3 w-3" />
        {deletions}
      </span>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

function CheckpointNodeComponent({ data, selected }: NodeProps) {
  // Cast data to our expected type
  const nodeData = data as unknown as CheckpointNodeData
  const { checkpoint, stream, stats, isSelected, inStack, merged, onSelect } = nodeData

  // Handle click with multi-select support
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const multiSelect = event.metaKey || event.ctrlKey
      onSelect?.(checkpoint.id, multiSelect)
    },
    [onSelect, checkpoint.id]
  )

  // Get commit message truncated
  const message = checkpoint.message || 'No message'
  const needsTruncation = message.length > 40
  const displayMessage = needsTruncation ? `${message.slice(0, 40)}...` : message

  // Short commit SHA
  const shortSha = checkpoint.commitSha.slice(0, 7)

  // Format creation time
  const createdAt = new Date(checkpoint.createdAt)
  const timeAgo = formatTimeAgo(createdAt)

  // Determine border color based on stream
  const streamColor = stream ? `border-l-4` : ''

  return (
    <>
      {/* Input handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className={cn(
          '!h-2.5 !w-2.5 !border-2 !border-background !rounded-full transition-colors',
          merged ? '!bg-purple-500' : inStack ? '!bg-blue-500' : '!bg-muted-foreground'
        )}
      />

      {/* Node content */}
      <div
        onClick={handleClick}
        className={cn(
          'rounded-lg border-2 bg-background p-3 shadow-sm',
          'min-w-[200px] max-w-[260px]',
          'cursor-pointer select-none',
          'hover:bg-muted/50 transition-colors',
          streamColor,
          // Selection state
          isSelected || selected
            ? 'ring-2 ring-primary ring-offset-2 ring-offset-background border-primary'
            : 'border-muted',
          // Merged state
          merged && 'opacity-60'
        )}
        style={
          stream
            ? {
                borderLeftColor: (nodeData as any).streamColor || '#3b82f6',
              }
            : undefined
        }
      >
        {/* Header: Commit icon + SHA + Status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <GitCommit className="h-4 w-4" />
            <code className="font-mono font-medium">{shortSha}</code>
          </div>
          <StatusBadge inStack={inStack} merged={merged} />
        </div>

        {/* Divider */}
        <div className="my-2 border-t border-border/50" />

        {/* Commit message */}
        <div
          className={cn(
            'text-sm font-medium leading-tight',
            merged && 'line-through opacity-60'
          )}
          title={message}
        >
          {displayMessage}
        </div>

        {/* Footer: Stats + Time */}
        <div className="mt-2 flex items-center justify-between">
          <StatsDisplay
            filesChanged={stats?.filesChanged}
            additions={stats?.additions}
            deletions={stats?.deletions}
          />
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </div>
        </div>

        {/* Stream indicator */}
        {stream && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="truncate max-w-[180px]" title={stream.name}>
              {stream.name}
            </span>
          </div>
        )}
      </div>

      {/* Output handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          '!h-2.5 !w-2.5 !border-2 !border-background !rounded-full transition-colors',
          merged ? '!bg-purple-500' : inStack ? '!bg-blue-500' : '!bg-muted-foreground'
        )}
      />
    </>
  )
}

// =============================================================================
// Utility Functions
// =============================================================================

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

export const CheckpointNode = memo(CheckpointNodeComponent)
