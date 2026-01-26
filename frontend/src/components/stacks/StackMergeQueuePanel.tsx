/**
 * StackMergeQueuePanel - Display and manage diff stack merge queue
 * Shows queued diff stacks with drag-and-drop reordering and merge actions
 */

import { useState, useMemo, useCallback } from 'react'
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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ListOrdered,
  GitMerge,
  GripVertical,
  GitCommit,
  Layers,
  RefreshCw,
  AlertTriangle,
  Loader2,
  X,
  Check,
  AlertCircle,
  Play,
  Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMergeQueue } from '@/hooks/useCheckpointDAG'
import {
  REVIEW_STATUS_STYLES,
  REVIEW_STATUS_LABELS,
  type DiffStackWithCheckpoints,
  type MergeResult,
} from '@/types/checkpoint'

// =============================================================================
// Types
// =============================================================================

interface StackMergeQueuePanelProps {
  /** Default target branch to filter by */
  defaultTargetBranch?: string
  /** Available target branches */
  targetBranches?: string[]
  /** Callback when a stack is selected for viewing */
  onStackSelect?: (stackId: string) => void
  /** Custom class name */
  className?: string
}

// =============================================================================
// Sortable Stack Item
// =============================================================================

interface SortableStackItemProps {
  stack: DiffStackWithCheckpoints
  onSelect?: () => void
  onDequeue?: () => void
  onMerge?: () => void
  onPreview?: () => void
  isMerging?: boolean
}

function SortableStackItem({
  stack,
  onSelect,
  onDequeue,
  onMerge,
  onPreview,
  isMerging,
}: SortableStackItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stack.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const statusStyles = REVIEW_STATUS_STYLES[stack.reviewStatus]
  const statusLabel = REVIEW_STATUS_LABELS[stack.reviewStatus]
  const checkpointCount = stack.checkpoints.length

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-background p-3',
        isDragging && 'opacity-50 shadow-lg',
        statusStyles.border
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

      {/* Queue position */}
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
        {stack.queuePosition ?? '-'}
      </div>

      {/* Stack info */}
      <div className="flex-1 min-w-0" onClick={onSelect} role="button" tabIndex={0}>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium truncate">
            {stack.name || `Stack ${stack.id.slice(0, 8)}`}
          </span>
          <Badge
            variant="outline"
            className={cn('text-[10px]', statusStyles.background, statusStyles.text)}
          >
            {statusLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitCommit className="h-3 w-3" />
            {checkpointCount} checkpoint{checkpointCount !== 1 ? 's' : ''}
          </span>
          <span>{stack.targetBranch}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onPreview}
          title="Preview merge"
        >
          <Eye className="h-4 w-4" />
        </Button>
        {stack.reviewStatus === 'approved' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-green-600 hover:text-green-700"
            onClick={onMerge}
            disabled={isMerging}
            title="Execute merge"
          >
            {isMerging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onDequeue}
          title="Remove from queue"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
// Merge Preview Dialog
// =============================================================================

interface MergePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  stack: DiffStackWithCheckpoints | null
  result: MergeResult | null
  isLoading: boolean
  onConfirmMerge: () => void
}

function MergePreviewDialog({
  open,
  onOpenChange,
  stack,
  result,
  isLoading,
  onConfirmMerge,
}: MergePreviewDialogProps) {
  if (!stack) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Merge Preview
          </DialogTitle>
          <DialogDescription>
            Preview the merge for "{stack.name || `Stack ${stack.id.slice(0, 8)}`}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Running preview...</span>
            </div>
          ) : result ? (
            <>
              {/* Merge summary */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Target Branch</span>
                  <Badge variant="outline">{result.targetBranch}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Checkpoints to Merge</span>
                  <Badge variant="outline" className="text-green-600">
                    {result.mergedCheckpoints.length}
                  </Badge>
                </div>
                {result.skippedCheckpoints.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Skipped (already merged)</span>
                    <Badge variant="outline" className="text-muted-foreground">
                      {result.skippedCheckpoints.length}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Conflicts warning */}
              {result.conflicts && result.conflicts.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Merge conflicts detected</span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {result.conflicts.map((file, i) => (
                      <li key={i} className="text-muted-foreground">
                        • {file}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Success indicator */}
              {(!result.conflicts || result.conflicts.length === 0) && (
                <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3">
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="font-medium">Ready to merge</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No conflicts detected. This merge can proceed cleanly.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <span className="text-sm">Click "Preview" to see merge details</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirmMerge}
            disabled={isLoading || (result?.conflicts && result.conflicts.length > 0)}
          >
            <GitMerge className="mr-2 h-4 w-4" />
            Execute Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function StackMergeQueuePanel({
  defaultTargetBranch = 'main',
  targetBranches = ['main'],
  onStackSelect,
  className,
}: StackMergeQueuePanelProps) {
  // Filter state
  const [targetBranch, setTargetBranch] = useState(defaultTargetBranch)

  // Fetch queue data
  const {
    queue,
    isLoading,
    isError,
    error,
    refetch,
    dequeue,
    merge,
    isDequeuing,
  } = useMergeQueue(targetBranch)

  // Preview dialog state
  const [previewStack, setPreviewStack] = useState<DiffStackWithCheckpoints | null>(null)
  const [previewResult, setPreviewResult] = useState<MergeResult | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)

  // Dequeue confirmation
  const [dequeueStack, setDequeueStack] = useState<DiffStackWithCheckpoints | null>(null)

  // Merge state
  const [mergingStackId, setMergingStackId] = useState<string | null>(null)

  // Sort queue by position
  const sortedQueue = useMemo(() => {
    return [...queue].sort((a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999))
  }, [queue])

  // Sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle drag end - reorder would require API support
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Note: Reordering would require an API endpoint to update queue positions
    // For now, we just show the visual reorder but don't persist
    console.log('Reorder:', active.id, 'to position of', over.id)
  }, [])

  // Handle preview
  const handlePreview = useCallback(
    async (stack: DiffStackWithCheckpoints) => {
      setPreviewStack(stack)
      setPreviewResult(null)
      setIsPreviewing(true)

      try {
        const result = await merge(stack.id, true) // dry_run = true
        setPreviewResult(result)
      } catch {
        // Error handled by hook
      } finally {
        setIsPreviewing(false)
      }
    },
    [merge]
  )

  // Handle merge execution
  const handleMerge = useCallback(
    async (stack: DiffStackWithCheckpoints) => {
      setMergingStackId(stack.id)
      try {
        await merge(stack.id, false)
        refetch()
      } catch {
        // Error handled by hook
      } finally {
        setMergingStackId(null)
      }
    },
    [merge, refetch]
  )

  // Handle confirm merge from preview
  const handleConfirmMerge = useCallback(async () => {
    if (!previewStack) return
    await handleMerge(previewStack)
    setPreviewStack(null)
    setPreviewResult(null)
  }, [previewStack, handleMerge])

  // Handle dequeue
  const handleDequeue = useCallback(
    async (stack: DiffStackWithCheckpoints) => {
      try {
        await dequeue(stack.id)
        setDequeueStack(null)
        refetch()
      } catch {
        // Error handled by hook
      }
    },
    [dequeue, refetch]
  )

  return (
    <Card className={cn('h-full', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListOrdered className="h-4 w-4" />
            Merge Queue
            {queue.length > 0 && (
              <Badge variant="outline" className="ml-2">
                {queue.length}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Filters */}
        <div className="mt-2 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="target-branch" className="text-xs">
              Branch:
            </Label>
            <Select value={targetBranch} onValueChange={setTargetBranch}>
              <SelectTrigger id="target-branch" className="h-8 w-[120px]">
                <SelectValue />
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
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="mt-2 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Failed to load queue'}
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ListOrdered className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No stacks in the merge queue
            </p>
            <p className="text-xs text-muted-foreground">
              Approve a diff stack to add it to the queue
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedQueue.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {sortedQueue.map((stack) => (
                  <SortableStackItem
                    key={stack.id}
                    stack={stack}
                    onSelect={() => onStackSelect?.(stack.id)}
                    onDequeue={() => setDequeueStack(stack)}
                    onMerge={() => handleMerge(stack)}
                    onPreview={() => handlePreview(stack)}
                    isMerging={mergingStackId === stack.id}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>

      {/* Preview Dialog */}
      <MergePreviewDialog
        open={previewStack !== null}
        onOpenChange={(open) => !open && setPreviewStack(null)}
        stack={previewStack}
        result={previewResult}
        isLoading={isPreviewing}
        onConfirmMerge={handleConfirmMerge}
      />

      {/* Dequeue Confirmation */}
      <AlertDialog open={dequeueStack !== null} onOpenChange={(open) => !open && setDequeueStack(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Queue</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{dequeueStack?.name || `Stack ${dequeueStack?.id.slice(0, 8)}`}" from the merge queue?
              The stack will remain approved but will not be merged automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => dequeueStack && handleDequeue(dequeueStack)}
              disabled={isDequeuing}
            >
              {isDequeuing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export default StackMergeQueuePanel
