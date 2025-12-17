import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Pause, Copy, Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SyncIndicator } from '@/components/issues/SyncIndicator'
import { toast } from 'sonner'
import type { Spec } from '@/types/api'
import type { Workflow } from '@/types/workflow'
import { cn } from '@/lib/utils'

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

interface SpecCardProps {
  spec: Spec
  onClick?: (spec: Spec) => void
  /** Active workflow for this spec (if any) */
  activeWorkflow?: Workflow
}

export function SpecCard({
  spec,
  onClick,
  activeWorkflow,
}: SpecCardProps) {
  const navigate = useNavigate()
  const [isCopied, setIsCopied] = useState(false)

  const handleClick = useCallback(() => {
    onClick?.(spec)
  }, [spec, onClick])

  const handleCopyId = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent card click
      try {
        await navigator.clipboard.writeText(spec.id)
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
    [spec.id]
  )

  const handleWorkflowBadgeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent card click
      if (activeWorkflow) {
        navigate(`/workflows/${activeWorkflow.id}`)
      }
    },
    [activeWorkflow, navigate]
  )

  // Extract preview text from content (first 200 chars)
  const preview = spec.content
    ? spec.content.slice(0, 200) + (spec.content.length > 200 ? '...' : '')
    : ''

  return (
    <TooltipProvider>
      <Card
        className={`cursor-pointer border border-border p-4 transition-shadow hover:shadow-md ${spec.archived ? 'opacity-60' : ''}`}
        onClick={handleClick}
      >
        <div className="flex flex-col gap-3">
          {/* Header with ID, priority, and workflow indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="group flex items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">{spec.id}</span>
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
              </div>
              {/* Active workflow indicator */}
              {activeWorkflow && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleWorkflowBadgeClick}
                      className={cn(
                        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white transition-colors',
                        activeWorkflow.status === 'running'
                          ? 'bg-blue-500 hover:bg-blue-600'
                          : activeWorkflow.status === 'paused'
                            ? 'bg-yellow-500 hover:bg-yellow-600'
                            : 'bg-gray-500 hover:bg-gray-600'
                      )}
                    >
                      {activeWorkflow.status === 'running' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : activeWorkflow.status === 'paused' ? (
                        <Pause className="h-3 w-3" />
                      ) : null}
                      <span className="capitalize">{activeWorkflow.status}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View workflow: {activeWorkflow.title}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Sync Indicator for external integrations */}
              {spec.external_links && spec.external_links.length > 0 && (
                <SyncIndicator externalLinks={spec.external_links} variant="spec" />
              )}
              {spec.priority !== undefined && spec.priority <= 3 && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs text-white ${priorityColors[spec.priority]}`}
                >
                  {priorityLabels[spec.priority]}
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <h3 className="line-clamp-2 text-lg font-semibold">{spec.title}</h3>

          {/* Preview */}
          {preview && <p className="line-clamp-3 text-sm text-muted-foreground">{preview}</p>}

          {/* Footer with file path */}
          {spec.file_path && (
            <p className="truncate font-mono text-xs text-muted-foreground">{spec.file_path}</p>
          )}
        </div>
      </Card>
    </TooltipProvider>
  )
}
