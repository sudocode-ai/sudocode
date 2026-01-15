import { useState, useEffect, useMemo } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertCircle,
  Loader2,
  GitBranch,
  FileText,
  CheckCircle2,
  XCircle,
  Layers,
} from 'lucide-react'
import { useExecutionChanges } from '@/hooks/useExecutionChanges'
import type { Execution, CheckpointResult, CheckpointOptions, FileChangeStat } from '@/types/execution'
import type { Issue } from '@/types/api'

export interface CheckpointDialogProps {
  execution: Execution | null
  issue: Issue | null
  isOpen: boolean
  onClose: () => void
  onCheckpoint: (options: CheckpointOptions) => void
  isCheckpointing?: boolean
  checkpointResult?: CheckpointResult | null
}

/**
 * Get status badge color for file change status
 */
function getStatusBadge(status: 'A' | 'M' | 'D' | 'R') {
  switch (status) {
    case 'A':
      return { label: 'Added', color: 'text-green-600 bg-green-100 dark:bg-green-900/30' }
    case 'M':
      return { label: 'Modified', color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30' }
    case 'D':
      return { label: 'Deleted', color: 'text-red-600 bg-red-100 dark:bg-red-900/30' }
    case 'R':
      return { label: 'Renamed', color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30' }
  }
}

export function CheckpointDialog({
  execution,
  issue,
  isOpen,
  onClose,
  onCheckpoint,
  isCheckpointing = false,
  checkpointResult,
}: CheckpointDialogProps) {
  const [message, setMessage] = useState('')
  const [addToQueue, setAddToQueue] = useState(true)

  // Get execution changes
  const { data: changesData, loading: isLoadingChanges } = useExecutionChanges(
    isOpen && execution ? execution.id : null
  )

  // Extract file changes from the data
  const files = useMemo<FileChangeStat[]>(() => {
    if (!changesData?.available) return []
    // Prefer captured snapshot, fall back to changes for legacy compatibility
    const snapshot = changesData.captured || changesData.changes
    return snapshot?.files || []
  }, [changesData])

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen && execution) {
      // Generate default message from execution info
      const defaultMessage = `Checkpoint from execution ${execution.id.substring(0, 8)}`
      setMessage(defaultMessage)
      setAddToQueue(true)
    }
  }, [isOpen, execution])

  const handleCheckpoint = () => {
    onCheckpoint({
      message: message.trim() || undefined,
      squash: true,
      autoEnqueue: addToQueue,
    })
  }

  // Calculate totals from changes
  const totalFiles = files.length
  const totalAdditions = files.reduce((sum: number, f: FileChangeStat) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum: number, f: FileChangeStat) => sum + f.deletions, 0)
  const hasChanges = totalFiles > 0

  // Success state
  if (checkpointResult?.success) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              Checkpoint Created
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Files changed:</span>
                  <span className="font-medium">{checkpointResult.checkpoint?.changed_files}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lines:</span>
                  <span>
                    <span className="font-medium text-green-600">
                      +{checkpointResult.checkpoint?.additions}
                    </span>{' '}
                    <span className="font-medium text-red-600">
                      -{checkpointResult.checkpoint?.deletions}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Commit:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {checkpointResult.checkpoint?.commit_sha.substring(0, 7)}
                  </code>
                </div>
                {checkpointResult.issueStream && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Branch:</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {checkpointResult.issueStream.branch}
                    </code>
                  </div>
                )}
                {checkpointResult.queueEntry && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Queue position:</span>
                    <span className="font-medium">#{checkpointResult.queueEntry.position}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Error/conflict state
  if (checkpointResult && !checkpointResult.success) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Checkpoint Failed
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {checkpointResult.conflicts && checkpointResult.conflicts.length > 0 ? (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <p className="mb-2 text-sm font-medium">Conflicts detected in:</p>
                <ul className="space-y-1 text-sm">
                  {checkpointResult.conflicts.map((conflict, i) => (
                    <li key={i} className="font-mono text-xs">
                      - {conflict.path}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Resolve conflicts in the worktree before checkpointing.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <p className="text-sm">{checkpointResult.error || 'Unknown error occurred'}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Checkpoint Execution
              </DialogTitle>
              <DialogDescription>
                Save changes to the issue stream for later merge to main
              </DialogDescription>
            </div>
            {!isLoadingChanges && hasChanges && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                </span>
                <span className="text-green-600">+{totalAdditions}</span>
                <span className="text-red-600">-{totalDeletions}</span>
              </div>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Execution Info */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-start gap-3">
                <GitBranch className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="flex-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Execution:</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {execution?.id.substring(0, 8)}
                    </code>
                    <Badge variant="outline" className="text-xs">
                      {execution?.status}
                    </Badge>
                  </div>
                  {issue && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="font-medium">Issue:</span>
                      <span className="text-muted-foreground">
                        {issue.id} - {issue.title}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Loading State */}
            {isLoadingChanges && (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading changes...</span>
              </div>
            )}

            {/* No Changes Warning */}
            {!isLoadingChanges && !hasChanges && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-100">
                      No changes to checkpoint
                    </p>
                    <p className="mt-1 text-amber-800 dark:text-amber-200">
                      This execution has no committed or uncommitted changes.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* File Changes List */}
            {!isLoadingChanges && hasChanges && (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <h3 className="text-sm font-medium">Changes to checkpoint</h3>
                </div>
                <ScrollArea className="h-40">
                  <ul className="space-y-1.5">
                    {files.slice(0, 20).map((file: FileChangeStat, i: number) => {
                      const badge = getStatusBadge(file.status)
                      return (
                        <li key={i} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.color}`}
                            >
                              {file.status}
                            </span>
                            <span className="truncate font-mono text-xs">{file.path}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-xs">
                            <span className="text-green-600">+{file.additions}</span>
                            <span className="text-red-600">-{file.deletions}</span>
                          </div>
                        </li>
                      )
                    })}
                    {files.length > 20 && (
                      <li className="text-xs text-muted-foreground">
                        ...and {files.length - 20} more files
                      </li>
                    )}
                  </ul>
                </ScrollArea>
              </div>
            )}

            {/* Checkpoint Message */}
            {hasChanges && (
              <div className="space-y-2">
                <Label htmlFor="checkpoint-message">Checkpoint Message</Label>
                <Textarea
                  id="checkpoint-message"
                  placeholder="Describe the changes in this checkpoint..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                />
              </div>
            )}

            {/* Options */}
            {hasChanges && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">Options</h3>
                <div className="space-y-2">
                  <Label
                    htmlFor="add-to-queue"
                    className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                  >
                    <Checkbox
                      id="add-to-queue"
                      checked={addToQueue}
                      onCheckedChange={(checked) => setAddToQueue(checked === true)}
                    />
                    <span>Add to merge queue</span>
                  </Label>
                  <p className="ml-6 text-xs text-muted-foreground">
                    Issue stream will be queued for merge to main branch
                  </p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCheckpointing}>
            Cancel
          </Button>
          <Button onClick={handleCheckpoint} disabled={isCheckpointing || !hasChanges}>
            {isCheckpointing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checkpointing...
              </>
            ) : (
              'Checkpoint'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
