import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { ProjectInfo, OpenProjectInfo } from '@/types/project'
import { setCurrentProjectId as setApiProjectId, projectsApi } from '@/lib/api'

const PROJECT_ID_STORAGE_KEY = 'sudocode:currentProjectId'

export interface ProjectContextValue {
  /** Currently selected project ID */
  currentProjectId: string | null

  /** Set the current project ID and persist to localStorage */
  setCurrentProjectId: (projectId: string | null) => void

  /** Current project info (if available) */
  currentProject: ProjectInfo | null

  /** Set the current project info */
  setCurrentProject: (project: ProjectInfo | null) => void

  /** Clear the current project */
  clearProject: () => void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export interface ProjectProviderProps {
  children: ReactNode
  /** Default project ID (for testing or SSR) */
  defaultProjectId?: string | null
}

export function ProjectProvider({ children, defaultProjectId }: ProjectProviderProps) {
  // Initialize from localStorage or default
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(() => {
    if (defaultProjectId !== undefined) {
      return defaultProjectId
    }

    try {
      const stored = localStorage.getItem(PROJECT_ID_STORAGE_KEY)
      return stored || null
    } catch (error) {
      console.error('Failed to read project ID from localStorage:', error)
      return null
    }
  })

  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null)
  const [isValidatingProject, setIsValidatingProject] = useState(false)

  // Validate and auto-open last selected project on mount
  useEffect(() => {
    const validateStoredProject = async () => {
      // Skip if no stored project ID or already validated
      if (!currentProjectId || isValidatingProject) {
        return
      }

      setIsValidatingProject(true)

      try {
        // Check if the project is still open on the backend
        const openProjects = await projectsApi.getOpen()
        const isOpen = openProjects.some((p: OpenProjectInfo) => p.id === currentProjectId)

        if (!isOpen) {
          // Project is no longer open, try to fetch project info and re-open it
          try {
            const projectInfo = await projectsApi.getById(currentProjectId)
            // Project exists but isn't open - open it
            await projectsApi.open({ path: projectInfo.path })
          } catch (error) {
            // Project doesn't exist or can't be opened, clear it
            console.warn('Stored project no longer available, clearing:', currentProjectId)
            setCurrentProjectIdState(null)
          }
        }
      } catch (error) {
        console.error('Failed to validate stored project:', error)
        // Don't clear on network errors, let user try again
      } finally {
        setIsValidatingProject(false)
      }
    }

    validateStoredProject()
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist to localStorage and update API client whenever currentProjectId changes
  useEffect(() => {
    try {
      if (currentProjectId) {
        localStorage.setItem(PROJECT_ID_STORAGE_KEY, currentProjectId)
      } else {
        localStorage.removeItem(PROJECT_ID_STORAGE_KEY)
      }
    } catch (error) {
      console.error('Failed to persist project ID to localStorage:', error)
    }

    // Update API client to inject X-Project-ID header
    setApiProjectId(currentProjectId)
  }, [currentProjectId])

  const setCurrentProjectId = (projectId: string | null) => {
    setCurrentProjectIdState(projectId)

    // Clear project info when switching projects
    // (will be refetched by useProject hook)
    if (projectId !== currentProjectId) {
      setCurrentProject(null)
    }
  }

  const clearProject = () => {
    setCurrentProjectIdState(null)
    setCurrentProject(null)
  }

  const value: ProjectContextValue = {
    currentProjectId,
    setCurrentProjectId,
    currentProject,
    setCurrentProject,
    clearProject,
  }

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

/**
 * Hook to access the current project context
 * @throws Error if used outside ProjectProvider
 */
export function useProjectContext(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProjectContext must be used within ProjectProvider')
  }
  return context
}
