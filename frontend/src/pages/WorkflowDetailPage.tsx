/**
 * WorkflowDetailPage - Detail view for a single workflow
 * Shows DAG visualization, step details panel, and orchestrator view
 */

import { useState, useCallback, useEffect } from 'react'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  WorkflowDAG,
  WorkflowControls,
  EscalationBanner,
  EscalationPanel,
  OrchestratorGuidancePanel,
} from '@/components/workflows'
import { InlineExecutionView } from '@/components/executions/InlineExecutionView'
import { IssuePanel } from '@/components/issues/IssuePanel'
import { useIssues } from '@/hooks/useIssues'
import {
  useWorkflow,
  useWorkflowMutations,
  useWorkflowProgress,
  useWorkflowEscalation,
} from '@/hooks/useWorkflows'
import { WORKFLOW_STATUS_COLORS, WORKFLOW_STATUS_LABELS } from '@/types/workflow'
import { cn } from '@/lib/utils'

type DetailTab = 'steps' | 'orchestrator'

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { workflow, issues, isLoading, error } = useWorkflow(id)
  const { start, pause, resume, cancel, isStarting } = useWorkflowMutations()
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
  const selectedStep = selectedStepId
    ? workflow?.steps.find((s) => s.id === selectedStepId)
    : null
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
        <Button variant="outline" onClick={() => navigate('/workflows')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
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
            <Link to="/workflows">
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
                  className={cn(
                    'h-3 w-3',
                    workflow.status === 'running' && 'animate-spin'
                  )}
                />
                {WORKFLOW_STATUS_LABELS[workflow.status]}
              </span>
              <span>
                {progress.completed}/{progress.total} steps
              </span>
              {progress.percentage > 0 && (
                <span>({progress.percentage}% complete)</span>
              )}
              {workflow.branchName && (
                <span className="inline-flex items-center gap-1.5" title={workflow.worktreePath || undefined}>
                  <GitBranch className="h-3.5 w-3.5" />
                  <span className="font-mono text-xs">{workflow.branchName}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <WorkflowControls
          workflow={workflow}
          onStart={() => start(workflow.id)}
          onPause={() => pause(workflow.id)}
          onResume={() => resume(workflow.id)}
          onCancel={() => cancel(workflow.id)}
          isStarting={isStarting}
        />
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
            <div className="h-full relative">
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
                  className="absolute top-4 right-4 gap-2"
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
                            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                            activeTab === 'steps'
                              ? 'bg-background border-b-2 border-primary text-foreground'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          )}
                        >
                          <ListTree className="h-4 w-4" />
                          Steps
                        </button>
                        <button
                          onClick={() => setActiveTab('orchestrator')}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative',
                            activeTab === 'orchestrator'
                              ? 'bg-background border-b-2 border-primary text-foreground'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          )}
                        >
                          <Bot className="h-4 w-4" />
                          Orchestrator
                          {/* Escalation indicator */}
                          {hasPendingEscalation && activeTab !== 'orchestrator' && (
                            <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                          )}
                        </button>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center gap-2 px-4 py-2.5 text-sm font-medium">
                        <ListTree className="h-4 w-4" />
                        Step Details
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 mr-2"
                      onClick={handleTogglePanel}
                      title="Collapse panel"
                    >
                      <PanelRightClose className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Tab Content */}
                  <div className="flex-1 overflow-hidden flex flex-col">
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
                        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                          Select a step to view issue details
                        </div>
                      )
                    ) : (
                      // Orchestrator View - uses InlineExecutionView like other executions
                      <>
                        <div className="flex-1 overflow-auto">
                          {/* Escalation Panel at top when pending */}
                          {hasPendingEscalation && escalation && (
                            <div className="p-4 border-b">
                              <EscalationPanel
                                escalation={escalation}
                                onRespond={respondToEscalation}
                                isResponding={isResponding}
                              />
                            </div>
                          )}
                          {/* Execution View - uses ClaudeCodeTrajectory for claude-code agents */}
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
    </div>
  )
}
