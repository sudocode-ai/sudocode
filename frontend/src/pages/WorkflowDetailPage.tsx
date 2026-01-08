/**
 * WorkflowDetailPage - Detail view for a single workflow
 * Shows DAG visualization, step details panel, and orchestrator view
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import {
  ArrowLeft,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ListTree,
  Bot,
  GitBranch,
  PanelRightClose,
  PanelRight,
  GitMerge,
  ExternalLink,
} from 'lucide-react'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  WorkflowDAG,
  WorkflowControls,
  EscalationBanner,
  EscalationPanel,
  OrchestratorGuidancePanel,
  ResumeWorkflowDialog,
} from '@/components/workflows'
import { InlineExecutionView } from '@/components/executions/InlineExecutionView'
import { SyncPreviewDialog } from '@/components/executions/SyncPreviewDialog'
import { IssuePanel } from '@/components/issues/IssuePanel'
import { useIssues } from '@/hooks/useIssues'
import {
  useWorkflow,
  useWorkflowMutations,
  useWorkflowProgress,
  useWorkflowEscalation,
} from '@/hooks/useWorkflows'
import { useExecutionChanges } from '@/hooks/useExecutionChanges'
import { useExecutionSync } from '@/hooks/useExecutionSync'
import { executionsApi } from '@/lib/api'
import { WORKFLOW_STATUS_COLORS, WORKFLOW_STATUS_LABELS } from '@/types/workflow'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type DetailTab = 'steps' | 'orchestrator'

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()
  const { workflow, issues, isLoading, error } = useWorkflow(id)
  const { start, pause, resume, cancel, isStarting, isResuming } = useWorkflowMutations()
  const [showResumeDialog, setShowResumeDialog] = useState(false)
  const progress = useWorkflowProgress(workflow)

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('steps')
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('workflowDetailPage.panelCollapsed')
      return saved === 'true'
    } catch {
      return false
    }
  })

  // Escalation handling
  const {
    escalation,
    hasPendingEscalation,
    respond: respondToEscalation,
    isResponding,
  } = useWorkflowEscalation(id)

  // Find an execution ID to use for fetching changes
  // Use the first step's execution, or the orchestrator execution as fallback
  const executionIdForChanges = useMemo(() => {
    if (!workflow) return null
    // Find first step with an execution ID
    const stepWithExecution = workflow.steps.find((s) => s.executionId)
    if (stepWithExecution?.executionId) return stepWithExecution.executionId
    // Fall back to orchestrator execution
    return workflow.orchestratorExecutionId ?? null
  }, [workflow])

  // Worktree state tracking
  const [worktreeExists, setWorktreeExists] = useState(false)
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState<boolean | undefined>(undefined)
  const [commitsAhead, setCommitsAhead] = useState<number | undefined>(undefined)

  // Fetch execution changes using the first available execution
  const { data: changesData, refresh: refreshChanges } = useExecutionChanges(executionIdForChanges)

  // Execution sync for merge operations
  const {
    fetchSyncPreview,
    syncPreview,
    isSyncPreviewOpen,
    setIsSyncPreviewOpen,
    performSync,
    isPreviewing,
  } = useExecutionSync()

  // Check worktree status when workflow loads
  useEffect(() => {
    if (!executionIdForChanges || !workflow?.worktreePath) {
      setWorktreeExists(false)
      setHasUncommittedChanges(false)
      setCommitsAhead(undefined)
      return
    }

    const checkWorktreeStatus = async () => {
      try {
        const status = await executionsApi.worktreeExists(executionIdForChanges)
        setWorktreeExists(status.exists)

        if (status.exists) {
          const changes = await executionsApi.getChanges(executionIdForChanges)
          const uncommittedFiles =
            (changes.uncommittedSnapshot?.files?.length ?? 0) +
            (changes.captured?.uncommitted ? (changes.captured?.files?.length ?? 0) : 0)
          setHasUncommittedChanges(changes.available && uncommittedFiles > 0)
          setCommitsAhead(changes.commitsAhead)
        } else {
          setHasUncommittedChanges(false)
          setCommitsAhead(undefined)
        }
      } catch (err) {
        console.error('Failed to check worktree status:', err)
        setWorktreeExists(false)
        setHasUncommittedChanges(false)
        setCommitsAhead(undefined)
      }
    }

    checkWorktreeStatus()
  }, [executionIdForChanges, workflow?.worktreePath])

  // Compute change statistics from execution changes
  const changeStats = useMemo(() => {
    if (!changesData?.available) return null

    // Check multiple possible data sources (captured, current, changes/legacy)
    const captured = changesData.captured
    const current = changesData.current
    const legacy = changesData.changes
    const uncommitted = changesData.uncommittedSnapshot

    // Use current if available, otherwise captured, otherwise legacy
    const committedSource = current ?? captured ?? legacy

    // Combine committed and uncommitted files
    const committedFiles = committedSource?.files ?? []
    const uncommittedFiles = uncommitted?.files ?? []

    // Calculate totals
    const totalFiles = committedFiles.length + uncommittedFiles.length
    const totalAdditions =
      (committedSource?.summary?.totalAdditions ?? 0) + (uncommitted?.summary?.totalAdditions ?? 0)
    const totalDeletions =
      (committedSource?.summary?.totalDeletions ?? 0) + (uncommitted?.summary?.totalDeletions ?? 0)

    if (totalFiles === 0) return null

    return {
      totalFiles,
      totalAdditions,
      totalDeletions,
      hasCommittedChanges: committedFiles.length > 0,
      hasUncommittedChanges: uncommittedFiles.length > 0,
      commitsAhead: changesData.commitsAhead,
    }
  }, [changesData])

  // Determine if merge button should be shown
  const showMergeButton = useMemo(() => {
    if (!workflow?.worktreePath || !worktreeExists) return false
    // Show if there are commits ahead or uncommitted changes
    return (commitsAhead !== undefined && commitsAhead > 0) || hasUncommittedChanges === true
  }, [workflow?.worktreePath, worktreeExists, commitsAhead, hasUncommittedChanges])

  // Handle merge button click
  const handleMergeClick = useCallback(() => {
    if (!executionIdForChanges) return
    fetchSyncPreview(executionIdForChanges)
  }, [executionIdForChanges, fetchSyncPreview])

  // Handle open in IDE
  const handleOpenInIDE = useCallback(async () => {
    if (!workflow?.worktreePath) {
      toast.error('No worktree path available')
      return
    }
    try {
      await executionsApi.openInIde(workflow.worktreePath)
      toast.success('Opening worktree in IDE...')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open IDE'
      toast.error(message)
    }
  }, [workflow?.worktreePath])

  // Handle sync complete - refresh data
  const handleSyncComplete = useCallback(async () => {
    refreshChanges()
    if (executionIdForChanges) {
      try {
        const status = await executionsApi.worktreeExists(executionIdForChanges)
        setWorktreeExists(status.exists)
        if (status.exists) {
          const changes = await executionsApi.getChanges(executionIdForChanges)
          const uncommittedFiles =
            (changes.uncommittedSnapshot?.files?.length ?? 0) +
            (changes.captured?.uncommitted ? (changes.captured?.files?.length ?? 0) : 0)
          setHasUncommittedChanges(changes.available && uncommittedFiles > 0)
          setCommitsAhead(changes.commitsAhead)
        }
      } catch (err) {
        console.error('Failed to refresh worktree status:', err)
      }
    }
  }, [refreshChanges, executionIdForChanges])

  // Auto-switch to orchestrator tab when escalation is pending
  useEffect(() => {
    if (hasPendingEscalation && workflow?.orchestratorExecutionId) {
      setActiveTab('orchestrator')
    }
  }, [hasPendingEscalation, workflow?.orchestratorExecutionId])

  // Handle Escape key to stop orchestrator when running
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && workflow?.status === 'running') {
        e.preventDefault()
        cancel(workflow.id)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [workflow?.id, workflow?.status, cancel])

  // Get selected step and its issue
  const selectedStep = selectedStepId ? workflow?.steps.find((s) => s.id === selectedStepId) : null
  const selectedIssue = selectedStep && issues ? issues[selectedStep.issueId] : null

  // Issue mutations for IssuePanel
  const { updateIssue } = useIssues()

  // Determine if we should show orchestrator tab
  const hasOrchestrator = !!workflow?.orchestratorExecutionId

  // Handlers
  const handleStepSelect = useCallback((stepId: string) => {
    setSelectedStepId(stepId)
  }, [])

  const handlePanelClose = useCallback(() => {
    setSelectedStepId(null)
  }, [])

  const handleTogglePanel = useCallback(() => {
    setIsPanelCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('workflowDetailPage.panelCollapsed', String(next))
      } catch {
        // Ignore errors
      }
      return next
    })
  }, [])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Error state
  if (error || !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-lg font-medium">Workflow not found</h2>
        <p className="text-muted-foreground">
          The workflow you're looking for doesn't exist or has been deleted.
        </p>
        <Button variant="outline" onClick={() => navigate(paths.workflows())}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Workflows
        </Button>
      </div>
    )
  }

  // Status icon
  const StatusIcon =
    workflow.status === 'running'
      ? Loader2
      : workflow.status === 'completed'
        ? CheckCircle2
        : workflow.status === 'failed'
          ? XCircle
          : Clock

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to={paths.workflows()}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{workflow.title}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                  WORKFLOW_STATUS_COLORS[workflow.status]
                )}
              >
                <StatusIcon
                  className={cn('h-3 w-3', workflow.status === 'running' && 'animate-spin')}
                />
                {WORKFLOW_STATUS_LABELS[workflow.status]}
              </span>
              <span>
                {progress.completed}/{progress.total} steps
              </span>
              {progress.percentage > 0 && <span>({progress.percentage}% complete)</span>}
              {workflow.branchName && (
                <span
                  className="inline-flex items-center gap-1.5"
                  title={workflow.worktreePath || undefined}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  <span className="font-mono text-xs">{workflow.branchName}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Worktree State & Merge Controls */}
        <div className="flex items-center gap-3">
          <TooltipProvider>
            {/* Change Stats - clickable to open merge dialog */}
            {changeStats && showMergeButton && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleMergeClick}
                    className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 transition-colors hover:border-primary/50 hover:bg-muted/50"
                  >
                    <GitMerge className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{changeStats.totalFiles} files</span>
                    <span className="text-xs text-green-600 dark:text-green-400">
                      +{changeStats.totalAdditions}
                    </span>
                    <span className="text-xs text-red-600 dark:text-red-400">
                      -{changeStats.totalDeletions}
                    </span>
                    {changeStats.hasUncommittedChanges && (
                      <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                        uncommitted
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Merge changes</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Open in IDE Button */}
            {workflow.worktreePath && worktreeExists && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleOpenInIDE} className="gap-1.5">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Open worktree in IDE</p>
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>

          {/* Controls */}
          <WorkflowControls
            workflow={workflow}
            onStart={() => start(workflow.id)}
            onPause={() => pause(workflow.id)}
            onResume={() => setShowResumeDialog(true)}
            onCancel={() => cancel(workflow.id)}
            isStarting={isStarting}
            isResuming={isResuming}
          />
        </div>
      </div>

      {/* Escalation Banner */}
      {hasPendingEscalation && escalation && (
        <EscalationBanner
          workflowId={workflow.id}
          workflowTitle={workflow.title}
          message={escalation.message}
          onRespond={() => setActiveTab('orchestrator')}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup
          direction="horizontal"
          onLayout={(layout) => {
            if (layout.length === 2) {
              try {
                localStorage.setItem('workflowDetailPage.panelSizes', JSON.stringify(layout))
              } catch {
                // Ignore errors
              }
            }
          }}
        >
          {/* DAG Visualization Panel */}
          <Panel
            id="dag"
            order={1}
            defaultSize={(() => {
              try {
                const saved = localStorage.getItem('workflowDetailPage.panelSizes')
                if (saved) {
                  const parsed = JSON.parse(saved)
                  if (Array.isArray(parsed) && parsed.length === 2) {
                    return parsed[0]
                  }
                }
              } catch {
                // Ignore errors
              }
              return isPanelCollapsed ? 100 : 65
            })()}
            minSize={30}
          >
            <div className="relative h-full">
              <WorkflowDAG
                steps={workflow.steps}
                issues={issues}
                selectedStepId={selectedStepId || undefined}
                onStepSelect={handleStepSelect}
                onPaneClick={handlePanelClose}
              />
              {/* Toggle button when panel is collapsed */}
              {isPanelCollapsed && (selectedStep || hasOrchestrator) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute right-4 top-4 gap-2"
                  onClick={handleTogglePanel}
                >
                  <PanelRight className="h-4 w-4" />
                  Show Panel
                </Button>
              )}
            </div>
          </Panel>

          {/* Right Panel - Steps or Orchestrator (only show when not collapsed) */}
          {!isPanelCollapsed && (selectedStep || hasOrchestrator) && (
            <>
              <PanelResizeHandle className="group relative z-30 w-1 cursor-col-resize touch-none bg-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background">
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-full border border-border bg-muted/90 px-1.5 py-3 opacity-70 shadow-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                  <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                  <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                </div>
              </PanelResizeHandle>

              <Panel
                id="details"
                order={2}
                defaultSize={(() => {
                  try {
                    const saved = localStorage.getItem('workflowDetailPage.panelSizes')
                    if (saved) {
                      const parsed = JSON.parse(saved)
                      if (Array.isArray(parsed) && parsed.length === 2) {
                        return parsed[1]
                      }
                    }
                  } catch {
                    // Ignore errors
                  }
                  return 35
                })()}
                minSize={20}
                className="border-l bg-background"
              >
                <div className="flex h-full flex-col">
                  {/* Tab Switcher with collapse button */}
                  <div className="flex items-center border-b bg-muted/30">
                    {hasOrchestrator ? (
                      <>
                        <button
                          onClick={() => setActiveTab('steps')}
                          className={cn(
                            'flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                            activeTab === 'steps'
                              ? 'border-b-2 border-primary bg-background text-foreground'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          )}
                        >
                          <ListTree className="h-4 w-4" />
                          Steps
                        </button>
                        <button
                          onClick={() => setActiveTab('orchestrator')}
                          className={cn(
                            'relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                            activeTab === 'orchestrator'
                              ? 'border-b-2 border-primary bg-background text-foreground'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          )}
                        >
                          <Bot className="h-4 w-4" />
                          Orchestrator
                          {/* Escalation indicator */}
                          {hasPendingEscalation && activeTab !== 'orchestrator' && (
                            <span className="absolute right-2 top-1.5 h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                          )}
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-1 items-center gap-2 px-4 py-2.5 text-sm font-medium">
                        <ListTree className="h-4 w-4" />
                        Step Details
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mr-2 h-8 w-8"
                      onClick={handleTogglePanel}
                      title="Collapse panel"
                    >
                      <PanelRightClose className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Tab Content */}
                  <div className="flex flex-1 flex-col overflow-hidden">
                    {activeTab === 'steps' ? (
                      // Steps View - Show Issue Panel directly
                      selectedIssue ? (
                        <IssuePanel
                          issue={selectedIssue}
                          onClose={handlePanelClose}
                          onUpdate={(data) => updateIssue({ id: selectedIssue.id, data })}
                          hideTopControls={true}
                          showOpenDetail={true}
                        />
                      ) : (
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                          Select a step to view issue details
                        </div>
                      )
                    ) : (
                      // Orchestrator View - uses InlineExecutionView like other executions
                      <>
                        <div className="flex-1 overflow-auto">
                          {/* Escalation Panel at top when pending */}
                          {hasPendingEscalation && escalation && (
                            <div className="border-b p-4">
                              <EscalationPanel
                                escalation={escalation}
                                onRespond={respondToEscalation}
                                isResponding={isResponding}
                              />
                            </div>
                          )}
                          {/* Execution View - shows unified AgentTrajectory */}
                          <div className="p-2">
                            <InlineExecutionView
                              executionId={workflow.orchestratorExecutionId!}
                              defaultExpanded={true}
                            />
                          </div>
                        </div>
                        <OrchestratorGuidancePanel
                          workflowId={workflow.id}
                          orchestratorExecutionId={workflow.orchestratorExecutionId!}
                          isOrchestratorRunning={workflow.status === 'running'}
                        />
                      </>
                    )}
                  </div>
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* Resume Dialog */}
      <ResumeWorkflowDialog
        workflow={workflow}
        open={showResumeDialog}
        onOpenChange={setShowResumeDialog}
        onConfirm={async (message) => {
          await resume(workflow.id, message)
        }}
        isResuming={isResuming}
      />

      {/* Sync Preview Dialog */}
      {syncPreview && executionIdForChanges && (
        <SyncPreviewDialog
          preview={syncPreview}
          isOpen={isSyncPreviewOpen}
          onClose={() => setIsSyncPreviewOpen(false)}
          onConfirmSync={async (mode, options) => {
            await performSync(executionIdForChanges, mode, options)
            handleSyncComplete()
          }}
          onOpenIDE={() => {
            // IDE integration placeholder
          }}
          isPreviewing={isPreviewing}
          targetBranch={workflow.baseBranch ?? undefined}
          onRefresh={() => fetchSyncPreview(executionIdForChanges)}
        />
      )}
    </div>
  )
}
