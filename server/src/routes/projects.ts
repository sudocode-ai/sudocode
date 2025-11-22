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
      res.json({
        success: true,
        data: projects,
      })
    } catch (error: any) {
      console.error('Error fetching projects:', error)
      res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to fetch projects',
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

      res.json({
        success: true,
        data: projectInfos,
      })
    } catch (error: any) {
      console.error('Error fetching open projects:', error)
      res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to fetch open projects',
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
      res.json({
        success: true,
        data: recentProjects,
      })
    } catch (error: any) {
      console.error('Error fetching recent projects:', error)
      res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to fetch recent projects',
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
          success: true,
          data: {
            valid: false,
            error: 'Path is required',
          },
        })
      }

      // We'll use a private method via a temporary open attempt
      // This is a bit hacky but avoids exposing validateProject publicly
      const result = await projectManager.openProject(path)

      if (!result.ok) {
        const errorMessage =
          'message' in result.error! ? result.error!.message : `Invalid project: ${result.error!.type}`
        return res.json({
          success: true,
          data: {
            valid: false,
            error: errorMessage,
            errorType: result.error!.type,
          },
        })
      }

      // If it opened successfully, immediately close it (we were just validating)
      await projectManager.closeProject(result.value!.id, false)

      return res.json({
        success: true,
        data: {
          valid: true,
        },
      })
    } catch (error: any) {
      console.error('Error validating project:', error)
      return res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Validation failed',
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
          success: false,
          data: null,
          error_data: 'Path is required',
          message: 'Path is required',
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
          success: false,
          data: null,
          error_data: result.error!.type,
          message: errorMessage,
        })
      }

      const projectInfo = registry.getProject(result.value!.id)
      const summary = result.value!.getSummary()

      return res.json({
        success: true,
        data: {
          ...projectInfo,
          ...summary,
        },
      })
    } catch (error: any) {
      console.error('Error opening project:', error)
      return res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to open project',
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
          success: false,
          data: null,
          error_data: `Project not open: ${projectId}`,
          message: `Project not open: ${projectId}`,
        })
      }

      await projectManager.closeProject(projectId)

      return res.json({
        success: true,
        data: null,
      })
    } catch (error: any) {
      console.error(`Error closing project ${req.params.projectId}:`, error)
      return res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to close project',
      })
    }
  })

  /**
   * PATCH /api/projects/:projectId
   * Update project metadata (name, favorite status)
   *
   * Body: { name?: string, favorite?: boolean }
   * Response: { project: ProjectInfo }
   */
  router.patch('/:projectId', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params
      const { name, favorite } = req.body

      // Validate that at least one field is provided
      if (name === undefined && favorite === undefined) {
        return res.status(400).json({
          success: false,
          data: null,
          error_data: 'At least one field (name or favorite) must be provided',
          message: 'At least one field (name or favorite) must be provided',
        })
      }

      // Validate name if provided
      if (name !== undefined) {
        if (typeof name !== 'string') {
          return res.status(400).json({
            success: false,
            data: null,
            error_data: 'Name must be a string',
            message: 'Name must be a string',
          })
        }

        const trimmedName = name.trim()

        if (trimmedName === '') {
          return res.status(400).json({
            success: false,
            data: null,
            error_data: 'Name cannot be empty',
            message: 'Name cannot be empty',
          })
        }

        if (trimmedName.length > 100) {
          return res.status(400).json({
            success: false,
            data: null,
            error_data: 'Name must be 100 characters or less',
            message: 'Name must be 100 characters or less',
          })
        }

        // Check for invalid characters (basic filesystem safety)
        const invalidChars = /[<>:"|?*\x00-\x1F]/
        if (invalidChars.test(trimmedName)) {
          return res.status(400).json({
            success: false,
            data: null,
            error_data: 'Name contains invalid characters',
            message: 'Name contains invalid characters (< > : " | ? * or control characters)',
          })
        }
      }

      const updated = registry.updateProject(projectId, { name, favorite })

      if (!updated) {
        return res.status(404).json({
          success: false,
          data: null,
          error_data: `Project not found: ${projectId}`,
          message: `Project not found: ${projectId}`,
        })
      }

      // Save registry
      await registry.save()

      // Return updated project info
      const projectInfo = registry.getProject(projectId)

      return res.json({
        success: true,
        data: projectInfo,
      })
    } catch (error: any) {
      console.error(`Error updating project ${req.params.projectId}:`, error)
      return res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to update project',
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
          success: false,
          data: null,
          error_data: `Project not found: ${projectId}`,
          message: `Project not found: ${projectId}`,
        })
      }

      // Save registry
      await registry.save()

      return res.json({
        success: true,
        data: null,
      })
    } catch (error: any) {
      console.error(`Error deleting project ${req.params.projectId}:`, error)
      return res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to delete project',
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
          success: false,
          data: null,
          error_data: `Project not found: ${projectId}`,
          message: `Project not found: ${projectId}`,
        })
      }

      const context = projectManager.getProject(projectId)
      const summary = context?.getSummary()

      return res.json({
        success: true,
        data: {
          ...projectInfo,
          ...(summary || { isOpen: false }),
        },
      })
    } catch (error: any) {
      console.error(`Error fetching project ${req.params.projectId}:`, error)
      return res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to fetch project',
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
          success: false,
          data: null,
          error_data: 'Path is required',
          message: 'Path is required',
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
        success: false,
        data: null,
        error_data: 'Project initialization not yet implemented',
        message: 'Please use the CLI command: sudocode sync',
      })
    } catch (error: any) {
      console.error('Error initializing project:', error)
      return res.status(500).json({
        success: false,
        data: null,
        error_data: error.message,
        message: 'Failed to initialize project',
      })
    }
  })

  return router
}
