import type { Meta, StoryObj } from '@storybook/react'
import { AgentSelector } from './AgentSelector'
import type { AgentInfo } from '@/types/api'

const meta: Meta<typeof AgentSelector> = {
  title: 'Executions/AgentSelector',
  component: AgentSelector,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof AgentSelector>

const mockAgents: AgentInfo[] = [
  {
    type: 'claude-code',
    displayName: 'Claude Code',
    implemented: true,
    supportedModes: ['worktree', 'local'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  },
  {
    type: 'codex',
    displayName: 'OpenAI Codex',
    implemented: true,
    supportedModes: ['local'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
  },
  {
    type: 'copilot',
    displayName: 'GitHub Copilot',
    implemented: false,
    supportedModes: ['local'],
    supportsStreaming: false,
    supportsStructuredOutput: false,
  },
  {
    type: 'cursor',
    displayName: 'Cursor',
    implemented: false,
    supportedModes: ['local'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
  },
]

export const Default: Story = {
  args: {
    agents: mockAgents,
    selectedAgent: 'claude-code',
    onChange: (agentType) => console.log('Selected:', agentType),
  },
}

export const WithDescription: Story = {
  args: {
    agents: mockAgents,
    selectedAgent: 'claude-code',
    onChange: (agentType) => console.log('Selected:', agentType),
    label: 'AI Agent',
    description: 'Select the AI agent to use for this execution',
  },
}

export const Disabled: Story = {
  args: {
    agents: mockAgents,
    selectedAgent: 'claude-code',
    onChange: (agentType) => console.log('Selected:', agentType),
    disabled: true,
  },
}

export const UnimplementedSelected: Story = {
  args: {
    agents: mockAgents,
    selectedAgent: 'copilot',
    onChange: (agentType) => console.log('Selected:', agentType),
  },
}

export const SingleAgent: Story = {
  args: {
    agents: [mockAgents[0]],
    selectedAgent: 'claude-code',
    onChange: (agentType) => console.log('Selected:', agentType),
  },
}
