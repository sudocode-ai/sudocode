/**
 * Hooks for PR batch management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { batchApi, getCurrentProjectId } from '@/lib/api'
import { useProject } from '@/hooks/useProject'
import { toast } from 'sonner'
import type {
  CreateBatchRequest,
  UpdateBatchRequest,
  ListBatchesOptions,
  BatchPRStatus,
} from '@/types/batch'

/**
 * Hook to fetch all batches
 */
export function useBatches(options?: ListBatchesOptions) {
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['batches', currentProjectId, options],
    queryFn: () => batchApi.getAll(options),
    enabled: !!currentProjectId && isProjectSynced,
  })
}

/**
 * Hook to fetch a single batch by ID
 */
export function useBatch(batchId: string | null | undefined, includeEntries = true) {
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['batch', batchId, currentProjectId, includeEntries],
    queryFn: () => batchApi.getById(batchId!, includeEntries),
    enabled: !!batchId && !!currentProjectId && isProjectSynced,
  })
}

/**
 * Hook to preview batch contents
 */
export function useBatchPreview(batchId: string | null | undefined) {
  const { currentProjectId } = useProject()
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['batch-preview', batchId, currentProjectId],
    queryFn: () => batchApi.preview(batchId!),
    enabled: !!batchId && !!currentProjectId && isProjectSynced,
  })
}

/**
 * Hook for batch mutations (create, update, delete, PR operations)
 */
export function useBatchMutations() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  const invalidateBatches = () => {
    queryClient.invalidateQueries({ queryKey: ['batches', currentProjectId] })
  }

  const invalidateBatch = (batchId: string) => {
    queryClient.invalidateQueries({ queryKey: ['batch', batchId, currentProjectId] })
  }

  const createBatch = useMutation({
    mutationFn: (data: CreateBatchRequest) => batchApi.create(data),
    onSuccess: (response) => {
      invalidateBatches()
      toast.success(`Batch "${response.batch.title}" created`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to create batch: ${error.message}`)
    },
  })

  const updateBatch = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBatchRequest }) =>
      batchApi.update(id, data),
    onSuccess: (response) => {
      invalidateBatches()
      invalidateBatch(response.batch.id)
      toast.success('Batch updated')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update batch: ${error.message}`)
    },
  })

  const deleteBatch = useMutation({
    mutationFn: (id: string) => batchApi.delete(id),
    onSuccess: (_result, deletedId) => {
      invalidateBatches()
      queryClient.removeQueries({ queryKey: ['batch', deletedId, currentProjectId] })
      toast.success('Batch deleted')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete batch: ${error.message}`)
    },
  })

  const createPR = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft?: boolean }) =>
      batchApi.createPR(id, draft),
    onSuccess: (response) => {
      invalidateBatches()
      invalidateBatch(response.batch.id)
      toast.success(`PR created: ${response.pr_url}`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to create PR: ${error.message}`)
    },
  })

  const promoteBatch = useMutation({
    mutationFn: ({ id, autoMerge }: { id: string; autoMerge?: boolean }) =>
      batchApi.promote(id, autoMerge),
    onSuccess: (result) => {
      invalidateBatches()
      // Also invalidate queue since entries may have been promoted
      queryClient.invalidateQueries({ queryKey: ['queue', currentProjectId] })
      if (result.success) {
        toast.success(`Promoted ${result.promoted_count} entries`)
      } else {
        toast.warning(`Promoted ${result.promoted_count} entries, ${result.failed_count} failed`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to promote batch: ${error.message}`)
    },
  })

  const syncStatus = useMutation({
    mutationFn: (id: string) => batchApi.syncStatus(id),
    onSuccess: (response) => {
      invalidateBatches()
      invalidateBatch(response.batch.id)
      toast.success(`PR status: ${response.status}`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to sync PR status: ${error.message}`)
    },
  })

  const validateEntries = useMutation({
    mutationFn: (entryIds: string[]) => batchApi.validate(entryIds),
    onError: (error: Error) => {
      toast.error(`Validation failed: ${error.message}`)
    },
  })

  return {
    createBatch,
    updateBatch,
    deleteBatch,
    createPR,
    promoteBatch,
    syncStatus,
    validateEntries,
    isCreating: createBatch.isPending,
    isUpdating: updateBatch.isPending,
    isDeleting: deleteBatch.isPending,
    isCreatingPR: createPR.isPending,
    isPromoting: promoteBatch.isPending,
  }
}

/**
 * Hook for computing batch statistics from the list
 */
export function useBatchStats() {
  const { data, isLoading } = useBatches()

  if (isLoading || !data) {
    return {
      total: 0,
      draft: 0,
      open: 0,
      approved: 0,
      merged: 0,
      closed: 0,
      isLoading,
    }
  }

  const batches = data.batches
  const countByStatus = (status: BatchPRStatus) => batches.filter((b) => b.pr_status === status).length

  return {
    total: batches.length,
    draft: countByStatus('draft'),
    open: countByStatus('open'),
    approved: countByStatus('approved'),
    merged: countByStatus('merged'),
    closed: countByStatus('closed'),
    isLoading: false,
  }
}
