import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Copy,
  Check,
  GitBranch,
  GitCommit,
  FileText,
  FilePen,
  Loader2,
  FolderOpen,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { repositoryApi } from '@/lib/api'
import { useExecutionSync } from '@/hooks/useExecutionSync'
import { DeleteWorktreeDialog } from '@/components/executions/DeleteWorktreeDialog'
import type { Execution, SyncPreviewResult } from '@/types/execution'

interface WorktreeDetailPanelProps {
  execution: Execution | null
}

export function WorktreeDetailPanel({ execution }: WorktreeDetailPanelProps) {
  const [isCopiedPath, setIsCopiedPath] = useState(false)
  const [syncPreview, setSyncPreview] = useState<SyncPreviewResult | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const { openWorktreeInIDE, cleanupWorktree } = useExecutionSync()

  // Fetch sync preview when execution changes
  useEffect(() => {
    if (!execution?.worktree_path || !execution.branch_name || !execution.target_branch) {
      setSyncPreview(null)
      return
    }

    const loadPreview = async () => {
      try {
        setIsLoadingPreview(true)
        const preview = await repositoryApi.previewWorktreeSync({
          worktreePath: execution.worktree_path!,
          branchName: execution.branch_name,
          targetBranch: execution.target_branch,
        })
        setSyncPreview(preview)
      } catch (error) {
        console.error('Failed to load sync preview:', error)
        // Don't show error toast here, as preview might not be available for all worktrees
      } finally {
        setIsLoadingPreview(false)
      }
    }

    loadPreview()
  }, [execution])

  const handleCopyPath = useCallback(async () => {
    if (!execution?.worktree_path) return
    try {
      await navigator.clipboard.writeText(execution.worktree_path)
      setIsCopiedPath(true)
      setTimeout(() => setIsCopiedPath(false), 2000)
      toast.success('Path copied')
    } catch (error) {
      toast.error('Failed to copy path')
    }
  }, [execution])

  // const handleSync = useCallback(() => {
  //   if (!execution) return
  //   fetchSyncPreview(execution.id)
  // }, [execution, fetchSyncPreview])

  const handleOpenIDE = useCallback(() => {
    if (!execution) return
    openWorktreeInIDE(execution)
  }, [execution, openWorktreeInIDE])

  const handleDelete = useCallback(
    async (deleteBranch: boolean) => {
      if (!execution) return
      setIsDeleting(true)
      try {
        await cleanupWorktree(execution.id, deleteBranch)
        toast.success('Worktree deleted successfully')
        setShowDeleteDialog(false)
      } catch (error) {
        toast.error('Failed to delete worktree')
      } finally {
        setIsDeleting(false)
      }
    },
    [execution, cleanupWorktree]
  )

  if (!execution) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Select a worktree to view details</p>
      </div>
    )
  }

  const totalAdditions = syncPreview?.diff?.additions ?? 0
  const totalDeletions = syncPreview?.diff?.deletions ?? 0

  // Determine if branch was created by execution (auto-created branches start with "sudocode/")
  const branchWasCreatedByExecution = execution?.branch_name?.startsWith('sudocode/') ?? false

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-2 p-3">
        {/* Overview Section */}
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Overview</h3>
          <div className="flex flex-col gap-2 text-sm">
            {/* Branch */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                <span className="text-xs font-medium">{execution.branch_name}</span>
              </div>
            </div>

            {/* Worktree Path */}
            {execution.worktree_path && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-muted-foreground">Path:</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {execution.worktree_path}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyPath}
                  className="h-5 w-5 shrink-0 p-0"
                >
                  {isCopiedPath ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Commits Section */}
        {isLoadingPreview ? (
          <Card className="p-4">
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </Card>
        ) : syncPreview?.commits && syncPreview.commits.length > 0 ? (
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <GitCommit className="h-4 w-4" />
              Commits ({syncPreview.commits.length})
            </h3>
            <div className="flex flex-col gap-2">
              {syncPreview.commits.slice(0, 5).map((commit) => (
                <div key={commit.sha} className="border-l-2 border-muted pl-2 text-xs">
                  <div className="font-mono text-muted-foreground">
                    {commit.sha.substring(0, 7)}
                  </div>
                  <div className="font-medium">{commit.message}</div>
                  <div className="text-muted-foreground">{commit.author}</div>
                </div>
              ))}
              {syncPreview.commits.length > 5 && (
                <div className="pl-2 text-xs text-muted-foreground">
                  + {syncPreview.commits.length - 5} more
                </div>
              )}
            </div>
          </Card>
        ) : null}

        {/* Files Changed Section - Committed */}
        {syncPreview?.diff && syncPreview.diff.files.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4" />
              Committed Changes ({syncPreview.diff.files.length})
            </h3>
            <div className="mb-3 flex items-center gap-3 text-xs">
              <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>
              <span className="text-red-600 dark:text-red-400">-{totalDeletions}</span>
            </div>
            <div className="flex flex-col gap-1">
              {syncPreview.diff.files.slice(0, 5).map((filePath, index) => (
                <div key={index} className="text-xs">
                  <span className="truncate font-mono">{filePath}</span>
                </div>
              ))}
              {syncPreview.diff.files.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  + {syncPreview.diff.files.length - 5} more
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Files Changed Section - Uncommitted */}
        {syncPreview?.uncommittedChanges && syncPreview.uncommittedChanges.files.length > 0 && (
          <Card className="border-yellow-500/50 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-yellow-600 dark:text-yellow-400">
              <FilePen className="h-4 w-4" />
              Uncommitted Changes ({syncPreview.uncommittedChanges.files.length})
            </h3>
            <div className="mb-3 flex items-center gap-3 text-xs">
              <span className="text-green-600 dark:text-green-400">
                +{syncPreview.uncommittedChanges.additions}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{syncPreview.uncommittedChanges.deletions}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {syncPreview.uncommittedChanges.files.slice(0, 5).map((filePath, index) => (
                <div key={index} className="text-xs">
                  <span className="truncate font-mono">{filePath}</span>
                </div>
              ))}
              {syncPreview.uncommittedChanges.files.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  + {syncPreview.uncommittedChanges.files.length - 5} more
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Action Bar */}
        <div className="flex flex-col gap-2 pt-2">
          {/* <Button onClick={handleSync} disabled={isPreviewing}>
            <GitMerge className="mr-2 h-4 w-4" />
            Sync to Local
          </Button> */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleOpenIDE} className="w-full">
              <FolderOpen className="mr-2 h-4 w-4" />
              Open in IDE
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(true)}
              className="w-full text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Cleanup
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Worktree Dialog */}
      <DeleteWorktreeDialog
        worktreePath={execution.worktree_path ?? null}
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        branchName={execution.branch_name}
        branchWasCreatedByExecution={branchWasCreatedByExecution}
      />
    </div>
  )
}
