import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import {
  Plus,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Trash2,
  CircleDot,
  Signal,
  GitBranch,
  ExpandIcon,
  FileText,
  Code2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { Issue, Relationship, EntityType, RelationshipType, IssueStatus } from '@/types/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
import { relationshipsApi, executionsApi } from '@/lib/api'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import type { ExecutionConfig, Execution } from '@/types/execution'
import { useRelationshipMutations } from '@/hooks/useRelationshipMutations'
import { TiptapEditor } from '@/components/specs/TiptapEditor'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ActivityTimeline } from './ActivityTimeline'
import type { IssueFeedback } from '@/types/api'

const VIEW_MODE_STORAGE_KEY = 'sudocode:details:viewMode'
const DESCRIPTION_COLLAPSED_STORAGE_KEY = 'sudocode:issue:descriptionCollapsed'

interface IssuePanelProps {
  issue: Issue
  onClose?: () => void
  onUpdate?: (data: Partial<Issue>) => void
  onDelete?: () => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  isUpdating?: boolean
  isDeleting?: boolean
  showOpenDetail?: boolean
  hideTopControls?: boolean
  viewMode?: 'formatted' | 'markdown'
  onViewModeChange?: (mode: 'formatted' | 'markdown') => void
  showViewToggleInline?: boolean
  feedback?: IssueFeedback[]
  onDismissFeedback?: (id: string) => void
  onDeleteFeedback?: (id: string) => void
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
  showOpenDetail = false,
  hideTopControls = false,
  viewMode: externalViewMode,
  onViewModeChange,
  showViewToggleInline = true,
  feedback = [],
  onDismissFeedback,
  onDeleteFeedback,
}: IssuePanelProps) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(issue.title)
  const [content, setContent] = useState(issue.content || '')
  const [status, setStatus] = useState<IssueStatus>(issue.status)
  const [internalViewMode, setInternalViewMode] = useState<'formatted' | 'markdown'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })
  const [isDescriptionCollapsed, setIsDescriptionCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem(DESCRIPTION_COLLAPSED_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : false
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Use external viewMode if provided, otherwise use internal state
  const viewMode = externalViewMode ?? internalViewMode
  const handleViewModeChange = (mode: 'formatted' | 'markdown') => {
    if (onViewModeChange) {
      onViewModeChange(mode)
    } else {
      setInternalViewMode(mode)
    }
  }
  const [priority, setPriority] = useState<number>(issue.priority)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [showAddRelationship, setShowAddRelationship] = useState(false)
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [executions, setExecutions] = useState<Execution[]>([])
  const [isLoadingExecutions, setIsLoadingExecutions] = useState(false)
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

  // Save internal view mode preference to localStorage
  useEffect(() => {
    // Only save if we're using internal view mode (not externally controlled)
    if (!externalViewMode) {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify(internalViewMode))
    }
  }, [internalViewMode, externalViewMode])

  // Save description collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(DESCRIPTION_COLLAPSED_STORAGE_KEY, JSON.stringify(isDescriptionCollapsed))
  }, [isDescriptionCollapsed])

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
    let isMounted = true

    const fetchRelationships = async () => {
      if (!isMounted) return
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

        if (isMounted) {
          setRelationships(relationshipsArray)
        }
      } catch (error) {
        console.error('Failed to fetch relationships:', error)
        if (isMounted) {
          setRelationships([])
        }
      } finally {
        if (isMounted) {
          setIsLoadingRelationships(false)
        }
      }
    }

    fetchRelationships()

    return () => {
      isMounted = false
    }
  }, [issue.id])

  // Fetch executions when issue changes
  useEffect(() => {
    let isMounted = true

    const fetchExecutions = async () => {
      if (!isMounted) return
      setIsLoadingExecutions(true)
      try {
        const data = await executionsApi.list(issue.id)
        if (isMounted) {
          setExecutions(data)
        }
      } catch (error) {
        console.error('Failed to fetch executions:', error)
        if (isMounted) {
          setExecutions([])
        }
      } finally {
        if (isMounted) {
          setIsLoadingExecutions(false)
        }
      }
    }

    fetchExecutions()

    return () => {
      isMounted = false
    }
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
      const isInSelectContent = clickedElement.closest('[data-radix-select-content]')
      const isInSelectViewport = clickedElement.closest('[data-radix-select-viewport]')
      // Check for dialog overlay (the backdrop behind the dialog)
      const isDialogOverlay =
        clickedElement.hasAttribute('data-dialog-overlay') ||
        clickedElement.closest('[data-dialog-overlay]')

      if (
        isInDialog ||
        isInAlertDialog ||
        isInDropdown ||
        isInPopover ||
        isDialogOverlay ||
        isInSelectContent ||
        isInSelectViewport
      )
        return

      // Don't close if clicking on TipTap/ProseMirror elements
      // TipTap can render menus, tooltips, and other UI in portals
      const isInProseMirror = clickedElement.closest('.ProseMirror')
      const isInTiptap = clickedElement.closest('.tiptap-editor')
      const isInTiptapMenu = clickedElement.closest('[data-tippy-root]') // Tippy.js tooltips
      const isInBubbleMenu = clickedElement.closest('.tippy-box') // Bubble menu

      if (isInProseMirror || isInTiptap || isInTiptapMenu || isInBubbleMenu) return

      // Close the panel if clicking outside
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Handle ESC key to close panel
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (!onClose) return

      // Don't close if ESC is pressed while a dialog or dropdown is open
      if (showDeleteDialog || showAddRelationship) return

      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('keydown', handleEscKey)
    }
  }, [onClose, showDeleteDialog, showAddRelationship])

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

  // Auto-resize textarea to fit content in markdown mode
  useEffect(() => {
    if (viewMode === 'markdown' && textareaRef.current) {
      const textarea = textareaRef.current
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [content, viewMode])

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

  const handleStartExecution = async (config: ExecutionConfig, prompt: string) => {
    try {
      const execution = await executionsApi.create(issue.id, {
        config,
        prompt,
      })
      // Navigate to execution view
      navigate(`/executions/${execution.id}`)
    } catch (error) {
      console.error('Failed to create execution:', error)
      // TODO: Show error toast/alert to user
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full flex-col" ref={panelRef}>
        {/* Top Navigation Bar */}
        {!hideTopControls && (
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-4">
              {onClose && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onClose}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Back"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Close (ESC)</TooltipContent>
                </Tooltip>
              )}
              {showOpenDetail && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(`/issues/${issue.id}`)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Open in full page"
                    >
                      <ExpandIcon className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Open in full page</TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-4">
              {/* View mode toggle - shown inline in panel */}
              {showViewToggleInline && (
                <div className="mr-4 flex gap-1 rounded-md border border-border bg-muted/30 p-1">
                  <Button
                    variant={viewMode === 'formatted' ? 'outline' : 'ghost'}
                    size="sm"
                    onClick={() => handleViewModeChange('formatted')}
                    className={`h-7 rounded-sm ${viewMode === 'formatted' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Formatted
                  </Button>
                  <Button
                    variant={viewMode === 'markdown' ? 'outline' : 'ghost'}
                    size="sm"
                    onClick={() => handleViewModeChange('markdown')}
                    className={`h-7 rounded-sm ${viewMode === 'markdown' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    <Code2 className="mr-2 h-4 w-4" />
                    Markdown
                  </Button>
                </div>
              )}
              {(onArchive || onUnarchive) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() =>
                        issue.archived ? onUnarchive?.(issue.id) : onArchive?.(issue.id)
                      }
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={issue.archived ? 'Unarchive' : 'Archive'}
                      disabled={isUpdating}
                    >
                      {issue.archived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{issue.archived ? 'Unarchive' : 'Archive'}</TooltipContent>
                </Tooltip>
              )}
              {onDelete && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowDeleteDialog(true)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete"
                      disabled={isUpdating || isDeleting}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete issue</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className={`flex-1 w-full overflow-y-auto ${hideTopControls ? 'py-4' : 'py-3'}`}>
          <div className="mx-auto w-full max-w-7xl space-y-4 px-6">
            {/* Issue ID and Title */}
            <div className="space-y-2 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="issue" className="font-mono">
                    {issue.id}
                  </Badge>
                  {issue.parent_id && (
                    <>
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Parent: </span>
                      <button onClick={() => navigate(`/issues/${issue.parent_id}`)}>
                        <Badge variant="issue" className="cursor-pointer hover:opacity-80">
                          {issue.parent_id}
                        </Badge>
                      </button>
                    </>
                  )}
                </div>
                {onUpdate && (
                  <div className="text-xs italic text-muted-foreground">
                    {isUpdating
                      ? 'Saving...'
                      : hasChanges
                        ? 'Unsaved changes...'
                        : 'All changes saved'}
                  </div>
                )}
              </div>
              <Input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Issue title..."
                disabled={isUpdating}
                className="border-none bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
              />
            </div>

            {/* Metadata Row */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Status */}
              <div className="flex items-center gap-2">
                <CircleDot className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={status}
                  onValueChange={(value) => handleStatusChange(value as IssueStatus)}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="h-8 w-auto gap-3 rounded-md border-none bg-accent px-3 shadow-none hover:bg-accent/80">
                    <SelectValue placeholder="Status" />
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

              {/* Priority */}
              <div className="flex items-center gap-2">
                <Signal className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={String(priority)}
                  onValueChange={(value) => handlePriorityChange(parseInt(value))}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="h-8 w-auto gap-3 rounded-md border-none bg-accent px-3 shadow-none hover:bg-accent/80">
                    <SelectValue placeholder="Priority" />
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

              {/* Timestamp */}
              <div className="ml-auto text-xs text-muted-foreground">
                {issue.closed_at
                  ? `Closed ${formatDistanceToNow(new Date(issue.closed_at.endsWith('Z') ? issue.closed_at : issue.closed_at + 'Z'), { addSuffix: true })}`
                  : `Updated ${formatDistanceToNow(new Date(issue.updated_at.endsWith('Z') ? issue.updated_at : issue.updated_at + 'Z'), { addSuffix: true })}`}
              </div>
            </div>

            {/* Relationships */}
            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <h3 className="text-sm font-medium text-muted-foreground">Relationships</h3>
                  <Badge variant="secondary">{relationships.length}</Badge>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setShowAddRelationship(!showAddRelationship)}
                  className="h-6"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>

              {/* Add Relationship Form */}
              {showAddRelationship && (
                <div className="rounded-lg border p-4">
                  <RelationshipForm
                    fromId={issue.id}
                    fromType="issue"
                    onSubmit={handleCreateRelationship}
                    onCancel={() => setShowAddRelationship(false)}
                  />
                </div>
              )}

              {/* Relationship List */}
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
                  showEmpty={false}
                  showGroupHeaders={false}
                />
              )}
            </div>

            {/* Content Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setIsDescriptionCollapsed(!isDescriptionCollapsed)}
                  className="h-6 gap-1 text-muted-foreground"
                >
                  {isDescriptionCollapsed ? (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Expand
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Collapse
                    </>
                  )}
                </Button>
              </div>
              <div className="relative">
                <div
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    isDescriptionCollapsed ? 'max-h-[200px] cursor-pointer 2xl:max-h-[300px]' : ''
                  }`}
                  onClick={() => {
                    if (isDescriptionCollapsed) {
                      setIsDescriptionCollapsed(false)
                    }
                  }}
                >
                  <Card className="overflow-hidden rounded-md border">
                    {viewMode === 'formatted' ? (
                      <TiptapEditor
                        content={content}
                        editable={!isDescriptionCollapsed}
                        onChange={handleContentChange}
                        onCancel={() => {
                          setContent(issue.content || '')
                          setHasChanges(false)
                        }}
                        className="min-h-[200px]"
                        placeholder="Issue description..."
                      />
                    ) : (
                      <div className="p-4">
                        <textarea
                          ref={textareaRef}
                          value={content}
                          onChange={(e) => handleContentChange(e.target.value)}
                          placeholder="Issue description in markdown..."
                          className="w-full resize-none border-none bg-transparent font-mono text-sm leading-6 outline-none focus:ring-0"
                          spellCheck={false}
                          disabled={isDescriptionCollapsed}
                          style={{ minHeight: '200px' }}
                        />
                      </div>
                    )}
                  </Card>
                </div>
                {isDescriptionCollapsed && (
                  <>
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent" />
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsDescriptionCollapsed(false)
                        }}
                        className="gap-1 shadow-sm"
                      >
                        <ChevronDown className="h-4 w-4" />
                        Expand
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Additional Metadata */}
            {issue.assignee && (
              <div className="border-t pt-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Assignee: </span>
                  <span>{issue.assignee}</span>
                </div>
              </div>
            )}

            {/* Activity Timeline */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Activity</h3>
              {isLoadingExecutions ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Loading activity...
                </div>
              ) : (
                <ActivityTimeline
                  items={[
                    ...feedback.map((f) => ({ ...f, itemType: 'feedback' as const })),
                    ...executions.map((e) => ({ ...e, itemType: 'execution' as const })),
                  ]}
                  onDismissFeedback={onDismissFeedback}
                  onDeleteFeedback={onDeleteFeedback}
                />
              )}
            </div>
          </div>
        </div>

        {/* Fixed Footer - Agent Configuration Panel */}
        <AgentConfigPanel
          issueId={issue.id}
          onStart={handleStartExecution}
          disabled={issue.archived || isUpdating}
        />

        <DeleteIssueDialog
          issue={issue}
          isOpen={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      </div>
    </TooltipProvider>
  )
}

export default IssuePanel
