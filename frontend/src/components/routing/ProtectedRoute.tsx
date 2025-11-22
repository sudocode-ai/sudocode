import { Navigate, useLocation } from 'react-router-dom'
import { useProject } from '@/hooks/useProject'

/**
 * Route wrapper that requires a project to be selected
 * Redirects to /projects if no project is currently selected
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { currentProjectId } = useProject()
  const location = useLocation()

  if (!currentProjectId) {
    // Redirect to projects page, preserving the intended destination
    return <Navigate to="/projects" state={{ from: location }} replace />
  }

  return <>{children}</>
}
