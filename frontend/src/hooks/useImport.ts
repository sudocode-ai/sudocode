import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  importApi,
  ImportOptions,
  ImportPreviewResponse,
  ImportResponse,
  ImportSearchRequest,
  ImportSearchResponse,
  BatchImportRequest,
  BatchImportResponse,
} from '@/lib/api'
import { useProject } from '@/hooks/useProject'

/**
 * Hook for fetching available import providers
 */
export function useImportProviders() {
  const { currentProjectId } = useProject()

  return useQuery({
    queryKey: ['import-providers', currentProjectId],
    queryFn: async () => {
      const result = await importApi.getProviders()
      return result.providers
    },
    enabled: !!currentProjectId,
    staleTime: 5 * 60 * 1000, // 5 minutes - providers don't change often
  })
}

/**
 * Hook for previewing an import from a URL
 */
export function useImportPreview() {
  const { currentProjectId } = useProject()

  return useMutation<ImportPreviewResponse, Error, string>({
    mutationFn: async (url: string) => {
      return importApi.preview(url)
    },
    mutationKey: ['import-preview', currentProjectId],
  })
}

/**
 * Hook for importing an entity from a URL
 */
export function useImport() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  return useMutation<ImportResponse, Error, { url: string; options?: ImportOptions }>({
    mutationFn: async ({ url, options }) => {
      return importApi.import(url, options)
    },
    mutationKey: ['import', currentProjectId],
    onSuccess: () => {
      // Invalidate specs list to show the newly imported spec
      queryClient.invalidateQueries({ queryKey: ['specs', currentProjectId] })
    },
  })
}

/**
 * Hook for searching entities in external systems
 */
export function useImportSearch() {
  const { currentProjectId } = useProject()

  return useMutation<ImportSearchResponse, Error, ImportSearchRequest>({
    mutationFn: async (params) => {
      return importApi.search(params)
    },
    mutationKey: ['import-search', currentProjectId],
  })
}

/**
 * Hook for batch importing entities with upsert behavior
 */
export function useBatchImport() {
  const queryClient = useQueryClient()
  const { currentProjectId } = useProject()

  return useMutation<BatchImportResponse, Error, BatchImportRequest>({
    mutationFn: async (params) => {
      return importApi.batchImport(params)
    },
    mutationKey: ['batch-import', currentProjectId],
    onSuccess: () => {
      // Invalidate specs list to show newly imported/updated specs
      queryClient.invalidateQueries({ queryKey: ['specs', currentProjectId] })
    },
  })
}
