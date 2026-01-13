/**
 * BatchesPanel - Main panel for managing PR batches
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Plus, GitPullRequest, RefreshCw } from 'lucide-react'
import { useBatches, useBatchMutations, useBatchStats } from '@/hooks/useBatches'
import { useQueue } from '@/hooks/useQueue'
import { BatchCard } from './BatchCard'
import { BatchDialog } from './BatchDialog'
import type { PRBatch, BatchPRStatus, CreateBatchRequest } from '@/types/batch'

interface BatchesPanelProps {
  /** Available target branches */
  branches?: string[]
}

export function BatchesPanel({ branches = ['main'] }: BatchesPanelProps) {
  // Filters
  const [statusFilter, setStatusFilter] = useState<BatchPRStatus | 'all'>('all')
  const [branchFilter, setBranchFilter] = useState<string>('all')

  // Dialog state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingBatch, setEditingBatch] = useState<PRBatch | null>(null)
  const [deletingBatch, setDeletingBatch] = useState<PRBatch | null>(null)

  // Data hooks
  const { data, isLoading, error, refetch } = useBatches({
    prStatus: statusFilter !== 'all' ? statusFilter : undefined,
    targetBranch: branchFilter !== 'all' ? branchFilter : undefined,
  })

  const { data: queueData } = useQueue()
  const stats = useBatchStats()

  const {
    createBatch,
    updateBatch,
    deleteBatch,
    createPR,
    syncStatus,
    isCreating,
    isUpdating,
    isDeleting,
    isCreatingPR,
  } = useBatchMutations()

  // Handlers
  const handleCreate = (formData: CreateBatchRequest | { title?: string; description?: string }) => {
    // For create, we need full CreateBatchRequest with entry_ids
    if (!('entry_ids' in formData)) return
    createBatch.mutate(formData, {
      onSuccess: () => setIsCreateDialogOpen(false),
    })
  }

  const handleUpdate = (formData: CreateBatchRequest | { title?: string; description?: string }) => {
    if (!editingBatch) return
    // For update, we only use title and description
    const updateData = {
      title: formData.title,
      description: formData.description,
    }
    updateBatch.mutate(
      { id: editingBatch.id, data: updateData },
      { onSuccess: () => setEditingBatch(null) }
    )
  }

  const handleDelete = () => {
    if (!deletingBatch) return
    deleteBatch.mutate(deletingBatch.id, {
      onSuccess: () => setDeletingBatch(null),
    })
  }

  const handleCreatePR = (batch: PRBatch) => {
    createPR.mutate({ id: batch.id, draft: batch.is_draft_pr })
  }

  const handleSyncStatus = (batch: PRBatch) => {
    syncStatus.mutate(batch.id)
  }

  const handleViewPR = (batch: PRBatch) => {
    if (batch.pr_url) {
      window.open(batch.pr_url, '_blank', 'noopener,noreferrer')
    }
  }

  const batches = data?.batches || []
  const availableEntries = queueData?.entries || []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            PR Batches
          </h2>
          {!isLoading && (
            <Badge variant="secondary">{stats.total} total</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New Batch
          </Button>
        </div>
      </div>

      {/* Stats badges */}
      {!isLoading && stats.total > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.draft > 0 && (
            <Badge variant="outline" className="text-gray-600">
              {stats.draft} draft
            </Badge>
          )}
          {stats.open > 0 && (
            <Badge variant="outline" className="text-green-600">
              {stats.open} open
            </Badge>
          )}
          {stats.approved > 0 && (
            <Badge variant="outline" className="text-blue-600">
              {stats.approved} approved
            </Badge>
          )}
          {stats.merged > 0 && (
            <Badge variant="outline" className="text-purple-600">
              {stats.merged} merged
            </Badge>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as BatchPRStatus | 'all')}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="merged">Merged</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Branch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch}>
                {branch}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-center">
          <p className="text-sm text-destructive">
            Failed to load batches: {error.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2">
            Retry
          </Button>
        </div>
      ) : batches.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <GitPullRequest className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-medium">No batches yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a batch to group queue entries for review
          </p>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="mt-4">
            <Plus className="mr-1 h-4 w-4" />
            Create First Batch
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {batches.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              onEdit={() => setEditingBatch(batch)}
              onDelete={() => setDeletingBatch(batch)}
              onCreatePR={() => handleCreatePR(batch)}
              onSyncStatus={() => handleSyncStatus(batch)}
              onViewPR={() => handleViewPR(batch)}
              isLoading={isCreatingPR}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <BatchDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        availableEntries={availableEntries}
        onSave={handleCreate}
        isSaving={isCreating}
        branches={branches}
      />

      {/* Edit Dialog */}
      <BatchDialog
        isOpen={!!editingBatch}
        onClose={() => setEditingBatch(null)}
        batch={editingBatch}
        availableEntries={[]}
        onSave={handleUpdate}
        isSaving={isUpdating}
        branches={branches}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingBatch} onOpenChange={() => setDeletingBatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Batch</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the batch "{deletingBatch?.title}"?
              {deletingBatch?.pr_number && (
                <span className="block mt-2 text-yellow-600 dark:text-yellow-400">
                  This batch has an associated PR (#{deletingBatch.pr_number}) which will not be deleted.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
