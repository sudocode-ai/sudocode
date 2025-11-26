import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle } from 'lucide-react'

interface FollowUpDialogProps {
  open: boolean
  onSubmit: (feedback: string) => Promise<void>
  onCancel: () => void
}

export function FollowUpDialog({ open, onSubmit, onCancel }: FollowUpDialogProps) {
  const [feedback, setFeedback] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (feedback.trim().length === 0) {
      setError('Feedback cannot be empty')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit(feedback.trim())
      // Reset state on success
      setFeedback('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (!isSubmitting) {
      setFeedback('')
      setError(null)
      onCancel()
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      handleCancel()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmit) {
        handleSubmit()
      }
    }
    // Shift+Enter creates newline (default behavior, no need to handle)
  }

  const canSubmit = feedback.trim().length > 0 && !isSubmitting

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Continue Execution</DialogTitle>
          <DialogDescription>
            Provide additional feedback to continue the agent's work in the same environment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error Display */}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </div>
          )}

          {/* Feedback Textarea */}
          <div className="space-y-2">
            <Label htmlFor="feedback">Feedback</Label>
            <Textarea
              id="feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={8}
              placeholder={
                'Provide feedback or additional instructions for the agent.\n\nExamples:\n• "Please add error handling for edge cases"\n• "Can you explain the approach you took?"\n• "Also add tests for this functionality"'
              }
              className="resize-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              The agent will continue working in the same environment with this feedback.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting ? 'Submitting...' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
