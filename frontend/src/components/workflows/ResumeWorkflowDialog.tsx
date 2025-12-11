/**
 * ResumeWorkflowDialog - Dialog for resuming a paused workflow
 * Allows user to optionally provide a message to send to the orchestrator
 */

import { useState } from 'react'
import { Play, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { Workflow } from '@/types/workflow'

export interface ResumeWorkflowDialogProps {
  /** The workflow to resume */
  workflow: Workflow | null
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Callback when resume is confirmed */
  onConfirm: (message?: string) => Promise<void>
  /** Whether resume is in progress */
  isResuming?: boolean
}

export function ResumeWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onConfirm,
  isResuming = false,
}: ResumeWorkflowDialogProps) {
  const [message, setMessage] = useState('')

  const handleConfirm = async () => {
    // Only pass message if it's not empty
    await onConfirm(message.trim() || undefined)
    setMessage('')
    onOpenChange(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setMessage('')
    }
    onOpenChange(newOpen)
  }

  if (!workflow) return null

  const isOrchestrator = workflow.config.engineType === 'orchestrator'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Resume Workflow
          </DialogTitle>
          <DialogDescription>
            {isOrchestrator
              ? 'Resume the workflow orchestrator. You can optionally provide guidance for the AI.'
              : 'Resume the paused workflow execution.'}
          </DialogDescription>
        </DialogHeader>

        {isOrchestrator && (
          <div className="space-y-2 py-2">
            <Label htmlFor="resume-message">Message to Orchestrator (optional)</Label>
            <Textarea
              id="resume-message"
              placeholder="e.g., Focus on the authentication task next..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              disabled={isResuming}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to resume with the default message.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isResuming}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isResuming}>
            {isResuming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resuming...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Resume
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ResumeWorkflowDialog
