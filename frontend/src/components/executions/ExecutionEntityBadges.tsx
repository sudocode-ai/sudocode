/**
 * ExecutionEntityBadges Component
 *
 * Displays entity operations from an execution in categorized sections:
 * - Updated Documents (upsert operations)
 * - Linked Documents (relationship operations)
 * - Read Documents (show/read operations)
 * - List Operations (collapsed by default)
 */

import { Pencil, Link as LinkIcon, Eye, List, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { EntityBadge } from '@/components/entities/EntityBadge'
import { RELATIONSHIP_LABELS } from '@/lib/relationships'
import type { UseExecutionEntityOperationsReturn } from '@/hooks/useExecutionEntityOperations'

export interface ExecutionEntityBadgesProps {
  operations: UseExecutionEntityOperationsReturn
}

export function ExecutionEntityBadges({ operations }: ExecutionEntityBadgesProps) {
  const { updated, linked, read, listOperations } = operations

  // Don't render if all sections are empty
  if (
    updated.length === 0 &&
    linked.length === 0 &&
    read.length === 0 &&
    listOperations.length === 0
  ) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Entity Operations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Updated Documents Section */}
        {updated.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 mb-2 text-sm font-medium">
              <Pencil className="h-4 w-4" />
              Updated Documents
            </h4>
            <div className="flex flex-wrap gap-2">
              {updated.map((op) => (
                <EntityBadge
                  key={op.toolCallId}
                  entityId={op.entityId}
                  entityType={op.entityType}
                  showHoverCard={true}
                  linkToEntity={true}
                  showTitle={true}
                />
              ))}
            </div>
          </div>
        )}

        {/* Linked Documents Section */}
        {linked.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 mb-2 text-sm font-medium">
              <LinkIcon className="h-4 w-4" />
              Linked Documents
            </h4>
            <div className="flex flex-wrap gap-2">
              {linked.map((op) => {
                if (!op.linkTarget) return null

                const relationshipLabel =
                  RELATIONSHIP_LABELS[op.linkTarget.relationshipType] ||
                  op.linkTarget.relationshipType

                return (
                  <div key={op.toolCallId} className="flex items-center gap-2">
                    <EntityBadge
                      entityId={op.entityId}
                      entityType={op.entityType}
                      showHoverCard={true}
                      linkToEntity={true}
                      showTitle={true}
                    />
                    <span className="text-xs text-muted-foreground">{relationshipLabel}</span>
                    <EntityBadge
                      entityId={op.linkTarget.entityId}
                      entityType={op.linkTarget.entityType}
                      showHoverCard={true}
                      linkToEntity={true}
                      showTitle={true}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Read Documents Section */}
        {read.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 mb-2 text-sm font-medium">
              <Eye className="h-4 w-4" />
              Read Documents
            </h4>
            <div className="flex flex-wrap gap-2">
              {read.map((op) => (
                <EntityBadge
                  key={op.toolCallId}
                  entityId={op.entityId}
                  entityType={op.entityType}
                  showHoverCard={true}
                  linkToEntity={true}
                  showTitle={true}
                />
              ))}
            </div>
          </div>
        )}

        {/* List Operations Section (Collapsible) */}
        {listOperations.length > 0 && (
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline">
              <List className="h-4 w-4" />
              List Operations ({listOperations.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="flex flex-wrap gap-2">
                {listOperations.map((op) => (
                  <div
                    key={op.toolCallId}
                    className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded"
                  >
                    List {op.entityType}s (
                    {new Date(op.timestamp).toLocaleTimeString()})
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
