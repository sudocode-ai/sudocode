/**
 * WorkflowDetailPage - Detail view for a single workflow
 * Shows DAG visualization, step details panel, and orchestrator view
 */

import { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ListTree,
  Bot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  WorkflowDAG,
  WorkflowStepPanel,
  WorkflowControls,
  EscalationBanner,
  OrchestratorTrajectory,
  OrchestratorGuidancePanel,
} from '@/components/workflows'
import {
  useWorkflow,
  useWorkflowMutations,
  useWorkflowStepActions,
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
  const stepActions = useWorkflowStepActions(id || '')
  const progress = useWorkflowProgress(workflow)

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('steps')

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

  // Get selected step
  const selectedStep = selectedStepId
    ? workflow?.steps.find((s) => s.id === selectedStepId)
    : null

  // Determine if we should show orchestrator tab
  const hasOrchestrator = !!workflow?.orchestratorExecutionId

  // Handlers
  const handleStepSelect = useCallback((stepId: string) => {
    setSelectedStepId(stepId)
  }, [])

  const handlePanelClose = useCallback(() => {
    setSelectedStepId(null)
  }, [])

  const handleRetry = useCallback(async () => {
    if (selectedStepId) {
      await stepActions.retry(selectedStepId)
    }
  }, [selectedStepId, stepActions])

  const handleSkip = useCallback(async () => {
    if (selectedStepId) {
      await stepActions.skip(selectedStepId)
    }
  }, [selectedStepId, stepActions])

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
      <div className="flex flex-1 overflow-hidden">
        {/* DAG Visualization */}
        <div className="flex-1 min-w-0">
          <WorkflowDAG
            steps={workflow.steps}
            issues={issues}
            selectedStepId={selectedStepId || undefined}
            onStepSelect={handleStepSelect}
          />
        </div>

        {/* Right Panel - Steps or Orchestrator */}
        {(selectedStep || hasOrchestrator) && (
          <div className="w-[420px] border-l flex flex-col">
            {/* Tab Switcher (only show when orchestrator is available) */}
            {hasOrchestrator && (
              <div className="flex border-b bg-muted/30">
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
              </div>
            )}

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {activeTab === 'steps' ? (
                // Steps View
                selectedStep ? (
                  <WorkflowStepPanel
                    step={selectedStep}
                    issue={issues?.[selectedStep.issueId]}
                    allSteps={workflow.steps}
                    onClose={handlePanelClose}
                    onRetry={handleRetry}
                    onSkip={handleSkip}
                    onDependencyClick={handleStepSelect}
                    onViewExecution={
                      selectedStep.executionId
                        ? () => navigate(`/executions/${selectedStep.executionId}`)
                        : undefined
                    }
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                    Select a step to view details
                  </div>
                )
              ) : (
                // Orchestrator View
                <>
                  <div className="flex-1 overflow-hidden">
                    <OrchestratorTrajectory
                      executionId={workflow.orchestratorExecutionId!}
                      workflowId={workflow.id}
                      escalation={escalation}
                      onEscalationResponse={respondToEscalation}
                      isRespondingToEscalation={isResponding}
                    />
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
        )}
      </div>
    </div>
  )
}
