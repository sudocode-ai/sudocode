/**
 * Mock workflow data for frontend development
 * Use these mocks while the backend API is not ready
 */

import type { Workflow, WorkflowStep, WorkflowSource } from '@/types/workflow'
import { DEFAULT_WORKFLOW_CONFIG } from '@/types/workflow'
import type { Issue } from '@/types/api'

// =============================================================================
// Mock Issues (for step enrichment)
// =============================================================================

export const MOCK_ISSUES: Record<string, Issue> = {
  'i-auth1': {
    id: 'i-auth1',
    uuid: 'uuid-auth1',
    title: 'Setup database schema for users',
    content: 'Create the initial database schema for user authentication including users, sessions, and tokens tables.',
    status: 'closed',
    priority: 1,
    created_at: '2025-12-01T10:00:00Z',
    updated_at: '2025-12-02T14:30:00Z',
  },
  'i-auth2': {
    id: 'i-auth2',
    uuid: 'uuid-auth2',
    title: 'Configure OAuth provider',
    content: 'Set up OAuth2 provider integration with Google and GitHub.',
    status: 'closed',
    priority: 1,
    created_at: '2025-12-01T10:00:00Z',
    updated_at: '2025-12-02T15:00:00Z',
  },
  'i-auth3': {
    id: 'i-auth3',
    uuid: 'uuid-auth3',
    title: 'Implement authentication endpoints',
    content: 'Create REST API endpoints for login, logout, register, and token refresh.',
    status: 'in_progress',
    priority: 1,
    created_at: '2025-12-01T10:00:00Z',
    updated_at: '2025-12-03T09:00:00Z',
  },
  'i-auth4': {
    id: 'i-auth4',
    uuid: 'uuid-auth4',
    title: 'Add authentication middleware',
    content: 'Create middleware for protecting routes and validating JWT tokens.',
    status: 'open',
    priority: 2,
    created_at: '2025-12-01T10:00:00Z',
    updated_at: '2025-12-01T10:00:00Z',
  },
  'i-auth5': {
    id: 'i-auth5',
    uuid: 'uuid-auth5',
    title: 'Write authentication tests',
    content: 'Comprehensive test suite for all authentication flows.',
    status: 'open',
    priority: 2,
    created_at: '2025-12-01T10:00:00Z',
    updated_at: '2025-12-01T10:00:00Z',
  },
  'i-api1': {
    id: 'i-api1',
    uuid: 'uuid-api1',
    title: 'Define API schema',
    content: 'Create OpenAPI specification for the new API version.',
    status: 'closed',
    priority: 1,
    created_at: '2025-12-01T08:00:00Z',
    updated_at: '2025-12-01T12:00:00Z',
  },
  'i-api2': {
    id: 'i-api2',
    uuid: 'uuid-api2',
    title: 'Implement CRUD endpoints',
    content: 'Create standard CRUD operations for all resources.',
    status: 'closed',
    priority: 1,
    created_at: '2025-12-01T08:00:00Z',
    updated_at: '2025-12-01T16:00:00Z',
  },
  'i-api3': {
    id: 'i-api3',
    uuid: 'uuid-api3',
    title: 'Add pagination and filtering',
    content: 'Implement cursor-based pagination and query filtering.',
    status: 'closed',
    priority: 2,
    created_at: '2025-12-01T08:00:00Z',
    updated_at: '2025-12-02T10:00:00Z',
  },
  'i-api4': {
    id: 'i-api4',
    uuid: 'uuid-api4',
    title: 'Write API documentation',
    content: 'Generate and publish API documentation from OpenAPI spec.',
    status: 'closed',
    priority: 3,
    created_at: '2025-12-01T08:00:00Z',
    updated_at: '2025-12-02T14:00:00Z',
  },
  'i-fail1': {
    id: 'i-fail1',
    uuid: 'uuid-fail1',
    title: 'Setup test infrastructure',
    content: 'Configure Jest and testing utilities.',
    status: 'closed',
    priority: 1,
    created_at: '2025-12-02T10:00:00Z',
    updated_at: '2025-12-02T11:00:00Z',
  },
  'i-fail2': {
    id: 'i-fail2',
    uuid: 'uuid-fail2',
    title: 'Write unit tests for core module',
    content: 'Test all core module functions with edge cases.',
    status: 'blocked',
    priority: 1,
    created_at: '2025-12-02T10:00:00Z',
    updated_at: '2025-12-02T12:00:00Z',
  },
  'i-fail3': {
    id: 'i-fail3',
    uuid: 'uuid-fail3',
    title: 'Write integration tests',
    content: 'End-to-end tests for API endpoints.',
    status: 'open',
    priority: 2,
    created_at: '2025-12-02T10:00:00Z',
    updated_at: '2025-12-02T10:00:00Z',
  },
}

// =============================================================================
// Mock Workflow Steps
// =============================================================================

const authWorkflowSteps: WorkflowStep[] = [
  {
    id: 'step-1',
    issueId: 'i-auth1',
    index: 0,
    dependencies: [],
    status: 'completed',
    executionId: 'exec-auth1',
    commitSha: 'abc1234',
    agentType: 'claude-code',
  },
  {
    id: 'step-2',
    issueId: 'i-auth2',
    index: 1,
    dependencies: [],
    status: 'completed',
    executionId: 'exec-auth2',
    commitSha: 'def5678',
    agentType: 'claude-code',
  },
  {
    id: 'step-3',
    issueId: 'i-auth3',
    index: 2,
    dependencies: ['step-1', 'step-2'],
    status: 'running',
    executionId: 'exec-auth3',
    agentType: 'claude-code',
  },
  {
    id: 'step-4',
    issueId: 'i-auth4',
    index: 3,
    dependencies: ['step-3'],
    status: 'pending',
    agentType: 'claude-code',
  },
  {
    id: 'step-5',
    issueId: 'i-auth5',
    index: 4,
    dependencies: ['step-3', 'step-4'],
    status: 'pending',
    agentType: 'claude-code',
  },
]

const apiWorkflowSteps: WorkflowStep[] = [
  {
    id: 'step-1',
    issueId: 'i-api1',
    index: 0,
    dependencies: [],
    status: 'completed',
    executionId: 'exec-api1',
    commitSha: '111aaa',
    agentType: 'claude-code',
  },
  {
    id: 'step-2',
    issueId: 'i-api2',
    index: 1,
    dependencies: ['step-1'],
    status: 'completed',
    executionId: 'exec-api2',
    commitSha: '222bbb',
    agentType: 'claude-code',
  },
  {
    id: 'step-3',
    issueId: 'i-api3',
    index: 2,
    dependencies: ['step-2'],
    status: 'completed',
    executionId: 'exec-api3',
    commitSha: '333ccc',
    agentType: 'claude-code',
  },
  {
    id: 'step-4',
    issueId: 'i-api4',
    index: 3,
    dependencies: ['step-2'],
    status: 'completed',
    executionId: 'exec-api4',
    commitSha: '444ddd',
    agentType: 'claude-code',
  },
]

const failedWorkflowSteps: WorkflowStep[] = [
  {
    id: 'step-1',
    issueId: 'i-fail1',
    index: 0,
    dependencies: [],
    status: 'completed',
    executionId: 'exec-fail1',
    commitSha: 'fff111',
    agentType: 'claude-code',
  },
  {
    id: 'step-2',
    issueId: 'i-fail2',
    index: 1,
    dependencies: ['step-1'],
    status: 'failed',
    executionId: 'exec-fail2',
    error: 'Test suite failed: 3 assertions failed in auth.test.ts',
    agentType: 'claude-code',
  },
  {
    id: 'step-3',
    issueId: 'i-fail3',
    index: 2,
    dependencies: ['step-2'],
    status: 'blocked',
    agentType: 'claude-code',
  },
]

// =============================================================================
// Mock Workflows
// =============================================================================

export const MOCK_WORKFLOWS: Workflow[] = [
  // Running workflow - mixed step statuses
  {
    id: 'wf-auth',
    title: 'Authentication System Implementation',
    source: { type: 'spec', specId: 's-auth' } as WorkflowSource,
    status: 'running',
    steps: authWorkflowSteps,
    worktreePath: '.sudocode/worktrees/wf-auth',
    branchName: 'sudocode/wf-auth',
    baseBranch: 'main',
    currentStepIndex: 2,
    config: {
      ...DEFAULT_WORKFLOW_CONFIG,
      parallelism: 'parallel',
      maxConcurrency: 2,
    },
    createdAt: '2025-12-03T08:00:00Z',
    updatedAt: '2025-12-03T09:15:00Z',
    startedAt: '2025-12-03T08:05:00Z',
  },

  // Completed workflow
  {
    id: 'wf-api',
    title: 'API v2 Migration',
    source: { type: 'issues', issueIds: ['i-api1', 'i-api2', 'i-api3', 'i-api4'] } as WorkflowSource,
    status: 'completed',
    steps: apiWorkflowSteps,
    worktreePath: '.sudocode/worktrees/wf-api',
    branchName: 'sudocode/wf-api',
    baseBranch: 'main',
    currentStepIndex: 4,
    config: DEFAULT_WORKFLOW_CONFIG,
    createdAt: '2025-12-01T08:00:00Z',
    updatedAt: '2025-12-02T14:30:00Z',
    startedAt: '2025-12-01T08:10:00Z',
    completedAt: '2025-12-02T14:30:00Z',
  },

  // Failed workflow
  {
    id: 'wf-test',
    title: 'Test Coverage Improvement',
    source: { type: 'root_issue', issueId: 'i-fail3' } as WorkflowSource,
    status: 'failed',
    steps: failedWorkflowSteps,
    worktreePath: '.sudocode/worktrees/wf-test',
    branchName: 'sudocode/wf-test',
    baseBranch: 'main',
    currentStepIndex: 1,
    config: {
      ...DEFAULT_WORKFLOW_CONFIG,
      onFailure: 'stop',
    },
    createdAt: '2025-12-02T10:00:00Z',
    updatedAt: '2025-12-02T12:30:00Z',
    startedAt: '2025-12-02T10:05:00Z',
    completedAt: '2025-12-02T12:30:00Z',
  },

  // Paused workflow (awaiting input)
  {
    id: 'wf-paused',
    title: 'Feature Implementation',
    source: { type: 'goal', goal: 'Implement dark mode support across the application' } as WorkflowSource,
    status: 'paused',
    steps: [
      {
        id: 'step-1',
        issueId: 'i-auth1', // Reusing for demo
        index: 0,
        dependencies: [],
        status: 'completed',
        executionId: 'exec-paused1',
        commitSha: 'ppp111',
        agentType: 'claude-code',
      },
      {
        id: 'step-2',
        issueId: 'i-auth2',
        index: 1,
        dependencies: ['step-1'],
        status: 'ready',
        agentType: 'claude-code',
      },
    ],
    worktreePath: '.sudocode/worktrees/wf-paused',
    branchName: 'sudocode/wf-paused',
    baseBranch: 'main',
    currentStepIndex: 1,
    orchestratorExecutionId: 'exec-orchestrator-1',
    orchestratorSessionId: 'session-123',
    config: {
      ...DEFAULT_WORKFLOW_CONFIG,
      orchestratorAgentType: 'claude-code',
      orchestratorModel: 'claude-sonnet-4-20250514',
      autonomyLevel: 'human_in_the_loop',
    },
    createdAt: '2025-12-03T07:00:00Z',
    updatedAt: '2025-12-03T08:00:00Z',
    startedAt: '2025-12-03T07:05:00Z',
  },

  // Pending workflow (not started)
  {
    id: 'wf-pending',
    title: 'Database Migration',
    source: { type: 'spec', specId: 's-db' } as WorkflowSource,
    status: 'pending',
    steps: [],
    baseBranch: 'main',
    currentStepIndex: 0,
    config: DEFAULT_WORKFLOW_CONFIG,
    createdAt: '2025-12-03T09:00:00Z',
    updatedAt: '2025-12-03T09:00:00Z',
  },
]

// =============================================================================
// Factory Functions
// =============================================================================

let stepIdCounter = 0
let workflowIdCounter = 0

/**
 * Create a mock workflow step with sensible defaults
 */
export function createMockStep(overrides?: Partial<WorkflowStep>): WorkflowStep {
  stepIdCounter++
  return {
    id: `step-${stepIdCounter}`,
    issueId: `i-mock-${stepIdCounter}`,
    index: stepIdCounter - 1,
    dependencies: [],
    status: 'pending',
    agentType: 'claude-code',
    ...overrides,
  }
}

/**
 * Create a mock workflow with sensible defaults
 */
export function createMockWorkflow(overrides?: Partial<Workflow>): Workflow {
  workflowIdCounter++
  const id = `wf-mock-${workflowIdCounter}`
  return {
    id,
    title: `Mock Workflow ${workflowIdCounter}`,
    source: { type: 'spec', specId: 's-mock' },
    status: 'pending',
    steps: [],
    baseBranch: 'main',
    currentStepIndex: 0,
    config: DEFAULT_WORKFLOW_CONFIG,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

/**
 * Generate a workflow with a specific dependency structure
 * @param structure - 'linear' | 'parallel' | 'diamond' | 'complex'
 */
export function generateMockWorkflowWithStructure(
  structure: 'linear' | 'parallel' | 'diamond' | 'complex'
): Workflow {
  const workflow = createMockWorkflow({ title: `${structure} Workflow` })

  switch (structure) {
    case 'linear':
      // A → B → C → D
      workflow.steps = [
        createMockStep({ id: 'step-a', index: 0, dependencies: [], status: 'completed' }),
        createMockStep({ id: 'step-b', index: 1, dependencies: ['step-a'], status: 'running' }),
        createMockStep({ id: 'step-c', index: 2, dependencies: ['step-b'], status: 'pending' }),
        createMockStep({ id: 'step-d', index: 3, dependencies: ['step-c'], status: 'pending' }),
      ]
      break

    case 'parallel':
      // A, B, C all run in parallel → D
      workflow.steps = [
        createMockStep({ id: 'step-a', index: 0, dependencies: [], status: 'completed' }),
        createMockStep({ id: 'step-b', index: 1, dependencies: [], status: 'running' }),
        createMockStep({ id: 'step-c', index: 2, dependencies: [], status: 'running' }),
        createMockStep({ id: 'step-d', index: 3, dependencies: ['step-a', 'step-b', 'step-c'], status: 'pending' }),
      ]
      break

    case 'diamond':
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      workflow.steps = [
        createMockStep({ id: 'step-a', index: 0, dependencies: [], status: 'completed' }),
        createMockStep({ id: 'step-b', index: 1, dependencies: ['step-a'], status: 'running' }),
        createMockStep({ id: 'step-c', index: 2, dependencies: ['step-a'], status: 'completed' }),
        createMockStep({ id: 'step-d', index: 3, dependencies: ['step-b', 'step-c'], status: 'pending' }),
      ]
      break

    case 'complex':
      //     A
      //    /|\
      //   B C D
      //   |X|/
      //   E F
      //    \|
      //     G
      workflow.steps = [
        createMockStep({ id: 'step-a', index: 0, dependencies: [], status: 'completed' }),
        createMockStep({ id: 'step-b', index: 1, dependencies: ['step-a'], status: 'completed' }),
        createMockStep({ id: 'step-c', index: 2, dependencies: ['step-a'], status: 'running' }),
        createMockStep({ id: 'step-d', index: 3, dependencies: ['step-a'], status: 'completed' }),
        createMockStep({ id: 'step-e', index: 4, dependencies: ['step-b', 'step-c'], status: 'pending' }),
        createMockStep({ id: 'step-f', index: 5, dependencies: ['step-c', 'step-d'], status: 'pending' }),
        createMockStep({ id: 'step-g', index: 6, dependencies: ['step-e', 'step-f'], status: 'pending' }),
      ]
      break
  }

  workflow.status = 'running'
  return workflow
}

/**
 * Get issue data for a workflow's steps
 */
export function getIssuesForWorkflow(workflow: Workflow): Record<string, Issue> {
  const issues: Record<string, Issue> = {}
  for (const step of workflow.steps) {
    if (MOCK_ISSUES[step.issueId]) {
      issues[step.issueId] = MOCK_ISSUES[step.issueId]
    } else {
      // Generate a mock issue if not found
      issues[step.issueId] = {
        id: step.issueId,
        uuid: `uuid-${step.issueId}`,
        title: `Task for ${step.id}`,
        content: 'Auto-generated mock issue content.',
        status: 'open',
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }
  }
  return issues
}

/**
 * Calculate workflow progress stats
 */
export function getWorkflowProgress(workflow: Workflow): {
  completed: number
  running: number
  pending: number
  failed: number
  total: number
  percentage: number
} {
  const stats = {
    completed: 0,
    running: 0,
    pending: 0,
    failed: 0,
    total: workflow.steps.length,
    percentage: 0,
  }

  for (const step of workflow.steps) {
    switch (step.status) {
      case 'completed':
        stats.completed++
        break
      case 'running':
        stats.running++
        break
      case 'failed':
        stats.failed++
        break
      default:
        stats.pending++
    }
  }

  stats.percentage = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
  return stats
}
