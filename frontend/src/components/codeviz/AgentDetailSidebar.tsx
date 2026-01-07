/**
 * AgentDetailSidebar - Slide-out panel showing detailed agent execution information
 *
 * Displays:
 * - Agent type and status
 * - Linked issue and spec
 * - Changed files with diff access
 * - Action buttons (Stop, Follow Up)
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, X, Bot, Loader2, FileText, ClipboardList, ExternalLink, ChevronRight, Square, MessageSquarePlus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { executionsApi, issuesApi, specsApi, relationshipsApi } from '@/lib/api'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { useExecutionChanges } from '@/hooks/useExecutionChanges'
import { DiffViewer } from '@/components/executions/DiffViewer'
import { FollowUpDialog } from '@/components/executions/FollowUpDialog'
import { getAgentColor } from '@/utils/colors'
import { cn } from '@/lib/utils'
import type { ExecutionStatus, FileChangeStat, Execution } from '@/types/execution'
import type { Issue, IssueStatus } from '@sudocode-ai/types'
import type { Spec } from '@/types/api'

/**
 * Props for the AgentDetailSidebar component
 */
export interface AgentDetailSidebarProps {
  /** ID of the execution to display */
  executionId: string
  /** Whether the sidebar is open */
  isOpen: boolean
  /** Callback when sidebar should close */
  onClose: () => void
  /** Callback when hovering over a file (for map highlight) */
  onFileHover?: (filePath: string) => void
  /** Callback when leaving a file hover (for map highlight removal) */
  onFileLeave?: (filePath: string) => void
}

/**
 * Status configuration for visual indicators
 */
const STATUS_CONFIG: Record<
  ExecutionStatus,
  { label: string; className: string; dotClassName: string }
> = {
  preparing: {
    label: 'Preparing',
    className: 'text-yellow-600 dark:text-yellow-400',
    dotClassName: 'bg-yellow-500',
  },
  pending: {
    label: 'Pending',
    className: 'text-yellow-600 dark:text-yellow-400',
    dotClassName: 'bg-yellow-500',
  },
  running: {
    label: 'Running',
    className: 'text-green-600 dark:text-green-400',
    dotClassName: 'bg-green-500 animate-pulse',
  },
  paused: {
    label: 'Paused',
    className: 'text-orange-600 dark:text-orange-400',
    dotClassName: 'bg-orange-500',
  },
  completed: {
    label: 'Completed',
    className: 'text-green-600 dark:text-green-400',
    dotClassName: 'bg-green-500',
  },
  failed: {
    label: 'Failed',
    className: 'text-red-600 dark:text-red-400',
    dotClassName: 'bg-red-500',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'text-gray-600 dark:text-gray-400',
    dotClassName: 'bg-gray-500',
  },
  stopped: {
    label: 'Stopped',
    className: 'text-gray-600 dark:text-gray-400',
    dotClassName: 'bg-gray-500',
  },
}

/**
 * Format agent type for display
 */
function formatAgentType(agentType: string): string {
  const displayNames: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
  }
  return displayNames[agentType] || agentType
}

/**
 * Issue status badge configuration
 */
const ISSUE_STATUS_CONFIG: Record<IssueStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  open: { label: 'Open', variant: 'outline' },
  in_progress: { label: 'In Progress', variant: 'default' },
  blocked: { label: 'Blocked', variant: 'destructive' },
  needs_review: { label: 'Needs Review', variant: 'secondary' },
  closed: { label: 'Closed', variant: 'secondary' },
}

/**
 * Linked Issue Card - Compact card showing linked issue with navigation
 */
interface LinkedIssueCardProps {
  issue: Issue
  onClick: () => void
}

function LinkedIssueCard({ issue, onClick }: LinkedIssueCardProps) {
  const statusConfig = ISSUE_STATUS_CONFIG[issue.status] || ISSUE_STATUS_CONFIG.open

  return (
    <Card
      className="cursor-pointer p-3 transition-colors hover:bg-muted/50"
      onClick={onClick}
      data-testid="linked-issue-card"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
          </div>
          <Badge variant={statusConfig.variant} className="text-xs">
            {statusConfig.label}
          </Badge>
        </div>
        <p className="line-clamp-2 text-sm font-medium">{issue.title}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3" />
          <span>View issue</span>
        </div>
      </div>
    </Card>
  )
}

/**
 * Linked Spec Card - Compact card showing linked spec with navigation
 */
interface LinkedSpecCardProps {
  spec: Spec
  onClick: () => void
}

function LinkedSpecCard({ spec, onClick }: LinkedSpecCardProps) {
  return (
    <Card
      className="cursor-pointer p-3 transition-colors hover:bg-muted/50"
      onClick={onClick}
      data-testid="linked-spec-card"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">{spec.id}</span>
        </div>
        <p className="line-clamp-2 text-sm font-medium">{spec.title}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3" />
          <span>View spec</span>
        </div>
      </div>
    </Card>
  )
}

/**
 * Get status badge color for file change status
 */
function getFileStatusBadge(status: 'A' | 'M' | 'D' | 'R') {
  switch (status) {
    case 'A':
      return { label: 'A', color: 'bg-green-500/20 text-green-600 dark:text-green-400' }
    case 'M':
      return { label: 'M', color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' }
    case 'D':
      return { label: 'D', color: 'bg-red-500/20 text-red-600 dark:text-red-400' }
    case 'R':
      return { label: 'R', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400' }
  }
}

/**
 * Changed Files List - Compact list of file changes with diff modal
 */
interface ChangedFilesListProps {
  executionId: string
  isOpen: boolean
  /** Callback when hovering over a file */
  onFileHover?: (filePath: string) => void
  /** Callback when leaving a file hover */
  onFileLeave?: (filePath: string) => void
}

function ChangedFilesList({ executionId, isOpen, onFileHover, onFileLeave }: ChangedFilesListProps) {
  const { data, loading, error } = useExecutionChanges(isOpen ? executionId : null)
  const [selectedFile, setSelectedFile] = useState<FileChangeStat | null>(null)
  const [hoveredFile, setHoveredFile] = useState<string | null>(null)

  // Handle file hover for map highlighting
  const handleFileHover = (filePath: string) => {
    setHoveredFile(filePath)
    onFileHover?.(filePath)
  }

  // Handle file leave for map highlight removal
  const handleFileLeave = (filePath: string) => {
    setHoveredFile((prev) => (prev === filePath ? null : prev))
    onFileLeave?.(filePath)
  }
  const [diffContent, setDiffContent] = useState<{ oldContent: string; newContent: string } | null>(null)
  const [isLoadingDiff, setIsLoadingDiff] = useState(false)
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false)

  // Compute all files from changes data
  const allFiles: FileChangeStat[] = []
  if (data?.available) {
    if (data.current?.files) {
      allFiles.push(...data.current.files)
    } else if (data.captured?.files) {
      allFiles.push(...data.captured.files)
    }
    if (data.uncommittedSnapshot?.files) {
      allFiles.push(...data.uncommittedSnapshot.files)
    }
  }

  const handleViewDiff = async (file: FileChangeStat) => {
    setSelectedFile(file)
    setIsLoadingDiff(true)
    setIsDiffModalOpen(true)

    try {
      const result = await executionsApi.getFileDiff(executionId, file.path)
      setDiffContent({
        oldContent: result.oldContent || '',
        newContent: result.newContent || '',
      })
    } catch (err) {
      console.error('[ChangedFilesList] Failed to load diff:', err)
      setDiffContent({ oldContent: '', newContent: 'Error loading diff' })
    } finally {
      setIsLoadingDiff(false)
    }
  }

  const handleCloseModal = () => {
    setIsDiffModalOpen(false)
    setSelectedFile(null)
    setDiffContent(null)
  }

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Changed Files</h3>
        <Card className="flex items-center justify-center p-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </Card>
      </div>
    )
  }

  // Error state
  if (error && !data) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Changed Files</h3>
        <Card className="p-3">
          <p className="text-sm text-destructive">Failed to load changes</p>
        </Card>
      </div>
    )
  }

  // Unavailable state
  if (!data?.available) {
    return null
  }

  // No files changed
  if (allFiles.length === 0) {
    return null
  }

  return (
    <>
      <div className="flex flex-col gap-2" data-testid="changed-files-list">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Changed Files ({allFiles.length})
        </h3>
        <Card className="divide-y divide-border/50 p-0">
          {allFiles.slice(0, 10).map((file) => {
            const badge = getFileStatusBadge(file.status)
            return (
              <button
                key={file.path}
                onClick={() => handleViewDiff(file)}
                onMouseEnter={() => handleFileHover(file.path)}
                onMouseLeave={() => handleFileLeave(file.path)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50',
                  hoveredFile === file.path && 'bg-muted/30'
                )}
                data-testid="changed-file-row"
              >
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', badge.color)}>
                  {badge.label}
                </span>
                <span className="flex-1 truncate text-sm" title={file.path}>
                  {file.path.split('/').pop()}
                </span>
                <div className="flex items-center gap-1.5 text-xs">
                  {file.additions > 0 && (
                    <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                  )}
                  {file.deletions > 0 && (
                    <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                  )}
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>
            )
          })}
          {allFiles.length > 10 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              +{allFiles.length - 10} more files
            </div>
          )}
        </Card>
      </div>

      {/* Diff Modal */}
      <Dialog open={isDiffModalOpen} onOpenChange={handleCloseModal}>
        <DialogContent className="flex h-[80vh] max-w-[85vw] flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8 font-mono text-sm">
              {selectedFile && (
                <>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', getFileStatusBadge(selectedFile.status).color)}>
                    {selectedFile.status}
                  </span>
                  <span className="flex-1 truncate">{selectedFile.path}</span>
                  <div className="flex items-center gap-2 text-xs font-normal">
                    {selectedFile.additions > 0 && (
                      <span className="text-green-600">+{selectedFile.additions}</span>
                    )}
                    {selectedFile.deletions > 0 && (
                      <span className="text-red-600">-{selectedFile.deletions}</span>
                    )}
                  </div>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {isLoadingDiff ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : diffContent && selectedFile ? (
              <DiffViewer
                oldContent={diffContent.oldContent}
                newContent={diffContent.newContent}
                filePath={selectedFile.path}
                maxLines={10000}
                sideBySide={true}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Execution Actions - Stop and Follow Up buttons
 */
interface ExecutionActionsProps {
  execution: Execution
  onExecutionUpdate: () => void
}

function ExecutionActions({ execution, onExecutionUpdate }: ExecutionActionsProps) {
  const [isStopDialogOpen, setIsStopDialogOpen] = useState(false)
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  // Determine button visibility based on execution status
  const canStop = ['running', 'pending', 'paused', 'preparing'].includes(execution.status)
  const canFollowUp = ['completed', 'stopped', 'failed'].includes(execution.status)

  // If no actions available, don't render
  if (!canStop && !canFollowUp) {
    return null
  }

  const handleStopExecution = async () => {
    setIsStopping(true)
    try {
      await executionsApi.cancel(execution.id)
      toast.success('Execution stopped')
      onExecutionUpdate()
    } catch (err) {
      console.error('[ExecutionActions] Failed to stop execution:', err)
      toast.error('Failed to stop execution')
    } finally {
      setIsStopping(false)
      setIsStopDialogOpen(false)
    }
  }

  const handleFollowUp = async (feedback: string) => {
    await executionsApi.createFollowUp(execution.id, { feedback })
    toast.success('Follow-up execution started')
    setIsFollowUpDialogOpen(false)
    onExecutionUpdate()
  }

  return (
    <>
      <div className="flex flex-col gap-2" data-testid="execution-actions">
        <h3 className="text-sm font-semibold text-muted-foreground">Actions</h3>
        <div className="flex gap-2">
          {canStop && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setIsStopDialogOpen(true)}
              disabled={isStopping}
              className="flex-1 gap-2"
              data-testid="stop-execution-button"
            >
              {isStopping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Stop
            </Button>
          )}
          {canFollowUp && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFollowUpDialogOpen(true)}
              className="flex-1 gap-2"
              data-testid="follow-up-button"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Follow Up
            </Button>
          )}
        </div>
      </div>

      {/* Stop Confirmation Dialog */}
      <AlertDialog open={isStopDialogOpen} onOpenChange={setIsStopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Execution?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to stop this execution? The agent will be interrupted and may leave work incomplete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isStopping}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStopExecution}
              disabled={isStopping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isStopping ? 'Stopping...' : 'Stop Execution'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Follow Up Dialog */}
      <FollowUpDialog
        open={isFollowUpDialogOpen}
        onSubmit={handleFollowUp}
        onCancel={() => setIsFollowUpDialogOpen(false)}
      />
    </>
  )
}

/**
 * AgentDetailSidebar component - Slide-out panel with full agent execution details
 */
export function AgentDetailSidebar({ executionId, isOpen, onClose, onFileHover, onFileLeave }: AgentDetailSidebarProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { paths } = useProjectRoutes()

  // Fetch execution details
  const {
    data: execution,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsApi.getById(executionId),
    enabled: isOpen && !!executionId,
    staleTime: 10000, // 10 seconds
  })

  // Refetch execution data (called after actions like stop/follow-up)
  const handleExecutionUpdate = () => {
    queryClient.invalidateQueries({ queryKey: ['execution', executionId] })
    queryClient.invalidateQueries({ queryKey: ['executions'] })
  }

  // Fetch linked issue
  const { data: issue, isLoading: issueLoading } = useQuery({
    queryKey: ['issue', execution?.issue_id],
    queryFn: () => issuesApi.getById(execution!.issue_id!),
    enabled: isOpen && !!execution?.issue_id,
    staleTime: 30000, // 30 seconds
  })

  // Fetch relationships to find implementing spec
  const { data: relationships } = useQuery({
    queryKey: ['relationships', 'issue', execution?.issue_id],
    queryFn: async () => {
      const result = await relationshipsApi.getForEntity(execution!.issue_id!, 'issue')
      // Handle both array and object response formats
      const outgoing = Array.isArray(result) ? result : result.outgoing || []
      return outgoing
    },
    enabled: isOpen && !!execution?.issue_id,
    staleTime: 30000,
  })

  // Find the first "implements" relationship to a spec
  const implementsSpecId = relationships?.find(
    (rel) => rel.relationship_type === 'implements' && rel.to_type === 'spec'
  )?.to_id

  // Fetch the implementing spec
  const { data: spec, isLoading: specLoading } = useQuery({
    queryKey: ['spec', implementsSpecId],
    queryFn: () => specsApi.getById(implementsSpecId!),
    enabled: isOpen && !!implementsSpecId,
    staleTime: 30000,
  })

  const agentColor = getAgentColor(executionId)
  const statusConfig = execution
    ? STATUS_CONFIG[execution.status] || STATUS_CONFIG.pending
    : STATUS_CONFIG.pending

  // Format start time
  const startedAgo = execution?.started_at
    ? formatDistanceToNow(new Date(execution.started_at), { addSuffix: true })
    : null

  // Navigation handlers
  const handleIssueClick = () => {
    if (issue) {
      navigate(paths.issue(issue.id))
    }
  }

  const handleSpecClick = () => {
    if (spec) {
      navigate(paths.spec(spec.id))
    }
  }

  return (
    <div
      className={cn(
        // Base styles
        'fixed right-0 top-0 z-50 flex h-full w-[350px] flex-col border-l bg-background shadow-xl transition-transform duration-300',
        // Open/closed state
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
      data-testid="agent-detail-sidebar"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="gap-2"
          data-testid="sidebar-back-button"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          data-testid="sidebar-close-button"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-destructive">Failed to load execution</p>
          </div>
        ) : execution ? (
          <div className="flex flex-col gap-4">
            {/* Agent Info Card */}
            <Card className="p-4" style={{ borderLeftColor: agentColor, borderLeftWidth: '4px' }}>
              <div className="flex flex-col gap-3">
                {/* Agent Type */}
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5" style={{ color: agentColor }} />
                  <span className="text-lg font-semibold">
                    {formatAgentType(execution.agent_type)}
                  </span>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2">
                  <div className={cn('h-2.5 w-2.5 rounded-full', statusConfig.dotClassName)} />
                  <span className={cn('text-sm font-medium', statusConfig.className)}>
                    {statusConfig.label}
                  </span>
                </div>

                {/* Started Time */}
                {startedAgo && (
                  <div className="text-sm text-muted-foreground">Started {startedAgo}</div>
                )}

                {/* Prompt Preview */}
                {execution.prompt && (
                  <div className="border-t pt-3">
                    <p className="text-xs text-muted-foreground">Prompt:</p>
                    <p className="mt-1 line-clamp-3 text-sm">{execution.prompt}</p>
                  </div>
                )}
              </div>
            </Card>

            {/* Issue Card */}
            {execution.issue_id && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Issue</h3>
                {issueLoading ? (
                  <Card className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </Card>
                ) : issue ? (
                  <LinkedIssueCard issue={issue} onClick={handleIssueClick} />
                ) : (
                  <Card className="p-3">
                    <p className="text-sm text-muted-foreground">Issue not found</p>
                  </Card>
                )}
              </div>
            )}

            {/* Spec Card */}
            {implementsSpecId && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Implements Spec</h3>
                {specLoading ? (
                  <Card className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </Card>
                ) : spec ? (
                  <LinkedSpecCard spec={spec} onClick={handleSpecClick} />
                ) : (
                  <Card className="p-3">
                    <p className="text-sm text-muted-foreground">Spec not found</p>
                  </Card>
                )}
              </div>
            )}

            {/* Changed Files List */}
            <ChangedFilesList
              executionId={executionId}
              isOpen={isOpen}
              onFileHover={onFileHover}
              onFileLeave={onFileLeave}
            />

            {/* Execution Actions */}
            <ExecutionActions execution={execution} onExecutionUpdate={handleExecutionUpdate} />
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">No execution selected</p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Backdrop overlay for sidebar (optional, can be used to close on outside click)
 */
export interface SidebarBackdropProps {
  isOpen: boolean
  onClick: () => void
}

export function SidebarBackdrop({ isOpen, onClick }: SidebarBackdropProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-40 bg-black/20 transition-opacity"
      onClick={onClick}
      data-testid="sidebar-backdrop"
    />
  )
}
