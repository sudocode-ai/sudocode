import { Navigate } from 'react-router-dom'
import { useProject } from '@/hooks/useProject'
import { buildProjectPath } from '@/hooks/useProjectRoutes'

/**
 * Smart default route that redirects based on project state
 * - If project is selected: redirect to /p/:projectId/issues (main app)
 * - If no project: redirect to /projects (project selection)
 */
export function DefaultRoute() {
  const { currentProjectId } = useProject()

  // If we have a current project, go to issues page with project in URL
  // Otherwise, go to projects page to select/open a project
  const target = currentProjectId ? buildProjectPath(currentProjectId, '/issues') : '/projects'

  return <Navigate to={target} replace />
}
