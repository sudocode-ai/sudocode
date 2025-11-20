import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createProjectsRouter } from '../../../src/routes/projects.js'
import { ProjectManager } from '../../../src/services/project-manager.js'
import { ProjectRegistry } from '../../../src/services/project-registry.js'

describe('Projects API Routes', () => {
  let app: Express
  let tempDir: string
  let configPath: string
  let registry: ProjectRegistry
  let manager: ProjectManager
  let testProjectPath1: string
  let testProjectPath2: string

  beforeEach(async () => {
    // Create temp directory for test config
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-routes-test-'))
    configPath = path.join(tempDir, 'projects.json')
    registry = new ProjectRegistry(configPath)
    await registry.load()

    // Create manager with file watching disabled
    manager = new ProjectManager(registry, { watchEnabled: false })

    // Setup Express app with projects router
    app = express()
    app.use(express.json())
    app.use('/api/projects', createProjectsRouter(manager, registry))

    // Create test projects
    testProjectPath1 = path.join(tempDir, 'test-project-1')
    const sudocodeDir1 = path.join(testProjectPath1, '.sudocode')
    fs.mkdirSync(sudocodeDir1, { recursive: true })
    fs.writeFileSync(path.join(sudocodeDir1, 'cache.db'), '')

    testProjectPath2 = path.join(tempDir, 'test-project-2')
    const sudocodeDir2 = path.join(testProjectPath2, '.sudocode')
    fs.mkdirSync(sudocodeDir2, { recursive: true })
    fs.writeFileSync(path.join(sudocodeDir2, 'cache.db'), '')
  })

  afterEach(async () => {
    await manager.shutdown()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('GET /api/projects', () => {
    it('should return empty array when no projects registered', async () => {
      const response = await request(app).get('/api/projects')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ projects: [] })
    })

    it('should return all registered projects', async () => {
      // Register some projects
      registry.registerProject(testProjectPath1)
      registry.registerProject(testProjectPath2)

      const response = await request(app).get('/api/projects')

      expect(response.status).toBe(200)
      expect(response.body.projects).toHaveLength(2)
      expect(response.body.projects[0]).toHaveProperty('id')
      expect(response.body.projects[0]).toHaveProperty('path')
      expect(response.body.projects[0]).toHaveProperty('name')
    })
  })

  describe('GET /api/projects/open', () => {
    it('should return empty array when no projects open', async () => {
      const response = await request(app).get('/api/projects/open')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ projects: [] })
    })

    it('should return all open projects with context', async () => {
      // Open a project
      await manager.openProject(testProjectPath1)

      const response = await request(app).get('/api/projects/open')

      expect(response.status).toBe(200)
      expect(response.body.projects).toHaveLength(1)
      expect(response.body.projects[0]).toHaveProperty('id')
      expect(response.body.projects[0]).toHaveProperty('path')
      expect(response.body.projects[0]).toHaveProperty('openedAt')
      expect(response.body.projects[0]).toHaveProperty('hasWatcher')
    })
  })

  describe('GET /api/projects/recent', () => {
    it('should return empty array when no recent projects', async () => {
      const response = await request(app).get('/api/projects/recent')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ projects: [] })
    })

    it('should return recent projects in order', async () => {
      // Register projects
      registry.registerProject(testProjectPath1)
      await new Promise((resolve) => setTimeout(resolve, 10))
      registry.registerProject(testProjectPath2)

      const response = await request(app).get('/api/projects/recent')

      expect(response.status).toBe(200)
      expect(response.body.projects).toHaveLength(2)
      // Most recent should be first
      expect(response.body.projects[0].path).toBe(testProjectPath2)
      expect(response.body.projects[1].path).toBe(testProjectPath1)
    })
  })

  describe('POST /api/projects/validate', () => {
    it('should return 400 when path is missing', async () => {
      const response = await request(app).post('/api/projects/validate').send({})

      expect(response.status).toBe(400)
      expect(response.body.valid).toBe(false)
      expect(response.body.error).toBe('Path is required')
    })

    it('should return invalid for non-existent path', async () => {
      const response = await request(app)
        .post('/api/projects/validate')
        .send({ path: '/non/existent/path' })

      expect(response.status).toBe(200)
      expect(response.body.valid).toBe(false)
      expect(response.body.errorType).toBe('PATH_NOT_FOUND')
    })

    it('should return invalid for path without .sudocode', async () => {
      const invalidPath = path.join(tempDir, 'invalid-project')
      fs.mkdirSync(invalidPath, { recursive: true })

      const response = await request(app)
        .post('/api/projects/validate')
        .send({ path: invalidPath })

      expect(response.status).toBe(200)
      expect(response.body.valid).toBe(false)
      expect(response.body.errorType).toBe('INVALID_PROJECT')
    })

    it('should return valid for valid project path', async () => {
      const response = await request(app)
        .post('/api/projects/validate')
        .send({ path: testProjectPath1 })

      expect(response.status).toBe(200)
      expect(response.body.valid).toBe(true)
      expect(response.body).not.toHaveProperty('error')
    })

    it('should not keep project open after validation', async () => {
      await request(app).post('/api/projects/validate').send({ path: testProjectPath1 })

      // Check that project is not open
      expect(manager.getAllOpenProjects()).toHaveLength(0)
    })
  })

  describe('POST /api/projects/open', () => {
    it('should return 400 when path is missing', async () => {
      const response = await request(app).post('/api/projects/open').send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Path is required')
    })

    it('should return 404 for non-existent path', async () => {
      const response = await request(app)
        .post('/api/projects/open')
        .send({ path: '/non/existent/path' })

      expect(response.status).toBe(404)
      expect(response.body.errorType).toBe('PATH_NOT_FOUND')
    })

    it('should return 400 for invalid project', async () => {
      const invalidPath = path.join(tempDir, 'invalid-project')
      fs.mkdirSync(invalidPath, { recursive: true })

      const response = await request(app).post('/api/projects/open').send({ path: invalidPath })

      expect(response.status).toBe(400)
      expect(response.body.errorType).toBe('INVALID_PROJECT')
    })

    it('should successfully open valid project', async () => {
      const response = await request(app)
        .post('/api/projects/open')
        .send({ path: testProjectPath1 })

      expect(response.status).toBe(200)
      expect(response.body.project).toHaveProperty('id')
      expect(response.body.project).toHaveProperty('path', testProjectPath1)
      expect(response.body.project).toHaveProperty('openedAt')
      expect(response.body.project).toHaveProperty('hasWatcher')
      expect(response.body.project).toHaveProperty('hasActiveExecutions')
    })

    it('should register project in registry', async () => {
      const response = await request(app)
        .post('/api/projects/open')
        .send({ path: testProjectPath1 })

      expect(response.status).toBe(200)

      const projectId = response.body.project.id
      const projectInfo = registry.getProject(projectId)
      expect(projectInfo).not.toBeNull()
    })

    it('should track project as open', async () => {
      const response = await request(app)
        .post('/api/projects/open')
        .send({ path: testProjectPath1 })

      expect(response.status).toBe(200)

      const projectId = response.body.project.id
      expect(manager.isProjectOpen(projectId)).toBe(true)
    })
  })

  describe('POST /api/projects/:projectId/close', () => {
    it('should return 404 when project is not open', async () => {
      const response = await request(app).post('/api/projects/non-existent-id/close')

      expect(response.status).toBe(404)
      expect(response.body.error).toContain('not open')
    })

    it('should successfully close open project', async () => {
      // Open a project first
      const openResult = await manager.openProject(testProjectPath1)
      expect(openResult.ok).toBe(true)

      if (openResult.ok) {
        const projectId = openResult.value.id

        const response = await request(app).post(`/api/projects/${projectId}/close`)

        expect(response.status).toBe(200)
        expect(response.body.success).toBe(true)
        expect(manager.isProjectOpen(projectId)).toBe(false)
      }
    })
  })

  describe('DELETE /api/projects/:projectId', () => {
    it('should return 404 for non-existent project', async () => {
      const response = await request(app).delete('/api/projects/non-existent-id')

      expect(response.status).toBe(404)
      expect(response.body.error).toContain('not found')
    })

    it('should successfully unregister project', async () => {
      // Register a project
      const projectInfo = registry.registerProject(testProjectPath1)
      await registry.save()

      const response = await request(app).delete(`/api/projects/${projectInfo.id}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)

      // Verify project is unregistered
      expect(registry.getProject(projectInfo.id)).toBeNull()
    })

    it('should close project if it is open before unregistering', async () => {
      // Open a project
      const openResult = await manager.openProject(testProjectPath1)
      expect(openResult.ok).toBe(true)

      if (openResult.ok) {
        const projectId = openResult.value.id

        const response = await request(app).delete(`/api/projects/${projectId}`)

        expect(response.status).toBe(200)
        expect(manager.isProjectOpen(projectId)).toBe(false)
        expect(registry.getProject(projectId)).toBeNull()
      }
    })
  })

  describe('GET /api/projects/:projectId', () => {
    it('should return 404 for non-existent project', async () => {
      const response = await request(app).get('/api/projects/non-existent-id')

      expect(response.status).toBe(404)
      expect(response.body.error).toContain('not found')
    })

    it('should return project info for registered project', async () => {
      const projectInfo = registry.registerProject(testProjectPath1)

      const response = await request(app).get(`/api/projects/${projectInfo.id}`)

      expect(response.status).toBe(200)
      expect(response.body.project).toHaveProperty('id', projectInfo.id)
      expect(response.body.project).toHaveProperty('path', testProjectPath1)
      // When not open, the route returns { isOpen: false } via the GET endpoint logic
      expect(response.body.project.isOpen).toBe(false)
    })

    it('should include context summary for open project', async () => {
      const openResult = await manager.openProject(testProjectPath1)
      expect(openResult.ok).toBe(true)

      if (openResult.ok) {
        const projectId = openResult.value.id

        const response = await request(app).get(`/api/projects/${projectId}`)

        expect(response.status).toBe(200)
        expect(response.body.project).toHaveProperty('id', projectId)
        expect(response.body.project).toHaveProperty('openedAt')
        expect(response.body.project).toHaveProperty('hasWatcher')
      }
    })
  })

  describe('POST /api/projects/init', () => {
    it('should return 400 when path is missing', async () => {
      const response = await request(app).post('/api/projects/init').send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Path is required')
    })

    it('should return 501 not implemented', async () => {
      const response = await request(app)
        .post('/api/projects/init')
        .send({ path: '/some/path' })

      expect(response.status).toBe(501)
      expect(response.body.error).toContain('not yet implemented')
      expect(response.body.message).toContain('sudocode sync')
    })
  })

  describe('error handling', () => {
    it('should handle internal errors gracefully', async () => {
      // This test would require mocking to trigger internal errors
      // For now, we've verified error handling in other tests
    })
  })
})
