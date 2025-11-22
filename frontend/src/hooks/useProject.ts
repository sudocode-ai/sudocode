import { useProjectContext } from '@/contexts/ProjectContext'

/**
 * Hook to access the current project state
 *
 * Provides the currently selected project ID and functions to switch projects.
 * Re-exports the ProjectContext for convenient access.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { currentProjectId, setCurrentProjectId } = useProject()
 *
 *   if (!currentProjectId) {
 *     return <div>No project selected</div>
 *   }
 *
 *   return <div>Current project: {currentProjectId}</div>
 * }
 * ```
 */
export function useProject() {
  return useProjectContext()
}
