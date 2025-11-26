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

interface DeleteExecutionDialogProps {
  executionId: string | null
  executionCount?: number
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isDeleting?: boolean
}

export function DeleteExecutionDialog({
  executionId,
  executionCount = 1,
  isOpen,
  onClose,
  onConfirm,
  isDeleting = false,
}: DeleteExecutionDialogProps) {
  if (!executionId) return null

  const isChain = executionCount > 1

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Execution</AlertDialogTitle>
          <AlertDialogDescription>
            {isChain ? (
              <>
                <br />
                This will permanently delete:
                <ul className="mt-2 list-inside list-disc space-y-1">
                  <li>All execution logs and history</li>
                  <li>The worktree (if it exists)</li>
                </ul>
                <br />
              </>
            ) : (
              <>
                Are you sure you want to delete this execution?
                <br />
                <br />
                This will permanently delete the execution, its worktree (if it exists), and all
                logs.
                <br />
                <br />
                This action cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
