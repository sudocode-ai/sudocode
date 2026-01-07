import { useQuery } from '@tanstack/react-query'
import { codevizApi, getCurrentProjectId, type FileTreeResponse } from '@/lib/api'
import { useProject } from '@/hooks/useProject'

/**
 * Hook for fetching the codebase file tree for visualization.
 *
 * Uses git ls-files under the hood for fast, accurate file listing
 * that respects .gitignore.
 */
export function useFileTree() {
  const { currentProjectId } = useProject()

  // Check if context projectId matches API client projectId
  const apiProjectId = getCurrentProjectId()
  const isProjectSynced = currentProjectId === apiProjectId

  return useQuery({
    queryKey: ['fileTree', currentProjectId],
    queryFn: () => codevizApi.getFileTree(),
    enabled: !!currentProjectId && isProjectSynced,
    staleTime: 60000, // 1 minute - file tree doesn't change often
    gcTime: 300000, // 5 minutes cache
  })
}

export type { FileTreeResponse }
