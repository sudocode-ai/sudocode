import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { RelationshipList } from '@/components/relationships/RelationshipList'
import type { Relationship, RelationshipType } from '@/types/api'

describe('RelationshipList', () => {
  const mockRelationships: Relationship[] = [
    {
      from_id: 'ISSUE-001',
      from_uuid: 'uuid-issue-001',
      from_type: 'issue',
      to_id: 'SPEC-001',
      to_uuid: 'uuid-spec-001',
      to_type: 'spec',
      relationship_type: 'implements' as RelationshipType,
      created_at: '2024-01-01T00:00:00Z',
      metadata: undefined,
    },
    {
      from_id: 'ISSUE-002',
      from_uuid: 'uuid-issue-002',
      from_type: 'issue',
      to_id: 'ISSUE-001',
      to_uuid: 'uuid-issue-001',
      to_type: 'issue',
      relationship_type: 'blocks' as RelationshipType,
      created_at: '2024-01-01T00:00:00Z',
      metadata: undefined,
    },
    {
      from_id: 'ISSUE-001',
      from_uuid: 'uuid-issue-001',
      from_type: 'issue',
      to_id: 'ISSUE-003',
      to_uuid: 'uuid-issue-003',
      to_type: 'issue',
      relationship_type: 'related' as RelationshipType,
      created_at: '2024-01-01T00:00:00Z',
      metadata: undefined,
    },
  ]

  describe('empty state', () => {
    it('should show empty message when no relationships and showEmpty is true', () => {
      renderWithProviders(
        <RelationshipList relationships={[]} currentEntityId="ISSUE-001" showEmpty={true} />
      )

      expect(screen.getByText('No relationships yet')).toBeInTheDocument()
    })

    it('should render nothing when no relationships and showEmpty is false', () => {
      const { container } = renderWithProviders(
        <RelationshipList relationships={[]} currentEntityId="ISSUE-001" showEmpty={false} />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('grouping', () => {
    it('should group relationships into outgoing and incoming', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      expect(screen.getByText(/Outgoing \(2\)/)).toBeInTheDocument()
      expect(screen.getByText(/Incoming \(1\)/)).toBeInTheDocument()
    })

    it('should only show outgoing section when no incoming relationships', () => {
      const outgoingOnly: Relationship[] = [
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'SPEC-001',
          to_uuid: 'uuid-spec-001',
          to_type: 'spec',
          relationship_type: 'implements' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
      ]

      renderWithProviders(
        <RelationshipList relationships={outgoingOnly} currentEntityId="ISSUE-001" />
      )

      expect(screen.getByText(/Outgoing \(1\)/)).toBeInTheDocument()
      expect(screen.queryByText(/Incoming/)).not.toBeInTheDocument()
    })

    it('should only show incoming section when no outgoing relationships', () => {
      const incomingOnly: Relationship[] = [
        {
          from_id: 'ISSUE-002',
          from_uuid: 'uuid-issue-002',
          from_type: 'issue',
          to_id: 'ISSUE-001',
          to_uuid: 'uuid-issue-001',
          to_type: 'issue',
          relationship_type: 'blocks' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
      ]

      renderWithProviders(
        <RelationshipList relationships={incomingOnly} currentEntityId="ISSUE-001" />
      )

      expect(screen.getByText(/Incoming \(1\)/)).toBeInTheDocument()
      expect(screen.queryByText(/Outgoing/)).not.toBeInTheDocument()
    })
  })

  describe('relationship rendering', () => {
    it('should render outgoing relationships with correct labels', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      expect(screen.getByText('Implements')).toBeInTheDocument()
      expect(screen.getByText('Related to')).toBeInTheDocument()
    })

    it('should render incoming relationships with inverse labels', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      expect(screen.getByText('Blocked by')).toBeInTheDocument()
    })

    it('should display target entity IDs', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      expect(screen.getByText('ISSUE-003')).toBeInTheDocument()
      expect(screen.getByText('ISSUE-002')).toBeInTheDocument()
    })

    it('should display entity type icons', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      // Check that entities are rendered with their IDs
      expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      expect(screen.getByText('ISSUE-003')).toBeInTheDocument()

      // Check that they're inside badges (links)
      const specLink = screen.getByText('SPEC-001').closest('a')
      expect(specLink).toBeInTheDocument()
      expect(specLink).toHaveAttribute('href', '/specs/SPEC-001')
    })
  })

  describe('navigation', () => {
    it('should render entities as links', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      const specLink = screen.getByText('SPEC-001').closest('a')
      expect(specLink).toBeInTheDocument()
      expect(specLink).toHaveAttribute('href', '/specs/SPEC-001')

      const issueLink = screen.getByText('ISSUE-003').closest('a')
      expect(issueLink).toBeInTheDocument()
      expect(issueLink).toHaveAttribute('href', '/issues/ISSUE-003')
    })

    it('should render entities with proper badges', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      // Entities should be rendered in the DOM
      expect(screen.getByText('SPEC-001')).toBeInTheDocument()
      expect(screen.getByText('ISSUE-003')).toBeInTheDocument()
      expect(screen.getByText('ISSUE-002')).toBeInTheDocument()
    })
  })

  describe('deletion', () => {
    it('should show delete buttons when onDelete is provided', () => {
      const onDelete = vi.fn()

      renderWithProviders(
        <RelationshipList
          relationships={mockRelationships}
          currentEntityId="ISSUE-001"
          onDelete={onDelete}
        />
      )

      const deleteButtons = screen.getAllByTitle('Remove relationship')
      expect(deleteButtons).toHaveLength(3)
    })

    it('should not show delete buttons when onDelete is not provided', () => {
      renderWithProviders(
        <RelationshipList relationships={mockRelationships} currentEntityId="ISSUE-001" />
      )

      const deleteButtons = screen.queryAllByTitle('Remove relationship')
      expect(deleteButtons).toHaveLength(0)
    })

    it('should call onDelete with relationship when delete button is clicked', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()

      renderWithProviders(
        <RelationshipList
          relationships={mockRelationships}
          currentEntityId="ISSUE-001"
          onDelete={onDelete}
        />
      )

      const deleteButtons = screen.getAllByTitle('Remove relationship')
      await user.click(deleteButtons[0])

      expect(onDelete).toHaveBeenCalledWith(mockRelationships[0])
    })
  })

  describe('edge cases', () => {
    it('should handle relationships with all relationship types', () => {
      const allTypes: Relationship[] = [
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'ISSUE-002',
          to_uuid: 'uuid-issue-002',
          to_type: 'issue',
          relationship_type: 'blocks' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'ISSUE-003',
          to_uuid: 'uuid-issue-003',
          to_type: 'issue',
          relationship_type: 'related' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'SPEC-001',
          to_uuid: 'uuid-spec-001',
          to_type: 'spec',
          relationship_type: 'implements' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'SPEC-002',
          to_uuid: 'uuid-spec-002',
          to_type: 'spec',
          relationship_type: 'references' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'ISSUE-004',
          to_uuid: 'uuid-issue-004',
          to_type: 'issue',
          relationship_type: 'depends-on' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'ISSUE-005',
          to_uuid: 'uuid-issue-005',
          to_type: 'issue',
          relationship_type: 'discovered-from' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
      ]

      renderWithProviders(<RelationshipList relationships={allTypes} currentEntityId="ISSUE-001" />)

      expect(screen.getByText('Blocks')).toBeInTheDocument()
      expect(screen.getByText('Related to')).toBeInTheDocument()
      expect(screen.getByText('Implements')).toBeInTheDocument()
      expect(screen.getByText('References')).toBeInTheDocument()
      expect(screen.getByText('Depends on')).toBeInTheDocument()
      expect(screen.getByText('Discovered from')).toBeInTheDocument()
    })

    it('should handle bidirectional relationships correctly', () => {
      const bidirectional: Relationship[] = [
        {
          from_id: 'ISSUE-001',
          from_uuid: 'uuid-issue-001',
          from_type: 'issue',
          to_id: 'ISSUE-002',
          to_uuid: 'uuid-issue-002',
          to_type: 'issue',
          relationship_type: 'related' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
        {
          from_id: 'ISSUE-002',
          from_uuid: 'uuid-issue-002',
          from_type: 'issue',
          to_id: 'ISSUE-001',
          to_uuid: 'uuid-issue-001',
          to_type: 'issue',
          relationship_type: 'related' as RelationshipType,
          created_at: '2024-01-01T00:00:00Z',
          metadata: undefined,
        },
      ]

      renderWithProviders(
        <RelationshipList relationships={bidirectional} currentEntityId="ISSUE-001" />
      )

      // Both should show "Related to" since it's bidirectional
      const relatedLabels = screen.getAllByText('Related to')
      expect(relatedLabels).toHaveLength(2)
    })
  })
})
