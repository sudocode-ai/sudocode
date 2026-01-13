import type { Meta, StoryObj } from '@storybook/react'
import { PermissionRequest } from './PermissionRequest'
import type { PermissionRequest as PermissionRequestType } from '@/types/permissions'

const meta: Meta<typeof PermissionRequest> = {
  title: 'Executions/PermissionRequest',
  component: PermissionRequest,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="max-w-lg font-mono text-sm">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof PermissionRequest>

const baseBashRequest: PermissionRequestType = {
  requestId: 'req-001',
  sessionId: 'session-001',
  timestamp: new Date(),
  toolCall: {
    toolCallId: 'tc-001',
    title: 'Bash',
    status: 'pending',
    rawInput: JSON.stringify({ command: 'npm install && npm run build' }),
  },
  options: [
    { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
    { optionId: 'always', kind: 'allow_always', name: 'Always' },
    { optionId: 'deny', kind: 'deny_once', name: 'Deny' },
    { optionId: 'never', kind: 'deny_always', name: 'Never' },
  ],
  responded: false,
  selectedOptionId: undefined,
}

const baseFileRequest: PermissionRequestType = {
  requestId: 'req-002',
  sessionId: 'session-001',
  timestamp: new Date(),
  toolCall: {
    toolCallId: 'tc-002',
    title: 'Write',
    status: 'pending',
    rawInput: JSON.stringify({ file_path: '/src/components/Button.tsx' }),
  },
  options: [
    { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
    { optionId: 'always', kind: 'allow_always', name: 'Always' },
    { optionId: 'deny', kind: 'deny_once', name: 'Deny' },
  ],
  responded: false,
  selectedOptionId: undefined,
}

export const BashCommand: Story = {
  args: {
    request: baseBashRequest,
    onRespond: (requestId, optionId) => console.log('Respond:', requestId, optionId),
    autoFocus: false,
  },
}

export const FileWrite: Story = {
  args: {
    request: baseFileRequest,
    onRespond: (requestId, optionId) => console.log('Respond:', requestId, optionId),
    autoFocus: false,
  },
}

export const LongCommand: Story = {
  args: {
    request: {
      ...baseBashRequest,
      requestId: 'req-003',
      toolCall: {
        toolCallId: 'tc-003',
        title: 'Bash',
        status: 'pending',
        rawInput: JSON.stringify({
          command:
            'git fetch origin && git checkout -b feature/very-long-branch-name-that-describes-what-we-are-doing && npm install && npm run build && npm test',
        }),
      },
    },
    onRespond: (requestId, optionId) => console.log('Respond:', requestId, optionId),
    autoFocus: false,
  },
}

export const WithSkipAll: Story = {
  args: {
    request: baseBashRequest,
    onRespond: (requestId, optionId) => console.log('Respond:', requestId, optionId),
    onSkipAll: () => console.log('Skip All clicked'),
    autoFocus: false,
  },
}

export const SkippingAll: Story = {
  args: {
    request: baseBashRequest,
    onRespond: (requestId, optionId) => console.log('Respond:', requestId, optionId),
    onSkipAll: () => console.log('Skip All clicked'),
    isSkippingAll: true,
    autoFocus: false,
  },
}

export const Responded: Story = {
  args: {
    request: {
      ...baseBashRequest,
      responded: true,
      selectedOptionId: 'allow',
    },
    onRespond: (requestId, optionId) => console.log('Respond:', requestId, optionId),
    autoFocus: false,
  },
}

export const RespondedDeny: Story = {
  args: {
    request: {
      ...baseBashRequest,
      responded: true,
      selectedOptionId: 'deny',
    },
    onRespond: (requestId, optionId) => console.log('Respond:', requestId, optionId),
    autoFocus: false,
  },
}

export const MultipleRequests: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <PermissionRequest
        request={baseBashRequest}
        onRespond={(requestId, optionId) => console.log('Respond:', requestId, optionId)}
        autoFocus={false}
      />
      <PermissionRequest
        request={baseFileRequest}
        onRespond={(requestId, optionId) => console.log('Respond:', requestId, optionId)}
        autoFocus={false}
      />
      <PermissionRequest
        request={{
          ...baseBashRequest,
          requestId: 'req-responded',
          responded: true,
          selectedOptionId: 'always',
        }}
        onRespond={(requestId, optionId) => console.log('Respond:', requestId, optionId)}
        autoFocus={false}
      />
    </div>
  ),
}
