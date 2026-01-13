import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './badge'

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof Badge>

export const Default: Story = {
  args: {
    children: 'Default',
  },
}

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary',
  },
}

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Destructive',
  },
}

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline',
  },
}

export const Issue: Story = {
  args: {
    variant: 'issue',
    children: 'i-abc123',
  },
}

export const Spec: Story = {
  args: {
    variant: 'spec',
    children: 's-xyz789',
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="issue">Issue</Badge>
      <Badge variant="spec">Spec</Badge>
    </div>
  ),
}
