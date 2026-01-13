/**
 * BatchCard - Display a single PR batch
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  GitPullRequest,
  GitMerge,
  ExternalLink,
  Trash2,
  MoreVertical,
  FileCode,
  RefreshCw,
  Clock,
  CheckCircle2,
  X,
  Edit,
} from 'lucide-react'
import type { PRBatch, BatchPRStatus, EnrichedBatch } from '@/types/batch'

interface BatchCardProps {
  batch: PRBatch | EnrichedBatch
  /** Called when edit is clicked */
  onEdit?: () => void
  /** Called when delete is clicked */
  onDelete?: () => void
  /** Called when create PR is clicked */
  onCreatePR?: () => void
  /** Called when sync status is clicked */
  onSyncStatus?: () => void
  /** Called when view PR is clicked */
  onViewPR?: () => void
  /** Is any action currently loading */
  isLoading?: boolean
}

/**
 * Get badge styling for PR status
 */
function getStatusBadge(status: BatchPRStatus) {
  switch (status) {
    case 'draft':
      return {
        label: 'Draft',
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
        icon: Clock,
      }
    case 'open':
      return {
        label: 'Open',
        className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        icon: GitPullRequest,
      }
    case 'approved':
      return {
        label: 'Approved',
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
        icon: CheckCircle2,
      }
    case 'merged':
      return {
        label: 'Merged',
        className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
        icon: GitMerge,
      }
    case 'closed':
      return {
        label: 'Closed',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        icon: X,
      }
    default:
      return {
        label: status,
        className: '',
        icon: Clock,
      }
  }
}

/**
 * Type guard to check if batch is enriched
 */
function isEnrichedBatch(batch: PRBatch | EnrichedBatch): batch is EnrichedBatch {
  return 'entries' in batch
}

export function BatchCard({
  batch,
  onEdit,
  onDelete,
  onCreatePR,
  onSyncStatus,
  onViewPR,
  isLoading,
}: BatchCardProps) {
  const statusBadge = getStatusBadge(batch.pr_status)
  const StatusIcon = statusBadge.icon
  const hasPR = !!batch.pr_number
  const canEdit = !hasPR
  const canDelete = batch.pr_status !== 'merged'

  const entryCount = batch.entry_ids.length
  const enriched = isEnrichedBatch(batch)

  return (
    <div
      className={`
        relative rounded-lg border bg-card p-4 transition-colors hover:border-primary/50
        ${batch.pr_status === 'merged' ? 'opacity-60' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h3 className="truncate font-medium">{batch.title}</h3>
          </div>

          {batch.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {batch.description}
            </p>
          )}
        </div>

        {/* Status badge */}
        <Badge className={statusBadge.className}>
          <StatusIcon className="mr-1 h-3 w-3" />
          {statusBadge.label}
        </Badge>
      </div>

      {/* Stats */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileCode className="h-3 w-3" />
          {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
        </span>

        <span>Target: {batch.target_branch}</span>

        {batch.pr_number && (
          <span className="flex items-center gap-1">
            <GitPullRequest className="h-3 w-3" />
            #{batch.pr_number}
          </span>
        )}

        {enriched && (
          <>
            {batch.total_additions > 0 && (
              <span className="text-green-600 dark:text-green-400">
                +{batch.total_additions}
              </span>
            )}
            {batch.total_deletions > 0 && (
              <span className="text-red-600 dark:text-red-400">
                -{batch.total_deletions}
              </span>
            )}
          </>
        )}
      </div>

      {/* Dependency warning */}
      {enriched && batch.has_dependency_violations && (
        <div className="mt-2 rounded bg-yellow-50 p-2 text-xs text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
          Circular dependency detected
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Primary action based on state */}
          {!hasPR ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  onClick={onCreatePR}
                  disabled={isLoading}
                >
                  <GitPullRequest className="mr-1 h-3 w-3" />
                  Create PR
                </Button>
              </TooltipTrigger>
              <TooltipContent>Create GitHub PR for this batch</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onViewPR}
                    disabled={isLoading}
                  >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    View PR
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open PR on GitHub</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onSyncStatus}
                    disabled={isLoading}
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sync PR status from GitHub</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
            )}
            {hasPR && batch.pr_url && (
              <DropdownMenuItem asChild>
                <a href={batch.pr_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open in GitHub
                </a>
              </DropdownMenuItem>
            )}
            {canDelete && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-red-600 dark:text-red-400"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
