/**
 * DeleteWorkflowDialog - Confirmation dialog for deleting workflows
 * Includes options to clean up associated resources (worktrees, branches)
 */

import { useState } from 'react'
import { AlertTriangle, GitBranch, FolderGit2, Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { Workflow } from '@/types/workflow'

export interface DeleteWorkflowOptions {
  /** Delete the worktree associated with this workflow */
  deleteWorktree: boolean
  /** Delete the branch created for this workflow */
  deleteBranch: boolean
}

export interface DeleteWorkflowDialogProps {
  /** The workflow to delete */
  workflow: Workflow | null
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Callback when delete is confirmed */
  onConfirm: (options: DeleteWorkflowOptions) => Promise<void>
  /** Whether delete is in progress */
  isDeleting?: boolean
}

export function DeleteWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onConfirm,
  isDeleting = false,
}: DeleteWorkflowDialogProps) {
  const [deleteWorktree, setDeleteWorktree] = useState(true)
  const [deleteBranch, setDeleteBranch] = useState(true)

  const hasWorktree = !!workflow?.worktreePath
  const hasBranch = !!workflow?.branchName

  const handleConfirm = async () => {
    await onConfirm({
      deleteWorktree: hasWorktree && deleteWorktree,
      deleteBranch: hasBranch && deleteBranch,
    })
  }

  // Reset options when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setDeleteWorktree(true)
      setDeleteBranch(true)
    }
    onOpenChange(newOpen)
  }

  if (!workflow) return null

  const workflowTitle =
    workflow.source.type === 'goal'
      ? workflow.source.goal.slice(0, 40) + (workflow.source.goal.length > 40 ? '...' : '')
      : workflow.title || `Workflow ${workflow.id.slice(0, 8)}`

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete Workflow
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <span className="font-medium">"{workflowTitle}"</span>?
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Cleanup Options */}
        {(hasWorktree || hasBranch) && (
          <div className="space-y-4 py-4">
            <div className="text-sm font-medium">Cleanup Options</div>
            <div className="space-y-3 rounded-md border p-4">
              {hasWorktree && (
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="deleteWorktree"
                    checked={deleteWorktree}
                    onCheckedChange={(checked) => setDeleteWorktree(checked === true)}
                    disabled={isDeleting}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label
                      htmlFor="deleteWorktree"
                      className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                      Delete worktree
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Remove the git worktree at{' '}
                      <code className="rounded bg-muted px-1">{workflow.worktreePath}</code>
                    </p>
                  </div>
                </div>
              )}

              {hasBranch && (
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="deleteBranch"
                    checked={deleteBranch}
                    onCheckedChange={(checked) => setDeleteBranch(checked === true)}
                    disabled={isDeleting}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label
                      htmlFor="deleteBranch"
                      className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      Delete branch
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Remove the branch{' '}
                      <code className="rounded bg-muted px-1">{workflow.branchName}</code>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete Workflow'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DeleteWorkflowDialog
