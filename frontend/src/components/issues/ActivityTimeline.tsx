import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  MessageSquare,
  CheckCircle2,
  XCircle as XCircleIcon,
  Loader2,
  Clock,
  PauseCircle,
  StopCircle,
  PlayCircle,
} from 'lucide-react'
import type { IssueFeedback } from '@/types/api'
import type { Execution, ExecutionStatus } from '@/types/execution'

type ActivityItem =
  | (IssueFeedback & { itemType: 'feedback' })
  | (Execution & { itemType: 'execution' })
// Future: | Comment | StatusChange | etc.

interface ActivityTimelineProps {
  items: ActivityItem[]
  onDismissFeedback?: (id: string) => void
  onDeleteFeedback?: (id: string) => void
  className?: string
}

const STATUS_CONFIG: Record<
  ExecutionStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    icon: React.ReactNode
  }
> = {
  preparing: {
    label: 'Preparing',
    variant: 'secondary',
    icon: <Clock className="h-3 w-3" />,
  },
  pending: {
    label: 'Pending',
    variant: 'secondary',
    icon: <Clock className="h-3 w-3" />,
  },
  running: {
    label: 'Running',
    variant: 'default',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  paused: {
    label: 'Paused',
    variant: 'outline',
    icon: <PauseCircle className="h-3 w-3" />,
  },
  completed: {
    label: 'Completed',
    variant: 'default',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: <XCircleIcon className="h-3 w-3" />,
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'secondary',
    icon: <StopCircle className="h-3 w-3" />,
  },
  stopped: {
    label: 'Stopped',
    variant: 'secondary',
    icon: <StopCircle className="h-3 w-3" />,
  },
}

/**
 * Unified activity timeline for issues
 * Shows feedback, executions, and other activity in chronological order
 * Designed to be inline with issue content, like GitHub/Linear
 */
export function ActivityTimeline({
  items,
  onDismissFeedback,
  onDeleteFeedback,
  className = '',
}: ActivityTimelineProps) {
  const navigate = useNavigate()

  // Sort items chronologically (oldest first)
  const sortedItems = [...items].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  if (sortedItems.length === 0) {
    return (
      <div className={`text-center text-sm text-muted-foreground ${className}`}>
        No activity yet
      </div>
    )
  }

  const getFeedbackTypeColor = (type: string) => {
    switch (type) {
      case 'comment':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'suggestion':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
      case 'request':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    }
  }

  const renderFeedback = (feedback: IssueFeedback) => {
    return (
      <div key={feedback.id} className="group relative">
        <Card
          className={`rounded-r-md border-l-4 border-l-blue-700/50 bg-blue-50/50 p-4 transition-opacity dark:bg-blue-950/20 ${feedback.dismissed ? 'opacity-50' : ''}`}
        >
          {/* Header */}
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <Badge className={`text-xs ${getFeedbackTypeColor(feedback.feedback_type)}`}>
                {feedback.feedback_type}
              </Badge>
              <button onClick={() => navigate(`/issues/${feedback.from_id}`)}>
                <Badge variant="issue" className="cursor-pointer font-mono text-xs hover:opacity-80">
                  {feedback.from_id}
                </Badge>
              </button>
              {/* Agent info if present */}
              {feedback.agent ? (
                <span className="text-xs text-muted-foreground">
                  {feedback.agent}{' '}
                  {formatDistanceToNow(new Date(feedback.created_at), { addSuffix: true })}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(feedback.created_at), { addSuffix: true })}
                </span>
              )}
              {feedback.dismissed && (
                <Badge variant="secondary" className="text-xs">
                  dismissed
                </Badge>
              )}
            </div>
          </div>

          {/* Anchor info if present */}
          {feedback.anchor &&
            (() => {
              try {
                const anchor = JSON.parse(feedback.anchor)
                if (anchor.line_number || anchor.text_snippet) {
                  return (
                    <div className="mt-2 rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                      {anchor.line_number && <span>Line {anchor.line_number}: </span>}
                      {anchor.text_snippet && (
                        <span className="font-mono italic">
                          &ldquo;{anchor.text_snippet}&rdquo;
                        </span>
                      )}
                    </div>
                  )
                }
              } catch (e) {
                // Invalid JSON, ignore
              }
              return null
            })()}
          {/* Content */}
          <div className="prose prose-sm dark:prose-invert mt-2 max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="my-1 break-words leading-relaxed">{children}</p>,
                h1: ({ children }) => (
                  <h1 className="my-2 break-words text-lg font-bold">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="my-2 break-words text-base font-bold">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="my-1 break-words text-sm font-bold">{children}</h3>
                ),
                ul: ({ children }) => <ul className="my-1 pl-4">{children}</ul>,
                ol: ({ children }) => <ol className="my-1 pl-4">{children}</ol>,
                li: ({ children }) => <li className="my-0.5 break-words">{children}</li>,
                code: ({ children, className }) => {
                  const isInline = !className
                  return isInline ? (
                    <code className="break-words rounded bg-muted px-1 py-0.5 font-mono text-xs">
                      {children}
                    </code>
                  ) : (
                    <code
                      className={`my-1 block overflow-x-auto rounded bg-muted p-2 font-mono text-xs ${className || ''}`}
                    >
                      {children}
                    </code>
                  )
                },
                pre: ({ children }) => <pre className="my-1 overflow-x-auto">{children}</pre>,
                blockquote: ({ children }) => (
                  <blockquote className="my-1 break-words border-l-2 border-muted-foreground/30 pl-2 italic">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="break-all text-primary underline hover:text-primary/80"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
              }}
            >
              {feedback.content}
            </ReactMarkdown>
          </div>
        </Card>
      </div>
    )
  }

  const renderExecution = (execution: Execution & { itemType: 'execution' }) => {
    const statusConfig = STATUS_CONFIG[execution.status] || {
      label: execution.status,
      variant: 'outline' as const,
      icon: <Clock className="h-3 w-3" />,
    }
    const timestamp = execution.completed_at || execution.started_at || execution.created_at

    let filesChanged: string[] = []
    if (execution.files_changed) {
      try {
        filesChanged =
          typeof execution.files_changed === 'string'
            ? JSON.parse(execution.files_changed)
            : execution.files_changed
      } catch (e) {
        console.error('Failed to parse files_changed:', e)
      }
    }

    const truncateId = (id: string, length = 8) => id.substring(0, length)

    return (
      <div key={execution.id}>
        <Card
          className="cursor-pointer rounded-r-md border-l-4 border-l-green-500 bg-green-50/50 p-4 transition-colors hover:bg-green-100/50 dark:bg-green-950/20 dark:hover:bg-green-950/30"
          onClick={() => navigate(`/executions/${execution.id}`)}
        >
          {/* Header */}
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <PlayCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <code className="font-mono text-xs text-muted-foreground">
                {truncateId(execution.id)}
              </code>
              <Badge variant={statusConfig.variant} className="gap-1">
                {statusConfig.icon}
                {statusConfig.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{execution.model}</span>
              <span>•</span>
              <span className="capitalize">{execution.mode}</span>
            </div>

            {execution.error && (
              <div className="line-clamp-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
                Error: {execution.error}
              </div>
            )}

            {filesChanged.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {filesChanged.length} file(s) changed
              </div>
            )}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {sortedItems.map((item) => {
        if (item.itemType === 'execution') {
          return renderExecution(item as Execution & { itemType: 'execution' })
        } else {
          // Default to feedback
          return renderFeedback(item as IssueFeedback & { itemType: 'feedback' })
        }
      })}
    </div>
  )
}
