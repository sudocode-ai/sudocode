/**
 * MergeQueuePanel - Display and manage the merge queue
 *
 * Shows queue entries grouped by stack with filtering and drag-and-drop reordering.
 */

import { useMemo, useState } from 'react'
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
} from '@dnd-kit/sortable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  TooltipProvider,
} from '@/components/ui/tooltip'
import {
  ListOrdered,
  Layers,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { useQueue, useQueueMutations, groupQueueByStack } from '@/hooks/useQueue'
import { usePromote } from '@/hooks/usePromote'
import { QueueEntryCard } from './QueueEntryCard'
import type { EnrichedQueueEntry } from '@/types/queue'

interface MergeQueuePanelProps {
  /** Default target branch to filter by */
  defaultTargetBranch?: string
  /** Available target branches */
  targetBranches?: string[]
}

export function MergeQueuePanel({
  defaultTargetBranch = 'main',
  targetBranches = ['main'],
}: MergeQueuePanelProps) {
  // Filter state
  const [targetBranch, setTargetBranch] = useState(defaultTargetBranch)
  const [showMerged, setShowMerged] = useState(false)
  const [expandedStacks, setExpandedStacks] = useState<Set<string | null>>(new Set())

  // Fetch queue data
  const { entries, stats, isLoading, isError, error, refetch } = useQueue({
    targetBranch,
    includeMerged: showMerged,
  })

  const { reorder, isReordering } = useQueueMutations()
  const { performPromote } = usePromote()

  // Group entries by stack
  const stackGroups = useMemo(() => groupQueueByStack(entries), [entries])

  // Sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle drag end within a stack group
  const handleDragEnd = (stackId: string | null) => (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id) return

    // Find the entries in this stack
    const group = stackGroups.find((g) => g.stackId === stackId)
    if (!group) return

    const activeEntry = group.entries.find((e) => e.id === active.id)
    if (!activeEntry) return

    // Calculate new position based on where it was dropped
    const overEntry = group.entries.find((e) => e.id === over.id)
    if (!overEntry) return

    const newPosition = overEntry.position

    // Execute reorder
    reorder({
      executionId: activeEntry.executionId,
      newPosition,
      targetBranch,
    })
  }

  // Handle promote
  const handlePromote = (entry: EnrichedQueueEntry) => {
    performPromote(entry.issueId)
    // Refetch after a short delay to allow mutation to complete
    setTimeout(() => refetch(), 1000)
  }

  // Toggle stack expansion
  const toggleStack = (stackId: string | null) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev)
      if (next.has(stackId)) {
        next.delete(stackId)
      } else {
        next.add(stackId)
      }
      return next
    })
  }

  // Expand all by default initially
  useMemo(() => {
    if (stackGroups.length > 0 && expandedStacks.size === 0) {
      setExpandedStacks(new Set(stackGroups.map((g) => g.stackId)))
    }
  }, [stackGroups.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TooltipProvider>
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-4 w-4" />
              Merge Queue
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
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {/* Target branch selector */}
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

            {/* Show merged toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="show-merged"
                checked={showMerged}
                onCheckedChange={setShowMerged}
              />
              <Label htmlFor="show-merged" className="text-xs">
                Show merged
              </Label>
            </div>

            {/* Stats */}
            {stats && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{stats.total} total</Badge>
                {stats.byStatus.pending > 0 && (
                  <Badge variant="outline">{stats.byStatus.pending} pending</Badge>
                )}
                {stats.byStatus.ready > 0 && (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {stats.byStatus.ready} ready
                  </Badge>
                )}
              </div>
            )}
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
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ListOrdered className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No items in the merge queue
              </p>
              <p className="text-xs text-muted-foreground">
                Checkpoint an execution to add it to the queue
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {stackGroups.map((group) => {
                const isExpanded = expandedStacks.has(group.stackId)
                const groupKey = group.stackId ?? 'standalone'

                return (
                  <Collapsible
                    key={groupKey}
                    open={isExpanded}
                    onOpenChange={() => toggleStack(group.stackId)}
                  >
                    {/* Stack header */}
                    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md bg-muted/50 p-2 hover:bg-muted">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {group.stackId ? group.stackName || group.stackId : 'Standalone Items'}
                      </span>
                      <Badge variant="outline" className="ml-auto">
                        {group.entries.length}
                      </Badge>
                    </CollapsibleTrigger>

                    {/* Stack entries */}
                    <CollapsibleContent>
                      <div className="mt-2 space-y-2 pl-6">
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleDragEnd(group.stackId)}
                        >
                          <SortableContext
                            items={group.entries.map((e) => e.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {group.entries.map((entry) => (
                              <QueueEntryCard
                                key={entry.id}
                                entry={entry}
                                isDraggable={group.stackId !== null && !isReordering}
                                onPromote={
                                  entry.canPromote
                                    ? () => handlePromote(entry)
                                    : undefined
                                }
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}
