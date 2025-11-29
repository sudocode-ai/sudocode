import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  GitMerge,
  FileText,
  GitCommit,
} from 'lucide-react'
import type { Execution, SyncResult } from '@/types/execution'

export interface SyncProgressDialogProps {
  execution: Execution
  syncStatus: 'idle' | 'syncing' | 'success' | 'error'
  syncResult: SyncResult | null
  syncError: string | null
  isOpen: boolean
  onClose: () => void
  onCleanupWorktree?: () => void
  onRetry?: () => void
}

export function SyncProgressDialog({
  execution: _execution,
  syncStatus,
  syncResult,
  syncError,
  isOpen,
  onClose,
  onCleanupWorktree,
  onRetry,
}: SyncProgressDialogProps) {
  const [shouldCleanup, setShouldCleanup] = useState(false)

  const isSyncing = syncStatus === 'syncing'
  const isSuccess = syncStatus === 'success'
  const isError = syncStatus === 'error'
  const showCleanupOption = isSuccess && syncResult?.cleanupOffered

  const handleClose = () => {
    // Trigger cleanup if checkbox is checked
    if (shouldCleanup && onCleanupWorktree) {
      onCleanupWorktree()
    }
    setShouldCleanup(false)
    onClose()
  }

  const handleRetry = () => {
    if (onRetry) {
      onRetry()
    }
  }

  // Get suggested action based on error message
  const getSuggestedAction = (error: string): string | null => {
    const lowerError = error.toLowerCase()
    if (lowerError.includes('code conflicts') || error.includes('CODE_CONFLICTS')) {
      return 'Open worktree in IDE to resolve conflicts'
    }
    if (lowerError.includes('uncommitted changes') || error.includes('DIRTY_WORKING_TREE')) {
      return 'Commit or stash local changes first'
    }
    if (lowerError.includes('worktree directory not found') || error.includes('WORKTREE_MISSING')) {
      return 'Worktree was deleted, cannot sync'
    }
    return null
  }

  const suggestedAction = syncError ? getSuggestedAction(syncError) : null
  const canRetry = isError && !syncError?.includes('WORKTREE_MISSING')

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // Prevent closing while syncing
        if (!open && !isSyncing) {
          handleClose()
        }
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onPointerDownOutside={(e) => {
          // Prevent closing by clicking outside while syncing
          if (isSyncing) {
            e.preventDefault()
          }
        }}
        onEscapeKeyDown={(e) => {
          // Prevent closing with Escape while syncing
          if (isSyncing) {
            e.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            {isSyncing && 'Syncing Changes'}
            {isSuccess && 'Sync Complete'}
            {isError && 'Sync Failed'}
          </DialogTitle>
          <DialogDescription>
            {isSyncing && 'Please wait while changes are synced to your local branch'}
            {isSuccess && 'Changes have been successfully synced to your local branch'}
            {isError && 'An error occurred while syncing changes'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Syncing State */}
          {isSyncing && (
            <div className="flex flex-col items-center justify-center space-y-4 py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-lg font-medium">Syncing changes to local branch...</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  This may take a few moments
                </p>
              </div>
              {/* Indeterminate progress indicator */}
              <div className="w-full max-w-md">
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full w-full animate-pulse bg-primary" />
                </div>
              </div>
            </div>
          )}

          {/* Success State */}
          {isSuccess && syncResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-green-500/10 p-4">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <div className="flex-1">
                  <p className="font-medium text-green-900 dark:text-green-100">
                    Sync Successful
                  </p>
                  <p className="mt-1 text-sm text-green-800 dark:text-green-200">
                    All changes have been merged to your local branch
                  </p>
                </div>
              </div>

              {/* Summary Section */}
              <div className="rounded-lg border p-4">
                <h3 className="mb-3 flex items-center gap-2 font-medium">
                  <FileText className="h-4 w-4" />
                  Summary
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Files Changed</div>
                    <div className="mt-1 text-lg font-semibold">
                      {syncResult.filesChanged}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Conflicts Resolved</div>
                    <div className="mt-1 text-lg font-semibold">
                      {syncResult.conflictsResolved}
                    </div>
                  </div>
                </div>

                {/* Final Commit SHA */}
                {syncResult.finalCommit && (
                  <div className="mt-4 flex items-center gap-2 text-sm">
                    <GitCommit className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Commit:</span>
                    <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                      {syncResult.finalCommit.substring(0, 7)}
                    </code>
                  </div>
                )}

                {/* Uncommitted JSONL Included Badge */}
                {syncResult.uncommittedJSONLIncluded && (
                  <div className="mt-3">
                    <Badge variant="secondary" className="text-xs">
                      Uncommitted JSONL changes included
                    </Badge>
                  </div>
                )}
              </div>

              {/* Worktree Cleanup Section */}
              {showCleanupOption && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="cleanup-worktree"
                      checked={shouldCleanup}
                      onCheckedChange={(checked) => setShouldCleanup(checked === true)}
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor="cleanup-worktree"
                        className="cursor-pointer font-medium text-amber-900 dark:text-amber-100"
                      >
                        Clean up worktree after closing
                      </Label>
                      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                        Remove worktree directory to free up space. You can recreate it later
                        if needed.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4">
                <XCircle className="mt-0.5 h-6 w-6 text-destructive" />
                <div className="flex-1">
                  <p className="font-medium text-destructive">Sync Failed</p>
                  <p className="mt-1 text-sm text-destructive/90">
                    {syncError || 'An unknown error occurred during sync'}
                  </p>
                </div>
              </div>

              {/* Suggested Action */}
              {suggestedAction && (
                <div className="flex items-start gap-3 rounded-lg border border-blue-500/50 bg-blue-500/10 p-4">
                  <AlertCircle className="mt-0.5 h-5 w-5 text-blue-600" />
                  <div className="flex-1">
                    <p className="font-medium text-blue-900 dark:text-blue-100">
                      Suggested Action
                    </p>
                    <p className="mt-1 text-sm text-blue-800 dark:text-blue-200">
                      {suggestedAction}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {isSyncing && (
            <Button disabled variant="outline">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Syncing...
            </Button>
          )}

          {isSuccess && (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}

          {isError && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {canRetry && onRetry && (
                <Button onClick={handleRetry}>
                  Retry
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
