import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Check, FolderOpen, Settings as SettingsIcon } from 'lucide-react'
import { useProject } from '@/hooks/useProject'
import { useRecentProjects, useProjectById } from '@/hooks/useProjects'
import { projectsApi } from '@/lib/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ProjectSwitcherProps {
  className?: string
  collapsed?: boolean
}

export function ProjectSwitcher({ className, collapsed = false }: ProjectSwitcherProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { currentProjectId, setCurrentProjectId, currentProject } = useProject()
  const { data: recentProjects, isLoading: loadingRecent } = useRecentProjects()
  const { data: projectDetails } = useProjectById(currentProjectId)

  const [switching, setSwitching] = useState(false)
  const [open, setOpen] = useState(false)

  // Use projectDetails if available, otherwise use currentProject from context
  const displayProject = projectDetails || currentProject

  // Handle keyboard shortcut (Cmd+P or Ctrl+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleProjectSwitch = async (projectId: string) => {
    // If clicking on already-selected project, just navigate to issues
    if (projectId === currentProjectId) {
      setOpen(false)
      navigate('/issues')
      return
    }

    setSwitching(true)

    try {
      // Get the project we're switching to
      const targetProject = recentProjects?.find((p) => p.id === projectId)

      if (targetProject) {
        // Check if the project is already open
        const openProjects = await projectsApi.getOpen()
        const isOpen = openProjects.some((p) => p.id === projectId)

        // If not open, open it before switching
        if (!isOpen) {
          await projectsApi.open({ path: targetProject.path })
        }
      }

      // Update current project (this also updates the API client synchronously)
      setCurrentProjectId(projectId)

      // Invalidate all queries to trigger refetch with new project
      await queryClient.invalidateQueries()

      // Navigate to issues page for the new project
      navigate('/issues')

      // Small delay to show loading state
      await new Promise((resolve) => setTimeout(resolve, 300))

      setOpen(false)
    } catch (error) {
      console.error('Failed to switch project:', error)
    } finally {
      setSwitching(false)
    }
  }

  const handleManageProjects = () => {
    setOpen(false)
    navigate('/projects')
  }

  // If no project selected, show "Open Project" button
  if (!currentProjectId || !displayProject) {
    return (
      <Button
        variant="outline"
        size={collapsed ? 'icon' : 'default'}
        onClick={handleManageProjects}
        className={cn('w-full', collapsed && 'aspect-square', className)}
        title="Open Project"
      >
        <FolderOpen className="h-5 w-5" />
        {!collapsed && <span className="ml-2">Open Project</span>}
      </Button>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select project"
          className={cn(
            'w-full',
            !collapsed && 'justify-between',
            collapsed && 'aspect-square justify-center px-0',
            switching && 'opacity-50',
            className
          )}
          disabled={switching}
        >
          {collapsed ? (
            <FolderOpen className="h-5 w-5" />
          ) : (
            <>
              <div className="flex items-center gap-2 overflow-hidden">
                <FolderOpen className="h-5 w-5 flex-shrink-0" />
                <span className="truncate text-sm font-medium">{displayProject.name}</span>
              </div>
              <ChevronDown className="ml-2 h-4 w-4 flex-shrink-0 opacity-50" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        {loadingRecent ? (
          <DropdownMenuItem disabled>Loading projects...</DropdownMenuItem>
        ) : recentProjects && recentProjects.length > 0 ? (
          <>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              Recent Projects
            </div>
            {recentProjects.slice(0, 5).map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => handleProjectSwitch(project.id)}
                className="cursor-pointer"
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    currentProjectId === project.id ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div className="flex-1 overflow-hidden">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  {project.favorite && (
                    <div className="text-xs text-muted-foreground">★ Favorite</div>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : (
          <>
            <DropdownMenuItem disabled>No recent projects</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={handleManageProjects} className="cursor-pointer">
          <SettingsIcon className="mr-2 h-4 w-4" />
          <span>Manage Projects...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
