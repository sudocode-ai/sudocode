import { describe, it, expect } from 'vitest'
import {
  RELATIONSHIP_LABELS,
  RELATIONSHIP_COLORS,
  getInverseLabel,
  groupRelationships,
  formatEntityId,
  getEntityTypeIcon,
} from '@/lib/relationships'
import type { Relationship, RelationshipType } from '@/types/api'

describe('relationships utilities', () => {
  describe('RELATIONSHIP_LABELS', () => {
    it('should have labels for all relationship types', () => {
      expect(RELATIONSHIP_LABELS.blocks).toBe('Blocks')
      expect(RELATIONSHIP_LABELS.related).toBe('Related to')
      expect(RELATIONSHIP_LABELS['discovered-from']).toBe('Discovered from')
      expect(RELATIONSHIP_LABELS.implements).toBe('Implements')
      expect(RELATIONSHIP_LABELS.references).toBe('References')
      expect(RELATIONSHIP_LABELS['depends-on']).toBe('Depends on')
    })
  })

  describe('RELATIONSHIP_COLORS', () => {
    it('should have colors for all relationship types', () => {
      expect(RELATIONSHIP_COLORS.blocks).toContain('bg-red')
      expect(RELATIONSHIP_COLORS.related).toContain('bg-blue')
      expect(RELATIONSHIP_COLORS['discovered-from']).toContain('bg-purple')
      expect(RELATIONSHIP_COLORS.implements).toContain('bg-green')
      expect(RELATIONSHIP_COLORS.references).toContain('bg-gray')
      expect(RELATIONSHIP_COLORS['depends-on']).toContain('bg-orange')
    })

    it('should have dark mode variants', () => {
      Object.values(RELATIONSHIP_COLORS).forEach((color) => {
        expect(color).toContain('dark:')
      })
    })
  })

  describe('getInverseLabel', () => {
    it('should return correct inverse label for blocks', () => {
      expect(getInverseLabel('blocks')).toBe('Blocked by')
    })

    it('should return correct inverse label for implements', () => {
      expect(getInverseLabel('implements')).toBe('Implemented by')
    })

    it('should return correct inverse label for depends-on', () => {
      expect(getInverseLabel('depends-on')).toBe('Required by')
    })

    it('should return correct inverse label for discovered-from', () => {
      expect(getInverseLabel('discovered-from')).toBe('Led to discovery of')
    })

    it('should return correct inverse label for references', () => {
      expect(getInverseLabel('references')).toBe('Referenced by')
    })

    it('should return same label for bidirectional relationship', () => {
      expect(getInverseLabel('related')).toBe('Related to')
    })
  })

  describe('groupRelationships', () => {
    const mockRelationships: Relationship[] = [
      {
        from_id: 'ISSUE-001',
        from_type: 'issue',
        to_id: 'SPEC-001',
        to_type: 'spec',
        relationship_type: 'implements' as RelationshipType,
        created_at: '2024-01-01T00:00:00Z',
        metadata: null,
      },
      {
        from_id: 'ISSUE-002',
        from_type: 'issue',
        to_id: 'ISSUE-001',
        to_type: 'issue',
        relationship_type: 'blocks' as RelationshipType,
        created_at: '2024-01-01T00:00:00Z',
        metadata: null,
      },
      {
        from_id: 'ISSUE-001',
        from_type: 'issue',
        to_id: 'ISSUE-003',
        to_type: 'issue',
        relationship_type: 'related' as RelationshipType,
        created_at: '2024-01-01T00:00:00Z',
        metadata: null,
      },
    ]

    it('should group relationships into outgoing and incoming', () => {
      const grouped = groupRelationships(mockRelationships, 'ISSUE-001')

      expect(grouped.outgoing).toHaveLength(2)
      expect(grouped.incoming).toHaveLength(1)
    })

    it('should correctly identify outgoing relationships', () => {
      const grouped = groupRelationships(mockRelationships, 'ISSUE-001')

      expect(grouped.outgoing[0].to_id).toBe('SPEC-001')
      expect(grouped.outgoing[1].to_id).toBe('ISSUE-003')
    })

    it('should correctly identify incoming relationships', () => {
      const grouped = groupRelationships(mockRelationships, 'ISSUE-001')

      expect(grouped.incoming[0].from_id).toBe('ISSUE-002')
    })

    it('should handle empty relationships array', () => {
      const grouped = groupRelationships([], 'ISSUE-001')

      expect(grouped.outgoing).toHaveLength(0)
      expect(grouped.incoming).toHaveLength(0)
    })

    it('should handle entity with no relationships', () => {
      const grouped = groupRelationships(mockRelationships, 'ISSUE-999')

      expect(grouped.outgoing).toHaveLength(0)
      expect(grouped.incoming).toHaveLength(0)
    })

    it('should handle non-array input gracefully', () => {
      // @ts-expect-error testing runtime behavior
      const grouped = groupRelationships(null, 'ISSUE-001')

      expect(grouped.outgoing).toHaveLength(0)
      expect(grouped.incoming).toHaveLength(0)
    })
  })

  describe('formatEntityId', () => {
    it('should return the entity ID unchanged', () => {
      expect(formatEntityId('ISSUE-001', 'issue')).toBe('ISSUE-001')
      expect(formatEntityId('SPEC-042', 'spec')).toBe('SPEC-042')
    })
  })

  describe('getEntityTypeIcon', () => {
    it('should return correct icon for issue', () => {
      expect(getEntityTypeIcon('issue')).toBe('🔧')
    })

    it('should return correct icon for spec', () => {
      expect(getEntityTypeIcon('spec')).toBe('📄')
    })
  })
})
