import express, { Request, Response } from 'express'
import type { ProjectManager } from '../services/project-manager.js'
import type { ProjectRegistry } from '../services/project-registry.js'

/**
 * Create the projects router
 *
 * Provides REST API endpoints for project management operations.
 * Note: These routes do NOT require the requireProject middleware
 * since they're managing projects themselves.
 */
export function createProjectsRouter(
  projectManager: ProjectManager,
  registry: ProjectRegistry
) {
  const router = express.Router()

  /**
   * GET /api/projects
   * Get all registered projects
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const projects = registry.getAllProjects()
      res.json({ projects })
    } catch (error: any) {
      console.error('Error fetching projects:', error)
      res.status(500).json({
        error: 'Failed to fetch projects',
        message: error.message,
      })
    }
  })

  /**
   * GET /api/projects/open
   * Get all currently open projects
   */
  router.get('/open', async (_req: Request, res: Response) => {
    try {
      const openProjects = projectManager.getAllOpenProjects()
      const projectInfos = openProjects.map((ctx) => {
        const projectInfo = registry.getProject(ctx.id)
        return {
          ...projectInfo,
          ...ctx.getSummary(),
        }
      })

      res.json({ projects: projectInfos })
    } catch (error: any) {
      console.error('Error fetching open projects:', error)
      res.status(500).json({
        error: 'Failed to fetch open projects',
        message: error.message,
      })
    }
  })

  /**
   * GET /api/projects/recent
   * Get recently opened projects
   */
  router.get('/recent', async (_req: Request, res: Response) => {
    try {
      const recentProjects = registry.getRecentProjects()
      res.json({ projects: recentProjects })
    } catch (error: any) {
      console.error('Error fetching recent projects:', error)
      res.status(500).json({
        error: 'Failed to fetch recent projects',
        message: error.message,
      })
    }
  })

  /**
   * POST /api/projects/validate
   * Validate a project path without opening it
   *
   * Body: { path: string }
   * Response: { valid: boolean, error?: string }
   */
  router.post('/validate', async (req: Request, res: Response) => {
    try {
      const { path } = req.body

      if (!path) {
        return res.status(400).json({
          valid: false,
          error: 'Path is required',
        })
      }

      // We'll use a private method via a temporary open attempt
      // This is a bit hacky but avoids exposing validateProject publicly
      const result = await projectManager.openProject(path)

      if (!result.ok) {
        const errorMessage =
          'message' in result.error! ? result.error!.message : `Invalid project: ${result.error!.type}`
        return res.json({
          valid: false,
          error: errorMessage,
          errorType: result.error!.type,
        })
      }

      // If it opened successfully, immediately close it (we were just validating)
      await projectManager.closeProject(result.value!.id, false)

      return res.json({ valid: true })
    } catch (error: any) {
      console.error('Error validating project:', error)
      return res.status(500).json({
        valid: false,
        error: 'Validation failed',
        message: error.message,
      })
    }
  })

  /**
   * POST /api/projects/open
   * Open a project by path
   *
   * Body: { path: string }
   * Response: { project: ProjectInfo }
   */
  router.post('/open', async (req: Request, res: Response) => {
    try {
      const { path } = req.body

      if (!path) {
        return res.status(400).json({
          error: 'Path is required',
        })
      }

      const result = await projectManager.openProject(path)

      if (!result.ok) {
        const statusCode =
          result.error!.type === 'PATH_NOT_FOUND'
            ? 404
            : result.error!.type === 'INVALID_PROJECT'
              ? 400
              : 500

        const errorMessage =
          'message' in result.error! ? result.error!.message : `Failed to open project: ${result.error!.type}`

        return res.status(statusCode).json({
          error: errorMessage,
          errorType: result.error!.type,
        })
      }

      const projectInfo = registry.getProject(result.value!.id)
      const summary = result.value!.getSummary()

      return res.json({
        project: {
          ...projectInfo,
          ...summary,
        },
      })
    } catch (error: any) {
      console.error('Error opening project:', error)
      return res.status(500).json({
        error: 'Failed to open project',
        message: error.message,
      })
    }
  })

  /**
   * POST /api/projects/:projectId/close
   * Close an open project
   *
   * Response: { success: boolean }
   */
  router.post('/:projectId/close', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params

      if (!projectManager.isProjectOpen(projectId)) {
        return res.status(404).json({
          error: `Project not open: ${projectId}`,
        })
      }

      await projectManager.closeProject(projectId)

      return res.json({ success: true })
    } catch (error: any) {
      console.error(`Error closing project ${req.params.projectId}:`, error)
      return res.status(500).json({
        error: 'Failed to close project',
        message: error.message,
      })
    }
  })

  /**
   * DELETE /api/projects/:projectId
   * Unregister a project from the registry
   *
   * Response: { success: boolean }
   */
  router.delete('/:projectId', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params

      // Close project if it's open
      if (projectManager.isProjectOpen(projectId)) {
        await projectManager.closeProject(projectId, false)
      }

      // Unregister from registry
      const removed = registry.unregisterProject(projectId)

      if (!removed) {
        return res.status(404).json({
          error: `Project not found: ${projectId}`,
        })
      }

      // Save registry
      await registry.save()

      return res.json({ success: true })
    } catch (error: any) {
      console.error(`Error deleting project ${req.params.projectId}:`, error)
      return res.status(500).json({
        error: 'Failed to delete project',
        message: error.message,
      })
    }
  })

  /**
   * GET /api/projects/:projectId
   * Get detailed information about a specific project
   *
   * Response: { project: ProjectInfo & Summary }
   */
  router.get('/:projectId', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params

      const projectInfo = registry.getProject(projectId)
      if (!projectInfo) {
        return res.status(404).json({
          error: `Project not found: ${projectId}`,
        })
      }

      const context = projectManager.getProject(projectId)
      const summary = context?.getSummary()

      return res.json({
        project: {
          ...projectInfo,
          ...(summary || { isOpen: false }),
        },
      })
    } catch (error: any) {
      console.error(`Error fetching project ${req.params.projectId}:`, error)
      return res.status(500).json({
        error: 'Failed to fetch project',
        message: error.message,
      })
    }
  })

  /**
   * POST /api/projects/init
   * Initialize a new sudocode project in an existing directory
   *
   * Body: { path: string }
   * Response: { project: ProjectInfo, message: string }
   *
   * TODO: This would need to call CLI init command or replicate its logic
   */
  router.post('/init', async (req: Request, res: Response) => {
    try {
      const { path } = req.body

      if (!path) {
        return res.status(400).json({
          error: 'Path is required',
        })
      }

      // TODO: Implement project initialization
      // This would need to:
      // 1. Create .sudocode directory
      // 2. Initialize cache.db
      // 3. Run migrations
      // 4. Create default config files
      // For now, return not implemented

      return res.status(501).json({
        error: 'Project initialization not yet implemented',
        message: 'Please use the CLI command: sudocode sync',
      })
    } catch (error: any) {
      console.error('Error initializing project:', error)
      return res.status(500).json({
        error: 'Failed to initialize project',
        message: error.message,
      })
    }
  })

  return router
}
