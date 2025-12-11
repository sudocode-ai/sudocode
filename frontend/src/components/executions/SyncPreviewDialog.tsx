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
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  GitCommit,
  GitMerge,
  Loader2,
  Info,
  XCircle,
  RefreshCw,
} from 'lucide-react'
import type { SyncPreviewResult, SyncMode } from '@/types/execution'

export interface SyncPreviewDialogProps {
  preview: SyncPreviewResult | null
  isOpen: boolean
  onClose: () => void
  onConfirmSync: (
    mode: SyncMode,
    options?: {
      commitMessage?: string
      includeUncommitted?: boolean
      overrideLocalChanges?: boolean
    }
  ) => void
  onOpenIDE: () => void
  isPreviewing?: boolean
  /**
   * Target branch name to display in merge descriptions
   */
  targetBranch?: string
  /**
   * Callback to refresh the preview data
   */
  onRefresh?: () => void
}

export function SyncPreviewDialog({
  preview,
  isOpen,
  onClose,
  onConfirmSync,
  onOpenIDE,
  isPreviewing = false,
  targetBranch,
  onRefresh,
}: SyncPreviewDialogProps) {
  const [selectedMode, setSelectedMode] = useState<SyncMode>('squash')
  const [commitMessage, setCommitMessage] = useState('')
  const [commitsExpanded, setCommitsExpanded] = useState(false)
  const [includeUncommitted, setIncludeUncommitted] = useState(true)
  const [overrideLocalChanges, setOverrideLocalChanges] = useState(false)

  // Check if there are commits to merge (required for squash and preserve modes)
  const hasCommits = (preview?.commits.length ?? 0) > 0

  // Auto-select 'stage' mode when there are no commits and current selection requires commits
  useEffect(() => {
    if (!hasCommits && (selectedMode === 'squash' || selectedMode === 'preserve')) {
      setSelectedMode('stage')
    }
  }, [hasCommits, selectedMode])

  // Determine if sync is blocked by code conflicts
  const hasCodeConflicts = (preview?.conflicts.codeConflicts.length ?? 0) > 0
  // Check if local working tree has uncommitted changes
  const hasDirtyWorkingTree = preview?.warnings.some((w) =>
    w.toLowerCase().includes('stash or commit')
  )
  // Stage mode can bypass the dirty working tree check since it doesn't commit
  const canSync =
    selectedMode === 'stage' ? !hasCodeConflicts : preview?.canSync && !hasCodeConflicts

  // Get button text based on mode
  const getButtonText = () => {
    if (selectedMode === 'squash') return 'Squash and Merge'
    if (selectedMode === 'stage') return 'Stage Changes'
    return 'Merge Commits'
  }

  const handleConfirm = () => {
    if (!canSync) return
    onConfirmSync(selectedMode, {
      commitMessage: selectedMode === 'squash' ? commitMessage : undefined,
      includeUncommitted: selectedMode === 'stage' ? includeUncommitted : undefined,
      overrideLocalChanges:
        selectedMode === 'stage' && includeUncommitted ? overrideLocalChanges : undefined,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <GitMerge className="h-5 w-5" />
                Merge Changes
              </DialogTitle>
              <DialogDescription>Review changes before syncing worktree</DialogDescription>
            </div>
            {!isPreviewing && preview && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {preview.diff.files.length} file{preview.diff.files.length !== 1 ? 's' : ''}
                </span>
                <span className="text-green-600">+{preview.diff.additions}</span>
                <span className="text-red-600">-{preview.diff.deletions}</span>
                {preview.commits.length > 0 && (
                  <>
                    <GitCommit className="h-4 w-4" />
                    <span>
                      {preview.commits.length} commit{preview.commits.length !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
                {onRefresh && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={onRefresh}
                    disabled={isPreviewing}
                    title="Refresh preview"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isPreviewing ? 'animate-spin' : ''}`} />
                  </Button>
                )}
              </div>
            )}
          </div>
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
                {/* General Warnings (excluding dirty working tree - shown in mode options) */}
                {(() => {
                  const filteredWarnings = preview.warnings.filter(
                    (w) => !w.toLowerCase().includes('stash or commit')
                  )
                  return (
                    filteredWarnings.length > 0 && (
                      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
                          <div className="flex-1 space-y-1 text-sm">
                            {filteredWarnings.map((warning, i) => (
                              <p key={i} className="text-amber-800 dark:text-amber-200">
                                {warning}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  )
                })()}

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
                        <Button variant="outline" size="sm" className="mt-3" onClick={onOpenIDE}>
                          Open Worktree in IDE
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* JSONL Conflicts Info */}
                {/* {preview.conflicts.jsonlConflicts.length > 0 && (
                  <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" />
                      <div className="flex-1 text-sm">
                        <p className="font-medium text-amber-900 dark:text-amber-100">
                          JSONL Conflicts Detected
                        </p>
                        <p className="mt-1 text-amber-800 dark:text-amber-200">
                          The following files may have merge conflicts that need manual resolution:
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
                )} */}

                {/* Local Uncommitted JSONL Auto-Merge Info */}
                {preview.localUncommittedJsonl?.willAutoMerge && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 text-blue-600" />
                      <div className="flex-1 text-sm">
                        <p className="font-medium text-blue-900 dark:text-blue-100">
                          Local JSONL Changes Will Be Auto-Merged
                        </p>
                        <p className="mt-1 text-blue-800 dark:text-blue-200">
                          Your uncommitted changes to{' '}
                          <span className="font-mono text-xs">
                            {preview.localUncommittedJsonl.files
                              .map((f) => f.split('/').pop())
                              .join(', ')}
                          </span>{' '}
                          will be automatically merged with the incoming changes.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Uncommitted Changes Info */}
                {preview.uncommittedChanges && preview.uncommittedChanges.files.length > 0 && (
                  <div className="rounded-lg border border-muted-foreground/30 bg-muted/30 p-3">
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 text-sm">
                        <p className="font-medium">Uncommitted Changes</p>
                        <p className="mt-1 text-muted-foreground">
                          {preview.uncommittedChanges.files.length} uncommitted file
                          {preview.uncommittedChanges.files.length !== 1 ? 's' : ''} in worktree
                          will <span className="font-medium text-amber-600">not be included</span>{' '}
                          in sync by default.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Use "Stage changes only" with the include option to add these files.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mode Selector */}
                <div className="rounded-lg p-1">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="font-medium">Sync Mode</h3>
                  </div>
                  <RadioGroup
                    value={selectedMode}
                    onValueChange={(v) => setSelectedMode(v as SyncMode)}
                  >
                    <div className="space-y-3">
                      <div
                        className={`rounded-md border p-3 ${selectedMode === 'stage' ? 'border-primary bg-muted/30' : 'hover:bg-muted/50'}`}
                      >
                        <Label
                          htmlFor="stage"
                          className="flex cursor-pointer items-start space-x-3"
                        >
                          <RadioGroupItem value="stage" id="stage" className="mt-1" />
                          <div className="flex-1">
                            <span className="font-medium">Stage changes only</span>
                            <p className="mt-1 text-sm font-normal text-muted-foreground">
                              Merge committed changes to working directory without committing
                            </p>
                          </div>
                        </Label>
                        {/* Checkbox for including uncommitted changes - only show when stage mode is selected */}
                        {selectedMode === 'stage' &&
                          preview?.uncommittedChanges &&
                          preview.uncommittedChanges.files.length > 0 && (
                            <div className="ml-7 mt-3 space-y-3 border-t pt-3">
                              <Label
                                htmlFor="include-uncommitted"
                                className="flex cursor-pointer items-center gap-2 text-sm"
                              >
                                <Checkbox
                                  id="include-uncommitted"
                                  checked={includeUncommitted}
                                  onCheckedChange={(checked) =>
                                    setIncludeUncommitted(checked === true)
                                  }
                                />
                                <span className="flex items-center gap-1">
                                  Include uncommitted changes
                                  <span className="ml-2 text-muted-foreground">
                                    {preview.uncommittedChanges.files.length} file
                                    {preview.uncommittedChanges.files.length !== 1 ? 's' : ''}
                                  </span>
                                  <span className="text-green-600">
                                    +{preview.uncommittedChanges.additions}
                                  </span>
                                  <span className="text-red-600">
                                    -{preview.uncommittedChanges.deletions}
                                  </span>
                                </span>
                              </Label>
                              {/* Potential conflicts warning and override option */}
                              {includeUncommitted &&
                                preview.potentialLocalConflicts &&
                                preview.potentialLocalConflicts.count > 0 && (
                                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                                    <div className="flex items-start gap-2">
                                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                      <div className="flex-1 space-y-2 text-sm">
                                        <p className="text-amber-800 dark:text-amber-200">
                                          <span className="font-medium">
                                            {preview.potentialLocalConflicts.count} file
                                            {preview.potentialLocalConflicts.count !== 1 ? 's' : ''}
                                          </span>{' '}
                                          may have merge conflicts with your local changes.
                                          Conflicting changes will have conflict markers that you'll
                                          need to resolve manually.
                                        </p>
                                        <Label
                                          htmlFor="override-local"
                                          className="flex cursor-pointer items-center gap-2"
                                        >
                                          <Checkbox
                                            id="override-local"
                                            checked={overrideLocalChanges}
                                            onCheckedChange={(checked) =>
                                              setOverrideLocalChanges(checked === true)
                                            }
                                          />
                                          <span className="text-amber-800 dark:text-amber-200">
                                            Override local changes (skip merge, use worktree
                                            version)
                                          </span>
                                        </Label>
                                      </div>
                                    </div>
                                  </div>
                                )}
                            </div>
                          )}
                      </div>
                      <div
                        className={`rounded-md border p-3 ${
                          hasCommits ? 'hover:bg-muted/50' : 'cursor-not-allowed opacity-50'
                        }`}
                      >
                        <Label
                          htmlFor="squash"
                          className="flex cursor-pointer items-start space-x-3"
                        >
                          <RadioGroupItem
                            value="squash"
                            id="squash"
                            className="mt-1"
                            disabled={!hasCommits}
                          />
                          <div className="flex-1">
                            <span className="font-medium">Squash and merge</span>
                            <p className="mt-1 text-sm font-normal text-muted-foreground">
                              Combine all worktree changes into a single commit on{' '}
                              {targetBranch ? (
                                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                                  {targetBranch}
                                </code>
                              ) : (
                                'your local branch'
                              )}
                            </p>
                            {!hasCommits && (
                              <p className="mt-1 text-xs text-amber-600">
                                Requires committed changes
                              </p>
                            )}
                          </div>
                        </Label>
                        {/* Dirty working tree warning */}
                        {selectedMode === 'squash' && hasDirtyWorkingTree && (
                          <div className="ml-7 mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
                            <p className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              <span>
                                Local working tree has uncommitted changes. Stash or commit them
                                first.
                                {onRefresh && (
                                  <>
                                    {' '}
                                    <button
                                      type="button"
                                      onClick={onRefresh}
                                      disabled={isPreviewing}
                                      className="underline hover:no-underline disabled:opacity-50"
                                    >
                                      {isPreviewing ? 'Refreshing...' : 'Refresh'}
                                    </button>
                                  </>
                                )}
                              </span>
                            </p>
                          </div>
                        )}
                      </div>
                      <div
                        className={`rounded-md border p-3 ${
                          hasCommits ? 'hover:bg-muted/50' : 'cursor-not-allowed opacity-50'
                        }`}
                      >
                        <Label
                          htmlFor="preserve"
                          className="flex cursor-pointer items-start space-x-3"
                        >
                          <RadioGroupItem
                            value="preserve"
                            id="preserve"
                            className="mt-1"
                            disabled={!hasCommits}
                          />
                          <div className="flex-1">
                            <span className="font-medium">Merge all commits</span>
                            <p className="mt-1 text-sm font-normal text-muted-foreground">
                              Merge all commits to{' '}
                              {targetBranch ? (
                                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                                  {targetBranch}
                                </code>
                              ) : (
                                'your local branch'
                              )}{' '}
                              and preserve commit history
                            </p>
                            {!hasCommits && (
                              <p className="mt-1 text-xs text-amber-600">
                                Requires committed changes
                              </p>
                            )}
                          </div>
                        </Label>
                        {/* Dirty working tree warning */}
                        {selectedMode === 'preserve' && hasDirtyWorkingTree && (
                          <div className="ml-7 mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
                            <p className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              <span>
                                Local working tree has uncommitted changes. Stash or commit them
                                first.
                                {onRefresh && (
                                  <>
                                    {' '}
                                    <button
                                      type="button"
                                      onClick={onRefresh}
                                      disabled={isPreviewing}
                                      className="underline hover:no-underline disabled:opacity-50"
                                    >
                                      {isPreviewing ? 'Refreshing...' : 'Refresh'}
                                    </button>
                                  </>
                                )}
                              </span>
                            </p>
                          </div>
                        )}
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

                  {/* Commit History (for preserve mode) */}
                  {selectedMode === 'preserve' && preview.commits.length > 0 && (
                    <div className="mt-2 rounded-lg border p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <GitCommit className="h-4 w-4" />
                        <h3 className="text-sm">Commits to merge</h3>
                        <Badge variant="secondary">{preview.commits.length}</Badge>
                      </div>
                      <Collapsible open={commitsExpanded} onOpenChange={setCommitsExpanded}>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="xs" className="">
                            {commitsExpanded ? (
                              <ChevronDown className="mr-2 h-4 w-4" />
                            ) : (
                              <ChevronRight className="mr-2 h-4 w-4" />
                            )}
                            {commitsExpanded ? 'Hide' : 'Show'} Commits
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2">
                          <ScrollArea className="h-48">
                            <ul className="space-y-1">
                              {preview.commits.map((commit) => (
                                <li
                                  key={commit.sha}
                                  className="border-l-2 border-blue-500 bg-muted/50 p-2"
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
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canSync || isPreviewing}>
            {getButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
