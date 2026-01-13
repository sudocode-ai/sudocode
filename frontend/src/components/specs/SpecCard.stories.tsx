import type { Meta, StoryObj } from '@storybook/react'
import { SpecCard } from './SpecCard'
import type { Spec } from '@sudocode-ai/types'

const meta: Meta<typeof SpecCard> = {
  title: 'Specs/SpecCard',
  component: SpecCard,
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
type Story = StoryObj<typeof SpecCard>

const baseSpec: Spec = {
  id: 's-abc123',
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Authentication System Design',
  file_path: 'specs/s-abc123_authentication_system_design.md',
  content: `# Authentication System Design

## Overview
This spec defines the authentication system architecture including OAuth2 providers, session management, and security considerations.

## Requirements
- Support Google OAuth2
- Support GitHub OAuth2
- JWT token management
- Secure session handling`,
  priority: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export const Default: Story = {
  args: {
    spec: baseSpec,
    onClick: (spec) => console.log('Clicked:', spec.id),
  },
}

export const HighPriority: Story = {
  args: {
    spec: { ...baseSpec, priority: 0, title: 'Critical Security Architecture' },
    onClick: (spec) => console.log('Clicked:', spec.id),
  },
}

export const LowPriority: Story = {
  args: {
    spec: { ...baseSpec, priority: 4, title: 'Future Enhancement Ideas' },
    onClick: (spec) => console.log('Clicked:', spec.id),
  },
}

export const LongTitle: Story = {
  args: {
    spec: {
      ...baseSpec,
      title: 'This is a very long specification title that demonstrates how text wrapping and truncation works in the card',
    },
    onClick: (spec) => console.log('Clicked:', spec.id),
  },
}

export const ShortContent: Story = {
  args: {
    spec: {
      ...baseSpec,
      content: 'Brief spec with minimal content.',
    },
    onClick: (spec) => console.log('Clicked:', spec.id),
  },
}

export const AllPriorities: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((priority) => (
        <SpecCard
          key={priority}
          spec={{ ...baseSpec, id: `s-${priority}`, priority, title: `Priority ${priority} spec` }}
          onClick={(spec) => console.log('Clicked:', spec.id)}
        />
      ))}
    </div>
  ),
}
