import type { Meta, StoryObj } from '@storybook/react'
import { ToolCallViewer } from './ToolCallViewer'
import type { ToolCallTracking } from '@/types/stream'

const meta: Meta<typeof ToolCallViewer> = {
  title: 'Executions/ToolCallViewer',
  component: ToolCallViewer,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ToolCallViewer>

// Helper to create mock tool calls
const createMockToolCall = (
  id: string,
  name: string,
  status: ToolCallTracking['status'],
  args: string,
  result?: string,
  error?: string,
  duration?: number
): ToolCallTracking => {
  const startTime = Date.now() - (duration || 1000)
  return {
    toolCallId: id,
    toolCallName: name,
    status,
    args,
    result,
    error,
    startTime,
    endTime: status === 'completed' || status === 'error' ? startTime + (duration || 1000) : undefined,
  }
}

// Mock tool calls
const mockToolCalls: Map<string, ToolCallTracking> = new Map([
  [
    'tc-001',
    createMockToolCall(
      'tc-001',
      'Glob',
      'completed',
      JSON.stringify({ pattern: '**/*.ts', path: 'src' }, null, 2),
      'src/index.ts\nsrc/utils.ts\nsrc/types.ts',
      undefined,
      500
    ),
  ],
  [
    'tc-002',
    createMockToolCall(
      'tc-002',
      'Read',
      'completed',
      JSON.stringify({ file_path: '/src/index.ts' }, null, 2),
      "export function main() {\n  console.log('Hello, World!');\n}",
      undefined,
      200
    ),
  ],
  [
    'tc-003',
    createMockToolCall(
      'tc-003',
      'Bash',
      'executing',
      JSON.stringify({ command: 'npm run build' }, null, 2)
    ),
  ],
])

export const Default: Story = {
  args: {
    toolCalls: mockToolCalls,
  },
}

export const WithError: Story = {
  args: {
    toolCalls: new Map([
      [
        'tc-error',
        createMockToolCall(
          'tc-error',
          'Bash',
          'error',
          JSON.stringify({ command: 'npm run test' }, null, 2),
          undefined,
          'Command failed with exit code 1: Test suite failed\n  FAIL src/utils.test.ts\n    Expected: 1\n    Received: 2',
          3500
        ),
      ],
    ]),
  },
}

export const SingleToolCall: Story = {
  args: {
    toolCalls: new Map([
      [
        'tc-single',
        createMockToolCall(
          'tc-single',
          'Write',
          'completed',
          JSON.stringify({ file_path: '/src/config.ts', content: 'export const API_URL = "http://localhost:3000"' }, null, 2),
          'File written successfully',
          undefined,
          150
        ),
      ],
    ]),
  },
}

export const MultipleExecuting: Story = {
  args: {
    toolCalls: new Map([
      ['tc-exec1', createMockToolCall('tc-exec1', 'Glob', 'executing', JSON.stringify({ pattern: '**/*.test.ts' }, null, 2))],
      ['tc-exec2', createMockToolCall('tc-exec2', 'Grep', 'executing', JSON.stringify({ pattern: 'describe', path: 'src' }, null, 2))],
    ]),
  },
}

export const MixedStatuses: Story = {
  args: {
    toolCalls: new Map([
      [
        'tc-completed',
        createMockToolCall(
          'tc-completed',
          'Read',
          'completed',
          JSON.stringify({ file_path: '/package.json' }, null, 2),
          '{\n  "name": "my-project",\n  "version": "1.0.0"\n}',
          undefined,
          100
        ),
      ],
      [
        'tc-executing',
        createMockToolCall('tc-executing', 'Bash', 'executing', JSON.stringify({ command: 'npm install' }, null, 2)),
      ],
      [
        'tc-error',
        createMockToolCall(
          'tc-error',
          'Write',
          'error',
          JSON.stringify({ file_path: '/readonly/file.ts' }, null, 2),
          undefined,
          'Permission denied: Cannot write to readonly directory',
          50
        ),
      ],
    ]),
  },
}

export const LongOutput: Story = {
  args: {
    toolCalls: new Map([
      [
        'tc-long',
        createMockToolCall(
          'tc-long',
          'Grep',
          'completed',
          JSON.stringify({ pattern: 'import', path: 'src', output_mode: 'content' }, null, 2),
          Array.from({ length: 50 }, (_, i) => `src/file${i}.ts:1:import { something } from 'somewhere';`).join('\n'),
          undefined,
          2500
        ),
      ],
    ]),
  },
}

export const Empty: Story = {
  args: {
    toolCalls: new Map(),
  },
}
