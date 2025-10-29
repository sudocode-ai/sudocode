import { ArrowRight, Trash2, GitBranch, FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Relationship, EntityType } from '@/types/api'
import {
  RELATIONSHIP_LABELS,
  RELATIONSHIP_COLORS,
  getInverseLabel,
  groupRelationships,
} from '@/lib/relationships'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface RelationshipListProps {
  relationships: Relationship[]
  currentEntityId: string
  currentEntityType?: EntityType
  onNavigate?: (entityId: string, entityType: EntityType) => void
  onDelete?: (relationship: Relationship) => void
  showEmpty?: boolean
  showGroupHeaders?: boolean
}

export function RelationshipList({
  relationships,
  currentEntityId,
  currentEntityType: _currentEntityType,
  onNavigate: _onNavigate,
  onDelete,
  showEmpty = true,
  showGroupHeaders = true,
}: RelationshipListProps) {
  const grouped = groupRelationships(relationships, currentEntityId)

  if (relationships.length === 0 && showEmpty) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">No relationships yet</div>
    )
  }

  if (relationships.length === 0) {
    return null
  }

  const renderRelationship = (rel: Relationship, direction: 'outgoing' | 'incoming') => {
    const isOutgoing = direction === 'outgoing'
    const targetId = isOutgoing ? rel.to_id : rel.from_id
    const targetType = isOutgoing ? rel.to_type : rel.from_type
    const label = isOutgoing
      ? RELATIONSHIP_LABELS[rel.relationship_type]
      : getInverseLabel(rel.relationship_type)
    const color = RELATIONSHIP_COLORS[rel.relationship_type]

    const getEntityUrl = () => {
      if (targetType === 'issue') {
        return `/issues/${targetId}`
      }
      return `/specs/${targetId}`
    }

    const getIcon = () => {
      if (targetType === 'issue') {
        return <GitBranch className="h-3 w-3" />
      }
      return <FileText className="h-3 w-3" />
    }

    const getBadgeVariant = () => {
      return targetType === 'issue' ? 'issue' : 'spec'
    }

    return (
      <Card
        key={`${rel.from_id}-${rel.to_id}-${rel.relationship_type}`}
        className="group flex items-center gap-2 p-2 transition-colors hover:bg-accent/50"
      >
        {/* Relationship type badge */}
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium text-white ${color}`}>
          {label}
        </span>

        {/* Arrow */}
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />

        {/* Target entity - styled like EntityMention */}
        <Link to={getEntityUrl()} className="min-w-0 flex-1 no-underline">
          <Badge variant={getBadgeVariant()} className="inline-flex items-center gap-1">
            {getIcon()}
            {targetId}
          </Badge>
        </Link>

        {/* Delete button - only visible on hover */}
        {onDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(rel)}
                className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove relationship"
                title="Remove relationship"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove relationship</TooltipContent>
          </Tooltip>
        )}
      </Card>
    )
  }

  // If not showing group headers, combine all relationships into one list
  if (!showGroupHeaders) {
    const allRelationships = [
      ...grouped.outgoing.map((rel) => ({ rel, direction: 'outgoing' as const })),
      ...grouped.incoming.map((rel) => ({ rel, direction: 'incoming' as const })),
    ]

    return (
      <TooltipProvider delayDuration={300}>
        <div className="space-y-2">
          {allRelationships.map(({ rel, direction }) => renderRelationship(rel, direction))}
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        {/* Outgoing relationships */}
        {grouped.outgoing.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">
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
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">
              Incoming ({grouped.incoming.length})
            </h4>
            <div className="space-y-2">
              {grouped.incoming.map((rel) => renderRelationship(rel, 'incoming'))}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
