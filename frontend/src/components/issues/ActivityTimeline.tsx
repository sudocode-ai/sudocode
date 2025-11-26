import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  MessageSquare,
  MessageSquareShare,
  PlayCircle,
  ArrowRight,
} from 'lucide-react'
import type { IssueFeedback } from '@/types/api'
import type { Execution } from '@/types/execution'
import { ExecutionPreview } from '@/components/executions/ExecutionPreview'

type ActivityItem =
  | (IssueFeedback & { itemType: 'feedback' })
  | (Execution & { itemType: 'execution' })
// Future: | Comment | StatusChange | etc.

interface ActivityTimelineProps {
  items: ActivityItem[]
  currentEntityId: string
  className?: string
}

/**
 * Unified activity timeline for issues
 * Shows feedback, executions, and other activity in chronological order
 * Designed to be inline with issue content, like GitHub/Linear
 */
export function ActivityTimeline({ items, currentEntityId, className = '' }: ActivityTimelineProps) {
  const navigate = useNavigate()

  // Helper to determine if feedback is outbound (from this entity) or inbound (to this entity)
  const isOutboundFeedback = (feedback: IssueFeedback) => feedback.from_id === currentEntityId

  // Helper to get the "other" entity ID for navigation
  const getOtherEntityId = (feedback: IssueFeedback) =>
    isOutboundFeedback(feedback) ? feedback.to_id : feedback.from_id

  // Helper to get navigation path based on entity type (spec or issue)
  const getEntityPath = (entityId: string) =>
    entityId.startsWith('s-') ? `/specs/${entityId}` : `/issues/${entityId}`

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
    const isOutbound = isOutboundFeedback(feedback)
    const otherEntityId = getOtherEntityId(feedback)
    const otherEntityPath = getEntityPath(otherEntityId)
    const isSpec = otherEntityId.startsWith('s-')

    // Different styles for outbound vs inbound feedback
    const borderColor = isOutbound
      ? 'border-l-purple-500/50'
      : 'border-l-blue-700/50'
    const bgColor = isOutbound
      ? 'bg-purple-50/50 dark:bg-purple-950/20'
      : 'bg-blue-50/50 dark:bg-blue-950/20'
    const iconColor = isOutbound
      ? 'text-purple-600 dark:text-purple-400'
      : 'text-blue-600 dark:text-blue-400'

    return (
      <div key={feedback.id} className="group relative">
        <Card
          className={`flex flex-col gap-2 rounded-r-md border-l-4 ${borderColor} ${bgColor} p-4 transition-opacity ${feedback.dismissed ? 'opacity-50' : ''}`}
        >
          {/* Header */}
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {isOutbound ? (
                <MessageSquareShare className={`h-4 w-4 ${iconColor}`} />
              ) : (
                <MessageSquare className={`h-4 w-4 ${iconColor}`} />
              )}
              <Badge className={`text-xs ${getFeedbackTypeColor(feedback.feedback_type)}`}>
                {feedback.feedback_type}
              </Badge>
              {/* Show direction and linked entity */}
              {isOutbound ? (
                <>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <button onClick={() => navigate(otherEntityPath)}>
                    <Badge
                      variant={isSpec ? 'spec' : 'issue'}
                      className="cursor-pointer font-mono text-xs hover:opacity-80"
                    >
                      {otherEntityId}
                    </Badge>
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">from</span>
                  <button onClick={() => navigate(otherEntityPath)}>
                    <Badge
                      variant={isSpec ? 'spec' : 'issue'}
                      className="cursor-pointer font-mono text-xs hover:opacity-80"
                    >
                      {otherEntityId}
                    </Badge>
                  </button>
                </>
              )}
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
                    <div>
                      <span className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                        {anchor.line_number && <span>Line {anchor.line_number}: </span>}
                        {anchor.text_snippet && (
                          <span className="font-mono italic">
                            &ldquo;{anchor.text_snippet}&rdquo;
                          </span>
                        )}
                      </span>
                    </div>
                  )
                }
              } catch (e) {
                // Invalid JSON, ignore
              }
              return null
            })()}
          {/* Content */}
          <div className="prose prose-sm dark:prose-invert max-w-none">
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
    const truncateId = (id: string, length = 8) => id.substring(0, length)

    return (
      <div key={execution.id}>
        <Card
          className="rounded-r-md border-l-4 border-l-green-500/50 bg-green-50/50 p-4 dark:bg-green-950/20"
        >
          {/* Header */}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <PlayCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <code className="font-mono text-xs text-muted-foreground">
                {truncateId(execution.id)}
              </code>
              <span className="text-xs font-medium">Agent Execution</span>
            </div>
          </div>

          {/* Execution Preview */}
          <ExecutionPreview
            executionId={execution.id}
            execution={execution}
            variant="standard"
            onViewFull={() => navigate(`/executions/${execution.id}`)}
          />
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
