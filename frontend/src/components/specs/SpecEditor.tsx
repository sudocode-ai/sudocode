import { useState } from 'react'
import { useSpecs } from '@/hooks/useSpecs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Spec, CreateSpecRequest } from '@/types/api'

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
            <h2 className="text-2xl font-bold mb-4">
              {spec ? 'Edit Spec' : 'New Spec'}
            </h2>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium mb-2"
            >
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
            <label
              htmlFor="content"
              className="block text-sm font-medium mb-2"
            >
              Content
            </label>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              placeholder="Spec content (markdown supported)"
              rows={12}
            />
          </div>

          {/* Priority */}
          <div>
            <label
              htmlFor="priority"
              className="block text-sm font-medium mb-2"
            >
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
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isCreating}
              >
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
