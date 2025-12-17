import { useState } from 'react'
import { ExternalLink, MessageSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProviderIcon, getProviderDisplayName } from './ProviderIcon'
import type { ExternalEntity, ImportOptions } from '@/lib/api'

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Critical (P0)' },
  { value: '1', label: 'High (P1)' },
  { value: '2', label: 'Medium (P2)' },
  { value: '3', label: 'Low (P3)' },
  { value: '4', label: 'None (P4)' },
]

interface ImportPreviewProps {
  provider: string
  entity: ExternalEntity
  commentsCount?: number
  onImport: (options: ImportOptions) => void
  onCancel: () => void
  isImporting?: boolean
}

/**
 * Display entity preview with import options
 */
export function ImportPreview({
  provider,
  entity,
  commentsCount = 0,
  onImport,
  onCancel,
  isImporting = false,
}: ImportPreviewProps) {
  const [includeComments, setIncludeComments] = useState(commentsCount > 0)
  const [priority, setPriority] = useState<number>(entity.priority ?? 2)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  const handleAddTag = () => {
    const newTag = tagInput.trim().toLowerCase()
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove))
  }

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      // Remove last tag on backspace when input is empty
      setTags(tags.slice(0, -1))
    }
  }

  const handleImport = () => {
    const options: ImportOptions = {
      priority,
    }

    if (includeComments && commentsCount > 0) {
      options.includeComments = true
    }

    if (tags.length > 0) {
      options.tags = tags
    }

    onImport(options)
  }

  // Truncate description for preview
  const truncatedDescription =
    entity.description && entity.description.length > 500
      ? entity.description.slice(0, 500) + '...'
      : entity.description

  return (
    <div className="space-y-4">
      {/* Provider and title */}
      <div className="flex items-start gap-3">
        <ProviderIcon provider={provider} size="lg" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {getProviderDisplayName(provider)}
            </span>
            {entity.url && (
              <a
                href={entity.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <h3 className="mt-1 text-lg font-semibold">{entity.title}</h3>
          {entity.status && (
            <Badge variant="outline" className="mt-1">
              {entity.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Content preview */}
      {truncatedDescription && (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {truncatedDescription}
          </p>
        </div>
      )}

      {/* Import options */}
      <div className="space-y-4 rounded-md border p-4">
        <h4 className="font-medium">Import Options</h4>

        {/* Include comments */}
        {commentsCount > 0 && (
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-comments"
              checked={includeComments}
              onCheckedChange={(checked) => setIncludeComments(checked as boolean)}
              disabled={isImporting}
            />
            <Label
              htmlFor="include-comments"
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Include {commentsCount} comment{commentsCount !== 1 ? 's' : ''} as feedback
            </Label>
          </div>
        )}

        {/* Priority */}
        <div className="space-y-2">
          <Label htmlFor="import-priority">Priority</Label>
          <Select
            value={String(priority)}
            onValueChange={(value) => setPriority(parseInt(value))}
            disabled={isImporting}
          >
            <SelectTrigger id="import-priority" className="w-[200px]">
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

        {/* Tags */}
        <div className="space-y-2">
          <Label htmlFor="import-tags">Tags</Label>
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="gap-1 pr-1"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-1 rounded-sm hover:bg-muted"
                  disabled={isImporting}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Input
              id="import-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={handleAddTag}
              placeholder={tags.length === 0 ? 'Add tags...' : ''}
              className="h-7 min-w-[100px] flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              disabled={isImporting}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Press Enter to add a tag
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={isImporting}>
          Cancel
        </Button>
        <Button onClick={handleImport} disabled={isImporting}>
          {isImporting ? 'Importing...' : 'Import as Spec'}
        </Button>
      </div>
    </div>
  )
}
