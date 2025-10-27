import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { Badge } from '@/components/ui/badge'
import { FileText, GitBranch } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * EntityMentionComponent - React component for rendering entity mentions
 *
 * Displays entity mentions as interactive badges with:
 * - Icon indicating entity type (GitBranch for issues, FileText for specs)
 * - Color-coded badge (blue for issues, purple for specs)
 * - Link to entity page
 * - Optional display text instead of entity ID
 * - Optional relationship type badge
 *
 * Future enhancements:
 * - Popover with entity details on hover
 * - Run button for executing entities
 * - Real-time status indicators
 * - Agent message display
 */
export function EntityMentionComponent({ node }: NodeViewProps) {
  const { entityId, entityType, displayText, relationshipType } = node.attrs as {
    entityId: string
    entityType: 'issue' | 'spec'
    displayText?: string | null
    relationshipType?: string | null
  }

  const getEntityUrl = () => {
    if (entityType === 'issue') {
      return `/issues/${entityId}`
    }
    return `/specs/${entityId}`
  }

  const getIcon = () => {
    if (entityType === 'issue') {
      return <GitBranch className="h-3 w-3" />
    }
    return <FileText className="h-3 w-3" />
  }

  const getVariant = () => {
    return entityType === 'issue' ? 'issue' : 'spec'
  }

  // Display text takes precedence over entity ID
  const displayContent = displayText || entityId

  return (
    <NodeViewWrapper as="span" className="inline-block">
      <Link to={getEntityUrl()} className="no-underline" contentEditable={false}>
        <Badge variant={getVariant()} className="inline-flex items-center gap-1">
          {getIcon()}
          {displayContent}
        </Badge>
      </Link>
      {relationshipType && (
        <span className="ml-1 text-xs text-muted-foreground" contentEditable={false}>
          {relationshipType}
        </span>
      )}
    </NodeViewWrapper>
  )
}
