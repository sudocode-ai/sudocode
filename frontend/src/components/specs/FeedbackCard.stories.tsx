import type { Meta, StoryObj } from '@storybook/react'
import { FeedbackCard } from './FeedbackCard'
import type { IssueFeedback } from '@/types/api'

const meta: Meta<typeof FeedbackCard> = {
  title: 'Specs/FeedbackCard',
  component: FeedbackCard,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[400px]">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof FeedbackCard>

const baseFeedback: IssueFeedback = {
  id: 'fb-001',
  from_id: 'i-abc123',
  from_uuid: '123e4567-e89b-12d3-a456-426614174000',
  to_id: 's-xyz789',
  to_uuid: '123e4567-e89b-12d3-a456-426614174001',
  feedback_type: 'comment',
  content: 'This implementation looks good. The authentication flow handles edge cases well.',
  anchor: undefined,
  dismissed: false,
  created_at: new Date(Date.now() - 3600000).toISOString(),
  updated_at: new Date().toISOString(),
}

export const Comment: Story = {
  args: {
    feedback: baseFeedback,
    onDismiss: (id) => console.log('Dismiss:', id),
    onDelete: (id) => console.log('Delete:', id),
  },
}

export const Suggestion: Story = {
  args: {
    feedback: {
      ...baseFeedback,
      id: 'fb-002',
      feedback_type: 'suggestion',
      content: 'Consider adding rate limiting to the API endpoints to prevent abuse.',
    },
    onDismiss: (id) => console.log('Dismiss:', id),
    onDelete: (id) => console.log('Delete:', id),
  },
}

export const Request: Story = {
  args: {
    feedback: {
      ...baseFeedback,
      id: 'fb-003',
      feedback_type: 'request',
      content: 'Need clarification on the error handling behavior when the database connection fails.',
    },
    onDismiss: (id) => console.log('Dismiss:', id),
    onDelete: (id) => console.log('Delete:', id),
  },
}

export const WithLineAnchor: Story = {
  args: {
    feedback: {
      ...baseFeedback,
      id: 'fb-004',
      anchor: JSON.stringify({
        line_number: 42,
        section_heading: null,
        text_snippet: null,
      }),
    },
    onDismiss: (id) => console.log('Dismiss:', id),
  },
}

export const WithSectionAnchor: Story = {
  args: {
    feedback: {
      ...baseFeedback,
      id: 'fb-005',
      anchor: JSON.stringify({
        line_number: null,
        section_heading: 'Authentication Flow',
        text_snippet: null,
      }),
    },
    onDismiss: (id) => console.log('Dismiss:', id),
  },
}

export const Dismissed: Story = {
  args: {
    feedback: {
      ...baseFeedback,
      id: 'fb-006',
      dismissed: true,
    },
    onDismiss: (id) => console.log('Restore:', id),
    onDelete: (id) => console.log('Delete:', id),
  },
}

export const LongContent: Story = {
  args: {
    feedback: {
      ...baseFeedback,
      id: 'fb-007',
      content: `## Implementation Notes

This feedback covers several important points:

1. **Authentication**: The OAuth2 flow implementation is solid
2. **Error Handling**: Consider adding retry logic for transient failures
3. **Performance**: The current approach may have scaling issues

### Code Example

\`\`\`typescript
async function authenticate(token: string) {
  const result = await verifyToken(token);
  if (!result.valid) {
    throw new AuthenticationError('Invalid token');
  }
  return result.user;
}
\`\`\`

> Note: This is just a suggestion, not a blocker.`,
    },
    onDismiss: (id) => console.log('Dismiss:', id),
  },
}

export const Compact: Story = {
  args: {
    feedback: baseFeedback,
    isCompact: true,
    onDismiss: (id) => console.log('Dismiss:', id),
  },
}

export const AllTypes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['comment', 'suggestion', 'request'] as const).map((type) => (
        <FeedbackCard
          key={type}
          feedback={{
            ...baseFeedback,
            id: `fb-${type}`,
            feedback_type: type,
            content: `This is a ${type} feedback example.`,
          }}
          onDismiss={(id) => console.log('Dismiss:', id)}
        />
      ))}
    </div>
  ),
}
