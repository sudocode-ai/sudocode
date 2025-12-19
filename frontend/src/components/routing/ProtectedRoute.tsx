import { useState, useEffect, useRef } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useProject } from '@/hooks/useProject'
import { projectsApi } from '@/lib/api'
import { Loader2 } from 'lucide-react'

/**
 * Route wrapper that requires a project to be selected.
 *
 * Now handles project ID from URL (/p/:projectId/...) and:
 * - Auto-switches project if URL project differs from context
 * - Validates the URL project exists and can be opened
 * - Redirects to /projects if no valid project
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { projectId: urlProjectId } = useParams<{ projectId: string }>()
  const { currentProjectId, setCurrentProjectId } = useProject()
  const location = useLocation()
  const queryClient = useQueryClient()

  const [isSwitching, setIsSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const switchAttemptedRef = useRef<string | null>(null)

  useEffect(() => {
    // If URL has projectId and it differs from context, sync them
    if (urlProjectId && urlProjectId !== currentProjectId) {
      // Prevent multiple switch attempts for the same project
      if (switchAttemptedRef.current === urlProjectId) {
        return
      }

      switchAttemptedRef.current = urlProjectId
      performProjectSwitch(urlProjectId)
    }
  }, [urlProjectId, currentProjectId])

  const performProjectSwitch = async (projectId: string) => {
    setIsSwitching(true)
    setSwitchError(null)

    try {
      // Validate project exists
      const project = await projectsApi.getById(projectId)

      // Check if open, open if needed
      const openProjects = await projectsApi.getOpen()
      if (!openProjects.some((p) => p.id === projectId)) {
        await projectsApi.open({ path: project.path })
      }

      // Update context (which also updates API client header)
      setCurrentProjectId(projectId)

      // Invalidate all queries for fresh data with new project
      await queryClient.invalidateQueries()
    } catch (error) {
      // Project doesn't exist or can't be opened
      console.error('Failed to switch to project:', projectId, error)
      setSwitchError('Project not found or could not be opened')
    } finally {
      setIsSwitching(false)
    }
  }

  // No project ID in URL or context - redirect to projects page
  if (!urlProjectId && !currentProjectId) {
    return <Navigate to="/projects" state={{ from: location }} replace />
  }

  // Project switch failed - redirect to projects page
  if (switchError) {
    return <Navigate to="/projects" state={{ from: location, error: switchError }} replace />
  }

  // Switching in progress - show loading state
  if (isSwitching) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Switching project...</p>
        </div>
      </div>
    )
  }

  // URL has projectId but context doesn't match yet (waiting for sync)
  if (urlProjectId && urlProjectId !== currentProjectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading project...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
