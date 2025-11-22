/**
 * Integration tests for multi-project functionality
 *
 * Tests project lifecycle, switching, concurrent operations, and resource management
 *
 * NOTE: These tests require a running server at http://localhost:3000
 * Run the server with: npm run dev
 * Then run these tests with: npm test -- --run tests/integration/multi-project.test.ts
 *
 * These tests create temporary project directories and clean them up after execution
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import fetch from 'node-fetch'
import { WebSocket } from 'ws'
import Database from 'better-sqlite3'

const API_URL = process.env.API_URL || 'http://localhost:3000/api'
const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws'

// Test project paths
const TEST_PROJECTS_ROOT = join(tmpdir(), `sudocode-integration-tests-${Date.now()}`)
const PROJECT_A_PATH = join(TEST_PROJECTS_ROOT, 'project-a')
const PROJECT_B_PATH = join(TEST_PROJECTS_ROOT, 'project-b')
const PROJECT_C_PATH = join(TEST_PROJECTS_ROOT, 'project-c')

// Helper: Create test project structure
function createTestProject(path: string, name: string) {
  mkdirSync(path, { recursive: true })
  mkdirSync(join(path, '.sudocode'), { recursive: true })

  // Initialize SQLite database
  const db = Database(join(path, '.sudocode', 'sudocode.db'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open',
      priority INTEGER DEFAULT 2,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS specs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)
  db.close()

  // Create a test file
  writeFileSync(join(path, 'README.md'), `# ${name}\n\nTest project for integration tests`)
}

// Helper: Wait for WebSocket message
function waitForMessage(
  ws: WebSocket,
  predicate: (message: any) => boolean,
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`))
    }, timeoutMs)

    const handler = (data: any) => {
      try {
        const message = JSON.parse(data.toString())
        if (predicate(message)) {
          clearTimeout(timeout)
          ws.off('message', handler)
          resolve(message)
        }
      } catch (error) {
        // Ignore parse errors
      }
    }

    ws.on('message', handler)
  })
}

// Helper: API request with project header
async function apiRequest(
  path: string,
  options: any = {},
  projectId?: string
) {
  const headers: any = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (projectId) {
    headers['X-Project-ID'] = projectId
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error: any = new Error(`API request failed: ${response.statusText}`)
    error.status = response.status
    error.body = await response.text()
    throw error
  }

  const result: any = await response.json()
  return result.data
}

describe.skip('Multi-Project Integration Tests', () => {
  // Track opened projects and WebSocket connections for cleanup
  const openedProjectIds: string[] = []
  const wsConnections: WebSocket[] = []

  beforeAll(() => {
    // Create test project directories
    createTestProject(PROJECT_A_PATH, 'Project A')
    createTestProject(PROJECT_B_PATH, 'Project B')
    createTestProject(PROJECT_C_PATH, 'Project C')
  })

  afterAll(() => {
    // Clean up WebSocket connections
    wsConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    })

    // Close all opened projects
    openedProjectIds.forEach(async (projectId) => {
      try {
        await apiRequest(`/projects/${projectId}/close`, { method: 'POST' })
      } catch (error) {
        console.warn(`Failed to close project ${projectId}:`, error)
      }
    })

    // Clean up test directories
    if (existsSync(TEST_PROJECTS_ROOT)) {
      rmSync(TEST_PROJECTS_ROOT, { recursive: true, force: true })
    }
  })

  describe('Project Lifecycle', () => {
    it('should open a project successfully', async () => {
      const project = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_A_PATH }),
      })

      expect(project).toBeDefined()
      expect(project.id).toBeDefined()
      expect(project.path).toBe(PROJECT_A_PATH)
      expect(project.name).toBe('Project A')

      openedProjectIds.push(project.id)
    })

    it('should list open projects', async () => {
      const openProjects = await apiRequest('/projects/open')

      expect(openProjects).toBeInstanceOf(Array)
      expect(openProjects.length).toBeGreaterThan(0)
      expect(openProjects.some((p: any) => p.path === PROJECT_A_PATH)).toBe(true)
    })

    it('should fetch issues from opened project', async () => {
      const projectId = openedProjectIds[0]
      const issues = await apiRequest('/issues', {}, projectId)

      expect(issues).toBeInstanceOf(Array)
      // Initially empty, but should not error
    })

    it('should close a project successfully', async () => {
      const projectId = openedProjectIds[0]

      await apiRequest(`/projects/${projectId}/close`, { method: 'POST' })

      const openProjects = await apiRequest('/projects/open')
      expect(openProjects.some((p: any) => p.id === projectId)).toBe(false)

      // Remove from tracking
      const index = openedProjectIds.indexOf(projectId)
      if (index > -1) {
        openedProjectIds.splice(index, 1)
      }
    })

    it('should reopen the same project', async () => {
      const project = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_A_PATH }),
      })

      expect(project.id).toBeDefined()
      expect(project.path).toBe(PROJECT_A_PATH)

      openedProjectIds.push(project.id)
    })
  })

  describe('Project Switching', () => {
    let projectAId: string
    let projectBId: string

    beforeEach(async () => {
      // Open project A
      const projectA = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_A_PATH }),
      })
      projectAId = projectA.id
      openedProjectIds.push(projectAId)

      // Open project B
      const projectB = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_B_PATH }),
      })
      projectBId = projectB.id
      openedProjectIds.push(projectBId)
    })

    afterEach(async () => {
      // Clean up opened projects
      for (const id of [projectAId, projectBId]) {
        try {
          await apiRequest(`/projects/${id}/close`, { method: 'POST' })
          const index = openedProjectIds.indexOf(id)
          if (index > -1) {
            openedProjectIds.splice(index, 1)
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    })

    it('should create issue in project A', async () => {
      const issue = await apiRequest('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Issue in Project A',
          description: 'Test issue',
        }),
      }, projectAId)

      expect(issue.id).toBeDefined()
      expect(issue.title).toBe('Issue in Project A')
    })

    it('should not see project A issues in project B', async () => {
      // Create issue in project A
      await apiRequest('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Issue in Project A',
          description: 'Test issue',
        }),
      }, projectAId)

      // Fetch issues from project B
      const issuesB = await apiRequest('/issues', {}, projectBId)

      expect(issuesB).toBeInstanceOf(Array)
      expect(issuesB.every((i: any) => i.title !== 'Issue in Project A')).toBe(true)
    })

    it('should handle missing X-Project-ID header gracefully', async () => {
      try {
        await apiRequest('/issues', {})
        expect.fail('Should have thrown error for missing project header')
      } catch (error: any) {
        expect(error.status).toBe(400)
        expect(error.body).toContain('X-Project-ID')
      }
    })
  })

  describe('Multi-Project Operations', () => {
    let projectAId: string
    let projectBId: string
    let projectCId: string

    beforeEach(async () => {
      // Open all three projects
      const projectA = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_A_PATH }),
      })
      projectAId = projectA.id
      openedProjectIds.push(projectAId)

      const projectB = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_B_PATH }),
      })
      projectBId = projectB.id
      openedProjectIds.push(projectBId)

      const projectC = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_C_PATH }),
      })
      projectCId = projectC.id
      openedProjectIds.push(projectCId)
    })

    afterEach(async () => {
      // Clean up all projects
      for (const id of [projectAId, projectBId, projectCId]) {
        try {
          await apiRequest(`/projects/${id}/close`, { method: 'POST' })
          const index = openedProjectIds.indexOf(id)
          if (index > -1) {
            openedProjectIds.splice(index, 1)
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    })

    it('should open 3 projects simultaneously', async () => {
      const openProjects = await apiRequest('/projects/open')

      expect(openProjects.length).toBeGreaterThanOrEqual(3)
      expect(openProjects.some((p: any) => p.id === projectAId)).toBe(true)
      expect(openProjects.some((p: any) => p.id === projectBId)).toBe(true)
      expect(openProjects.some((p: any) => p.id === projectCId)).toBe(true)
    })

    it('should create issues in multiple projects concurrently', async () => {
      const promises = [
        apiRequest('/issues', {
          method: 'POST',
          body: JSON.stringify({ title: 'Issue in A', description: 'Test' }),
        }, projectAId),
        apiRequest('/issues', {
          method: 'POST',
          body: JSON.stringify({ title: 'Issue in B', description: 'Test' }),
        }, projectBId),
        apiRequest('/issues', {
          method: 'POST',
          body: JSON.stringify({ title: 'Issue in C', description: 'Test' }),
        }, projectCId),
      ]

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      expect(results[0].title).toBe('Issue in A')
      expect(results[1].title).toBe('Issue in B')
      expect(results[2].title).toBe('Issue in C')
    })

    it('should maintain data isolation between projects', async () => {
      // Create issue in each project
      await apiRequest('/issues', {
        method: 'POST',
        body: JSON.stringify({ title: 'Issue A', description: 'Test' }),
      }, projectAId)

      await apiRequest('/issues', {
        method: 'POST',
        body: JSON.stringify({ title: 'Issue B', description: 'Test' }),
      }, projectBId)

      // Fetch issues from each project
      const issuesA = await apiRequest('/issues', {}, projectAId)
      const issuesB = await apiRequest('/issues', {}, projectBId)
      const issuesC = await apiRequest('/issues', {}, projectCId)

      // Verify isolation
      expect(issuesA.some((i: any) => i.title === 'Issue A')).toBe(true)
      expect(issuesA.some((i: any) => i.title === 'Issue B')).toBe(false)

      expect(issuesB.some((i: any) => i.title === 'Issue B')).toBe(true)
      expect(issuesB.some((i: any) => i.title === 'Issue A')).toBe(false)

      expect(issuesC).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid project path', async () => {
      try {
        await apiRequest('/projects/open', {
          method: 'POST',
          body: JSON.stringify({ path: '/nonexistent/path' }),
        })
        expect.fail('Should have thrown error for invalid path')
      } catch (error: any) {
        expect(error.status).toBeGreaterThanOrEqual(400)
      }
    })

    it('should handle invalid project ID', async () => {
      try {
        await apiRequest('/issues', {}, 'invalid-project-id')
        expect.fail('Should have thrown error for invalid project ID')
      } catch (error: any) {
        expect(error.status).toBe(404)
      }
    })

    it('should validate project path before opening', async () => {
      const validation = await apiRequest('/projects/validate', {
        method: 'POST',
        body: JSON.stringify({ path: '/nonexistent/path' }),
      })

      expect(validation.valid).toBe(false)
      expect(validation.error).toBeDefined()
    })
  })

  describe('Performance', () => {
    it('should open 5 projects in under 10 seconds', async () => {
      const startTime = Date.now()
      const projectIds: string[] = []

      try {
        // Create and open 5 test projects
        for (let i = 0; i < 5; i++) {
          const projectPath = join(TEST_PROJECTS_ROOT, `perf-test-${i}`)
          createTestProject(projectPath, `Perf Test ${i}`)

          const project = await apiRequest('/projects/open', {
            method: 'POST',
            body: JSON.stringify({ path: projectPath }),
          })

          projectIds.push(project.id)
          openedProjectIds.push(project.id)
        }

        const elapsed = Date.now() - startTime
        expect(elapsed).toBeLessThan(10000) // 10 seconds
      } finally {
        // Clean up
        for (const id of projectIds) {
          try {
            await apiRequest(`/projects/${id}/close`, { method: 'POST' })
            const index = openedProjectIds.indexOf(id)
            if (index > -1) {
              openedProjectIds.splice(index, 1)
            }
          } catch (error) {
            // Ignore cleanup errors
          }
        }
      }
    })

    it('should switch between projects with low latency', async () => {
      // Open two projects
      const projectA = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_A_PATH }),
      })
      const projectB = await apiRequest('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ path: PROJECT_B_PATH }),
      })

      openedProjectIds.push(projectA.id, projectB.id)

      try {
        // Measure time to switch between projects
        const startTime = Date.now()

        await apiRequest('/issues', {}, projectA.id)
        await apiRequest('/issues', {}, projectB.id)
        await apiRequest('/issues', {}, projectA.id)

        const elapsed = Date.now() - startTime
        expect(elapsed).toBeLessThan(500) // 500ms for 3 switches
      } finally {
        // Clean up
        await apiRequest(`/projects/${projectA.id}/close`, { method: 'POST' })
        await apiRequest(`/projects/${projectB.id}/close`, { method: 'POST' })
      }
    })
  })
})
