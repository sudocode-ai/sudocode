import type { RelationshipType, Relationship, EntityType } from '@/types/api'

/**
 * Relationship type labels for display
 */
export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  blocks: 'Blocks',
  related: 'Related to',
  'discovered-from': 'Discovered from',
  implements: 'Implements',
  references: 'References',
  'depends-on': 'Depends on',
}

/**
 * Relationship type colors (using Tailwind colors)
 */
export const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  blocks: 'bg-red-600 dark:bg-red-700',
  related: 'bg-blue-600 dark:bg-blue-700',
  'discovered-from': 'bg-purple-600 dark:bg-purple-700',
  implements: 'bg-green-600 dark:bg-green-700',
  references: 'bg-gray-600 dark:bg-gray-700',
  'depends-on': 'bg-orange-600 dark:bg-orange-700',
}

/**
 * Get the inverse relationship type for display
 */
export function getInverseLabel(type: RelationshipType): string {
  const inverseLabels: Record<RelationshipType, string> = {
    blocks: 'Blocked by',
    related: 'Related to',
    'discovered-from': 'Led to discovery of',
    implements: 'Implemented by',
    references: 'Referenced by',
    'depends-on': 'Required by',
  }
  return inverseLabels[type]
}

/**
 * Group relationships by direction (outgoing vs incoming)
 */
export interface GroupedRelationships {
  outgoing: Relationship[]
  incoming: Relationship[]
}

export function groupRelationships(
  relationships: Relationship[],
  entityId: string
): GroupedRelationships {
  // Defensive check - ensure relationships is an array
  const relArray = Array.isArray(relationships) ? relationships : []

  return {
    outgoing: relArray.filter((r) => r.from_id === entityId),
    incoming: relArray.filter((r) => r.to_id === entityId),
  }
}

/**
 * Format entity ID for display (e.g., "i-x7k9" or "s-14sh")
 */
export function formatEntityId(id: string, _type: EntityType): string {
  return id
}

/**
 * Get entity type icon
 */
export function getEntityTypeIcon(type: EntityType): string {
  return type === 'issue' ? '🔧' : '📄'
}
