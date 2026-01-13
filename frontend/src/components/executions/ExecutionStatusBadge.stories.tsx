import type { Meta, StoryObj } from '@storybook/react'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'

const meta: Meta<typeof ExecutionStatusBadge> = {
  title: 'Executions/ExecutionStatusBadge',
  component: ExecutionStatusBadge,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    status: {
      control: 'select',
      options: ['preparing', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'stopped'],
    },
  },
}

export default meta
type Story = StoryObj<typeof ExecutionStatusBadge>

export const Preparing: Story = {
  args: { status: 'preparing' },
}

export const Pending: Story = {
  args: { status: 'pending' },
}

export const Running: Story = {
  args: { status: 'running' },
}

export const Paused: Story = {
  args: { status: 'paused' },
}

export const Completed: Story = {
  args: { status: 'completed' },
}

export const Failed: Story = {
  args: { status: 'failed' },
}

export const Cancelled: Story = {
  args: { status: 'cancelled' },
}

export const Stopped: Story = {
  args: { status: 'stopped' },
}

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <ExecutionStatusBadge status="preparing" />
      <ExecutionStatusBadge status="pending" />
      <ExecutionStatusBadge status="running" />
      <ExecutionStatusBadge status="paused" />
      <ExecutionStatusBadge status="completed" />
      <ExecutionStatusBadge status="failed" />
      <ExecutionStatusBadge status="cancelled" />
      <ExecutionStatusBadge status="stopped" />
    </div>
  ),
}
