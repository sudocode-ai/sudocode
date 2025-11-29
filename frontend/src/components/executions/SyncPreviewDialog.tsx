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
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  GitCommit,
  GitMerge,
  Loader2,
  AlertTriangle,
  Info,
  X,
  XCircle,
  PauseCircle,
} from 'lucide-react'
import type { Execution, SyncPreviewResult, SyncMode } from '@/types/execution'

export interface SyncPreviewDialogProps {
  execution: Execution
  preview: SyncPreviewResult | null
  isOpen: boolean
  onClose: () => void
  onConfirmSync: (mode: SyncMode, commitMessage?: string) => void
  onOpenIDE: () => void
  isPreviewing?: boolean
}

export function SyncPreviewDialog({
  execution,
  preview,
  isOpen,
  onClose,
  onConfirmSync,
  onOpenIDE,
  isPreviewing = false,
}: SyncPreviewDialogProps) {
  const [selectedMode, setSelectedMode] = useState<SyncMode>('squash')
  const [commitMessage, setCommitMessage] = useState('')
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [commitsExpanded, setCommitsExpanded] = useState(false)

  // Determine if sync is blocked by code conflicts
  const hasCodeConflicts = preview?.conflicts.codeConflicts.length ?? 0 > 0
  const canSync = preview?.canSync && !hasCodeConflicts
  const isRunningOrPaused = execution.status === 'running' || execution.status === 'paused'

  // Get button text based on mode
  const getButtonText = () => {
    if (selectedMode === 'squash') return 'Squash & Sync'
    return 'Preserve & Sync'
  }

  const handleConfirm = () => {
    if (!canSync) return
    const message = selectedMode === 'squash' ? commitMessage : undefined
    onConfirmSync(selectedMode, message)
  }

  // Render execution status badge
  const renderStatusBadge = () => {
    switch (execution.status) {
      case 'running':
        return (
          <Badge variant="default" className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        )
      case 'paused':
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <PauseCircle className="h-3 w-3" />
            Paused
          </Badge>
        )
      case 'completed':
        return (
          <Badge variant="default" className="flex items-center gap-1 bg-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        )
      case 'stopped':
      case 'cancelled':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <X className="h-3 w-3" />
            {execution.status === 'stopped' ? 'Stopped' : 'Cancelled'}
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {execution.status}
          </Badge>
        )
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Sync Preview
          </DialogTitle>
          <DialogDescription>
            Review changes before syncing worktree to local branch
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Loading State */}
            {isPreviewing && (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading preview...</span>
              </div>
            )}

            {!isPreviewing && preview && (
              <>
                {/* Execution Status */}
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Execution Status:</span>
                    {renderStatusBadge()}
                  </div>
                </div>

                {/* Running/Paused Warning */}
                {isRunningOrPaused && (
                  <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      <div className="text-sm">
                        <p className="font-medium text-amber-900 dark:text-amber-100">
                          Execution In Progress
                        </p>
                        <p className="mt-1 text-amber-800 dark:text-amber-200">
                          The execution may continue making changes after sync. You may need to sync
                          again after completion.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* General Warnings */}
                {preview.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
                      <div className="flex-1 space-y-1 text-sm">
                        {preview.warnings.map((warning, i) => (
                          <p key={i} className="text-amber-800 dark:text-amber-200">
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Code Conflicts Error */}
                {hasCodeConflicts && (
                  <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
                    <div className="flex items-start gap-2">
                      <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-destructive">
                          Code Conflicts Detected
                        </p>
                        <p className="mt-1 text-sm text-destructive/90">
                          Resolve conflicts in your IDE before syncing:
                        </p>
                        <ul className="mt-2 space-y-1 text-sm">
                          {preview.conflicts.codeConflicts.map((conflict, i) => (
                            <li key={i} className="font-mono text-xs">
                              • {conflict.filePath}{' '}
                              <span className="text-muted-foreground">
                                ({conflict.conflictType})
                              </span>
                            </li>
                          ))}
                        </ul>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={onOpenIDE}
                        >
                          Open Worktree in IDE
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* JSONL Conflicts Info */}
                {preview.conflicts.jsonlConflicts.length > 0 && (
                  <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 text-blue-600" />
                      <div className="flex-1 text-sm">
                        <p className="font-medium text-blue-900 dark:text-blue-100">
                          JSONL Conflicts (Auto-resolvable)
                        </p>
                        <p className="mt-1 text-blue-800 dark:text-blue-200">
                          The following files have conflicts that will be automatically resolved:
                        </p>
                        <ul className="mt-2 space-y-1">
                          {preview.conflicts.jsonlConflicts.map((conflict, i) => (
                            <li key={i} className="font-mono text-xs">
                              • {conflict.filePath}{' '}
                              <span className="text-muted-foreground">
                                ({conflict.conflictCount} conflicts)
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Uncommitted JSONL Changes */}
                {preview.uncommittedJSONLChanges && (
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Uncommitted Changes</Badge>
                      <span className="text-sm text-muted-foreground">
                        Uncommitted JSONL changes will be included in sync
                      </span>
                    </div>
                  </div>
                )}

                {/* Diff Summary */}
                <div className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <h3 className="font-medium">Changes Summary</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Files Changed</div>
                      <div className="mt-1 text-lg font-semibold">{preview.diff.files.length}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Additions</div>
                      <div className="mt-1 text-lg font-semibold text-green-600">
                        +{preview.diff.additions}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Deletions</div>
                      <div className="mt-1 text-lg font-semibold text-red-600">
                        -{preview.diff.deletions}
                      </div>
                    </div>
                  </div>

                  {/* Expandable File List */}
                  {preview.diff.files.length > 0 && (
                    <Collapsible open={filesExpanded} onOpenChange={setFilesExpanded}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="mt-3 w-full">
                          {filesExpanded ? (
                            <ChevronDown className="mr-2 h-4 w-4" />
                          ) : (
                            <ChevronRight className="mr-2 h-4 w-4" />
                          )}
                          {filesExpanded ? 'Hide' : 'Show'} Files ({preview.diff.files.length})
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <ScrollArea className="h-40 rounded-md border p-2">
                          <ul className="space-y-1 text-xs font-mono">
                            {preview.diff.files.map((file, i) => (
                              <li key={i} className="text-muted-foreground">
                                {file}
                              </li>
                            ))}
                          </ul>
                        </ScrollArea>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>

                {/* Commit History (for preserve mode) */}
                {selectedMode === 'preserve' && preview.commits.length > 0 && (
                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <GitCommit className="h-4 w-4" />
                      <h3 className="font-medium">Commits to Preserve</h3>
                      <Badge variant="secondary">{preview.commits.length}</Badge>
                    </div>
                    <Collapsible open={commitsExpanded} onOpenChange={setCommitsExpanded}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full">
                          {commitsExpanded ? (
                            <ChevronDown className="mr-2 h-4 w-4" />
                          ) : (
                            <ChevronRight className="mr-2 h-4 w-4" />
                          )}
                          {commitsExpanded ? 'Hide' : 'Show'} Commits
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <ScrollArea className="h-48 rounded-md border p-2">
                          <ul className="space-y-2">
                            {preview.commits.map((commit) => (
                              <li
                                key={commit.sha}
                                className="rounded-md border-l-2 border-blue-500 bg-muted/50 p-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1">
                                    <p className="text-sm font-medium">{commit.message}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {commit.author}
                                    </p>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    <code className="rounded bg-muted px-1.5 py-0.5">
                                      {commit.sha.substring(0, 7)}
                                    </code>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </ScrollArea>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}

                {/* Mode Selector */}
                <div className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    <h3 className="font-medium">Sync Mode</h3>
                  </div>
                  <RadioGroup value={selectedMode} onValueChange={(v) => setSelectedMode(v as SyncMode)}>
                    <div className="space-y-3">
                      <div className="flex items-start space-x-3 rounded-md border p-3 hover:bg-muted/50">
                        <RadioGroupItem value="squash" id="squash" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="squash" className="cursor-pointer font-medium">
                            Squash Merge (Recommended)
                          </Label>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Combine all worktree changes into a single commit on your local branch
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3 rounded-md border p-3 hover:bg-muted/50">
                        <RadioGroupItem value="preserve" id="preserve" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="preserve" className="cursor-pointer font-medium">
                            Preserve Commits
                          </Label>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Cherry-pick all commits individually to preserve commit history
                          </p>
                        </div>
                      </div>
                    </div>
                  </RadioGroup>

                  {/* Commit Message Input (Squash Mode Only) */}
                  {selectedMode === 'squash' && (
                    <div className="mt-4 space-y-2">
                      <Label htmlFor="commit-message">Commit Message (Optional)</Label>
                      <Input
                        id="commit-message"
                        placeholder="Custom commit message..."
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave empty to use auto-generated message with execution metadata
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSync || isPreviewing}
          >
            {getButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
