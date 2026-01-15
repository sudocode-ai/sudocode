/**
 * ConflictPanel Component
 *
 * Displays merge/rebase conflicts for an execution and provides
 * resolution options (keep mine, accept theirs, or manual).
 *
 * @module components/executions/ConflictPanel
 */

import { useState } from 'react'
import {
  AlertTriangle,
  FileWarning,
  Check,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useConflictResolution,
  type ExecutionConflict,
  type ConflictStrategy,
} from '@/hooks/useConflictResolution'
import { cn } from '@/lib/utils'

interface ConflictPanelProps {
  executionId: string
  /** Worktree path - if provided, shows "Open in Editor" button */
  worktreePath?: string | null
  /** Callback when all conflicts are resolved */
  onAllResolved?: () => void
  /** Whether the panel is initially collapsed */
  defaultCollapsed?: boolean
}

/**
 * Get conflict type badge props
 */
function getConflictTypeBadge(type: 'code' | 'jsonl' | 'binary') {
  switch (type) {
    case 'code':
      return { variant: 'destructive' as const, label: 'Code' }
    case 'jsonl':
      return { variant: 'secondary' as const, label: 'JSONL' }
    case 'binary':
      return { variant: 'outline' as const, label: 'Binary' }
  }
}

/**
 * Individual conflict row component
 */
function ConflictRow({
  conflict,
  onResolve,
  isResolving,
  worktreePath,
}: {
  conflict: ExecutionConflict
  onResolve: (conflictId: string, strategy: ConflictStrategy) => void
  isResolving: boolean
  worktreePath?: string | null
}) {
  const typeBadge = getConflictTypeBadge(conflict.type)
  const isResolved = !!conflict.resolved_at

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 px-3 py-2 rounded-md border',
        isResolved
          ? 'bg-muted/50 border-muted'
          : 'bg-destructive/5 border-destructive/20'
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <FileWarning
          className={cn(
            'h-4 w-4 flex-shrink-0',
            isResolved ? 'text-muted-foreground' : 'text-destructive'
          )}
        />
        <span
          className={cn(
            'text-sm font-mono truncate',
            isResolved && 'text-muted-foreground line-through'
          )}
          title={conflict.path}
        >
          {conflict.path}
        </span>
        <Badge variant={typeBadge.variant} className="flex-shrink-0 text-xs">
          {typeBadge.label}
        </Badge>
        {conflict.auto_resolvable && !isResolved && (
          <Badge variant="outline" className="flex-shrink-0 text-xs">
            Auto-resolvable
          </Badge>
        )}
        {isResolved && (
          <Badge variant="secondary" className="flex-shrink-0 text-xs">
            <Check className="h-3 w-3 mr-1" />
            {conflict.resolution_strategy}
          </Badge>
        )}
      </div>

      {!isResolved && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResolve(conflict.id, 'ours')}
                  disabled={isResolving}
                  className="h-7 px-2 text-xs"
                >
                  Keep Mine
                </Button>
              </TooltipTrigger>
              <TooltipContent>Use your version of this file</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResolve(conflict.id, 'theirs')}
                  disabled={isResolving}
                  className="h-7 px-2 text-xs"
                >
                  Accept Theirs
                </Button>
              </TooltipTrigger>
              <TooltipContent>Use the incoming version</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {worktreePath && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onResolve(conflict.id, 'manual')}
                    disabled={isResolving}
                    className="h-7 px-2"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Mark as manually resolved</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ConflictPanel Component
 *
 * Shows conflict list and resolution options for an execution
 */
export function ConflictPanel({
  executionId,
  worktreePath,
  onAllResolved,
  defaultCollapsed = false,
}: ConflictPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  const {
    conflicts,
    unresolvedConflicts,
    hasUnresolved,
    isLoading,
    isResolving,
    isResolvingAll,
    resolveConflict,
    resolveAll,
    refetchConflicts,
  } = useConflictResolution(executionId, {
    onAllResolved,
  })

  // Don't render if no conflicts
  if (!isLoading && conflicts.length === 0) {
    return null
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2 cursor-pointer',
          hasUnresolved ? 'bg-destructive/10' : 'bg-muted/50'
        )}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn('h-4 w-4', hasUnresolved ? 'text-destructive' : 'text-muted-foreground')}
          />
          <span className="font-medium text-sm">
            {hasUnresolved
              ? `${unresolvedConflicts.length} Unresolved Conflict${unresolvedConflicts.length !== 1 ? 's' : ''}`
              : 'All Conflicts Resolved'}
          </span>
          {conflicts.length > unresolvedConflicts.length && (
            <span className="text-xs text-muted-foreground">
              ({conflicts.length - unresolvedConflicts.length} resolved)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              refetchConflicts()
            }}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
          </Button>
          {isCollapsed ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="p-3 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Bulk actions */}
              {hasUnresolved && unresolvedConflicts.length > 1 && (
                <div className="flex items-center gap-2 pb-2 border-b">
                  <span className="text-xs text-muted-foreground">Bulk Actions:</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolveAll('ours')}
                    disabled={isResolvingAll}
                    className="h-7 text-xs"
                  >
                    {isResolvingAll ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Keep All Mine
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolveAll('theirs')}
                    disabled={isResolvingAll}
                    className="h-7 text-xs"
                  >
                    {isResolvingAll ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Accept All Theirs
                  </Button>
                </div>
              )}

              {/* Conflict list */}
              <div className="space-y-2">
                {conflicts.map((conflict) => (
                  <ConflictRow
                    key={conflict.id}
                    conflict={conflict}
                    onResolve={resolveConflict}
                    isResolving={isResolving}
                    worktreePath={worktreePath}
                  />
                ))}
              </div>

              {/* Help text */}
              {hasUnresolved && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  <p>
                    <strong>Keep Mine:</strong> Uses your local changes
                  </p>
                  <p>
                    <strong>Accept Theirs:</strong> Uses the incoming changes
                  </p>
                  {worktreePath && (
                    <p>
                      <strong>Manual:</strong> Open in editor to resolve manually, then mark as
                      resolved
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
