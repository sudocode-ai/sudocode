import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Copy, Check, GitBranch, AlertCircle, FileText, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import type { Execution } from '@/types/execution'
import { cn } from '@/lib/utils'

interface WorktreeCardProps {
  execution: Execution
  isSelected?: boolean
  onClick?: () => void
}

// Status badge colors
const statusColors: Record<string, string> = {
  running: 'bg-blue-500 dark:bg-blue-600',
  paused: 'bg-yellow-500 dark:bg-yellow-600',
  completed: 'bg-green-500 dark:bg-green-600',
  failed: 'bg-red-500 dark:bg-red-600',
  cancelled: 'bg-gray-500 dark:bg-gray-600',
  stopped: 'bg-orange-500 dark:bg-orange-600',
}

const statusLabels: Record<string, string> = {
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  stopped: 'Stopped',
}

export function WorktreeCard({ execution, isSelected, onClick }: WorktreeCardProps) {
  const navigate = useNavigate()
  const [isCopied, setIsCopied] = useState(false)

  const handleCopyId = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(execution.id)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
        toast.success('Execution ID copied to clipboard', {
          duration: 2000,
        })
      } catch (error) {
        console.error('Failed to copy ID:', error)
        toast.error('Failed to copy ID')
      }
    },
    [execution.id]
  )

  const handleNavigateToIssue = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      navigate(`/issues/${execution.issue_id}`)
    },
    [navigate, execution.issue_id]
  )

  const handleNavigateToExecution = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      navigate(`/executions/${execution.id}`)
    },
    [navigate, execution.id]
  )

  const fileCount = execution.files_changed?.length ?? 0
  const hasConflicts = false // TODO: Fetch conflicts from sync preview if needed

  return (
    <Card
      className={cn(
        'group cursor-pointer transition-all hover:shadow-md',
        isSelected && 'ring-2 ring-primary'
      )}
      onClick={onClick}
    >
      <div className="flex flex-col gap-3 p-4">
        {/* Header: ID + Status */}
        <div className="flex items-center justify-between gap-2">
          <div className="group/id flex items-center gap-1">
            <span className="text-xs text-muted-foreground font-mono">
              {execution.id.substring(0, 8)}
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyId}
                    className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover/id:opacity-100"
                  >
                    {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isCopied ? 'Copied!' : 'Copy Execution ID'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Badge
            className={cn(
              'shrink-0 text-white',
              statusColors[execution.status] || 'bg-gray-500'
            )}
          >
            {statusLabels[execution.status] || execution.status}
          </Badge>
        </div>

        {/* Branch Name */}
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{execution.branch_name}</span>
        </div>

        {/* Issue Reference */}
        {execution.issue_id && (
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <button
              onClick={handleNavigateToIssue}
              className="text-xs text-primary hover:underline truncate"
            >
              {execution.issue_id}
            </button>
          </div>
        )}

        {/* Metadata Row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* File Count */}
          {fileCount > 0 && (
            <div className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              <span>{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
            </div>
          )}

          {/* Conflict Indicator */}
          {hasConflicts && (
            <div className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span>Conflicts</span>
            </div>
          )}

          {/* Last Updated */}
          <div className="ml-auto">
            {formatDistanceToNow(new Date(execution.updated_at), { addSuffix: true })}
          </div>
        </div>

        {/* Actions (visible on hover) */}
        <div className="flex items-center gap-1 pt-2 border-t opacity-0 transition-opacity group-hover:opacity-100">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNavigateToExecution}
                  className="h-7 text-xs"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Details
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View full execution details</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </Card>
  )
}
