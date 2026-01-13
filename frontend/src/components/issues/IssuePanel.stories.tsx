import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { IssuePanel } from './IssuePanel'
import type { Issue, IssueFeedback, IssueStatus } from '@/types/api'

const meta: Meta<typeof IssuePanel> = {
  title: 'Issues/IssuePanel',
  component: IssuePanel,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof IssuePanel>

// Helper to create mock issues
const createMockIssue = (
  id: string,
  title: string,
  status: IssueStatus,
  content: string = '',
  options: Partial<Issue> = {}
): Issue => ({
  id,
  uuid: `uuid-${id}`,
  title,
  content,
  status,
  priority: 2,
  created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
  updated_at: new Date().toISOString(),
  archived: false,
  ...options,
})

// Base issue for stories
const baseIssue = createMockIssue(
  'i-abc123',
  'Implement user authentication system',
  'in_progress',
  `## Overview

This issue covers implementing a complete user authentication system.

### Requirements
- OAuth2 integration with Google and GitHub
- JWT token management
- Session persistence
- Password reset flow

### Technical Notes
\`\`\`typescript
interface AuthConfig {
  providers: string[];
  tokenExpiry: number;
  refreshEnabled: boolean;
}
\`\`\`

### Acceptance Criteria
1. Users can sign in with Google
2. Users can sign in with GitHub
3. Sessions persist across browser refreshes
4. Password reset emails are sent successfully`
)

// Mock feedback
const mockFeedback: IssueFeedback[] = [
  {
    id: 'fb-001',
    from_id: 'i-xyz789',
    from_uuid: '123e4567-e89b-12d3-a456-426614174000',
    to_id: 'i-abc123',
    to_uuid: '123e4567-e89b-12d3-a456-426614174001',
    feedback_type: 'comment',
    content: 'Great progress on the OAuth integration! The Google flow is working well.',
    dismissed: false,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'fb-002',
    from_id: 'i-def456',
    from_uuid: '123e4567-e89b-12d3-a456-426614174002',
    to_id: 'i-abc123',
    to_uuid: '123e4567-e89b-12d3-a456-426614174001',
    feedback_type: 'suggestion',
    content: 'Consider adding rate limiting to the password reset endpoint.',
    dismissed: false,
    created_at: new Date(Date.now() - 7200000).toISOString(),
    updated_at: new Date().toISOString(),
  },
]

export const Default: Story = {
  args: {
    issue: baseIssue,
    onUpdate: (data) => console.log('Update:', data),
    onDelete: () => console.log('Delete'),
    onClose: () => console.log('Close'),
  },
}

export const WithFeedback: Story = {
  args: {
    issue: baseIssue,
    feedback: mockFeedback,
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const OpenStatus: Story = {
  args: {
    issue: createMockIssue(
      'i-open1',
      'Add dark mode support to the application',
      'open',
      `## Description

Add dark mode support throughout the application.

### Tasks
- Create theme context
- Add theme toggle component
- Update all color tokens
- Test contrast ratios for accessibility`
    ),
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const BlockedStatus: Story = {
  args: {
    issue: createMockIssue(
      'i-blocked1',
      'Integrate payment gateway',
      'blocked',
      `## Description

Integration with Stripe payment gateway.

**Blocked by:** Waiting for API credentials from finance team.`
    ),
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const ClosedStatus: Story = {
  args: {
    issue: createMockIssue(
      'i-closed1',
      'Fix login button alignment',
      'closed',
      'Fixed the CSS alignment issue on the login button.',
      {
        closed_at: new Date(Date.now() - 86400000).toISOString(),
      }
    ),
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const ArchivedIssue: Story = {
  args: {
    issue: createMockIssue('i-archived1', 'Old feature request', 'closed', 'This feature was deprioritized.', {
      archived: true,
      closed_at: new Date(Date.now() - 604800000).toISOString(), // 1 week ago
    }),
    onUpdate: (data) => console.log('Update:', data),
    onArchive: (id) => console.log('Archive:', id),
    onUnarchive: (id) => console.log('Unarchive:', id),
    onClose: () => console.log('Close'),
  },
}

export const WithParentIssue: Story = {
  args: {
    issue: createMockIssue(
      'i-child1',
      'Implement login form validation',
      'in_progress',
      'Add client-side validation to the login form.',
      {
        parent_id: 'i-parent1',
      }
    ),
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const HighPriority: Story = {
  args: {
    issue: createMockIssue(
      'i-critical1',
      'Security vulnerability in authentication',
      'in_progress',
      '**CRITICAL**: SQL injection vulnerability discovered in login endpoint.',
      {
        priority: 0,
      }
    ),
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const LowPriority: Story = {
  args: {
    issue: createMockIssue(
      'i-low1',
      'Update documentation typos',
      'open',
      'Fix various typos in the README and API documentation.',
      {
        priority: 4,
      }
    ),
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const MinimalContent: Story = {
  args: {
    issue: createMockIssue('i-minimal1', 'Quick fix needed', 'open', ''),
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const HiddenTopControls: Story = {
  args: {
    issue: baseIssue,
    hideTopControls: true,
    onUpdate: (data) => console.log('Update:', data),
  },
}

export const MarkdownViewMode: Story = {
  args: {
    issue: baseIssue,
    viewMode: 'markdown',
    onUpdate: (data) => console.log('Update:', data),
    onClose: () => console.log('Close'),
  },
}

export const Interactive: Story = {
  render: function InteractiveStory() {
    const [issue, setIssue] = useState<Issue>(baseIssue)

    const handleUpdate = (data: Partial<Issue>) => {
      setIssue((prev) => ({ ...prev, ...data, updated_at: new Date().toISOString() }))
      console.log('Updated:', data)
    }

    return (
      <IssuePanel
        issue={issue}
        onUpdate={handleUpdate}
        onClose={() => console.log('Close')}
        onDelete={() => console.log('Delete')}
        onArchive={(id) => console.log('Archive:', id)}
      />
    )
  },
}
