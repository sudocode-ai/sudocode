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

interface ResumeSessionDialogProps {
  open: boolean
  onSubmit: (prompt: string) => Promise<void>
  onCancel: () => void
  sessionId?: string | null
}

export function ResumeSessionDialog({
  open,
  onSubmit,
  onCancel,
  sessionId,
}: ResumeSessionDialogProps) {
  const [prompt, setPrompt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (prompt.trim().length === 0) {
      setError('Prompt cannot be empty')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit(prompt.trim())
      // Reset state on success
      setPrompt('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume session')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (!isSubmitting) {
      setPrompt('')
      setError(null)
      onCancel()
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      handleCancel()
    }
  }

  const canSubmit = prompt.trim().length > 0 && !isSubmitting

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Continue Claude Code Session</DialogTitle>
          <DialogDescription>
            Resume this execution's Claude Code session with full conversational context. Claude will
            remember everything from the previous conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Session ID Display */}
          {sessionId && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground">Session ID</p>
                  <p className="mt-1 font-mono text-xs break-all">{sessionId}</p>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </div>
          )}

          {/* Prompt Textarea */}
          <div className="space-y-2">
            <Label htmlFor="prompt">What would you like Claude to do next?</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              placeholder={
                'Continue the conversation with a new prompt.\n\nExamples:\n• "Now let\'s add tests for this feature"\n• "Can you refactor this to use a more efficient algorithm?"\n• "Please add documentation for these new functions"'
              }
              className="resize-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Claude will resume with full context from the previous session, including all code changes
              and conversation history.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting ? 'Resuming...' : 'Continue Session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
