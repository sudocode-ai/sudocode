import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { useSpec, useSpecFeedback, useSpecs } from '@/hooks/useSpecs'
import { useIssues } from '@/hooks/useIssues'
import { useFeedback } from '@/hooks/useFeedback'
import { SpecViewerTiptap } from '@/components/specs/SpecViewerTiptap'
import { AlignedFeedbackPanel } from '@/components/specs/AlignedFeedbackPanel'
import { AddFeedbackDialog } from '@/components/specs/AddFeedbackDialog'
import { useFeedbackPositions } from '@/hooks/useFeedbackPositions'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  MessageSquare,
  MessageSquareOff,
  MessageSquarePlus,
  Archive,
  ArchiveRestore,
  Signal,
  FileText,
  Code2,
} from 'lucide-react'
import type { IssueFeedback, Relationship, EntityType, RelationshipType } from '@/types/api'
import { relationshipsApi } from '@/lib/api'

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Critical (P0)' },
  { value: '1', label: 'High (P1)' },
  { value: '2', label: 'Medium (P2)' },
  { value: '3', label: 'Low (P3)' },
  { value: '4', label: 'None (P4)' },
]

const SHOW_FEEDBACK_STORAGE_KEY = 'sudocode:specs:showFeedbackPanel'
const VIEW_MODE_STORAGE_KEY = 'sudocode:details:viewMode'

export default function SpecDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { spec, isLoading, isError } = useSpec(id || '')
  const { feedback } = useSpecFeedback(id || '')
  const { issues } = useIssues()
  const { updateSpec, isUpdating, archiveSpec, unarchiveSpec } = useSpecs()
  const { createFeedback, updateFeedback, deleteFeedback } = useFeedback(id || '')

  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [_selectedText, setSelectedText] = useState<string | null>(null) // Reserved for future text selection feature
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(() => {
    const stored = localStorage.getItem(SHOW_FEEDBACK_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : true
  })
  const [viewMode, setViewMode] = useState<'formatted' | 'source'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })

  // Local state for editable fields
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState<number>(2)
  const [hasChanges, setHasChanges] = useState(false)

  // Relationships state
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [_isLoadingRelationships, setIsLoadingRelationships] = useState(false)

  // Refs for auto-save and position tracking
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const updateSpecRef = useRef(updateSpec)
  const latestValuesRef = useRef({ title, content, priority, hasChanges })
  const currentIdRef = useRef(id)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Track feedback positions for aligned panel
  const feedbackPositions = useFeedbackPositions(feedback, editorContainerRef)

  // Keep refs in sync with latest values
  useEffect(() => {
    updateSpecRef.current = updateSpec
  }, [updateSpec])

  useEffect(() => {
    latestValuesRef.current = { title, content, priority, hasChanges }
  }, [title, content, priority, hasChanges])

  useEffect(() => {
    currentIdRef.current = id
  }, [id])

  // Reset state when navigating to a different spec (id changes)
  useEffect(() => {
    // Clear auto-save timer when switching specs
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    // Reset hasChanges to prevent saving old content to new spec
    setHasChanges(false)
  }, [id])

  // Update form values when spec changes
  useEffect(() => {
    if (spec) {
      setTitle(spec.title)
      setContent(spec.content || '')
      setPriority(spec.priority ?? 2)
      setHasChanges(false)
    }
  }, [spec])

  // Fetch relationships when spec ID changes
  useEffect(() => {
    const fetchRelationships = async () => {
      if (!id) return

      setIsLoadingRelationships(true)
      try {
        const data = await relationshipsApi.getForEntity(id, 'spec')
        // Handle both array and grouped object responses
        let relationshipsArray: Relationship[] = []
        if (Array.isArray(data)) {
          relationshipsArray = data
        } else if (data && typeof data === 'object' && 'outgoing' in data && 'incoming' in data) {
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
  }, [id])

  // Auto-save effect with debounce
  useEffect(() => {
    if (!hasChanges || !id) return

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Set new timer for auto-save after 1 second of inactivity
    autoSaveTimerRef.current = setTimeout(() => {
      updateSpecRef.current({
        id,
        data: {
          title,
          content,
          priority,
        },
      })
      setHasChanges(false)
    }, 1000)

    // Cleanup timer on unmount or when dependencies change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [title, content, priority, hasChanges])

  // Save pending changes on unmount
  useEffect(() => {
    return () => {
      // On unmount, if there are unsaved changes, save them immediately
      const { hasChanges, title, content, priority } = latestValuesRef.current
      const currentId = currentIdRef.current
      if (hasChanges && currentId && updateSpecRef.current) {
        updateSpecRef.current({
          id: currentId,
          data: {
            title,
            content,
            priority,
          },
        })
      }
    }
  }, [])

  // Save feedback panel preference to localStorage
  useEffect(() => {
    localStorage.setItem(SHOW_FEEDBACK_STORAGE_KEY, JSON.stringify(showFeedbackPanel))
  }, [showFeedbackPanel])

  // Save view mode preference to localStorage
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify(viewMode))
  }, [viewMode])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-muted-foreground">Loading spec...</p>
        </div>
      </div>
    )
  }

  if (isError || !spec) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <h2 className="mb-2 text-2xl font-bold">Spec not found</h2>
          <p className="mb-4 text-muted-foreground">
            The spec you're looking for doesn't exist or has been deleted.
          </p>
          <Button onClick={() => navigate('/specs')}>Back to Specs</Button>
        </div>
      </div>
    )
  }

  const handleLineClick = (lineNumber: number) => {
    setSelectedLine(lineNumber)
    setSelectedText(null) // Clear text selection when clicking line
    setShowFeedbackPanel(true)
  }

  const handleTextSelect = (text: string, lineNumber: number) => {
    setSelectedText(text)
    setSelectedLine(lineNumber)
    setShowFeedbackPanel(true)
    // TODO: Future enhancement - use selectedText for pre-filling feedback with context
  }

  const handleFeedbackClick = (fb: IssueFeedback) => {
    // Navigate to the line where this feedback is anchored
    try {
      const anchor = fb.anchor ? JSON.parse(fb.anchor) : null
      if (anchor?.line_number) {
        setSelectedLine(anchor.line_number)
      }
    } catch (error) {
      console.error('Failed to parse feedback anchor:', error)
    }
  }

  const handleTitleChange = (value: string) => {
    setTitle(value)
    setHasChanges(true)
  }

  const handleContentChange = (markdown: string) => {
    setContent(markdown)
    setHasChanges(true)
  }

  const handlePriorityChange = (value: number) => {
    setPriority(value)
    setHasChanges(true)
  }

  const handleFeedbackDismiss = (feedbackId: string) => {
    const fb = feedback.find((f) => f.id === feedbackId)
    if (fb) {
      updateFeedback({
        id: feedbackId,
        data: { dismissed: !fb.dismissed },
      })
    }
  }

  const handleFeedbackDelete = (feedbackId: string) => {
    deleteFeedback(feedbackId)
  }

  const handleCreateFeedback = async (data: {
    issueId: string
    type: any
    content: string
    anchor?: any
  }) => {
    if (!id) {
      console.error('Cannot create feedback without spec ID')
      return
    }

    await createFeedback({
      spec_id: id,
      issue_id: data.issueId,
      feedback_type: data.type,
      content: data.content,
      anchor: data.anchor,
    })
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

      // Optimistically update local state
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

  const handleCreateRelationship = async (
    toId: string,
    toType: EntityType,
    relationshipType: RelationshipType
  ) => {
    if (!id) return

    try {
      const newRelationship = await relationshipsApi.create({
        from_id: id,
        from_type: 'spec',
        to_id: toId,
        to_type: toType,
        relationship_type: relationshipType,
      })

      // Optimistically update local state
      setRelationships([...relationships, newRelationship])
    } catch (error) {
      console.error('Failed to create relationship:', error)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-2 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/specs')}>
            ← <span className="hidden sm:inline">Back to Specs</span>
          </Button>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="inline-flex rounded-md border border-border bg-muted/30 p-1">
              <Button
                variant={viewMode === 'formatted' ? 'outline' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('formatted')}
                className={`h-7 rounded-sm ${viewMode === 'formatted' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
              >
                <FileText className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Formatted</span>
              </Button>
              <Button
                variant={viewMode === 'source' ? 'outline' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('source')}
                className={`h-7 rounded-sm ${viewMode === 'source' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
              >
                <Code2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Markdown</span>
              </Button>
            </div>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFeedbackPanel(!showFeedbackPanel)}
                >
                  {showFeedbackPanel ? (
                    <MessageSquareOff className="h-4 w-4" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  {feedback.length > 0 && (
                    <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                      {feedback.length}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{showFeedbackPanel ? 'Hide' : 'Show'} feedback</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {spec.archived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unarchiveSpec(spec.id)}
              disabled={isUpdating}
            >
              <ArchiveRestore className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Unarchive</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => archiveSpec(spec.id)}
              disabled={isUpdating}
            >
              <Archive className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Archive</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div ref={editorContainerRef} className="flex flex-1 overflow-auto xl:justify-center">
        <div className="flex w-full 2xl:max-w-[128rem]">
          <div className="flex-1 px-3 py-4 sm:px-6 lg:px-12 xl:px-16">
            <div className="mx-auto max-w-full space-y-3">
              {/* Spec ID and Title */}
              <div className="space-y-2 pb-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-muted-foreground">{spec.id}</span>
                  <div className="text-xs italic text-muted-foreground">
                    {isUpdating
                      ? 'Saving...'
                      : hasChanges
                        ? 'Unsaved changes...'
                        : 'All changes saved'}
                  </div>
                </div>
                <Input
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  disabled={isUpdating}
                  placeholder="Spec title..."
                  className="border-none bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
                />
              </div>

              {/* Metadata Row */}
              <div className="flex flex-wrap items-center gap-4">
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
                <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                  {spec.updated_at && (
                    <div className="ml-auto flex items-center text-xs text-muted-foreground">
                      Updated{' '}
                      {formatDistanceToNow(
                        new Date(
                          spec.updated_at.endsWith('Z') ? spec.updated_at : spec.updated_at + 'Z'
                        ),
                        { addSuffix: true }
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Content */}
              {content !== undefined ? (
                <SpecViewerTiptap
                  content={content}
                  feedback={feedback}
                  selectedLine={selectedLine}
                  onLineClick={handleLineClick}
                  onTextSelect={handleTextSelect}
                  onFeedbackClick={handleFeedbackClick}
                  onChange={handleContentChange}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                />
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No content available for this spec.</p>
                </Card>
              )}
            </div>
          </div>

          {/* Aligned Feedback Panel */}
          {showFeedbackPanel && (
            <AlignedFeedbackPanel
              feedback={feedback}
              positions={feedbackPositions}
              relationships={relationships}
              currentEntityId={id}
              onFeedbackClick={handleFeedbackClick}
              onDismiss={handleFeedbackDismiss}
              onDelete={handleFeedbackDelete}
              onDeleteRelationship={handleDeleteRelationship}
              onCreateRelationship={handleCreateRelationship}
              addFeedbackButton={
                <div className="flex justify-center">
                  <AddFeedbackDialog
                    issues={issues}
                    lineNumber={selectedLine || undefined}
                    onSubmit={handleCreateFeedback}
                    triggerButton={
                      <Button variant="secondary" size="sm">
                        <MessageSquarePlus className="mr-2 h-4 w-4" />
                        Add Feedback
                      </Button>
                    }
                  />
                </div>
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
