import type { Meta, StoryObj } from '@storybook/react'
import { AgentTrajectory } from './AgentTrajectory'
import type { AgentMessage, ToolCall, AgentThought } from '@/hooks/useSessionUpdateStream'
import type { PermissionRequest as PermissionRequestType } from '@/types/permissions'

const meta: Meta<typeof AgentTrajectory> = {
  title: 'Executions/AgentTrajectory',
  component: AgentTrajectory,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl font-mono text-sm">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof AgentTrajectory>

// Helper to create timestamps with offsets
const now = Date.now()
const ts = (offset: number) => new Date(now + offset)

// Mock messages
const mockMessages: AgentMessage[] = [
  {
    id: 'msg-001',
    content:
      "I'll help you implement a user authentication system. Let me first explore the codebase to understand the existing structure.",
    timestamp: ts(0),
    isStreaming: false,
    index: 0,
  },
  {
    id: 'msg-002',
    content:
      'I found the existing auth module. Now let me create the login component with proper validation.',
    timestamp: ts(5000),
    isStreaming: false,
    index: 5,
  },
  {
    id: 'msg-003',
    content: 'The authentication system has been implemented. Here are the key changes:\n\n1. Created `LoginForm` component with email/password validation\n2. Added `useAuth` hook for managing auth state\n3. Integrated with the existing API client\n4. Added protected route wrapper',
    timestamp: ts(15000),
    isStreaming: false,
    index: 12,
  },
]

// Mock tool calls
const mockToolCalls: ToolCall[] = [
  {
    id: 'tc-001',
    title: 'Glob',
    status: 'success',
    rawInput: JSON.stringify({ pattern: '**/auth/**/*.ts' }),
    result: 'src/auth/index.ts\nsrc/auth/types.ts\nsrc/auth/hooks/useAuth.ts',
    timestamp: ts(1000),
    completedAt: ts(1500),
    index: 1,
  },
  {
    id: 'tc-002',
    title: 'Read',
    status: 'success',
    rawInput: JSON.stringify({ file_path: '/src/auth/index.ts' }),
    result:
      "     1→export { useAuth } from './hooks/useAuth'\n     2→export type { AuthState, User } from './types'\n     3→export { AuthProvider } from './AuthProvider'",
    timestamp: ts(2000),
    completedAt: ts(2200),
    index: 2,
  },
  {
    id: 'tc-003',
    title: 'Write',
    status: 'success',
    rawInput: JSON.stringify({ file_path: '/src/components/LoginForm.tsx' }),
    result: 'File written successfully',
    timestamp: ts(6000),
    completedAt: ts(6500),
    index: 6,
  },
  {
    id: 'tc-004',
    title: 'Bash',
    status: 'success',
    rawInput: JSON.stringify({ command: 'npm run build && npm test' }),
    result: '> build\n> tsc && vite build\n\n✓ 156 modules transformed.\n\n> test\n\nTest Suites: 12 passed, 12 total\nTests:       47 passed, 47 total',
    timestamp: ts(10000),
    completedAt: ts(14000),
    index: 10,
  },
]

// Mock thoughts
const mockThoughts: AgentThought[] = [
  {
    id: 'thought-001',
    content:
      'The user wants authentication. I should first check if there are any existing auth patterns in the codebase before implementing something new.',
    timestamp: ts(500),
    isStreaming: false,
    index: 0,
  },
  {
    id: 'thought-002',
    content:
      'Found existing auth structure. I can extend the useAuth hook and create a new LoginForm component that follows the existing patterns.',
    timestamp: ts(3000),
    isStreaming: false,
    index: 3,
  },
]

// Mock permission requests
const mockPermissionRequests: PermissionRequestType[] = [
  {
    requestId: 'perm-001',
    sessionId: 'session-001',
    timestamp: ts(9000),
    toolCall: {
      toolCallId: 'tc-perm-001',
      title: 'Bash',
      status: 'pending',
      rawInput: JSON.stringify({ command: 'npm run build && npm test' }),
    },
    options: [
      { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
      { optionId: 'always', kind: 'allow_always', name: 'Always' },
      { optionId: 'deny', kind: 'deny_once', name: 'Deny' },
    ],
    responded: false,
    index: 9,
  },
]

export const Default: Story = {
  args: {
    messages: mockMessages,
    toolCalls: mockToolCalls,
    thoughts: mockThoughts,
  },
}

export const MessagesOnly: Story = {
  args: {
    messages: mockMessages,
    toolCalls: [],
    thoughts: [],
  },
}

export const ToolCallsOnly: Story = {
  args: {
    messages: [],
    toolCalls: mockToolCalls,
    thoughts: [],
  },
}

export const WithThoughts: Story = {
  args: {
    messages: mockMessages.slice(0, 1),
    toolCalls: mockToolCalls.slice(0, 2),
    thoughts: mockThoughts,
  },
}

export const WithPermissionRequest: Story = {
  args: {
    messages: mockMessages.slice(0, 2),
    toolCalls: mockToolCalls.slice(0, 3),
    thoughts: mockThoughts,
    permissionRequests: mockPermissionRequests,
    onPermissionRespond: (requestId, optionId) =>
      console.log('Permission response:', requestId, optionId),
  },
}

export const StreamingMessage: Story = {
  args: {
    messages: [
      {
        id: 'msg-streaming',
        content: 'I am currently analyzing the codebase to understand...',
        timestamp: new Date(),
        isStreaming: true,
        index: 0,
      },
    ],
    toolCalls: [],
    thoughts: [],
  },
}

export const StreamingThought: Story = {
  args: {
    messages: [],
    toolCalls: [],
    thoughts: [
      {
        id: 'thought-streaming',
        content: 'Let me think about the best approach for this...',
        timestamp: new Date(),
        isStreaming: true,
        index: 0,
      },
    ],
  },
}

export const RunningToolCall: Story = {
  args: {
    messages: [
      {
        id: 'msg-001',
        content: 'Running the build process now...',
        timestamp: ts(0),
        isStreaming: false,
        index: 0,
      },
    ],
    toolCalls: [
      {
        id: 'tc-running',
        title: 'Bash',
        status: 'running',
        rawInput: JSON.stringify({ command: 'npm run build' }),
        timestamp: new Date(),
        index: 1,
      },
    ],
    thoughts: [],
  },
}

export const FailedToolCall: Story = {
  args: {
    messages: [
      {
        id: 'msg-001',
        content: 'Let me try to run the tests...',
        timestamp: ts(0),
        isStreaming: false,
        index: 0,
      },
    ],
    toolCalls: [
      {
        id: 'tc-failed',
        title: 'Bash',
        status: 'failed',
        rawInput: JSON.stringify({ command: 'npm test' }),
        result: 'Error: Test suite failed\n  at src/auth/useAuth.test.ts:42\n    Expected: true\n    Received: false',
        timestamp: ts(1000),
        completedAt: ts(3000),
        index: 1,
      },
    ],
    thoughts: [],
  },
}

export const EditToolWithDiff: Story = {
  args: {
    messages: [
      {
        id: 'msg-001',
        content: 'Updating the configuration file...',
        timestamp: ts(0),
        isStreaming: false,
        index: 0,
      },
    ],
    toolCalls: [
      {
        id: 'tc-edit',
        title: 'Edit',
        status: 'success',
        rawInput: JSON.stringify({
          file_path: '/src/config.ts',
          old_string: 'export const API_URL = "http://localhost:3000"',
          new_string: 'export const API_URL = process.env.API_URL || "http://localhost:3000"',
        }),
        result: 'File edited successfully',
        timestamp: ts(1000),
        completedAt: ts(1200),
        index: 1,
      },
    ],
    thoughts: [],
  },
}

export const GrepWithResults: Story = {
  args: {
    messages: [
      {
        id: 'msg-001',
        content: 'Searching for authentication patterns in the codebase...',
        timestamp: ts(0),
        isStreaming: false,
        index: 0,
      },
    ],
    toolCalls: [
      {
        id: 'tc-grep',
        title: 'Grep',
        status: 'success',
        rawInput: JSON.stringify({
          pattern: 'useAuth',
          path: 'src',
          output_mode: 'files_with_matches',
        }),
        result: 'src/hooks/useAuth.ts\nsrc/components/LoginForm.tsx\nsrc/components/ProtectedRoute.tsx\nsrc/pages/Dashboard.tsx\nsrc/pages/Profile.tsx',
        timestamp: ts(1000),
        completedAt: ts(1300),
        index: 1,
      },
    ],
    thoughts: [],
  },
}

export const LongToolOutput: Story = {
  args: {
    messages: [
      {
        id: 'msg-001',
        content: 'Reading the configuration file...',
        timestamp: ts(0),
        isStreaming: false,
        index: 0,
      },
    ],
    toolCalls: [
      {
        id: 'tc-read-long',
        title: 'Read',
        status: 'success',
        rawInput: JSON.stringify({ file_path: '/src/config/settings.ts' }),
        result: Array.from({ length: 50 }, (_, i) => `     ${i + 1}→export const SETTING_${i} = "value_${i}"`).join('\n'),
        timestamp: ts(1000),
        completedAt: ts(1200),
        index: 1,
      },
    ],
    thoughts: [],
  },
}

export const NoMarkdown: Story = {
  args: {
    messages: [
      {
        id: 'msg-001',
        content: '## Header\n\nThis is **bold** and this is `code`.\n\n- Item 1\n- Item 2',
        timestamp: ts(0),
        isStreaming: false,
        index: 0,
      },
    ],
    toolCalls: [],
    thoughts: [],
    renderMarkdown: false,
  },
}

export const WithTodoTracker: Story = {
  args: {
    messages: [
      {
        id: 'msg-001',
        content: 'Creating a todo list to track the implementation steps...',
        timestamp: ts(0),
        isStreaming: false,
        index: 0,
      },
    ],
    toolCalls: [
      {
        id: 'tc-todo',
        title: 'TodoWrite',
        status: 'success',
        rawInput: JSON.stringify({
          todos: [
            { content: 'Research existing auth patterns', status: 'completed', activeForm: 'Researching auth patterns' },
            { content: 'Create LoginForm component', status: 'in_progress', activeForm: 'Creating LoginForm' },
            { content: 'Add useAuth hook', status: 'pending', activeForm: 'Adding useAuth hook' },
            { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' },
          ],
        }),
        result: JSON.stringify({
          todos: [
            { content: 'Research existing auth patterns', status: 'completed' },
            { content: 'Create LoginForm component', status: 'in_progress' },
            { content: 'Add useAuth hook', status: 'pending' },
            { content: 'Write tests', status: 'pending' },
          ],
        }),
        timestamp: ts(1000),
        completedAt: ts(1100),
        index: 1,
      },
    ],
    thoughts: [],
    showTodoTracker: true,
  },
}

export const Empty: Story = {
  args: {
    messages: [],
    toolCalls: [],
    thoughts: [],
  },
}

export const CompleteWorkflow: Story = {
  args: {
    messages: mockMessages,
    toolCalls: mockToolCalls,
    thoughts: mockThoughts,
    permissionRequests: [
      {
        ...mockPermissionRequests[0],
        responded: true,
        selectedOptionId: 'allow',
      },
    ],
    onPermissionRespond: (requestId, optionId) =>
      console.log('Permission response:', requestId, optionId),
    showTodoTracker: true,
  },
}
