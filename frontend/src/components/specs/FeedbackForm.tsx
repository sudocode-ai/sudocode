import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Use either the new or legacy issue ID
  const selectedIssueId = propSelectedIssueId || issueId

  // Filter issues based on search term
  const filteredIssues = useMemo(() => {
    if (!searchTerm.trim()) {
      return issues
    }
    const search = searchTerm.toLowerCase()
    return issues.filter(
      (issue) =>
        issue.id.toLowerCase().includes(search) ||
        issue.title.toLowerCase().includes(search)
    )
  }, [issues, searchTerm])

  // Find the selected issue to display its title
  const selectedIssue = issues.find((i) => i.id === selectedIssueId)

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
        <div className="space-y-2">
          <Label htmlFor="issue-select">Issue</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id="issue-select"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between font-normal"
                disabled={isSubmitting}
              >
                {selectedIssue ? (
                  <span className="truncate">
                    <span className="font-medium">{selectedIssue.id}</span>
                    <span className="text-muted-foreground"> - {selectedIssue.title}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Search issues...</span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <div className="flex flex-col">
                <div className="border-b p-2">
                  <Input
                    placeholder="Search issues..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-8"
                    autoFocus
                  />
                </div>
                <div className="max-h-60 overflow-auto">
                  {filteredIssues.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No issues found
                    </div>
                  ) : (
                    filteredIssues.map((issue) => (
                      <button
                        key={issue.id}
                        type="button"
                        className={cn(
                          'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                          selectedIssueId === issue.id && 'bg-accent text-accent-foreground'
                        )}
                        onClick={() => {
                          onIssueSelect(issue.id)
                          setOpen(false)
                          setSearchTerm('')
                        }}
                      >
                        <Check
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            selectedIssueId === issue.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <div className="flex-1 overflow-hidden">
                          <div className="font-medium">{issue.id}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {issue.title}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Feedback type */}
      <div className="space-y-2">
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
      <div className="space-y-2">
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
        <Button type="submit" disabled={!content.trim() || isSubmitting}>
          {isSubmitting ? 'Adding...' : 'Add Feedback'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
