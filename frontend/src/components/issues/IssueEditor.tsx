import { useState, useEffect } from 'react'
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

  // Update form when issue changes
  useEffect(() => {
    if (issue) {
      setTitle(issue.title)
      setContent(issue.content || '')
      setStatus(issue.status)
      setPriority(issue.priority)
    }
  }, [issue])

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
        <Label htmlFor="content">Details</Label>
        <Card className="overflow-hidden">
          <TiptapEditor
            content={content}
            editable={true}
            onSave={(markdown) => setContent(markdown)}
            onCancel={() => {
              // Reset to original content if needed
              if (issue) {
                setContent(issue.content || '')
              }
            }}
            className="min-h-[300px]"
          />
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
