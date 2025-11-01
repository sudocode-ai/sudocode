import { useState, useRef, useEffect } from 'react'
import { useSpecs } from '@/hooks/useSpecs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { TiptapEditor } from '@/components/specs/TiptapEditor'
import { FileText, Code2 } from 'lucide-react'
import type { Spec, CreateSpecRequest } from '@/types/api'

const VIEW_MODE_STORAGE_KEY = 'sudocode:specEditor:viewMode'

interface SpecEditorProps {
  spec?: Spec
  onSave?: (spec: Spec) => void
  onCancel?: () => void
}

export function SpecEditor({ spec, onSave, onCancel }: SpecEditorProps) {
  const { createSpecAsync, updateSpecAsync, isCreating } = useSpecs()

  const [title, setTitle] = useState(spec?.title || '')
  const [content, setContent] = useState(spec?.content || '')
  const [priority, setPriority] = useState(spec?.priority ?? 3)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'formatted' | 'markdown'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Save view mode preference to localStorage
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify(viewMode))
  }, [viewMode])

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

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <h2 className="mb-4 text-2xl font-bold">{spec ? 'Edit Spec' : 'New Spec'}</h2>
          </div>

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
    </Card>
  )
}
