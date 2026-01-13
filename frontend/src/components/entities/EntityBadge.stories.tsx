import type { Meta, StoryObj } from '@storybook/react'
import { EntityBadge } from './EntityBadge'

const meta: Meta<typeof EntityBadge> = {
  title: 'Entities/EntityBadge',
  component: EntityBadge,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    entityType: {
      control: 'select',
      options: ['issue', 'spec'],
    },
  },
}

export default meta
type Story = StoryObj<typeof EntityBadge>

export const IssueBadge: Story = {
  args: {
    entityId: 'i-abc123',
    entityType: 'issue',
  },
}

export const SpecBadge: Story = {
  args: {
    entityId: 's-xyz789',
    entityType: 'spec',
  },
}

export const WithDisplayText: Story = {
  args: {
    entityId: 'i-abc123',
    entityType: 'issue',
    displayText: 'Authentication Issue',
  },
}

export const WithTitle: Story = {
  args: {
    entityId: 'i-abc123',
    entityType: 'issue',
    showTitle: true,
  },
}

export const WithRelationshipType: Story = {
  args: {
    entityId: 's-xyz789',
    entityType: 'spec',
    relationshipType: 'implements',
  },
}

export const NoHoverCard: Story = {
  args: {
    entityId: 'i-abc123',
    entityType: 'issue',
    showHoverCard: false,
  },
}

export const NoLink: Story = {
  args: {
    entityId: 'i-abc123',
    entityType: 'issue',
    linkToEntity: false,
  },
}

export const MultipleEntities: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <EntityBadge entityId="i-abc1" entityType="issue" />
      <EntityBadge entityId="i-def2" entityType="issue" />
      <EntityBadge entityId="s-ghi3" entityType="spec" />
      <EntityBadge entityId="s-jkl4" entityType="spec" />
      <EntityBadge entityId="i-mno5" entityType="issue" relationshipType="blocks" />
      <EntityBadge entityId="s-pqr6" entityType="spec" relationshipType="implements" />
    </div>
  ),
}
