import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useProjects,
  useOpenProjects,
  useRecentProjects,
  useOpenProject,
  useCloseProject,
  useDeleteProject,
  useInitProject,
  useValidateProject,
  useUpdateProject,
} from '@/hooks/useProjects'
import { useProject } from '@/hooks/useProject'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FolderOpen, Trash2, Plus, Check, Loader2, X, FolderClosed, Pencil } from 'lucide-react'
import type { ProjectInfo } from '@/types/project'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { data: projects, isLoading, isError } = useProjects()
  const { data: openProjects } = useOpenProjects()
  const { data: recentProjects } = useRecentProjects()
  const { currentProjectId, setCurrentProjectId } = useProject()
  const openProject = useOpenProject()
  const closeProject = useCloseProject()
  const deleteProject = useDeleteProject()
  const initProject = useInitProject()
  const validateProject = useValidateProject()

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<ProjectInfo | null>(null)
  const [initDialogOpen, setInitDialogOpen] = useState(false)
  const [openDialogOpen, setOpenDialogOpen] = useState(false)
  const [projectPath, setProjectPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  // Helper to check if a project is open
  const isProjectOpen = (projectId: string) => {
    return openProjects?.some((p) => p.id === projectId) || false
  }

  const handleOpenProject = async (project: ProjectInfo) => {
    try {
      await openProject.mutateAsync({ path: project.path })
      setCurrentProjectId(project.id)
      navigate('/issues')
    } catch (error) {
      console.error('Failed to open project:', error)
    }
  }

  const handleCloseProject = async (projectId: string) => {
    try {
      await closeProject.mutateAsync(projectId)
      // If closing the current project, clear it
      if (projectId === currentProjectId) {
        setCurrentProjectId(null)
      }
    } catch (error) {
      console.error('Failed to close project:', error)
    }
  }

  const handleOpenExistingProject = async () => {
    if (!projectPath.trim()) return

    setValidationError(null)

    try {
      // First validate the project path
      const validation = await validateProject.mutateAsync({ path: projectPath.trim() })

      if (!validation.valid) {
        setValidationError(validation.error || 'Invalid project path')
        return
      }

      // If valid, open the project
      const project = await openProject.mutateAsync({ path: projectPath.trim() })
      setCurrentProjectId(project.id)
      setOpenDialogOpen(false)
      setProjectPath('')
      setValidationError(null)
      navigate('/issues')
    } catch (error) {
      console.error('Failed to open project:', error)
      setValidationError(error instanceof Error ? error.message : 'Failed to open project')
    }
  }

  const handleDeleteClick = (project: ProjectInfo) => {
    setProjectToDelete(project)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return

    try {
      await deleteProject.mutateAsync(projectToDelete.id)
      // If deleting the current project, clear it
      if (projectToDelete.id === currentProjectId) {
        setCurrentProjectId(null)
      }
      setDeleteDialogOpen(false)
      setProjectToDelete(null)
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  const handleInitProject = async () => {
    if (!projectPath.trim()) return

    setValidationError(null)
    try {
      const project = await initProject.mutateAsync({
        path: projectPath.trim(),
        name: projectName.trim() || undefined,
      })
      setCurrentProjectId(project.id)
      setInitDialogOpen(false)
      setProjectPath('')
      setProjectName('')
      setValidationError(null)
      navigate('/issues')
    } catch (error) {
      console.error('Failed to initialize project:', error)
      setValidationError(error instanceof Error ? error.message : 'Failed to initialize project')
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-destructive">Failed to load projects</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Please check your connection and try again.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your Sudocode projects
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpenDialogOpen(true)}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Open Existing
          </Button>
          <Button onClick={() => setInitDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <FolderOpen className="mx-auto h-16 w-16 text-muted-foreground" />
          <h3 className="mt-6 text-xl font-semibold">No projects yet</h3>
          <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
            Sudocode helps you manage specifications and issues for your projects.
            Get started by opening an existing project or creating a new one.
          </p>
          <div className="mt-6 flex gap-3 justify-center">
            <Button variant="outline" onClick={() => setOpenDialogOpen(true)}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Open Existing Project
            </Button>
            <Button onClick={() => setInitDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Initialize New Project
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Recent Projects Section */}
          {recentProjects && recentProjects.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">Recent Projects</h2>
              <div className="space-y-2">
                {recentProjects.slice(0, 3).map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    isOpen={isProjectOpen(project.id)}
                    isCurrent={project.id === currentProjectId}
                    onOpen={handleOpenProject}
                    onClose={handleCloseProject}
                    onDelete={handleDeleteClick}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All Projects Section */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              {recentProjects && recentProjects.length > 0 ? 'All Projects' : 'Projects'}
            </h2>
            <div className="space-y-2">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isOpen={isProjectOpen(project.id)}
                  isCurrent={project.id === currentProjectId}
                  onOpen={handleOpenProject}
                  onClose={handleCloseProject}
                  onDelete={handleDeleteClick}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unregister "{projectToDelete?.name}"? This will remove it
              from your project list but will not delete the project files.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Open Existing Project Dialog */}
      <Dialog open={openDialogOpen} onOpenChange={setOpenDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open Existing Project</DialogTitle>
            <DialogDescription>
              Enter the path to an existing Sudocode project directory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Project Path</label>
              <Input
                value={projectPath}
                onChange={(e) => {
                  setProjectPath(e.target.value)
                  setValidationError(null)
                }}
                placeholder="/path/to/project"
                className="mt-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projectPath.trim()) {
                    handleOpenExistingProject()
                  }
                }}
              />
              {validationError && (
                <p className="mt-2 text-sm text-destructive">{validationError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpenDialogOpen(false)
                setProjectPath('')
                setValidationError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleOpenExistingProject}
              disabled={
                !projectPath.trim() || validateProject.isPending || openProject.isPending
              }
            >
              {validateProject.isPending || openProject.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening...
                </>
              ) : (
                'Open Project'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Initialize Project Dialog */}
      <Dialog open={initDialogOpen} onOpenChange={setInitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initialize New Project</DialogTitle>
            <DialogDescription>
              Enter the path to a directory to initialize as a Sudocode project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Project Path</label>
              <Input
                value={projectPath}
                onChange={(e) => {
                  setProjectPath(e.target.value)
                  setValidationError(null)
                }}
                placeholder="/path/to/project"
                className="mt-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projectPath.trim()) {
                    handleInitProject()
                  }
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Project Name (optional)</label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Project"
                className="mt-1"
              />
            </div>
            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setInitDialogOpen(false)
                setProjectPath('')
                setProjectName('')
                setValidationError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleInitProject}
              disabled={!projectPath.trim() || initProject.isPending}
            >
              {initProject.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Initializing...
                </>
              ) : (
                'Initialize'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ProjectCard component
interface ProjectCardProps {
  project: ProjectInfo
  isOpen: boolean
  isCurrent: boolean
  onOpen: (project: ProjectInfo) => void
  onClose: (projectId: string) => void
  onDelete: (project: ProjectInfo) => void
}

function ProjectCard({ project, isOpen, isCurrent, onOpen, onClose, onDelete }: ProjectCardProps) {
  const updateProject = useUpdateProject()
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState(project.name)
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleCardClick = () => {
    // If it's the current project or editing, don't do anything
    if (isCurrent || isEditing) return

    // Otherwise, open/switch to this project
    onOpen(project)
  }

  const validateName = (name: string): string | null => {
    const trimmedName = name.trim()

    if (trimmedName === '') {
      return 'Name cannot be empty'
    }

    if (trimmedName.length > 100) {
      return 'Name must be 100 characters or less'
    }

    // Check for invalid characters (basic filesystem safety)
    const invalidChars = /[<>:"|?*\x00-\x1F]/
    if (invalidChars.test(trimmedName)) {
      return 'Name contains invalid characters (< > : " | ? *)'
    }

    return null
  }

  const handleRename = async () => {
    const trimmedName = editedName.trim()

    // No change, just cancel editing
    if (trimmedName === project.name) {
      setIsEditing(false)
      setValidationError(null)
      return
    }

    // Validate name
    const error = validateName(editedName)
    if (error) {
      setValidationError(error)
      return
    }

    try {
      await updateProject.mutateAsync({
        projectId: project.id,
        data: { name: trimmedName },
      })
      setIsEditing(false)
      setValidationError(null)
    } catch (error) {
      console.error('Failed to rename project:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to rename project'
      setValidationError(errorMessage)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleRename()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditedName(project.name)
      setValidationError(null)
    }
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditedName(e.target.value)
    // Clear validation error when user starts typing
    if (validationError) {
      setValidationError(null)
    }
  }

  return (
    <div className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50">
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={handleCardClick}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {isEditing ? (
            <div className="flex flex-col gap-1">
              <Input
                value={editedName}
                onChange={handleNameChange}
                onBlur={handleRename}
                onKeyDown={handleKeyDown}
                className={`h-8 w-64 ${validationError ? 'border-destructive' : ''}`}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              {validationError && (
                <p className="text-xs text-destructive">{validationError}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{project.name}</h3>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        setIsEditing(true)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Rename</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          {isCurrent && (
            <Badge variant="default" className="text-xs">
              <Check className="mr-1 h-3 w-3" />
              Current
            </Badge>
          )}
          {isOpen && !isCurrent && (
            <Badge variant="secondary" className="text-xs">
              Open
            </Badge>
          )}
          {!isOpen && (
            <Badge variant="outline" className="text-xs">
              <FolderClosed className="mr-1 h-3 w-3" />
              Closed
            </Badge>
          )}
          {project.favorite && <span className="text-yellow-500 text-lg">★</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground truncate">{project.path}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Last opened: {new Date(project.lastOpenedAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
        {!isOpen && (
          <Button variant="outline" size="sm" onClick={() => onOpen(project)}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Open
          </Button>
        )}
        {isOpen && !isCurrent && (
          <>
            <Button variant="outline" size="sm" onClick={() => onOpen(project)}>
              Switch To
            </Button>
            <Button variant="outline" size="sm" onClick={() => onClose(project.id)}>
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
          </>
        )}
        {isOpen && isCurrent && (
          <Button variant="outline" size="sm" onClick={() => onClose(project.id)}>
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onDelete(project)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  )
}

