import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Copy,
  Check,
  GitBranch,
  GitCommit,
  FileText,
  AlertCircle,
  Loader2,
  GitMerge,
  FolderOpen,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { executionsApi } from '@/lib/api'
import { useExecutionSync } from '@/hooks/useExecutionSync'
import { DeleteWorktreeDialog } from '@/components/executions/DeleteWorktreeDialog'
import type { Execution, SyncPreviewResult } from '@/types/execution'
import { cn } from '@/lib/utils'

interface WorktreeDetailPanelProps {
  execution: Execution | null
}

// Status badge colors
const statusColors: Record<string, string> = {
  running: 'bg-blue-500 dark:bg-blue-600',
  paused: 'bg-yellow-500 dark:bg-yellow-600',
  completed: 'bg-green-500 dark:bg-green-600',
  failed: 'bg-red-500 dark:bg-red-600',
  cancelled: 'bg-gray-500 dark:bg-gray-600',
  stopped: 'bg-orange-500 dark:bg-orange-600',
}

const statusLabels: Record<string, string> = {
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  stopped: 'Stopped',
}

export function WorktreeDetailPanel({ execution }: WorktreeDetailPanelProps) {
  const navigate = useNavigate()
  const [isCopiedId, setIsCopiedId] = useState(false)
  const [isCopiedPath, setIsCopiedPath] = useState(false)
  const [syncPreview, setSyncPreview] = useState<SyncPreviewResult | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const {
    fetchSyncPreview,
    openWorktreeInIDE,
    cleanupWorktree,
    isPreviewing,
  } = useExecutionSync()

  // Fetch sync preview when execution changes
  useEffect(() => {
    if (!execution) {
      setSyncPreview(null)
      return
    }

    const loadPreview = async () => {
      try {
        setIsLoadingPreview(true)
        const preview = await executionsApi.syncPreview(execution.id)
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

  const handleCopyId = useCallback(async () => {
    if (!execution) return
    try {
      await navigator.clipboard.writeText(execution.id)
      setIsCopiedId(true)
      setTimeout(() => setIsCopiedId(false), 2000)
      toast.success('Execution ID copied')
    } catch (error) {
      toast.error('Failed to copy ID')
    }
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

  const handleSync = useCallback(() => {
    if (!execution) return
    fetchSyncPreview(execution.id)
  }, [execution, fetchSyncPreview])

  const handleOpenIDE = useCallback(() => {
    if (!execution) return
    openWorktreeInIDE(execution)
  }, [execution, openWorktreeInIDE])

  const handleDelete = useCallback(async () => {
    if (!execution) return
    try {
      await cleanupWorktree(execution.id)
      toast.success('Worktree deleted successfully')
      setShowDeleteDialog(false)
    } catch (error) {
      toast.error('Failed to delete worktree')
    }
  }, [execution, cleanupWorktree])

  const handleViewFullDetails = useCallback(() => {
    if (!execution) return
    navigate(`/executions/${execution.id}`)
  }, [execution, navigate])

  if (!execution) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Select a worktree to view details</p>
      </div>
    )
  }

  const hasConflicts = syncPreview?.conflicts?.hasConflicts ?? false
  const totalAdditions = syncPreview?.diff?.additions ?? 0
  const totalDeletions = syncPreview?.diff?.deletions ?? 0

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-4">
        {/* Overview Section */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Overview</h3>
          <div className="flex flex-col gap-2 text-sm">
            {/* Execution ID */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Execution ID</span>
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs">{execution.id.substring(0, 12)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyId}
                  className="h-5 w-5 p-0"
                >
                  {isCopiedId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            {/* Issue */}
            {execution.issue_id && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Issue</span>
                <button
                  onClick={() => navigate(`/issues/${execution.issue_id}`)}
                  className="text-xs text-primary hover:underline"
                >
                  {execution.issue_id}
                </button>
              </div>
            )}

            {/* Branch */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Branch</span>
              <div className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                <span className="text-xs font-medium">{execution.branch_name}</span>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Status</span>
              <Badge
                className={cn(
                  'text-white text-xs',
                  statusColors[execution.status] || 'bg-gray-500'
                )}
              >
                {statusLabels[execution.status] || execution.status}
              </Badge>
            </div>

            {/* Created */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Created</span>
              <span className="text-xs">
                {format(new Date(execution.created_at), 'MMM d, yyyy h:mm a')}
              </span>
            </div>

            {/* Updated */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Updated</span>
              <span className="text-xs">
                {format(new Date(execution.updated_at), 'MMM d, yyyy h:mm a')}
              </span>
            </div>

            {/* Worktree Path */}
            {execution.worktree_path && (
              <>
                <Separator className="my-1" />
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground">Path</span>
                  <div className="flex items-center gap-1 max-w-[200px]">
                    <span className="text-xs font-mono truncate">
                      {execution.worktree_path}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyPath}
                      className="h-5 w-5 p-0 shrink-0"
                    >
                      {isCopiedPath ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              </>
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
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <GitCommit className="h-4 w-4" />
              Commits ({syncPreview.commits.length})
            </h3>
            <div className="flex flex-col gap-2">
              {syncPreview.commits.map((commit) => (
                <div key={commit.sha} className="text-xs border-l-2 border-muted pl-2">
                  <div className="font-mono text-muted-foreground">{commit.sha.substring(0, 7)}</div>
                  <div className="font-medium">{commit.message}</div>
                  <div className="text-muted-foreground">{commit.author}</div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* Files Changed Section */}
        {syncPreview?.diff && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Files Changed ({syncPreview.diff.files.length})
            </h3>
            <div className="flex items-center gap-3 mb-3 text-xs">
              <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>
              <span className="text-red-600 dark:text-red-400">-{totalDeletions}</span>
            </div>
            <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
              {syncPreview.diff.files.map((filePath, index) => (
                <div key={index} className="text-xs">
                  <span className="truncate font-mono">{filePath}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Conflicts Section */}
        {hasConflicts && syncPreview?.conflicts && (
          <Card className="p-4 border-destructive">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              Conflicts ({syncPreview.conflicts.totalFiles})
            </h3>
            <div className="flex flex-col gap-2 text-xs">
              {syncPreview.conflicts.codeConflicts.map((conflict, index) => (
                <div key={index} className="flex items-start gap-2">
                  <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <div className="font-mono">{conflict.filePath}</div>
                    <div className="text-muted-foreground">Requires manual resolution</div>
                  </div>
                </div>
              ))}
              {syncPreview.conflicts.jsonlConflicts.map((conflict, index) => (
                <div key={index} className="flex items-start gap-2">
                  <AlertCircle className="h-3 w-3 text-yellow-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-mono">{conflict.filePath}</div>
                    <div className="text-muted-foreground">Auto-resolvable</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Action Bar */}
        <div className="flex flex-col gap-2 pt-2 border-t">
          <Button onClick={handleSync} className="w-full" disabled={isPreviewing}>
            <GitMerge className="h-4 w-4 mr-2" />
            Sync to Local
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleOpenIDE} className="w-full">
              <FolderOpen className="h-4 w-4 mr-2" />
              Open in IDE
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(true)}
              className="w-full text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
          <Button variant="ghost" onClick={handleViewFullDetails} className="w-full">
            <ExternalLink className="h-4 w-4 mr-2" />
            View Full Details
          </Button>
        </div>
      </div>

      {/* Delete Worktree Dialog */}
      <DeleteWorktreeDialog
        worktreePath={execution.worktree_path ?? null}
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
