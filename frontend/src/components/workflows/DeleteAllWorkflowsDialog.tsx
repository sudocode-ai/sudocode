/**
 * DeleteAllWorkflowsDialog - Confirmation dialog for deleting all inactive workflows
 * Includes options to clean up associated resources (worktrees, branches)
 */

import { useState, useEffect } from 'react'
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

export interface DeleteAllWorkflowsOptions {
  deleteWorktrees: boolean
  deleteBranches: boolean
}

export interface DeleteAllWorkflowsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: DeleteAllWorkflowsOptions) => Promise<void>
  inactiveCount: number
  isDeleting?: boolean
  deletionProgress?: { current: number; total: number }
}

const STORAGE_KEY_DELETE_WORKTREES = 'deleteAllWorkflows.deleteWorktrees'
const STORAGE_KEY_DELETE_BRANCHES = 'deleteAllWorkflows.deleteBranches'

export function DeleteAllWorkflowsDialog({
  open,
  onOpenChange,
  onConfirm,
  inactiveCount,
  isDeleting = false,
  deletionProgress,
}: DeleteAllWorkflowsDialogProps) {
  const [deleteWorktrees, setDeleteWorktrees] = useState(true)
  const [deleteBranches, setDeleteBranches] = useState(true)

  // Load saved preferences from localStorage on mount
  useEffect(() => {
    const savedWorktrees = localStorage.getItem(STORAGE_KEY_DELETE_WORKTREES)
    const savedBranches = localStorage.getItem(STORAGE_KEY_DELETE_BRANCHES)

    if (savedWorktrees !== null) {
      setDeleteWorktrees(savedWorktrees === 'true')
    }
    if (savedBranches !== null) {
      setDeleteBranches(savedBranches === 'true')
    }
  }, [])

  // Save preferences to localStorage when they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DELETE_WORKTREES, String(deleteWorktrees))
  }, [deleteWorktrees])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DELETE_BRANCHES, String(deleteBranches))
  }, [deleteBranches])

  const handleConfirm = async () => {
    await onConfirm({ deleteWorktrees, deleteBranches })
  }

  // Reset options when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (isDeleting) return // Prevent closing while deleting
    onOpenChange(newOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete All Inactive Workflows
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete all {inactiveCount} inactive workflow
            {inactiveCount !== 1 ? 's' : ''}? This includes workflows that are completed, failed, or
            cancelled. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Progress indicator */}
        {isDeleting && deletionProgress && (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm text-muted-foreground">
              Deleting {deletionProgress.current} of {deletionProgress.total}...
            </p>
          </div>
        )}

        {/* Cleanup Options */}
        {!isDeleting && (
          <div className="space-y-4 py-4">
            <div className="text-sm font-medium">Cleanup Options</div>
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="deleteWorktrees"
                  checked={deleteWorktrees}
                  onCheckedChange={(checked) => setDeleteWorktrees(checked === true)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="deleteWorktrees"
                    className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                    Delete worktrees
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Remove the git worktrees associated with these workflows
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="deleteBranches"
                  checked={deleteBranches}
                  onCheckedChange={(checked) => setDeleteBranches(checked === true)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="deleteBranches"
                    className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    Delete branches
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Remove the branches created for these workflows
                  </p>
                </div>
              </div>
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
              `Delete ${inactiveCount} Workflow${inactiveCount !== 1 ? 's' : ''}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DeleteAllWorkflowsDialog
