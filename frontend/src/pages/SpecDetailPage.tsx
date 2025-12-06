import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { useSpec, useSpecFeedback, useSpecs } from '@/hooks/useSpecs'
import { useSpecRelationships } from '@/hooks/useSpecRelationships'
import { useIssues } from '@/hooks/useIssues'
import { useFeedback } from '@/hooks/useFeedback'
import { SpecViewerTiptap } from '@/components/specs/SpecViewerTiptap'
import { AlignedFeedbackPanel } from '@/components/specs/AlignedFeedbackPanel'
import { AddFeedbackDialog } from '@/components/specs/AddFeedbackDialog'
import { TableOfContentsPanel } from '@/components/specs/TableOfContentsPanel'
import { useFeedbackPositions } from '@/hooks/useFeedbackPositions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  Trash2,
  Copy,
  Check,
  List,
  Pencil,
  X,
  ChevronsUpDown,
  ArrowLeft,
} from 'lucide-react'
import type { IssueFeedback, Relationship, EntityType, RelationshipType } from '@/types/api'
import { relationshipsApi } from '@/lib/api'
import { DeleteSpecDialog } from '@/components/specs/DeleteSpecDialog'
import { EntityBadge } from '@/components/entities/EntityBadge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { TocItem } from '@/components/specs/TiptapEditor'

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Critical (P0)' },
  { value: '1', label: 'High (P1)' },
  { value: '2', label: 'Medium (P2)' },
  { value: '3', label: 'Low (P3)' },
  { value: '4', label: 'None (P4)' },
]

const SHOW_FEEDBACK_STORAGE_KEY = 'sudocode:specs:showFeedbackPanel'
const VIEW_MODE_STORAGE_KEY = 'sudocode:details:viewMode'
const SHOW_TOC_STORAGE_KEY = 'sudocode:specs:showTocPanel'

export default function SpecDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { spec, isLoading, isError } = useSpec(id || '')
  const { feedback } = useSpecFeedback(id || '')
  const { issues } = useIssues()
  const { specs, updateSpec, isUpdating, archiveSpec, unarchiveSpec, deleteSpec } = useSpecs()
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
  const [showTocPanel, setShowTocPanel] = useState(() => {
    const stored = localStorage.getItem(SHOW_TOC_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : true
  })
  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  // Local state for editable fields
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState<number>(2)
  const [hasChanges, setHasChanges] = useState(false)

  // Relationships via hook with WebSocket real-time updates
  const { relationships } = useSpecRelationships(id)

  // Parent editing state
  const [isEditingParent, setIsEditingParent] = useState(false)
  const [parentSearchTerm, setParentSearchTerm] = useState('')
  const [parentComboboxOpen, setParentComboboxOpen] = useState(false)

  // Compute child specs (specs whose parent_id matches this spec's id)
  const childSpecs = useMemo(() => {
    if (!id) return []
    return specs.filter((s) => s.parent_id === id)
  }, [specs, id])

  // Compute all descendant IDs to prevent circular parent references
  const descendantIds = useMemo(() => {
    if (!id) return new Set<string>()
    const descendants = new Set<string>()
    const collectDescendants = (parentId: string) => {
      specs.forEach((s) => {
        if (s.parent_id === parentId && !descendants.has(s.id)) {
          descendants.add(s.id)
          collectDescendants(s.id)
        }
      })
    }
    collectDescendants(id)
    return descendants
  }, [specs, id])

  // Available specs for parent selection (exclude self and descendants)
  const availableParentSpecs = useMemo(() => {
    if (!id) return []
    return specs.filter((s) => s.id !== id && !descendantIds.has(s.id))
  }, [specs, id, descendantIds])

  // Filtered parent specs based on search
  const filteredParentSpecs = useMemo(() => {
    if (!parentSearchTerm.trim()) return availableParentSpecs
    const search = parentSearchTerm.toLowerCase()
    return availableParentSpecs.filter(
      (s) => s.id.toLowerCase().includes(search) || s.title.toLowerCase().includes(search)
    )
  }, [availableParentSpecs, parentSearchTerm])

  // Refs for auto-save and position tracking
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const updateSpecRef = useRef(updateSpec)
  const latestValuesRef = useRef({ title, content, priority, hasChanges })
  const currentIdRef = useRef(id)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const scrollableContainerRef = useRef<HTMLDivElement>(null)

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

  // Save TOC panel preference to localStorage
  useEffect(() => {
    localStorage.setItem(SHOW_TOC_STORAGE_KEY, JSON.stringify(showTocPanel))
  }, [showTocPanel])

  // Scroll spy effect to track which heading is in view
  useEffect(() => {
    const scrollContainer = scrollableContainerRef.current
    const editorContainer = editorContainerRef.current
    if (!scrollContainer || !editorContainer || tocItems.length === 0) return

    const handleScroll = () => {
      // Get all heading elements with toc-id
      const headings = editorContainer.querySelectorAll('[data-toc-id]')
      if (headings.length === 0) return

      // Find the heading that's closest to the top of the viewport (but not above it)
      let activeId: string | null = null
      const scrollTop = scrollContainer.scrollTop
      const containerTop = scrollContainer.getBoundingClientRect().top
      const offset = 100 // Offset from top to consider "in view"

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i] as HTMLElement
        const rect = heading.getBoundingClientRect()
        const relativeTop = rect.top - containerTop + scrollTop

        if (scrollTop >= relativeTop - offset) {
          activeId = heading.getAttribute('data-toc-id')
          break
        }
      }

      // If no heading found (at the very top), use the first one
      if (!activeId && headings.length > 0) {
        activeId = headings[0].getAttribute('data-toc-id')
      }

      // Update tocItems with the active heading
      setTocItems((prevItems) => {
        const hasChanged = prevItems.some((item) => (item.id === activeId) !== item.isActive)
        if (!hasChanged) return prevItems

        return prevItems.map((item) => ({
          ...item,
          isActive: item.id === activeId,
          isScrolledOver: false, // Could track this separately if needed
        }))
      })
    }

    // Initial check
    handleScroll()

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [tocItems.length])

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
  }

  const handleTextSelect = (text: string, lineNumber: number) => {
    setSelectedText(text)
    setSelectedLine(lineNumber)
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

  const handleParentChange = (parentId: string | undefined) => {
    if (!id) return
    updateSpec({
      id,
      data: { parent_id: parentId },
    })
    setIsEditingParent(false)
    setParentSearchTerm('')
    setParentComboboxOpen(false)
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
      to_id: id,
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
      // WebSocket will handle cache invalidation via useSpecRelationships hook
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
      await relationshipsApi.create({
        from_id: id,
        from_type: 'spec',
        to_id: toId,
        to_type: toType,
        relationship_type: relationshipType,
      })
      // WebSocket will handle cache invalidation via useSpecRelationships hook
    } catch (error) {
      console.error('Failed to create relationship:', error)
    }
  }

  const handleDelete = async () => {
    if (!id) return

    setIsDeleting(true)
    try {
      await deleteSpec(id)
      setShowDeleteDialog(false)
      navigate('/specs')
    } catch (error) {
      console.error('Failed to delete spec:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCopyId = async () => {
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
      toast.success('ID copied to clipboard', {
        duration: 2000,
      })
    } catch (error) {
      console.error('Failed to copy ID:', error)
      toast.error('Failed to copy ID')
    }
  }

  const handleTocUpdate = (items: TocItem[]) => {
    // Preserve active state when updating items
    setTocItems((prevItems) => {
      const activeId = prevItems.find((item) => item.isActive)?.id
      return items.map((item) => ({
        ...item,
        isActive: item.id === activeId,
      }))
    })
  }

  const handleTocItemClick = (headingId: string) => {
    // Find the heading element and scroll to it within the scrollable container
    const headingElement = editorContainerRef.current?.querySelector(`[data-toc-id="${headingId}"]`)
    const scrollableContainer = scrollableContainerRef.current

    if (headingElement && scrollableContainer) {
      // Calculate scroll position relative to the scrollable container
      const elementTop = headingElement.getBoundingClientRect().top
      const containerTop = scrollableContainer.getBoundingClientRect().top
      const scrollPosition = scrollableContainer.scrollTop + (elementTop - containerTop)

      scrollableContainer.scrollTo({
        top: scrollPosition,
        behavior: 'smooth',
      })
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="relative flex flex-shrink-0 flex-col border-b bg-background">
        <div className="flex items-center justify-between p-2 sm:p-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(-1)}
                    className="h-8 w-8 flex-shrink-0 p-0"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Go back</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {/* Title */}
            <textarea
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              disabled={isUpdating}
              placeholder="Spec title..."
              rows={1}
              className="min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent px-0 text-lg font-semibold leading-tight shadow-none outline-none focus:ring-0"
              style={{ maxHeight: '2.5em' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = `${Math.min(target.scrollHeight, 40)}px`
              }}
            />
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
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

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={isUpdating || isDeleting}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete spec</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Table of Contents FAB - Only in formatted mode */}
        {viewMode === 'formatted' && tocItems.length > 0 && !showTocPanel && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowTocPanel(!showTocPanel)}
                  className="absolute left-3 top-full z-50 mt-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-secondary shadow-lg transition-colors hover:bg-accent hover:text-accent-foreground"
                  type="button"
                >
                  <List className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Table of Contents</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-full 2xl:mx-auto 2xl:max-w-[128rem]">
          {/* Table of Contents Panel - Only on xl+ screens */}
          {showTocPanel && viewMode === 'formatted' && (
            <div className="hidden w-64 flex-shrink-0 flex-col overflow-y-auto border-r bg-background xl:flex">
              <TableOfContentsPanel
                items={tocItems}
                onItemClick={handleTocItemClick}
                onCollapse={() => setShowTocPanel(false)}
              />
            </div>
          )}

          <div ref={scrollableContainerRef} className="relative flex-1 overflow-y-auto">
            <div
              ref={editorContainerRef}
              className={`px-3 py-4 sm:px-6 lg:px-12 xl:px-16 ${
                showFeedbackPanel
                  ? 'pr-[calc(16rem+1rem)] sm:pr-[calc(20rem+1rem)] md:pr-[calc(24rem+1rem)] lg:pr-[calc(28rem+1rem)] xl:pr-[calc(30rem+1rem)] 2xl:pr-[calc(40rem+1rem)]'
                  : ''
              }`}
            >
              <div className="mx-auto max-w-full space-y-3">
                {/* Parent/Children info */}
                <div className="flex flex-wrap items-center gap-2 pb-2">
                  {/* Entity Badge */}
                  <div className="group relative flex flex-shrink-0 items-center gap-1">
                    <Badge variant="spec" className="font-mono">
                      {spec.id}
                    </Badge>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCopyId}
                            className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            {isCopied ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{isCopied ? 'Copied!' : 'Copy ID to Clipboard'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {/* Parent spec selector */}
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">Parent:</span>
                    {isEditingParent ? (
                      <div className="flex items-center gap-1">
                        <Popover open={parentComboboxOpen} onOpenChange={setParentComboboxOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={parentComboboxOpen}
                              className="h-7 w-[200px] justify-between text-xs font-normal"
                              disabled={isUpdating}
                            >
                              {spec.parent_id ? (
                                <span className="truncate">
                                  {availableParentSpecs.find((s) => s.id === spec.parent_id)
                                    ?.title || spec.parent_id}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Select parent...</span>
                              )}
                              <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[280px] p-0" align="start">
                            <div className="flex flex-col">
                              <div className="border-b p-2">
                                <Input
                                  placeholder="Search specs..."
                                  value={parentSearchTerm}
                                  onChange={(e) => setParentSearchTerm(e.target.value)}
                                  className="h-7 text-xs"
                                  autoFocus
                                />
                              </div>
                              <div className="max-h-60 overflow-auto">
                                {/* Option to clear parent */}
                                {spec.parent_id && (
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                    onClick={() => handleParentChange(undefined)}
                                  >
                                    <X className="h-3 w-3" />
                                    Remove parent
                                  </button>
                                )}
                                {filteredParentSpecs.length === 0 ? (
                                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                                    No specs found
                                  </div>
                                ) : (
                                  filteredParentSpecs.map((s) => (
                                    <button
                                      key={s.id}
                                      type="button"
                                      className={cn(
                                        'flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground',
                                        spec.parent_id === s.id &&
                                          'bg-accent text-accent-foreground'
                                      )}
                                      onClick={() => handleParentChange(s.id)}
                                    >
                                      <Check
                                        className={cn(
                                          'mt-0.5 h-3 w-3 shrink-0',
                                          spec.parent_id === s.id ? 'opacity-100' : 'opacity-0'
                                        )}
                                      />
                                      <div className="flex-1 overflow-hidden">
                                        <div className="font-medium">{s.id}</div>
                                        <div className="truncate text-muted-foreground">
                                          {s.title}
                                        </div>
                                      </div>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            setIsEditingParent(false)
                            setParentSearchTerm('')
                            setParentComboboxOpen(false)
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="group flex items-center gap-1">
                        {spec.parent_id ? (
                          <EntityBadge entityId={spec.parent_id} entityType="spec" showTitle />
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsEditingParent(true)}
                                disabled={isUpdating}
                                className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{spec.parent_id ? 'Change parent' : 'Set parent'}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    )}
                  </div>
                  {childSpecs.length > 0 && (
                    <>
                      <span className="text-sm text-muted-foreground">
                        {childSpecs.length === 1 ? 'Child:' : 'Children:'}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {childSpecs.map((child) => (
                          <EntityBadge
                            key={child.id}
                            entityId={child.id}
                            entityType="spec"
                            displayText={child.title}
                          />
                        ))}
                      </div>
                    </>
                  )}
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

                {/* Metadata Row */}
                <div className="flex items-center justify-between">
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

                    {/* View mode toggle */}
                    <TooltipProvider>
                      <div className="flex rounded border border-border/50 bg-muted/30 p-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setViewMode('formatted')}
                              className={`rounded p-1 ${viewMode === 'formatted' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                              <FileText className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Formatted</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setViewMode('source')}
                              className={`rounded p-1 ${viewMode === 'source' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                              <Code2 className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Markdown</TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                  </div>
                  {/* Save status */}
                  <div className="flex-shrink-0 text-xs italic text-muted-foreground">
                    {isUpdating
                      ? 'Saving...'
                      : hasChanges
                        ? 'Unsaved changes...'
                        : 'All changes saved'}
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
                    onTocUpdate={handleTocUpdate}
                  />
                ) : (
                  <Card className="p-8 text-center">
                    <p className="text-muted-foreground">No content available for this spec.</p>
                  </Card>
                )}
              </div>
            </div>

            {/* Aligned Feedback Panel - Absolutely positioned, scrolls with page */}
            {showFeedbackPanel && (
              <div className="pointer-events-none absolute right-0 top-0">
                <div className="pointer-events-auto sticky top-0">
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
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <DeleteSpecDialog
        spec={spec}
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  )
}
