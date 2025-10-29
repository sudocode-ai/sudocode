import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSpec, useSpecFeedback, useSpecs } from '@/hooks/useSpecs'
import { useIssues } from '@/hooks/useIssues'
import { SpecViewerTiptap } from '@/components/specs/SpecViewerTiptap'
import { SpecFeedbackPanel } from '@/components/specs/SpecFeedbackPanel'
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
import { MessageSquare, Archive, ArchiveRestore, Signal, FileText, Code2 } from 'lucide-react'
import type { IssueFeedback } from '@/types/api'

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Critical (P0)' },
  { value: '1', label: 'High (P1)' },
  { value: '2', label: 'Medium (P2)' },
  { value: '3', label: 'Low (P3)' },
  { value: '4', label: 'None (P4)' },
]

export default function SpecDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { spec, isLoading, isError } = useSpec(id || '')
  const { feedback } = useSpecFeedback(id || '')
  const { issues } = useIssues()
  const { updateSpec, isUpdating, archiveSpec, unarchiveSpec } = useSpecs()

  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(true)
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(undefined)
  const [viewMode, setViewMode] = useState<'formatted' | 'source'>('formatted')

  // Local state for editable fields
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState<number>(2)
  const [hasChanges, setHasChanges] = useState(false)

  // Refs for auto-save
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const updateSpecRef = useRef(updateSpec)
  const latestValuesRef = useRef({ title, content, priority, hasChanges })
  const currentIdRef = useRef(id)

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

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/specs')}>
            ← Back to Specs
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-muted/30 p-1">
              <Button
                variant={viewMode === 'formatted' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('formatted')}
                className={`h-7 rounded-sm ${viewMode === 'formatted' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
              >
                <FileText className="mr-2 h-4 w-4" />
                Formatted
              </Button>
              <Button
                variant={viewMode === 'source' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('source')}
                className={`h-7 rounded-sm ${viewMode === 'source' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
              >
                <Code2 className="mr-2 h-4 w-4" />
                Markdown
              </Button>
            </div>
          </div>

          {/* Issue selector */}
          <Select value={selectedIssueId} onValueChange={setSelectedIssueId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select issue..." />
            </SelectTrigger>
            <SelectContent>
              {issues.map((issue) => (
                <SelectItem key={issue.id} value={issue.id}>
                  {issue.id}: {issue.title}
                </SelectItem>
              ))}
              {issues.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No issues available</div>
              )}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFeedbackPanel(!showFeedbackPanel)}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Feedback {feedback.length > 0 && `(${feedback.length})`}
          </Button>

          {spec.archived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unarchiveSpec(spec.id)}
              disabled={isUpdating}
            >
              <ArchiveRestore className="mr-2 h-4 w-4" />
              Unarchive
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => archiveSpec(spec.id)}
              disabled={isUpdating}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto px-6 py-4">
          <div className="space-y-3">
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
                    Updated at {new Date(spec.updated_at).toLocaleString()}
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

        {/* Feedback Panel */}
        {showFeedbackPanel && (
          <div className="w-96 border-l">
            <SpecFeedbackPanel
              specId={spec.id}
              issueId={selectedIssueId}
              selectedLineNumber={selectedLine}
              selectedText={selectedText}
              onClose={() => setShowFeedbackPanel(false)}
              onFeedbackClick={handleFeedbackClick}
            />
          </div>
        )}
      </div>
    </div>
  )
}
