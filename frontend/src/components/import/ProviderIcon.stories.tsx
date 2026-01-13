import type { Meta, StoryObj } from '@storybook/react'
import { ProviderIcon, getProviderDisplayName } from './ProviderIcon'

const meta: Meta<typeof ProviderIcon> = {
  title: 'Import/ProviderIcon',
  component: ProviderIcon,
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof ProviderIcon>

export const GitHub: Story = {
  args: {
    provider: 'github',
  },
}

export const Jira: Story = {
  args: {
    provider: 'jira',
  },
}

export const Linear: Story = {
  args: {
    provider: 'linear',
  },
}

export const Notion: Story = {
  args: {
    provider: 'notion',
  },
}

export const Beads: Story = {
  args: {
    provider: 'beads',
  },
}

export const Unknown: Story = {
  args: {
    provider: 'unknown-provider',
  },
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <div className="flex flex-col items-center gap-2">
        <ProviderIcon provider="github" size="sm" />
        <span className="text-xs text-muted-foreground">Small</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ProviderIcon provider="github" size="md" />
        <span className="text-xs text-muted-foreground">Medium</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ProviderIcon provider="github" size="lg" />
        <span className="text-xs text-muted-foreground">Large</span>
      </div>
    </div>
  ),
}

export const AllProviders: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {['github', 'jira', 'linear', 'notion', 'beads', 'unknown'].map((provider) => (
        <div key={provider} className="flex items-center gap-3">
          <ProviderIcon provider={provider} />
          <span className="text-sm">{getProviderDisplayName(provider)}</span>
        </div>
      ))}
    </div>
  ),
}
