/**
 * BatchDialog - Create or edit a PR batch
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, ChevronDown, GitPullRequest, Settings } from 'lucide-react'
import type { PRBatch, CreateBatchRequest, MergeStrategy } from '@/types/batch'
import type { EnrichedQueueEntry } from '@/types/queue'

interface BatchDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Existing batch for edit mode */
  batch?: PRBatch | null
  /** Available queue entries to select from */
  availableEntries: EnrichedQueueEntry[]
  /** Called when saving */
  onSave: (data: CreateBatchRequest | { title?: string; description?: string }) => void
  /** Whether a save is in progress */
  isSaving?: boolean
  /** Available target branches */
  branches?: string[]
}

export function BatchDialog({
  isOpen,
  onClose,
  batch,
  availableEntries,
  onSave,
  isSaving = false,
  branches = ['main'],
}: BatchDialogProps) {
  const isEditing = !!batch

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [targetBranch, setTargetBranch] = useState('main')
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('squash')
  const [isDraftPR, setIsDraftPR] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize form when dialog opens or batch changes
  useEffect(() => {
    if (isOpen) {
      if (batch) {
        setTitle(batch.title)
        setDescription(batch.description || '')
        setSelectedEntryIds(batch.entry_ids)
        setTargetBranch(batch.target_branch)
        setMergeStrategy(batch.merge_strategy)
        setIsDraftPR(batch.is_draft_pr)
      } else {
        // Reset for create mode
        setTitle('')
        setDescription('')
        setSelectedEntryIds([])
        setTargetBranch('main')
        setMergeStrategy('squash')
        setIsDraftPR(true)
      }
      setError(null)
      setShowAdvanced(false)
    }
  }, [isOpen, batch])

  const handleEntryToggle = (entryId: string) => {
    if (isEditing) return // Can't change entries in edit mode

    setSelectedEntryIds((prev) =>
      prev.includes(entryId)
        ? prev.filter((id) => id !== entryId)
        : [...prev, entryId]
    )
  }

  const handleSelectAll = () => {
    if (isEditing) return
    if (selectedEntryIds.length === availableEntries.length) {
      setSelectedEntryIds([])
    } else {
      setSelectedEntryIds(availableEntries.map((e) => e.executionId))
    }
  }

  const handleSave = () => {
    // Validate
    if (!title.trim()) {
      setError('Title is required')
      return
    }

    if (!isEditing && selectedEntryIds.length === 0) {
      setError('Select at least one queue entry')
      return
    }

    setError(null)

    if (isEditing) {
      // Only send updatable fields
      onSave({
        title: title.trim(),
        description: description.trim() || undefined,
      })
    } else {
      // Full create request
      onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        entry_ids: selectedEntryIds,
        target_branch: targetBranch,
        merge_strategy: mergeStrategy,
        is_draft_pr: isDraftPR,
      })
    }
  }

  const handleClose = () => {
    if (isSaving) return
    onClose()
  }

  // Filter entries for display (show only pending/ready for new batches)
  const filteredEntries = availableEntries.filter(
    (e) => e.status === 'pending' || e.status === 'ready' || selectedEntryIds.includes(e.executionId)
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            {isEditing ? 'Edit Batch' : 'Create PR Batch'}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Error */}
            {error && (
              <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="batch-title">Title *</Label>
              <Input
                id="batch-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="PR title for this batch"
                disabled={isSaving}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="batch-description">Description</Label>
              <Textarea
                id="batch-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description for the PR body"
                rows={3}
                disabled={isSaving}
              />
            </div>

            {/* Entry Selection */}
            {!isEditing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Queue Entries *</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAll}
                    disabled={isSaving}
                  >
                    {selectedEntryIds.length === filteredEntries.length
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                </div>

                <div className="rounded-lg border">
                  {filteredEntries.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No queue entries available
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredEntries.map((entry) => (
                        <label
                          key={entry.id}
                          className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={selectedEntryIds.includes(entry.executionId)}
                            onCheckedChange={() => handleEntryToggle(entry.executionId)}
                            disabled={isSaving}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {entry.issueId}
                              </span>
                              <Badge
                                variant="outline"
                                className={
                                  entry.status === 'ready'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : ''
                                }
                              >
                                {entry.status}
                              </Badge>
                            </div>
                            <p className="truncate text-sm">{entry.issueTitle}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {selectedEntryIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedEntryIds.length} {selectedEntryIds.length === 1 ? 'entry' : 'entries'} selected
                  </p>
                )}
              </div>
            )}

            {/* Target Branch */}
            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="target-branch">Target Branch</Label>
                <Select value={targetBranch} onValueChange={setTargetBranch} disabled={isSaving}>
                  <SelectTrigger id="target-branch">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Advanced Options */}
            {!isEditing && (
              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between" disabled={isSaving}>
                    <span className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Advanced Options
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-2">
                  {/* Merge Strategy */}
                  <div className="space-y-2">
                    <Label>Merge Strategy</Label>
                    <RadioGroup
                      value={mergeStrategy}
                      onValueChange={(v) => setMergeStrategy(v as MergeStrategy)}
                      disabled={isSaving}
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="squash" id="squash" />
                        <Label htmlFor="squash" className="font-normal">
                          Squash commits into one
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="preserve" id="preserve" />
                        <Label htmlFor="preserve" className="font-normal">
                          Preserve commit history
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Draft PR */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="draft-pr"
                      checked={isDraftPR}
                      onCheckedChange={(checked) => setIsDraftPR(checked as boolean)}
                      disabled={isSaving}
                    />
                    <Label htmlFor="draft-pr" className="font-normal">
                      Create as draft PR
                    </Label>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Batch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
