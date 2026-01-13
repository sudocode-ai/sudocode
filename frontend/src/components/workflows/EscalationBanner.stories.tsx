import type { Meta, StoryObj } from '@storybook/react'
import { EscalationBanner } from './EscalationBanner'

const meta: Meta<typeof EscalationBanner> = {
  title: 'Workflows/EscalationBanner',
  component: EscalationBanner,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EscalationBanner>

export const Default: Story = {
  args: {
    workflowId: 'w-abc123',
    workflowTitle: 'User Authentication',
    message: 'Should I use OAuth2 or JWT for authentication?',
    onRespond: () => console.log('Respond clicked'),
  },
}

export const LongMessage: Story = {
  args: {
    workflowId: 'w-abc123',
    workflowTitle: 'Database Migration',
    message:
      'The migration script encountered a conflict with the existing schema. Should I create a backup first and then proceed with the destructive changes, or would you prefer to review the changes manually?',
    onRespond: () => console.log('Respond clicked'),
  },
}

export const ShortTitle: Story = {
  args: {
    workflowId: 'w-xyz',
    workflowTitle: 'API',
    message: 'Rate limit exceeded, retry?',
    onRespond: () => console.log('Respond clicked'),
  },
}

export const WithoutRespondButton: Story = {
  args: {
    workflowId: 'w-abc123',
    workflowTitle: 'Build Pipeline',
    message: 'Waiting for approval to deploy to production',
    // No onRespond callback
  },
}

export const MultipleEscalations: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <EscalationBanner
        workflowId="w-001"
        workflowTitle="User Authentication"
        message="Should I use OAuth2 or JWT?"
        onRespond={() => console.log('Respond to auth')}
      />
      <EscalationBanner
        workflowId="w-002"
        workflowTitle="Database Setup"
        message="PostgreSQL or MySQL for the main database?"
        onRespond={() => console.log('Respond to db')}
      />
      <EscalationBanner
        workflowId="w-003"
        workflowTitle="CI/CD Pipeline"
        message="Deploy to staging first?"
        onRespond={() => console.log('Respond to ci')}
      />
    </div>
  ),
}
