import { useState, useEffect, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EntityBadge } from '@/components/entities'
import {
  MessageSquare,
  MessageSquareShare,
  ArrowRight,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { IssueFeedback } from '@/types/api'
import type { Execution } from '@/types/execution'
import { InlineExecutionView } from '@/components/executions/InlineExecutionView'

type ActivityItem =
  | (IssueFeedback & { itemType: 'feedback' })
  | (Execution & { itemType: 'execution' })
// Future: | Comment | StatusChange | etc.

interface ActivityTimelineProps {
  items: ActivityItem[]
  currentEntityId: string
  className?: string
  lastFeedbackRef?: React.RefObject<HTMLDivElement>
}

/**
 * Unified activity timeline for issues
 * Shows feedback, executions, and other activity in chronological order
 * Designed to be inline with issue content, like GitHub/Linear
 */
export function ActivityTimeline({
  items,
  currentEntityId,
  className = '',
  lastFeedbackRef,
}: ActivityTimelineProps) {
  const [collapsedFeedback, setCollapsedFeedback] = useState<Set<string>>(new Set())
  const [userToggledFeedback, setUserToggledFeedback] = useState<Set<string>>(new Set())

  // Helper to determine if feedback is outbound (from this entity) or inbound (to this entity)
  const isOutboundFeedback = (feedback: IssueFeedback) => feedback.from_id === currentEntityId

  // Helper to get the "other" entity ID for navigation
  // Returns undefined for anonymous inbound feedback (no from_id)
  const getOtherEntityId = (feedback: IssueFeedback): string | undefined =>
    isOutboundFeedback(feedback) ? feedback.to_id : feedback.from_id

  // Sort items chronologically (oldest first)
  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [items]
  )

  // Initialize collapsed state: collapse all items except the last item in the activity
  useEffect(() => {
    const lastItem = sortedItems[sortedItems.length - 1]
    const feedbackItems = sortedItems.filter((item) => item.itemType === 'feedback')

    // Only update items that haven't been manually toggled by the user
    setCollapsedFeedback((prev) => {
      const next = new Set<string>()

      feedbackItems.forEach((item) => {
        const feedbackId = item.id
        // If user has manually toggled this item, preserve their choice
        if (userToggledFeedback.has(feedbackId)) {
          if (prev.has(feedbackId)) {
            next.add(feedbackId)
          }
        } else {
          // Default behavior: collapse all except the last item
          if (item.id !== lastItem?.id) {
            next.add(feedbackId)
          }
        }
      })

      return next
    })
  }, [sortedItems, userToggledFeedback])

  // Helper to determine if an item should be expanded (is the last item in activity)
  const isLastItem = (itemId: string) => {
    const lastItem = sortedItems[sortedItems.length - 1]
    return lastItem?.id === itemId
  }

  // Find the last feedback item ID for ref attachment
  const lastFeedbackItemId = useMemo(() => {
    const feedbackItems = sortedItems.filter((item) => item.itemType === 'feedback')
    return feedbackItems[feedbackItems.length - 1]?.id
  }, [sortedItems])

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

  const toggleFeedbackExpand = (feedbackId: string) => {
    // Mark this feedback as manually toggled by the user
    setUserToggledFeedback((prev) => new Set(prev).add(feedbackId))

    setCollapsedFeedback((prev) => {
      const next = new Set(prev)
      if (next.has(feedbackId)) {
        next.delete(feedbackId)
      } else {
        next.add(feedbackId)
      }
      return next
    })
  }

  const renderFeedback = (feedback: IssueFeedback, isLastFeedback: boolean) => {
    const isOutbound = isOutboundFeedback(feedback)
    const otherEntityId = getOtherEntityId(feedback)
    const isSpec = otherEntityId?.startsWith('s-') ?? false
    const isExpanded = !collapsedFeedback.has(feedback.id)

    // Determine icon color based on direction
    const iconColor = isOutbound
      ? 'text-purple-600 dark:text-purple-400'
      : 'text-blue-600 dark:text-blue-400'

    return (
      <div key={feedback.id} ref={isLastFeedback ? lastFeedbackRef : undefined}>
        <Card
          className={`overflow-hidden rounded-md border ${feedback.dismissed ? 'opacity-50' : ''}`}
        >
          {/* Header - clickable to expand/collapse */}
          <div
            className="cursor-pointer bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/50"
            onClick={() => toggleFeedbackExpand(feedback.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-1 items-center gap-3">
                {/* Expand/Collapse Icon */}
                <div className="mt-0.5">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Feedback Icon and Info */}
                <div className="flex flex-1 flex-wrap items-center gap-2">
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
                      <span onClick={(e) => e.stopPropagation()}>
                        <EntityBadge
                          entityId={otherEntityId!}
                          entityType={isSpec ? 'spec' : 'issue'}
                          showTitle={otherEntityId !== currentEntityId}
                        />
                      </span>
                    </>
                  ) : otherEntityId ? (
                    <>
                      <span className="text-xs text-muted-foreground">from</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <EntityBadge
                          entityId={otherEntityId}
                          entityType={isSpec ? 'spec' : 'issue'}
                          showTitle={otherEntityId !== currentEntityId}
                        />
                      </span>
                    </>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">(anonymous)</span>
                  )}
                  {/* Timestamp */}
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(feedback.created_at), { addSuffix: true })}
                  </span>
                  {feedback.dismissed && (
                    <Badge variant="secondary" className="text-xs">
                      dismissed
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Feedback contents */}
          <div className="relative">
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                !isExpanded ? 'max-h-[150px] cursor-pointer' : ''
              }`}
              onClick={() => {
                if (!isExpanded) {
                  toggleFeedbackExpand(feedback.id)
                }
              }}
            >
              <div className="p-4">
                {/* Agent info if present */}
                {feedback.agent && (
                  <div className="mb-3 text-xs text-muted-foreground">Agent: {feedback.agent}</div>
                )}

                {/* Anchor info if present */}
                {feedback.anchor &&
                  (() => {
                    try {
                      const anchor = JSON.parse(feedback.anchor)
                      if (anchor.line_number || anchor.text_snippet) {
                        return (
                          <div className="mb-3">
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
                      p: ({ children }) => (
                        <p className="my-1 break-words leading-relaxed">{children}</p>
                      ),
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
                      strong: ({ children }) => (
                        <strong className="font-semibold">{children}</strong>
                      ),
                      em: ({ children }) => <em className="italic">{children}</em>,
                    }}
                  >
                    {feedback.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Gradient overlay and expand button when collapsed */}
            {!isExpanded && (
              <>
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-card to-transparent" />
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFeedbackExpand(feedback.id)
                    }}
                    className="gap-1 text-muted-foreground shadow-sm"
                  >
                    <ChevronDown className="h-4 w-4" />
                    Expand
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    )
  }

  const renderExecution = (execution: Execution & { itemType: 'execution' }) => {
    const shouldBeExpanded = isLastItem(execution.id)

    return (
      <div key={execution.id}>
        <InlineExecutionView executionId={execution.id} defaultExpanded={shouldBeExpanded} />
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
          const isLastFeedback = item.id === lastFeedbackItemId
          return renderFeedback(item as IssueFeedback & { itemType: 'feedback' }, isLastFeedback)
        }
      })}
    </div>
  )
}
