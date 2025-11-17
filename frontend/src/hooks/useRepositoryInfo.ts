import { useQuery } from '@tanstack/react-query'
import { repositoryApi } from '@/lib/api'

/**
 * Hook for fetching repository information
 */
export function useRepositoryInfo() {
  return useQuery({
    queryKey: ['repository-info'],
    queryFn: repositoryApi.getInfo,
    staleTime: 60000, // 1 minute - repo info doesn't change often
    retry: false, // Don't retry if not a git repo
  })
}
