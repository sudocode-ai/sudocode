import { useState } from 'react'
import { MessageSquare, AlertCircle, Lightbulb, Trash2, Check, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { IssueFeedback, FeedbackType, FeedbackAnchor } from '@/types/api'

interface FeedbackCardProps {
  feedback: IssueFeedback
  onDismiss?: (id: string) => void
  onDelete?: (id: string) => void
  onClick?: () => void
  className?: string
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
}: FeedbackCardProps) {
  const [showActions, setShowActions] = useState(false)

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
      return `Line ${anchor.line_number}`
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
    <Card
      className={`relative cursor-pointer transition-shadow hover:shadow-md ${feedback.dismissed ? 'opacity-60' : ''} ${className}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={onClick}
    >
      <div className="p-3">
        {/* Header */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={`rounded-full p-1.5 ${getTypeColor(feedback.feedback_type)}`}>
              {getIcon(feedback.feedback_type)}
            </div>
            <div>
              <div className="text-xs font-medium capitalize text-muted-foreground">
                {feedback.feedback_type}
              </div>
              {anchor && getAnchorText() && (
                <div className="text-xs text-muted-foreground">{getAnchorText()}</div>
              )}
            </div>
          </div>

          {/* Actions */}
          {showActions && (
            <div className="flex gap-1">
              {!feedback.dismissed && onDismiss && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDismiss(feedback.id)
                  }}
                  title="Dismiss"
                >
                  <Check className="h-3 w-3" />
                </Button>
              )}
              {feedback.dismissed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDismiss?.(feedback.id)
                  }}
                  title="Restore"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(feedback.id)
                  }}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="text-sm text-foreground">{feedback.content}</div>

        {/* Footer */}
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>From {feedback.issue_id}</span>
          <span>{new Date(feedback.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </Card>
  )
}
