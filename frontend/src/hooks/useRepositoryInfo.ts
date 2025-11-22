import { useQuery } from '@tanstack/react-query'
import { repositoryApi } from '@/lib/api'
import { useProject } from './useProject'

/**
 * Hook for fetching repository information for the current project
 */
export function useRepositoryInfo() {
  const { currentProjectId } = useProject()

  return useQuery({
    queryKey: ['repository-info', currentProjectId],
    queryFn: repositoryApi.getInfo,
    enabled: !!currentProjectId, // Only fetch if we have a current project
    staleTime: 60000, // 1 minute - repo info doesn't change often
    retry: false, // Don't retry if not a git repo
  })
}
