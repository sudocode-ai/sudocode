import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { GitCommit, Loader2, AlertCircle } from 'lucide-react'
import type { Execution } from '@/types/execution'

export interface CommitChangesDialogProps {
  execution: Execution
  isOpen: boolean
  onClose: () => void
  onConfirm: (commitMessage: string) => Promise<void>
  isCommitting?: boolean
}

export function CommitChangesDialog({
  execution,
  isOpen,
  onClose,
  onConfirm,
  isCommitting = false,
}: CommitChangesDialogProps) {
  const [commitMessage, setCommitMessage] = useState('')

  // Parse files changed
  const filesChanged = (() => {
    try {
      if (!execution.files_changed) return []
      const parsed =
        typeof execution.files_changed === 'string'
          ? JSON.parse(execution.files_changed)
          : execution.files_changed
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return []
    }
  })()

  // Determine target branch based on mode
  const targetBranch =
    execution.mode === 'worktree' ? execution.branch_name : execution.target_branch || 'main'

  // Generate placeholder message
  const placeholderMessage = execution.issue_id
    ? `Implement ${execution.issue_id}`
    : 'Commit changes from execution'

  // Reset message when dialog opens
  useEffect(() => {
    if (isOpen) {
      setCommitMessage(
        execution.issue_id ? `Implement ${execution.issue_id}` : 'Commit changes from execution'
      )
    }
  }, [isOpen])

  const handleConfirm = async () => {
    if (!commitMessage.trim()) return
    await onConfirm(commitMessage.trim())
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isCommitting) {
          onClose()
        }
      }}
    >
      <DialogContent
        className="sm:max-w-[500px]"
        onPointerDownOutside={(e) => {
          if (isCommitting) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isCommitting) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCommit className="h-5 w-5" />
            Commit Changes
          </DialogTitle>
          <DialogDescription>
            Commit {filesChanged.length} file change{filesChanged.length !== 1 ? 's' : ''} to{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{targetBranch}</code>
            {execution.mode === 'worktree' && <span> (worktree)</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Commit message input */}
          <div className="space-y-2">
            <Label htmlFor="commit-message">Commit Message</Label>
            <Textarea
              id="commit-message"
              placeholder={placeholderMessage}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={4}
              disabled={isCommitting}
              className="resize-none"
              autoFocus
            />
          </div>

          {/* Warning if message is empty */}
          {!commitMessage.trim() && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-50 p-3 text-sm dark:bg-yellow-950/20">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600 dark:text-yellow-500" />
              <span className="text-yellow-800 dark:text-yellow-200">
                Please enter a commit message to continue
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCommitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!commitMessage.trim() || isCommitting}
            className="min-w-[100px]"
          >
            {isCommitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Committing...
              </>
            ) : (
              <>
                <GitCommit className="mr-2 h-4 w-4" />
                Commit
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
