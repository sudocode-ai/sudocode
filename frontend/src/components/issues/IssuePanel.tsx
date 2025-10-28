import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Archive, ArchiveRestore, ExternalLink } from 'lucide-react'
import type { Issue, Relationship, EntityType, RelationshipType, IssueStatus } from '@/types/api'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DeleteIssueDialog } from './DeleteIssueDialog'
import { RelationshipList } from '@/components/relationships/RelationshipList'
import { RelationshipForm } from '@/components/relationships/RelationshipForm'
import { relationshipsApi } from '@/lib/api'
import { useRelationshipMutations } from '@/hooks/useRelationshipMutations'
import { TiptapEditor } from '@/components/specs/TiptapEditor'

interface IssuePanelProps {
  issue: Issue
  onClose?: () => void
  onUpdate?: (data: Partial<Issue>) => void
  onDelete?: () => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  isUpdating?: boolean
  isDeleting?: boolean
}

const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'closed', label: 'Closed' },
]

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Critical (P0)' },
  { value: '1', label: 'High (P1)' },
  { value: '2', label: 'Medium (P2)' },
  { value: '3', label: 'Low (P3)' },
  { value: '4', label: 'None (P4)' },
]

export function IssuePanel({
  issue,
  onClose,
  onUpdate,
  onDelete,
  onArchive,
  onUnarchive,
  isUpdating = false,
  isDeleting = false,
}: IssuePanelProps) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(issue.title)
  const [content, setContent] = useState(issue.content || '')
  const [status, setStatus] = useState<IssueStatus>(issue.status)
  const [priority, setPriority] = useState<number>(issue.priority)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [showAddRelationship, setShowAddRelationship] = useState(false)
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Relationship mutations with cache invalidation
  const { createRelationshipAsync, deleteRelationshipAsync } = useRelationshipMutations()
  const onUpdateRef = useRef(onUpdate)
  const latestValuesRef = useRef({ title, content, status, priority, hasChanges })

  // Keep refs in sync with latest values
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  useEffect(() => {
    latestValuesRef.current = { title, content, status, priority, hasChanges }
  }, [title, content, status, priority, hasChanges])

  // Reset state when switching to a different issue (issue.id changes)
  useEffect(() => {
    // Clear auto-save timer when switching issues
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    // Reset hasChanges to prevent saving old content to new issue
    setHasChanges(false)
  }, [issue.id])

  // Update form values when issue changes
  useEffect(() => {
    setTitle(issue.title)
    setContent(issue.content || '')
    setStatus(issue.status)
    setPriority(issue.priority)
    setHasChanges(false)
  }, [issue])

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

      // Don't close if clicking on the resize handle
      const resizeHandle = clickedElement.closest('[data-panel-resize-handle-id]')
      if (resizeHandle) return

      // Also check for resize handle by class (backup check)
      if (clickedElement.classList?.contains('cursor-col-resize')) return

      // Don't close if clicking on a portal element (dialogs, dropdowns, etc.)
      // Radix UI (which shadcn/ui is built on) renders portals with specific attributes
      const isInDialog = clickedElement.closest('[role="dialog"]')
      const isInAlertDialog = clickedElement.closest('[role="alertdialog"]')
      const isInDropdown = clickedElement.closest('[role="listbox"]')
      const isInPopover = clickedElement.closest('[data-radix-popper-content-wrapper]')

      if (isInDialog || isInAlertDialog || isInDropdown || isInPopover) return

      // Close the panel if clicking outside
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Auto-save effect with debounce
  useEffect(() => {
    if (!hasChanges || !onUpdateRef.current) return

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Set new timer for auto-save after 1 second of inactivity
    autoSaveTimerRef.current = setTimeout(() => {
      onUpdateRef.current?.({
        title,
        content,
        status,
        priority,
      })
      setHasChanges(false)
    }, 1000)

    // Cleanup timer on unmount or when dependencies change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [title, content, status, priority, hasChanges])

  // Save pending changes on unmount
  useEffect(() => {
    return () => {
      // On unmount, if there are unsaved changes, save them immediately
      const { hasChanges, title, content, status, priority } = latestValuesRef.current
      if (hasChanges && onUpdateRef.current) {
        onUpdateRef.current({
          title,
          content,
          status,
          priority,
        })
      }
    }
  }, [])

  const handleTitleChange = (value: string) => {
    setTitle(value)
    setHasChanges(true)
  }

  const handleContentChange = (value: string) => {
    setContent(value)
    setHasChanges(true)
  }

  const handleStatusChange = (value: IssueStatus) => {
    setStatus(value)
    setHasChanges(true)
  }

  const handlePriorityChange = (value: number) => {
    setPriority(value)
    setHasChanges(true)
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
      const data = await createRelationshipAsync({
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
      await deleteRelationshipAsync({
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

  return (
    <div className="h-full overflow-y-auto p-4" ref={panelRef}>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1 text-sm text-muted-foreground">{issue.id}</div>
            <div className="flex items-center gap-4">
              {onClose && (
                <button
                  onClick={() => navigate(`/issues/${issue.id}`)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Open in full page"
                  title="Open in full page"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              )}
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
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Enter issue title..."
              disabled={isUpdating}
            />
          </div>

          {/* Status and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => handleStatusChange(value as IssueStatus)}
                disabled={isUpdating}
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={String(priority)}
                onValueChange={(value) => handlePriorityChange(parseInt(value))}
                disabled={isUpdating}
              >
                <SelectTrigger id="priority">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="content">Details</Label>
            <Card className="overflow-hidden">
              <TiptapEditor
                content={content}
                editable={true}
                onChange={handleContentChange}
                onCancel={() => {
                  setContent(issue.content || '')
                  setHasChanges(false)
                }}
                className="min-h-[200px]"
              />
            </Card>
          </div>

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
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">
                Relationships {relationships.length > 0 && `(${relationships.length})`}
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddRelationship(!showAddRelationship)}
              >
                <Plus className="mr-1 h-4 w-4" />
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
              <div className="py-4 text-center text-sm text-muted-foreground">
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
          <div className="flex items-center justify-between border-t pt-4">
            {onUpdate && (
              <div className="text-sm text-muted-foreground">
                {isUpdating ? 'Saving...' : hasChanges ? 'Unsaved changes...' : 'All changes saved'}
              </div>
            )}
            <div className="ml-auto flex gap-2">
              {(onArchive || onUnarchive) &&
                (issue.archived ? (
                  <Button
                    onClick={() => onUnarchive?.(issue.id)}
                    variant="outline"
                    disabled={isUpdating}
                  >
                    <ArchiveRestore className="mr-2 h-4 w-4" />
                    Unarchive
                  </Button>
                ) : (
                  <Button
                    onClick={() => onArchive?.(issue.id)}
                    variant="outline"
                    disabled={isUpdating}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    Archive
                  </Button>
                ))}
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
          </div>
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
