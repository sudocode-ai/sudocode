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
import type { FeedbackType, FeedbackAnchor, Issue } from '@/types/api'

interface FeedbackFormProps {
  issues?: Issue[]
  selectedIssueId?: string
  onIssueSelect?: (issueId: string) => void
  issueId?: string // Legacy prop for backward compatibility
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
  issues = [],
  selectedIssueId: propSelectedIssueId,
  onIssueSelect,
  issueId, // Legacy prop
  lineNumber,
  textSnippet,
  onSubmit,
  onCancel,
  className = '',
}: FeedbackFormProps) {
  const [type, setType] = useState<FeedbackType>('comment')
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Use either the new or legacy issue ID
  const selectedIssueId = propSelectedIssueId || issueId

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

      {/* Issue selector */}
      {issues.length > 0 && onIssueSelect && (
        <div>
          <Label htmlFor="issue-select">Issue</Label>
          <Select value={selectedIssueId} onValueChange={onIssueSelect}>
            <SelectTrigger id="issue-select">
              <SelectValue placeholder="Select an issue..." />
            </SelectTrigger>
            <SelectContent>
              {issues.map((issue) => (
                <SelectItem key={issue.id} value={issue.id}>
                  {issue.id}: {issue.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      {/* Actions */}
      <div className="flex gap-2">
        <Button type="submit" disabled={!content.trim() || !selectedIssueId || isSubmitting}>
          {isSubmitting ? 'Adding...' : 'Add Feedback'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
