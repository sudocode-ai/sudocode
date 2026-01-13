import type { Meta, StoryObj } from '@storybook/react'
import { RelationshipList } from './RelationshipList'
import type { Relationship } from '@/types/api'

const meta: Meta<typeof RelationshipList> = {
  title: 'Relationships/RelationshipList',
  component: RelationshipList,
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
type Story = StoryObj<typeof RelationshipList>

const mockRelationships: Relationship[] = [
  {
    from_id: 'i-abc123',
    from_uuid: '123e4567-e89b-12d3-a456-426614174001',
    from_type: 'issue',
    to_id: 's-xyz789',
    to_uuid: '123e4567-e89b-12d3-a456-426614174002',
    to_type: 'spec',
    relationship_type: 'implements',
    created_at: new Date().toISOString(),
  },
  {
    from_id: 'i-abc123',
    from_uuid: '123e4567-e89b-12d3-a456-426614174003',
    from_type: 'issue',
    to_id: 'i-def456',
    to_uuid: '123e4567-e89b-12d3-a456-426614174004',
    to_type: 'issue',
    relationship_type: 'blocks',
    created_at: new Date().toISOString(),
  },
  {
    from_id: 'i-ghi789',
    from_uuid: '123e4567-e89b-12d3-a456-426614174005',
    from_type: 'issue',
    to_id: 'i-abc123',
    to_uuid: '123e4567-e89b-12d3-a456-426614174006',
    to_type: 'issue',
    relationship_type: 'depends-on',
    created_at: new Date().toISOString(),
  },
  {
    from_id: 'i-abc123',
    from_uuid: '123e4567-e89b-12d3-a456-426614174007',
    from_type: 'issue',
    to_id: 's-ref001',
    to_uuid: '123e4567-e89b-12d3-a456-426614174008',
    to_type: 'spec',
    relationship_type: 'references',
    created_at: new Date().toISOString(),
  },
]

export const Default: Story = {
  args: {
    relationships: mockRelationships,
    currentEntityId: 'i-abc123',
    onDelete: (rel) => console.log('Delete:', rel),
  },
}

export const OutgoingOnly: Story = {
  args: {
    relationships: mockRelationships.filter((r) => r.from_id === 'i-abc123'),
    currentEntityId: 'i-abc123',
    onDelete: (rel) => console.log('Delete:', rel),
  },
}

export const IncomingOnly: Story = {
  args: {
    relationships: mockRelationships.filter((r) => r.to_id === 'i-abc123'),
    currentEntityId: 'i-abc123',
    onDelete: (rel) => console.log('Delete:', rel),
  },
}

export const Empty: Story = {
  args: {
    relationships: [],
    currentEntityId: 'i-abc123',
    showEmpty: true,
  },
}

export const EmptyHidden: Story = {
  args: {
    relationships: [],
    currentEntityId: 'i-abc123',
    showEmpty: false,
  },
}

export const WithoutGroupHeaders: Story = {
  args: {
    relationships: mockRelationships,
    currentEntityId: 'i-abc123',
    showGroupHeaders: false,
    onDelete: (rel) => console.log('Delete:', rel),
  },
}

export const ReadOnly: Story = {
  args: {
    relationships: mockRelationships,
    currentEntityId: 'i-abc123',
    // No onDelete means read-only
  },
}

export const AllRelationshipTypes: Story = {
  args: {
    relationships: [
      {
        from_id: 'i-current',
        from_uuid: '123e4567-e89b-12d3-a456-426614174010',
        from_type: 'issue',
        to_id: 'i-target1',
        to_uuid: '123e4567-e89b-12d3-a456-426614174011',
        to_type: 'issue',
        relationship_type: 'blocks',
        created_at: new Date().toISOString(),
      },
      {
        from_id: 'i-current',
        from_uuid: '123e4567-e89b-12d3-a456-426614174012',
        from_type: 'issue',
        to_id: 's-target2',
        to_uuid: '123e4567-e89b-12d3-a456-426614174013',
        to_type: 'spec',
        relationship_type: 'implements',
        created_at: new Date().toISOString(),
      },
      {
        from_id: 'i-current',
        from_uuid: '123e4567-e89b-12d3-a456-426614174014',
        from_type: 'issue',
        to_id: 'i-target3',
        to_uuid: '123e4567-e89b-12d3-a456-426614174015',
        to_type: 'issue',
        relationship_type: 'depends-on',
        created_at: new Date().toISOString(),
      },
      {
        from_id: 'i-current',
        from_uuid: '123e4567-e89b-12d3-a456-426614174016',
        from_type: 'issue',
        to_id: 's-target4',
        to_uuid: '123e4567-e89b-12d3-a456-426614174017',
        to_type: 'spec',
        relationship_type: 'references',
        created_at: new Date().toISOString(),
      },
      {
        from_id: 'i-current',
        from_uuid: '123e4567-e89b-12d3-a456-426614174018',
        from_type: 'issue',
        to_id: 'i-target5',
        to_uuid: '123e4567-e89b-12d3-a456-426614174019',
        to_type: 'issue',
        relationship_type: 'discovered-from',
        created_at: new Date().toISOString(),
      },
      {
        from_id: 'i-current',
        from_uuid: '123e4567-e89b-12d3-a456-426614174020',
        from_type: 'issue',
        to_id: 'i-target6',
        to_uuid: '123e4567-e89b-12d3-a456-426614174021',
        to_type: 'issue',
        relationship_type: 'related',
        created_at: new Date().toISOString(),
      },
    ],
    currentEntityId: 'i-current',
    onDelete: (rel) => console.log('Delete:', rel),
  },
}
