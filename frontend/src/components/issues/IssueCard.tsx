import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KanbanCard } from '@/components/ui/kanban'
import type { Issue } from '@sudocode-ai/types'
import type { Execution } from '@/types/execution'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { ExecutionPreview } from '@/components/executions/ExecutionPreview'
import { executionsApi } from '@/lib/api'

// Priority badge colors - using darker shades for better contrast with white text
const priorityColors: Record<number, string> = {
  0: 'bg-red-600 dark:bg-red-700',
  1: 'bg-orange-600 dark:bg-orange-700',
  2: 'bg-yellow-600 dark:bg-yellow-700',
  3: 'bg-blue-600 dark:bg-blue-700',
  4: 'bg-gray-600 dark:bg-gray-700',
}

const priorityLabels: Record<number, string> = {
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
}

interface IssueCardProps {
  issue: Issue
  index: number
  status: string
  onViewDetails?: (issue: Issue) => void
  isOpen?: boolean
  showExecutionPreview?: boolean // Whether to show execution preview for running executions
}

export function IssueCard({ issue, index, status, onViewDetails, isOpen, showExecutionPreview = false }: IssueCardProps) {
  const navigate = useNavigate()
  const [isCopied, setIsCopied] = useState(false)
  const [latestExecution, setLatestExecution] = useState<Execution | null>(null)
  const [loadingExecution, setLoadingExecution] = useState(false)

  const handleClick = useCallback(() => {
    // If onViewDetails is provided, use it (for backward compatibility)
    // Otherwise, navigate to the detail page
    if (onViewDetails) {
      onViewDetails(issue)
    } else {
      navigate(`/issues/${issue.id}`)
    }
  }, [issue, onViewDetails, navigate])

  const handleCopyId = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent card click
      try {
        await navigator.clipboard.writeText(issue.id)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
        toast.success('ID copied to clipboard', {
          duration: 2000,
        })
      } catch (error) {
        console.error('Failed to copy ID:', error)
        toast.error('Failed to copy ID')
      }
    },
    [issue.id]
  )

  const localRef = useRef<HTMLDivElement>(null)

  // Fetch latest execution if preview is enabled
  useEffect(() => {
    if (!showExecutionPreview) return

    const fetchLatestExecution = async () => {
      try {
        setLoadingExecution(true)
        const executions = await executionsApi.list(issue.id)
        // Get the most recent execution
        if (executions && executions.length > 0) {
          const sorted = executions.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
          setLatestExecution(sorted[0])
        }
      } catch (error) {
        console.error('Failed to fetch executions:', error)
      } finally {
        setLoadingExecution(false)
      }
    }

    fetchLatestExecution()
  }, [issue.id, showExecutionPreview])

  useEffect(() => {
    if (!isOpen || !localRef.current) return
    const el = localRef.current
    requestAnimationFrame(() => {
      el.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      })
    })
  }, [isOpen])

  return (
    <KanbanCard
      key={issue.id}
      id={issue.id}
      name={issue.title}
      index={index}
      parent={status}
      onClick={handleClick}
      isOpen={isOpen}
      forwardedRef={localRef}
      className={issue.archived ? 'opacity-60' : ''}
    >
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="group flex items-center gap-1">
            <div className="text-xs text-muted-foreground">{issue.id}</div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyId}
                    className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isCopied ? 'Copied!' : 'Copy ID to Clipboard'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {/* Priority Badge */}
          {issue.priority !== undefined && issue.priority <= 3 && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs text-white ${priorityColors[issue.priority]}`}
            >
              {priorityLabels[issue.priority]}
            </span>
          )}
        </div>
        <h4 className="text-md line-clamp-2 min-w-0 flex-1 font-medium">{issue.title}</h4>
        {/* Content Preview */}
        {issue.content && !latestExecution && (
          <p className="line-clamp-2 break-words text-xs text-muted-foreground">
            {(() => {
              // Simple markdown stripping - remove headers, formatting, etc.
              const plainText = issue.content
                .replace(/^#+ /gm, '') // Remove headers
                .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
                .replace(/\*(.+?)\*/g, '$1') // Remove italic
                .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
                .replace(/`(.+?)`/g, '$1') // Remove inline code
                .trim()

              return plainText.length > 100 ? `${plainText.substring(0, 100)}...` : plainText
            })()}
          </p>
        )}

        {/* Execution Preview */}
        {showExecutionPreview && latestExecution && !loadingExecution && (
          <div className="w-full border-t pt-2">
            <ExecutionPreview
              executionId={latestExecution.id}
              execution={latestExecution}
              variant="compact"
              showStatusLabel={false}
            />
          </div>
        )}
      </div>
    </KanbanCard>
  )
}
