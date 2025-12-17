import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpecs } from '@/hooks/useSpecs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { TiptapEditor } from '@/components/specs/TiptapEditor'
import { FileText, Code2, Sparkles, AlertCircle } from 'lucide-react'
import { executionsApi } from '@/lib/api'
import { toast } from 'sonner'
import type { Spec, CreateSpecRequest } from '@/types/api'

const VIEW_MODE_STORAGE_KEY = 'sudocode:specEditor:viewMode'
const CREATE_MODE_STORAGE_KEY = 'sudocode:createSpec:mode'

interface SpecEditorProps {
  spec?: Spec
  onSave?: (spec: Spec) => void
  onCancel?: () => void
}

export function SpecEditor({ spec, onSave, onCancel }: SpecEditorProps) {
  const navigate = useNavigate()
  const { createSpecAsync, updateSpecAsync, isCreating } = useSpecs()

  // Mode: 'manual' for editing, 'cowrite' for agent-assisted
  const [mode, setMode] = useState<'manual' | 'cowrite'>(() => {
    const stored = localStorage.getItem(CREATE_MODE_STORAGE_KEY)
    return stored === 'cowrite' ? 'cowrite' : 'manual'
  })

  // Manual editing state
  const [title, setTitle] = useState(spec?.title || '')
  const [content, setContent] = useState(spec?.content || '')
  const [priority, setPriority] = useState(spec?.priority ?? 3)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'formatted' | 'markdown'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Co-write state
  const [cowriteDescription, setCowriteDescription] = useState('')
  const [isStartingCowrite, setIsStartingCowrite] = useState(false)
  const [cowriteError, setCowriteError] = useState<string | null>(null)

  // Save view mode preference to localStorage
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify(viewMode))
  }, [viewMode])

  // Save create mode preference to localStorage
  useEffect(() => {
    localStorage.setItem(CREATE_MODE_STORAGE_KEY, mode)
  }, [mode])

  // Auto-resize textarea to fit content in markdown mode
  useEffect(() => {
    if (viewMode === 'markdown' && textareaRef.current) {
      const textarea = textareaRef.current
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [content, viewMode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('Title is required')
      return
    }

    try {
      const specData: CreateSpecRequest = {
        title: title.trim(),
        content: content.trim() || undefined,
        priority,
      }

      if (spec) {
        // Update existing spec
        const updated = await updateSpecAsync({
          id: spec.id,
          data: specData,
        })
        onSave?.(updated)
      } else {
        // Create new spec
        const created = await createSpecAsync(specData)
        onSave?.(created)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save spec')
    }
  }

  const handleStartCowrite = async () => {
    if (!cowriteDescription.trim()) {
      setCowriteError('Please describe the spec you want to create')
      return
    }

    setIsStartingCowrite(true)
    setCowriteError(null)

    try {
      const prompt = `Help me create a new specification document in this project. Here's what I want:

${cowriteDescription.trim()}

Please:
1. Analyze the codebase to understand the existing architecture and patterns
2. If the request is unclear, ask clarifying questions before proceeding
3. Create a comprehensive spec with clear requirements, design decisions, and implementation notes
4. Set appropriate priority
5. Use the sudocode MCP tools to create the spec (upsert_spec)

After creating the spec, summarize what you created.`

      const execution = await executionsApi.createAdhoc({
        config: {
          mode: 'local',
        },
        prompt,
        agentType: 'claude-code',
      })

      toast.success('Started co-writing spec')
      setCowriteDescription('')
      setCowriteError(null)
      navigate(`/executions/${execution.id}`)
    } catch (err) {
      console.error('Failed to start co-write:', err)
      setCowriteError(err instanceof Error ? err.message : 'Failed to start co-write session')
      toast.error('Failed to start co-write session')
    } finally {
      setIsStartingCowrite(false)
    }
  }

  const handleCowriteKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (cowriteDescription.trim() && !isStartingCowrite) {
        handleStartCowrite()
      }
    }
  }

  // If editing an existing spec, don't show the mode tabs
  const isEditing = !!spec

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h2 className="mb-4 text-2xl font-bold">{spec ? 'Edit Spec' : 'New Spec'}</h2>
        </div>

        {!isEditing ? (
          <Tabs value={mode} onValueChange={(v: string) => setMode(v as 'manual' | 'cowrite')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual" className="gap-2">
                <FileText className="h-4 w-4" />
                Manual
              </TabsTrigger>
              <TabsTrigger value="cowrite" className="gap-2">
                <Sparkles className="h-4 w-4" />
                Co-write with Agent
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="mt-4">
              <ManualForm
                title={title}
                setTitle={setTitle}
                content={content}
                setContent={setContent}
                priority={priority}
                setPriority={setPriority}
                viewMode={viewMode}
                setViewMode={setViewMode}
                textareaRef={textareaRef}
                error={error}
                isCreating={isCreating}
                spec={spec}
                onSubmit={handleSubmit}
                onCancel={onCancel}
              />
            </TabsContent>

            <TabsContent value="cowrite" className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Describe the spec you want to create and an AI agent will help draft it.
              </p>

              {cowriteError && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                    <p className="text-sm text-destructive">{cowriteError}</p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="cowrite-description">What spec do you want to create?</Label>
                <Textarea
                  id="cowrite-description"
                  value={cowriteDescription}
                  onChange={(e) => setCowriteDescription(e.target.value)}
                  onKeyDown={handleCowriteKeyDown}
                  placeholder={`Describe the spec you want to create...

Examples:
• "Design spec for a new user authentication system using OAuth"
• "API specification for the payment processing module"
• "Architecture document for the real-time notification system"`}
                  rows={8}
                  className="resize-none"
                  disabled={isStartingCowrite}
                  autoFocus={mode === 'cowrite'}
                />
                <p className="text-xs text-muted-foreground">
                  Press Cmd+Enter (or Ctrl+Enter) to start
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                {onCancel && (
                  <Button variant="outline" onClick={onCancel} disabled={isStartingCowrite}>
                    Cancel
                  </Button>
                )}
                <Button
                  onClick={handleStartCowrite}
                  disabled={!cowriteDescription.trim() || isStartingCowrite}
                >
                  {isStartingCowrite ? (
                    'Starting...'
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Start Co-writing
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <ManualForm
            title={title}
            setTitle={setTitle}
            content={content}
            setContent={setContent}
            priority={priority}
            setPriority={setPriority}
            viewMode={viewMode}
            setViewMode={setViewMode}
            textareaRef={textareaRef}
            error={error}
            isCreating={isCreating}
            spec={spec}
            onSubmit={handleSubmit}
            onCancel={onCancel}
          />
        )}
      </div>
    </Card>
  )
}

// Extracted manual form component for reuse
interface ManualFormProps {
  title: string
  setTitle: (v: string) => void
  content: string
  setContent: (v: string) => void
  priority: number
  setPriority: (v: number) => void
  viewMode: 'formatted' | 'markdown'
  setViewMode: (v: 'formatted' | 'markdown') => void
  textareaRef: React.RefObject<HTMLTextAreaElement>
  error: string | null
  isCreating: boolean
  spec?: Spec
  onSubmit: (e: React.FormEvent) => void
  onCancel?: () => void
}

function ManualForm({
  title,
  setTitle,
  content,
  setContent,
  priority,
  setPriority,
  viewMode,
  setViewMode,
  textareaRef,
  error,
  isCreating,
  spec,
  onSubmit,
  onCancel,
}: ManualFormProps) {
  return (
    <form onSubmit={onSubmit}>
      <div className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {/* Title */}
        <div>
          <label htmlFor="title" className="mb-2 block text-sm font-medium">
            Title *
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Enter spec title"
          />
        </div>

        {/* Content */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="content" className="text-sm font-medium">
              Content
            </label>
            {/* View mode toggle */}
            <div className="flex gap-1 rounded-md border border-border bg-muted/30 p-1">
              <Button
                variant={viewMode === 'formatted' ? 'outline' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('formatted')}
                className={`h-7 rounded-sm ${viewMode === 'formatted' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                type="button"
              >
                <FileText className="mr-2 h-4 w-4" />
                Formatted
              </Button>
              <Button
                variant={viewMode === 'markdown' ? 'outline' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('markdown')}
                className={`h-7 rounded-sm ${viewMode === 'markdown' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                type="button"
              >
                <Code2 className="mr-2 h-4 w-4" />
                Markdown
              </Button>
            </div>
          </div>
          <Card className="overflow-hidden rounded-md border">
            {viewMode === 'formatted' ? (
              <TiptapEditor
                content={content}
                editable={true}
                onChange={(markdown) => setContent(markdown)}
                onSave={(markdown) => setContent(markdown)}
                onCancel={() => {
                  // Reset to original content if needed
                  if (spec) {
                    setContent(spec.content || '')
                  }
                }}
                className="min-h-[300px]"
                placeholder="Spec content (markdown supported)..."
              />
            ) : (
              <div className="p-4">
                <textarea
                  ref={textareaRef}
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full resize-none border-none bg-transparent font-mono text-sm leading-6 outline-none focus:ring-0"
                  placeholder="Spec content (markdown supported)..."
                  spellCheck={false}
                  style={{ minHeight: '300px' }}
                  disabled={isCreating}
                />
              </div>
            )}
          </Card>
        </div>

        {/* Priority */}
        <div>
          <label htmlFor="priority" className="mb-2 block text-sm font-medium">
            Priority
          </label>
          <select
            id="priority"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value={0}>Critical (0)</option>
            <option value={1}>High (1)</option>
            <option value={2}>Medium (2)</option>
            <option value={3}>Low (3)</option>
            <option value={4}>None (4)</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isCreating}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isCreating}>
            {isCreating ? 'Saving...' : spec ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>
    </form>
  )
}
