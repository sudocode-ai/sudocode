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
import type { FeedbackType, FeedbackAnchor } from '@/types/api'

interface AddFeedbackDialogProps {
  issueId?: string
  lineNumber?: number
  textSnippet?: string
  onSubmit: (data: { type: FeedbackType; content: string; anchor?: FeedbackAnchor }) => Promise<void>
  disabled?: boolean
  disabledMessage?: string
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
  issueId,
  lineNumber,
  textSnippet,
  onSubmit,
  disabled = false,
  disabledMessage = 'Select an issue first',
}: AddFeedbackDialogProps) {
  const [open, setOpen] = useState(false)

  const handleSubmit = async (data: {
    type: FeedbackType
    content: string
    anchor?: FeedbackAnchor
  }) => {
    await onSubmit(data)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} title={disabled ? disabledMessage : 'Add feedback'}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          Add Feedback
        </Button>
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
          issueId={issueId}
          lineNumber={lineNumber}
          textSnippet={textSnippet}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
