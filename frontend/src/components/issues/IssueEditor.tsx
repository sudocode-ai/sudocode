import { useState, useEffect, useRef } from 'react'
import type { Issue, IssueStatus } from '@sudocode/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TiptapEditor } from '@/components/specs/TiptapEditor'
import { Card } from '@/components/ui/card'
import { FileText, Code2 } from 'lucide-react'

const VIEW_MODE_STORAGE_KEY = 'sudocode:issueEditor:viewMode'

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

interface IssueEditorProps {
  issue?: Issue | null
  onSave: (data: Partial<Issue>) => void
  onCancel: () => void
  isLoading?: boolean
}

export function IssueEditor({ issue, onSave, onCancel, isLoading = false }: IssueEditorProps) {
  const [title, setTitle] = useState(issue?.title || '')
  const [content, setContent] = useState(issue?.content || '')
  const [status, setStatus] = useState<IssueStatus>(issue?.status || 'open')
  const [priority, setPriority] = useState<number>(issue?.priority ?? 2)
  const [errors, setErrors] = useState<{ title?: string }>({})
  const [viewMode, setViewMode] = useState<'formatted' | 'markdown'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Update form when issue changes
  useEffect(() => {
    if (issue) {
      setTitle(issue.title)
      setContent(issue.content || '')
      setStatus(issue.status)
      setPriority(issue.priority)
    }
  }, [issue])

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

  const validate = () => {
    const newErrors: { title?: string } = {}

    if (!title.trim()) {
      newErrors.title = 'Title is required'
    } else if (title.length > 200) {
      newErrors.title = 'Title must be less than 200 characters'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    onSave({
      title,
      content,
      status,
      priority,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter issue title..."
          className={errors.title ? 'border-destructive' : ''}
          disabled={isLoading}
        />
        {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
      </div>

      {/* Content (Markdown) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="content">Details</Label>
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
                if (issue) {
                  setContent(issue.content || '')
                }
              }}
              className="min-h-[300px]"
              placeholder="Issue description..."
            />
          ) : (
            <div className="p-4">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Issue description in markdown..."
                className="w-full resize-none border-none bg-transparent font-mono text-sm leading-6 outline-none focus:ring-0"
                spellCheck={false}
                style={{ minHeight: '300px' }}
                disabled={isLoading}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Status and Priority Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Status */}
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as IssueStatus)}
            disabled={isLoading}
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

        {/* Priority */}
        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select
            value={String(priority)}
            onValueChange={(value) => setPriority(parseInt(value))}
            disabled={isLoading}
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

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving...' : issue ? 'Update Issue' : 'Create Issue'}
        </Button>
      </div>
    </form>
  )
}
