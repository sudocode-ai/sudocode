import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express, { Express, Request, Response } from 'express'
import request from 'supertest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { requireProject, optionalProject } from '../../../src/middleware/project-context.js'
import { ProjectManager } from '../../../src/services/project-manager.js'
import { ProjectRegistry } from '../../../src/services/project-registry.js'

describe('Project Context Middleware', () => {
  let app: Express
  let tempDir: string
  let configPath: string
  let registry: ProjectRegistry
  let manager: ProjectManager
  let testProjectPath: string
  let testProjectId: string

  beforeEach(async () => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-middleware-test-'))
    configPath = path.join(tempDir, 'projects.json')
    registry = new ProjectRegistry(configPath)
    await registry.load()

    // Create manager
    manager = new ProjectManager(registry, { watchEnabled: false })

    // Create test project
    testProjectPath = path.join(tempDir, 'test-project')
    const sudocodeDir = path.join(testProjectPath, '.sudocode')
    fs.mkdirSync(sudocodeDir, { recursive: true })
    fs.writeFileSync(path.join(sudocodeDir, 'cache.db'), '')

    // Open the project
    const result = await manager.openProject(testProjectPath)
    if (result.ok) {
      testProjectId = result.value.id
    }
  })

  afterEach(async () => {
    await manager.shutdown()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('requireProject middleware', () => {
    beforeEach(() => {
      // Setup Express app with requireProject middleware
      app = express()
      app.use(express.json())

      // Test route that uses requireProject
      app.get('/api/test', requireProject(manager), (req: Request, res: Response) => {
        res.json({
          message: 'success',
          projectId: req.project?.id,
          projectPath: req.project?.path,
        })
      })
    })

    it('should return 400 when X-Project-ID header is missing', async () => {
      const response = await request(app).get('/api/test')

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Missing X-Project-ID header')
      expect(response.body.message).toContain('X-Project-ID')
    })

    it('should return 404 when project is not found', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('X-Project-ID', 'non-existent-project')

      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Project not found')
      expect(response.body.message).toContain('not open')
      expect(response.body.projectId).toBe('non-existent-project')
    })

    it('should inject project context when project exists', async () => {
      const response = await request(app).get('/api/test').set('X-Project-ID', testProjectId)

      expect(response.status).toBe(200)
      expect(response.body.message).toBe('success')
      expect(response.body.projectId).toBe(testProjectId)
      expect(response.body.projectPath).toBe(testProjectPath)
    })

    it('should handle lowercase x-project-id header', async () => {
      const response = await request(app).get('/api/test').set('x-project-id', testProjectId)

      expect(response.status).toBe(200)
      expect(response.body.projectId).toBe(testProjectId)
    })

    it('should handle case variations of header name', async () => {
      const response = await request(app).get('/api/test').set('X-PROJECT-ID', testProjectId)

      expect(response.status).toBe(200)
      expect(response.body.projectId).toBe(testProjectId)
    })

    it('should handle string header values correctly', async () => {
      // Test that standard string header values work
      const response = await request(app).get('/api/test').set('X-Project-ID', testProjectId)

      expect(response.status).toBe(200)
      expect(response.body.projectId).toBe(testProjectId)
    })

    it('should reject requests after project is closed', async () => {
      // Close the project
      await manager.closeProject(testProjectId)

      const response = await request(app).get('/api/test').set('X-Project-ID', testProjectId)

      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Project not found')
    })

    it('should work with multiple routes using same middleware', async () => {
      app.get('/api/other', requireProject(manager), (req: Request, res: Response) => {
        res.json({ projectId: req.project?.id })
      })

      const response1 = await request(app).get('/api/test').set('X-Project-ID', testProjectId)

      const response2 = await request(app).get('/api/other').set('X-Project-ID', testProjectId)

      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)
      expect(response1.body.projectId).toBe(testProjectId)
      expect(response2.body.projectId).toBe(testProjectId)
    })
  })

  describe('optionalProject middleware', () => {
    beforeEach(() => {
      // Setup Express app with optionalProject middleware
      app = express()
      app.use(express.json())

      // Test route that uses optionalProject
      app.get('/api/optional', optionalProject(manager), (req: Request, res: Response) => {
        res.json({
          message: 'success',
          hasProject: !!req.project,
          projectId: req.project?.id,
        })
      })
    })

    it('should allow requests without X-Project-ID header', async () => {
      const response = await request(app).get('/api/optional')

      expect(response.status).toBe(200)
      expect(response.body.message).toBe('success')
      expect(response.body.hasProject).toBe(false)
      expect(response.body.projectId).toBeUndefined()
    })

    it('should inject project when valid header is provided', async () => {
      const response = await request(app)
        .get('/api/optional')
        .set('X-Project-ID', testProjectId)

      expect(response.status).toBe(200)
      expect(response.body.hasProject).toBe(true)
      expect(response.body.projectId).toBe(testProjectId)
    })

    it('should not error when project is not found', async () => {
      const response = await request(app)
        .get('/api/optional')
        .set('X-Project-ID', 'non-existent-project')

      expect(response.status).toBe(200)
      expect(response.body.hasProject).toBe(false)
      expect(response.body.projectId).toBeUndefined()
    })

    it('should handle lowercase header name', async () => {
      const response = await request(app)
        .get('/api/optional')
        .set('x-project-id', testProjectId)

      expect(response.status).toBe(200)
      expect(response.body.hasProject).toBe(true)
      expect(response.body.projectId).toBe(testProjectId)
    })

    it('should work with routes that handle both cases', async () => {
      // Test without header
      const response1 = await request(app).get('/api/optional')
      expect(response1.body.hasProject).toBe(false)

      // Test with header
      const response2 = await request(app)
        .get('/api/optional')
        .set('X-Project-ID', testProjectId)
      expect(response2.body.hasProject).toBe(true)
    })
  })

  describe('middleware integration', () => {
    it('should allow mixing requireProject and optionalProject', async () => {
      app = express()
      app.use(express.json())

      app.get('/api/required', requireProject(manager), (req: Request, res: Response) => {
        res.json({ type: 'required', projectId: req.project?.id })
      })

      app.get('/api/optional', optionalProject(manager), (req: Request, res: Response) => {
        res.json({ type: 'optional', hasProject: !!req.project })
      })

      // Required route needs header
      const response1 = await request(app).get('/api/required')
      expect(response1.status).toBe(400)

      // Optional route works without header
      const response2 = await request(app).get('/api/optional')
      expect(response2.status).toBe(200)

      // Both work with header
      const response3 = await request(app)
        .get('/api/required')
        .set('X-Project-ID', testProjectId)
      expect(response3.status).toBe(200)

      const response4 = await request(app)
        .get('/api/optional')
        .set('X-Project-ID', testProjectId)
      expect(response4.status).toBe(200)
    })

    it('should provide type-safe access to req.project', async () => {
      app = express()
      app.get('/api/typed', requireProject(manager), (req: Request, res: Response) => {
        // TypeScript should recognize req.project
        const project = req.project

        // Access project properties
        const id = project?.id
        const path = project?.path
        const db = project?.db

        res.json({ id, path, hasDb: !!db })
      })

      const response = await request(app).get('/api/typed').set('X-Project-ID', testProjectId)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe(testProjectId)
      expect(response.body.path).toBe(testProjectPath)
      expect(response.body.hasDb).toBe(true)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      app = express()
      app.get('/api/test', requireProject(manager), (req: Request, res: Response) => {
        res.json({ projectId: req.project?.id })
      })
    })

    it('should handle errors from projectManager gracefully', async () => {
      // Mock getProject to throw an error
      const originalGetProject = manager.getProject.bind(manager)
      manager.getProject = vi.fn().mockImplementation(() => {
        throw new Error('Database error')
      })

      const response = await request(app).get('/api/test').set('X-Project-ID', testProjectId)

      // Should throw error, not return gracefully
      expect(response.status).toBe(500)

      // Restore original method
      manager.getProject = originalGetProject
    })

    it('should not call next() on error responses', async () => {
      const nextSpy = vi.fn()

      // Create middleware instance
      const middleware = requireProject(manager)

      // Create mock req/res
      const mockReq = { get: vi.fn(() => null), headers: {} } as any
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any

      middleware(mockReq, mockRes, nextSpy)

      // Should not call next since header is missing
      expect(nextSpy).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(400)
    })

    it('should call next() on success', async () => {
      const nextSpy = vi.fn()

      // Create middleware instance
      const middleware = requireProject(manager)

      // Create mock req/res
      const mockReq = {
        get: vi.fn((header: string) => (header === 'X-Project-ID' ? testProjectId : null)),
        headers: {},
      } as any
      const mockRes = {} as any

      middleware(mockReq, mockRes, nextSpy)

      // Should call next since project exists
      expect(nextSpy).toHaveBeenCalledOnce()
    })
  })
})
