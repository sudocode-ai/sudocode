import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/lib/api'
import type {
  ValidateProjectRequest,
  OpenProjectRequest,
  InitProjectRequest,
} from '@/types/project'

/**
 * Query keys for project-related queries
 */
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: () => [...projectKeys.lists()] as const,
  open: () => [...projectKeys.all, 'open'] as const,
  recent: () => [...projectKeys.all, 'recent'] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
}

/**
 * Hook to fetch all registered projects
 */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () => projectsApi.getAll(),
    staleTime: 30000, // 30 seconds
  })
}

/**
 * Hook to fetch currently open projects
 */
export function useOpenProjects() {
  return useQuery({
    queryKey: projectKeys.open(),
    queryFn: () => projectsApi.getOpen(),
    staleTime: 10000, // 10 seconds (more frequently updated)
  })
}

/**
 * Hook to fetch recent projects
 */
export function useRecentProjects() {
  return useQuery({
    queryKey: projectKeys.recent(),
    queryFn: () => projectsApi.getRecent(),
    staleTime: 30000, // 30 seconds
  })
}

/**
 * Hook to fetch a specific project by ID
 */
export function useProjectById(projectId: string | null) {
  return useQuery({
    queryKey: projectKeys.detail(projectId || ''),
    queryFn: () => projectsApi.getById(projectId!),
    enabled: !!projectId,
    staleTime: 30000, // 30 seconds
  })
}

/**
 * Hook to validate a project path
 */
export function useValidateProject() {
  return useMutation({
    mutationFn: (request: ValidateProjectRequest) => projectsApi.validate(request),
  })
}

/**
 * Hook to open a project
 */
export function useOpenProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: OpenProjectRequest) => projectsApi.open(request),
    onSuccess: () => {
      // Invalidate all project queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

/**
 * Hook to close a project
 */
export function useCloseProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) => projectsApi.close(projectId),
    onSuccess: () => {
      // Invalidate all project queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

/**
 * Hook to update project metadata (name, favorite status)
 */
export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: { name?: string; favorite?: boolean } }) =>
      projectsApi.update(projectId, data),
    onSuccess: (updatedProject) => {
      // Update cache for this specific project
      queryClient.setQueryData(projectKeys.detail(updatedProject.id), updatedProject)

      // Invalidate all project queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

/**
 * Hook to delete (unregister) a project
 */
export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: () => {
      // Invalidate all project queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

/**
 * Hook to initialize a new project
 */
export function useInitProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: InitProjectRequest) => projectsApi.init(request),
    onSuccess: () => {
      // Invalidate all project queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}
