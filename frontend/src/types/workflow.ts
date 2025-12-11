/**
 * Workflow types for frontend
 * Re-exports from @sudocode-ai/types with frontend-specific extensions
 */

import type {
  Workflow,
  WorkflowStep,
  WorkflowStatus,
  WorkflowStepStatus,
  WorkflowSource,
  WorkflowSourceSpec,
  WorkflowSourceIssues,
  WorkflowSourceRootIssue,
  WorkflowSourceGoal,
  WorkflowConfig,
  WorkflowEngineType,
  WorkflowParallelism,
  WorkflowFailureStrategy,
  WorkflowAutonomyLevel,
  WorkflowEvent,
  WorkflowEventType,
  CreateWorkflowOptions,
  DependencyGraph,
  EscalationData,
  EscalationResponse,
} from '@sudocode-ai/types/workflows'
import type { Issue } from './api'

/**
 * Re-export all workflow types from @sudocode-ai/types
 */
export type {
  Workflow,
  WorkflowStep,
  WorkflowStatus,
  WorkflowStepStatus,
  WorkflowSource,
  WorkflowSourceSpec,
  WorkflowSourceIssues,
  WorkflowSourceRootIssue,
  WorkflowSourceGoal,
  WorkflowConfig,
  WorkflowEngineType,
  WorkflowParallelism,
  WorkflowFailureStrategy,
  WorkflowAutonomyLevel,
  WorkflowEvent,
  WorkflowEventType,
  CreateWorkflowOptions,
  DependencyGraph,
  EscalationData,
  EscalationResponse,
}

// =============================================================================
// Escalation API Types
// =============================================================================

/**
 * Response from GET /api/workflows/:id/escalation
 */
export interface PendingEscalationResponse {
  hasPendingEscalation: boolean
  escalation?: EscalationData
}

/**
 * Request body for POST /api/workflows/:id/escalation/respond
 * Note: EscalationResponse from @sudocode-ai/types includes respondedAt which is set server-side
 */
export interface EscalationResponseRequest {
  action: 'approve' | 'reject' | 'custom'
  message?: string
}

// =============================================================================
// Frontend-Specific Extensions
// =============================================================================

/**
 * Workflow with enriched issue data for each step
 * Used when displaying workflow details with full issue information
 */
export interface WorkflowWithIssues extends Workflow {
  /** Map of issue ID to Issue object for quick lookup */
  stepIssues: Record<string, Issue>
}

/**
 * React Flow node type for workflow DAG visualization
 */
export interface WorkflowNode {
  id: string
  type: 'workflowStep'
  position: { x: number; y: number }
  data: WorkflowStepNodeData
}

/**
 * Data passed to WorkflowStepNode component
 */
export interface WorkflowStepNodeData {
  step: WorkflowStep
  issue?: Issue
  isSelected?: boolean
}

/**
 * React Flow edge type for workflow DAG visualization
 */
export interface WorkflowEdge {
  id: string
  source: string
  target: string
  type?: 'default' | 'smoothstep' | 'step' | 'straight'
  animated?: boolean
  style?: React.CSSProperties
  markerEnd?: {
    type: 'arrow' | 'arrowclosed'
    color?: string
  }
}

// =============================================================================
// Status Display Helpers
// =============================================================================

/**
 * Status color mapping for workflow status badges
 */
export const WORKFLOW_STATUS_COLORS: Record<WorkflowStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500 text-white',
  paused: 'bg-yellow-500 text-white',
  completed: 'bg-green-500 text-white',
  failed: 'bg-destructive text-destructive-foreground',
  cancelled: 'bg-muted text-muted-foreground',
}

/**
 * Status color mapping for workflow step nodes
 */
export const STEP_STATUS_STYLES: Record<
  WorkflowStepStatus,
  {
    border: string
    background: string
    text: string
  }
> = {
  pending: {
    border: 'border-muted',
    background: 'bg-muted/20',
    text: 'text-muted-foreground',
  },
  ready: {
    border: 'border-blue-500',
    background: 'bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
  },
  running: {
    border: 'border-blue-500',
    background: 'bg-blue-500/20',
    text: 'text-blue-700 dark:text-blue-300',
  },
  completed: {
    border: 'border-green-500',
    background: 'bg-green-500/10',
    text: 'text-green-700 dark:text-green-300',
  },
  failed: {
    border: 'border-destructive',
    background: 'bg-destructive/10',
    text: 'text-destructive',
  },
  skipped: {
    border: 'border-muted',
    background: 'bg-muted/10',
    text: 'text-muted-foreground line-through',
  },
  blocked: {
    border: 'border-yellow-500',
    background: 'bg-yellow-500/10',
    text: 'text-yellow-700 dark:text-yellow-300',
  },
}

/**
 * Human-readable labels for workflow status
 */
export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/**
 * Human-readable labels for step status
 */
export const STEP_STATUS_LABELS: Record<WorkflowStepStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
  blocked: 'Blocked',
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default workflow configuration for the frontend
 */
export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  engineType: 'sequential',
  parallelism: 'sequential',
  onFailure: 'pause',
  autoCommitAfterStep: true,
  defaultAgentType: 'claude-code',
  autonomyLevel: 'human_in_the_loop',
}
