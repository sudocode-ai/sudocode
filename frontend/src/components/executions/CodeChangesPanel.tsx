/**
 * CodeChangesPanel Component
 *
 * Displays code changes (file list + diff statistics) for an execution.
 * Supports both committed and uncommitted changes.
 *
 * @module components/executions/CodeChangesPanel
 */

import { useEffect, useRef, useState } from 'react'
import { useExecutionChanges } from '@/hooks/useExecutionChanges'
import { executionsApi } from '@/lib/api'
import { toast } from 'sonner'
import {
  FileText,
  AlertCircle,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ExternalLink,
  Maximize2,
  X,
} from 'lucide-react'
import type { FileChangeStat } from '@/types/execution'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DiffViewer } from './DiffViewer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const CODE_CHANGES_STORAGE_KEY = 'codeChanges.isCollapsed'
const MAX_FILES_TO_SHOW = 20

interface CodeChangesPanelProps {
  executionId: string
  /** Auto-refresh interval in milliseconds. If provided, changes will refresh automatically. */
  autoRefreshInterval?: number
  /** Execution status - used to trigger refresh on completion */
  executionStatus?: string
  /** Worktree path - if provided, shows "Open in IDE" button */
  worktreePath?: string | null
  /** Diff expansion mode: 'inline' shows diff inline, 'modal' opens in full-screen modal (default: 'inline') */
  diffMode?: 'inline' | 'modal'
}

/**
 * Get user-friendly message for unavailability reason
 */
function getReasonMessage(reason?: string): string {
  switch (reason) {
    case 'missing_commits':
      return 'Commit information not captured'
    case 'commits_not_found':
      return 'Commits no longer exist in repository'
    case 'incomplete_execution':
      return 'Execution did not complete successfully'
    case 'git_error':
      return 'Git operation failed'
    case 'worktree_deleted_with_uncommitted_changes':
      return 'Worktree was deleted before changes were committed'
    case 'branch_deleted':
      return 'Branch no longer exists, showing captured state'
    default:
      return 'Unknown reason'
  }
}

/**
 * Get status badge color and label
 */
function getStatusBadge(status: 'A' | 'M' | 'D' | 'R') {
  switch (status) {
    case 'A':
      return { variant: 'default' as const, label: 'Added', color: 'text-green-600' }
    case 'M':
      return { variant: 'secondary' as const, label: 'Modified', color: 'text-blue-600' }
    case 'D':
      return { variant: 'destructive' as const, label: 'Deleted', color: 'text-red-600' }
    case 'R':
      return { variant: 'outline' as const, label: 'Renamed', color: 'text-purple-600' }
  }
}

/**
 * File change row component
 */
function FileChangeRow({
  file,
  executionId,
  mode = 'inline',
}: {
  file: FileChangeStat
  executionId: string
  mode?: 'inline' | 'modal'
}) {
  const statusBadge = getStatusBadge(file.status)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoadingDiff, setIsLoadingDiff] = useState(false)
  const [diffContent, setDiffContent] = useState<{
    oldContent: string
    newContent: string
  } | null>(null)

  const fetchDiff = async () => {
    if (diffContent) return // Already loaded

    setIsLoadingDiff(true)
    try {
      const result = await executionsApi.getFileDiff(executionId, file.path)
      console.log(`[CodeChangesPanel] Received diff for ${file.path}:`, {
        oldContentLength: result.oldContent?.length || 0,
        newContentLength: result.newContent?.length || 0,
        oldContentPreview: result.oldContent?.substring(0, 100),
        newContentPreview: result.newContent?.substring(0, 100),
      })
      setDiffContent({
        oldContent: result.oldContent || '',
        newContent: result.newContent || '',
      })
    } catch (error) {
      console.error(`[CodeChangesPanel] Failed to load diff for ${file.path}:`, error)
      const message = error instanceof Error ? error.message : 'Failed to load diff'
      toast.error(message)
    } finally {
      setIsLoadingDiff(false)
    }
  }

  const handleClick = async () => {
    if (mode === 'modal') {
      // Modal mode - open full-screen modal
      if (!diffContent) {
        await fetchDiff()
      }
      setIsModalOpen(true)
    } else {
      // Inline mode - toggle inline expansion
      if (!isExpanded && !diffContent) {
        await fetchDiff()
        setIsExpanded(true)
      } else {
        setIsExpanded(!isExpanded)
      }
    }
  }

  return (
    <>
      <div className="border-b border-border/50 last:border-0">
        <button
          onClick={handleClick}
          className="flex w-full items-start gap-2 py-2 text-left transition-colors hover:bg-muted/50"
          disabled={isLoadingDiff}
        >
          {isLoadingDiff ? (
            <Loader2 className="mt-0.5 h-3 w-3 flex-shrink-0 animate-spin text-muted-foreground" />
          ) : mode === 'modal' ? (
            <Maximize2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDown className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
          )}
          <FileText className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
          <div className="flex flex-1 items-baseline gap-2">
            <span className={`text-[10px] ${statusBadge.color} shrink-0`}>{file.status}</span>
            <span className="flex-1 truncate leading-relaxed" title={file.path}>
              {file.path}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {file.additions > 0 && <span className="text-green-600">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-red-600">-{file.deletions}</span>}
            </div>
          </div>
        </button>
        {mode === 'inline' && isExpanded && diffContent && (
          <div className="px-6 pb-3">
            <DiffViewer
              oldContent={diffContent.oldContent}
              newContent={diffContent.newContent}
              filePath={file.path}
              maxLines={100}
            />
          </div>
        )}
      </div>

      {/* Modal for full-screen diff view (only in modal mode) */}
      {mode === 'modal' && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="flex h-[75vh] max-w-[75vw] flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-8 font-mono text-sm">
                <span className={`text-[10px] ${statusBadge.color}`}>{file.status}</span>
                <span className="flex-1 truncate">{file.path}</span>
                <div className="flex shrink-0 items-center gap-2 text-xs font-normal">
                  {file.additions > 0 && <span className="text-green-600">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-red-600">-{file.deletions}</span>}
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="ml-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </button>
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-hidden">
              {diffContent && (
                <DiffViewer
                  oldContent={diffContent.oldContent}
                  newContent={diffContent.newContent}
                  filePath={file.path}
                  maxLines={10000} // Show full diff in modal
                  sideBySide={true}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/**
 * Code changes panel component
 */
export function CodeChangesPanel({
  executionId,
  autoRefreshInterval,
  executionStatus,
  worktreePath,
  diffMode = 'inline',
}: CodeChangesPanelProps) {
  const { data, loading, error, refresh } = useExecutionChanges(executionId)
  const previousStatusRef = useRef<string | undefined>(executionStatus)

  // Determine if we can open in IDE (have a worktree path)
  const canOpenInIDE = !!worktreePath

  // Handler for opening in IDE
  const handleOpenInIDE = async () => {
    if (!worktreePath) {
      toast.error('No worktree path available')
      return
    }

    try {
      await executionsApi.openInIde(worktreePath)
      toast.success('Opening worktree in IDE...')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open IDE'
      toast.error(message)
    }
  }

  // Initialize state from localStorage
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(CODE_CHANGES_STORAGE_KEY)
      return stored ? JSON.parse(stored) : true
    } catch {
      return true
    }
  })

  // State to track whether to show all files or limit to MAX_FILES_TO_SHOW
  const [showAllFiles, setShowAllFiles] = useState(false)

  // Save to localStorage whenever collapse state changes
  useEffect(() => {
    try {
      localStorage.setItem(CODE_CHANGES_STORAGE_KEY, JSON.stringify(isCollapsed))
    } catch {
      // Ignore localStorage errors
    }
  }, [isCollapsed])

  // Set up auto-refresh interval if provided
  useEffect(() => {
    if (!autoRefreshInterval) {
      return
    }

    const intervalId = setInterval(() => {
      refresh()
    }, autoRefreshInterval)

    // Cleanup interval on unmount or when interval changes
    return () => {
      clearInterval(intervalId)
    }
  }, [autoRefreshInterval, refresh])

  // Refresh when execution completes
  useEffect(() => {
    const previousStatus = previousStatusRef.current
    const currentStatus = executionStatus

    // Update ref for next comparison
    previousStatusRef.current = currentStatus

    // If status changed from running to a terminal state, refresh
    if (
      previousStatus === 'running' &&
      currentStatus &&
      ['completed', 'stopped', 'failed'].includes(currentStatus)
    ) {
      console.log(`[CodeChangesPanel] Execution ${executionId} completed, refreshing changes`)
      refresh()
    }
  }, [executionStatus, executionId, refresh])

  // Show loading state only on initial load (when we have no data yet)
  if (loading && !data) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading code changes...</span>
        </div>
      </div>
    )
  }

  // Show error only if we have no data to display
  if (error && !data) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-3 w-3" />
          <span>Failed to load changes: {error.message}</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  if (!data.available) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-3 w-3" />
          <span>Changes unavailable: {getReasonMessage(data.reason)}</span>
        </div>
      </div>
    )
  }

  // Use current state if available, otherwise use captured state
  const snapshot = data.current || data.captured
  if (!snapshot) {
    return null
  }

  // Calculate total stats from all sources
  // If snapshot is uncommitted and there's no uncommittedSnapshot, use snapshot.files as uncommitted
  // Otherwise, use uncommittedSnapshot for uncommitted files
  const uncommittedFiles =
    data.uncommittedSnapshot?.files || (snapshot.uncommitted ? snapshot.files : [])
  const committedFiles = snapshot.uncommitted ? [] : snapshot.files
  const totalFiles = committedFiles.length + uncommittedFiles.length
  const totalAdditions =
    snapshot.summary.totalAdditions + (data.uncommittedSnapshot?.summary.totalAdditions || 0)
  const totalDeletions =
    snapshot.summary.totalDeletions + (data.uncommittedSnapshot?.summary.totalDeletions || 0)

  // Don't render if there are no file changes
  if (totalFiles === 0) {
    return null
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
      {/* Header */}
      <div className="flex w-full items-center gap-2">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex flex-1 items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={isCollapsed ? 'Expand code changes' : 'Collapse code changes'}
        >
          {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          <div className="flex flex-1 flex-row items-center gap-4 text-left">
            <span className="font-semibold uppercase tracking-wide">
              {totalFiles} {totalFiles === 1 ? 'FILE' : 'FILES'}
            </span>
            {totalAdditions > 0 && <span className="text-green-600">+{totalAdditions}</span>}
            {totalDeletions > 0 && <span className="text-red-600">-{totalDeletions}</span>}
            {data.current && data.additionalCommits && data.additionalCommits > 0 && (
              <span className="text-blue-600">+{data.additionalCommits} new</span>
            )}
          </div>
        </button>
        <TooltipProvider>
          <div className="flex items-center gap-3">
            {canOpenInIDE && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleOpenInIDE}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Open Worktree in IDE"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Open Worktree in IDE</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={refresh}
                  disabled={loading}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  title="Refresh changes"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh changes</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Expanded content */}
      {!isCollapsed && (
        <>
          {/* Metadata info */}
          {(data.current ||
            data.branchName ||
            (data.worktreeExists === false && data.executionMode === 'worktree')) && (
            <div className="mt-3 space-y-1 text-muted-foreground">
              {data.current && <div>Showing current state of branch: {data.branchName}</div>}
              {data.branchName && data.branchExists === false && (
                <div className="text-orange-600">Branch no longer exists</div>
              )}
              {data.worktreeExists === false && data.executionMode === 'worktree' && (
                <div className="text-orange-600">Worktree deleted</div>
              )}
            </div>
          )}

          {/* Committed changes section */}
          {committedFiles.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-muted-foreground">
                Committed ({committedFiles.length} {committedFiles.length === 1 ? 'file' : 'files'})
              </div>
              <div className="space-y-1">
                {(showAllFiles ? committedFiles : committedFiles.slice(0, MAX_FILES_TO_SHOW)).map(
                  (file) => (
                    <FileChangeRow
                      key={file.path}
                      file={file}
                      executionId={executionId}
                      mode={diffMode}
                    />
                  )
                )}
              </div>
            </div>
          )}

          {/* Uncommitted changes section */}
          {uncommittedFiles.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-yellow-600">
                Uncommitted ({uncommittedFiles.length}{' '}
                {uncommittedFiles.length === 1 ? 'file' : 'files'})
              </div>
              <div className="space-y-1">
                {(() => {
                  // Calculate how many uncommitted files to show based on remaining budget
                  const committedShown = showAllFiles
                    ? committedFiles.length
                    : Math.min(committedFiles.length, MAX_FILES_TO_SHOW)
                  const remainingBudget = Math.max(0, MAX_FILES_TO_SHOW - committedShown)
                  const filesToShow = showAllFiles
                    ? uncommittedFiles
                    : uncommittedFiles.slice(0, remainingBudget)
                  return filesToShow.map((file) => (
                    <FileChangeRow
                      key={`uncommitted-${file.path}`}
                      file={file}
                      executionId={executionId}
                      mode={diffMode}
                    />
                  ))
                })()}
              </div>
            </div>
          )}

          {/* Show all / Show less button */}
          {totalFiles > MAX_FILES_TO_SHOW && (
            <button
              onClick={() => setShowAllFiles(!showAllFiles)}
              className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAllFiles
                ? 'Show less'
                : `Show all ${totalFiles} files (${totalFiles - MAX_FILES_TO_SHOW} more)`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
