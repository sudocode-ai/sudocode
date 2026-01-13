/**
 * StacksPage - Combined page for Stacks, Queue, and Batches
 *
 * Phase 3: Stacks tab with stack visualization
 * Phase 4: Queue tab (placeholder)
 * Phase 5: Batches tab (placeholder)
 */

import { useState, useMemo } from 'react'
import { useStacks, useStackMutations } from '@/hooks/useStacks'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { StackPanel } from '@/components/stacks/StackPanel'
import { Loader2, Layers, ListOrdered, Package, Plus, GitBranch } from 'lucide-react'

/**
 * Stacks tab content - displays auto and manual stacks with StackPanel
 */
function StacksTabContent() {
  const { data, isLoading, isError, error } = useStacks()
  const { reorderStack, removeFromStack } = useStackMutations()

  // Separate auto and manual stacks
  const { autoStacks, manualStacks } = useMemo(() => {
    const stacks = data?.stacks || []
    return {
      autoStacks: stacks.filter((s) => s.stack.is_auto),
      manualStacks: stacks.filter((s) => !s.stack.is_auto),
    }
  }, [data?.stacks])

  const handleReorder = (stackId: string, issueOrder: string[]) => {
    reorderStack.mutate({ stackId, issueOrder })
  }

  const handleRemove = (stackId: string, issueId: string) => {
    removeFromStack.mutate({ stackId, issueIds: [issueId] })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">
          Error loading stacks: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    )
  }

  const totalStacks = (data?.stacks || []).length
  const autoCount = data?.auto_count || 0
  const manualCount = data?.manual_count || 0

  if (totalStacks === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Layers className="h-12 w-12 text-muted-foreground" />
        <div className="text-center">
          <h3 className="font-medium">No stacks yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Stacks are automatically created from issue dependencies,
            <br />
            or you can create them manually.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <GitBranch className="h-4 w-4" />
          {autoCount} auto-detected
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-4 w-4" />
          {manualCount} manual
        </span>
      </div>

      {/* Auto-detected Stacks */}
      {autoStacks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Auto-detected ({autoStacks.length})
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {autoStacks.map((stackInfo) => (
              <StackPanel
                key={stackInfo.stack.id}
                stackInfo={stackInfo}
                isManual={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Manual Stacks */}
      {manualStacks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Manual Stacks ({manualStacks.length})
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {manualStacks.map((stackInfo) => (
              <StackPanel
                key={stackInfo.stack.id}
                stackInfo={stackInfo}
                isManual={true}
                onReorder={(issueOrder) => handleReorder(stackInfo.stack.id, issueOrder)}
                onRemove={(issueId) => handleRemove(stackInfo.stack.id, issueId)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Queue tab placeholder
 */
function QueueTabContent() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <ListOrdered className="h-12 w-12 text-muted-foreground" />
      <div className="text-center">
        <h3 className="font-medium">Merge Queue</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Coming in Phase 4
        </p>
      </div>
    </div>
  )
}

/**
 * Batches tab placeholder
 */
function BatchesTabContent() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <Package className="h-12 w-12 text-muted-foreground" />
      <div className="text-center">
        <h3 className="font-medium">PR Batches</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Coming in Phase 5
        </p>
      </div>
    </div>
  )
}

/**
 * Main StacksPage component
 */
export default function StacksPage() {
  const [activeTab, setActiveTab] = useState<string>('stacks')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h1 className="text-2xl font-semibold">Stacks & Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage stacked diffs and merge coordination
          </p>
        </div>
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          New Stack
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="px-6 pt-4 border-b">
            <TabsList>
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
