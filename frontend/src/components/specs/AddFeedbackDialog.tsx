import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MessageSquarePlus } from 'lucide-react'
import { FeedbackForm } from './FeedbackForm'
import type { FeedbackType, FeedbackAnchor, Issue } from '@/types/api'

interface AddFeedbackDialogProps {
  issues: Issue[]
  lineNumber?: number
  textSnippet?: string
  onSubmit: (data: {
    issueId: string
    type: FeedbackType
    content: string
    anchor?: FeedbackAnchor
  }) => Promise<void>
  triggerButton?: React.ReactNode
}

/**
 * Dialog for adding new feedback to a spec
 *
 * Features:
 * - Opens in a modal dialog
 * - Uses existing FeedbackForm component
 * - Can be enhanced later to capture cursor position/selection
 * - Validates that an issue is selected before allowing submission
 */
export function AddFeedbackDialog({
  issues,
  lineNumber,
  textSnippet,
  onSubmit,
  triggerButton,
}: AddFeedbackDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>()

  const handleSubmit = async (data: {
    type: FeedbackType
    content: string
    anchor?: FeedbackAnchor
  }) => {
    if (!selectedIssueId) return
    await onSubmit({ issueId: selectedIssueId, ...data })
    setOpen(false)
    setSelectedIssueId(undefined)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" size="sm">
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            Add Feedback
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Feedback</DialogTitle>
          <DialogDescription>
            Add a comment, suggestion, or request to this spec.
            {lineNumber && ` Anchored to line ${lineNumber}.`}
          </DialogDescription>
        </DialogHeader>
        <FeedbackForm
          issues={issues}
          selectedIssueId={selectedIssueId}
          onIssueSelect={setSelectedIssueId}
          lineNumber={lineNumber}
          textSnippet={textSnippet}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
