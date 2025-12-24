import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, AlertCircle, Lightbulb, Trash2, Check, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { IssueFeedback, FeedbackType, FeedbackAnchor } from '@/types/api'

interface FeedbackCardProps {
  feedback: IssueFeedback
  onDismiss?: (id: string) => void
  onDelete?: (id: string) => void
  onClick?: () => void
  className?: string
  maxHeight?: number // Max height in pixels before scrolling kicks in
  isCompact?: boolean // Show compact view by default
}

/**
 * Displays an individual feedback item with actions
 */
export function FeedbackCard({
  feedback,
  onDismiss,
  onDelete,
  onClick,
  className = '',
  maxHeight = 500, // Default max height before scrolling
  isCompact = false,
}: FeedbackCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(!isCompact)
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()

  // Parse anchor from JSON string
  let anchor: FeedbackAnchor | null = null
  try {
    if (feedback.anchor) {
      anchor = JSON.parse(feedback.anchor)
    }
  } catch (error) {
    console.error('Failed to parse feedback anchor:', error)
  }

  const getIcon = (type: FeedbackType) => {
    switch (type) {
      case 'comment':
        return <MessageSquare className="h-4 w-4" />
      case 'suggestion':
        return <Lightbulb className="h-4 w-4" />
      case 'request':
        return <AlertCircle className="h-4 w-4" />
    }
  }

  const getTypeColor = (type: FeedbackType) => {
    switch (type) {
      case 'comment':
        return 'text-blue-600 bg-blue-50'
      case 'suggestion':
        return 'text-yellow-600 bg-yellow-50'
      case 'request':
        return 'text-orange-600 bg-orange-50'
    }
  }

  const getAnchorText = () => {
    if (!anchor) return null

    if (anchor.line_number) {
      return `L${anchor.line_number}`
    }

    if (anchor.section_heading) {
      return `§ ${anchor.section_heading}`
    }

    if (anchor.text_snippet) {
      return `"${anchor.text_snippet.slice(0, 30)}${anchor.text_snippet.length > 30 ? '...' : ''}"`
    }

    return null
  }

  return (
    <TooltipProvider>
      <Card
        className={`relative cursor-pointer rounded-lg border-2 bg-card shadow-sm transition-all hover:border-primary/30 hover:shadow-lg ${feedback.dismissed ? 'opacity-60' : ''} ${className}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onClick}
      >
      <div className="p-3">
        {/* Header */}
        <div className="mb-2">
          {/* Row 1: Icon + Issue ID + Actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`flex-shrink-0 rounded-full p-1.5 ${getTypeColor(feedback.feedback_type)}`}
                title={feedback.feedback_type}
              >
                {getIcon(feedback.feedback_type)}
              </div>
              <button
                className="text-xs font-medium text-foreground hover:text-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  if (feedback.from_id) {
                    navigate(paths.issue(feedback.from_id))
                  }
                }}
              >
                {feedback.from_id}
              </button>
            </div>

            {/* Actions - always rendered but visibility controlled by opacity */}
            {(onDismiss || onDelete) && (
              <div
                className="flex flex-shrink-0 gap-1 transition-opacity duration-150"
                style={{ opacity: isHovered ? 1 : 0 }}
              >
                {!feedback.dismissed && onDismiss && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDismiss(feedback.id)
                        }}
                        className="h-6 w-6 p-0"
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Dismiss</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {feedback.dismissed && onDismiss && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDismiss(feedback.id)
                        }}
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Restore</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {onDelete && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(feedback.id)
                        }}
                        className="h-6 w-6 p-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Delete</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Anchor + Timestamp */}
          <div className="ml-9 flex items-center gap-2 text-xs text-muted-foreground">
            {anchor && getAnchorText() && (
              <>
                <span className="flex-shrink-0">{getAnchorText()}</span>
                <span className="flex-shrink-0">•</span>
              </>
            )}
            <span className="flex-shrink-0">
              {formatDistanceToNow(
                new Date(
                  feedback.created_at.endsWith('Z')
                    ? feedback.created_at
                    : feedback.created_at + 'Z'
                ),
                { addSuffix: true }
              )}
            </span>
          </div>
        </div>

        {/* Content */}
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground"
          style={{
            maxHeight: isExpanded ? `${maxHeight}px` : '3rem', // 3rem = ~3 lines
            overflowY: 'auto',
            overflowX: 'auto', // Allow horizontal scrolling for wide content
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Customize rendering for compact display
              p: ({ children }) => <p className="my-1 break-words">{children}</p>,
              h1: ({ children }) => <h1 className="my-1 text-lg font-bold break-words">{children}</h1>,
              h2: ({ children }) => <h2 className="my-1 text-base font-bold break-words">{children}</h2>,
              h3: ({ children }) => <h3 className="my-1 text-sm font-bold break-words">{children}</h3>,
              ul: ({ children }) => <ul className="my-1 pl-4">{children}</ul>,
              ol: ({ children }) => <ol className="my-1 pl-4">{children}</ol>,
              li: ({ children }) => <li className="my-0.5 break-words">{children}</li>,
              code: ({ children, className }) => {
                const isInline = !className
                return isInline ? (
                  <code className="break-words rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
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
                <blockquote className="my-1 border-l-2 border-muted-foreground/30 pl-2 italic break-words">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="break-all text-primary underline hover:text-primary/80"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
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

        {/* Expand/Collapse button for long content */}
        {feedback.content.length > 100 && (
          <button
            className="mt-1 text-xs text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      </Card>
    </TooltipProvider>
  )
}
