import type { Meta, StoryObj } from '@storybook/react'
import { WorkflowDAG } from './WorkflowDAG'
import type { WorkflowStep, WorkflowStepStatus } from '@/types/workflow'
import type { Issue } from '@/types/api'
import { ReactFlowProvider } from '@xyflow/react'

const meta: Meta<typeof WorkflowDAG> = {
  title: 'Workflows/WorkflowDAG',
  component: WorkflowDAG,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <ReactFlowProvider>
        <div className="h-[600px] w-full">
          <Story />
        </div>
      </ReactFlowProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof WorkflowDAG>

// Helper to create mock workflow steps
const createMockStep = (
  id: string,
  issueId: string,
  status: WorkflowStepStatus,
  dependencies: string[] = [],
  index: number = 0
): WorkflowStep => ({
  id,
  issueId,
  index,
  status,
  dependencies,
  executionId: status === 'running' || status === 'completed' ? `exec-${id}` : undefined,
})

// Helper to create mock issues
const createMockIssue = (id: string, title: string): Issue => ({
  id,
  uuid: `uuid-${id}`,
  title,
  content: `Description for ${title}`,
  status: 'open',
  priority: 2,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived: false,
})

// Linear workflow (step-by-step)
const linearSteps: WorkflowStep[] = [
  createMockStep('step-1', 'i-001', 'completed', [], 0),
  createMockStep('step-2', 'i-002', 'completed', ['step-1'], 1),
  createMockStep('step-3', 'i-003', 'running', ['step-2'], 2),
  createMockStep('step-4', 'i-004', 'pending', ['step-3'], 3),
]

const linearIssues: Record<string, Issue> = {
  'i-001': createMockIssue('i-001', 'Setup project structure'),
  'i-002': createMockIssue('i-002', 'Install dependencies'),
  'i-003': createMockIssue('i-003', 'Configure TypeScript'),
  'i-004': createMockIssue('i-004', 'Add linting rules'),
}

// Diamond workflow (parallel then merge)
const diamondSteps: WorkflowStep[] = [
  createMockStep('step-root', 'i-root', 'completed', [], 0),
  createMockStep('step-left', 'i-left', 'completed', ['step-root'], 1),
  createMockStep('step-right', 'i-right', 'running', ['step-root'], 2),
  createMockStep('step-merge', 'i-merge', 'blocked', ['step-left', 'step-right'], 3),
]

const diamondIssues: Record<string, Issue> = {
  'i-root': createMockIssue('i-root', 'Initialize project'),
  'i-left': createMockIssue('i-left', 'Setup frontend'),
  'i-right': createMockIssue('i-right', 'Setup backend'),
  'i-merge': createMockIssue('i-merge', 'Integrate frontend and backend'),
}

// Complex workflow with multiple branches
const complexSteps: WorkflowStep[] = [
  createMockStep('step-init', 'i-init', 'completed', [], 0),
  createMockStep('step-auth', 'i-auth', 'completed', ['step-init'], 1),
  createMockStep('step-db', 'i-db', 'completed', ['step-init'], 2),
  createMockStep('step-api', 'i-api', 'running', ['step-auth', 'step-db'], 3),
  createMockStep('step-ui-base', 'i-ui-base', 'completed', ['step-init'], 4),
  createMockStep('step-ui-forms', 'i-ui-forms', 'ready', ['step-ui-base'], 5),
  createMockStep('step-ui-dashboard', 'i-ui-dashboard', 'pending', ['step-ui-base', 'step-api'], 6),
  createMockStep('step-tests', 'i-tests', 'pending', ['step-api', 'step-ui-forms'], 7),
  createMockStep('step-deploy', 'i-deploy', 'pending', ['step-tests', 'step-ui-dashboard'], 8),
]

const complexIssues: Record<string, Issue> = {
  'i-init': createMockIssue('i-init', 'Project initialization'),
  'i-auth': createMockIssue('i-auth', 'Authentication system'),
  'i-db': createMockIssue('i-db', 'Database setup'),
  'i-api': createMockIssue('i-api', 'API endpoints'),
  'i-ui-base': createMockIssue('i-ui-base', 'Base UI components'),
  'i-ui-forms': createMockIssue('i-ui-forms', 'Form components'),
  'i-ui-dashboard': createMockIssue('i-ui-dashboard', 'Dashboard UI'),
  'i-tests': createMockIssue('i-tests', 'Integration tests'),
  'i-deploy': createMockIssue('i-deploy', 'Deployment pipeline'),
}

export const Linear: Story = {
  args: {
    steps: linearSteps,
    issues: linearIssues,
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const Diamond: Story = {
  args: {
    steps: diamondSteps,
    issues: diamondIssues,
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const Complex: Story = {
  args: {
    steps: complexSteps,
    issues: complexIssues,
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const WithSelectedStep: Story = {
  args: {
    steps: complexSteps,
    issues: complexIssues,
    selectedStepId: 'step-api',
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const AllCompleted: Story = {
  args: {
    steps: [
      createMockStep('step-1', 'i-001', 'completed', [], 0),
      createMockStep('step-2', 'i-002', 'completed', ['step-1'], 1),
      createMockStep('step-3', 'i-003', 'completed', ['step-1'], 2),
      createMockStep('step-4', 'i-004', 'completed', ['step-2', 'step-3'], 3),
    ],
    issues: {
      'i-001': createMockIssue('i-001', 'First step'),
      'i-002': createMockIssue('i-002', 'Second step'),
      'i-003': createMockIssue('i-003', 'Third step'),
      'i-004': createMockIssue('i-004', 'Final step'),
    },
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const WithFailedStep: Story = {
  args: {
    steps: [
      createMockStep('step-1', 'i-001', 'completed', [], 0),
      createMockStep('step-2', 'i-002', 'failed', ['step-1'], 1),
      createMockStep('step-3', 'i-003', 'blocked', ['step-2'], 2),
    ],
    issues: {
      'i-001': createMockIssue('i-001', 'Setup environment'),
      'i-002': createMockIssue('i-002', 'Install dependencies'),
      'i-003': createMockIssue('i-003', 'Run build'),
    },
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const SingleStep: Story = {
  args: {
    steps: [createMockStep('step-only', 'i-only', 'running', [], 0)],
    issues: {
      'i-only': createMockIssue('i-only', 'Single task workflow'),
    },
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const Empty: Story = {
  args: {
    steps: [],
    issues: {},
    onStepSelect: (stepId) => console.log('Selected step:', stepId),
  },
}

export const NonInteractive: Story = {
  args: {
    steps: complexSteps,
    issues: complexIssues,
    interactive: false,
    showMinimap: false,
    showControls: false,
  },
}
