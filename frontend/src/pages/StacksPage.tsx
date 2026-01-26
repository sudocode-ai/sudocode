/**
 * StacksPage - Combined page for Checkpoint DAG, Diff Stacks, Queue, and Batches
 *
 * Tab structure:
 * - Checkpoints: DAG visualization with multi-select for stack creation
 * - Stacks: List of diff stacks with review workflow
 * - Queue: Merge queue management
 * - Batches: PR batch management (legacy)
 */

import { useState, useMemo, useCallback } from 'react'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { useCheckpointDAG, useDiffStacks } from '@/hooks/useCheckpointDAG'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckpointDAG } from '@/components/stacks/CheckpointDAG'
import { StackCreationPanel } from '@/components/stacks/StackCreationPanel'
import { StackReviewPanel } from '@/components/stacks/StackReviewPanel'
import { StackMergeQueuePanel } from '@/components/stacks/StackMergeQueuePanel'
import { BatchesPanel } from '@/components/batches'
import {
  Loader2,
  Layers,
  ListOrdered,
  Package,
  GitCommit,
  ArrowLeft,
  Check,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  REVIEW_STATUS_STYLES,
  REVIEW_STATUS_LABELS,
  type DataplaneCheckpoint,
  type DiffStackWithCheckpoints,
  type DiffStack,
} from '@/types/checkpoint'

// =============================================================================
// Checkpoints Tab - DAG + Stack Creation
// =============================================================================

function CheckpointsTabContent() {
  const { checkpoints, streams, diffStacks, checkpointStats, isLoading, isError, error } =
    useCheckpointDAG({ includeStats: true })

  // Selection state
  const [selectedCheckpointIds, setSelectedCheckpointIds] = useState<string[]>([])

  // Convert to lookup for StackCreationPanel
  const checkpointsById = useMemo(() => {
    const map: Record<string, DataplaneCheckpoint> = {}
    for (const cp of checkpoints) {
      map[cp.id] = cp
    }
    return map
  }, [checkpoints])

  // Handle stack created
  const handleStackCreated = useCallback((_stack: DiffStack) => {
    setSelectedCheckpointIds([])
    // Could navigate to stack review or show toast
  }, [])

  // Handle cancel
  const handleCancel = useCallback(() => {
    setSelectedCheckpointIds([])
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">
          Error loading checkpoints: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    )
  }

  if (checkpoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <GitCommit className="h-12 w-12 text-muted-foreground" />
        <div className="text-center">
          <h3 className="font-medium">No checkpoints yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Checkpoints are created when agents complete work.
            <br />
            They capture code changes at specific points in time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-4">
      {/* DAG View */}
      <div className="flex-1 min-w-0">
        <CheckpointDAG
          checkpoints={checkpoints}
          streams={streams}
          diffStacks={diffStacks}
          checkpointStats={checkpointStats}
          selectedCheckpointIds={selectedCheckpointIds}
          onSelectionChange={setSelectedCheckpointIds}
          className="h-full rounded-lg border"
        />
      </div>

      {/* Stack Creation Panel (appears when checkpoints selected) */}
      <div className="w-80 shrink-0">
        <StackCreationPanel
          selectedCheckpointIds={selectedCheckpointIds}
          checkpoints={checkpointsById}
          targetBranches={['main']}
          onStackCreated={handleStackCreated}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}

// =============================================================================
// Stacks Tab - List + Review
// =============================================================================

interface StackListItemProps {
  stack: DiffStackWithCheckpoints
  onSelect: () => void
}

function StackListItem({ stack, onSelect }: StackListItemProps) {
  const statusStyles = REVIEW_STATUS_STYLES[stack.reviewStatus]
  const statusLabel = REVIEW_STATUS_LABELS[stack.reviewStatus]

  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium truncate">
          {stack.name || `Stack ${stack.id.slice(0, 8)}`}
        </span>
        <Badge
          variant="outline"
          className={cn('text-xs', statusStyles.background, statusStyles.text)}
        >
          {statusLabel}
        </Badge>
      </div>
      {stack.description && (
        <p className="text-sm text-muted-foreground truncate mb-2">{stack.description}</p>
      )}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <GitCommit className="h-3 w-3" />
          {stack.checkpoints.length} checkpoint{stack.checkpoints.length !== 1 ? 's' : ''}
        </span>
        <span>{stack.targetBranch}</span>
        <span>{new Date(stack.createdAt).toLocaleDateString()}</span>
      </div>
    </button>
  )
}

function StacksTabContent() {
  const { stacks, isLoading, isError, error } = useDiffStacks({ includeCheckpoints: true })
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null)

  // Filter by status
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filteredStacks = useMemo(() => {
    if (statusFilter === 'all') return stacks
    return stacks.filter((s) => s.reviewStatus === statusFilter)
  }, [stacks, statusFilter])

  // Group by status for summary
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      merged: 0,
      abandoned: 0,
    }
    for (const stack of stacks) {
      counts[stack.reviewStatus] = (counts[stack.reviewStatus] || 0) + 1
    }
    return counts
  }, [stacks])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">
          Error loading stacks: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    )
  }

  // Show review panel if a stack is selected
  if (selectedStackId) {
    return (
      <div className="h-full flex flex-col">
        <div className="mb-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedStackId(null)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Stacks
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <StackReviewPanel
            stackId={selectedStackId}
            onReviewComplete={() => setSelectedStackId(null)}
            onBack={() => setSelectedStackId(null)}
            className="h-full"
          />
        </div>
      </div>
    )
  }

  if (stacks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Layers className="h-12 w-12 text-muted-foreground" />
        <div className="text-center">
          <h3 className="font-medium">No diff stacks yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Create a stack from the Checkpoints tab by selecting
            <br />
            checkpoints in the DAG and clicking "Create Stack".
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={statusFilter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('all')}
        >
          All ({stacks.length})
        </Button>
        {statusCounts.pending > 0 && (
          <Button
            variant={statusFilter === 'pending' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('pending')}
          >
            Pending ({statusCounts.pending})
          </Button>
        )}
        {statusCounts.approved > 0 && (
          <Button
            variant={statusFilter === 'approved' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('approved')}
            className={statusFilter === 'approved' ? '' : 'text-green-600'}
          >
            <Check className="h-3 w-3 mr-1" />
            Approved ({statusCounts.approved})
          </Button>
        )}
        {statusCounts.merged > 0 && (
          <Button
            variant={statusFilter === 'merged' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('merged')}
            className={statusFilter === 'merged' ? '' : 'text-purple-600'}
          >
            Merged ({statusCounts.merged})
          </Button>
        )}
      </div>

      {/* Stack list */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filteredStacks.map((stack) => (
          <StackListItem
            key={stack.id}
            stack={stack}
            onSelect={() => setSelectedStackId(stack.id)}
          />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Queue Tab - Merge Queue
// =============================================================================

function QueueTabContent() {
  const { data: repoInfo } = useRepositoryInfo()

  // Get branches from repo info
  const targetBranches = useMemo(() => {
    const branches = ['main']
    if (repoInfo?.branch && !branches.includes(repoInfo.branch)) {
      branches.push(repoInfo.branch)
    }
    return branches.sort()
  }, [repoInfo?.branch])

  return (
    <StackMergeQueuePanel
      defaultTargetBranch="main"
      targetBranches={targetBranches}
      className="h-full"
    />
  )
}

// =============================================================================
// Batches Tab (Legacy)
// =============================================================================

function BatchesTabContent() {
  const { data: repoInfo } = useRepositoryInfo()

  const targetBranches = useMemo(() => {
    const branches = ['main']
    if (repoInfo?.branch && !branches.includes(repoInfo.branch)) {
      branches.push(repoInfo.branch)
    }
    return branches
  }, [repoInfo?.branch])

  return <BatchesPanel branches={targetBranches} />
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function StacksPage() {
  const [activeTab, setActiveTab] = useState<string>('checkpoints')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h1 className="text-2xl font-semibold">Diff Stacks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and review stacked diffs for merge coordination
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="px-6 pt-4 border-b">
            <TabsList>
              <TabsTrigger value="checkpoints" className="gap-2">
                <GitCommit className="h-4 w-4" />
                Checkpoints
              </TabsTrigger>
              <TabsTrigger value="stacks" className="gap-2">
                <Layers className="h-4 w-4" />
                Stacks
              </TabsTrigger>
              <TabsTrigger value="queue" className="gap-2">
                <ListOrdered className="h-4 w-4" />
                Queue
              </TabsTrigger>
              <TabsTrigger value="batches" className="gap-2">
                <Package className="h-4 w-4" />
                Batches
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-auto p-6">
            <TabsContent value="checkpoints" className="mt-0 h-full">
              <CheckpointsTabContent />
            </TabsContent>

            <TabsContent value="stacks" className="mt-0 h-full">
              <StacksTabContent />
            </TabsContent>

            <TabsContent value="queue" className="mt-0 h-full">
              <QueueTabContent />
            </TabsContent>

            <TabsContent value="batches" className="mt-0 h-full">
              <BatchesTabContent />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}
