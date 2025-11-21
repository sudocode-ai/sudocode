import { Navigate } from 'react-router-dom'
import { useProject } from '@/hooks/useProject'

/**
 * Smart default route that redirects based on project state
 * - If project is selected: redirect to /issues (main app)
 * - If no project: redirect to /projects (project selection)
 */
export function DefaultRoute() {
  const { currentProjectId } = useProject()

  // If we have a current project, go to issues page
  // Otherwise, go to projects page to select/open a project
  return <Navigate to={currentProjectId ? '/issues' : '/projects'} replace />
}
