/**
 * Workflow hooks - Placeholder implementations with mock data
 * Ready for migration to React Query when API is available
 */

import { useMemo, useCallback } from 'react'
import type { Workflow, CreateWorkflowOptions } from '@/types/workflow'
import type { Issue } from '@/types/api'
import { MOCK_WORKFLOWS, getIssuesForWorkflow } from '@/lib/mock/workflows'

// =============================================================================
// Types
// =============================================================================

interface UseWorkflowsResult {
  workflows: Workflow[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

interface UseWorkflowResult {
  workflow: Workflow | undefined
  issues: Record<string, Issue> | undefined
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

interface UseWorkflowMutationsResult {
  create: (options: CreateWorkflowOptions) => Promise<Workflow | null>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  isCreating: boolean
  isPausing: boolean
  isResuming: boolean
  isCancelling: boolean
}

interface UseWorkflowStepActionsResult {
  retry: (workflowId: string, stepId: string) => Promise<void>
  skip: (workflowId: string, stepId: string) => Promise<void>
  cancel: (workflowId: string, stepId: string) => Promise<void>
  isRetrying: boolean
  isSkipping: boolean
  isCancelling: boolean
}

// =============================================================================
// useWorkflows - List all workflows
// =============================================================================

export function useWorkflows(): UseWorkflowsResult {
  // For now, return mock data
  // TODO: Replace with React Query + API call
  const workflows = useMemo(() => MOCK_WORKFLOWS, [])

  const refetch = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflows] refetch called - no-op in mock mode')
  }, [])

  return {
    workflows,
    isLoading: false,
    error: null,
    refetch,
  }
}

// =============================================================================
// useWorkflow - Get single workflow by ID
// =============================================================================

export function useWorkflow(id: string | undefined): UseWorkflowResult {
  // Find workflow in mock data
  const workflow = useMemo(
    () => (id ? MOCK_WORKFLOWS.find((w) => w.id === id) : undefined),
    [id]
  )

  // Get issues for this workflow
  const issues = useMemo(
    () => (workflow ? getIssuesForWorkflow(workflow) : undefined),
    [workflow]
  )

  const refetch = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflow] refetch called - no-op in mock mode')
  }, [])

  return {
    workflow,
    issues,
    isLoading: false,
    error: id && !workflow ? new Error(`Workflow ${id} not found`) : null,
    refetch,
  }
}

// =============================================================================
// useWorkflowMutations - Workflow lifecycle actions
// =============================================================================

export function useWorkflowMutations(): UseWorkflowMutationsResult {
  const create = useCallback(async (options: CreateWorkflowOptions): Promise<Workflow | null> => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflowMutations] create called:', options)
    // TODO: Call API to create workflow
    // For now, just log and return null
    return null
  }, [])

  const pause = useCallback(async (id: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflowMutations] pause called:', id)
    // TODO: Call API to pause workflow
  }, [])

  const resume = useCallback(async (id: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflowMutations] resume called:', id)
    // TODO: Call API to resume workflow
  }, [])

  const cancel = useCallback(async (id: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflowMutations] cancel called:', id)
    // TODO: Call API to cancel workflow
  }, [])

  return {
    create,
    pause,
    resume,
    cancel,
    isCreating: false,
    isPausing: false,
    isResuming: false,
    isCancelling: false,
  }
}

// =============================================================================
// useWorkflowStepActions - Step-level actions
// =============================================================================

export function useWorkflowStepActions(): UseWorkflowStepActionsResult {
  const retry = useCallback(async (workflowId: string, stepId: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflowStepActions] retry called:', { workflowId, stepId })
    // TODO: Call API to retry step
  }, [])

  const skip = useCallback(async (workflowId: string, stepId: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflowStepActions] skip called:', { workflowId, stepId })
    // TODO: Call API to skip step
  }, [])

  const cancel = useCallback(async (workflowId: string, stepId: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[useWorkflowStepActions] cancel called:', { workflowId, stepId })
    // TODO: Call API to cancel step
  }, [])

  return {
    retry,
    skip,
    cancel,
    isRetrying: false,
    isSkipping: false,
    isCancelling: false,
  }
}

// =============================================================================
// useWorkflowProgress - Calculate workflow progress stats
// =============================================================================

interface WorkflowProgress {
  total: number
  completed: number
  running: number
  failed: number
  pending: number
  blocked: number
  percentage: number
}

export function useWorkflowProgress(workflow: Workflow | undefined): WorkflowProgress {
  return useMemo(() => {
    if (!workflow) {
      return {
        total: 0,
        completed: 0,
        running: 0,
        failed: 0,
        pending: 0,
        blocked: 0,
        percentage: 0,
      }
    }

    const steps = workflow.steps
    const total = steps.length
    const completed = steps.filter((s) => s.status === 'completed').length
    const running = steps.filter((s) => s.status === 'running').length
    const failed = steps.filter((s) => s.status === 'failed').length
    const pending = steps.filter((s) => s.status === 'pending' || s.status === 'ready').length
    const blocked = steps.filter((s) => s.status === 'blocked').length
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

    return {
      total,
      completed,
      running,
      failed,
      pending,
      blocked,
      percentage,
    }
  }, [workflow])
}
