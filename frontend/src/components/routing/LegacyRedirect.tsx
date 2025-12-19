/**
 * LegacyRedirect - Redirects old URL patterns to new project-scoped URLs
 *
 * Handles redirects like:
 * - /issues -> /p/:projectId/issues
 * - /specs/:id -> /p/:projectId/specs/:id
 * - /executions/:id -> /p/:projectId/executions/:id
 */

import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useProject } from '@/hooks/useProject'
import { buildProjectPath } from '@/hooks/useProjectRoutes'

export function LegacyRedirect() {
  const location = useLocation()
  const { currentProjectId } = useProject()
  const params = useParams<{ '*': string }>()

  // If no project is selected, redirect to projects page
  if (!currentProjectId) {
    return <Navigate to="/projects" replace />
  }

  // Build the new path with the project ID
  // The wildcard param captures everything after the matched path
  const remainingPath = params['*'] || ''
  const basePath = location.pathname.replace(`/${remainingPath}`, '').replace(/\/$/, '')
  const fullPath = remainingPath ? `${basePath}/${remainingPath}` : basePath

  const newPath = buildProjectPath(currentProjectId, fullPath)

  // Preserve search params and hash
  const search = location.search
  const hash = location.hash

  return <Navigate to={`${newPath}${search}${hash}`} replace />
}
