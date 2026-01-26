/**
 * StackCreationPanel - Panel for creating diff stacks from selected checkpoints
 * Appears when checkpoints are selected in the DAG, allows reordering and creating a stack
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  GripVertical,
  GitCommit,
  Plus,
  X,
  Layers,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDiffStacks } from '@/hooks/useCheckpointDAG'
import type { DataplaneCheckpoint, DiffStack } from '@/types/checkpoint'

// =============================================================================
// Types
// =============================================================================

export interface StackCreationPanelProps {
  /** Selected checkpoint IDs */
  selectedCheckpointIds: string[]
  /** Checkpoint data (keyed by ID) */
  checkpoints: Record<string, DataplaneCheckpoint>
  /** Available target branches */
  targetBranches?: string[]
  /** Callback when a stack is created */
  onStackCreated?: (stack: DiffStack) => void
  /** Callback to cancel/close the panel */
  onCancel?: () => void
  /** Custom class name */
  className?: string
}

// =============================================================================
// Sortable Checkpoint Item
// =============================================================================

interface SortableCheckpointItemProps {
  id: string
  checkpoint: DataplaneCheckpoint
  onRemove: (id: string) => void
}

function SortableCheckpointItem({ id, checkpoint, onRemove }: SortableCheckpointItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const shortSha = checkpoint.commitSha.slice(0, 7)
  const message = checkpoint.message || 'No message'
  const displayMessage = message.length > 50 ? `${message.slice(0, 50)}...` : message

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background p-2',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      {/* Drag handle */}
      <button
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Checkpoint info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <code className="text-xs font-mono text-muted-foreground">{shortSha}</code>
        </div>
        <p className="text-sm truncate" title={message}>
          {displayMessage}
        </p>
      </div>

      {/* Remove button */}
      <button
        onClick={() => onRemove(id)}
        className="text-muted-foreground hover:text-destructive"
        title="Remove from stack"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function StackCreationPanel({
  selectedCheckpointIds,
  checkpoints,
  targetBranches = ['main'],
  onStackCreated,
  onCancel,
  className,
}: StackCreationPanelProps) {
  // Order of checkpoints in the stack
  const [orderedIds, setOrderedIds] = useState<string[]>(selectedCheckpointIds)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetBranch, setTargetBranch] = useState(targetBranches[0] || 'main')

  // Stack mutations
  const { createStack, isCreating } = useDiffStacks()

  // Sync ordered IDs with selected checkpoints (add new, keep existing order)
  useEffect(() => {
    setOrderedIds((prev) => {
      // Keep existing order for checkpoints that are still selected
      const kept = prev.filter((id) => selectedCheckpointIds.includes(id))
      // Add new checkpoints at the end
      const newIds = selectedCheckpointIds.filter((id) => !prev.includes(id))
      return [...kept, ...newIds]
    })
  }, [selectedCheckpointIds])

  // Auto-generate name from first checkpoint message
  useEffect(() => {
    if (!name && orderedIds.length > 0) {
      const firstCheckpoint = checkpoints[orderedIds[0]]
      if (firstCheckpoint?.message) {
        // Use first 50 chars of first checkpoint message
        const autoName = firstCheckpoint.message.slice(0, 50)
        setName(autoName)
      }
    }
  }, [orderedIds, checkpoints, name])

  // Sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setOrderedIds((items) => {
        const oldIndex = items.indexOf(active.id as string)
        const newIndex = items.indexOf(over.id as string)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }, [])

  // Handle remove checkpoint
  const handleRemove = useCallback((id: string) => {
    setOrderedIds((prev) => prev.filter((i) => i !== id))
  }, [])

  // Handle create stack
  const handleCreate = useCallback(async () => {
    if (orderedIds.length === 0) return

    try {
      const stack = await createStack({
        name: name || undefined,
        description: description || undefined,
        targetBranch,
        checkpointIds: orderedIds,
      })
      onStackCreated?.(stack)
    } catch (error) {
      // Error is handled by the hook (toast)
    }
  }, [orderedIds, name, description, targetBranch, createStack, onStackCreated])

  // Valid checkpoints (filter out any that don't exist)
  const validCheckpoints = useMemo(() => {
    return orderedIds.filter((id) => checkpoints[id])
  }, [orderedIds, checkpoints])

  // Empty state
  if (validCheckpoints.length === 0) {
    return (
      <Card className={cn('w-full', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Create Stack
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select checkpoints in the DAG to create a stack.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Create Stack
          <span className="text-sm font-normal text-muted-foreground">
            ({validCheckpoints.length} checkpoint{validCheckpoints.length !== 1 ? 's' : ''})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stack Name */}
        <div className="space-y-2">
          <Label htmlFor="stack-name">Name</Label>
          <Input
            id="stack-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stack name (optional)"
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="stack-description">Description</Label>
          <Textarea
            id="stack-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={2}
          />
        </div>

        {/* Target Branch */}
        <div className="space-y-2">
          <Label htmlFor="target-branch">Target Branch</Label>
          <Select value={targetBranch} onValueChange={setTargetBranch}>
            <SelectTrigger id="target-branch">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {targetBranches.map((branch) => (
                <SelectItem key={branch} value={branch}>
                  {branch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Checkpoint List (Reorderable) */}
        <div className="space-y-2">
          <Label>Checkpoints (drag to reorder)</Label>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={validCheckpoints}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {validCheckpoints.map((id) => (
                  <SortableCheckpointItem
                    key={id}
                    id={id}
                    checkpoint={checkpoints[id]}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || validCheckpoints.length === 0}>
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create Stack
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default StackCreationPanel
