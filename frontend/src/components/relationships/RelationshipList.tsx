import { ArrowRight, Trash2 } from 'lucide-react'
import type { Relationship, EntityType } from '@/types/api'
import {
  RELATIONSHIP_LABELS,
  RELATIONSHIP_COLORS,
  getInverseLabel,
  groupRelationships,
  getEntityTypeIcon,
} from '@/lib/relationships'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface RelationshipListProps {
  relationships: Relationship[]
  currentEntityId: string
  currentEntityType?: EntityType
  onNavigate?: (entityId: string, entityType: EntityType) => void
  onDelete?: (relationship: Relationship) => void
  showEmpty?: boolean
}

export function RelationshipList({
  relationships,
  currentEntityId,
  currentEntityType: _currentEntityType,
  onNavigate,
  onDelete,
  showEmpty = true,
}: RelationshipListProps) {
  const grouped = groupRelationships(relationships, currentEntityId)

  if (relationships.length === 0 && showEmpty) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        No relationships yet
      </div>
    )
  }

  if (relationships.length === 0) {
    return null
  }

  const renderRelationship = (rel: Relationship, direction: 'outgoing' | 'incoming') => {
    const isOutgoing = direction === 'outgoing'
    const targetId = isOutgoing ? rel.to_id : rel.from_id
    const targetType = isOutgoing ? rel.to_type : rel.from_type
    const label = isOutgoing ? RELATIONSHIP_LABELS[rel.relationship_type] : getInverseLabel(rel.relationship_type)
    const color = RELATIONSHIP_COLORS[rel.relationship_type]

    return (
      <Card
        key={`${rel.from_id}-${rel.to_id}-${rel.relationship_type}`}
        className="p-3 flex items-center gap-2 hover:bg-accent/50 transition-colors"
      >
        {/* Relationship type badge */}
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs text-white font-medium ${color}`}>
          {label}
        </span>

        {/* Arrow */}
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Target entity */}
        <button
          onClick={() => onNavigate?.(targetId, targetType)}
          className="flex-1 text-left text-sm hover:underline min-w-0"
          disabled={!onNavigate}
        >
          <span className="mr-1">{getEntityTypeIcon(targetType)}</span>
          <span className="font-mono text-primary">{targetId}</span>
        </button>

        {/* Delete button */}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(rel)}
            className="h-6 w-6 p-0 shrink-0"
            title="Remove relationship"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Outgoing relationships */}
      {grouped.outgoing.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">
            Outgoing ({grouped.outgoing.length})
          </h4>
          <div className="space-y-2">
            {grouped.outgoing.map((rel) => renderRelationship(rel, 'outgoing'))}
          </div>
        </div>
      )}

      {/* Incoming relationships */}
      {grouped.incoming.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">
            Incoming ({grouped.incoming.length})
          </h4>
          <div className="space-y-2">
            {grouped.incoming.map((rel) => renderRelationship(rel, 'incoming'))}
          </div>
        </div>
      )}
    </div>
  )
}
