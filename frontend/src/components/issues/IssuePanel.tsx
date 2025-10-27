import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import type { Issue, Relationship, EntityType, RelationshipType } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IssueEditor } from './IssueEditor'
import { DeleteIssueDialog } from './DeleteIssueDialog'
import { RelationshipList } from '@/components/relationships/RelationshipList'
import { RelationshipForm } from '@/components/relationships/RelationshipForm'
import { relationshipsApi } from '@/lib/api'
import { TiptapMarkdownViewer } from '@/components/specs/TiptapMarkdownViewer'

interface IssuePanelProps {
  issue: Issue
  onClose?: () => void
  onUpdate?: (data: Partial<Issue>) => void
  onDelete?: () => void
  isUpdating?: boolean
  isDeleting?: boolean
}

const priorityLabels: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Medium',
  3: 'Low',
  4: 'None',
}

const statusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  needs_review: 'Needs Review',
  closed: 'Closed',
}

export function IssuePanel({
  issue,
  onClose,
  onUpdate,
  onDelete,
  isUpdating = false,
  isDeleting = false,
}: IssuePanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [showAddRelationship, setShowAddRelationship] = useState(false)
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Fetch relationships when issue changes
  useEffect(() => {
    const fetchRelationships = async () => {
      setIsLoadingRelationships(true)
      try {
        const data = await relationshipsApi.getForEntity(issue.id, 'issue')

        // Handle both array and grouped object responses
        let relationshipsArray: Relationship[] = []
        if (Array.isArray(data)) {
          relationshipsArray = data
        } else if (data && typeof data === 'object' && 'outgoing' in data && 'incoming' in data) {
          // Backend returned grouped object, flatten it
          const grouped = data as { outgoing: Relationship[]; incoming: Relationship[] }
          relationshipsArray = [...(grouped.outgoing || []), ...(grouped.incoming || [])]
        }

        setRelationships(relationshipsArray)
      } catch (error) {
        console.error('Failed to fetch relationships:', error)
        setRelationships([])
      } finally {
        setIsLoadingRelationships(false)
      }
    }

    fetchRelationships()
  }, [issue.id])

  // Handle click outside to close panel
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!panelRef.current || !onClose) return

      const target = event.target as Node

      // Don't close if clicking inside the panel
      if (panelRef.current.contains(target)) return

      // Don't close if clicking on an issue card (to prevent flicker when switching issues)
      const clickedElement = target as HTMLElement
      const issueCard = clickedElement.closest('[data-issue-id]')
      if (issueCard) return

      // Close the panel if clicking outside
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  const handleUpdate = (data: Partial<Issue>) => {
    onUpdate?.(data)
    setIsEditing(false)
  }

  const handleDelete = () => {
    onDelete?.()
    setShowDeleteDialog(false)
  }

  const handleCreateRelationship = async (
    toId: string,
    toType: EntityType,
    relationshipType: RelationshipType
  ) => {
    try {
      const data = await relationshipsApi.create({
        from_id: issue.id,
        from_type: 'issue',
        to_id: toId,
        to_type: toType,
        relationship_type: relationshipType,
      })
      setRelationships([...relationships, data])
      setShowAddRelationship(false)
    } catch (error) {
      console.error('Failed to create relationship:', error)
    }
  }

  const handleDeleteRelationship = async (relationship: Relationship) => {
    try {
      await relationshipsApi.delete({
        from_id: relationship.from_id,
        from_type: relationship.from_type,
        to_id: relationship.to_id,
        to_type: relationship.to_type,
        relationship_type: relationship.relationship_type,
      })
      setRelationships(
        relationships.filter(
          (r) =>
            !(
              r.from_id === relationship.from_id &&
              r.to_id === relationship.to_id &&
              r.relationship_type === relationship.relationship_type
            )
        )
      )
    } catch (error) {
      console.error('Failed to delete relationship:', error)
    }
  }

  if (isEditing) {
    return (
      <div className="h-full overflow-y-auto p-4" ref={panelRef}>
        <Card>
          <CardHeader>
            <CardTitle>Edit Issue</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueEditor
              issue={issue}
              onSave={handleUpdate}
              onCancel={() => setIsEditing(false)}
              isLoading={isUpdating}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4" ref={panelRef}>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle>{issue.title}</CardTitle>
              <div className="mt-2 text-sm text-muted-foreground">{issue.id}</div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 text-sm font-medium text-muted-foreground">Status</div>
              <div className="text-sm">{statusLabels[issue.status] || issue.status}</div>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-muted-foreground">Priority</div>
              <div className="text-sm">{priorityLabels[issue.priority] || issue.priority}</div>
            </div>
          </div>

          {/* Content */}
          {issue.content && (
            <div>
              <div className="mb-2 text-sm font-medium text-muted-foreground">Details</div>
              <Card>
                <TiptapMarkdownViewer content={issue.content} className="p-4" />
              </Card>
            </div>
          )}

          {/* Timestamps */}
          <div className="space-y-2 border-t pt-4">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Created:</span>{' '}
              {new Date(issue.created_at).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Updated:</span>{' '}
              {new Date(issue.updated_at).toLocaleString()}
            </div>
            {issue.closed_at && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Closed:</span>{' '}
                {new Date(issue.closed_at).toLocaleString()}
              </div>
            )}
          </div>

          {/* Assignee */}
          {issue.assignee && (
            <div>
              <div className="mb-1 text-sm font-medium text-muted-foreground">Assignee</div>
              <div className="text-sm">{issue.assignee}</div>
            </div>
          )}

          {/* Parent */}
          {issue.parent_id && (
            <div>
              <div className="mb-1 text-sm font-medium text-muted-foreground">Parent Issue</div>
              <div className="text-sm">{issue.parent_id}</div>
            </div>
          )}

          {/* Relationships */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">
                Relationships {relationships.length > 0 && `(${relationships.length})`}
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddRelationship(!showAddRelationship)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>

            {showAddRelationship && (
              <div className="mb-4">
                <RelationshipForm
                  fromId={issue.id}
                  fromType="issue"
                  onSubmit={handleCreateRelationship}
                  onCancel={() => setShowAddRelationship(false)}
                />
              </div>
            )}

            {isLoadingRelationships ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                Loading relationships...
              </div>
            ) : (
              <RelationshipList
                relationships={relationships}
                currentEntityId={issue.id}
                currentEntityType="issue"
                onDelete={handleDeleteRelationship}
                showEmpty={!showAddRelationship}
              />
            )}
          </div>

          {/* Actions */}
          {(onUpdate || onDelete) && (
            <div className="flex gap-2 border-t pt-4">
              {onUpdate && (
                <Button
                  onClick={() => setIsEditing(true)}
                  variant="default"
                  disabled={isUpdating || isDeleting}
                >
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  onClick={() => setShowDeleteDialog(true)}
                  variant="destructive"
                  disabled={isUpdating || isDeleting}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteIssueDialog
        issue={issue}
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  )
}

export default IssuePanel
