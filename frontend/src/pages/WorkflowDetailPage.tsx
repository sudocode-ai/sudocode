/**
 * WorkflowDetailPage - Detail view for a single workflow
 * Shows DAG visualization and step details panel
 * Placeholder implementation - will be expanded in i-934m
 */

import { useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowDAG, WorkflowStepPanel, WorkflowControls } from '@/components/workflows'
import {
  useWorkflow,
  useWorkflowMutations,
  useWorkflowStepActions,
  useWorkflowProgress,
} from '@/hooks/useWorkflows'
import { WORKFLOW_STATUS_COLORS, WORKFLOW_STATUS_LABELS } from '@/types/workflow'
import { cn } from '@/lib/utils'

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { workflow, issues, isLoading, error } = useWorkflow(id)
  const { pause, resume, cancel } = useWorkflowMutations()
  const { retry, skip, cancel: cancelStep } = useWorkflowStepActions()
  const progress = useWorkflowProgress(workflow)

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  // Get selected step
  const selectedStep = selectedStepId
    ? workflow?.steps.find((s) => s.id === selectedStepId)
    : null

  // Handlers
  const handleStepSelect = useCallback((stepId: string) => {
    setSelectedStepId(stepId)
  }, [])

  const handlePanelClose = useCallback(() => {
    setSelectedStepId(null)
  }, [])

  const handleRetry = useCallback(async () => {
    if (workflow && selectedStepId) {
      await retry(workflow.id, selectedStepId)
    }
  }, [workflow, selectedStepId, retry])

  const handleSkip = useCallback(async () => {
    if (workflow && selectedStepId) {
      await skip(workflow.id, selectedStepId)
    }
  }, [workflow, selectedStepId, skip])

  const handleCancelStep = useCallback(async () => {
    if (workflow && selectedStepId) {
      await cancelStep(workflow.id, selectedStepId)
    }
  }, [workflow, selectedStepId, cancelStep])

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
          onPause={() => pause(workflow.id)}
          onResume={() => resume(workflow.id)}
          onCancel={() => cancel(workflow.id)}
        />
      </div>

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

        {/* Step Detail Panel */}
        {selectedStep && (
          <div className="w-[380px] border-l">
            <WorkflowStepPanel
              step={selectedStep}
              issue={issues?.[selectedStep.issueId]}
              allSteps={workflow.steps}
              onClose={handlePanelClose}
              onRetry={handleRetry}
              onSkip={handleSkip}
              onCancel={handleCancelStep}
              onDependencyClick={handleStepSelect}
              onViewExecution={
                selectedStep.executionId
                  ? () => navigate(`/executions/${selectedStep.executionId}`)
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
