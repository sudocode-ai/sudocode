import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FeedbackType, FeedbackAnchor } from '@/types/api'

interface FeedbackFormProps {
  issueId?: string
  lineNumber?: number
  textSnippet?: string
  onSubmit: (data: { type: FeedbackType; content: string; anchor?: FeedbackAnchor }) => void
  onCancel: () => void
  className?: string
}

/**
 * Form for adding new feedback to a spec
 */
export function FeedbackForm({
  issueId,
  lineNumber,
  textSnippet,
  onSubmit,
  onCancel,
  className = '',
}: FeedbackFormProps) {
  const [type, setType] = useState<FeedbackType>('comment')
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!content.trim()) {
      return
    }

    setIsSubmitting(true)

    try {
      // Create anchor if we have line number or text snippet
      let anchor: FeedbackAnchor | undefined
      if (lineNumber || textSnippet) {
        anchor = {
          line_number: lineNumber,
          text_snippet: textSnippet,
          anchor_status: 'valid',
          last_verified_at: new Date().toISOString(),
        }
      }

      await onSubmit({
        type,
        content: content.trim(),
        anchor,
      })

      // Reset form
      setContent('')
      setType('comment')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
      {/* Anchor info */}
      {(lineNumber || textSnippet) && (
        <div className="rounded-md bg-muted/50 p-2 text-sm">
          {lineNumber && <div className="font-medium">Line {lineNumber}</div>}
          {textSnippet && (
            <div className="text-muted-foreground">
              "{textSnippet.slice(0, 60)}
              {textSnippet.length > 60 ? '...' : ''}"
            </div>
          )}
        </div>
      )}

      {/* Feedback type */}
      <div>
        <Label htmlFor="feedback-type">Type</Label>
        <Select value={type} onValueChange={(value) => setType(value as FeedbackType)}>
          <SelectTrigger id="feedback-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="comment">Comment</SelectItem>
            <SelectItem value="suggestion">Suggestion</SelectItem>
            <SelectItem value="request">Request</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Feedback content */}
      <div>
        <Label htmlFor="feedback-content">Content</Label>
        <Textarea
          id="feedback-content"
          placeholder="Enter your feedback..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          required
          className="resize-none"
        />
      </div>

      {/* Issue ID (if not provided) */}
      {!issueId && (
        <div className="text-sm text-muted-foreground">
          Note: You need to link this feedback to an issue before submitting.
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button type="submit" disabled={!content.trim() || !issueId || isSubmitting}>
          {isSubmitting ? 'Adding...' : 'Add Feedback'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
